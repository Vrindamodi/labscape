package com.labscape.api.core.rewards;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labscape.api.common.ApiProblem;
import com.labscape.api.contracts.ProgressEvent;
import com.labscape.api.contracts.RewardResult;
import com.labscape.api.contracts.RewardResult.Adjustment;
import com.labscape.api.core.challenges.Challenges;
import com.labscape.api.core.library.LibraryCatalogue;
import com.labscape.api.core.notifications.Notifications;
import com.labscape.api.core.user.Users;
import com.labscape.api.core.user.Users.User;
import com.labscape.api.intelligence.chem.Discovery;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Contract 4: ProgressEvent in, RewardResult out. The server is authoritative for XP.
 *
 * <ul>
 *   <li>Idempotent: (user, idempotencyKey) is unique, so a replay returns duplicate=true and 0 XP.
 *   <li>Repeat rules and base values from build plan 1.5.
 *   <li>Anti-farming: a soft daily cap with diminishing returns and a human-rate limit.
 * </ul>
 */
@Service
public class Rewards {

    static final Set<String> KINDS = Set.of("experiment.completed", "quiz.completed", "challenge.completed",
            "scenario.completed", "concept.discovered", "chapter.completed", "playground.discovery",
            "molecular_view.opened", "onboarding.completed");

    private final JdbcClient db;
    private final Users users;
    private final Streaks streaks;
    private final Badges badges;
    private final Challenges challenges;
    private final Notifications notifications;
    private final LibraryCatalogue catalogue;
    private final ObjectMapper mapper;
    private final int dailySoftCap;
    private final int maxPerMinute;
    private final Map<String, Boolean> live;

    public Rewards(JdbcClient db, Users users, Streaks streaks, Badges badges, Challenges challenges,
            Notifications notifications, LibraryCatalogue catalogue, ObjectMapper mapper,
            @Value("${labscape.rewards.daily-soft-cap:1500}") int dailySoftCap,
            @Value("${labscape.rewards.max-events-per-minute:30}") int maxPerMinute,
            @Value("${labscape.features.experiments:false}") boolean experiments,
            @Value("${labscape.features.quizzes:false}") boolean quizzes,
            @Value("${labscape.features.scenarios:false}") boolean scenarios,
            @Value("${labscape.features.molecular-view:false}") boolean molecularView) {
        this.db = db;
        this.users = users;
        this.streaks = streaks;
        this.badges = badges;
        this.challenges = challenges;
        this.notifications = notifications;
        this.catalogue = catalogue;
        this.mapper = mapper;
        this.dailySoftCap = dailySoftCap;
        this.maxPerMinute = maxPerMinute;
        this.live = Map.of("experiment.completed", experiments, "chapter.completed", experiments,
                "quiz.completed", quizzes, "scenario.completed", scenarios, "molecular_view.opened", molecularView);
    }

    @Transactional
    public RewardResult award(UUID userId, ProgressEvent e) {
        validate(e);
        checkSource(e);
        return doAward(userId, e);
    }

    /**
     * For completions the server itself verified (e.g. an experiment attempt it replayed and scored).
     * Skips the client-facing source checks; idempotency and repeat rules still apply.
     */
    @Transactional
    public RewardResult awardVerified(UUID userId, ProgressEvent e) {
        validate(e);
        return doAward(userId, e);
    }

