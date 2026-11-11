package com.labscape.api.intelligence.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.labscape.api.contracts.SimulationRequest;
import com.labscape.api.contracts.SimulationResult;
import com.labscape.api.core.library.LibraryCatalogue;
import com.labscape.api.intelligence.chem.Catalogue;
import com.labscape.api.intelligence.chem.Substance;
import com.labscape.api.intelligence.safety.OutcomeCopy;
import com.labscape.api.intelligence.safety.SafetyPipeline;
import com.labscape.api.lab.LabEngineRuntime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * Works out what a question needs and gathers the facts to answer it from LABscape's own sources
 * (build plan 4.4): the lab context, the current protocol step, the chemistry engine and reviewed
 * content. Every answer, from either model, is built only from these facts. The tools the plan
 * lists live here: getSimulationResult, getProtocolStep, searchLibrary, recommendExperiment,
 * openFormula and highlight (the last three are UI actions).
 */
@Component
public class AiTutor {

    public enum Intent { NEXT_STEP, WHY, MIX, SIMPLER, FORMULA, RECOMMEND, MISTAKE, CONCEPT, SMALLTALK }

    public record Source(String title, String url, String type) {}

    public record Action(String type, String target, String label) {}

    /** Where the answer came from: "engine" (a SimulationResult), "content", "context" or "none". */
    public record Grounding(String source, String outcome, boolean modelled) {}

    public record Facts(Intent intent, String level, String experimentTitle, List<String> points, String equationLatex, List<Source> sources,
            List<Action> actions, Grounding grounding, String fixedText) {}

    public static final String NOT_MODELLED = "LABscape doesn't have a validated model for that combination, so I won't guess what it produces.";

    private static final Pattern NEXT = Pattern.compile("what (should|do|shall) i do( next)?|next step|what now|i'?m stuck|what do i do|how do i (start|begin)|help with (this|the) step");
    private static final Pattern WHY = Pattern.compile("why (did|is|does|was|has)|what happened|what'?s happening|change[ds]? colou?r|turn(ed)? (pink|blue|red|green|cloudy|milky)|why .*(fizz|bubbl|precipitat|hot|warm|pop)");
    private static final Pattern MIX = Pattern.compile("\\b(mix|mixing|mixed|add|adding|react|reacting|combine|combining|pour)\\b|what (happens|forms|is formed|do (i|you) get|is made|is produced|will form)|\\bproduc");
    private static final Pattern SIMPLER = Pattern.compile("simpl|easier|like i'?m (five|5|ten)|don'?t understand|explain (it )?again");
    private static final Pattern FORMULA = Pattern.compile("\\bformula\\b|equation for|how (do i|to) calculate|work out the");
    private static final Pattern RECOMMEND = Pattern.compile("what (should|can) i try|recommend|suggest (an|another|a)|another experiment|what else");
    private static final Pattern MISTAKE = Pattern.compile("what did i do wrong|my mistake|why (did|was) i (lose|marked|penali)|deviation|why did i lose");
    private static final Pattern GREETING = Pattern.compile("^(hi+|hello+|hey+|hiya|yo|namaste|hola|good (morning|afternoon|evening))( there| labscape| assistant)?[!.\\s]*$");
    private static final Pattern THANKS = Pattern.compile("^(thanks|thank you|thankyou|thx|ty|cheers|great|cool|nice|ok|okay|got it)( a lot| so much| very much)?[!.\\s]*$");
    private static final Pattern ABOUT = Pattern.compile("^((who|what) are you|what can you (do|help( me)?( with)?)|what do you (do|know)|how (do|can) you (work|help)( me)?|help|are you (an? )?(ai|robot|bot|human|real|person))[!?.\\s]*$");
    /** Asking outright what substances make together: an answer may only come from the engine or a general lesson. */
    private static final Pattern MIXING = Pattern.compile("\\b(mix|mixes|mixing|mixed|react|reacts|reacting|reacted|combine|combines|combining|combined)\\b");

    /** What a question about an idea may be answered from: never a protocol step, which only makes sense on the bench. */
    private static final Set<String> CONCEPT_SOURCES = Set.of("glossary", "formula", "element", "equipment", "experiment", "explanation");

