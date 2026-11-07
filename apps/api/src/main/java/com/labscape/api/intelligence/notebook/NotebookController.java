package com.labscape.api.intelligence.notebook;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labscape.api.common.ApiProblem;
import com.labscape.api.core.billing.Entitlements;
import com.labscape.api.core.library.LibraryCatalogue;
import com.labscape.api.lab.LabEngineRuntime;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Lab notebook, replay and report export (build plan 4.6, 4.7). The notebook is generated from an
 * attempt's LabEvents, its server report and its quiz; only the learner's notes and conclusion are
 * stored. Replay re-runs the event log through the engine and checks the state hash.
 */
@RestController
public class NotebookController {

    public record Action(long t, String time, String type, String text) {}

    public record Reading(long t, String instrument, String key, double value, String unit) {}

    public record Quiz(int scorePct, boolean passed, String title) {}

    public record Entry(String attemptId, String slug, String subject, String title, List<String> objectives, String date, List<String> equipment,
            List<String> materials, List<Action> actions, List<Reading> readings, String whatHappened, String why, String equationLatex,
            Integer score, Integer stars, JsonNode report, Quiz quiz, String notes, String conclusion, String suggestedConclusion, String status) {}

    public record Summary(String attemptId, String slug, String subject, String title, String date, Integer score, Integer stars, boolean hasNotes) {}

    public record Clip(String id, String text, String source, String createdAt) {}

    public record Index(List<Summary> entries, List<Clip> clips) {}

    public record Edit(String notes, String conclusion) {}

    public record ClipRequest(String text, String source, String attemptId) {}

    public record Replay(String attemptId, String slug, String subject, String title, JsonNode events, JsonNode report, String storedHash, String replayHash,
            Boolean hashMatches, String engineVersion) {}

    private final JdbcClient db;
    private final ObjectMapper mapper;
    private final LabEngineRuntime engine;
    private final LibraryCatalogue catalogue;
    private final Entitlements entitlements;

    public NotebookController(JdbcClient db, ObjectMapper mapper, LabEngineRuntime engine, LibraryCatalogue catalogue, Entitlements entitlements) {
        this.db = db;
        this.mapper = mapper;
        this.engine = engine;
        this.catalogue = catalogue;
        this.entitlements = entitlements;
    }

    private record Attempt(UUID id, String slug, String status, OffsetDateTime started, OffsetDateTime completed, Integer score, Integer stars, String report, String serverHash, String engineVersion) {}

    private Attempt attempt(UUID user, UUID id) {
        return db.sql("SELECT id, experiment_slug, status, started_at, completed_at, score, stars, report::text, server_hash, engine_version FROM experiment_attempts WHERE id = ? AND user_id = ?")
                .params(id, user)
                .query((rs, i) -> new Attempt(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getObject(4, OffsetDateTime.class), rs.getObject(5, OffsetDateTime.class),
                        (Integer) rs.getObject(6), (Integer) rs.getObject(7), rs.getString(8), rs.getString(9), rs.getString(10)))
                .optional().orElseThrow(() -> ApiProblem.notFound("ATTEMPT_NOT_FOUND", "No such attempt in your notebook."));
    }

    private JsonNode events(UUID attempt) {
        String json = db.sql("SELECT COALESCE(json_agg(json_build_object('id', id, 'attemptId', attempt_id, 'seq', seq, 't', t, 'actor', actor, 'type', type, 'payload', payload) ORDER BY seq), '[]')::text FROM lab_events WHERE attempt_id = ?")
                .param(attempt).query(String.class).single();
        return read(json);
    }

