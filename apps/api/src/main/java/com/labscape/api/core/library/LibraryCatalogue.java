package com.labscape.api.core.library;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * Experiment summaries for the library browser, loaded from content/experiments/catalogue.json.
 * Search mirrors what PostgreSQL full-text + pg_trgm will do once Part 2 moves experiments into
 * its tables: token matching, a concept-synonym table and trigram similarity for typos.
 */
@Component
public class LibraryCatalogue {

    public record Experiment(
            String id,
            String slug,
            String subject,
            String chapter,
            String topic,
            String title,
            String summary,
            String difficulty,
            List<String> levels,
            int estimatedMinutes,
            int xpReward,
            List<String> objectives,
            String concept,
            List<String> realWorld,
            List<String> equipment,
            List<String> materials,
            List<String> safety,
            boolean premium,
            boolean featured,
            List<String> tags,
            String release,
            boolean playable,
            List<String> elements) {

        public Experiment {
            elements = elements == null ? List.of() : List.copyOf(elements);
        }

        public int stages() {
            return 6;
        }

        String haystack() {
            return String.join(" ", title, summary, chapter, topic, concept, String.join(" ", tags),
                    String.join(" ", equipment), String.join(" ", materials)).toLowerCase(Locale.ROOT);
        }
    }

    private final List<Experiment> experiments;
    private final Map<String, List<String>> synonyms;

    public LibraryCatalogue(ObjectMapper mapper) {
        try (InputStream in = new ClassPathResource("content/experiments/catalogue.json").getInputStream()) {
            JsonNode root = mapper.readTree(in);
            List<Experiment> list = new ArrayList<>();
            for (JsonNode n : root.get("experiments")) list.add(mapper.treeToValue(n, Experiment.class));
            this.experiments = List.copyOf(list);
            Map<String, List<String>> syn = new LinkedHashMap<>();
            root.get("synonyms").fields().forEachRemaining(e -> {
                List<String> vals = new ArrayList<>();
                e.getValue().forEach(v -> vals.add(v.asText().toLowerCase(Locale.ROOT)));
                syn.put(e.getKey().toLowerCase(Locale.ROOT), vals);
            });
            this.synonyms = syn;
        } catch (IOException e) {
            throw new UncheckedIOException("Could not load the experiment catalogue", e);
        }
    }

    public List<Experiment> all() {
        return experiments;
    }

    public Optional<Experiment> bySlug(String slug) {
        return experiments.stream().filter(e -> e.slug().equals(slug)).findFirst();
    }

    public Optional<Experiment> byId(String id) {
        return experiments.stream().filter(e -> e.id().equals(id) || e.slug().equals(id)).findFirst();
    }

    /** Relevance score for a query; 0 means no match. */
    public double score(Experiment e, String query) {
        String q = query.trim().toLowerCase(Locale.ROOT);
        if (q.isEmpty()) return 1;
        Set<String> terms = new HashSet<>();
        terms.add(q);
        synonyms.forEach((k, vals) -> {
            if (k.equals(q) || vals.contains(q)) {
                terms.add(k);
                terms.addAll(vals);
            }
        });
        String hay = e.haystack();
        double best = 0;
        String title = e.title().toLowerCase(Locale.ROOT);
        for (String t : terms) {
            // Short terms ("ph") must match a whole word, or they hit "phosphate", "graph"...
            java.util.function.Predicate<String> has = t.length() < 4
                    ? s -> java.util.regex.Pattern.compile("(^|[^\\p{L}])" + java.util.regex.Pattern.quote(t) + "($|[^\\p{L}])").matcher(s).find()
                    : s -> s.contains(t);
            if (has.test(title)) best = Math.max(best, 3);
            else if (has.test(hay)) best = Math.max(best, 2);
        }
        if (best > 0) return best;
        // Typo tolerance: trigram similarity against each word of the title, topic and tags.
        List<String> words = new ArrayList<>();
        for (String w : (e.title() + " " + e.topic() + " " + e.chapter() + " " + String.join(" ", e.tags()))
                .toLowerCase(Locale.ROOT).split("[^\\p{L}\\p{N}]+")) {
            if (w.length() >= 3) words.add(w);
        }
        double sim = 0;
        for (String part : q.split("\\s+")) {
            if (part.length() < 3) continue;
            sim = Math.max(sim, words.stream().map(w -> trigram(part, w)).max(Comparator.naturalOrder()).orElse(0.0));
        }
        return sim >= 0.4 ? sim : 0;
    }

    /** pg_trgm-style similarity: shared trigrams / union of trigrams. */
    static double trigram(String a, String b) {
        Set<String> ta = grams(a);
        Set<String> tb = grams(b);
        if (ta.isEmpty() || tb.isEmpty()) return 0;
        Set<String> inter = new HashSet<>(ta);
        inter.retainAll(tb);
        Set<String> union = new HashSet<>(ta);
        union.addAll(tb);
        return (double) inter.size() / union.size();
    }

    private static Set<String> grams(String s) {
        String p = "  " + s + " ";
        Set<String> out = new HashSet<>();
        for (int i = 0; i + 3 <= p.length(); i++) out.add(p.substring(i, i + 3));
        return out;
    }
}