    private RewardResult doAward(UUID userId, ProgressEvent e) {
        User user = users.lock(userId); // serialises this user's awards
        LocalDate today = user.today();

        var previous = db.sql("SELECT xp FROM xp_transactions WHERE user_id = ? AND idempotency_key = ?")
                .params(userId, e.idempotencyKey()).query(Integer.class).optional();
        if (previous.isPresent()) {
            return new RewardResult(e.idempotencyKey(), true, 0, List.of(), user.totalXp(), Levels.of(user.totalXp()),
                    false, List.of(), streaks.summary(userId, today));
        }

        int recent = db.sql("SELECT count(*) FROM xp_transactions WHERE user_id = ? AND created_at > now() - interval '1 minute'")
                .param(userId).query(Integer.class).single();
        if (recent >= maxPerMinute) {
            throw new ApiProblem(HttpStatus.TOO_MANY_REQUESTS, "RATE_ANOMALY",
                    "That's faster than any scientist can work. Take a breath and try again in a minute.");
        }

        String subject = e.subject();
        if (subject == null && e.kind().equals("experiment.completed")) {
            subject = catalogue.byId(e.refId()).map(LibraryCatalogue.Experiment::subject).orElse(null);
        }
        if (e.kind().equals("playground.discovery")) subject = "chemistry";

        List<Adjustment> adjustments = new ArrayList<>();
        int base = baseXp(e.kind());
        int xp = applyRepeatRules(userId, e, base, adjustments);
        xp = applyDailyCap(userId, user, xp, adjustments);

        long before = user.totalXp();
        long total = insert(userId, e.idempotencyKey(), e.kind(), e.refId(), subject, e.score(), base, xp, adjustments);

        // Streaks
        switch (e.kind()) {
            case "experiment.completed" -> streaks.touch(userId, "experiment", today);
            case "quiz.completed" -> streaks.touch(userId, "quiz", today);
            default -> { }
        }

        // Daily challenges: each one completed by this event is a separate, idempotent 75 XP award.
        String discoveryType = e.kind().equals("playground.discovery")
                ? Discovery.ALL.stream().filter(d -> d.id().equals(e.refId())).map(Discovery::type).findFirst().orElse(null)
                : null;
        for (Challenges.Template t : challenges.onEvent(userId, today, e, discoveryType)) {
            String key = "challenge:" + today + ":" + t.id();
            List<Adjustment> none = List.of();
            total = insert(userId, key, "challenge.completed", t.id(), null, null, Challenges.XP, Challenges.XP, none);
            notifications.notify(userId, "challenge", "Challenge complete: " + t.title(), "+" + Challenges.XP + " XP",
                    "/", key);
            if (challenges.allDone(userId, today)) streaks.touch(userId, "weekly_challenge", today);
        }
        int awarded = (int) (total - before);

        List<Badges.Badge> fresh = badges.evaluate(userId);
        for (Badges.Badge b : fresh) {
            notifications.notify(userId, "badge", "Badge unlocked: " + b.name(), b.description(), "/achievements",
                    "badge:" + b.id());
        }
        boolean levelUp = Levels.index(total) > Levels.index(before);
        if (levelUp) {
            RewardResult.Level lvl = Levels.of(total);
            notifications.notify(userId, "level", "Level up! You're now a " + lvl.name(),
                    "Keep experimenting to reach the next rank.", "/progress", "level:" + lvl.index());
        }
        return new RewardResult(e.idempotencyKey(), false, awarded, adjustments, total, Levels.of(total), levelUp,
                fresh.stream().map(b -> new RewardResult.Badge(b.id(), b.name())).toList(),
                streaks.summary(userId, today));
    }

    public record Summary(long totalXp, RewardResult.Level level, List<RewardResult.Streak> streaks,
            List<Badges.Badge> badges, int xpToday, int xpThisWeek, Map<String, Long> xpBySubject,
            List<Activity> recent, Map<String, Integer> counts) {}

    public record Activity(String kind, String refId, String subject, int xp, Instant at) {}

