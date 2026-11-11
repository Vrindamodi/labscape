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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;

/**
 * Retrieval over LABscape's own content only (build plan 4.4): the glossary of core ideas,
 * experiment summaries and explanations, protocol steps, formulas, elements, equipment and quiz
 * explanations. BM25 in memory; the interface stays the same when pgvector embeddings take over
 * the ranking.
 */
@Component
public class Retrieval {

    public record Doc(String id, String type, String title, String text, String url) {}

    /**
     * `coverage` is the share of the question (weighted by how rare each word is) that the document
     * actually contains, 0..1. A high score with low coverage is one stray word matching.
     */
    public record Hit(Doc doc, double score, double coverage) {}

    private static final Set<String> STOP = Set.of("the", "a", "an", "of", "to", "in", "is", "it", "and", "or", "for", "on", "with", "what", "why", "how", "does",
            "do", "did", "i", "you", "my", "me", "this", "that", "be", "are", "was", "when", "at", "by", "as", "can", "will", "if", "from", "its", "into", "about", "which");

    /** Words that pad a question without saying what it is about; dropped from questions only. */
    private static final Set<String> FILLER = Set.of("explain", "tell", "define", "definition", "describe", "mean", "means", "meaning", "please", "more", "simply",
            "simple", "example", "examples", "give", "know", "want", "need", "help", "understand", "exactly", "actually", "really", "basically", "called", "term",
            "word", "thing", "things", "something", "there", "their", "have", "has", "would", "could", "should", "so", "some", "any", "between", "difference",
            "different", "vs", "versus", "than", "then", "also", "just", "like", "get", "got", "much", "many", "us", "we", "our", "they", "am", "were", "been", "being",
            "not", "but", "because", "here", "where", "who", "all", "each", "every", "both", "your", "them", "these", "those", "such", "very", "too", "only", "other",
            "another", "im", "ive", "dont", "doesnt", "cant", "show", "hi", "hello", "hey", "ok", "okay", "thanks", "thank", "work", "works", "happen", "happens",
            "used", "use");

    private final List<Doc> docs = new ArrayList<>();
    private final List<Map<String, Integer>> tf = new ArrayList<>();
    private final List<List<String>> phrases = new ArrayList<>();
    private final Map<String, Integer> df = new HashMap<>();
    private final Map<String, String> simple = new HashMap<>();
    private final Map<String, String> latex = new HashMap<>();
    private double avgLen;