    @GetMapping("/v1/notebook")
    public Index index(@AuthenticationPrincipal Jwt jwt) {
        UUID u = UUID.fromString(jwt.getSubject());
        Map<UUID, Boolean> notes = new HashMap<>();
        db.sql("SELECT attempt_id, (length(notes) > 0 OR conclusion IS NOT NULL) FROM notebook_entries WHERE user_id = ?").param(u)
                .query((rs, i) -> Map.entry(rs.getObject(1, UUID.class), rs.getBoolean(2))).list().forEach(e -> notes.put(e.getKey(), e.getValue()));
        List<Summary> entries = db.sql("SELECT id, experiment_slug, completed_at, score, stars FROM experiment_attempts WHERE user_id = ? AND status IN ('completed', 'safety_stopped') ORDER BY completed_at DESC NULLS LAST LIMIT 100")
                .param(u)
                .query((rs, i) -> {
                    UUID id = rs.getObject(1, UUID.class);
                    String slug = rs.getString(2);
                    var exp = catalogue.bySlug(slug);
                    OffsetDateTime at = rs.getObject(3, OffsetDateTime.class);
                    return new Summary(id.toString(), slug, exp.map(LibraryCatalogue.Experiment::subject).orElse("chemistry"), exp.map(LibraryCatalogue.Experiment::title).orElse(slug),
                            at == null ? null : at.toString(), (Integer) rs.getObject(4), (Integer) rs.getObject(5), notes.getOrDefault(id, false));
                }).list();
        List<Clip> clips = db.sql("SELECT id, text, source, created_at::text FROM notebook_clips WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").param(u)
                .query((rs, i) -> new Clip(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4))).list();
        return new Index(entries, clips);
    }

    @GetMapping("/v1/notebook/{attemptId}")
    public Entry entry(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID attemptId) {
        UUID u = UUID.fromString(jwt.getSubject());
        return build(u, attempt(u, attemptId));
    }

    /** Report export (build plan 4.6): gated by the reports.export entitlement; the client prints it to PDF. */
    @GetMapping("/v1/reports/{attemptId}")
    public Entry report(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID attemptId) {
        UUID u = UUID.fromString(jwt.getSubject());
        if (!entitlements.bool(u, "reports.export"))
            throw new ApiProblem(HttpStatus.PAYMENT_REQUIRED, "EXPORT_PREMIUM", "PDF export of your notebook is part of LABscape Premium.");
        return build(u, attempt(u, attemptId));
    }

    @PutMapping("/v1/notebook/{attemptId}")
    public Entry save(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID attemptId, @RequestBody Edit e) {
        UUID u = UUID.fromString(jwt.getSubject());
        Attempt a = attempt(u, attemptId);
        String notes = e.notes() == null ? "" : e.notes();
        if (notes.length() > 20_000 || (e.conclusion() != null && e.conclusion().length() > 5_000)) throw ApiProblem.badRequest("TOO_LONG", "That's longer than a notebook page allows.");
        db.sql("""
                INSERT INTO notebook_entries (attempt_id, user_id, notes, conclusion, updated_at) VALUES (?, ?, ?, ?, now())
                ON CONFLICT (attempt_id) DO UPDATE SET notes = EXCLUDED.notes, conclusion = EXCLUDED.conclusion, updated_at = now()
                """).params(attemptId, u, notes, e.conclusion()).update();
        return build(u, a);
    }

    /** "Save to notebook" from the assistant: onto the attempt's page if given, otherwise into clips. */
    @PostMapping("/v1/notebook/clips")
    public Map<String, String> clip(@AuthenticationPrincipal Jwt jwt, @RequestBody ClipRequest r) {
        UUID u = UUID.fromString(jwt.getSubject());
        if (r.text() == null || r.text().isBlank() || r.text().length() > 8000) throw ApiProblem.badRequest("BAD_CLIP", "Nothing to save.");
        if (r.attemptId() != null) {
            try {
                UUID a = UUID.fromString(r.attemptId());
                attempt(u, a);
                db.sql("""
                        INSERT INTO notebook_entries (attempt_id, user_id, notes) VALUES (?, ?, ?)
                        ON CONFLICT (attempt_id) DO UPDATE SET notes = notebook_entries.notes || E'\\n\\n' || EXCLUDED.notes, updated_at = now()
                        """).params(a, u, "> " + r.text().replace("\n", "\n> ")).update();
                return Map.of("savedTo", "entry", "attemptId", a.toString());
            } catch (IllegalArgumentException | ApiProblem ignored) {
                // not an attempt of theirs: fall through to clips
            }
        }
        UUID id = UUID.randomUUID();
        db.sql("INSERT INTO notebook_clips (id, user_id, text, source) VALUES (?, ?, ?, ?)").params(id, u, r.text(), r.source()).update();
        return Map.of("savedTo", "clips", "id", id.toString());
    }

    /** Replay (build plan 4.7): the event log plus a fresh server re-run and its hash check. */
    /** The event log and stored report: instant, so the player can start straight away. */
    @GetMapping("/v1/replay/{attemptId}")
    public Replay replay(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID attemptId) {
        UUID u = UUID.fromString(jwt.getSubject());
        Attempt a = attempt(u, attemptId);
        var exp = catalogue.bySlug(a.slug());
        return new Replay(attemptId.toString(), a.slug(), exp.map(LibraryCatalogue.Experiment::subject).orElse("chemistry"), exp.map(LibraryCatalogue.Experiment::title).orElse(a.slug()),
                events(attemptId), a.report() == null ? null : read(a.report()), a.serverHash(), null, null, a.engineVersion());
    }

    public record Verification(String storedHash, String replayHash, Boolean hashMatches, String engineVersion) {}

    /**
     * Re-runs the whole event log through today's engine and compares the state hash with the one
     * stored at finish. Long reactions mean thousands of ticks, so results are cached per attempt.
     */
    @GetMapping("/v1/replay/{attemptId}/verify")
    public Verification verify(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID attemptId) {
        UUID u = UUID.fromString(jwt.getSubject());
        Attempt a = attempt(u, attemptId);
        String replayHash = verified.computeIfAbsent(attemptId, id -> engine.score(a.slug(), events(id).toString(), 1000).path("hash").asText(null));
        if (verified.size() > 2000) verified.clear();
        return new Verification(a.serverHash(), replayHash, a.serverHash() == null ? null : a.serverHash().equals(replayHash), a.engineVersion());
    }

    private final Map<UUID, String> verified = new java.util.concurrent.ConcurrentHashMap<>();

    /* ------------------------------------------------------------------ generation */

    private Entry build(UUID u, Attempt a) {
        JsonNode content = engine.content(a.slug()).orElseThrow(() -> ApiProblem.notFound("EXPERIMENT_NOT_FOUND", "That experiment is no longer available."));
        var exp = catalogue.bySlug(a.slug());
        Map<String, String> labels = new HashMap<>();
        content.path("bench").path("items").forEach(it -> labels.put(it.path("id").asText(), it.path("label").asText(it.path("kind").asText().replace('_', ' '))));
        content.path("setup").path("parts").forEach(p -> labels.put(p.path("id").asText(), p.path("kind").asText() + " " + p.path("id").asText()));
        List<Action> actions = new ArrayList<>();
        List<Reading> readings = new ArrayList<>();
        for (JsonNode e : events(a.id())) {
            String type = e.path("type").asText();
            JsonNode p = e.path("payload");
            long t = e.path("t").asLong();
            if (type.equals("measure.read")) {
                JsonNode r = p.path("reading");
                readings.add(new Reading(t, p.path("instrument").asText(), r.path("key").asText(), r.path("value").asDouble(), r.path("unit").asText()));
            }
            String text = describe(type, p, labels);
            if (text != null) actions.add(new Action(t, clock(t), type, text));
        }
        var notes = db.sql("SELECT notes, conclusion FROM notebook_entries WHERE attempt_id = ? AND user_id = ?").params(a.id(), u)
                .query((rs, i) -> new String[] {rs.getString(1), rs.getString(2)}).optional();
        Quiz quiz = db.sql("SELECT score_pct, passed, quiz_id FROM quiz_attempts WHERE experiment_attempt = ? AND user_id = ? AND status = 'submitted' ORDER BY submitted_at DESC LIMIT 1")
                .params(a.id(), u).query((rs, i) -> new Quiz(rs.getInt(1), rs.getBoolean(2), rs.getString(3))).optional().orElse(null);
        JsonNode o = content.path("observations");
        String why = o.path("why").asText(null);
        String suggested = why == null ? null : why.split("(?<=\\.)\\s", 2)[0];
        return new Entry(a.id().toString(), a.slug(), content.path("subject").asText("chemistry"), content.path("title").asText(a.slug()),
                exp.map(LibraryCatalogue.Experiment::objectives).orElse(List.of()), (a.completed() != null ? a.completed() : a.started()).toString(),
                exp.map(LibraryCatalogue.Experiment::equipment).orElse(List.of()), exp.map(LibraryCatalogue.Experiment::materials).orElse(List.of()),
                actions, readings, o.path("whatHappened").asText(null), why, o.path("equationLatex").asText(null), a.score(), a.stars(),
                a.report() == null ? null : read(a.report()), quiz, notes.map(n -> n[0]).orElse(""), notes.map(n -> n[1]).orElse(null), suggested, a.status());
    }

    static String clock(long ms) {
        long s = Math.max(0, ms / 1000);
        return String.format(Locale.ROOT, "%02d:%02d", s / 60, s % 60);
    }

    private static String num(JsonNode n, int dp) {
        return n.isMissingNode() || n.isNull() ? "?" : String.format(Locale.ROOT, "%." + dp + "f", n.asDouble());
    }

    /** One readable line per event, e.g. "Poured 10.0 mL from Hydrochloric acid into Conical flask (2.1 mL/s)". */
    static String describe(String type, JsonNode p, Map<String, String> labels) {
        java.util.function.Function<String, String> l = id -> labels.getOrDefault(id, id);
        return switch (type) {
            case "liquid.pour" -> "Poured " + num(p.path("volumeMl"), 1) + " mL from " + l.apply(p.path("from").asText()) + " into " + l.apply(p.path("to").asText()) + " (" + num(p.path("meanRateMlPerS"), 1) + " mL/s)";
            case "liquid.drop" -> "Added " + p.path("drops").asInt() + " drop" + (p.path("drops").asInt() == 1 ? "" : "s") + " (" + num(p.path("volumeMl"), 2) + " mL) from " + l.apply(p.path("from").asText()) + " to " + l.apply(p.path("to").asText());
            case "liquid.draw" -> "Drew " + num(p.path("volumeMl"), 2) + " mL from " + l.apply(p.path("from").asText()) + " into " + l.apply(p.path("into").asText());
            case "solid.add" -> "Added " + num(p.path("massG"), 2) + " g of " + l.apply(p.path("from").asText()) + " to " + l.apply(p.path("to").asText());
            case "mix.stir", "mix.swirl", "mix.shake" -> (type.endsWith("stir") ? "Stirred " : type.endsWith("swirl") ? "Swirled " : "Shook ") + l.apply(p.path("target").asText())
                    + " for " + String.format(Locale.ROOT, "%.1f", p.path("durationMs").asDouble() / 1000) + " s";
            case "heat.set" -> "Set the heat under " + l.apply(p.path("target").asText()) + " to " + p.path("powerPct").asInt() + "%";
            case "cool.set" -> "Cooled " + l.apply(p.path("target").asText()) + " (" + p.path("method").asText().replace('_', ' ') + ")";
            case "equipment.place" -> p.has("x") && p.path("equipmentId").asText().matches("P[1-4]") ? "Placed pin " + p.path("equipmentId").asText() + " at (" + num(p.path("x"), 1) + ", " + num(p.path("y"), 1) + ") mm" : "Placed " + l.apply(p.path("equipmentId").asText()) + (p.hasNonNull("socket") ? " in " + p.path("socket").asText() : "");
            case "equipment.pickup" -> "Picked up " + l.apply(p.path("equipmentId").asText());
            case "equipment.connect" -> ("remove".equals(p.path("port").asText()) ? "Disconnected " : "Connected ") + p.path("from").asText() + " to " + p.path("to").asText();
            case "param.set" -> {
                String key = p.path("key").asText();
                if (key.startsWith("answer:")) yield "Answered observation question " + key.substring(7);
                if (key.startsWith("result:")) yield "Recorded result " + key.substring(7) + " = " + p.path("value").asText();
                yield "Set " + key + " to " + p.path("value").asText();
            }
            case "measure.read" -> "Read " + p.path("instrument").asText() + ": " + p.path("reading").path("key").asText() + " = " + p.path("reading").path("value").asText() + " " + p.path("reading").path("unit").asText();
            case "timer.mark" -> "Marked: " + p.path("label").asText().replace('-', ' ');
            case "sim.start" -> "Started the run";
            case "sim.pause" -> "Paused";
            case "sim.reset" -> "Reset";
            case "hint.shown" -> "Used a hint (level " + p.path("rung").asInt() + ")";
            default -> null;
        };
    }

    private JsonNode read(String s) {
        try {
            return mapper.readTree(s);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