    public Summary summary(UUID userId) {
        User user = users.require(userId);
        LocalDate today = user.today();
        Instant dayStart = today.atStartOfDay(user.zone()).toInstant();
        Instant weekStart = today.minusDays(today.getDayOfWeek().getValue() - 1L).atStartOfDay(user.zone()).toInstant();
        int xpToday = sumSince(userId, dayStart);
        int xpWeek = sumSince(userId, weekStart);
        Map<String, Long> bySubject = new java.util.TreeMap<>();
        db.sql("SELECT subject, COALESCE(SUM(xp), 0) FROM xp_transactions WHERE user_id = ? AND subject IS NOT NULL GROUP BY subject")
                .param(userId).query((rs, i) -> bySubject.put(rs.getString(1), rs.getLong(2))).list();
        List<Activity> recent = db.sql("SELECT kind, ref_id, subject, xp, created_at FROM xp_transactions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12")
                .param(userId)
                .query((rs, i) -> new Activity(rs.getString(1), rs.getString(2), rs.getString(3), rs.getInt(4),
                        rs.getTimestamp(5).toInstant()))
                .list();
        Map<String, Integer> counts = new java.util.LinkedHashMap<>();
        db.sql("""
                SELECT count(DISTINCT ref_id) FILTER (WHERE kind = 'experiment.completed') AS experiments,
                       count(*) FILTER (WHERE kind = 'quiz.completed') AS quizzes,
                       count(DISTINCT ref_id) FILTER (WHERE kind = 'playground.discovery') AS discoveries,
                       count(*) FILTER (WHERE kind = 'challenge.completed') AS challenges,
                       COALESCE(ROUND(AVG(score) FILTER (WHERE kind = 'quiz.completed')), 0) AS quiz_accuracy
                  FROM xp_transactions WHERE user_id = ?
                """)
                .param(userId)
                .query((rs, i) -> {
                    counts.put("experiments", rs.getInt("experiments"));
                    counts.put("quizzes", rs.getInt("quizzes"));
                    counts.put("discoveries", rs.getInt("discoveries"));
                    counts.put("challenges", rs.getInt("challenges"));
                    counts.put("quizAccuracy", rs.getInt("quiz_accuracy"));
                    return null;
                })
                .list();
        return new Summary(user.totalXp(), Levels.of(user.totalXp()), streaks.summary(userId, today),
                badges.all(userId), xpToday, xpWeek, bySubject, recent, counts);
    }

    // ------------------------------------------------------------------ rules

    static int baseXp(String kind) {
        return switch (kind) {
            case "experiment.completed", "scenario.completed" -> 100;
            case "quiz.completed" -> 30;
            case "challenge.completed" -> Challenges.XP;
            case "concept.discovered", "playground.discovery" -> 20;
            case "chapter.completed" -> 200;
            case "onboarding.completed" -> 50;
            default -> 0; // molecular_view.opened counts toward a badge only
        };
    }

    private int applyRepeatRules(UUID userId, ProgressEvent e, int base, List<Adjustment> adj) {
        List<Object[]> history = db.sql("SELECT score, created_at FROM xp_transactions WHERE user_id = ? AND kind = ? AND ref_id = ? ORDER BY created_at")
                .params(userId, e.kind(), e.refId())
                .query((rs, i) -> new Object[] {rs.getObject("score", Integer.class), rs.getTimestamp("created_at").toInstant()})
                .list();
        int xp = base;
        switch (e.kind()) {
            case "experiment.completed" -> {
                if (history.isEmpty()) break;
                Instant first = (Instant) history.get(0)[1];
                boolean withinWeek = ChronoUnit.DAYS.between(first, Instant.now()) < 7;
                if (withinWeek) {
                    xp = history.size() == 1 ? Math.round(base * 0.25f) : 0;
                    adj.add(new Adjustment(history.size() == 1 ? "REPEAT_25_PERCENT" : "REPEAT_NO_XP", xp - base));
                } else {
                    int best = history.stream().map(h -> (Integer) h[0]).filter(java.util.Objects::nonNull)
                            .max(Integer::compare).orElse(0);
                    int score = e.score() == null ? 0 : e.score();
                    xp = Math.max(0, score - best);
                    adj.add(new Adjustment("RETAKE_IMPROVEMENT_ONLY", xp - base));
                }
            }
            case "quiz.completed" -> {
                boolean hadPerfect = history.stream().anyMatch(h -> Integer.valueOf(100).equals(h[0]));
                xp = history.isEmpty() ? base : 0;
                if (!history.isEmpty()) adj.add(new Adjustment("ONCE_PER_QUIZ", -base));
                if (Integer.valueOf(100).equals(e.score()) && !hadPerfect) {
                    xp += 50;
                    adj.add(new Adjustment("PERFECT_SCORE_BONUS", 50));
                }
            }
            case "challenge.completed", "concept.discovered", "chapter.completed", "playground.discovery",
                    "onboarding.completed", "molecular_view.opened" -> {
                if (!history.isEmpty() && base > 0) {
                    xp = 0;
                    adj.add(new Adjustment("ALREADY_AWARDED", -base));
                }
            }
            case "scenario.completed" -> {
                if (!history.isEmpty()) {
                    xp = 0;
                    adj.add(new Adjustment("FIRST_COMPLETION_ONLY", -base));
                }
            }
            default -> { }
        }
        return xp;
    }

