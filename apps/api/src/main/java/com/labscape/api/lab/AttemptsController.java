package com.labscape.api.lab;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labscape.api.common.ApiProblem;
import com.labscape.api.contracts.ProgressEvent;
import com.labscape.api.contracts.RewardResult;
import com.labscape.api.core.auth.AuthProperties;
import com.labscape.api.core.library.LibraryCatalogue;
import com.labscape.api.core.rewards.Rewards;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Part 2 endpoints: experiments, attempts (append-only LabEvent log with autosave and resume),
 * server re-scoring on finish, signed reaction packs and sandbox simulation.
 */
@RestController
@RequestMapping("/v1")
public class AttemptsController {

    static final Set<String> STAGES = Set.of("intro", "demo", "try", "observe", "quiz", "done");
    static final int MAX_BATCH = 500;
    static final int MAX_EVENTS = 20_000;

    private final JdbcClient db;
    private final LabEngineRuntime engine;
    private final LibraryCatalogue catalogue;
    private final Rewards rewards;
    private final ObjectMapper mapper;
    private final byte[] packKey;
    /** How long finish waits for the replay before answering "scoring" and finishing in the background. */
    private final long scoreWaitMs;
    /** Replays still running (or finished but not yet collected), by attempt. */
    private final Map<UUID, CompletableFuture<FinishResult>> scoring = new ConcurrentHashMap<>();
    private final ExecutorService scorer = Executors.newFixedThreadPool(2, r -> {
        Thread t = new Thread(r, "attempt-scorer");
        t.setDaemon(true);
        return t;
    });

    public AttemptsController(JdbcClient db, LabEngineRuntime engine, LibraryCatalogue catalogue, Rewards rewards,
            ObjectMapper mapper, AuthProperties auth, @Value("${labscape.scoring.wait-ms:6000}") long scoreWaitMs) {
        this.scoreWaitMs = scoreWaitMs;
        this.db = db;
        this.engine = engine;
        this.catalogue = catalogue;
        this.rewards = rewards;
        this.mapper = mapper;
        this.packKey = ("pack:" + auth.jwtSecret()).getBytes(StandardCharsets.UTF_8);
    }

    /* ------------------------------------------------------------------ experiments */

    public record AttemptSummary(UUID id, String status, String stage, Integer score, Integer stars, Instant updatedAt, int events) {}

    public record ExperimentView(JsonNode content, LibraryCatalogue.Experiment card, String engineVersion, AttemptSummary latest,
            Integer bestScore) {}

    @GetMapping("/experiments/{slug}")
    public ExperimentView experiment(@AuthenticationPrincipal Jwt jwt, @PathVariable String slug) {
        JsonNode content = engine.content(slug)
                .orElseThrow(() -> ApiProblem.notFound("EXPERIMENT_NOT_FOUND", "That experiment isn't on the bench yet."));
        LibraryCatalogue.Experiment card = catalogue.bySlug(slug).orElse(null);
        AttemptSummary latest = null;
        Integer best = null;
        if (jwt != null) {
            UUID user = UUID.fromString(jwt.getSubject());
            latest = db.sql("""
                    SELECT a.id, a.status, a.stage, a.score, a.stars, a.updated_at,
                           (SELECT count(*) FROM lab_events e WHERE e.attempt_id = a.id) AS n
                      FROM experiment_attempts a WHERE a.user_id = ? AND a.experiment_slug = ?
                     ORDER BY a.updated_at DESC LIMIT 1
                    """)
                    .params(user, slug)
                    .query((rs, i) -> new AttemptSummary(rs.getObject("id", UUID.class), rs.getString("status"), rs.getString("stage"),
                            (Integer) rs.getObject("score"), (Integer) rs.getObject("stars"), rs.getTimestamp("updated_at").toInstant(), rs.getInt("n")))
                    .optional().orElse(null);
            best = db.sql("SELECT max(score) FROM experiment_attempts WHERE user_id = ? AND experiment_slug = ? AND status = 'completed'")
                    .params(user, slug).query(Integer.class).optional().orElse(null);
        }
        return new ExperimentView(content, card, engine.engineVersion(), latest, best);
    }

    /** A reaction pack: the content the client steps every frame, signed so tampering is detectable. */
    @GetMapping("/chem/packs/{slug}")
    public Map<String, Object> pack(@PathVariable String slug) {
        JsonNode content = engine.content(slug)
                .orElseThrow(() -> ApiProblem.notFound("EXPERIMENT_NOT_FOUND", "No reaction pack for that experiment."));
        String body = content.toString();
        return Map.of("engineVersion", engine.engineVersion(), "slug", slug, "content", content,
                "signature", hmac(engine.engineVersion() + "\n" + body));
    }

