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
import java.io.UncheckedIOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
 * Emergency simulator (build plan 4.3). Scenarios are reviewed JSON; each choice is resolved here
 * (feedback, hazard change, next scene) and the run is scored on: time to recognise the danger,
 * decision quality, safety awareness, appropriate escalation and the outcome.
 */
@RestController
public class EmergencyController {

    public record Card(String slug, String title, String summary, String kind, int minutes, boolean free, boolean locked, Integer bestScore, String reviewStatus) {}

    /** A hands-on way to make a choice: use {@code tool} on the {@code target} hotspot of the scene. */
    public record Action(String choiceId, String tool, String target) {}

    /**
     * What the client may see of a scene. {@code props} is the persistent state of the illustrated room (towel on the
     * regulator, power off...), {@code actions} map (tool, target) pairs to choices. Neither reveals which choice is right.
     */
    public record SceneView(String id, String stage, int timerS, double growth, double hazard, String narration, String prompt, List<String> props,
            List<Map<String, String>> choices, List<Action> actions) {}

    /** {@code tools} (the tray) and {@code hotspots} (targets in the 640x360 room) are the scenario's interaction layout. */
    public record Started(String attemptId, String title, String kind, String disclaimer, SceneView scene, JsonNode tools, JsonNode hotspots) {}

    public record ChooseRequest(String choiceId, long elapsedMs) {}

    /** {@code anim} is the consequence animation the scene plays for this choice (only revealed once chosen). */
    public record Chosen(String quality, boolean safe, String feedback, double hazard, SceneView next, Map<String, String> ending, String anim) {}

    public record Dimension(String id, String label, int score, int weight) {}

    public record Mistake(String stage, String choice, String feedback) {}

    /**
     * One step of the run for the debrief replay: what was done, how it rated, the safer alternative when it wasn't the best,
     * and how many hint rungs were taken in that scene.
     */
    public record Step(String scene, String stage, String choice, String label, String quality, String feedback, String better, double hazard, String anim,
            List<String> props, String tool, String target, int hints) {}

    /** {@code hintsUsed} is the number of hint rungs taken over the run; {@code hintPenalty} the points they cost. */
    public record Result(int score, List<Dimension> breakdown, List<Mistake> mistakes, List<String> learn, List<String> sources, Map<String, String> ending,
            String disclaimer, String quizId, boolean badgeEligible, RewardResult reward, List<Step> steps, int hintsUsed, int hintPenalty) {}

    public record HintRequest(Integer rung) {}

    /**
     * One rung of a scene's hint ladder: 1 a nudge about what matters, 2 where to look ({@code target}), 3 what to do
     * ({@code tool} on {@code target}). {@code sceneRungs} is how many rungs this scene has used, {@code penalty} the run's total cost so far.
     */
    public record Hint(String scene, int rung, int rungs, String text, String tool, String target, int cost, int sceneRungs, int penalty) {}

    static final Map<String, Double> QUALITY = Map.of("best", 1.0, "ok", 0.7, "poor", 0.3, "unsafe", 0.0);

    /** Points each hint rung costs at the end of the run (it's training: a small nudge, not a punishment). */
    public static final int HINT_COST = 5;

    /** Hints can cost at most this much in a run: a learner who needed every hint but kept everyone safe still passes. */
    public static final int HINT_CAP = 40;

    static int hintPenalty(int rungs) {
        return Math.min(HINT_CAP, rungs * HINT_COST);
    }

    private final Map<String, JsonNode> scenarios = new LinkedHashMap<>();
    private final JdbcClient db;
    private final ObjectMapper mapper;
    private final Rewards rewards;
    private final Entitlements entitlements;

    public EmergencyController(JdbcClient db, ObjectMapper mapper, Rewards rewards, Entitlements entitlements, Scenarios library) {
        this.db = db;
        this.mapper = mapper;
        this.rewards = rewards;
        this.entitlements = entitlements;
        library.all().forEach(s -> scenarios.put(s.path("slug").asText(), s));
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
        return Scenarios.scene(s, id);
    }

    /** What the client may see of a scene: no qualities, feedback, animations, destinations or hints. */
    private static SceneView view(JsonNode sc, double hazard) {
        List<Map<String, String>> choices = new ArrayList<>();
        List<Action> actions = new ArrayList<>();
        sc.path("choices").forEach(c -> {
            choices.add(Map.of("id", c.path("id").asText(), "label", c.path("label").asText()));
            actionsOf(c).forEach(a -> actions.add(new Action(c.path("id").asText(), a.path("tool").asText(), a.path("target").asText())));
        });
        return new SceneView(sc.path("id").asText(), sc.path("stage").asText(), sc.path("timerS").asInt(15), sc.path("growth").asDouble(1), hazard,
                sc.path("narration").asText(), sc.path("prompt").asText(""), strings(sc.path("props")), choices, actions);
    }

    /** A choice's hands-on actions: {@code "action": {...}} or {@code "actions": [...]}. */
    private static List<JsonNode> actionsOf(JsonNode choice) {
        return Scenarios.actionsOf(choice);
    }

