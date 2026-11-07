package com.labscape.api.intelligence.quiz;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Random;
import java.util.Set;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Question pools: reviewed content (content/quizzes/*.json) plus drafted questions a reviewer has
 * approved. Drafts that are not approved never reach a learner.
 */
@Component
public class QuizBank {

    public record Quiz(String id, String experimentSlug, String title, int version, int passPct, int draw,
            Map<String, String> concepts, List<JsonNode> questions) {}

    /** Fields that would give the answer away; stripped before anything is sent to a learner. */
    static final Set<String> SECRET = Set.of("answer", "explanation", "tolerance", "acceptUnits", "status", "source");

    private final ObjectMapper mapper;
    private final JdbcClient db;
    private final Map<String, Quiz> quizzes = new LinkedHashMap<>();

    public QuizBank(ObjectMapper mapper, JdbcClient db) {
        this.mapper = mapper;
        this.db = db;
        try {
            Resource[] files = new PathMatchingResourcePatternResolver().getResources("classpath:content/quizzes/*.json");
            List<Quiz> list = new ArrayList<>();
            for (Resource r : files) {
                try (InputStream in = r.getInputStream()) {
                    JsonNode n = mapper.readTree(in);
                    Map<String, String> concepts = new LinkedHashMap<>();
                    n.get("concepts").fields().forEachRemaining(e -> concepts.put(e.getKey(), e.getValue().asText()));
                    List<JsonNode> qs = new ArrayList<>();
                    n.get("questions").forEach(q -> {
                        if ("approved".equals(q.path("status").asText())) qs.add(q);
                    });
                    list.add(new Quiz(n.get("id").asText(), n.get("experimentSlug").asText(), n.get("title").asText(),
                            n.path("version").asInt(1), n.path("passPct").asInt(60), n.path("draw").asInt(5), Map.copyOf(concepts), List.copyOf(qs)));
                }
            }
            list.sort((a, b) -> a.id().compareTo(b.id()));
            list.forEach(q -> quizzes.put(q.id(), q));
        } catch (IOException e) {
            throw new UncheckedIOException("Could not load quizzes", e);
        }
    }

    public List<Quiz> all() {
        return List.copyOf(quizzes.values());
    }

    public Optional<Quiz> get(String id) {
        return Optional.ofNullable(quizzes.get(id));
    }

    /** Reviewed questions plus approved drafts for one quiz. */
    public List<JsonNode> pool(String quizId) {
        Quiz q = quizzes.get(quizId);
        if (q == null) return List.of();
        List<JsonNode> out = new ArrayList<>(q.questions());
        db.sql("SELECT question::text FROM quiz_question_drafts WHERE quiz_id = ? AND status = 'approved' ORDER BY created_at")
                .param(quizId).query(String.class).list()
                .forEach(s -> out.add(read(s)));
        return out;
    }

    /** Finds a question by id across all pools (approved only). */
    public Optional<JsonNode> question(String quizId, String questionId) {
        return pool(quizId).stream().filter(q -> q.path("id").asText().equals(questionId)).findFirst();
    }

    /** A learner's copy: answers stripped, options and steps shuffled. */
    public ObjectNode serve(JsonNode q, Random rnd) {
        ObjectNode o = q.deepCopy();
        SECRET.forEach(o::remove);
        for (String field : List.of("options", "steps", "right", "labels")) {
            if (o.has(field) && o.get(field).isArray()) {
                List<JsonNode> items = new ArrayList<>();
                o.get(field).forEach(items::add);
                // Keep "steps" from ever being served already in order.
                do Collections.shuffle(items, rnd);
                while (field.equals("steps") && items.size() > 1 && inOrder(items));
                ArrayNode arr = o.putArray(field);
                items.forEach(arr::add);
            }
        }
        return o;
    }

    private static boolean inOrder(List<JsonNode> items) {
        for (int i = 0; i < items.size(); i++) if (!items.get(i).path("id").asText().equals("s" + (i + 1))) return false;
        return true;
    }

    private JsonNode read(String s) {
        try {
            return mapper.readTree(s);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
