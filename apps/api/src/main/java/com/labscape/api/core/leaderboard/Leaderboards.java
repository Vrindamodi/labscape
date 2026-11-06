package com.labscape.api.core.leaderboard;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.labscape.api.common.ApiProblem;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * Leaderboards (build plan 1.5): global, weekly (resets Monday 00:00 IST) and per subject.
 * Computed from xp_transactions; snapshotted weekly. Under-18 users appear by username only and anyone
 * can opt out. prevRank is the rank 24 hours ago, which drives the up and down arrows.
 * Friends and school scopes arrive with Community (Later).
 */
@Service
@RestController
public class Leaderboards {

    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    static final List<String> SCOPES = List.of("weekly", "global", "chemistry", "physics", "maths");

    public record Row(int rank, Integer prevRank, UUID userId, String name, String avatar, long xp, boolean me) {}

    public record Board(String scope, Instant periodStart, Instant resetsAt, List<Row> rows, Row me, int participants) {}

    private final JdbcClient db;
    private final ObjectMapper mapper;

    public Leaderboards(JdbcClient db, ObjectMapper mapper) {
        this.db = db;
        this.mapper = mapper;
    }

    @GetMapping("/v1/leaderboards/{scope}")
    public Board board(@AuthenticationPrincipal Jwt jwt, @PathVariable String scope) {
        if (!SCOPES.contains(scope)) throw ApiProblem.notFound("SCOPE_UNKNOWN", "That leaderboard doesn't exist yet.");
        UUID me = UUID.fromString(jwt.getSubject());
        Instant since = scope.equals("global") || SCOPES.indexOf(scope) > 1 ? Instant.EPOCH : weekStart();
        String subject = SCOPES.indexOf(scope) > 1 ? scope : null;
        List<Row> rows = rank(me, since, subject, 50);
        Row mine = rows.stream().filter(Row::me).findFirst().orElse(null);
        int participants = db.sql("SELECT count(DISTINCT x.user_id) FROM xp_transactions x JOIN users u ON u.id = x.user_id "
                        + "WHERE x.created_at >= ? AND (NOT u.is_guest OR u.id = ?) AND x.xp > 0 AND (CAST(? AS text) IS NULL OR x.subject = ?)")
                .params(Timestamp.from(since), me, subject, subject).query(Integer.class).single();
        Instant resets = scope.equals("weekly") ? weekStart().atZone(IST).plusWeeks(1).toInstant() : null;
        return new Board(scope, since.equals(Instant.EPOCH) ? null : since, resets,
                rows.stream().filter(r -> r.rank() <= 50).toList(), mine, participants);
    }

    List<Row> rank(UUID me, Instant since, String subject, int top) {
        return db.sql("""
                WITH s AS (
                  SELECT u.id, u.username, u.display_name, u.age_band, p.avatar::text AS avatar,
                         SUM(x.xp) AS xp,
                         SUM(x.xp) FILTER (WHERE x.created_at < now() - interval '1 day') AS xp_prev
                    FROM users u
                    JOIN user_profiles p ON p.user_id = u.id
                    JOIN xp_transactions x ON x.user_id = u.id AND x.created_at >= :since
                         AND (CAST(:subject AS text) IS NULL OR x.subject = :subject)
                   WHERE NOT u.disabled AND (u.id = :me OR (NOT u.is_guest AND NOT p.leaderboard_opt_out))
                   GROUP BY u.id, p.avatar
                ), r AS (
                  SELECT *, RANK() OVER (ORDER BY xp DESC, username) AS rank,
                         CASE WHEN COALESCE(xp_prev, 0) > 0 THEN RANK() OVER (ORDER BY COALESCE(xp_prev, 0) DESC, username) END AS prev_rank
                    FROM s WHERE xp > 0 OR id = :me
                )
                SELECT * FROM r WHERE rank <= :top OR id = :me ORDER BY rank
                """)
                .param("since", Timestamp.from(since))
                .param("subject", subject)
                .param("me", me)
                .param("top", top)
                .query((rs, i) -> {
                    String band = rs.getString("age_band");
                    boolean minor = "under_13".equals(band) || "13_17".equals(band);
                    UUID id = rs.getObject("id", UUID.class);
                    return new Row(rs.getInt("rank"), (Integer) rs.getObject("prev_rank"), id,
                            minor ? rs.getString("username") : rs.getString("display_name"), rs.getString("avatar"),
                            rs.getLong("xp"), id.equals(me));
                })
                .list();
    }

    static Instant weekStart() {
        return LocalDate.now(IST).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).atStartOfDay(IST).toInstant();
    }

    /** Monday 00:05 IST: archive last week's top 100 for every scope. */
    @Scheduled(cron = "0 5 0 * * MON", zone = "Asia/Kolkata")
    public void snapshotLastWeek() {
        LocalDate monday = LocalDate.now(IST).minusWeeks(1).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        Instant start = monday.atStartOfDay(IST).toInstant();
        for (String scope : SCOPES) {
            String subject = SCOPES.indexOf(scope) > 1 ? scope : null;
            List<Row> rows = rank(new UUID(0, 0), scope.equals("global") ? Instant.EPOCH : start, subject, 100);
            try {
                db.sql("INSERT INTO leaderboard_snapshots (scope, period_start, ranking) VALUES (?, ?, ?::jsonb) ON CONFLICT DO NOTHING")
                        .params(scope, Date.valueOf(monday), mapper.writeValueAsString(rows)).update();
            } catch (Exception ignored) {
                // a failed snapshot is retried next week; live boards are unaffected
            }
        }
    }
}