    private static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.asText()));
        return out;
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
        return new Started(id.toString(), s.path("title").asText(), s.path("kind").asText(), s.path("disclaimer").asText(), view(first, hazard), s.path("tools"), s.path("hotspots"));
    }

    @PostMapping("/v1/emergency/attempts/{id}/choose")
    @Transactional
    public Chosen choose(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody ChooseRequest req) {
        UUID u = user(jwt);
        var row = db.sql("SELECT scenario, scene, hazard, status, hints::text FROM emergency_attempts WHERE id = ? AND user_id = ? FOR UPDATE").params(id, u)
                .query((rs, i) -> new Object[] {rs.getString(1), rs.getString(2), rs.getDouble(3), rs.getString(4), rs.getString(5)})
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
                .put("timerS", sc.path("timerS").asInt(15)).put("recognise", choice.path("recognise").asBoolean()).put("escalate", choice.path("escalate").asBoolean())
                .put("anim", choice.path("anim").asText("none")).put("hazard", hazard)
                .put("hints", read((String) row[4], JsonNode.class).path(sc.path("id").asText()).asInt(0));
        record.set("props", sc.path("props").isArray() ? sc.path("props").deepCopy() : mapper.createArrayNode());
        List<JsonNode> acts = actionsOf(choice);
        if (!acts.isEmpty()) record.put("tool", acts.get(0).path("tool").asText()).put("target", acts.get(0).path("target").asText());

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
        return new Chosen(q, !q.equals("unsafe"), choice.path("feedback").asText(), hazard, nextView, ending, choice.path("anim").asText("none"));
    }

    /**
     * The next rung of the current scene's hint ladder (or a rung already taken, which is free to see again). Rungs can't be
     * skipped. The timer is the client's business (it pauses while a hint is open); the cost is recorded here.
     */
    @PostMapping("/v1/emergency/attempts/{id}/hint")
    @Transactional
    public Hint hint(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody(required = false) HintRequest req) {
        UUID u = user(jwt);
        var row = db.sql("SELECT scenario, scene, status, hints::text FROM emergency_attempts WHERE id = ? AND user_id = ? FOR UPDATE").params(id, u)
                .query((rs, i) -> new String[] {rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4)})
                .optional().orElseThrow(() -> ApiProblem.notFound("ATTEMPT_NOT_FOUND", "That scenario run doesn't exist."));
        if (!"in_progress".equals(row[2]) || row[1] == null) throw new ApiProblem(HttpStatus.CONFLICT, "SCENARIO_OVER", "This scenario has ended.");
        JsonNode sc = scene(scenario(row[0]), row[1]);
        JsonNode ladder = sc.path("hints");
        if (!ladder.isArray() || ladder.isEmpty()) throw ApiProblem.notFound("NO_HINTS", "There are no hints for this part.");
        JsonNode taken = read(row[3], JsonNode.class);
        int had = taken.path(row[1]).asInt(0);
        int want = req == null || req.rung() == null ? had + 1 : req.rung();
        int rung = Math.max(1, Math.min(Math.min(had + 1, ladder.size()), want));
        if (rung > had) db.sql("UPDATE emergency_attempts SET hints = hints || jsonb_build_object(?::text, ?::int) WHERE id = ?").params(row[1], rung, id).update();
        int total = 0;
        for (var it = taken.fields(); it.hasNext(); ) {
            var e = it.next();
            if (!e.getKey().equals(row[1])) total += e.getValue().asInt();
        }
        int sceneRungs = Math.max(had, rung);
        total += sceneRungs;
        JsonNode h = ladder.get(rung - 1);
        return new Hint(row[1], rung, ladder.size(), h.path("text").asText(), h.path("tool").asText(null), h.path("target").asText(null), rung > had && hintPenalty(total) > hintPenalty(total - 1) ? HINT_COST : 0,
                sceneRungs, hintPenalty(total));
    }

    @PostMapping("/v1/emergency/attempts/{id}/finish")
    @Transactional
    public Result finish(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        UUID u = user(jwt);
        var row = db.sql("SELECT scenario, choices::text, ending, status, result::text, hints::text FROM emergency_attempts WHERE id = ? AND user_id = ? FOR UPDATE").params(id, u)
                .query((rs, i) -> new String[] {rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6)})
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
        List<Step> steps = new ArrayList<>();
        for (JsonNode c : choices) {
            String q = c.path("quality").asText();
            String better = null;
            JsonNode sc = scene(s, c.path("scene").asText());
            if (!q.equals("best") && sc != null) for (JsonNode alt : sc.path("choices")) if (alt.path("quality").asText().equals("best")) {
                better = alt.path("label").asText();
                break;
            }
            steps.add(new Step(c.path("scene").asText(), c.path("stage").asText(), c.path("choice").asText(), c.path("label").asText(), q, c.path("feedback").asText(), better,
                    c.path("hazard").asDouble(), c.path("anim").asText("none"), strings(c.path("props")), c.path("tool").asText(null), c.path("target").asText(null),
                    c.path("hints").asInt(0)));
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
        // every hint rung taken costs a few points (recorded per scene when it was taken)
        int hintsUsed = 0;
        for (JsonNode n : read(row[5], JsonNode.class)) hintsUsed += n.asInt();
        int hintPenalty = hintPenalty(hintsUsed);
        int score = Math.max(0, (int) Math.round(dims.stream().mapToDouble(d -> d.score() * d.weight()).sum() / 100.0) - hintPenalty);

        RewardResult reward = rewards.awardVerified(u, new ProgressEvent("scenario:" + id, "scenario.completed", Instant.now(), "safety", s.path("id").asText(), id.toString(), score));
        List<String> learn = new ArrayList<>();
        s.path("learn").forEach(n -> learn.add(n.asText()));
        List<String> sources = new ArrayList<>();
        s.path("sources").forEach(n -> sources.add(n.asText()));
        Result r = new Result(score, dims, mistakes, learn, sources, Map.of("id", row[2], "outcome", outcome, "text", endingNode.path("text").asText()),
                s.path("disclaimer").asText(), s.path("quizId").asText(), score >= 80, reward, steps, hintsUsed, hintPenalty);
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
