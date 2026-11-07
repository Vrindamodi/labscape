package com.labscape.api.intelligence.quiz;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labscape.api.common.ApiProblem;
import com.labscape.api.contracts.ProgressEvent;
import com.labscape.api.contracts.RewardResult;
import com.labscape.api.core.library.LibraryCatalogue;
import com.labscape.api.core.rewards.Rewards;
import com.labscape.api.intelligence.quiz.QuizBank.Quiz;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Random;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Quiz engine API (build plan 4.5, contract 6). Questions are drawn and shuffled per sitting and
 * served without answers; grading, mastery and XP all happen here.
 */
@RestController
public class QuizController {

    public record QuizCard(String id, String title, String experimentSlug, String subject, int poolSize, int draw,
            Map<String, String> concepts, Integer bestScore, int sittings) {}

    public record StartRequest(String experimentAttemptId) {}

    public record Started(String quizAttemptId, ObjectNode spec) {}

    public record SubmitRequest(String idempotencyKey, JsonNode answers) {}

    public record PerQuestion(String questionId, double credit, boolean correct, String explanation, String note, JsonNode yourAnswer, JsonNode rightAnswer) {}

    public record Result(String quizId, String attemptId, int scorePct, boolean passed, List<PerQuestion> perQuestion, int xpAwarded,
            List<String> revisionConceptIds, Map<String, String> conceptLabels, Map<String, Double> mastery, RewardResult reward) {}

    public record ConceptView(String conceptId, String label, double pKnown, int attempts, int correct, String quizId, String experimentSlug) {}

    public record Recommendation(String conceptId, String label, double pKnown, String quizId, String experimentSlug, String experimentTitle, String subject, boolean playable) {}

    private final QuizBank bank;
    private final Mastery mastery;
    private final Rewards rewards;
    private final LibraryCatalogue catalogue;
    private final JdbcClient db;
    private final ObjectMapper mapper;

    public QuizController(QuizBank bank, Mastery mastery, Rewards rewards, LibraryCatalogue catalogue, JdbcClient db, ObjectMapper mapper) {
        this.bank = bank;
        this.mastery = mastery;
        this.rewards = rewards;
        this.catalogue = catalogue;
        this.db = db;
        this.mapper = mapper;
    }

    private static UUID user(Jwt jwt) {
        if (jwt == null) throw new ApiProblem(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "Sign in or continue as a guest first.");
        return UUID.fromString(jwt.getSubject());
    }

    private String subjectOf(String slug) {
        if (slug != null && slug.startsWith("emergency-")) return "safety";
        return catalogue.bySlug(slug).map(LibraryCatalogue.Experiment::subject).orElse("chemistry");
    }

    @GetMapping("/v1/quizzes")
    public List<QuizCard> list(@AuthenticationPrincipal Jwt jwt) {
        Map<String, int[]> best = new HashMap<>();
        if (jwt != null) db.sql("SELECT quiz_id, max(score_pct), count(*) FROM quiz_attempts WHERE user_id = ? AND status = 'submitted' GROUP BY quiz_id")
                .param(UUID.fromString(jwt.getSubject()))
                .query((rs, i) -> Map.entry(rs.getString(1), new int[] {rs.getInt(2), rs.getInt(3)}))
                .list().forEach(e -> best.put(e.getKey(), e.getValue()));
        return bank.all().stream().map(q -> new QuizCard(q.id(), q.title(), q.experimentSlug(), subjectOf(q.experimentSlug()), bank.pool(q.id()).size(), q.draw(),
                q.concepts(), best.containsKey(q.id()) ? best.get(q.id())[0] : null, best.containsKey(q.id()) ? best.get(q.id())[1] : 0)).toList();
    }

    /** Draws a sitting: the pool is shuffled and the first `draw` questions are served without answers. */
    @PostMapping("/v1/quizzes/{quizId}/start")
    @Transactional
    public Started start(@AuthenticationPrincipal Jwt jwt, @PathVariable String quizId, @RequestBody(required = false) StartRequest req) {
        UUID u = user(jwt);
        Quiz quiz = bank.get(quizId).orElseThrow(() -> ApiProblem.notFound("QUIZ_NOT_FOUND", "No quiz called " + quizId + "."));
        List<JsonNode> pool = new ArrayList<>(bank.pool(quizId));
        Random rnd = new Random();
        Collections.shuffle(pool, rnd);
        List<JsonNode> drawn = pool.subList(0, Math.min(Math.max(3, Math.min(7, quiz.draw())), pool.size()));
        List<String[]> refs = drawn.stream().map(q -> new String[] {quizId, q.path("id").asText()}).toList();
        return open(u, quizId, quiz.title(), quiz.version(), quiz.passPct(), quiz.experimentSlug(), drawn, refs, req == null ? null : req.experimentAttemptId(), rnd);
    }

