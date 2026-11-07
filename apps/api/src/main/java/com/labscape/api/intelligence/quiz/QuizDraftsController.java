package com.labscape.api.intelligence.quiz;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labscape.api.common.ApiProblem;
import com.labscape.api.lab.LabEngineRuntime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Review queue for drafted questions (build plan 4.5). Drafts from authors or the AI are checked
 * automatically (shape, answer keys, concepts, distinct options, and numerical answers recomputed
 * by the engine when a formula is given), then wait for a person. Only approval puts a question in
 * the live pool; nothing drafted reaches a learner before that.
 */
@RestController
@RequestMapping("/v1/admin/quiz-drafts")
public class QuizDraftsController {

    public record DraftRequest(String quizId, JsonNode question, String source) {}

    public record Check(String name, boolean ok, String detail) {}

    public record Draft(String id, String quizId, JsonNode question, String source, String status, List<Check> checks, String notes, String createdAt) {}

    public record Review(String notes) {}

    private final JdbcClient db;
    private final QuizBank bank;
    private final ObjectMapper mapper;
    private final LabEngineRuntime engine;

    public QuizDraftsController(JdbcClient db, QuizBank bank, ObjectMapper mapper, LabEngineRuntime engine) {
        this.db = db;
        this.bank = bank;
        this.mapper = mapper;
        this.engine = engine;
    }

    @GetMapping
    public List<Draft> list() {
        return db.sql("SELECT id, quiz_id, question::text, source, status, checks::text, notes, created_at::text FROM quiz_question_drafts ORDER BY status = 'draft' DESC, created_at DESC LIMIT 200")
                .query((rs, i) -> new Draft(rs.getString(1), rs.getString(2), read(rs.getString(3)), rs.getString(4), rs.getString(5),
                        List.of(mapper.convertValue(read(rs.getString(6)), Check[].class)), rs.getString(7), rs.getString(8)))
                .list();
    }

    @PostMapping
    public Draft create(@AuthenticationPrincipal Jwt jwt, @RequestBody DraftRequest req) {
        var quiz = bank.get(req.quizId()).orElseThrow(() -> ApiProblem.notFound("QUIZ_NOT_FOUND", "No quiz called " + req.quizId() + "."));
        if (req.question() == null || !req.question().isObject()) throw ApiProblem.badRequest("QUESTION_REQUIRED", "Send the question as an object.");
        String source = "ai".equals(req.source()) ? "ai" : "author";
        ObjectNode q = req.question().deepCopy();
        if (!q.hasNonNull("id")) q.put("id", "draft-" + UUID.randomUUID().toString().substring(0, 8));
        q.put("status", "approved"); // the status that matters lives on the draft row
        q.put("source", source);
        List<Check> checks = check(q, quiz.concepts());
        UUID id = UUID.randomUUID();
        db.sql("INSERT INTO quiz_question_drafts (id, quiz_id, question, source, checks, created_by) VALUES (?, ?, ?::jsonb, ?, ?::jsonb, ?)")
                .params(id, req.quizId(), q.toString(), source, mapper.valueToTree(checks).toString(), UUID.fromString(jwt.getSubject())).update();
        return new Draft(id.toString(), req.quizId(), q, source, "draft", checks, null, null);
    }

    @PostMapping("/{id}/approve")
    public Map<String, String> approve(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody(required = false) Review r) {
        String checks = db.sql("SELECT checks::text FROM quiz_question_drafts WHERE id = ?").param(id).query(String.class).optional()
                .orElseThrow(() -> ApiProblem.notFound("DRAFT_NOT_FOUND", "No such draft."));
        boolean allOk = true;
        for (JsonNode c : read(checks)) allOk &= c.path("ok").asBoolean();
        if (!allOk) throw new ApiProblem(HttpStatus.UNPROCESSABLE_ENTITY, "DRAFT_FAILS_CHECKS", "Fix the failing checks before approving.");
        return review(jwt, id, "approved", r);
    }

    @PostMapping("/{id}/reject")
    public Map<String, String> reject(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody(required = false) Review r) {
        return review(jwt, id, "rejected", r);
    }

