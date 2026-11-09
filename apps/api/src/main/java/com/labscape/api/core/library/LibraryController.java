package com.labscape.api.core.library;

import com.labscape.api.common.ApiProblem;
import com.labscape.api.core.billing.Entitlements;
import com.labscape.api.core.library.LibraryCatalogue.Experiment;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Experiment Library browser (build plan 1.4). Public; signed-in users also get completion state. */
@RestController
@RequestMapping("/v1/library")
public class LibraryController {

    public record Card(String id, String slug, String subject, String chapter, String topic, String title,
            String summary, String difficulty, List<String> levels, int estimatedMinutes, int xpReward, int stages,
            List<String> objectives, List<String> equipment, boolean premium, boolean locked, boolean featured,
            boolean completed, String release, boolean playable, double relevance) {}

    public record Page(List<Card> items, int total, Facets facets) {}

    public record Facets(Map<String, Long> subjects, List<String> chapters, List<String> equipment) {}

    public record Detail(Card card, String concept, List<String> realWorld, List<String> materials,
            List<String> safety, List<String> stageList, List<Card> related, List<String> elements) {}

    static final List<String> STAGES = List.of(
            "Introduction", "Demo", "Try it yourself", "Hints and guidance", "Observations", "Quiz");

    private final LibraryCatalogue catalogue;
    private final Entitlements entitlements;
    private final JdbcClient db;

    public LibraryController(LibraryCatalogue catalogue, Entitlements entitlements, JdbcClient db) {
        this.catalogue = catalogue;
        this.entitlements = entitlements;
        this.db = db;
    }

    @GetMapping("/experiments")
    public Page list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String subject,
            @RequestParam(required = false) String chapter,
            @RequestParam(required = false) String difficulty,
            @RequestParam(required = false) String level,
            @RequestParam(required = false) String duration,
            @RequestParam(required = false) String equipment,
            @RequestParam(required = false) String completed,
            @RequestParam(required = false) Boolean featured) {
        UUID user = jwt == null ? null : UUID.fromString(jwt.getSubject());
        boolean full = entitlements.bool(user, "library.full");
        Set<String> done = completedIds(user);

        List<Card> all = catalogue.all().stream()
                .filter(e -> subject == null || e.subject().equals(subject))
                .filter(e -> chapter == null || e.chapter().equals(chapter))
                .filter(e -> difficulty == null || e.difficulty().equals(difficulty))
                .filter(e -> level == null || e.levels().contains(level))
                .filter(e -> equipment == null || e.equipment().stream().anyMatch(x -> x.equalsIgnoreCase(equipment)))
                .filter(e -> duration == null || inDuration(e.estimatedMinutes(), duration))
                .filter(e -> completed == null || (completed.equals("yes") == done.contains(e.id())))
                .filter(e -> featured == null || e.featured() == featured)
                .map(e -> card(e, full, done, q == null ? 1 : catalogue.score(e, q)))
                .filter(c -> c.relevance() > 0)
                .sorted(Comparator.comparingDouble(Card::relevance).reversed()
                        .thenComparing(Card::featured, Comparator.reverseOrder())
                        .thenComparing(Card::title))
                .toList();

        Map<String, Long> subjects = catalogue.all().stream()
                .collect(Collectors.groupingBy(Experiment::subject, java.util.TreeMap::new, Collectors.counting()));
        List<String> chapters = catalogue.all().stream()
                .filter(e -> subject == null || e.subject().equals(subject))
                .map(Experiment::chapter).distinct().sorted().toList();
        List<String> equip = catalogue.all().stream()
                .filter(e -> subject == null || e.subject().equals(subject))
                .flatMap(e -> e.equipment().stream()).distinct().sorted().toList();
        return new Page(all, all.size(), new Facets(subjects, chapters, equip));
    }

    @GetMapping("/experiments/{slug}")
    public Detail detail(@AuthenticationPrincipal Jwt jwt, @PathVariable String slug) {
        Experiment e = catalogue.bySlug(slug)
                .orElseThrow(() -> ApiProblem.notFound("EXPERIMENT_NOT_FOUND", "We couldn't find that experiment."));
        UUID user = jwt == null ? null : UUID.fromString(jwt.getSubject());
        boolean full = entitlements.bool(user, "library.full");
        Set<String> done = completedIds(user);
        List<Card> related = catalogue.all().stream()
                .filter(o -> !o.id().equals(e.id()) && o.subject().equals(e.subject()))
                .sorted(Comparator.comparing((Experiment o) -> !o.chapter().equals(e.chapter())))
                .limit(3)
                .map(o -> card(o, full, done, 1))
                .toList();
        return new Detail(card(e, full, done, 1), e.concept(), e.realWorld(), e.materials(), e.safety(), STAGES, related, e.elements());
    }

    private Card card(Experiment e, boolean full, Set<String> done, double relevance) {
        return new Card(e.id(), e.slug(), e.subject(), e.chapter(), e.topic(), e.title(), e.summary(), e.difficulty(),
                e.levels(), e.estimatedMinutes(), e.xpReward(), e.stages(), e.objectives(), e.equipment(), e.premium(),
                e.premium() && !full, e.featured(), done.contains(e.id()), e.release(), e.playable(), relevance);
    }

    private Set<String> completedIds(UUID user) {
        if (user == null) return Set.of();
        return Set.copyOf(db.sql("SELECT DISTINCT ref_id FROM xp_transactions WHERE user_id = ? AND kind = 'experiment.completed'")
                .param(user).query(String.class).list());
    }

    private static boolean inDuration(int minutes, String bucket) {
        return switch (bucket) {
            case "short" -> minutes <= 10;
            case "medium" -> minutes > 10 && minutes <= 20;
            case "long" -> minutes > 20;
            default -> true;
        };
    }
}
