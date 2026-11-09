package com.labscape.api.intelligence.emergency;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labscape.api.common.ApiProblem;
import com.labscape.api.contracts.ProgressEvent;
import com.labscape.api.contracts.RewardResult;
import com.labscape.api.core.billing.Entitlements;
import com.labscape.api.core.rewards.Rewards;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
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
 * Emergency simulator (build plan 4.3). Scenarios are reviewed JSON; each choice is resolved here
 * (feedback, hazard change, next scene) and the run is scored on: time to recognise the danger,
 * decision quality, safety awareness, appropriate escalation and the outcome.
 */
@RestController
public class EmergencyController {

    public record Card(String slug, String title, String summary, String kind, int minutes, boolean free, boolean locked, Integer bestScore, String reviewStatus) {}

    public record SceneView(String id, String stage, int timerS, double growth, double hazard, String narration, List<Map<String, String>> choices) {}

    public record Started(String attemptId, String title, String kind, String disclaimer, SceneView scene) {}

    public record ChooseRequest(String choiceId, long elapsedMs) {}

    public record Chosen(String quality, boolean safe, String feedback, double hazard, SceneView next, Map<String, String> ending) {}

    public record Dimension(String id, String label, int score, int weight) {}

    public record Mistake(String stage, String choice, String feedback) {}

    public record Result(int score, List<Dimension> breakdown, List<Mistake> mistakes, List<String> learn, List<String> sources, Map<String, String> ending,
            String disclaimer, String quizId, boolean badgeEligible, RewardResult reward) {}

    static final Map<String, Double> QUALITY = Map.of("best", 1.0, "ok", 0.7, "poor", 0.3, "unsafe", 0.0);

    private final Map<String, JsonNode> scenarios = new LinkedHashMap<>();
    private final JdbcClient db;
    private final ObjectMapper mapper;
    private final Rewards rewards;
    private final Entitlements entitlements;

    public EmergencyController(JdbcClient db, ObjectMapper mapper, Rewards rewards, Entitlements entitlements) {
        this.db = db;
        this.mapper = mapper;
        this.rewards = rewards;
        this.entitlements = entitlements;
        try {
            Resource[] files = new PathMatchingResourcePatternResolver().getResources("classpath:content/scenarios/*.json");
            List<JsonNode> list = new ArrayList<>();
            for (Resource r : files) try (InputStream in = r.getInputStream()) {
                list.add(mapper.readTree(in));
            }
            // free scenario first, then by title
            list.sort((a, b) -> a.path("free").asBoolean() != b.path("free").asBoolean() ? (a.path("free").asBoolean() ? -1 : 1) : a.path("title").asText().compareTo(b.path("title").asText()));
            list.forEach(s -> scenarios.put(s.path("slug").asText(), s));
        } catch (IOException e) {
            throw new UncheckedIOException("Could not load scenarios", e);
        }
    }

    private static UUID user(Jwt jwt) {
        if (jwt == null) throw new ApiProblem(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "Sign in or continue as a guest first.");
        return UUID.fromString(jwt.getSubject());
    }

    private boolean locked(UUID user, JsonNode s) {
        return !s.path("free").asBoolean() && !entitlements.bool(user, "emergency.all");
    }

    @GetMapping("/v1/emergency/scenarios")
    public List<Card> list(@AuthenticationPrincipal Jwt jwt) {
        UUID u = jwt == null ? null : UUID.fromString(jwt.getSubject());
        Map<String, Integer> best = new HashMap<>();
        if (u != null) db.sql("SELECT scenario, max(score) FROM emergency_attempts WHERE user_id = ? AND status = 'completed' GROUP BY scenario").param(u)
                .query((rs, i) -> Map.entry(rs.getString(1), rs.getInt(2))).list().forEach(e -> best.put(e.getKey(), e.getValue()));
        return scenarios.values().stream().map(s -> new Card(s.path("slug").asText(), s.path("title").asText(), s.path("summary").asText(), s.path("kind").asText(),
                s.path("minutes").asInt(), s.path("free").asBoolean(), locked(u, s), best.get(s.path("slug").asText()), s.path("reviewStatus").asText())).toList();
    }

    private JsonNode scenario(String slug) {
        JsonNode s = scenarios.get(slug);
        if (s == null) throw ApiProblem.notFound("SCENARIO_NOT_FOUND", "No scenario called " + slug + ".");
        return s;
    }