    public record SimulateRequest(JsonNode bench, JsonNode events, Long tailMs) {}

    @PostMapping("/chem/simulate")
    public JsonNode simulate(@RequestBody SimulateRequest req) {
        if (req.bench() == null || !req.bench().has("items")) throw ApiProblem.badRequest("BENCH_REQUIRED", "Send a bench with items.");
        if (req.bench().get("items").size() > 40) throw ApiProblem.badRequest("BENCH_TOO_BIG", "At most 40 items on a bench.");
        JsonNode events = req.events() == null ? mapper.createArrayNode() : req.events();
        if (events.size() > 2000) throw ApiProblem.badRequest("TOO_MANY_EVENTS", "At most 2000 events per simulation.");
        long tail = Math.max(0, Math.min(req.tailMs() == null ? 0 : req.tailMs(), 3_600_000));
        try {
            return engine.simulate(req.bench().toString(), events.toString(), tail);
        } catch (RuntimeException e) {
            throw ApiProblem.badRequest("SIMULATION_FAILED", "The bench could not be simulated: " + e.getMessage());
        }
    }

    /* ------------------------------------------------------------------ attempts */

    public record StartRequest(String experimentSlug, Boolean fresh) {}

    public record AttemptView(UUID id, String experimentSlug, int experimentVersion, String engineVersion, String status,
            String stage, Instant startedAt, Integer score, Integer stars, JsonNode report, ArrayNode events) {}

    @PostMapping("/attempts")
    @Transactional
    public AttemptView start(@AuthenticationPrincipal Jwt jwt, @RequestBody StartRequest req) {
        UUID user = UUID.fromString(jwt.getSubject());
        if (req.experimentSlug() == null || req.experimentSlug().isBlank())
            throw ApiProblem.badRequest("EXPERIMENT_REQUIRED", "Say which experiment to start (experimentSlug).");
        JsonNode content = engine.content(req.experimentSlug())
                .orElseThrow(() -> ApiProblem.notFound("EXPERIMENT_NOT_FOUND", "That experiment isn't on the bench yet."));
        if (!Boolean.TRUE.equals(req.fresh())) {
            UUID existing = db.sql("""
                    SELECT id FROM experiment_attempts WHERE user_id = ? AND experiment_slug = ? AND status = 'in_progress'
                     ORDER BY updated_at DESC LIMIT 1
                    """).params(user, req.experimentSlug()).query(UUID.class).optional().orElse(null);
            if (existing != null) return view(user, existing);
        } else {
            db.sql("UPDATE experiment_attempts SET status = 'abandoned', updated_at = now() WHERE user_id = ? AND experiment_slug = ? AND status = 'in_progress'")
                    .params(user, req.experimentSlug()).update();
        }
        UUID id = UUID.randomUUID();
        db.sql("INSERT INTO experiment_attempts (id, user_id, experiment_slug, experiment_version, engine_version) VALUES (?, ?, ?, ?, ?)")
                .params(id, user, req.experimentSlug(), content.path("version").asInt(1), engine.engineVersion())
                .update();
        return view(user, id);
    }

