package com.labscape.api.intelligence.quiz;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Per-concept mastery by Bayesian knowledge tracing (build plan 4.5). Each answer updates the
 * probability the learner knows the concept, allowing for slips and lucky guesses; partial credit
 * counts as partial evidence.
 */
@Component
public class Mastery {

    static final double P_INIT = 0.25;
    static final double P_LEARN = 0.12;
    static final double P_SLIP = 0.1;
    /** At or above this the concept is mastered; below WEAK it is recommended for revision. */
    public static final double MASTERED = 0.95;
    public static final double WEAK = 0.6;

    public record Concept(String conceptId, double pKnown, int attempts, int correct) {}

    private final JdbcClient db;

    public Mastery(JdbcClient db) {
        this.db = db;
    }

    /** Chance of guessing right without knowing, by question type. */
    static double guess(JsonNode q) {
        return switch (q.path("type").asText()) {
            case "true_false" -> 0.5;
            case "multiple_choice", "identify_equipment", "predict_outcome" -> q.path("multi").asBoolean() ? 0.1 : 1.0 / Math.max(2, q.path("options").size());
            case "match", "label_diagram", "arrange_steps" -> 0.1;
            default -> 0.05;
        };
    }

    /** One BKT step with soft evidence (credit in 0..1). */
    static double update(double p, double credit, double guess) {
        double right = p * (1 - P_SLIP) / (p * (1 - P_SLIP) + (1 - p) * guess);
        double wrong = p * P_SLIP / (p * P_SLIP + (1 - p) * (1 - guess));
        double posterior = credit * right + (1 - credit) * wrong;
        return posterior + (1 - posterior) * P_LEARN;
    }

    public Map<String, Concept> of(UUID user) {
        return db.sql("SELECT concept_id, p_known, attempts, correct FROM concept_mastery WHERE user_id = ?")
                .param(user)
                .query((rs, i) -> new Concept(rs.getString(1), rs.getDouble(2), rs.getInt(3), rs.getInt(4)))
                .list().stream()
                .collect(java.util.stream.Collectors.toMap(Concept::conceptId, c -> c));
    }

    /** Applies one graded question to every concept it tests; returns the new probabilities. */
    public Map<String, Double> record(UUID user, JsonNode question, double credit) {
        Map<String, Concept> current = of(user);
        Map<String, Double> out = new java.util.LinkedHashMap<>();
        for (JsonNode c : question.path("conceptIds")) {
            String id = c.asText();
            Concept was = current.get(id);
            double p = update(was == null ? P_INIT : was.pKnown(), credit, guess(question));
            db.sql("""
                    INSERT INTO concept_mastery (user_id, concept_id, p_known, attempts, correct, updated_at)
                    VALUES (?, ?, ?, 1, ?, now())
                    ON CONFLICT (user_id, concept_id) DO UPDATE
                       SET p_known = EXCLUDED.p_known, attempts = concept_mastery.attempts + 1,
                           correct = concept_mastery.correct + EXCLUDED.correct, updated_at = now()
                    """).params(user, id, p, credit >= 0.999 ? 1 : 0).update();
            out.put(id, p);
        }
        return out;
    }

    /** Weakest concepts first (seen ones below WEAK). */
    public List<Concept> weakest(UUID user, int limit) {
        return of(user).values().stream().filter(c -> c.pKnown() < WEAK).sorted((a, b) -> Double.compare(a.pKnown(), b.pKnown())).limit(limit).toList();
    }
}
