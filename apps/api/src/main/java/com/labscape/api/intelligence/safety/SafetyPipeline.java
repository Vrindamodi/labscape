package com.labscape.api.intelligence.safety;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labscape.api.contracts.SimulationRequest;
import com.labscape.api.contracts.SimulationResult;
import com.labscape.api.contracts.SimulationResult.Fidelity;
import com.labscape.api.contracts.SimulationResult.Outcome;
import com.labscape.api.contracts.SimulationResult.Presentation;
import com.labscape.api.contracts.SimulationResult.ReactionSummary;
import com.labscape.api.intelligence.chem.Catalogue;
import com.labscape.api.intelligence.chem.ChemistryEngine;
import com.labscape.api.intelligence.chem.ChemistryEngine.Portion;
import com.labscape.api.intelligence.chem.Lore;
import com.labscape.api.intelligence.chem.Substance;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * The validation and safety engine (build plan 4.1). Every playground mix runs this pipeline, in
 * order: schema check, allowlist (catalogue + quantity limits), prohibited-pattern check, reaction
 * lookup, outcome resolution + audit. There is no client-only path to a reaction.
 */
@Service
public class SafetyPipeline {

    public static final double MIN_TEMP_C = 5;
    public static final double MAX_TEMP_C = 90;
    /** A solution boiling dry over a burner. Only the evaporate condition reaches it: the hot plate stops at {@link #MAX_TEMP_C}. */
    public static final double BOIL_C = 100;
    public static final double DEFAULT_TEMP_C = 22;
    public static final double VESSEL_CAPACITY_ML = 150;

    private final Catalogue catalogue;
    private final SafetyRuleBook rules;
    private final ChemistryEngine engine;
    private final ProbeGuard guard;
    private final SafetyAuditSink audit;
    private final ObjectMapper mapper;
    private final boolean enabled;

    public SafetyPipeline(
            Catalogue catalogue,
            SafetyRuleBook rules,
            ChemistryEngine engine,
            ProbeGuard guard,
            SafetyAuditSink audit,
            ObjectMapper mapper,
            @Value("${labscape.safety.engine-enabled:true}") boolean enabled) {
        this.catalogue = catalogue;
        this.rules = rules;
        this.engine = engine;
        this.guard = guard;
        this.audit = audit;
        this.mapper = mapper;
        this.enabled = enabled;
    }

    public boolean enabled() {
        return enabled;
    }

    public SimulationResult resolve(SimulationRequest req, String sessionKey) {
        if (!enabled) throw new SafetyExceptions.EngineDisabled();
        String session = sessionKey == null || sessionKey.isBlank() ? req.attemptId() : sessionKey;

        // 1. Schema check (bean validation already ran on the request shape).
        if (!"chemistry".equals(req.subject())) throw new SafetyExceptions.UnsupportedSubject(req.subject());

        // 2. Allowlist: every substance is catalogued and every quantity is within its limits. A chained request
        //    (bases: earlier mixes poured, split or filtered into this vessel) is checked all the way down.
        Tree tree = new Tree();
        List<Portion> portions = walk(req.inputs(), req.bases(), 1, 0, evaporate(req.conditions()), tree);
        Map<String, Double> totals = new LinkedHashMap<>();
        for (Portion p : portions) totals.merge(p.substance().id(), p.amount(), Double::sum);

        Optional<SimulationResult> range = checkRanges(req, totals, tree);
        if (range.isPresent()) {
            audit(session, req, range.get(), null, false, tree.summary);
            return range.get();
        }
        double temperature = temperature(req);

        // 3. Prohibited-pattern check, over everything that has ever gone into this vessel or the ones it was
        //    poured from: filtering something off does not make a blocked combination allowed. Cooldown first,
        //    so probing cannot continue.
        Duration remaining = guard.remainingCooldown(session);
        if (!remaining.isZero()) throw new SafetyExceptions.Cooldown(remaining);
        Optional<SafetyRuleBook.Rule> rule = rules.match(tree.substances);
        if (rule.isEmpty() && !tree.driedTags.isEmpty()) {
            // An oxidiser that was boiled dry is a solid oxidiser now, and is held to the same rules as the one in the jar.
            Optional<SafetyRuleBook.Rule> dry = rules.match(tree.substances, tree.driedTags);
            if (dry.isPresent() && evaporate(req.conditions())) {
                // It has not been dried yet: say why it must not be, without counting it as a blocked mix.
                SimulationResult result = unsafeToDry(req.id());
                audit(session, req, result, dry.get().id(), false, tree.summary);
                return result;
            }
            rule = dry;
        }
        if (rule.isPresent()) {
            boolean flagged = guard.recordProhibited(session);
            SimulationResult result = prohibited(req.id());
            audit(session, req, result, rule.get().id(), flagged, tree.summary);
            return result;
        }

        // 4. Reaction lookup, 5. outcome resolution. Earlier vessels are replayed first; what they hand on is
        //    where this one starts.
        boolean ignition = req.conditions() != null && Boolean.TRUE.equals(req.conditions().ignition());
        boolean evaporate = evaporate(req.conditions());
        SimulationResult result;
        try {
            ChemistryEngine.State carried = carry(req.bases());
            Carried how = describe(req.bases());
            double liquid = (carried == null ? 0 : carried.liquidMl()) + liquidMl(portions);
            if (liquid > VESSEL_CAPACITY_ML + 1e-6) {
                result = overflow(req.id(), liquid);
            } else if (how != null && portions.isEmpty() && (carried == null || carried.isEmpty())) {
                result = nothingCameAcross(req.id(), how);
            } else {
                ChemistryEngine.Result r = engine.run(carried, portions, evaporate ? BOIL_C : temperature, ignition, evaporate);
                result = toResult(req.id(), r, portions, how);
            }
        } catch (Unmodelled e) {
            result = toResult(req.id(), e.result, portions, null);
        } catch (TooFull e) {
            result = overflow(req.id(), e.liquidMl);
        }
        audit(session, req, result, null, false, tree.summary);
        return result;
    }