    private static JsonNode scene(JsonNode s, String id) {
        for (JsonNode sc : s.path("scenes")) if (sc.path("id").asText().equals(id)) return sc;
        return null;
    }

    /** What the client may see of a scene: no qualities, feedback or destinations. */
    private static SceneView view(JsonNode sc, double hazard) {
        List<Map<String, String>> choices = new ArrayList<>();
        sc.path("choices").forEach(c -> choices.add(Map.of("id", c.path("id").asText(), "label", c.path("label").asText())));
        return new SceneView(sc.path("id").asText(), sc.path("stage").asText(), sc.path("timerS").asInt(15), sc.path("growth").asDouble(1), hazard, sc.path("narration").asText(), choices);
    }

    @PostMapping("/v1/emergency/scenarios/{slug}/start")
    @Transactional
    public Started start(@AuthenticationPrincipal Jwt jwt, @PathVariable String slug) {
        UUID u = user(jwt);
        JsonNode s = scenario(slug);
        if (locked(u, s)) throw new ApiProblem(HttpStatus.PAYMENT_REQUIRED, "SCENARIO_LOCKED", "This scenario is part of LABscape Premium.");
        JsonNode first = s.path("scenes").get(0);
        UUID id = UUID.randomUUID();
        double hazard = first.path("hazard").asDouble();
        db.sql("INSERT INTO emergency_attempts (id, user_id, scenario, scene, hazard) VALUES (?, ?, ?, ?, ?)").params(id, u, slug, first.path("id").asText(), hazard).update();
        return new Started(id.toString(), s.path("title").asText(), s.path("kind").asText(), s.path("disclaimer").asText(), view(first, hazard));
    }

    @PostMapping("/v1/emergency/attempts/{id}/choose")
    @Transactional
    public Chosen choose(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody ChooseRequest req) {
        UUID u = user(jwt);
        var row = db.sql("SELECT scenario, scene, hazard, status FROM emergency_attempts WHERE id = ? AND user_id = ? FOR UPDATE").params(id, u)
                .query((rs, i) -> new Object[] {rs.getString(1), rs.getString(2), rs.getDouble(3), rs.getString(4)})
                .optional().orElseThrow(() -> ApiProblem.notFound("ATTEMPT_NOT_FOUND", "That scenario run doesn't exist."));
        if (!"in_progress".equals(row[3]) || row[1] == null) throw new ApiProblem(HttpStatus.CONFLICT, "SCENARIO_OVER", "This scenario has ended.");
        JsonNode s = scenario((String) row[0]);
        JsonNode sc = scene(s, (String) row[1]);
        JsonNode choice = null;
        for (JsonNode c : sc.path("choices")) if (c.path("id").asText().equals(req.choiceId())) choice = c;
        if (choice == null) throw ApiProblem.badRequest("BAD_CHOICE", "That isn't one of the options.");

        // The hazard grows while you hesitate, then the choice pushes it up or down.
        double elapsedS = Math.max(0, Math.min(sc.path("timerS").asInt(15) * 2, req.elapsedMs() / 1000.0));
        double hazard = clamp((double) row[2] + sc.path("growth").asDouble(1) * elapsedS + choice.path("hazardDelta").asDouble());
        ObjectNode record = mapper.createObjectNode();
        record.put("scene", sc.path("id").asText()).put("stage", sc.path("stage").asText()).put("choice", choice.path("id").asText()).put("label", choice.path("label").asText())
                .put("quality", choice.path("quality").asText()).put("feedback", choice.path("feedback").asText()).put("elapsedMs", req.elapsedMs())
                .put("timerS", sc.path("timerS").asInt(15)).put("recognise", choice.path("recognise").asBoolean()).put("escalate", choice.path("escalate").asBoolean());

        String next = choice.path("next").asText();
        JsonNode nextScene = scene(s, next);
        Map<String, String> ending = null;
        SceneView nextView = null;
        if (nextScene != null) {
            // a new scene starts from at least its own baseline hazard
            hazard = Math.max(clamp(hazard * 0.85), nextScene.path("hazard").asDouble());
            nextView = view(nextScene, hazard);
        } else {
            JsonNode e = s.path("endings").path(next);
            ending = Map.of("id", next, "outcome", e.path("outcome").asText("safe"), "text", e.path("text").asText());
        }
        db.sql("UPDATE emergency_attempts SET scene = ?, hazard = ?, ending = ?, choices = choices || ?::jsonb WHERE id = ?")
                .params(nextScene == null ? null : next, hazard, nextScene == null ? next : null, mapper.createArrayNode().add(record).toString(), id).update();
        String q = choice.path("quality").asText();
        return new Chosen(q, !q.equals("unsafe"), choice.path("feedback").asText(), hazard, nextView, ending);
    }