    public static final String NOT_COVERED = "I don't have a LABscape lesson that answers that, so I won't guess.";

    /** Everyday names for things in the chemistry catalogue. */
    private static final Map<String, String> COMMON_NAMES = Map.ofEntries(Map.entry("acetic acid", "ethanoic-acid"), Map.entry("bicarbonate of soda", "baking-soda"),
            Map.entry("bicarb", "baking-soda"), Map.entry("sodium bicarbonate", "nahco3"), Map.entry("caustic soda", "naoh"), Map.entry("lye", "naoh"),
            Map.entry("bleach", "bleach"), Map.entry("salt water", "nacl"), Map.entry("muriatic acid", "hcl"), Map.entry("water", "water"));

    /** Bracketed parts of a catalogue name that describe it rather than name it. */
    private static final Set<String> NOT_A_NAME = Set.of("dilute", "concentrated", "white", "blackboard", "freshly made", "ammonia", "saturated fat");

    private record Named(String phrase, Substance substance) {}

    private final Retrieval retrieval;
    private final LibraryCatalogue catalogue;
    private final LabEngineRuntime engine;
    private final SafetyPipeline safety;
    private final EmergencyCoach coach;
    private final Catalogue substances = Catalogue.load();
    private final List<Named> named = names(substances);

    public AiTutor(Retrieval retrieval, LibraryCatalogue catalogue, LabEngineRuntime engine, SafetyPipeline safety, EmergencyCoach coach) {
        this.coach = coach;
        this.retrieval = retrieval;
        this.catalogue = catalogue;
        this.engine = engine;
        this.safety = safety;
    }

    static String level(JsonNode context, String explicit) {
        String l = explicit != null ? explicit : context == null ? "school" : context.path("userLevel").asText("school");
        return switch (l) {
            case "beginner", "exploring" -> "beginner";
            case "undergraduate" -> "undergraduate";
            case "advanced", "postgraduate", "teacher" -> "advanced";
            default -> "school";
        };
    }

    public static Intent intent(String message) {
        String m = message.toLowerCase(Locale.ROOT).trim();
        if (GREETING.matcher(m).find() || THANKS.matcher(m).find() || ABOUT.matcher(m).find()) return Intent.SMALLTALK;
        if (SIMPLER.matcher(m).find()) return Intent.SIMPLER;
        if (MISTAKE.matcher(m).find()) return Intent.MISTAKE;
        if (NEXT.matcher(m).find()) return Intent.NEXT_STEP;
        if (RECOMMEND.matcher(m).find()) return Intent.RECOMMEND;
        if (MIX.matcher(m).find() && !WHY.matcher(m).find()) return Intent.MIX;
        if (WHY.matcher(m).find()) return Intent.WHY;
        if (FORMULA.matcher(m).find()) return Intent.FORMULA;
        return Intent.CONCEPT;
    }

