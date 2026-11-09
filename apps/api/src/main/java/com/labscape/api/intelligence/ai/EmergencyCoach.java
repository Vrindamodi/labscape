package com.labscape.api.intelligence.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.labscape.api.intelligence.emergency.Scenarios;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * The assistant inside the emergency simulator: a calm safety coach. Facts come only from the reviewed scenario,
 * looked up by the slug and scene id in the lab context (the client's free text is never trusted for answers).
 * It coaches rather than reading out the scored answer: the first "I don't know" gets a guiding question, and
 * only when asked again in the same scene does it name the safe action.
 */
@Component
public class EmergencyCoach {

    private static final Pattern HELP = Pattern.compile("(don'?t|dont|do not) know|\\bidk\\b|stuck|help|what (do|should|shall|can|now)|first step|next|hint|safest|confus|no idea|what now|clue");
    private static final Pattern WHY_NOT = Pattern.compile("why (not|can'?t|shouldn'?t|don'?t|is|would|wouldn'?t|isn'?t)|can i (use|just|throw|pour|put|switch|turn)|what about|is it (ok|okay|safe|fine)|should i (use|throw|pour|put|switch|turn|try)|how about|\\binstead\\b");
    private static final Set<String> STOP = Set.of("why", "not", "what", "about", "can", "cant", "use", "using", "the", "should", "shouldnt", "just", "safe", "safest", "first",
            "step", "dont", "know", "fire", "this", "that", "with", "put", "throw", "would", "could", "happen", "happens", "instead", "bad", "wrong", "okay", "how", "is",
            "isnt", "and", "for", "you", "your", "her", "him", "she", "she's", "its", "there", "here", "then", "now", "into", "onto", "out", "off", "get", "try", "help", "next",
            "does", "did", "will", "are", "was", "were", "have", "has", "need", "who", "where", "when", "which", "some", "any", "all", "more", "very", "really", "ok");

    private final Scenarios scenarios;

    public EmergencyCoach(Scenarios scenarios) {
        this.scenarios = scenarios;
    }

    /** True when the context is a scenario this coach knows. */
    public boolean handles(JsonNode context) {
        return context != null && "emergency".equals(context.path("surface").asText()) && scenarios.bySlug(context.path("scenarioSlug").asText(null)).isPresent();
    }

    public AiTutor.Facts facts(String message, JsonNode context, String level) {
        JsonNode s = scenarios.bySlug(context.path("scenarioSlug").asText()).orElseThrow();
        String title = s.path("title").asText();
        JsonNode scene = Scenarios.scene(s, context.path("sceneId").asText(""));
        if (scene == null) scene = s.path("scenes").get(0);
        int askedBefore = Math.max(0, context.path("askedBefore").asInt(0));
        String m = message.toLowerCase(Locale.ROOT);
        // no source links: following one would leave the scenario mid-run (the answers all come from this scenario)
        List<AiTutor.Source> sources = List.of();
        List<String> points = new ArrayList<>();
        List<AiTutor.Action> actions = new ArrayList<>();
        AiTutor.Grounding g = new AiTutor.Grounding("content", null, true);

        // "Why not water?", "Can I use ice?": explain that option, from the scenario's own feedback
        if (WHY_NOT.matcher(m).find() || !HELP.matcher(m).find()) {
            Optional<JsonNode> about = mentioned(m, s, scene);
            if (about.isPresent()) {
                JsonNode c = about.get();
                String q = c.path("quality").asText();
                String lead = switch (q) {
                    case "unsafe" -> "**No, that's unsafe here.** ";
                    case "poor" -> "**Not the best idea.** ";
                    case "ok" -> "**That's safe, but there's a better option.** ";
                    default -> "**Actually, that's a good idea.** ";
                };
                points.add(lead + clean(c.path("feedback").asText()));
                if (!q.equals("best")) points.add("Think about what the safe alternative would be. Ask me \"What should I do?\" if you want a nudge.");
                return new AiTutor.Facts(AiTutor.Intent.WHY, level, title, points, null, sources, actions, g, null);
            }
        }

        JsonNode ladder = scene.path("hints");
        String nudge = ladder.size() > 0 ? ladder.get(0).path("text").asText() : scene.path("prompt").asText();
        if (HELP.matcher(m).find()) {
            if (askedBefore == 0 || ladder.size() < 3) {
                // first ask in this scene: a guiding question, never the scored answer
                points.add("Let's think it through together. " + nudge);
                if (ladder.size() > 1) points.add("Have a careful look round the room. Still not sure? Ask me again and I'll tell you the safe move.");
                return new AiTutor.Facts(AiTutor.Intent.NEXT_STEP, level, title, points, null, sources, actions, g, null);
            } else {
                JsonNode act = ladder.get(ladder.size() - 1);
                points.add("**The safe move:** " + act.path("text").asText());
                JsonNode best = Scenarios.best(scene);
                if (best != null) points.add("**Why:** " + clean(best.path("feedback").asText()));
                String target = act.path("target").asText(null);
                if (target != null) actions.add(new AiTutor.Action("highlight", target, "Show me where"));
                return new AiTutor.Facts(AiTutor.Intent.NEXT_STEP, level, title, points, null, sources, actions, g, null);
            }
        }

        // anything else about the emergency: the scenario's reviewed take-aways
        List<String> learnt = learn(m, s);
        if (!learnt.isEmpty()) {
            points.addAll(learnt);
            return new AiTutor.Facts(AiTutor.Intent.CONCEPT, level, title, points, null, sources, actions, g, null);
        }
        points.add("I'm here to coach you through this emergency. " + nudge);
        points.add("You can ask me what to do, or why an option is or isn't safe. In a real emergency in India, call 112.");
        return new AiTutor.Facts(AiTutor.Intent.CONCEPT, level, title, points, null, sources, actions, g, null);
    }

    /** The option the question is about: the current scene first, then the rest of the scenario. */
    private static Optional<JsonNode> mentioned(String m, JsonNode s, JsonNode scene) {
        List<String> words = words(m);
        if (words.isEmpty()) return Optional.empty();
        JsonNode best = null;
        int top = 0;
        List<JsonNode> pool = new ArrayList<>();
        scene.path("choices").forEach(pool::add);
        int local = pool.size();
        for (JsonNode sc : s.path("scenes")) if (sc != scene) sc.path("choices").forEach(pool::add);
        for (int i = 0; i < pool.size(); i++) {
            JsonNode c = pool.get(i);
            StringBuilder text = new StringBuilder(c.path("label").asText());
            for (JsonNode a : Scenarios.actionsOf(c)) {
                String tool = a.path("tool").asText();
                if (tool.equals("hands") || tool.equals("point")) continue;
                text.append(' ').append(tool.replace('-', ' '));
                for (JsonNode t : s.path("tools")) if (t.path("id").asText().equals(tool)) text.append(' ').append(t.path("label").asText());
            }
            List<String> have = words(text.toString().toLowerCase(Locale.ROOT));
            int score = 0;
            for (String w : words) if (have.stream().anyMatch(h -> h.equals(w) || h.startsWith(w) && w.length() >= 4 || w.startsWith(h) && h.length() >= 4)) score++;
            // the current scene wins ties
            if (score > top || score == top && score > 0 && i < local && best != null && !inScene(scene, best)) {
                top = score;
                best = c;
            }
        }
        return Optional.ofNullable(top > 0 ? best : null);
    }

    private static boolean inScene(JsonNode scene, JsonNode choice) {
        for (JsonNode c : scene.path("choices")) if (c == choice) return true;
        return false;
    }

    private static List<String> learn(String m, JsonNode s) {
        List<String> words = words(m);
        List<String> out = new ArrayList<>();
        int top = 0;
        for (JsonNode l : s.path("learn")) {
            List<String> have = words(l.asText().toLowerCase(Locale.ROOT));
            int score = (int) words.stream().filter(w -> have.stream().anyMatch(h -> h.startsWith(w))).count();
            if (score > top) {
                top = score;
                out.clear();
                out.add(l.asText());
            } else if (score == top && score > 0 && out.size() < 2) out.add(l.asText());
        }
        return out;
    }

    private static List<String> words(String text) {
        List<String> out = new ArrayList<>();
        for (String w : text.replace("'", "").split("[^a-z0-9₂]+")) if (w.length() >= 3 && !STOP.contains(w)) out.add(w);
        return out;
    }

    /** Feedback without the story aside ("(Your mum rushes in...)") or the verdict word it opens with ("Right.", "Yes."). */
    private static String clean(String feedback) {
        return feedback.replaceAll("\\s*\\([^)]*\\)\\s*$", "").replaceFirst("^(Right|Yes|Correct|Good)[.!]\\s*", "").trim();
    }
}
