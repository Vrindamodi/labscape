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

        // 2. Allowlist: every substance is catalogued and every quantity is within its limits.
        List<Portion> portions = new ArrayList<>();
        Map<String, Double> totals = new LinkedHashMap<>();
        for (SimulationRequest.Input in : req.inputs()) {
            Substance s = catalogue.find(in.ref()).orElseThrow(() -> new SafetyExceptions.NotInCatalogue(in.ref()));
            if (!s.limits().unit().equals(in.unit())) throw new SafetyExceptions.UnitMismatch(in.ref(), s.limits().unit());
            portions.add(new Portion(s, in.amount()));
            totals.merge(s.id(), in.amount(), Double::sum);
        }
        List<String> inputSummary = req.inputs().stream().map(i -> i.ref() + ":" + i.amount() + i.unit()).toList();

        Optional<SimulationResult> range = checkRanges(req, totals);
        if (range.isPresent()) {
            audit(session, req, range.get(), null, false, inputSummary);
            return range.get();
        }
        double temperature = temperature(req);

        // 3. Prohibited-pattern check. Cooldown first, so probing cannot continue.
        Duration remaining = guard.remainingCooldown(session);
        if (!remaining.isZero()) throw new SafetyExceptions.Cooldown(remaining);
        List<Substance> mixture = portions.stream().map(Portion::substance).toList();
        Optional<SafetyRuleBook.Rule> rule = rules.match(mixture);
        if (rule.isPresent()) {
            boolean flagged = guard.recordProhibited(session);
            SimulationResult result = prohibited(req.id());
            audit(session, req, result, rule.get().id(), flagged, inputSummary);
            return result;
        }

        // 4. Reaction lookup, 5. outcome resolution.
        boolean ignition = req.conditions() != null && Boolean.TRUE.equals(req.conditions().ignition());
        ChemistryEngine.Result r = engine.run(portions, temperature, ignition);
        SimulationResult result = toResult(req.id(), r, portions);
        audit(session, req, result, null, false, inputSummary);
        return result;
    }

    // -------------------------------------------------------------------------------- ranges

    private Optional<SimulationResult> checkRanges(SimulationRequest req, Map<String, Double> totals) {
        double liquid = 0;
        for (Map.Entry<String, Double> e : totals.entrySet()) {
            Substance s = catalogue.find(e.getKey()).orElseThrow();
            Substance.Limits l = s.limits();
            double amount = e.getValue();
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
        List<Portion> portions = new ArrayList<>();
        for (SimulationRequest.Input in : req.inputs()) {
            Substance s = catalogue.find(in.ref()).orElse(null);
            if (s == null || !s.limits().unit().equals(in.unit())) return List.of();
            portions.add(new Portion(s, in.amount()));
        }
        double temperature = Math.max(MIN_TEMP_C, Math.min(MAX_TEMP_C, temperature(req)));
        boolean ignition = req.conditions() != null && Boolean.TRUE.equals(req.conditions().ignition());
        StringBuilder key = new StringBuilder();
        portions.stream().sorted(Comparator.comparing(p -> p.substance().id()))
                .forEach(p -> key.append(p.substance().id()).append(':').append(Math.round(p.amount() * 10)).append('|'));
        key.append(Math.round(temperature)).append(ignition ? "|i" : "");
        List<TryNext> cached = hintCache.get(key.toString());
        if (cached != null) return cached;
        List<TryNext> out = computeTryNext(portions, temperature, ignition);
        hintCache.put(key.toString(), out);
        return out;
    }

    private List<TryNext> computeTryNext(List<Portion> portions, double temperature, boolean ignition) {
        List<Substance> mixture = portions.stream().map(Portion::substance).toList();
        if (rules.match(mixture).isPresent()) return List.of();
        ChemistryEngine.Result base = engine.run(portions, temperature, ignition);
        if (base.kind() == ChemistryEngine.Kind.UNSUPPORTED) return List.of();
        java.util.Set<String> seen = new java.util.HashSet<>();
        java.util.Set<String> baseDiscoveries = new java.util.HashSet<>();
        for (ChemistryEngine.Reaction x : base.reactions()) {
            seen.add(x.id());
            if (x.discoveryId() != null) baseDiscoveries.add(x.discoveryId());
        }
        boolean baseToxic = toxic(base);
        double liquid = 0;
        for (Portion p : portions) {
            Substance s = p.substance();
            if (!s.isSolid() && !s.isGas()) liquid += "drops".equals(s.limits().unit()) ? p.amount() * 0.05 : p.amount();
        }
        double room = VESSEL_CAPACITY_ML - liquid;

        // Best hint per kind of result, so three chips never all say "add another acid".
        Map<String, Scored> best = new LinkedHashMap<>();
        java.util.function.BiConsumer<String, Scored> offer =
                (group, sc) -> best.merge(group, sc, (a, b) -> b.score() > a.score() ? b : a);

        // Bench tools first: would warming it, or a flame, start something?
        if (temperature < 60) {
            fresh(engine.run(portions, 80, ignition), seen, baseToxic).ifPresent(x -> offer.accept("tool:heat",
                    new Scored(new TryNext("heat", null, "Heat it", "Warm it on the hot plate and watch.", x.discoveryId(), x.type()), 6)));
        }
        if (!ignition) {
            fresh(engine.run(portions, temperature, true), seen, baseToxic).ifPresent(x -> offer.accept("tool:spark",
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
                if (rules.match(trialMix).isPresent()) continue;
                ChemistryEngine.Reaction x = fresh(engine.run(trial, temperature, ignition), seen, baseToxic).orElse(null);
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
    private static String noReactionTitle(ChemistryEngine.Result r, List<Portion> portions) {
        if (portions.size() == 1) return portions.get(0).substance().name() + " on its own";
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

    private SimulationResult toResult(String requestId, ChemistryEngine.Result r, List<Portion> portions) {
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
                List<String> obs = new ArrayList<>(r.observations());
                obs.addAll(reasons);
                yield new SimulationResult(requestId, Outcome.NO_REACTION, r.reasonCode(), null, null, null,
                        List.of(), cues, measurements, Fidelity.APPROXIMATE, List.of(),
                        new Presentation(noReactionTitle(r, portions), OutcomeCopy.NO_REACTION_MESSAGE, obs, summaries,
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
