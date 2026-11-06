package com.labscape.api.core.admin;

import com.labscape.api.common.ApiProblem;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Admin core (build plan 1.11, MVP): dashboard numbers plus users and roles. Every change is written
 * to admin_audit. The CMS and seven-stage review land with Part 2's experiment schema.
 */
@RestController
@RequestMapping("/v1/admin")
public class AdminController {

    static final Set<String> ROLES = Set.of("student", "teacher", "reviewer", "admin", "super_admin");

    private final JdbcClient db;

    public AdminController(JdbcClient db) {
        this.db = db;
    }

    public record DayCount(LocalDate day, int count) {}

    public record Stats(Map<String, Long> totals, List<DayCount> signups, List<DayCount> activeUsers,
            List<Map<String, Object>> topDiscoveries) {}

    @GetMapping("/stats")
    public Stats stats() {
        Map<String, Long> totals = new LinkedHashMap<>();
        db.sql("""
                SELECT (SELECT count(*) FROM users WHERE NOT is_guest) AS users,
                       (SELECT count(*) FROM users WHERE is_guest) AS guests,
                       (SELECT count(*) FROM users WHERE last_seen_at > now() - interval '7 days') AS active7d,
                       (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days' AND NOT is_guest) AS signups7d,
                       (SELECT COALESCE(SUM(xp), 0) FROM xp_transactions) AS xpAwarded,
                       (SELECT count(*) FROM xp_transactions WHERE kind = 'experiment.completed') AS experimentsCompleted,
                       (SELECT count(*) FROM xp_transactions WHERE kind = 'playground.discovery') AS playgroundDiscoveries,
                       (SELECT count(*) FROM subscriptions WHERE status IN ('active', 'grace') AND current_period_end > now()) AS activeSubscriptions,
                       (SELECT COALESCE(SUM(amount_paise), 0) FROM payments WHERE status = 'captured') AS revenuePaise,
                       (SELECT count(*) FROM safety_audit WHERE outcome = 'prohibited') AS safetyBlocks
                """)
                .query((rs, i) -> {
                    var md = rs.getMetaData();
                    for (int c = 1; c <= md.getColumnCount(); c++) totals.put(md.getColumnLabel(c), rs.getLong(c));
                    return null;
                })
                .list();
        List<DayCount> signups = series("SELECT created_at::date AS d, count(*) FROM users WHERE NOT is_guest AND created_at > now() - interval '14 days' GROUP BY 1");
        List<DayCount> active = series("SELECT created_at::date AS d, count(DISTINCT user_id) FROM xp_transactions WHERE created_at > now() - interval '14 days' GROUP BY 1");
        List<Map<String, Object>> top = db.sql("SELECT ref_id, count(*) AS n FROM xp_transactions WHERE kind = 'playground.discovery' GROUP BY ref_id ORDER BY n DESC LIMIT 8")
                .query((rs, i) -> Map.<String, Object>of("id", rs.getString(1), "count", rs.getInt(2))).list();
        return new Stats(totals, signups, active, top);
    }

    public record AdminUser(UUID id, String email, String username, String displayName, String role, boolean guest,
            boolean disabled, long totalXp, Instant createdAt, Instant lastSeenAt) {}

    @GetMapping("/users")
    public List<AdminUser> users(@RequestParam(required = false) String q) {
        String like = q == null || q.isBlank() ? "%" : "%" + q.trim().toLowerCase() + "%";
        return db.sql("""
                SELECT id, email, username, display_name, role, is_guest, disabled, total_xp, created_at, last_seen_at
                  FROM users
                 WHERE lower(COALESCE(email, '')) LIKE ? OR lower(username) LIKE ? OR lower(display_name) LIKE ?
                 ORDER BY is_guest, created_at DESC LIMIT 100
                """)
                .params(like, like, like)
                .query((rs, i) -> new AdminUser(rs.getObject("id", UUID.class), rs.getString("email"), rs.getString("username"),
                        rs.getString("display_name"), rs.getString("role"), rs.getBoolean("is_guest"), rs.getBoolean("disabled"),
                        rs.getLong("total_xp"), rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("last_seen_at").toInstant()))
                .list();
    }

    public record UserPatch(String role, Boolean disabled) {}

    @PatchMapping("/users/{id}")
    @Transactional
    public Map<String, Object> patch(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody UserPatch patch) {
        UUID actor = UUID.fromString(jwt.getSubject());
        if (actor.equals(id)) throw ApiProblem.forbidden("SELF_CHANGE", "You can't change your own role or status.");
        String actorRole = jwt.getClaimAsString("role");
        String targetRole = db.sql("SELECT role FROM users WHERE id = ?").param(id).query(String.class).optional()
                .orElseThrow(() -> ApiProblem.notFound("USER_NOT_FOUND", "No such user."));
        boolean touchesAdmins = Set.of("admin", "super_admin").contains(targetRole)
                || (patch.role() != null && Set.of("admin", "super_admin").contains(patch.role()));
        if (touchesAdmins && !"super_admin".equals(actorRole)) {
            throw ApiProblem.forbidden("SUPER_ADMIN_ONLY", "Only a super-admin can change admin accounts.");
        }
        if (patch.role() != null) {
            if (!ROLES.contains(patch.role())) throw ApiProblem.badRequest("ROLE_INVALID", "Unknown role.");
            db.sql("UPDATE users SET role = ? WHERE id = ?").params(patch.role(), id).update();
            audit(actor, "user.role", id, "{\"from\":\"" + targetRole + "\",\"to\":\"" + patch.role() + "\"}");
        }
        if (patch.disabled() != null) {
            db.sql("UPDATE users SET disabled = ? WHERE id = ?").params(patch.disabled(), id).update();
            audit(actor, patch.disabled() ? "user.disable" : "user.enable", id, "{}");
        }
        return Map.of("ok", true);
    }

    @GetMapping("/audit")
    public List<Map<String, Object>> audit() {
        return db.sql("""
                SELECT a.created_at, u.username AS actor, a.action, a.target, a.detail::text AS detail
                  FROM admin_audit a JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 100
                """)
                .query((rs, i) -> Map.<String, Object>of("at", rs.getTimestamp(1).toInstant(), "actor", rs.getString(2),
                        "action", rs.getString(3), "target", String.valueOf(rs.getString(4)), "detail", rs.getString(5)))
                .list();
    }

    private void audit(UUID actor, String action, UUID target, String detail) {
        db.sql("INSERT INTO admin_audit (actor_id, action, target, detail) VALUES (?, ?, ?, ?::jsonb)")
                .params(actor, action, target.toString(), detail).update();
    }

    private List<DayCount> series(String sql) {
        Map<LocalDate, Integer> m = new LinkedHashMap<>();
        for (int i = 13; i >= 0; i--) m.put(LocalDate.now().minusDays(i), 0);
        db.sql(sql).query((rs, i) -> m.put(rs.getDate(1).toLocalDate(), rs.getInt(2))).list();
        return m.entrySet().stream().map(e -> new DayCount(e.getKey(), e.getValue())).toList();
    }
}
