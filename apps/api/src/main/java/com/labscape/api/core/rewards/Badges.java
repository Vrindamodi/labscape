package com.labscape.api.core.rewards;

import com.labscape.api.core.library.LibraryCatalogue;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Badge rules from build plan 1.5, evaluated after every award. */
@Service
public class Badges {

    public record Badge(String id, String name, String description, String icon, String tier, int target,
            int progress, boolean unlocked, Instant unlockedAt) {}

    private final JdbcClient db;
    private final String[] circuitIds;

    public Badges(JdbcClient db, LibraryCatalogue catalogue) {
        this.db = db;
        this.circuitIds = catalogue.all().stream().filter(e -> e.tags().contains("circuit"))
                .map(LibraryCatalogue.Experiment::id).toArray(String[]::new);
    }

    /** Current progress toward every badge (the achievements page). */
    public List<Badge> all(UUID userId) {
        Map<String, Integer> p = progress(userId);
        Map<String, Instant> unlocked = new HashMap<>();
        db.sql("SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ?").param(userId)
                .query((rs, i) -> unlocked.put(rs.getString(1), rs.getTimestamp(2).toInstant())).list();
        return db.sql("SELECT id, name, description, icon, tier, target FROM achievements ORDER BY sort_order")
                .query((rs, i) -> {
                    String id = rs.getString("id");
                    int target = rs.getInt("target");
                    return new Badge(id, rs.getString("name"), rs.getString("description"), rs.getString("icon"),
                            rs.getString("tier"), target, Math.min(target, p.getOrDefault(id, 0)),
                            unlocked.containsKey(id), unlocked.get(id));
                })
                .list();
    }

    /** Unlocks every badge whose target is now met. Returns only the new ones. */
    public List<Badge> evaluate(UUID userId) {
        List<Badge> fresh = new ArrayList<>();
        for (Badge b : all(userId)) {
            if (b.unlocked() || b.progress() < b.target()) continue;
            int n = db.sql("INSERT INTO user_achievements (user_id, achievement_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
                    .params(userId, b.id()).update();
            if (n == 1) fresh.add(new Badge(b.id(), b.name(), b.description(), b.icon(), b.tier(), b.target(),
                    b.progress(), true, Instant.now()));
        }
        return fresh;
    }

    private Map<String, Integer> progress(UUID userId) {
        Map<String, Integer> p = new HashMap<>();
        db.sql("""
                SELECT
                  count(*) FILTER (WHERE kind = 'onboarding.completed') AS welcome,
                  count(DISTINCT ref_id) FILTER (WHERE kind = 'experiment.completed') AS experiments,
                  count(DISTINCT ref_id) FILTER (WHERE kind = 'experiment.completed' AND subject = 'chemistry') AS chemistry,
                  count(DISTINCT ref_id) FILTER (WHERE kind = 'experiment.completed' AND subject = 'physics') AS physics,
                  count(DISTINCT ref_id) FILTER (WHERE kind = 'experiment.completed' AND subject = 'maths') AS maths,
                  count(*) FILTER (WHERE kind = 'quiz.completed' AND score = 100) AS perfect,
                  count(DISTINCT ref_id) FILTER (WHERE kind = 'scenario.completed' AND score >= 80) AS safe,
                  count(DISTINCT ref_id) FILTER (WHERE kind = 'playground.discovery') AS discoveries,
                  count(DISTINCT ref_id) FILTER (WHERE kind = 'molecular_view.opened') AS molview,
                  count(DISTINCT ref_id) FILTER (WHERE kind = 'experiment.completed' AND ref_id = ANY(?)) AS circuits
                FROM xp_transactions WHERE user_id = ?
                """)
                .params(circuitIds, userId)
                .query((rs, i) -> {
                    p.put("welcome", rs.getInt("welcome"));
                    p.put("first_experiment", rs.getInt("experiments"));
                    p.put("chemistry_explorer", rs.getInt("chemistry"));
                    p.put("physics_master", rs.getInt("physics"));
                    p.put("maths_wizard", rs.getInt("maths"));
                    p.put("perfect_score", rs.getInt("perfect"));
                    p.put("safety_champion", rs.getInt("safe"));
                    p.put("playground_explorer", rs.getInt("discoveries"));
                    p.put("molecular_detective", rs.getInt("molview"));
                    p.put("circuit_builder", rs.getInt("circuits"));
                    return null;
                })
                .list();
        Integer best = db.sql("SELECT best_days FROM streaks WHERE user_id = ? AND kind = 'login'").param(userId)
                .query(Integer.class).optional().orElse(0);
        p.put("seven_day_streak", best);
        return p;
    }
}
