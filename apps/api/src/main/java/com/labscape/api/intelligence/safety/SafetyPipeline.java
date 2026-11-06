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
                            r.pending().get(0).tool(), null, List.of(), List.of(), List.of(), facts));
            case NO_REACTION -> {
                List<String> obs = new ArrayList<>(r.observations());
                obs.addAll(reasons);
                yield new SimulationResult(requestId, Outcome.NO_REACTION, r.reasonCode(), null, null, null,
                        List.of(), cues, measurements, Fidelity.APPROXIMATE, List.of(),
                        new Presentation(OutcomeCopy.NO_REACTION_TITLE, OutcomeCopy.NO_REACTION_MESSAGE, obs, summaries,
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