    private Map<String, String> review(Jwt jwt, UUID id, String status, Review r) {
        int n = db.sql("UPDATE quiz_question_drafts SET status = ?, reviewed_by = ?, reviewed_at = now(), notes = ? WHERE id = ?")
                .params(status, UUID.fromString(jwt.getSubject()), r == null ? null : r.notes(), id).update();
        if (n == 0) throw ApiProblem.notFound("DRAFT_NOT_FOUND", "No such draft.");
        return Map.of("id", id.toString(), "status", status);
    }

    /** Automatic checks a reviewer sees next to the draft. */
    List<Check> check(JsonNode q, Map<String, String> concepts) {
        List<Check> out = new ArrayList<>();
        String type = q.path("type").asText();
        Set<String> types = Set.of("multiple_choice", "true_false", "match", "identify_equipment", "label_diagram", "predict_outcome", "arrange_steps", "numerical", "fill_blank");
        out.add(new Check("type", types.contains(type), types.contains(type) ? type : "Unknown type " + type));
        out.add(new Check("prompt", q.path("prompt").asText().length() >= 10, "The prompt needs a real question."));
        out.add(new Check("explanation", q.path("explanation").asText().length() >= 10, "Every question explains its answer."));
        boolean conceptsOk = q.path("conceptIds").isArray() && !q.path("conceptIds").isEmpty();
        for (JsonNode c : q.path("conceptIds")) conceptsOk &= concepts.containsKey(c.asText());
        out.add(new Check("concepts", conceptsOk, "Concepts must be ones this quiz teaches: " + String.join(", ", concepts.keySet())));
        switch (type) {
            case "multiple_choice", "identify_equipment", "predict_outcome" -> {
                Set<String> ids = new HashSet<>();
                Set<String> texts = new HashSet<>();
                q.path("options").forEach(o -> {
                    ids.add(o.path("id").asText());
                    texts.add(o.path("text").asText().trim().toLowerCase());
                });
                boolean keys = q.path("answer").isArray() && !q.path("answer").isEmpty();
                for (JsonNode a : q.path("answer")) keys &= ids.contains(a.asText());
                out.add(new Check("answer-key", keys, "The answer must name existing options."));
                out.add(new Check("distractors", texts.size() == q.path("options").size() && q.path("options").size() >= 2 && q.path("answer").size() < q.path("options").size(),
                        "Options must be distinct, and at least one must be wrong."));
            }
            case "numerical" -> {
                boolean has = q.path("answer").isNumber() && q.path("tolerance").isObject();
                out.add(new Check("answer-key", has, "A numerical answer needs a value and a tolerance."));
                // Recompute with the maths engine when the draft says how the answer is derived.
                if (q.has("check")) {
                    try {
                        double v = engine.evaluate(q.path("check").path("expr").asText(), q.path("check").path("inputs").toString());
                        double target = q.path("answer").asDouble();
                        boolean ok = Math.abs(v - target) <= Math.max(1e-9, Math.abs(target) * 0.005);
                        out.add(new Check("recomputed", ok, "The engine gets " + v + "."));
                    } catch (RuntimeException e) {
                        out.add(new Check("recomputed", false, "The check expression could not be evaluated."));
                    }
                }
            }
            case "true_false" -> out.add(new Check("answer-key", q.path("answer").isBoolean(), "The answer must be true or false."));
            case "arrange_steps" -> out.add(new Check("answer-key", q.path("answer").size() == q.path("steps").size() && q.path("steps").size() >= 3, "Order every step (at least 3)."));
            case "match" -> out.add(new Check("answer-key", q.path("answer").size() == q.path("left").size() && q.path("left").size() >= 2, "Pair every item."));
            case "label_diagram" -> out.add(new Check("answer-key", q.path("answer").size() == q.path("labels").size(), "Place every label."));
            case "fill_blank" -> out.add(new Check("answer-key", q.path("answer").size() == q.path("blanks").asInt() && q.path("answer").size() > 0, "Give accepted answers for every blank."));
            default -> { }
        }
        return out;
    }

    private JsonNode read(String s) {
        try {
            return mapper.readTree(s);
        } catch (java.io.IOException e) {
            ArrayNode empty = mapper.createArrayNode();
            return empty;
        }
    }
}
