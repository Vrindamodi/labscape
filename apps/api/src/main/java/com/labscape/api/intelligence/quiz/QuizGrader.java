package com.labscape.api.intelligence.quiz;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Server-side grading for all nine question types (build plan 4.5): tolerances for numerical
 * answers, partial credit for multi-select, matching, labelling, ordering and multi-blank answers.
 */
public final class QuizGrader {

    private QuizGrader() {}

    public record Grade(double credit, boolean correct, String note) {}

    public static Grade grade(JsonNode q, JsonNode a) {
        if (a == null || a.isNull() || a.isMissingNode()) return new Grade(0, false, "Not answered.");
        return switch (q.path("type").asText()) {
            case "multiple_choice", "identify_equipment", "predict_outcome" -> choice(q, a);
            case "true_false" -> bool(a.path("value").isBoolean() && a.path("value").asBoolean() == q.path("answer").asBoolean());
            case "match" -> pairs(q.path("answer"), a.path("pairs"));
            case "label_diagram" -> pairs(q.path("answer"), a.path("placements"));
            case "arrange_steps" -> order(q.path("answer"), a.path("order"));
            case "numerical" -> numerical(q, a);
            case "fill_blank" -> blanks(q, a);
            default -> new Grade(0, false, "Unknown question type.");
        };
    }

    private static Grade bool(boolean ok) {
        return new Grade(ok ? 1 : 0, ok, null);
    }

    /** Single answer: all or nothing. Multi-select: (right picks − wrong picks) / right options. */
    private static Grade choice(JsonNode q, JsonNode a) {
        Set<String> right = texts(q.path("answer"));
        Set<String> picked = texts(a.path("optionIds"));
        if (!q.path("multi").asBoolean()) return bool(picked.size() == 1 && right.containsAll(picked));
        long hits = picked.stream().filter(right::contains).count();
        long misses = picked.size() - hits;
        double credit = Math.max(0, (hits - misses) / (double) right.size());
        return new Grade(credit, credit >= 0.999, null);
    }

    /** Fraction of pairs placed correctly. */
    private static Grade pairs(JsonNode answer, JsonNode given) {
        Set<String> right = new HashSet<>();
        answer.forEach(p -> right.add(p.get(0).asText() + "→" + p.get(1).asText()));
        Set<String> seenLeft = new HashSet<>();
        int hits = 0;
        for (JsonNode p : given) {
            if (p.size() != 2 || !seenLeft.add(p.get(0).asText())) continue; // one placement per item
            if (right.contains(p.get(0).asText() + "→" + p.get(1).asText())) hits++;
        }
        double credit = right.isEmpty() ? 0 : hits / (double) right.size();
        return new Grade(credit, credit >= 0.999, null);
    }

    /** Partial credit: longest run of items in the right relative order (LIS) over the length. */
    private static Grade order(JsonNode answer, JsonNode given) {
        List<String> truth = new ArrayList<>();
        answer.forEach(n -> truth.add(n.asText()));
        List<Integer> ranks = new ArrayList<>();
        Set<String> used = new HashSet<>();
        for (JsonNode n : given) {
            int r = truth.indexOf(n.asText());
            if (r >= 0 && used.add(n.asText())) ranks.add(r);
        }
        int[] best = new int[ranks.size()];
        int lis = 0;
        for (int i = 0; i < ranks.size(); i++) {
            best[i] = 1;
            for (int j = 0; j < i; j++) if (ranks.get(j) < ranks.get(i)) best[i] = Math.max(best[i], best[j] + 1);
            lis = Math.max(lis, best[i]);
        }
        boolean exact = ranks.size() == truth.size() && lis == truth.size();
        return new Grade(truth.isEmpty() ? 0 : lis / (double) truth.size(), exact, null);
    }

    private static String unit(String u) {
        return u == null ? "" : u.trim().toLowerCase(Locale.ROOT).replace(" ", "").replace("Ω", "ohm").replace("ω", "ohm").replace("ohms", "ohm");
    }

    /** Within tolerance (absolute or percent). A right number with the wrong unit gets half credit. */
    private static Grade numerical(JsonNode q, JsonNode a) {
        if (!a.path("value").isNumber()) return new Grade(0, false, "Enter a number.");
        double v = a.path("value").asDouble();
        double target = q.path("answer").asDouble();
        JsonNode tol = q.path("tolerance");
        double allowed = tol.has("pct") ? Math.abs(target) * tol.get("pct").asDouble() / 100.0 : tol.path("abs").asDouble(0);
        boolean value = Math.abs(v - target) <= allowed + 1e-12;
        if (!value) return new Grade(0, false, null);
        String expected = q.path("unit").asText("");
        if (expected.isEmpty()) return new Grade(1, true, null);
        String given = unit(a.path("unit").asText(""));
        boolean unitOk = given.isEmpty() || given.equals(unit(expected));
        if (!unitOk) for (JsonNode u : q.path("acceptUnits")) unitOk |= given.equals(unit(u.asText()));
        return unitOk ? new Grade(1, true, null) : new Grade(0.5, false, "Right number, wrong unit: the answer is in " + expected + ".");
    }

    private static String norm(String s) {
        return s.trim().toLowerCase(Locale.ROOT).replace("−", "-").replace(" ", "").replace("*", "")
                .replace("³", "^3").replace("²", "^2").replace("⁻", "-").replace("₂", "2");
    }

    /** Each blank has a list of accepted answers (case and spacing ignored). */
    private static Grade blanks(JsonNode q, JsonNode a) {
        JsonNode accepted = q.path("answer");
        JsonNode given = a.path("values");
        int hits = 0;
        for (int i = 0; i < accepted.size(); i++) {
            String g = norm(given.path(i).asText(""));
            for (JsonNode alt : accepted.get(i)) if (!g.isEmpty() && g.equals(norm(alt.asText()))) {
                hits++;
                break;
            }
        }
        double credit = accepted.isEmpty() ? 0 : hits / (double) accepted.size();
        return new Grade(credit, credit >= 0.999, null);
    }

    private static Set<String> texts(JsonNode arr) {
        Set<String> out = new HashSet<>();
        arr.forEach(n -> out.add(n.asText()));
        return out;
    }
}
