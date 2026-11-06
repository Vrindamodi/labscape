package com.labscape.api.core.challenges;

import com.labscape.api.contracts.ProgressEvent;
import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Daily challenges (build plan 1.3/1.5): three per day, seeded per user so they are stable all day,
 * weighted toward the user's weakest subject. Only challenges whose feature has shipped are offered.
 * Progress comes from ProgressEvents; completing one is worth 75 XP (awarded by the rewards service).
 */
@Service
public class Challenges {

    public static final int XP = 75;
    public static final int PER_DAY = 3;

    /** A challenge template. Null match fields mean "any". */
    public record Template(String id, String title, String description, String icon, String kind, String subject,
            Integer minScore, String discoveryType, int target, String feature) {}

    public record Today(String id, String title, String description, String icon, int progress, int target,
            boolean completed, int xp, String link) {}

    public static final List<Template> POOL = List.of(
            new Template("play-discover-1", "Spark of curiosity", "Discover any new reaction in the Playground.", "sparkles",
                    "playground.discovery", null, null, null, 1, "playground"),
            new Template("play-discover-3", "Triple discovery", "Make 3 Playground discoveries today.", "telescope",
                    "playground.discovery", null, null, null, 3, "playground"),
            new Template("play-gas", "Something's fizzing", "Find a reaction that gives off a gas.", "wind",
                    "playground.discovery", null, null, "gas", 1, "playground"),
            new Template("play-precipitate", "Out of thin solution", "Make a precipitate appear in the Playground.", "cloud-hail",
                    "playground.discovery", null, null, "precipitation", 1, "playground"),
            new Template("play-redox", "Electron thief", "Discover a redox or displacement reaction.", "zap",
                    "playground.discovery", null, null, "redox", 1, "playground"),
            new Template("play-colour", "Colour shift", "Find a reaction where an indicator changes colour.", "palette",
                    "playground.discovery", null, null, "indicator", 1, "playground"),
            new Template("play-neutral", "Perfectly balanced", "Neutralise an acid with a base.", "scale",
                    "playground.discovery", null, null, "neutralisation", 1, "playground"),
            new Template("exp-chem", "Chemistry session", "Complete a chemistry experiment.", "flask-conical",
                    "experiment.completed", "chemistry", null, null, 1, "experiments"),
            new Template("exp-phys", "Physics session", "Complete a physics experiment.", "orbit",
                    "experiment.completed", "physics", null, null, 1, "experiments"),
            new Template("exp-math", "Maths session", "Complete a maths experiment.", "sigma",
                    "experiment.completed", "maths", null, null, 1, "experiments"),
            new Template("exp-any-2", "Double shift", "Complete 2 experiments.", "beaker",
                    "experiment.completed", null, null, null, 2, "experiments"),
            new Template("quiz-80", "Sharp mind", "Score 80% or more on any quiz.", "target",
                    "quiz.completed", null, 80, null, 1, "quizzes"),
            new Template("quiz-2", "Quiz streak", "Finish 2 quizzes.", "list-checks",
                    "quiz.completed", null, null, null, 2, "quizzes"),
            new Template("scenario-1", "Stay calm", "Complete an emergency scenario.", "siren",
                    "scenario.completed", null, null, null, 1, "scenarios"),
            new Template("molview-2", "Zoom in", "Open the molecular view on 2 reactions.", "microscope",
                    "molecular_view.opened", null, null, null, 2, "molecular-view"));

    private final JdbcClient db;
    private final Map<String, Boolean> features;

    public Challenges(JdbcClient db,
            @Value("${labscape.features.experiments:false}") boolean experiments,
            @Value("${labscape.features.quizzes:false}") boolean quizzes,
            @Value("${labscape.features.scenarios:false}") boolean scenarios,
            @Value("${labscape.features.molecular-view:false}") boolean molecularView) {
        this.db = db;
        this.features = Map.of("playground", true, "experiments", experiments, "quizzes", quizzes,
                "scenarios", scenarios, "molecular-view", molecularView);
    }