    /** Adaptive practice: questions on the learner's weakest concepts, from any pool. */
    @PostMapping("/v1/quizzes/practice/start")
    @Transactional
    public Started practice(@AuthenticationPrincipal Jwt jwt) {
        UUID u = user(jwt);
        Set<String> weak = new LinkedHashSet<>();
        mastery.weakest(u, 6).forEach(c -> weak.add(c.conceptId()));
        Random rnd = new Random();
        List<JsonNode> drawn = new ArrayList<>();
        List<String[]> refs = new ArrayList<>();
        List<Quiz> quizzes = new ArrayList<>(bank.all());
        Collections.shuffle(quizzes, rnd);
        // Weak concepts first; top up with unseen concepts so a new learner still gets a quiz.
        for (int pass = 0; pass < 2 && drawn.size() < 6; pass++) {
            for (Quiz q : quizzes) {
                for (JsonNode question : bank.pool(q.id())) {
                    if (drawn.size() >= 6) break;
                    boolean hits = false;
                    for (JsonNode c : question.path("conceptIds")) hits |= weak.contains(c.asText());
                    if ((pass == 0) == hits && refs.stream().noneMatch(r -> r[0].equals(q.id()) && r[1].equals(question.path("id").asText()))) {
                        drawn.add(question);
                        refs.add(new String[] {q.id(), question.path("id").asText()});
                        break; // one per quiz per pass keeps the mix varied
                    }
                }
            }
        }
        if (drawn.isEmpty()) throw ApiProblem.notFound("NO_PRACTICE", "Nothing to practise yet.");
        return open(u, "practice", weak.isEmpty() ? "Mixed practice" : "Practice your weak spots", 1, 60, null, drawn, refs, null, rnd);
    }

    private Started open(UUID u, String quizId, String title, int version, int passPct, String experimentSlug, List<JsonNode> drawn, List<String[]> refs, String experimentAttempt, Random rnd) {
        UUID id = UUID.randomUUID();
        ArrayNode ids = mapper.createArrayNode();
        refs.forEach(r -> ids.addObject().put("quiz", r[0]).put("id", r[1]));
        UUID expAttempt = null;
        try {
            if (experimentAttempt != null) expAttempt = UUID.fromString(experimentAttempt);
        } catch (IllegalArgumentException ignored) {
            // not an attempt id: the sitting simply isn't linked
        }
        db.sql("INSERT INTO quiz_attempts (id, user_id, quiz_id, experiment_attempt, question_ids) VALUES (?, ?, ?, ?, ?::jsonb)")
                .params(id, u, quizId, expAttempt, ids.toString()).update();
        ObjectNode spec = mapper.createObjectNode();
        spec.put("id", quizId).put("version", version).put("title", title).put("passPct", passPct);
        if (experimentSlug != null) spec.put("experimentId", experimentSlug);
        ArrayNode qs = spec.putArray("questions");
        drawn.forEach(q -> qs.add(bank.serve(q, rnd)));
        return new Started(id.toString(), spec);
    }

    @PostMapping("/v1/quizzes/attempts/{attemptId}/submit")
    @Transactional
    public Result submit(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID attemptId, @RequestBody SubmitRequest req) {
        UUID u = user(jwt);
        if (req.idempotencyKey() == null || req.idempotencyKey().isBlank()) throw ApiProblem.badRequest("KEY_REQUIRED", "Send an idempotencyKey.");
        var row = db.sql("SELECT quiz_id, question_ids::text, status, idempotency_key, result::text FROM quiz_attempts WHERE id = ? AND user_id = ? FOR UPDATE")
                .params(attemptId, u)
                .query((rs, i) -> new String[] {rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5)})
                .optional().orElseThrow(() -> ApiProblem.notFound("QUIZ_ATTEMPT_NOT_FOUND", "That quiz sitting doesn't exist."));
        if ("submitted".equals(row[2])) {
            // The same submission again returns the stored result; a different one is refused.
            if (req.idempotencyKey().equals(row[3])) return readResult(row[4]);
            throw new ApiProblem(HttpStatus.CONFLICT, "QUIZ_ALREADY_SUBMITTED", "This quiz has already been submitted. Start a new one to try again.");
        }
        String quizId = row[0];
        JsonNode refs = read(row[1]);
        Map<String, JsonNode> answers = new HashMap<>();
        if (req.answers() != null) req.answers().forEach(a -> answers.put(a.path("questionId").asText(), a));