    @PostMapping("/v1/emergency/attempts/{id}/finish")
    @Transactional
    public Result finish(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        UUID u = user(jwt);
        var row = db.sql("SELECT scenario, choices::text, ending, status, result::text FROM emergency_attempts WHERE id = ? AND user_id = ? FOR UPDATE").params(id, u)
                .query((rs, i) -> new String[] {rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5)})
                .optional().orElseThrow(() -> ApiProblem.notFound("ATTEMPT_NOT_FOUND", "That scenario run doesn't exist."));
        if ("completed".equals(row[3])) return read(row[4], Result.class);
        if (row[2] == null) throw new ApiProblem(HttpStatus.CONFLICT, "SCENARIO_NOT_OVER", "Finish the scenario first.");
        JsonNode s = scenario(row[0]);
        ArrayNode choices = (ArrayNode) read(row[1], JsonNode.class);
        JsonNode endingNode = s.path("endings").path(row[2]);
        String outcome = endingNode.path("outcome").asText("safe");

        double recognition = 0;
        double decisions = 0;
        int unsafe = 0;
        double escalation = 0;
        List<Mistake> mistakes = new ArrayList<>();
        for (JsonNode c : choices) {
            String q = c.path("quality").asText();
            decisions += QUALITY.getOrDefault(q, 0.0);
            if (q.equals("unsafe")) unsafe++;
            if (!q.equals("best")) mistakes.add(new Mistake(c.path("stage").asText(), c.path("label").asText(), c.path("feedback").asText()));
            if (c.path("stage").asText().equals("detection") && c.path("recognise").asBoolean()) {
                double t = c.path("elapsedMs").asDouble() / 1000.0;
                double window = Math.max(4, c.path("timerS").asInt(12));
                recognition = clamp01(1 - Math.max(0, t - 3) / (window - 3));
            }
            if (c.path("escalate").asBoolean()) escalation = Math.max(escalation, q.equals("best") ? 1 : q.equals("ok") ? 0.8 : 0.6);
        }
        decisions = choices.isEmpty() ? 0 : decisions / choices.size();
        double awareness = clamp01(1 - 0.35 * unsafe);
        double result = outcome.equals("safe") ? 1 : 0.2;
        List<Dimension> dims = List.of(
                new Dimension("recognition", "Recognising the danger", pct(recognition), 15),
                new Dimension("decisions", "Correct decisions", pct(decisions), 30),
                new Dimension("awareness", "Safety awareness", pct(awareness), 20),
                new Dimension("escalation", "Calling for help", pct(escalation), 15),
                new Dimension("outcome", "Final outcome", pct(result), 20));
        int score = (int) Math.round(dims.stream().mapToDouble(d -> d.score() * d.weight()).sum() / 100.0);

        RewardResult reward = rewards.awardVerified(u, new ProgressEvent("scenario:" + id, "scenario.completed", Instant.now(), "safety", s.path("id").asText(), id.toString(), score));
        List<String> learn = new ArrayList<>();
        s.path("learn").forEach(n -> learn.add(n.asText()));
        List<String> sources = new ArrayList<>();
        s.path("sources").forEach(n -> sources.add(n.asText()));
        Result r = new Result(score, dims, mistakes, learn, sources, Map.of("id", row[2], "outcome", outcome, "text", endingNode.path("text").asText()),
                s.path("disclaimer").asText(), s.path("quizId").asText(), score >= 80, reward);
        try {
            db.sql("UPDATE emergency_attempts SET status = 'completed', score = ?, result = ?::jsonb, finished_at = now() WHERE id = ?").params(score, mapper.writeValueAsString(r), id).update();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return r;
    }

    private static int pct(double x) {
        return (int) Math.round(clamp01(x) * 100);
    }

    private static double clamp(double x) {
        return Math.max(0, Math.min(100, x));
    }

    private static double clamp01(double x) {
        return Math.max(0, Math.min(1, x));
    }

    private <T> T read(String json, Class<T> type) {
        try {
            return mapper.readValue(json, type);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
