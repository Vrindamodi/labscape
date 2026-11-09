package com.labscape.api.core.billing;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Contract 7 server side. The plan comes from the user's live subscription; every other part gates
 * features with {@link #bool} or {@link #limit} (the client hook only shapes the UI).
 * Free-tier numbers are open questions for playtests (build plan 1.7).
 */
@Service
public class Entitlements {

    // Playground sessions, the full library and every emergency scenario are open on every plan for now (null = no limit); set a number to bring the cap back.
    public static final Map<String, Object> FREE = values(false, true, null, true, 10, false, false, false);
    public static final Map<String, Object> PREMIUM = values(true, true, null, true, 200, true, true, true);

    public record View(String plan, Map<String, Object> values, Map<String, Object> usage,
            String status, Instant currentPeriodEnd, boolean cancelAtPeriodEnd) {}

    private final JdbcClient db;

    public Entitlements(JdbcClient db) {
        this.db = db;
    }

    record Live(String plan, String status, Instant periodEnd, boolean cancelAtEnd) {}

    Live live(UUID userId) {
        return db.sql("""
                SELECT plan, status, current_period_end, cancel_at_period_end FROM subscriptions
                 WHERE user_id = ? AND status IN ('active', 'grace', 'cancelled') AND current_period_end > now()
                 ORDER BY current_period_end DESC LIMIT 1
                """)
                .param(userId)
                .query((rs, i) -> new Live(rs.getString("plan"), rs.getString("status"),
                        rs.getTimestamp("current_period_end").toInstant(), rs.getBoolean("cancel_at_period_end")))
                .optional()
                .orElse(new Live("free", null, null, false));
    }

    public String plan(UUID userId) {
        return userId == null ? "free" : live(userId).plan();
    }

    public View view(UUID userId) {
        Live l = userId == null ? new Live("free", null, null, false) : live(userId);
        return new View(l.plan(), l.plan().equals("free") ? FREE : PREMIUM, Map.of(), l.status(), l.periodEnd(),
                l.cancelAtEnd());
    }

    public boolean bool(UUID userId, String key) {
        Object v = (plan(userId).equals("free") ? FREE : PREMIUM).get(key);
        return Boolean.TRUE.equals(v);
    }

    /** Numeric limit for a key; null means unlimited. */
    public Integer limit(UUID userId, String key) {
        Object v = (plan(userId).equals("free") ? FREE : PREMIUM).get(key);
        return v instanceof Integer i ? i : null;
    }

    private static Map<String, Object> values(boolean adsHidden, boolean libraryFull, Integer playground,
            boolean emergencyAll, Integer ai, boolean analytics, boolean export, boolean themes) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ads.hidden", adsHidden);
        m.put("library.full", libraryFull);
        m.put("playground.sessionsPerDay", playground);
        m.put("emergency.all", emergencyAll);
        m.put("ai.messagesPerDay", ai);
        m.put("analytics.detailed", analytics);
        m.put("reports.export", export);
        m.put("themes.exclusive", themes);
        return java.util.Collections.unmodifiableMap(m);
    }
}
