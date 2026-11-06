package com.labscape.api.core.rewards;

import com.labscape.api.contracts.RewardResult;
import java.sql.Date;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.time.temporal.IsoFields;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Login, experiment, quiz and weekly-challenge streaks. Days follow the user's own timezone.
 * One free freeze per ISO week applies itself: missing exactly one day keeps the streak alive.
 */
@Service
public class Streaks {

    public static final List<String> KINDS = List.of("login", "experiment", "quiz", "weekly_challenge");

    public record State(String kind, int current, int best, LocalDate lastDay, String freezeWeek, LocalDate freezeUsedOn) {
        public boolean freezeUsedInWeekOf(LocalDate day) {
            return freezeWeek != null && freezeWeek.equals(isoWeek(day));
        }
    }

    private final JdbcClient db;

    public Streaks(JdbcClient db) {
        this.db = db;
    }

    /** Records activity for a day-based streak. Returns the new length. */
    public int touch(UUID userId, String kind, LocalDate today) {
        if (kind.equals("weekly_challenge")) return touchWeekly(userId, today);
        State s = get(userId, kind);
        if (s.lastDay() != null && !s.lastDay().isBefore(today)) return s.current();
        long gap = s.lastDay() == null ? Long.MAX_VALUE : ChronoUnit.DAYS.between(s.lastDay(), today);
        String week = isoWeek(today);
        int next;
        String freezeWeek = null;
        LocalDate freezeOn = null;
        if (gap == 1) {
            next = s.current() + 1;
        } else if (gap == 2 && s.current() > 0 && !s.freezeUsedInWeekOf(today)) {
            next = s.current() + 1; // the free weekly freeze covers the missed day
            freezeWeek = week;
            freezeOn = today.minusDays(1);
        } else {
            next = 1;
        }
        save(userId, kind, next, Math.max(next, s.best()), today, freezeWeek, freezeOn);
        return next;
    }

    private int touchWeekly(UUID userId, LocalDate today) {
        State s = get(userId, "weekly_challenge");
        LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1L);
        if (s.lastDay() != null && !s.lastDay().isBefore(monday)) return s.current();
        long weeks = s.lastDay() == null ? Long.MAX_VALUE : ChronoUnit.WEEKS.between(s.lastDay(), monday);
        int next = weeks == 1 ? s.current() + 1 : 1;
        save(userId, "weekly_challenge", next, Math.max(next, s.best()), monday, null, null);
        return next;
    }

    public State get(UUID userId, String kind) {
        return db.sql("SELECT current_days, best_days, last_day, freeze_week, freeze_used_on FROM streaks WHERE user_id = ? AND kind = ?")
                .params(userId, kind)
                .query((rs, i) -> {
                    LocalDate last = rs.getDate("last_day") == null ? null : rs.getDate("last_day").toLocalDate();
                    LocalDate frozen = rs.getDate("freeze_used_on") == null ? null : rs.getDate("freeze_used_on").toLocalDate();
                    return new State(kind, rs.getInt("current_days"), rs.getInt("best_days"), last,
                            rs.getString("freeze_week"), frozen);
                })
                .optional()
                .orElse(new State(kind, 0, 0, null, null, null));
    }

    /** Current streaks as the user sees them today: a streak whose last day is too old reads as 0. */
    public List<RewardResult.Streak> summary(UUID userId, LocalDate today) {
        return KINDS.stream().map(k -> {
            State s = get(userId, k);
            return new RewardResult.Streak(k, alive(s, today) ? s.current() : 0);
        }).toList();
    }

    public List<State> states(UUID userId) {
        return KINDS.stream().map(k -> get(userId, k)).toList();
    }

    public static boolean alive(State s, LocalDate today) {
        if (s.lastDay() == null) return false;
        if (s.kind().equals("weekly_challenge")) {
            LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1L);
            return !s.lastDay().isBefore(monday.minusWeeks(1));
        }
        long gap = ChronoUnit.DAYS.between(s.lastDay(), today);
        return gap <= 1 || (gap == 2 && !s.freezeUsedInWeekOf(today));
    }

    private void save(UUID userId, String kind, int current, int best, LocalDate last, String freezeWeek,
            LocalDate freezeOn) {
        db.sql("""
                INSERT INTO streaks (user_id, kind, current_days, best_days, last_day, freeze_week, freeze_used_on)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (user_id, kind) DO UPDATE SET current_days = EXCLUDED.current_days,
                    best_days = EXCLUDED.best_days, last_day = EXCLUDED.last_day,
                    freeze_week = COALESCE(EXCLUDED.freeze_week, streaks.freeze_week),
                    freeze_used_on = COALESCE(EXCLUDED.freeze_used_on, streaks.freeze_used_on)
                """)
                .params(userId, kind, current, best, Date.valueOf(last), freezeWeek,
                        freezeOn == null ? null : Date.valueOf(freezeOn))
                .update();
    }

    static String isoWeek(LocalDate d) {
        return d.get(IsoFields.WEEK_BASED_YEAR) + "-W" + String.format("%02d", d.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR));
    }
}