        List<PerQuestion> per = new ArrayList<>();
        Map<String, Double> newMastery = new LinkedHashMap<>();
        Map<String, String> labels = new LinkedHashMap<>();
        Set<String> revision = new LinkedHashSet<>();
        double total = 0;
        for (JsonNode ref : refs) {
            String qid = ref.path("id").asText();
            String fromQuiz = ref.path("quiz").asText();
            JsonNode q = bank.question(fromQuiz, qid).orElseThrow(() -> new IllegalStateException("Question vanished: " + fromQuiz + "/" + qid));
            JsonNode given = answers.get(qid);
            QuizGrader.Grade g = QuizGrader.grade(q, given);
            total += g.credit();
            per.add(new PerQuestion(qid, Math.round(g.credit() * 100) / 100.0, g.correct(), q.path("explanation").asText(), g.note(), given, rightAnswer(q)));
            newMastery.putAll(mastery.record(u, q, g.credit()));
            bank.get(fromQuiz).ifPresent(qz -> q.path("conceptIds").forEach(c -> labels.put(c.asText(), qz.concepts().getOrDefault(c.asText(), c.asText()))));
            if (!g.correct()) q.path("conceptIds").forEach(c -> revision.add(c.asText()));
        }
        newMastery.forEach((c, p) -> {
            if (p < Mastery.WEAK) revision.add(c);
        });
        int score = refs.isEmpty() ? 0 : (int) Math.round(100 * total / refs.size());
        int passPct = bank.get(quizId).map(Quiz::passPct).orElse(60);
        boolean passed = score >= passPct;

        RewardResult reward = rewards.awardVerified(u, new ProgressEvent("quiz:" + attemptId, "quiz.completed", Instant.now(),
                bank.get(quizId).map(q -> subjectOf(q.experimentSlug())).orElse(null), quizId, attemptId.toString(), score));
        Result result = new Result(quizId, attemptId.toString(), score, passed, per, reward == null || reward.duplicate() ? 0 : reward.xpAwarded(),
                List.copyOf(revision), labels, newMastery, reward);
        try {
            db.sql("""
                    UPDATE quiz_attempts SET status = 'submitted', idempotency_key = ?, answers = ?::jsonb, score_pct = ?, passed = ?,
                           result = ?::jsonb, submitted_at = now() WHERE id = ?
                    """).params(req.idempotencyKey(), mapper.writeValueAsString(req.answers()), score, passed, mapper.writeValueAsString(result), attemptId).update();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return result;
    }

    /** The answer, in a form the results screen can show next to the learner's. */
    private static JsonNode rightAnswer(JsonNode q) {
        return q.path("answer");
    }

    @GetMapping("/v1/quizzes/mastery")
    public List<ConceptView> masteryView(@AuthenticationPrincipal Jwt jwt) {
        UUID u = user(jwt);
        Map<String, Mastery.Concept> m = mastery.of(u);
        List<ConceptView> out = new ArrayList<>();
        for (Quiz q : bank.all())
            q.concepts().forEach((id, label) -> {
                Mastery.Concept c = m.get(id);
                if (out.stream().noneMatch(x -> x.conceptId().equals(id)))
                    out.add(new ConceptView(id, label, c == null ? Mastery.P_INIT : c.pKnown(), c == null ? 0 : c.attempts(), c == null ? 0 : c.correct(), q.id(), q.experimentSlug()));
            });
        return out;
    }

    /** Weak concepts mapped to the experiment (and quiz) that teaches them (build plan 4.9). */
    @GetMapping("/v1/recommendations")
    public List<Recommendation> recommendations(@AuthenticationPrincipal Jwt jwt) {
        UUID u = user(jwt);
        List<Recommendation> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Mastery.Concept c : mastery.weakest(u, 8)) {
            Optional<Quiz> quiz = bank.all().stream().filter(q -> q.concepts().containsKey(c.conceptId())).findFirst();
            if (quiz.isEmpty() || !seen.add(c.conceptId())) continue;
            var exp = catalogue.bySlug(quiz.get().experimentSlug());
            out.add(new Recommendation(c.conceptId(), quiz.get().concepts().get(c.conceptId()), c.pKnown(), quiz.get().id(), quiz.get().experimentSlug(),
                    exp.map(LibraryCatalogue.Experiment::title).orElse(quiz.get().title()), exp.map(LibraryCatalogue.Experiment::subject).orElse(null), exp.map(LibraryCatalogue.Experiment::playable).orElse(false)));
        }
        return out;
    }

    private Result readResult(String json) {
        try {
            return mapper.readValue(json, Result.class);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private JsonNode read(String s) {
        try {
            return mapper.readTree(s);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