    // -------------------------------------------------------------------------------- chained vessels

    private static final int MAX_STAGES = 12;
    private static final int MAX_DEPTH = 6;

    /** Everything a (possibly chained) request names, for the allowlist, the limits, the prohibited check and the audit. */
    private static final class Tree {
        final List<Substance> substances = new ArrayList<>();
        /** Catalogue id -> the amount that is effectively in this vessel, after every split along the way. */
        final Map<String, Double> effective = new LinkedHashMap<>();
        final List<String> summary = new ArrayList<>();
        /** Rule tags the mixture has taken on by being boiled dry (see {@link #driedTags}). */
        final java.util.Set<String> driedTags = new java.util.HashSet<>();
        int stages;
        boolean tooLong;
        /** An earlier stage that used more or less of something than its validated range. */
        Substance outOfRange;
        boolean outOfRangeAbove;
    }

    /**
     * How the contents of this vessel got here, for the wording of the result. {@code step} is what was done to
     * the whole of one earlier mixture before it was carried on: "dry" (boiled dry), "heated" (heated strongly), or null.
     */
    private record Carried(String keep, double fraction, int sources, String step) {}

    private static boolean evaporate(SimulationRequest.Conditions c) {
        return c != null && Boolean.TRUE.equals(c.evaporate());
    }

    private static final class Unmodelled extends RuntimeException {
        final transient ChemistryEngine.Result result;

        Unmodelled(ChemistryEngine.Result result) {
            super(null, null, false, false);
            this.result = result;
        }
    }

    private static final class TooFull extends RuntimeException {
        final double liquidMl;

        TooFull(double liquidMl) {
            super(null, null, false, false);
            this.liquidMl = liquidMl;
        }
    }

    /** Resolves one stage's inputs against the catalogue and records the whole tree beneath it. Returns that stage's portions. */
    private List<Portion> walk(List<SimulationRequest.Input> inputs, List<SimulationRequest.Base> bases, double share, int depth,
            boolean dried, Tree tree) {
        tree.stages++;
        if (tree.stages > MAX_STAGES || depth > MAX_DEPTH) {
            tree.tooLong = true;
            return List.of();
        }
        List<Portion> portions = new ArrayList<>();
        Map<String, Double> stage = new LinkedHashMap<>();
        for (SimulationRequest.Input in : inputs) {
            Substance s = catalogue.find(in.ref()).orElseThrow(() -> new SafetyExceptions.NotInCatalogue(in.ref()));
            if (!s.limits().unit().equals(in.unit())) throw new SafetyExceptions.UnitMismatch(in.ref(), s.limits().unit());
            portions.add(new Portion(s, in.amount()));
            tree.substances.add(s);
            if (dried) tree.driedTags.addAll(driedTags(s));
            tree.effective.merge(s.id(), in.amount() * share, Double::sum);
            stage.merge(s.id(), in.amount(), Double::sum);
            tree.summary.add(">".repeat(depth) + in.ref() + ":" + in.amount() + in.unit());
        }
        if (depth > 0) {
            // an earlier vessel was a real mix too: it had to respect the same limits when it was made
            for (Map.Entry<String, Double> e : stage.entrySet()) {
                Substance s = catalogue.find(e.getKey()).orElseThrow();
                if (tree.outOfRange == null && (e.getValue() > s.limits().max() + 1e-9 || e.getValue() < s.limits().min() - 1e-9)) {
                    tree.outOfRange = s;
                    tree.outOfRangeAbove = e.getValue() > s.limits().max();
                }
            }
        }
        if (bases != null) {
            for (SimulationRequest.Base b : bases) {
                // what was done to the earlier mixture changes what it hands on, so it belongs in the trail (and the cache key)
                SimulationRequest.Conditions c = b.conditions();
                String done = (c != null && c.temperatureC() != null && Math.round(c.temperatureC()) != Math.round(DEFAULT_TEMP_C)
                        ? " " + Math.round(c.temperatureC()) + "C" : "")
                        + (c != null && Boolean.TRUE.equals(c.ignition()) ? " lit" : "") + (evaporate(c) ? " dry" : "");
                tree.summary.add(">".repeat(depth + 1) + "[" + b.keep() + " x" + b.fraction() + done + "]");
                // boiling a vessel dry dries everything that had gone into it before
                walk(b.inputs(), b.bases(), share * b.fraction(), depth + 1, dried || evaporate(c), tree);
            }
        }
        return portions;
    }

