package com.labscape.api.intelligence.ai;

import java.text.Normalizer;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * Input and output guard for the assistant (build plan 4.4). Deterministic, so it is testable and
 * runs before any model call: weapons, explosives, harmful synthesis, violence and self-harm.
 * Text is normalised first (case, accents, l33t spelling, spaced-out letters) so simple
 * obfuscation does not get through. Lab context is checked separately: anything in it is data,
 * and instructions hidden there are stripped, never followed.
 */
@Component
public class AiGuard {

    public enum Category { NONE, EXPLOSIVES, WEAPONS, HARMFUL_SYNTHESIS, VIOLENCE, SELF_HARM, HOUSEHOLD_MIXING }

    public record Verdict(boolean blocked, Category category, String reply) {
        static Verdict ok() {
            return new Verdict(false, Category.NONE, null);
        }
    }

    /** Identical refusal for every harmful request: it never names what was asked for. */
    public static final String REFUSAL = "I can't help with that. LABscape never gives instructions for making explosives, weapons, drugs or anything meant to hurt people. "
            + "I'm happy to explain the science safely instead: how reactions release energy, why some substances are hazardous, or how to work safely in a lab.";

    public static final String HOUSEHOLD = "Never mix cleaning products or other household chemicals: some combinations release toxic gases. "
            + "If it has happened, get everyone into fresh air, open windows if it is safe, and call 112 or a poison information centre. "
            + "I can explain why some mixtures are dangerous in general terms, or show you lab-safety lessons.";

    public static final String SELF_HARM = "I'm really sorry you're feeling this way. You don't have to deal with it alone. "
            + "Please talk to someone now: in India you can call Tele-MANAS on 14416 (free, 24/7) or the KIRAN helpline on 1800-599-0019. "
            + "If you are in danger right now, call 112. A parent, teacher or friend you trust can help too. I'm here to keep you company with something calmer whenever you like.";

    private static final List<String> EXPLOSIVES = List.of("bomb", "explosive", "explosiv", "ied", "tatp", "acetone peroxide", "nitroglycerin", "rdx", "petn", "hmx",
            "semtex", "anfo", "detonator", "blasting cap", "molotov", "napalm", "grenade", "landmine", "flash powder", "black powder", "gunpowder", "thermite", "pipe bomb");
    private static final List<String> WEAPONS = List.of("nerve agent", "sarin", "tabun", "soman", "novichok", "vx gas", "mustard gas", "phosgene", "ricin", "anthrax",
            "botulinum", "chemical weapon", "bioweapon", "biological weapon", "poison gas", "toxic gas", "dirty bomb", "weaponi", "homemade gun", "ghost gun", "3d printed gun",
            "silencer", "chlorine gas", "poison them", "poison someone", "poison him", "poison her", "poison people", "cyanide");
    private static final List<String> DRUGS = List.of("methamphetamine", "meth", "fentanyl", "heroin", "cocaine", "crack cocaine", "mdma", "lsd", "ghb", "date rape");
    private static final List<String> INTENT = List.of("how to", "how do", "how can", "how would", "make", "build", "create", "synthes", "produce", "cook", "assemble",
            "prepare", "manufactur", "recipe", "ingredient", "step by step", "instruction", "detail", "formula for", "obtain", "get hold", "where to buy", "buy", "steps",
            "explain how", "tell me how", "print the", "put in", "use to", "knocks", "make a");
    private static final List<String> VIOLENCE = List.of("kill someone", "kill somebody", "kill people", "kill my", "murder", "hurt someone", "hurt people", "harm someone",
            "attack on", "attack my", "shoot up", "without getting caught", "hurt him", "hurt her", "injure someone");
    private static final List<String> SELF = List.of("kill myself", "killing myself", "suicide", "suicidal", "end my life", "want to die", "wanna die", "hurt myself",
            "harm myself", "self harm", "selfharm", "cutting myself", "cut myself", "not worth living", "better off dead", "overdose");
    private static final Pattern HOUSEHOLD_MIX = Pattern.compile("(bleach|ammonia|cleaning product|drain cleaner|toilet cleaner).*(mix|combine|together)|(mix|combine).*(bleach|cleaning product)");
    private static final Pattern HARM_PURPOSE = Pattern.compile("(hurt|harm|knock(s)? (people|someone|them) out|kill|poison|attack|injure)");

