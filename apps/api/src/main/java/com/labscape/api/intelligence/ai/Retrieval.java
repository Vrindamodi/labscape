package com.labscape.api.intelligence.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labscape.api.core.library.LibraryCatalogue;
import com.labscape.api.core.reference.ReferenceData;
import com.labscape.api.lab.LabEngineRuntime;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;

/**
 * Retrieval over reviewed content only (build plan 4.4): experiment summaries and explanations,
 * protocol steps, formulas, elements, equipment and quiz explanations. BM25 in memory; the
 * interface stays the same when pgvector embeddings take over the ranking.
 */
@Component
public class Retrieval {

    public record Doc(String id, String type, String title, String text, String url) {}

    public record Hit(Doc doc, double score) {}

    private static final Set<String> STOP = Set.of("the", "a", "an", "of", "to", "in", "is", "it", "and", "or", "for", "on", "with", "what", "why", "how", "does",
            "do", "did", "i", "you", "my", "me", "this", "that", "be", "are", "was", "when", "at", "by", "as", "can", "will", "if", "from", "its", "into", "about", "which");

    private final List<Doc> docs = new ArrayList<>();
    private final List<Map<String, Integer>> tf = new ArrayList<>();
    private final Map<String, Integer> df = new HashMap<>();
    private double avgLen;

    public Retrieval(ObjectMapper mapper, LibraryCatalogue catalogue, ReferenceData reference, LabEngineRuntime engine) {
        for (LibraryCatalogue.Experiment e : catalogue.all()) {
            String url = e.playable() ? "/lab/" + e.subject() + "/" + e.slug() : "/library/" + e.slug();
            add(new Doc("exp:" + e.slug(), "experiment", e.title(), e.summary() + " " + e.concept() + " " + String.join(". ", e.objectives()) + ". Safety: " + String.join(". ", e.safety()), url));
            engine.content(e.slug()).ifPresent(c -> {
                JsonNode o = c.path("observations");
                add(new Doc("why:" + e.slug(), "explanation", e.title() + ": what happened and why", o.path("whatHappened").asText() + " " + o.path("why").asText(), url));
                for (JsonNode s : c.path("steps"))
                    add(new Doc("step:" + e.slug() + ":" + s.path("id").asText(), "step", e.title() + ": " + s.path("title").asText(), s.path("instruction").asText(), url));
            });
        }
        for (JsonNode f : reference.formulas()) {
            StringBuilder vars = new StringBuilder();
            f.path("variables").forEach(v -> vars.append(v.path("name").asText()).append(" (").append(v.path("unit").asText()).append("), "));
            add(new Doc("formula:" + f.path("id").asText(), "formula", f.path("title").asText(), f.path("topic").asText() + ". Variables: " + vars, "/formulas?f=" + f.path("id").asText()));
        }
        for (ReferenceData.Element el : reference.elements())
            add(new Doc("element:" + el.symbol(), "element", el.name() + " (" + el.symbol() + ")", el.name() + " is a " + el.category().replace('-', ' ') + ". " + el.fact(), "/periodic-table?el=" + el.symbol()));
        for (JsonNode eq : reference.equipment())
            add(new Doc("equipment:" + eq.path("id").asText(), "equipment", eq.path("name").asText(), eq.path("summary").asText() + " " + join(eq.path("steps")) + " Mistakes: " + join(eq.path("mistakes")), "/equipment?item=" + eq.path("id").asText()));
        try {
            for (Resource r : new PathMatchingResourcePatternResolver().getResources("classpath:content/quizzes/*.json")) {
                try (InputStream in = r.getInputStream()) {
                    JsonNode qz = mapper.readTree(in);
                    for (JsonNode q : qz.path("questions"))
                        add(new Doc("quiz:" + qz.path("id").asText() + ":" + q.path("id").asText(), "explanation", q.path("prompt").asText(), q.path("explanation").asText(), "/quizzes/" + qz.path("id").asText()));
                }
            }
        } catch (IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
        avgLen = tf.stream().mapToInt(m -> m.values().stream().mapToInt(Integer::intValue).sum()).average().orElse(1);
    }

    private static String join(JsonNode arr) {
        StringBuilder b = new StringBuilder();
        arr.forEach(n -> b.append(n.asText()).append(' '));
        return b.toString();
    }

    /** Lower-case words with a light stemmer (plurals, -ing, -ed). */
    static List<String> tokens(String text) {
        List<String> out = new ArrayList<>();
        for (String w : text.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9 ]", " ").split("\\s+")) {
            if (w.length() < 2 || STOP.contains(w)) continue;
            if (w.endsWith("ies") && w.length() > 4) w = w.substring(0, w.length() - 3) + "y";
            else if (w.endsWith("ing") && w.length() > 5) w = w.substring(0, w.length() - 3);
            else if (w.endsWith("ed") && w.length() > 4) w = w.substring(0, w.length() - 2);
            else if (w.endsWith("es") && w.length() > 4) w = w.substring(0, w.length() - 2);
            else if (w.endsWith("s") && w.length() > 3 && !w.endsWith("ss")) w = w.substring(0, w.length() - 1);
            out.add(w);
        }
        return out;
    }

    private void add(Doc d) {
        Map<String, Integer> counts = new HashMap<>();
        // titles count double
        for (String t : tokens(d.title() + " " + d.title() + " " + d.text())) counts.merge(t, 1, Integer::sum);
        docs.add(d);
        tf.add(counts);
        counts.keySet().forEach(t -> df.merge(t, 1, Integer::sum));
    }

    /** Top hits for a query, optionally limited to some document types. */
    public List<Hit> search(String query, int k, Set<String> types) {
        List<String> q = tokens(query);
        List<Hit> hits = new ArrayList<>();
        double n = docs.size();
        for (int i = 0; i < docs.size(); i++) {
            Doc d = docs.get(i);
            if (types != null && !types.contains(d.type())) continue;
            Map<String, Integer> m = tf.get(i);
            int len = m.values().stream().mapToInt(Integer::intValue).sum();
            double score = 0;
            for (String t : q) {
                Integer f = m.get(t);
                if (f == null) continue;
                double idf = Math.log(1 + (n - df.get(t) + 0.5) / (df.get(t) + 0.5));
                score += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * len / avgLen));
            }
            if (score <= 0) continue;
            // A question that names a thing ("what is a burette") wants that thing's own entry.
            String title = d.title().toLowerCase(Locale.ROOT).replaceAll("\\s*\\(.*\\)", "").trim();
            if (title.length() >= 4 && (" " + query.toLowerCase(Locale.ROOT) + " ").replaceAll("[^a-z0-9 ]", " ").contains(" " + title + " ")) score *= 2.5;
            if (d.type().equals("explanation") && d.id().startsWith("quiz:")) score *= 0.7;
            hits.add(new Hit(d, score));
        }
        hits.sort((a, b) -> Double.compare(b.score(), a.score()));
        return hits.subList(0, Math.min(k, hits.size()));
    }

    public java.util.Optional<Doc> byId(String id) {
        return docs.stream().filter(d -> d.id().equals(id)).findFirst();
    }

    public int size() {
        return docs.size();
    }
}