    /** The user's three challenges for their local date, stable for the whole day. */
    public List<Template> pick(UUID userId, LocalDate day) {
        List<Template> live = new ArrayList<>(POOL.stream().filter(t -> features.getOrDefault(t.feature(), false)).toList());
        String weakest = weakestSubject(userId);
        Random rnd = new Random((userId.toString() + day).hashCode());
        List<Template> out = new ArrayList<>();
        while (out.size() < PER_DAY && !live.isEmpty()) {
            double total = live.stream().mapToDouble(t -> weight(t, weakest)).sum();
            double r = rnd.nextDouble() * total;
            for (Template t : live) {
                r -= weight(t, weakest);
                if (r <= 0) {
                    out.add(t);
                    live.remove(t);
                    break;
                }
            }
        }
        return out;
    }

    public List<Today> today(UUID userId, LocalDate day) {
        Map<String, int[]> progress = progress(userId, day);
        return pick(userId, day).stream().map(t -> {
            int[] p = progress.getOrDefault(t.id(), new int[] {0, 0});
            return new Today(t.id(), t.title(), t.description(), t.icon(), Math.min(p[0], t.target()), t.target(),
                    p[1] == 1, XP, link(t));
        }).toList();
    }

    /** Applies an event to today's challenges. Returns the templates it just completed. */
    public List<Template> onEvent(UUID userId, LocalDate day, ProgressEvent e, String discoveryType) {
        List<Template> completed = new ArrayList<>();
        for (Template t : pick(userId, day)) {
            if (!t.kind().equals(e.kind())) continue;
            if (t.subject() != null && !t.subject().equals(e.subject())) continue;
            if (t.minScore() != null && (e.score() == null || e.score() < t.minScore())) continue;
            if (t.discoveryType() != null && !t.discoveryType().equals(discoveryType)) continue;
            Integer done = db.sql("""
                    INSERT INTO daily_challenge_progress (user_id, day, challenge_id, progress) VALUES (?, ?, ?, 1)
                    ON CONFLICT (user_id, day, challenge_id) DO UPDATE SET progress = daily_challenge_progress.progress + 1
                    RETURNING CASE WHEN completed_at IS NULL AND progress >= ? THEN 1 ELSE 0 END
                    """)
                    .params(userId, Date.valueOf(day), t.id(), t.target())
                    .query(Integer.class).single();
            if (done == 1) {
                db.sql("UPDATE daily_challenge_progress SET completed_at = now() WHERE user_id = ? AND day = ? AND challenge_id = ?")
                        .params(userId, Date.valueOf(day), t.id()).update();
                completed.add(t);
            }
        }
        return completed;
    }

    public boolean allDone(UUID userId, LocalDate day) {
        List<Template> picked = pick(userId, day);
        Map<String, int[]> p = progress(userId, day);
        return !picked.isEmpty() && picked.stream().allMatch(t -> p.getOrDefault(t.id(), new int[] {0, 0})[1] == 1);
    }

    private Map<String, int[]> progress(UUID userId, LocalDate day) {
        return db.sql("SELECT challenge_id, progress, completed_at IS NOT NULL AS done FROM daily_challenge_progress WHERE user_id = ? AND day = ?")
                .params(userId, Date.valueOf(day))
                .query((rs, i) -> Map.entry(rs.getString("challenge_id"), new int[] {rs.getInt("progress"), rs.getBoolean("done") ? 1 : 0}))
                .list().stream().collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    }

    private String weakestSubject(UUID userId) {
        Map<String, Integer> counts = db.sql("""
                SELECT subject, count(*) AS n FROM xp_transactions
                 WHERE user_id = ? AND kind = 'experiment.completed' AND subject IS NOT NULL GROUP BY subject
                """)
                .param(userId)
                .query((rs, i) -> Map.entry(rs.getString("subject"), rs.getInt("n")))
                .list().stream().collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
        return List.of("chemistry", "physics", "maths").stream()
                .min((a, b) -> Integer.compare(counts.getOrDefault(a, 0), counts.getOrDefault(b, 0)))
                .orElse("chemistry");
    }

    private static double weight(Template t, String weakest) {
        return t.subject() != null && t.subject().equals(weakest) ? 3 : 1;
    }

    private static String link(Template t) {
        return switch (t.kind()) {
            case "playground.discovery" -> "/playground/chemistry";
            case "quiz.completed" -> "/quizzes";
            case "scenario.completed" -> "/emergency";
            default -> t.subject() != null ? "/library?subject=" + t.subject() : "/library";
        };
    }

}