    /** Lower case, accents off, l33t spellings undone, punctuation to spaces. */
    static String normalise(String raw) {
        String s = Normalizer.normalize(raw == null ? "" : raw, Normalizer.Form.NFKD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT);
        s = s.replace('0', 'o').replace('3', 'e').replace('1', 'i').replace('4', 'a').replace('5', 's').replace('7', 't').replace('@', 'a').replace('$', 's');
        s = s.replaceAll("[^a-z ]", " ").replaceAll("\\s+", " ").trim();
        return s;
    }

    private static final Pattern LETTER_RUN = Pattern.compile("(?:\\b[a-z] ){2,}[a-z]\\b");

    /**
     * Only the runs of spaced-out single letters ("a b o m b" -> "abomb"), joined. Matching inside
     * these without word boundaries catches obfuscation without touching ordinary words.
     */
    static String squash(String norm) {
        Matcher m = LETTER_RUN.matcher(norm);
        StringBuilder out = new StringBuilder();
        while (m.find()) out.append(m.group().replace(" ", "")).append(' ');
        return out.toString().trim();
    }

    private static boolean any(String text, List<String> words) {
        return any(text, words, true);
    }

    /** With boundaries off (for squashed "b o m b" text), any occurrence counts. */
    private static boolean any(String text, List<String> words, boolean boundaries) {
        for (String w : words) {
            if (!boundaries) {
                if (w.length() >= 4 && text.replace(" ", "").contains(w.replace(" ", ""))) return true;
                continue;
            }
            // short words need word boundaries ("ied" must not match "applied"); plurals still count
            if (w.length() <= 5 ? Pattern.compile("\\b" + Pattern.quote(w) + "(s|es)?\\b").matcher(text).find() : text.contains(w)) return true;
        }
        return false;
    }

    private static final Pattern C4 = Pattern.compile("\\bc-?4\\b", Pattern.CASE_INSENSITIVE);

    public Verdict check(String message) {
        // "C4" would be lost when digits are normalised, so check the raw text for it
        if (message != null && C4.matcher(message).find() && any(normalise(message), INTENT)) return new Verdict(true, Category.EXPLOSIVES, REFUSAL);
        String n = normalise(message);
        String s = squash(n);
        for (String t : List.of(n, s)) {
            // the squashed form ("b o m b" -> "bomb") is matched without word boundaries
            boolean b = t == n;
            if (any(t, SELF, b)) return new Verdict(true, Category.SELF_HARM, SELF_HARM);
            if (any(t, VIOLENCE, b)) return new Verdict(true, Category.VIOLENCE, REFUSAL);
            boolean intent = any(n, INTENT);
            boolean harm = HARM_PURPOSE.matcher(t).find();
            if (any(t, EXPLOSIVES, b) && (intent || harm)) return new Verdict(true, Category.EXPLOSIVES, REFUSAL);
            if (any(t, WEAPONS, b) && (intent || harm)) return new Verdict(true, Category.WEAPONS, REFUSAL);
            if (any(t, DRUGS, b) && intent) return new Verdict(true, Category.HARMFUL_SYNTHESIS, REFUSAL);
            if (HOUSEHOLD_MIX.matcher(t).find()) return new Verdict(true, harm ? Category.WEAPONS : Category.HOUSEHOLD_MIXING, harm ? REFUSAL : HOUSEHOLD);
        }
        return Verdict.ok();
    }

    /**
     * Output check: model text must not contain hazardous instructions either. Named hazards alone
     * (in a refusal or a safety explanation) are fine; hazards with how-to language are not.
     */
    public boolean outputUnsafe(String text) {
        String n = normalise(text);
        boolean howTo = Pattern.compile("\\b(step \\d|first,? (mix|add|take)|you will need|ingredients|combine .* then|heat .* until)").matcher(n).find();
        return howTo && (any(n, EXPLOSIVES) || any(n, WEAPONS) || any(n, DRUGS));
    }

    /** Lab context is data. Returns true if it carries a hidden harmful instruction (it is then dropped). */
    public boolean contextInjected(String contextJson) {
        if (contextJson == null || contextJson.isEmpty()) return false;
        String n = normalise(contextJson);
        boolean redirect = Pattern.compile("\\b(ignore (your|all|previous)|system|new instruction|assistant|admin|print the|you are now|developer mode)\\b").matcher(n).find();
        return check(contextJson).blocked() || (redirect && (any(n, EXPLOSIVES) || any(n, WEAPONS) || any(n, DRUGS)));
    }
}