    private static String plain(String s) {
        return s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9() ]", " ").replaceAll("\\s+", " ").trim();
    }

    /**
     * Every phrase a learner might use for a catalogue substance: its full name, the name without its
     * brackets ("Vinegar (white)" is vinegar, "Copper(II) sulfate" is copper sulfate), a bracketed
     * second name ("Propanone (acetone)") and a few everyday names. Longest first.
     */
    private static List<Named> names(Catalogue catalogue) {
        List<Named> out = new ArrayList<>();
        Map<String, Substance> byId = new LinkedHashMap<>();
        for (Substance s : catalogue.all()) {
            byId.putIfAbsent(s.id(), s);
            Set<String> phrases = new java.util.LinkedHashSet<>();
            phrases.add(plain(s.name()));
            phrases.add(plain(s.name().replaceAll("\\s*\\([^)]*\\)", " ")));
            Matcher m = Pattern.compile("\\(([^)]*)\\)").matcher(s.name());
            while (m.find()) {
                String inner = plain(m.group(1));
                if (inner.matches("[a-z][a-z -]{4,}") && !NOT_A_NAME.contains(inner)) phrases.add(inner);
            }
            for (String phrase : phrases) if (phrase.length() > 2) out.add(new Named(phrase, s));
        }
        COMMON_NAMES.forEach((phrase, id) -> {
            if (byId.containsKey(id)) out.add(new Named(phrase, byId.get(id)));
        });
        out.sort(Comparator.comparingInt((Named n) -> -n.phrase().length()));
        return out;
    }

    /** Allowlisted substances named in the question, by any of their names or by formula (longest names first). */
    List<Substance> substancesIn(String message) {
        String lower = " " + plain(message) + " ";
        List<Substance> found = new ArrayList<>();
        for (Named n : named) {
            Substance s = n.substance();
            if (!lower.contains(" " + n.phrase() + " ")) continue;
            lower = lower.replace(" " + n.phrase() + " ", "  ");
            if (found.stream().noneMatch(f -> f.id().equals(s.id()) || f.formula() != null && f.formula().equals(s.formula()))) found.add(s);
        }
        for (Substance s : substances.all()) {
            boolean byFormula = s.formula() != null && s.formula().length() > 1 && Pattern.compile("(?<![A-Za-z])" + Pattern.quote(s.formula()) + "(?![a-z])").matcher(message).find();
            if (byFormula && found.stream().noneMatch(f -> f.id().equals(s.id()) || f.formula() != null && f.formula().equals(s.formula()))) found.add(s);
        }
        return found;
    }

    /** Words that look like substances but are not in the allowlist ("caffeine", "toothpaste"). */
    private static final Pattern THINGS = Pattern.compile("(?:mix|combine|add|react|pour|put)\\s+(?:some\\s+)?([a-z][a-z -]{2,30}?)\\s+(?:and|with|into|to|in)\\s+([a-z][a-z -]{2,30}?)(?:[?.!,:]|$| solution| what)");

    public Facts analyse(String message, JsonNode context, String explicitLevel, String previousUserMessage, UUID user) {
        String level = level(context, explicitLevel);
        // inside the emergency simulator the assistant is a safety coach, grounded in the scenario
        if (coach.handles(context)) return coach.facts(message, context, level);
        Intent intent = intent(message);
        if (intent == Intent.SMALLTALK) return smallTalk(message, level);
        if (intent == Intent.SIMPLER && previousUserMessage != null && !previousUserMessage.isBlank()) {
            Facts f = analyse(previousUserMessage, context, "beginner", null, user);
            List<String> shorter = f.points().stream().map(AiTutor::firstSentence).limit(2).toList();
            return new Facts(Intent.SIMPLER, "beginner", f.experimentTitle(), shorter, null, f.sources(), f.actions(), f.grounding(), f.fixedText());
        }
        Optional<LibraryCatalogue.Experiment> exp = Optional.empty();
        if (context != null && context.hasNonNull("experimentId")) exp = catalogue.byId(context.path("experimentId").asText());
        Optional<JsonNode> content = exp.flatMap(e -> engine.content(e.slug()));
        String title = exp.map(LibraryCatalogue.Experiment::title).orElse(null);
        List<String> points = new ArrayList<>();
        List<Source> sources = new ArrayList<>();
        List<Action> actions = new ArrayList<>();
        String equation = null;

        switch (intent) {
            case NEXT_STEP -> {
                if (content.isPresent()) {
                    JsonNode steps = content.get().path("steps");
                    String cur = context.path("currentStepId").asText(null);
                    JsonNode step = null;
                    for (JsonNode s : steps) if (s.path("id").asText().equals(cur)) step = s;
                    if (step == null) for (JsonNode s : steps) {
                        boolean done = false;
                        for (JsonNode d : context.path("completedStepIds")) done |= d.asText().equals(s.path("id").asText());
                        if (!done) {
                            step = s;
                            break;
                        }
                    }
                    if (step == null) points.add("You've finished every step. Head to Observe to explain what you saw.");
                    else {
                        int n = 1;
                        for (JsonNode s : steps) {
                            if (s == step) break;
                            n++;
                        }
                        points.add("**Step " + n + ": " + step.path("title").asText() + ".** " + step.path("instruction").asText());
                        JsonNode hintIds = step.path("hints");
                        if (hintIds.isArray() && !hintIds.isEmpty()) {
                            String hint = content.get().path("hints").path(hintIds.get(0).asText()).path("text").asText(null);
                            if (hint != null) points.add("Tip: " + hint);
                        }
                        String target = step.path("from").asText(null);
                        if (target != null && highlightable(context, target)) actions.add(new Action("highlight", target, "Show me"));
                    }
                    sources.add(new Source(title + " protocol", "/library/" + exp.get().slug(), "step"));
                    return facts(intent, level, title, points, null, sources, actions, new Grounding("context", null, true), null);
                }
                points.add("Open an experiment and I can walk you through its steps. In the meantime, the Library lists every lab.");
                actions.add(new Action("open", "/library", "Open the Library"));
                return facts(intent, level, title, points, null, sources, actions, new Grounding("none", null, true), null);
            }
            case WHY -> {
                JsonNode last = context == null ? null : context.path("lastResult");
                if (last != null && last.isObject() && last.has("presentation")) return fromResult(intent, level, title, last, sources, actions);
                if (content.isPresent()) {
                    JsonNode o = content.get().path("observations");
                    points.add(o.path("whatHappened").asText());
                    String why = o.path("why").asText();
                    points.add(level.equals("beginner") ? firstSentence(why) : why);
                    if (!level.equals("beginner")) equation = o.path("equationLatex").asText(null);
                    sources.add(new Source(title + ": what happened and why", "/library/" + exp.get().slug(), "explanation"));
                    return facts(intent, level, title, points, equation, sources, actions, new Grounding("content", null, true), null);
                }
            }
            case MIX -> {
                // "add", "pour" and "what happens" also turn up in questions about ideas; only a named
                // substance or an explicit "mix X with Y" is a question for the chemistry engine
                String asked = message.toLowerCase(Locale.ROOT);
                if (!substancesIn(message).isEmpty() || THINGS.matcher(asked).find()) return mix(message, level, title, user);
                if (MIXING.matcher(asked).find()) {
                    // substances the catalogue does not hold ("chlorine reacts with ammonia"): unless the glossary
                    // has the general idea ("acids react with metals"), this is an unmodelled mixture, said as such
                    var general = retrieval.search(message, null, 1, Set.of("glossary"));
                    // every word of the question has to be in that entry: a near miss names things it does not cover
                    if (general.isEmpty() || !answers(general.get(0)) || general.get(0).coverage() < 0.85) return mix(message, level, title, user);
                }
            }
            case FORMULA -> {
                var hits = retrieval.search(message, title, 1, Set.of("formula"));
                if (!hits.isEmpty() && hits.get(0).coverage() >= 0.5) {
                    var d = hits.get(0).doc();
                    points.add("**" + d.title() + "**: " + d.text());
                    sources.add(new Source(d.title(), d.url(), d.type()));
                    actions.add(new Action("openFormula", d.id().substring("formula:".length()), "Open " + d.title()));
                    return facts(intent, level, title, points, level.equals("beginner") ? null : retrieval.latex(d.id()), sources, actions, new Grounding("content", null, true), null);
                }
            }
            case RECOMMEND -> {
                String subject = context == null ? null : context.path("subject").asText(null);
                var hits = retrieval.search(message + " " + (title == null ? "" : title) + " " + (subject == null ? "" : subject), 6, Set.of("experiment"));
                for (var h : hits) {
                    String slug = h.doc().id().substring(4);
                    if (exp.isPresent() && exp.get().slug().equals(slug)) continue;
                    if (actions.size() >= 3) break;
                    points.add("**" + h.doc().title() + "**: " + firstSentence(h.doc().text()));
                    actions.add(new Action("open", h.doc().url(), "Open " + h.doc().title()));
                    sources.add(new Source(h.doc().title(), h.doc().url(), "experiment"));
                }
                if (!points.isEmpty()) return facts(intent, level, title, points, null, sources, actions, new Grounding("content", null, true), null);
            }
            case MISTAKE -> {
                JsonNode devs = context == null ? null : context.path("deviations");
                if (devs != null && devs.isArray() && !devs.isEmpty()) {
                    for (JsonNode d : devs) {
                        String code = d.path("code").asText().replace('-', ' ');
                        var hits = retrieval.search(code + " " + (title == null ? "" : title), 1, Set.of("explanation", "equipment", "step"));
                        points.add("**" + capital(code) + "** (" + d.path("severity").asText() + ")" + (hits.isEmpty() ? "" : ": " + firstSentence(hits.get(0).doc().text())));
                    }
                    return facts(intent, level, title, points, null, sources, actions, new Grounding("context", null, true), null);
                }
                points.add("No mistakes recorded on this run so far. Keep going!");
                return facts(intent, level, title, points, null, sources, actions, new Grounding("context", null, true), null);
            }
            default -> { }
        }
        // ideas: the entry that is actually about the question, or an honest "not covered"
        List<Retrieval.Hit> hits = retrieval.search(message, title, 4, CONCEPT_SOURCES);
        if (hits.isEmpty() || !answers(hits.get(0))) {
            points.add(NOT_COVERED);
            points.add("I can explain core ideas in chemistry, physics and maths, walk you through an experiment, find a formula, element or piece of equipment, "
                    + "or tell you what the chemistry engine predicts for a mixture. Try rephrasing, or ask about one of those.");
            actions.add(new Action("open", "/library", "Open the Library"));
            return facts(intent, level, title, points, null, sources, actions, new Grounding("none", null, true), null);
        }
        boolean beginner = level.equals("beginner");
        Retrieval.Hit top = hits.get(0);
        equation = cite(top.doc(), beginner, points, sources, actions);
        if (!beginner) for (Retrieval.Hit h : hits.subList(1, hits.size())) {
            // a second entry only when it is nearly as good a match and about something else
            if (!answers(h) || h.score() < 0.75 * top.score() || sameThing(h.doc(), top.doc())) continue;
            cite(h.doc(), false, points, sources, actions);
            break;
        }
        return facts(intent, level, title, points, equation, sources, actions, new Grounding("content", null, true), null);
    }

    /** A hit answers the question when it matches well and holds most of what was asked, not one stray word. */
    private static boolean answers(Retrieval.Hit h) {
        return h.score() >= 1.5 && h.coverage() >= 0.6;
    }

    private static boolean sameThing(Retrieval.Doc a, Retrieval.Doc b) {
        return a.title().equalsIgnoreCase(b.title()) || a.url() != null && a.url().equals(b.url());
    }

    /** Adds one entry as a point with its source and "open" action; returns the display LaTeX that goes with it. */
    private String cite(Retrieval.Doc d, boolean beginner, List<String> points, List<Source> sources, List<Action> actions) {
        String easy = retrieval.simple(d.id());
        String text = !beginner ? d.text() : easy != null ? easy : firstSentence(d.text()) + " " + secondSentence(d.text());
        points.add("**" + d.title() + "**: " + text.trim());
        if (d.url() != null) {
            sources.add(new Source(d.title(), d.url(), d.type()));
            if (d.url().startsWith("/formulas?f=")) actions.add(new Action("openFormula", d.url().substring("/formulas?f=".length()), d.type().equals("formula") ? "Open " + d.title() : "Open the formula"));
            else actions.add(new Action("open", d.url(), d.type().equals("glossary") ? openLabel(d.url()) : "Open " + d.title()));
        }
        return beginner ? null : retrieval.latex(d.id());
    }

    private static String openLabel(String url) {
        if (url.startsWith("/playground")) return "Try it in the Playground";
        if (url.startsWith("/periodic-table")) return "Open the periodic table";
        if (url.startsWith("/equipment")) return "Open the equipment guide";
        if (url.startsWith("/library/") || url.startsWith("/lab/")) return "Open the experiment";
        return "Open";
    }

    /** Greetings, thanks and "what can you do": say what the assistant is for, with questions to try. */
    private Facts smallTalk(String message, String level) {
        String m = message.toLowerCase(Locale.ROOT).trim();
        List<String> points = new ArrayList<>();
        List<Action> actions = new ArrayList<>();
        if (THANKS.matcher(m).find()) points.add("You're welcome! Ask me anything else about your experiment, or about an idea in chemistry, physics or maths.");
        else {
            points.add(GREETING.matcher(m).find() ? "Hello! I'm LABscape's science assistant." : "I'm LABscape's science assistant.");
            points.add("I can explain core ideas in chemistry, physics and maths, walk you through the experiment on your bench, tell you what LABscape's chemistry engine "
                    + "predicts for a mixture, and find a formula, element or piece of equipment.");
            points.add("Try: \"What is a mole?\", \"Explain Ohm's law\", \"What happens if I mix vinegar and baking soda?\" or \"Recommend an experiment\".");
            actions.add(new Action("open", "/library", "Open the Library"));
        }
        return facts(Intent.SMALLTALK, level, null, points, null, List.of(), actions, new Grounding("none", null, true), null);
    }

    private static Facts facts(Intent intent, String level, String title, List<String> points, String eq, List<Source> sources, List<Action> actions, Grounding g, String fixed) {
        return new Facts(intent, level, title, List.copyOf(points), eq, List.copyOf(sources), List.copyOf(actions), g, fixed);
    }

    private static boolean highlightable(JsonNode context, String id) {
        for (JsonNode h : context.path("highlightableIds")) if (h.asText().equals(id)) return true;
        return true; // the client ignores ids it cannot show
    }

    /** getSimulationResult(): the engine decides; the assistant only reports. */
    private Facts mix(String message, String level, String title, UUID user) {
        List<Substance> subs = substancesIn(message);
        List<String> points = new ArrayList<>();
        List<Source> sources = new ArrayList<>();
        List<Action> actions = new ArrayList<>();
        if (subs.size() < 2) {
            Matcher m = THINGS.matcher(message.toLowerCase(Locale.ROOT));
            String named = m.find() ? m.group(1).trim() + " and " + m.group(2).trim() : null;
            points.add(NOT_MODELLED);
            points.add((named == null ? "I could not find both substances" : "I could not find both " + named) + " in LABscape's list of lab substances, and I only describe reactions its chemistry engine has a reviewed model for.");
            if (!subs.isEmpty()) points.add(subs.get(0).name() + ": " + subs.get(0).description());
            points.add("You can try supported combinations safely in the chemistry Playground.");
            actions.add(new Action("open", "/playground/chemistry", "Open the Playground"));
            return facts(Intent.MIX, level, title, points, null, sources, actions, new Grounding("none", "unsupported", false), null);
        }
        if (!safety.enabled()) {
            points.add(NOT_MODELLED);
            points.add("The chemistry engine is switched off right now, so I can't check this combination.");
            return facts(Intent.MIX, level, title, points, null, sources, actions, new Grounding("none", "unavailable", false), null);
        }
        List<SimulationRequest.Input> inputs = new ArrayList<>();
        for (Substance s : subs.subList(0, Math.min(4, subs.size()))) {
            double amount = Math.max(s.limits().min(), Math.min(s.limits().max(), s.limits().unit().equals("mL") ? 20 : 2));
            inputs.add(new SimulationRequest.Input(s.id(), amount, s.limits().unit(), null));
        }
        SimulationResult r;
        try {
            r = safety.resolve(new SimulationRequest("ai-" + UUID.randomUUID().toString().substring(0, 12), "chemistry", "sandbox",
                    "ai:" + (user == null ? "anon" : user), null, null, null, inputs, new SimulationRequest.Conditions(22.0, null, null, null)), "ai:" + user);
        } catch (RuntimeException e) {
            // cooldown, engine off or a validation problem: say so, never guess
            points.add(NOT_MODELLED);
            points.add("I can't check this combination with the chemistry engine right now.");
            return facts(Intent.MIX, level, title, points, null, sources, actions, new Grounding("none", "unavailable", false), null);
        }
        String names = String.join(" and ", subs.stream().map(Substance::name).toList());
        sources.add(new Source("LABscape chemistry engine", "/playground/chemistry", "engine"));
        actions.add(new Action("open", "/playground/chemistry", "Try it in the Playground"));
        String outcome = r.outcome().name().toLowerCase(Locale.ROOT);
        switch (r.outcome()) {
            case PROHIBITED -> {
                return facts(Intent.MIX, level, title, List.of(OutcomeCopy.PROHIBITED_MESSAGE), null, List.of(), List.of(), new Grounding("engine", outcome, true), OutcomeCopy.PROHIBITED_MESSAGE);
            }
            case UNSUPPORTED -> {
                points.add(NOT_MODELLED);
                points.add(OutcomeCopy.UNSUPPORTED_MESSAGE);
                subs.forEach(s -> points.add(s.name() + ": " + s.description()));
                return facts(Intent.MIX, level, title, points, null, sources, actions, new Grounding("engine", outcome, false), null);
            }
            case REACTION -> {
                return fromPresentation(Intent.MIX, level, title, r.presentation(), r.equationLatex(), sources, actions, outcome);
            }
            default -> {
                points.add("For " + names + ": " + (r.presentation() == null ? outcome : r.presentation().title() + ". " + nz(r.presentation().message())));
                if (r.presentation() != null && r.presentation().neededTool() != null) points.add("It needs: " + r.presentation().neededTool() + ".");
                return facts(Intent.MIX, level, title, points, null, sources, actions, new Grounding("engine", outcome, true), null);
            }
        }
    }

    private Facts fromResult(Intent intent, String level, String title, JsonNode last, List<Source> sources, List<Action> actions) {
        JsonNode p = last.path("presentation");
        List<String> points = new ArrayList<>();
        points.add(p.path("title").asText() + ". " + p.path("message").asText(""));
        p.path("observations").forEach(o -> points.add(o.asText()));
        String eq = level.equals("beginner") ? null : last.path("equationLatex").asText(null);
        sources.add(new Source("LABscape chemistry engine", "/playground/chemistry", "engine"));
        return facts(intent, level, title, points, eq, sources, actions, new Grounding("engine", last.path("outcome").asText(null), !"unsupported".equals(last.path("outcome").asText())), null);
    }

    private Facts fromPresentation(Intent intent, String level, String title, SimulationResult.Presentation p, String equation, List<Source> sources, List<Action> actions, String outcome) {
        List<String> points = new ArrayList<>();
        points.add("LABscape's chemistry engine models this. " + p.title() + ". " + nz(p.message()));
        if (p.observations() != null) p.observations().stream().limit(level.equals("beginner") ? 2 : 6).forEach(points::add);
        return facts(intent, level, title, points, level.equals("beginner") ? null : equation, sources, actions, new Grounding("engine", outcome, true), null);
    }

    /** The grounded tutor's own wording (used when no external model is configured). */
    public String compose(Facts f) {
        if (f.fixedText() != null) return f.fixedText();
        StringBuilder b = new StringBuilder();
        if (f.intent() == Intent.SIMPLER) b.append("In short: ");
        for (int i = 0; i < f.points().size(); i++) {
            if (i > 0) b.append(f.intent() == Intent.RECOMMEND || f.intent() == Intent.MISTAKE ? "\n\n- " : "\n\n");
            else if (f.intent() == Intent.RECOMMEND || f.intent() == Intent.MISTAKE) b.append(f.intent() == Intent.RECOMMEND ? "You might like:\n\n- " : "Here's what was flagged:\n\n- ");
            b.append(f.points().get(i));
        }
        if (f.equationLatex() != null && !f.equationLatex().isBlank()) b.append("\n\n$$").append(f.equationLatex()).append("$$");
        return b.toString().trim();
    }

    static String firstSentence(String s) {
        if (s == null) return "";
        int i = s.indexOf(". ");
        return i < 0 ? s : s.substring(0, i + 1);
    }

    static String secondSentence(String s) {
        if (s == null) return "";
        int i = s.indexOf(". ");
        if (i < 0) return "";
        String rest = s.substring(i + 2);
        int j = rest.indexOf(". ");
        return j < 0 ? rest : rest.substring(0, j + 1);
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static String capital(String s) {
        return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    /** Facts as plain data for an external model's prompt. */
    public Map<String, Object> asData(Facts f) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("intent", f.intent().name());
        m.put("level", f.level());
        if (f.experimentTitle() != null) m.put("experiment", f.experimentTitle());
        m.put("facts", f.points());
        if (f.equationLatex() != null) m.put("equationLatex", f.equationLatex());
        m.put("grounding", f.grounding());
        return m;
    }
}