    @GetMapping("/attempts/{id}")
    public AttemptView get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return view(UUID.fromString(jwt.getSubject()), id);
    }

    public record EventsRequest(ArrayNode events, String stage) {}

    /** Autosave: the client sends event batches (500 ms debounce). Re-sent events are ignored. */
    @PostMapping("/attempts/{id}/events")
    @Transactional
    public Map<String, Object> append(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody EventsRequest req) {
        UUID user = UUID.fromString(jwt.getSubject());
        String status = owned(user, id);
        if (!status.equals("in_progress")) throw ApiProblem.conflict("ATTEMPT_CLOSED", "This attempt is already finished.");
        ArrayNode events = req.events() == null ? mapper.createArrayNode() : req.events();
        if (events.size() > MAX_BATCH) throw ApiProblem.badRequest("BATCH_TOO_BIG", "Send at most 500 events at a time.");
        int total = db.sql("SELECT count(*) FROM lab_events WHERE attempt_id = ?").param(id).query(Integer.class).single();
        if (total + events.size() > MAX_EVENTS) throw ApiProblem.badRequest("ATTEMPT_TOO_LONG", "This attempt has too many events.");
        int inserted = 0;
        for (JsonNode e : events) {
            int seq = e.path("seq").asInt(-1);
            String type = e.path("type").asText("");
            if (seq < 1 || type.isBlank() || !e.has("payload")) throw ApiProblem.badRequest("EVENT_INVALID", "Every event needs seq, type and payload.");
            String actor = e.path("actor").asText("user");
            if (!Set.of("user", "demo", "system").contains(actor)) actor = "user";
            inserted += db.sql("""
                    INSERT INTO lab_events (attempt_id, seq, id, t, actor, type, payload, state_hash)
                    VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?) ON CONFLICT (attempt_id, seq) DO NOTHING
                    """)
                    .params(id, seq, e.path("id").asText("e" + seq), e.path("t").asLong(0), actor, type,
                            e.get("payload").toString(), e.hasNonNull("stateHash") ? e.get("stateHash").asText() : null)
                    .update();
        }
        if (req.stage() != null && STAGES.contains(req.stage())) {
            db.sql("UPDATE experiment_attempts SET stage = ?, updated_at = now() WHERE id = ?").params(req.stage(), id).update();
        } else {
            db.sql("UPDATE experiment_attempts SET updated_at = now() WHERE id = ?").param(id).update();
        }
        Integer last = db.sql("SELECT max(seq) FROM lab_events WHERE attempt_id = ?").param(id).query(Integer.class).optional().orElse(0);
        return Map.of("inserted", inserted, "lastSeq", last == null ? 0 : last, "savedAt", Instant.now().toString());
    }

    public record RestartRequest(Integer keepThroughSeq) {}

    /** Restart from a step: rewinds the event log to that point. */
    @PostMapping("/attempts/{id}/restart")
    @Transactional
    public AttemptView restart(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody RestartRequest req) {
        UUID user = UUID.fromString(jwt.getSubject());
        owned(user, id);
        int keep = req.keepThroughSeq() == null ? 0 : Math.max(0, req.keepThroughSeq());
        db.sql("DELETE FROM lab_events WHERE attempt_id = ? AND seq > ?").params(id, keep).update();
        db.sql("UPDATE experiment_attempts SET status = 'in_progress', stage = 'try', score = NULL, stars = NULL, report = NULL, completed_at = NULL, updated_at = now() WHERE id = ?")
                .param(id).update();
        return view(user, id);
    }

    public record FinishRequest(String clientHash, Long tailMs) {}

    public record FinishResult(JsonNode report, String serverHash, Boolean hashMatches, String status, RewardResult reward) {}

    /**
     * The server replays the whole log with the same engine, scores it, and only then awards XP.
     * The client's own score is never trusted. Long runs (hours of simulated waiting) can take a
     * while to replay, so after a short wait this answers status "scoring" and the replay carries on
     * in the background; GET /attempts/{id}/result then returns the verified result.
     */
    @PostMapping("/attempts/{id}/finish")
    public FinishResult finish(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody FinishRequest req) {
        UUID user = UUID.fromString(jwt.getSubject());
        String status = owned(user, id);
        String slug = db.sql("SELECT experiment_slug FROM experiment_attempts WHERE id = ?").param(id).query(String.class).single();
        ArrayNode events = events(id);
        long tail = Math.max(0, Math.min(req.tailMs() == null ? 1000 : req.tailMs(), 60_000));
        CompletableFuture<FinishResult> job = CompletableFuture.supplyAsync(() -> score(user, id, status, slug, events, tail, req.clientHash()), scorer);
        scoring.put(id, job);
        try {
            FinishResult r = job.get(scoreWaitMs, TimeUnit.MILLISECONDS);
            scoring.remove(id, job);
            return r;
        } catch (TimeoutException e) {
            return new FinishResult(null, null, null, "scoring", null);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw ApiProblem.conflict("SCORING_INTERRUPTED", "Scoring was interrupted. Try again.");
        } catch (java.util.concurrent.ExecutionException e) {
            scoring.remove(id, job);
            throw e.getCause() instanceof RuntimeException re ? re : new IllegalStateException(e.getCause());
        }
    }

    /** The verified result of a finish that was still replaying ("scoring"), once it is ready. */
    @GetMapping("/attempts/{id}/result")
    public FinishResult result(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        owned(UUID.fromString(jwt.getSubject()), id);
        CompletableFuture<FinishResult> job = scoring.get(id);
        if (job == null) throw ApiProblem.notFound("NO_SCORING", "There is no scoring in progress for this attempt.");
        if (!job.isDone()) return new FinishResult(null, null, null, "scoring", null);
        try {
            return job.join();
        } catch (java.util.concurrent.CompletionException e) {
            scoring.remove(id, job);
            throw e.getCause() instanceof RuntimeException re ? re : new IllegalStateException(e.getCause());
        }
    }

    private FinishResult score(UUID user, UUID id, String status, String slug, ArrayNode events, long tail, String clientHash) {
        JsonNode result = engine.score(slug, events.toString(), tail);
        JsonNode report = result.get("report");
        String serverHash = result.path("hash").asText();
        boolean completed = report.path("completed").asBoolean(false);
        boolean safety = report.path("stoppedForSafety").asBoolean(false);
        String next = completed ? "completed" : safety ? "safety_stopped" : status;
        int score = report.path("score").asInt(0);
        int stars = report.path("stars").asInt(0);
        db.sql("""
                UPDATE experiment_attempts SET status = ?, score = ?, stars = ?, report = ?::jsonb, server_hash = ?, client_hash = ?,
                       completed_at = CASE WHEN ? THEN now() ELSE completed_at END, stage = CASE WHEN ? THEN 'observe' ELSE stage END,
                       updated_at = now()
                 WHERE id = ?
                """)
                .params(next, score, stars, report.toString(), serverHash, clientHash, completed, completed, id)
                .update();
        RewardResult reward = null;
        if (completed) {
            JsonNode content = engine.content(slug).orElseThrow();
            reward = rewards.awardVerified(user, new ProgressEvent("attempt:" + id, "experiment.completed", Instant.now(),
                    content.path("subject").asText("chemistry"), content.path("id").asText(slug), id.toString(), score));
        }
        Boolean matches = clientHash == null ? null : clientHash.equals(serverHash);
        return new FinishResult(report, serverHash, matches, next, reward);
    }

    @GetMapping("/attempts")
    public List<AttemptSummary> mine(@AuthenticationPrincipal Jwt jwt) {
        return db.sql("""
                SELECT a.id, a.status, a.stage, a.score, a.stars, a.updated_at, a.experiment_slug,
                       (SELECT count(*) FROM lab_events e WHERE e.attempt_id = a.id) AS n
                  FROM experiment_attempts a WHERE a.user_id = ? ORDER BY a.updated_at DESC LIMIT 50
                """)
                .param(UUID.fromString(jwt.getSubject()))
                .query((rs, i) -> new AttemptSummary(rs.getObject("id", UUID.class), rs.getString("status"), rs.getString("stage"),
                        (Integer) rs.getObject("score"), (Integer) rs.getObject("stars"), rs.getTimestamp("updated_at").toInstant(), rs.getInt("n")))
                .list();
    }

    /* ------------------------------------------------------------------ helpers */

    private String owned(UUID user, UUID id) {
        return db.sql("SELECT status FROM experiment_attempts WHERE id = ? AND user_id = ?").params(id, user)
                .query(String.class).optional()
                .orElseThrow(() -> ApiProblem.notFound("ATTEMPT_NOT_FOUND", "We couldn't find that attempt."));
    }

    private ArrayNode events(UUID id) {
        ArrayNode out = mapper.createArrayNode();
        db.sql("SELECT seq, id, t, actor, type, payload::text AS payload, state_hash FROM lab_events WHERE attempt_id = ? ORDER BY seq")
                .param(id)
                .query((rs, i) -> {
                    ObjectNode e = out.addObject();
                    e.put("attemptId", id.toString());
                    e.put("seq", rs.getInt("seq"));
                    e.put("id", rs.getString("id"));
                    e.put("t", rs.getLong("t"));
                    e.put("actor", rs.getString("actor"));
                    e.put("type", rs.getString("type"));
                    try {
                        e.set("payload", mapper.readTree(rs.getString("payload")));
                    } catch (Exception ex) {
                        e.putObject("payload");
                    }
                    if (rs.getString("state_hash") != null) e.put("stateHash", rs.getString("state_hash"));
                    return null;
                })
                .list();
        return out;
    }

    private AttemptView view(UUID user, UUID id) {
        owned(user, id);
        return db.sql("""
                SELECT id, experiment_slug, experiment_version, engine_version, status, stage, started_at, score, stars, report::text AS report
                  FROM experiment_attempts WHERE id = ?
                """)
                .param(id)
                .query((rs, i) -> {
                    JsonNode report = null;
                    try {
                        if (rs.getString("report") != null) report = mapper.readTree(rs.getString("report"));
                    } catch (Exception ignored) {
                        // a corrupt report is simply re-scored on the next finish
                    }
                    return new AttemptView(rs.getObject("id", UUID.class), rs.getString("experiment_slug"), rs.getInt("experiment_version"),
                            rs.getString("engine_version"), rs.getString("status"), rs.getString("stage"),
                            rs.getTimestamp("started_at").toInstant(), (Integer) rs.getObject("score"), (Integer) rs.getObject("stars"),
                            report, events(id));
                })
                .single();
    }

    private String hmac(String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(packKey, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

}
