package com.labscape.api.intelligence.playground;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labscape.api.common.ApiProblem;
import com.labscape.api.core.billing.Entitlements;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
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
 * Playground sessions (build plan 4.9): every sandbox visit is a session, so learners can reopen
 * what they built, and the free plan's playground.sessionsPerDay limit is enforced here.
 */
@RestController
public class PlaygroundSessionsController {

    static final Set<String> MODES = Set.of("chemistry", "circuits", "motion", "graphing");
    static final int MAX_SNAPSHOT_CHARS = 64_000;

    public record StartRequest(String mode, UUID resume) {}

    public record Started(String id, String mode, JsonNode snapshot, Usage usage) {}

    public record Usage(int usedToday, Integer limit) {}

    public record SaveRequest(String title, JsonNode snapshot) {}

    public record Item(String id, String mode, String title, String startedAt, String updatedAt, boolean hasSnapshot) {}

    public record History(List<Item> sessions, Usage usage) {}

    private record Row(String mode, String snapshot, boolean today) {}

    private final JdbcClient db;
    private final ObjectMapper mapper;
    private final Entitlements entitlements;

    public PlaygroundSessionsController(JdbcClient db, ObjectMapper mapper, Entitlements entitlements) {
        this.db = db;
        this.mapper = mapper;
        this.entitlements = entitlements;
    }

    private Usage usage(UUID u) {
        int used = db.sql("SELECT count(*) FROM playground_sessions WHERE user_id = ? AND started_at >= date_trunc('day', now())").param(u).query(Integer.class).single();
        return new Usage(used, entitlements.limit(u, "playground.sessionsPerDay"));
    }

    private static final String ITEM_SQL = "SELECT id, mode, title, started_at, updated_at, snapshot IS NOT NULL FROM playground_sessions ";

    private static Item item(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Item(rs.getString(1), rs.getString(2), rs.getString(3), rs.getObject(4, OffsetDateTime.class).toString(),
                rs.getObject(5, OffsetDateTime.class).toString(), rs.getBoolean(6));
    }

    @GetMapping("/v1/playground/sessions")
    public History history(@AuthenticationPrincipal Jwt jwt) {
        UUID u = UUID.fromString(jwt.getSubject());
        List<Item> items = db.sql(ITEM_SQL + "WHERE user_id = ? ORDER BY updated_at DESC LIMIT 30").param(u).query((rs, i) -> item(rs)).list();
        return new History(items, usage(u));
    }

    /**
     * Opens a session. Resuming one of today's sessions does not count again; anything new past the
     * daily limit is refused with 402 so the client can offer Premium.
     */
    @PostMapping("/v1/playground/sessions")
    public Started start(@AuthenticationPrincipal Jwt jwt, @RequestBody StartRequest req) {
        UUID u = UUID.fromString(jwt.getSubject());
        if (req.mode() == null || !MODES.contains(req.mode())) throw ApiProblem.badRequest("BAD_MODE", "Unknown playground mode.");
        if (req.resume() != null) {
            Row row = db.sql("SELECT mode, snapshot::text, started_at >= date_trunc('day', now()) FROM playground_sessions WHERE id = ? AND user_id = ?")
                    .params(req.resume(), u).query((rs, i) -> new Row(rs.getString(1), rs.getString(2), rs.getBoolean(3))).optional()
                    .orElseThrow(() -> ApiProblem.notFound("SESSION_NOT_FOUND", "That playground session no longer exists."));
            if (!row.mode().equals(req.mode())) throw ApiProblem.badRequest("BAD_MODE", "That session belongs to a different playground.");
            if (row.today()) return new Started(req.resume().toString(), req.mode(), read(row.snapshot()), usage(u));
            // An older session reopens as a new one today, carrying its build over.
            return open(u, req.mode(), read(row.snapshot()));
        }
        return open(u, req.mode(), null);
    }

    private Started open(UUID u, String mode, JsonNode snapshot) {
        Usage before = usage(u);
        if (before.limit() != null && before.usedToday() >= before.limit())
            throw new ApiProblem(HttpStatus.PAYMENT_REQUIRED, "PLAYGROUND_LIMIT_REACHED",
                    "You have opened today's " + before.limit() + " free playground sessions. Premium makes them unlimited, or come back tomorrow.");
        UUID id = UUID.randomUUID();
        db.sql("INSERT INTO playground_sessions (id, user_id, mode, snapshot) VALUES (?, ?, ?, ?::jsonb)")
                .params(id, u, mode, snapshot == null ? null : snapshot.toString()).update();
        return new Started(id.toString(), mode, snapshot, new Usage(before.usedToday() + 1, before.limit()));
    }

    @PutMapping("/v1/playground/sessions/{id}")
    public Item save(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody SaveRequest req) {
        UUID u = UUID.fromString(jwt.getSubject());
        String snap = req.snapshot() == null || req.snapshot().isNull() ? null : req.snapshot().toString();
        if (snap != null && snap.length() > MAX_SNAPSHOT_CHARS) throw ApiProblem.badRequest("SNAPSHOT_TOO_LARGE", "That build is too big to save.");
        String title = req.title() == null ? null : req.title().strip();
        if (title != null && title.length() > 80) title = title.substring(0, 80);
        int n = db.sql("UPDATE playground_sessions SET snapshot = COALESCE(?::jsonb, snapshot), title = COALESCE(?, title), updated_at = now() WHERE id = ? AND user_id = ?")
                .params(snap, title, id, u).update();
        if (n == 0) throw ApiProblem.notFound("SESSION_NOT_FOUND", "That playground session no longer exists.");
        return db.sql(ITEM_SQL + "WHERE id = ?").param(id).query((rs, i) -> item(rs)).single();
    }

    private JsonNode read(String json) {
        if (json == null) return null;
        try {
            return mapper.readTree(json);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