    /**
     * What a solution counts as once it has been boiled dry. The rule book tells a solid oxidiser (the crystals
     * in the jar) from its solution, which is far tamer; dried, the solution is the solid.
     */
    private static java.util.Set<String> driedTags(Substance s) {
        java.util.Set<String> out = new java.util.HashSet<>();
        if (s.species() == null) return out;
        for (String k : s.species().keySet()) {
            if ("NO3-".equals(k)) out.add("nitrate_oxidiser");
            if ("MnO4-".equals(k) || "Cr2O7^2-".equals(k) || "CrO4^2-".equals(k) || "IO3-".equals(k)) out.add("strong_oxidiser_solid");
        }
        return out;
    }

    private static SimulationResult unsafeToDry(String requestId) {
        return new SimulationResult(requestId, Outcome.PROCEDURE_MISMATCH, "EVAPORATE_UNSAFE_RESIDUE", null, null, null,
                List.of(), List.of(), List.of(), Fidelity.APPROXIMATE, List.of(),
                new Presentation(OutcomeCopy.MISMATCH_TITLE, "This would leave an oxidiser as a dry solid, together with something "
                        + "it reacts with violently. A solution of it is safe to work with; the dry mixture is not, so it stays off the burner.",
                        List.of(), List.of(), "heater", null, List.of(), List.of(), List.of(), List.of()));
    }

    /** Replays the earlier vessels and adds up the parts of them that were poured or filtered into this one. */
    private ChemistryEngine.State carry(List<SimulationRequest.Base> bases) {
        if (bases == null || bases.isEmpty()) return null;
        ChemistryEngine.State sum = null;
        for (SimulationRequest.Base b : bases) {
            ChemistryEngine.State inner = carry(b.bases());
            List<Portion> portions = new ArrayList<>();
            for (SimulationRequest.Input in : b.inputs()) portions.add(new Portion(catalogue.find(in.ref()).orElseThrow(), in.amount()));
            double liquid = (inner == null ? 0 : inner.liquidMl()) + liquidMl(portions);
            if (liquid > VESSEL_CAPACITY_ML + 1e-6) throw new TooFull(liquid);
            ChemistryEngine.State after;
            if (portions.isEmpty() && (inner == null || inner.isEmpty())) {
                continue; // an empty vessel hands on nothing
            } else {
                double t = b.conditions() != null && b.conditions().temperatureC() != null ? b.conditions().temperatureC() : DEFAULT_TEMP_C;
                boolean ign = b.conditions() != null && Boolean.TRUE.equals(b.conditions().ignition());
                boolean dry = evaporate(b.conditions());
                ChemistryEngine.Result r = engine.run(inner, portions, dry ? BOIL_C : Math.max(MIN_TEMP_C, Math.min(MAX_TEMP_C, t)), ign, dry);
                if (r.state() == null) throw new Unmodelled(r);
                after = r.state();
            }
            ChemistryEngine.State part = after.part(b.keep(), b.fraction());
            sum = sum == null ? part : sum.plus(part);
        }
        return sum;
    }

    private static Carried describe(List<SimulationRequest.Base> bases) {
        if (bases == null || bases.isEmpty()) return null;
        SimulationRequest.Base first = bases.get(0);
        if (bases.size() > 1) return new Carried("all", 1, bases.size(), null);
        boolean whole = "all".equals(first.keep()) && first.fraction() >= 1 - 1e-9;
        String step = !whole ? null : evaporate(first.conditions()) ? "dry"
                : first.conditions() != null && Boolean.TRUE.equals(first.conditions().ignition()) ? "heated" : null;
        return new Carried(first.keep(), first.fraction(), 1, step);
    }

    private static double liquidMl(List<Portion> portions) {
        double liquid = 0;
        for (Portion p : portions) {
            Substance s = p.substance();
            if (!s.isSolid() && !s.isGas()) liquid += "drops".equals(s.limits().unit()) ? p.amount() * 0.05 : p.amount();
        }
        return liquid;
    }

    private SimulationResult overflow(String requestId, double liquid) {
        return outOfRange(requestId, "VESSEL_OVERFLOW",
                String.format(Locale.ROOT, "That's %s mL of liquid - the beaker only holds %s mL. Use smaller amounts.",
                        fmt(Math.round(liquid * 10) / 10.0), fmt(VESSEL_CAPACITY_ML)),
                null);
    }