    public Retrieval(ObjectMapper mapper, LibraryCatalogue catalogue, ReferenceData reference, LabEngineRuntime engine) {
        for (LibraryCatalogue.Experiment e : catalogue.all()) {
            String url = e.playable() ? "/lab/" + e.subject() + "/" + e.slug() : "/library/" + e.slug();
            add(new Doc("exp:" + e.slug(), "experiment", e.title(), e.summary() + " " + e.concept() + " " + String.join(". ", e.objectives()) + ". Safety: " + String.join(". ", e.safety()), url), "", List.of());
            engine.content(e.slug()).ifPresent(c -> {
                JsonNode o = c.path("observations");
                add(new Doc("why:" + e.slug(), "explanation", e.title() + ": what happened and why", o.path("whatHappened").asText() + " " + o.path("why").asText(), url), "", List.of());
                for (JsonNode s : c.path("steps"))
                    add(new Doc("step:" + e.slug() + ":" + s.path("id").asText(), "step", e.title() + ": " + s.path("title").asText(), s.path("instruction").asText(), url), "", List.of());
            });
        }
        for (JsonNode f : reference.formulas()) formula(f);
        for (ReferenceData.Element el : reference.elements())
            add(new Doc("element:" + el.symbol(), "element", el.name() + " (" + el.symbol() + ")", el.name() + " is a " + el.category().replace('-', ' ') + ". " + el.fact(), "/periodic-table?el=" + el.symbol()), "", List.of());
        for (JsonNode eq : reference.equipment())
            add(new Doc("equipment:" + eq.path("id").asText(), "equipment", eq.path("name").asText(), eq.path("summary").asText() + " " + join(eq.path("steps")) + " Mistakes: " + join(eq.path("mistakes")), "/equipment?item=" + eq.path("id").asText()), "", List.of());
        try {
            for (Resource r : new PathMatchingResourcePatternResolver().getResources("classpath:content/quizzes/*.json")) {
                try (InputStream in = r.getInputStream()) {
                    JsonNode qz = mapper.readTree(in);
                    for (JsonNode q : qz.path("questions"))
                        add(new Doc("quiz:" + qz.path("id").asText() + ":" + q.path("id").asText(), "explanation", q.path("prompt").asText(), q.path("explanation").asText(), "/quizzes/" + qz.path("id").asText()), "", List.of());
                }
            }
            try (InputStream in = new ClassPathResource("content/ai/glossary.json").getInputStream()) {
                for (JsonNode g : mapper.readTree(in).path("entries")) glossary(g);
            }
        } catch (IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
        avgLen = tf.stream().mapToInt(m -> m.values().stream().mapToInt(Integer::intValue).sum()).average().orElse(1);
    }

    /** A formula card: what each symbol stands for, with the formula itself kept as display LaTeX. */
    private void formula(JsonNode f) {
        Map<String, String> symbol = new HashMap<>();
        List<String> parts = new ArrayList<>();
        StringBuilder names = new StringBuilder();
        for (JsonNode v : f.path("variables")) {
            symbol.put(v.path("key").asText(), v.path("latex").asText());
            String unit = v.path("unit").asText("");
            parts.add("$" + v.path("latex").asText() + "$ is the " + v.path("name").asText() + (unit.isBlank() ? "" : " (" + unit + ")"));
            names.append(v.path("name").asText()).append(' ');
        }
        StringBuilder text = new StringBuilder("A formula from " + f.path("topic").asText().toLowerCase(Locale.ROOT) + ".");
        if (!parts.isEmpty()) text.append(" Here ").append(list(parts)).append('.');
        List<String> assumes = new ArrayList<>();
        f.path("assumptions").forEach(a -> assumes.add(a.asText()));
        if (!assumes.isEmpty()) text.append(" It assumes: ").append(String.join("; ", assumes).toLowerCase(Locale.ROOT)).append('.');
        String id = "formula:" + f.path("id").asText();
        add(new Doc(id, "formula", f.path("title").asText(), text.toString(), "/formulas?f=" + f.path("id").asText()), f.path("topic").asText() + " formula equation " + names, List.of());
        // \v{key} marks a variable in the card's LaTeX; show its symbol
        Matcher m = Pattern.compile("\\\\v\\{([^}]*)\\}").matcher(f.path("latex").asText(""));
        StringBuilder shown = new StringBuilder();
        while (m.find()) m.appendReplacement(shown, Matcher.quoteReplacement(symbol.getOrDefault(m.group(1), m.group(1))));
        m.appendTail(shown);
        if (!shown.isEmpty()) latex.put(id, shown.toString());
    }

    private void glossary(JsonNode g) {
        String id = "glossary:" + g.path("id").asText();
        List<String> aliases = new ArrayList<>();
        g.path("aliases").forEach(a -> aliases.add(a.asText()));
        add(new Doc(id, "glossary", g.path("term").asText(), g.path("text").asText(), g.path("url").asText(null)), String.join(" ", aliases) + " " + g.path("subject").asText(""), aliases);
        if (g.hasNonNull("simple")) simple.put(id, g.path("simple").asText());
        if (g.hasNonNull("latex")) latex.put(id, g.path("latex").asText());
    }

    private static String list(List<String> parts) {
        if (parts.size() == 1) return parts.get(0);
        return String.join(", ", parts.subList(0, parts.size() - 1)) + " and " + parts.get(parts.size() - 1);
    }

    private static String join(JsonNode arr) {
        StringBuilder b = new StringBuilder();
        arr.forEach(n -> b.append(n.asText()).append(' '));
        return b.toString();
    }

    private static String plain(String s) {
        return s.toLowerCase(Locale.ROOT).replace('’', '\'').replaceAll("'s\\b", "s").replace("'", "").replaceAll("[^a-z0-9 ]", " ").replaceAll("\\s+", " ").trim();
    }

    /** Lower-case words with a light stemmer (plurals, -ing, -ed, a final e). */
    static List<String> tokens(String text) {
        return tokens(text, false);
    }

    private static List<String> tokens(String text, boolean question) {
        List<String> out = new ArrayList<>();
        // "what's" is what, "Ohm's" is ohm, "don't" is dont; phones type a curly apostrophe
        String flat = text.toLowerCase(Locale.ROOT).replace('’', '\'').replaceAll("'s\\b", "").replace("'", "");
        for (String w : flat.replaceAll("[^a-z0-9 ]", " ").split("\\s+")) {
            if (w.length() < 2 || STOP.contains(w) || question && FILLER.contains(w)) continue;
            if (w.endsWith("ies") && w.length() > 4) w = w.substring(0, w.length() - 3) + "y";
            else if (w.endsWith("ing") && w.length() > 5) w = w.substring(0, w.length() - 3);
            else if (w.endsWith("ed") && w.length() > 4) w = w.substring(0, w.length() - 2);
            else if (w.endsWith("es") && w.length() > 4) w = w.substring(0, w.length() - 2);
            else if (w.endsWith("s") && w.length() > 3 && !w.endsWith("ss")) w = w.substring(0, w.length() - 1);
            if (w.endsWith("e") && w.length() > 4) w = w.substring(0, w.length() - 1);
            if (STOP.contains(w)) continue;
            out.add(w);
        }
        return out;
    }

    /** `extra` is searched but never shown (aliases, a formula's topic); `names` are whole phrases that name the entry. */
    private void add(Doc d, String extra, List<String> names) {
        Map<String, Integer> counts = new HashMap<>();
        // titles count double
        for (String t : tokens(d.title() + " " + d.title() + " " + extra + " " + d.text())) counts.merge(t, 1, Integer::sum);
        docs.add(d);
        tf.add(counts);
        List<String> p = new ArrayList<>();
        String title = plain(d.title().replaceAll("\\s*\\(.*\\)", ""));
        if (title.length() >= 4) p.add(title);
        for (String n : names) if (plain(n).length() >= 3) p.add(plain(n));
        phrases.add(p);
        counts.keySet().forEach(t -> df.merge(t, 1, Integer::sum));
    }

    /** Top hits for a query, optionally limited to some document types. */
    public List<Hit> search(String query, int k, Set<String> types) {
        return search(query, null, k, types);
    }

    /**
     * Top hits for a question. `bias` (the experiment on the bench, say) nudges the ranking but does
     * not count towards coverage: coverage is about the question itself.
     */
    public List<Hit> search(String query, String bias, int k, Set<String> types) {
        Set<String> q = new LinkedHashSet<>(tokens(query, true));
        if (q.isEmpty()) q.addAll(tokens(query, false));
        Set<String> extra = new LinkedHashSet<>(bias == null ? List.of() : tokens(bias, false));
        extra.removeAll(q);
        List<Hit> hits = new ArrayList<>();
        double n = docs.size();
        double total = q.stream().mapToDouble(t -> idf(t, n)).sum();
        String asked = " " + plain(query) + " ";
        for (int i = 0; i < docs.size(); i++) {
            Doc d = docs.get(i);
            if (types != null && !types.contains(d.type())) continue;
            Map<String, Integer> m = tf.get(i);
            int len = m.values().stream().mapToInt(Integer::intValue).sum();
            double score = 0;
            double covered = 0;
            for (String t : q) {
                Integer f = m.get(t);
                if (f == null) continue;
                covered += idf(t, n);
                score += idf(t, n) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * len / avgLen));
            }
            if (score <= 0) continue;
            for (String t : extra) {
                Integer f = m.get(t);
                if (f != null) score += 0.5 * idf(t, n) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * len / avgLen));
            }
            // A question that names a thing ("what is a burette") wants that thing's own entry.
            for (String p : phrases.get(i))
                if (asked.contains(" " + p + " ")) {
                    score *= 2.5;
                    break;
                }
            if (d.type().equals("glossary")) score *= 1.2;
            if (d.type().equals("explanation") && d.id().startsWith("quiz:")) score *= 0.7;
            hits.add(new Hit(d, score, total <= 0 ? 0 : covered / total));
        }
        hits.sort((a, b) -> Double.compare(b.score(), a.score()));
        return hits.subList(0, Math.min(k, hits.size()));
    }

    private double idf(String t, double n) {
        int d = df.getOrDefault(t, 0);
        return Math.log(1 + (n - d + 0.5) / (d + 0.5));
    }

    /** The everyday one-line version of an entry, when it has one. */
    public String simple(String id) {
        return simple.get(id);
    }

    /** Display LaTeX that belongs with an entry (a formula card's formula, a glossary equation). */
    public String latex(String id) {
        return latex.get(id);
    }

    public java.util.Optional<Doc> byId(String id) {
        return docs.stream().filter(d -> d.id().equals(id)).findFirst();
    }

    public int size() {
        return docs.size();
    }
}