    /** Soft cap: past the cap each award is halved; past twice the cap it drops to 10%. */
    private int applyDailyCap(UUID userId, User user, int xp, List<Adjustment> adj) {
        if (xp <= 0) return xp;
        int today = sumSince(userId, user.today().atStartOfDay(user.zone()).toInstant());
        double factor = today >= dailySoftCap * 2 ? 0.1 : today >= dailySoftCap ? 0.5 : 1;
        if (factor == 1) return xp;
        int capped = (int) Math.round(xp * factor);
        adj.add(new Adjustment("DAILY_SOFT_CAP", capped - xp));
        return capped;
    }

    private long insert(UUID userId, String key, String kind, String refId, String subject, Integer score, int base,
            int xp, List<Adjustment> adjustments) {
        String adj;
        try {
            adj = mapper.writeValueAsString(adjustments);
        } catch (JsonProcessingException ex) {
            adj = "[]";
        }
        db.sql("""
                INSERT INTO xp_transactions (user_id, idempotency_key, kind, ref_id, subject, score, base_xp, xp, adjustments)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb) ON CONFLICT (user_id, idempotency_key) DO NOTHING
                """)
                .params(userId, key, kind, refId, subject, score, base, xp, adj)
                .update();
        return db.sql("UPDATE users SET total_xp = total_xp + ? WHERE id = ? RETURNING total_xp")
                .params(xp, userId).query(Long.class).single();
    }

    private int sumSince(UUID userId, Instant since) {
        return db.sql("SELECT COALESCE(SUM(xp), 0) FROM xp_transactions WHERE user_id = ? AND created_at >= ?")
                .params(userId, Timestamp.from(since)).query(Integer.class).single();
    }

    /**
     * The server only pays for things that exist and can actually be done: a feature that has not shipped
     * yet cannot be completed, and refIds must name real experiments or discoveries.
     */
    private void checkSource(ProgressEvent e) {
        if (!live.getOrDefault(e.kind(), true)) {
            throw ApiProblem.badRequest("FEATURE_NOT_LIVE", "That activity isn't available yet.");
        }
        if (e.kind().equals("experiment.completed") && catalogue.byId(e.refId()).isEmpty()) {
            throw ApiProblem.badRequest("EXPERIMENT_UNKNOWN", "Unknown experiment.");
        }
        if (e.kind().equals("playground.discovery") && Discovery.ALL.stream().noneMatch(d -> d.id().equals(e.refId()))) {
            throw ApiProblem.badRequest("DISCOVERY_UNKNOWN", "Unknown discovery.");
        }
    }

    private static void validate(ProgressEvent e) {
        if (e == null || e.idempotencyKey() == null || e.idempotencyKey().isBlank() || e.idempotencyKey().length() > 80) {
            throw ApiProblem.badRequest("IDEMPOTENCY_KEY_REQUIRED", "Every progress event needs an idempotencyKey.");
        }
        if (e.kind() == null || !KINDS.contains(e.kind())) {
            throw ApiProblem.badRequest("KIND_UNKNOWN", "Unknown progress event kind.");
        }
        if (e.kind().equals("challenge.completed")) {
            throw ApiProblem.forbidden("SERVER_ONLY", "Challenge rewards are awarded by the server.");
        }
        if (e.refId() == null || e.refId().isBlank() || e.refId().length() > 120) {
            throw ApiProblem.badRequest("REF_ID_REQUIRED", "Every progress event needs a refId.");
        }
        if (e.score() != null && (e.score() < 0 || e.score() > 100)) {
            throw ApiProblem.badRequest("SCORE_OUT_OF_RANGE", "Scores run from 0 to 100.");
        }
    }
}