    /** Filtering a clear solution, or keeping the liquid from a dry solid: an honest "nothing here". */
    private static SimulationResult nothingCameAcross(String requestId, Carried how) {
        boolean residue = "residue".equals(how.keep());
        boolean dry = "dry".equals(how.step());
        String title = dry ? "Nothing left behind" : residue ? "Nothing on the filter paper" : "Nothing came through";
        String line = dry ? "The water boiled away and left nothing behind: there was nothing dissolved in it."
                : residue ? "There was no solid to catch: everything in that mixture was dissolved, so it all ran through the filter paper."
                : "There was no liquid to pour or filter, so this vessel is still empty.";
        return new SimulationResult(requestId, Outcome.NO_REACTION, "NO_OBSERVABLE_REACTION", null, null, null,
                List.of(), List.of(), List.of(new SimulationResult.Measurement("temperature", DEFAULT_TEMP_C, "°C"),
                        new SimulationResult.Measurement("volume", 0, "mL")),
                Fidelity.APPROXIMATE, List.of(),
                new Presentation(title, OutcomeCopy.NO_REACTION_MESSAGE, List.of(line), List.of(), null, null, List.of(), List.of(),
                        List.of(), List.of()));
    }

    // -------------------------------------------------------------------------------- ranges

    private Optional<SimulationResult> checkRanges(SimulationRequest req, Map<String, Double> totals, Tree tree) {
        if (tree.tooLong) {
            return Optional.of(outOfRange(req.id(), "TOO_MANY_STEPS",
                    "This mixture has been poured, split, filtered and heated too many times to follow. Start a fresh one.", null));
        }
        if (tree.outOfRange != null) {
            Substance s = tree.outOfRange;
            return Optional.of(outOfRange(req.id(), tree.outOfRangeAbove ? "QTY_ABOVE_LIMIT" : "QTY_BELOW_LIMIT",
                    String.format(Locale.ROOT, "Adjust the amount: this model is validated for %s to %s %s of %s.",
                            fmt(s.limits().min()), fmt(s.limits().max()), s.limits().unit(), s.displayName()),
                    s.id()));
        }
        double liquid = 0;
        for (Map.Entry<String, Double> e : totals.entrySet()) {
            Substance s = catalogue.find(e.getKey()).orElseThrow();
            Substance.Limits l = s.limits();
            // what is added now must be a measurable amount; what is in the vessel altogether must not pass the limit
            double amount = e.getValue() < l.min() - 1e-9 ? e.getValue() : Math.max(e.getValue(), tree.effective.getOrDefault(s.id(), 0.0));
            if (amount > l.max() + 1e-9 || amount < l.min() - 1e-9) {
                String code = amount > l.max() ? "QTY_ABOVE_LIMIT" : "QTY_BELOW_LIMIT";
                return Optional.of(outOfRange(req.id(), code,
                        String.format(Locale.ROOT, "Adjust the amount: this model is validated for %s to %s %s of %s.",
                                fmt(l.min()), fmt(l.max()), l.unit(), s.displayName()),
                        s.id()));
            }
            if (!s.isSolid() && !s.isGas()) liquid += "drops".equals(l.unit()) ? amount * 0.05 : amount;
        }
        if (liquid > VESSEL_CAPACITY_ML) {
            return Optional.of(outOfRange(req.id(), "VESSEL_OVERFLOW",
                    String.format(Locale.ROOT, "That's %s mL of liquid - the beaker only holds %s mL. Use smaller amounts.",
                            fmt(liquid), fmt(VESSEL_CAPACITY_ML)),
                    null));
        }
        double t = temperature(req);
        if (t < MIN_TEMP_C || t > MAX_TEMP_C) {
            return Optional.of(outOfRange(req.id(), "TEMP_OUT_OF_RANGE",
                    String.format(Locale.ROOT, "Adjust the temperature: the water bath works from %s to %s °C.",
                            fmt(MIN_TEMP_C), fmt(MAX_TEMP_C)),
                    null));
        }
        return Optional.empty();
    }

    private static double temperature(SimulationRequest req) {
        return req.conditions() != null && req.conditions().temperatureC() != null
                ? req.conditions().temperatureC() : DEFAULT_TEMP_C;
    }

    // -------------------------------------------------------------------------------- what to try next

    /**
     * One thing worth doing to the mixture next: a shelf item to add ({@code kind} "add", with its catalogue
     * {@code ref}) or a bench tool to use ("heat" or "spark"). {@code teaser} hints at what will happen without
     * giving the answer away; {@code discoveryId} is the journal entry it would unlock, when there is one.
     */
    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
    public record TryNext(String kind, String ref, String name, String teaser, String discoveryId, String type) {}

    private record Scored(TryNext hint, double score) {}

    private static final int HINT_LIMIT = 8;
    private static final int HINT_CACHE = 256;
    /** A few elements that are fun to add; the other 100-odd would drown the shelf chemicals. */
    private static final java.util.Set<String> HINT_ELEMENTS = java.util.Set.of(
            "el-Na", "el-K", "el-Li", "el-Ca", "el-Mg", "el-Al", "el-Zn", "el-Fe", "el-Cu", "el-S", "el-C", "el-I", "el-H", "el-O", "el-Cl");

    private final Map<String, List<TryNext>> hintCache = java.util.Collections.synchronizedMap(
            new LinkedHashMap<>(64, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, List<TryNext>> eldest) {
                    return size() > HINT_CACHE;
                }
            });

    /**
     * Suggestions for the playground's "Try adding" chips: every catalogued substance is test-mixed into the
     * current beaker with the same engine that resolves real mixes, and the ones that start a new reaction are
     * returned, most familiar chemicals first and one per kind of reaction. Prohibited combinations are skipped
     * silently (a missing hint says nothing about why), mixes that give off a toxic gas are never suggested,
     * and nothing here is audited or counted against the probe guard because nothing is actually mixed.
     */
    public List<TryNext> tryNext(SimulationRequest req) {
        if (!enabled || !"chemistry".equals(req.subject())) return List.of();
        Tree tree = new Tree();
        List<Portion> portions;
        try {
            portions = walk(req.inputs(), req.bases(), 1, 0, false, tree);
        } catch (SafetyExceptions.NotInCatalogue | SafetyExceptions.UnitMismatch e) {
            return List.of();
        }
        if (tree.tooLong || tree.outOfRange != null) return List.of();
        double temperature = Math.max(MIN_TEMP_C, Math.min(MAX_TEMP_C, temperature(req)));
        boolean ignition = req.conditions() != null && Boolean.TRUE.equals(req.conditions().ignition());
        // the audit summary spells out the whole tree in order, so it doubles as the cache key
        String key = String.join("|", tree.summary) + "|" + Math.round(temperature) + (ignition ? "|i" : "");
        List<TryNext> cached = hintCache.get(key);
        if (cached != null) return cached;
        List<TryNext> out;
        try {
            out = computeTryNext(carry(req.bases()), tree.substances, tree.driedTags, portions, temperature, ignition);
        } catch (Unmodelled | TooFull e) {
            out = List.of();
        }
        hintCache.put(key, out);
        return out;
    }

    private List<TryNext> computeTryNext(ChemistryEngine.State carried, List<Substance> mixture, java.util.Set<String> driedTags,
            List<Portion> portions, double temperature, boolean ignition) {
        if (rules.match(mixture, driedTags).isPresent()) return List.of();
        if (portions.isEmpty() && (carried == null || carried.isEmpty())) return List.of();
        ChemistryEngine.Result base = engine.run(carried, portions, temperature, ignition);
        if (base.kind() == ChemistryEngine.Kind.UNSUPPORTED) return List.of();
        java.util.Set<String> seen = new java.util.HashSet<>();
        java.util.Set<String> baseDiscoveries = new java.util.HashSet<>();
        for (ChemistryEngine.Reaction x : base.reactions()) {
            seen.add(x.id());
            if (x.discoveryId() != null) baseDiscoveries.add(x.discoveryId());
        }
        boolean baseToxic = toxic(base);
        double room = VESSEL_CAPACITY_ML - liquidMl(portions) - (carried == null ? 0 : carried.liquidMl());

        // Best hint per kind of result, so three chips never all say "add another acid".
        Map<String, Scored> best = new LinkedHashMap<>();
        java.util.function.BiConsumer<String, Scored> offer =
                (group, sc) -> best.merge(group, sc, (a, b) -> b.score() > a.score() ? b : a);

        // Bench tools first: would warming it, or a flame, start something?
        if (temperature < 60) {
            fresh(engine.run(carried, portions, 80, ignition), seen, baseToxic).ifPresent(x -> offer.accept("tool:heat",
                    new Scored(new TryNext("heat", null, "Heat it", "Warm it on the hot plate and watch.", x.discoveryId(), x.type()), 6)));
        }
        if (!ignition) {
            fresh(engine.run(carried, portions, temperature, true), seen, baseToxic).ifPresent(x -> offer.accept("tool:spark",
                    new Scored(new TryNext("spark", null, "Use the flame", "Bring a flame near it.", x.discoveryId(), x.type()), 6)));
        }

        if (portions.size() < 6) {
            java.util.Set<String> present = new java.util.HashSet<>();
            mixture.forEach(s -> present.add(s.id()));
            int total = catalogue.all().size();
            int index = -1;
            for (Substance cand : catalogue.all()) {
                index++;
                if (present.contains(cand.id())) continue;
                if (cand.isElement() && !HINT_ELEMENTS.contains(cand.id())) continue;
                double amount = sampleAmount(cand, room);
                if (amount <= 0) continue;
                List<Portion> trial = new ArrayList<>(portions);
                trial.add(new Portion(cand, amount));
                List<Substance> trialMix = new ArrayList<>(mixture);
                trialMix.add(cand);
                if (rules.match(trialMix, driedTags).isPresent()) continue;
                ChemistryEngine.Reaction x = fresh(engine.run(carried, trial, temperature, ignition), seen, baseToxic).orElse(null);
                if (x == null) continue;
                boolean indicator = "indicator".equals(x.type());
                boolean newDiscovery = x.discoveryId() != null && !baseDiscoveries.contains(x.discoveryId());
                double score = (newDiscovery ? 3 : 0) + (indicator ? -2 : 0) + 2.0 * (1 - index / (double) total)
                        + ("household".equals(cand.category()) ? 0.5 : 0) + (cand.isElement() ? -1 : 0);
                String group = x.discoveryId() != null ? "d:" + x.discoveryId() : "t:" + x.type();
                offer.accept(group, new Scored(
                        new TryNext("add", cand.id(), cand.displayName(), teaser(x), x.discoveryId(), x.type()), score));
            }
        }
        return best.values().stream().sorted(Comparator.comparingDouble(Scored::score).reversed())
                .limit(HINT_LIMIT).map(Scored::hint).toList();
    }

    /** The amount the playground picks up by default, cut down to what still fits in the beaker. */
    private static double sampleAmount(Substance s, double roomMl) {
        Substance.Limits l = s.limits();
        boolean pours = !s.isSolid() && !s.isGas() && !"drops".equals(l.unit());
        double want = s.isSolid() ? 1 : "drops".equals(l.unit()) ? 3 : s.isGas() ? 50 : 10;
        if (pours) want = Math.min(want, roomMl);
        want = Math.min(want, l.max());
        return want < l.min() ? -1 : want;
    }

    /** The main reaction in {@code trial} that the beaker is not already doing, unless the trial is unsafe to suggest. */
    private static Optional<ChemistryEngine.Reaction> fresh(ChemistryEngine.Result trial, java.util.Set<String> seen,
            boolean baseToxic) {
        if (trial.kind() != ChemistryEngine.Kind.REACTION) return Optional.empty();
        if (!baseToxic && toxic(trial)) return Optional.empty();
        return trial.chemical().stream().filter(x -> !seen.contains(x.id()))
                .max(Comparator.comparingDouble((ChemistryEngine.Reaction x) -> "indicator".equals(x.type()) ? 0 : 1)
                        .thenComparingDouble(ChemistryEngine.Reaction::extentMol));
    }

    private static boolean toxic(ChemistryEngine.Result r) {
        return r.cues().stream().anyMatch(c -> "toxic".equals(c.get("hazard")));
    }

    /**
     * A hint at the kind of thing to look for, never the answer. The journal's type for the discovery is used
     * when there is one (it tells displacement from other redox, for instance), else the reaction's own type.
     */
    private static String teaser(ChemistryEngine.Reaction x) {
        String type = x.type();
        if (x.discoveryId() != null) {
            for (com.labscape.api.intelligence.chem.Discovery d : com.labscape.api.intelligence.chem.Discovery.ALL) {
                if (d.id().equals(x.discoveryId())) type = d.type();
            }
        }
        return switch (type == null ? "" : type) {
            case "precipitation" -> "A solid should appear out of nowhere.";
            case "gas" -> "Expect some fizzing.";
            case "neutralisation" -> "They should cancel each other out.";
            case "displacement" -> "One metal should push another out.";
            case "redox" -> "Watch for a colour change.";
            case "indicator" -> "Its colour tells you acid or alkali.";
            case "complex" -> "A new colour should appear.";
            case "combustion" -> "It should catch light.";
            case "synthesis" -> "Two elements could join into something new.";
            case "hydration" -> "It reacts with the water itself.";
            case "hydrolysis" -> "Water should split it apart.";
            case "catalysis", "enzyme" -> "One of them speeds things up without being used up.";
            case "esterification" -> "It could make a fruity smell.";
            case "denaturation" -> "The protein should clump together.";
            case "polymer" -> "It could turn stretchy.";
            case "fermentation" -> "Slow bubbles should appear.";
            case "equilibrium" -> "The colour can flip back and forth.";
            case "dehydration" -> "Water gets pulled right out of it.";
            case "decomposition" -> "Heat should break it apart.";
            case "addition" -> "A colour should vanish.";
            default -> "Something new should form.";
        };
    }

    /** Says what the student actually saw when nothing chemical happened, instead of one fixed "no reaction" line. */
    private static String noReactionTitle(ChemistryEngine.Result r, List<Portion> portions, Carried how) {
        if (how != null && portions.isEmpty() && r.reactions().isEmpty()) {
            if ("dry".equals(how.step())) return "What the water left behind";
            if ("heated".equals(how.step())) return "After strong heating";
            return "residue".equals(how.keep()) ? "The residue" : "filtrate".equals(how.keep()) ? "The filtrate"
                    : how.sources() > 1 ? "Poured together - no reaction" : how.fraction() < 1 ? "A share of the mixture" : "Poured across";
        }
        if (how == null && portions.size() == 1) return portions.get(0).substance().name() + " on its own";
        if (!r.reactions().isEmpty()) return r.reactions().get(0).name();
        boolean layers = false, dissolves = false;
        double deltaC = 0;
        for (Map<String, Object> c : r.cues()) {
            Object kind = c.get("kind");
            if ("layers".equals(kind)) layers = true;
            if ("dissolve".equals(kind) && ((Number) c.getOrDefault("fraction", 1)).doubleValue() > 0.05) dissolves = true;
            if ("temperature".equals(kind)) deltaC = ((Number) c.getOrDefault("deltaC", 0)).doubleValue();
        }
        if (layers) return "Two layers - they don't mix";
        if (dissolves) {
            return deltaC <= -1 ? "It dissolves and the beaker cools"
                    : deltaC >= 1 ? "It dissolves and the beaker warms" : "It dissolves - no reaction";
        }
        if (how != null) return "No reaction";
        boolean allLiquid = portions.stream().allMatch(p -> !p.substance().isSolid() && !p.substance().isGas());
        return allLiquid ? "They mix - no reaction" : OutcomeCopy.NO_REACTION_TITLE;
    }

    // -------------------------------------------------------------------------------- results

    static SimulationResult prohibited(String requestId) {
        return new SimulationResult(requestId, Outcome.PROHIBITED, OutcomeCopy.PROHIBITED_REASON, null, null, null,
                List.of(), List.of(), List.of(), Fidelity.QUALITATIVE, List.of(),
                new Presentation(OutcomeCopy.PROHIBITED_TITLE, OutcomeCopy.PROHIBITED_MESSAGE, List.of(), List.of(),
                        null, null, OutcomeCopy.PROHIBITED_ALTERNATIVES, List.of(), List.of(), List.of()));
    }

    private SimulationResult outOfRange(String requestId, String code, String message, String focusRef) {
        return new SimulationResult(requestId, Outcome.OUT_OF_RANGE, code, null, null, null,
                List.of(), List.of(), List.of(), Fidelity.QUALITATIVE, List.of(),
                new Presentation(OutcomeCopy.OUT_OF_RANGE_TITLE, message, List.of(), List.of(),
                        "TEMP_OUT_OF_RANGE".equals(code) ? "heater" : null, focusRef, List.of(), List.of(), List.of(), List.of()));
    }

    private static SimulationResult.Participants participants(ChemistryEngine.Reaction x) {
        if (x.participants() == null) return null;
        java.util.function.Function<com.labscape.api.intelligence.chem.Latex.Term, SimulationResult.EquationTerm> map =
                t -> new SimulationResult.EquationTerm(t.coef(), t.formula(), t.charge(), t.state());
        return new SimulationResult.Participants(
                x.participants().lhs().stream().map(map).toList(), x.participants().rhs().stream().map(map).toList());
    }

    private static List<SimulationResult.CompoundInfo> compounds(ChemistryEngine.Result r) {
        return r.products().stream()
                .filter(p -> p.mol() > 1e-9)
                .map(p -> new SimulationResult.CompoundInfo(p.formula(), Lore.name(p.formula()), p.phase(),
                        Lore.colour(p.formula()), noteFor(p.formula())))
                .toList();
    }

    private static String noteFor(String formula) {
        Lore.Gas g = Lore.GASES.get(formula);
        return g == null ? null : "Smell: " + g.smell().toLowerCase(Locale.ROOT);
    }

    private static List<String> facts(ChemistryEngine.Result r, List<Portion> portions) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (ChemistryEngine.Reaction x : r.reactions()) {
            String f = Lore.reactionFact(x.discoveryId());
            if (f != null) out.add(f);
        }
        for (Portion p : portions) {
            if (p.substance().isElement()) out.add(p.substance().element().fact());
        }
        boolean smelly = r.cues().stream().anyMatch(c -> c.containsKey("smell") || "smoke".equals(c.get("kind")));
        if (smelly) out.add(Lore.SNIFF_SAFETY);
        return out.stream().limit(5).toList();
    }

    /** What a vessel that was just poured, split or filtered holds, in a sentence, before anything new is added. */
    private static String carriedLine(ChemistryEngine.Result r, Carried how) {
        ChemistryEngine.State st = r.state();
        List<String> solids = new ArrayList<>();
        if (st != null) {
            st.solids().keySet().forEach(f -> solids.add(Lore.lower(Lore.name(f))));
            st.solidKeys().forEach(k -> solids.add(Lore.lower(Lore.name(k.replace("(s)", "").replace("(anh)", "")))));
            solids.addAll(st.dryCrystals());
        }
        String named = solids.isEmpty() ? "" : " (" + String.join(", ", solids.stream().distinct().limit(3).toList()) + ")";
        if ("dry".equals(how.step())) {
            return solids.isEmpty() ? "The water was boiled away, and nothing was left behind."
                    : "This is what was left in the evaporating basin when the water had boiled away" + named
                            + ". Add water and what dissolved before dissolves again.";
        }
        if ("heated".equals(how.step())) {
            return solids.isEmpty() ? "This was heated strongly, and nothing solid is left."
                    : "This is what strong heating left behind" + named + ". Add something to it to test it.";
        }
        if ("residue".equals(how.keep())) {
            return "This is the residue: the solid" + named + " that stayed on the filter paper. Add something to it to test it.";
        }
        if ("filtrate".equals(how.keep())) {
            return "This is the filtrate: the liquid that ran through the filter paper, with everything that was dissolved still in it. "
                    + "The solid stayed behind.";
        }
        if (how.sources() > 1) return "The two mixtures are now in one vessel.";
        return how.fraction() < 1 ? "A share of the mixture, poured across so it can be tested on its own" + (solids.isEmpty() ? "." : ", solid" + named + " and all.")
                : "The whole mixture, poured across.";
    }

    private SimulationResult toResult(String requestId, ChemistryEngine.Result r, List<Portion> portions, Carried how) {
        List<JsonNode> cues = r.cues().stream().map(c -> (JsonNode) mapper.valueToTree(c)).toList();
        List<SimulationResult.Measurement> measurements = r.measurements().stream()
                .map(m -> new SimulationResult.Measurement(m.key(), m.value(), m.unit())).toList();
        List<ReactionSummary> summaries = r.reactions().stream()
                .map(x -> new ReactionSummary(x.id(), x.name(), x.type(), x.equationLatex(), x.discoveryId(), participants(x)))
                .toList();
        List<SimulationResult.CompoundInfo> compounds = compounds(r);
        List<String> facts = facts(r, portions);
        List<String> discoveries = r.reactions().stream().map(ChemistryEngine.Reaction::discoveryId)
                .filter(d -> d != null).distinct().toList();
        List<String> reasons = List.copyOf(new LinkedHashSet<>(r.reasons()));

        return switch (r.kind()) {
            case UNSUPPORTED -> new SimulationResult(requestId, Outcome.UNSUPPORTED, r.reasonCode(), null, null, null,
                    List.of(), List.of(), List.of(), Fidelity.QUALITATIVE, List.of(),
                    new Presentation(OutcomeCopy.UNSUPPORTED_TITLE, OutcomeCopy.UNSUPPORTED_MESSAGE,
                            List.of(r.unsupportedMessage(), "Unsupported doesn't mean impossible - it means this combination isn't modelled yet."),
                            List.of(), null, null, OutcomeCopy.UNSUPPORTED_OPTIONS, List.of(), List.of(), facts));
            case PROCEDURE_MISMATCH -> new SimulationResult(requestId, Outcome.PROCEDURE_MISMATCH, r.reasonCode(), null, null, null,
                    List.of(), cues, measurements, Fidelity.APPROXIMATE, List.of(),
                    new Presentation(OutcomeCopy.MISMATCH_TITLE, r.mismatches().get(0).message(), List.of(), List.of(),
                            "heater", null, List.of(), List.of(), List.of(), facts));
            case NEEDS_CONDITIONS -> new SimulationResult(requestId, Outcome.NEEDS_CONDITIONS, r.reasonCode(), null, null, null,
                    List.of(), cues, measurements, Fidelity.APPROXIMATE, List.of(),
                    new Presentation(OutcomeCopy.NEEDS_CONDITIONS_TITLE, r.pending().get(0).message(), List.of(), List.of(),
                            r.pending().get(0).tool(), r.pending().get(0).ref(), List.of(), List.of(), List.of(), facts));
            case NO_REACTION -> {
                List<String> obs = new ArrayList<>();
                if (how != null && portions.isEmpty()) obs.add(carriedLine(r, how));
                obs.addAll(r.observations());
                obs.addAll(reasons);
                yield new SimulationResult(requestId, Outcome.NO_REACTION, r.reasonCode(), null, null, null,
                        List.of(), cues, measurements, Fidelity.APPROXIMATE, List.of(),
                        new Presentation(noReactionTitle(r, portions, how), OutcomeCopy.NO_REACTION_MESSAGE, obs, summaries,
                                null, null, List.of(), discoveries, compounds, facts));
            }
            case REACTION -> {
                List<ChemistryEngine.Reaction> chemical = r.chemical();
                ChemistryEngine.Reaction primary = chemical.stream()
                        .filter(x -> !"indicator".equals(x.type()))
                        .max(Comparator.comparingDouble(ChemistryEngine.Reaction::extentMol))
                        .orElse(chemical.get(0));
                List<SimulationResult.Species> species = r.products().stream()
                        .map(p -> new SimulationResult.Species(p.formula().toLowerCase(Locale.ROOT), p.formula(),
                                round(p.mol()), p.phase()))
                        .toList();
                String title = chemical.size() == 1 ? primary.name() : chemical.size() + " reactions";
                String message = r.observations().isEmpty() ? primary.name() : r.observations().get(0);
                List<String> obs = r.observations().size() > 1 ? r.observations().subList(1, r.observations().size()) : List.of();
                yield new SimulationResult(requestId, Outcome.REACTION, null, primary.id(), 1, primary.equationLatex(),
                        species, cues, measurements, Fidelity.APPROXIMATE,
                        discoveries.stream().map(d -> "expl-" + d).toList(),
                        new Presentation(title, message, obs, summaries, null, null, List.of(), discoveries, compounds, facts));
            }
        };
    }

    private void audit(String session, SimulationRequest req, SimulationResult result, String ruleId, boolean flagged,
            List<String> inputs) {
        String outcome = mapper.convertValue(result.outcome(), String.class);
        audit.record(new SafetyAuditSink.Entry(session, req.attemptId(), req.id(), outcome, result.reasonCode(), ruleId,
                inputs, flagged));
    }

    private static double round(double v) {
        return Math.round(v * 1e6) / 1e6;
    }

    private static String fmt(double v) {
        return v == Math.rint(v) ? String.valueOf((long) v) : String.valueOf(v);
    }
}
