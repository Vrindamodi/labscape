package com.labscape.api.intelligence.safety;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labscape.api.contracts.SimulationRequest;
import com.labscape.api.contracts.SimulationResult;
import com.labscape.api.contracts.SimulationResult.Outcome;
import com.labscape.api.intelligence.chem.Catalogue;
import com.labscape.api.intelligence.chem.ChemistryEngine;
import com.labscape.api.intelligence.chem.Substance;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;

class SafetyPipelineTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Catalogue CATALOGUE = Catalogue.load();
    private static final AtomicInteger IDS = new AtomicInteger();

    private SafetyPipeline pipeline;

    @BeforeEach
    void setUp() {
        pipeline = newPipeline(true, new ProbeGuard(3, Duration.ofMinutes(10), Duration.ofMinutes(2), Clock.systemUTC()));
    }

    private static SafetyPipeline newPipeline(boolean enabled, ProbeGuard guard) {
        var noDb = new StaticListableBeanFactory().<org.springframework.jdbc.core.JdbcTemplate>getBeanProvider(
                org.springframework.jdbc.core.JdbcTemplate.class);
        return new SafetyPipeline(CATALOGUE, SafetyRuleBook.load(), new ChemistryEngine(CATALOGUE), guard,
                new SafetyAuditSink(noDb, MAPPER), MAPPER, enabled);
    }

    // ------------------------------------------------------------------ helpers

    record In(String ref, double amount) {}

    static In in(String ref, double amount) {
        return new In(ref, amount);
    }

    private SimulationResult mix(double tempC, In... inputs) {
        return mix(pipeline, "session-test", tempC, inputs);
    }

    private SimulationResult mix(In... inputs) {
        return mix(22, inputs);
    }

    private static SimulationResult mix(SafetyPipeline p, String session, double tempC, In... inputs) {
        List<SimulationRequest.Input> list = new ArrayList<>();
        for (In i : inputs) {
            Substance s = CATALOGUE.find(i.ref()).orElseThrow();
            list.add(new SimulationRequest.Input(i.ref(), i.amount(), s.limits().unit(), null));
        }
        var req = new SimulationRequest("req-" + IDS.incrementAndGet(), "chemistry", "sandbox", "att-1", null, null, null,
                list, new SimulationRequest.Conditions(tempC, null, null));
        return p.resolve(req, session);
    }

    private static boolean hasCue(SimulationResult r, String kind) {
        return r.cues().stream().anyMatch(c -> kind.equals(c.get("kind").asText()));
    }

    private static double measurement(SimulationResult r, String key) {
        return r.measurements().stream().filter(m -> m.key().equals(key)).findFirst().orElseThrow().value();
    }

    private static List<String> discoveries(SimulationResult r) {
        return r.presentation().discoveryIds();
    }

    // ------------------------------------------------------------------ the seven outcomes

    @Test
    void neutralisationWarmsAndReachesNeutral() {
        SimulationResult r = mix(in("hcl", 20), in("naoh", 20), in("universal-indicator", 3));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(discoveries(r)).contains("neutralisation");
        assertThat(measurement(r, "deltaT")).isGreaterThan(3);
        assertThat(measurement(r, "pH")).isBetween(6.0, 8.0);
        assertThat(r.equationLatex()).contains("HCl").contains("NaOH").contains("NaCl");
        assertThat(hasCue(r, "colour")).isTrue();
        assertThat(hasCue(r, "temperature")).isTrue();
    }

    @Test
    void sulfuricAcidEquationIsBalanced() {
        SimulationResult r = mix(in("h2so4", 10), in("naoh", 10));
        assertThat(r.equationLatex()).contains("2\\,\\mathrm{NaOH}").contains("Na_{2}SO_{4}").contains("2\\,\\mathrm{H_{2}O}");
    }

    @Test
    void metalInAcidGivesHydrogen() {
        SimulationResult r = mix(in("hcl", 30), in("mg-ribbon", 0.2));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(discoveries(r)).contains("acid-metal");
        assertThat(r.cues()).anySatisfy(c -> {
            assertThat(c.get("kind").asText()).isEqualTo("gas");
            assertThat(c.get("gas").asText()).isEqualTo("H2");
            assertThat(c.get("target").asText()).isEqualTo("solid:mg-ribbon");
        });
        assertThat(r.equationLatex()).contains("MgCl_{2}").contains("H_{2}");
    }

    @Test
    void copperDoesNotReactWithDiluteAcid() {
        SimulationResult r = mix(in("hcl", 20), in("cu-turnings", 1));
        assertThat(r.outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(r.presentation().observations()).anyMatch(o -> o.contains("below hydrogen"));
    }

    @Test
    void silverNitrateAndChloridePrecipitate() {
        SimulationResult r = mix(in("agno3", 10), in("nacl", 5));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(discoveries(r)).contains("silver-halide");
        assertThat(hasCue(r, "precipitate")).isTrue();
        assertThat(measurement(r, "precipitate")).isGreaterThan(0);
    }

    @Test
    void copperHydroxideRedissolvesInExcessAmmonia() {
        SimulationResult r = mix(in("cuso4", 5), in("ammonia", 40));
        assertThat(discoveries(r)).contains("copper-hydroxide", "copper-ammine");
        assertThat(r.cues()).anySatisfy(c -> assertThat(c.get("target").asText()).isEqualTo("precipitate:Cu(OH)2"));
        assertThat(measurement(r, "pH")).as("ammonia buffer, not strong alkali").isBetween(9.0, 12.0);
    }

    @Test
    void zincHydroxideIsAmphoteric() {
        SimulationResult r = mix(in("znso4", 5), in("naoh", 30));
        assertThat(discoveries(r)).contains("white-hydroxide", "amphoteric-zinc");
    }

    @Test
    void displacementDepositsCopper() {
        SimulationResult r = mix(in("cuso4", 20), in("zn-granules", 1));
        assertThat(discoveries(r)).contains("displacement-copper");
        assertThat(hasCue(r, "deposit")).isTrue();
    }

    @Test
    void lessReactiveMetalCannotDisplace() {
        SimulationResult r = mix(in("znso4", 20), in("cu-turnings", 1));
        assertThat(r.outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(r.presentation().observations()).anyMatch(o -> o.contains("less reactive"));
    }

    @Test
    void hydrogencarbonateReactionCools() {
        SimulationResult r = mix(in("ethanoic-acid", 30), in("nahco3", 30));
        assertThat(discoveries(r)).contains("acid-hydrogencarbonate");
        assertThat(measurement(r, "deltaT")).isLessThan(0);
    }

    @Test
    void littleAcidOnCarbonateDoesNotFizzYet() {
        SimulationResult r = mix(in("hcl-dilute", 2), in("na2co3", 30));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(hasCue(r, "gas")).isFalse();
    }

    @Test
    void catalystDecomposesPeroxide() {
        SimulationResult r = mix(in("h2o2", 20), in("mno2-powder", 0.2));
        assertThat(discoveries(r)).contains("peroxide-catalysed");
        assertThat(r.equationLatex()).contains("\\xrightarrow{\\mathrm{MnO_{2}}}");
    }

    @Test
    void iodineClockWithStarch() {
        SimulationResult r = mix(in("ki", 10), in("h2so4", 10), in("h2o2", 10), in("starch", 5));
        assertThat(discoveries(r)).contains("iodide-oxidation", "starch-iodine");
        JsonNode colour = r.cues().stream().filter(c -> "colour".equals(c.get("kind").asText())).findFirst().orElseThrow();
        assertThat(colour.get("startMs").asLong()).isGreaterThan(0);
    }

    @Test
    void waterTurnsAnhydrousCopperSulfateBlue() {
        assertThat(discoveries(mix(in("water", 10), in("cuso4-anhydrous", 1)))).contains("water-test");
        SimulationResult dry = mix(in("ethanol", 10), in("cuso4-anhydrous", 1));
        assertThat(dry.outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(dry.presentation().observations()).anyMatch(o -> o.contains("no water"));
    }

    @Test
    void needsHeatForCopperOxide() {
        SimulationResult cold = mix(in("h2so4", 20), in("cuo-powder", 0.5));
        assertThat(cold.outcome()).isEqualTo(Outcome.NEEDS_CONDITIONS);
        assertThat(cold.reasonCode()).isEqualTo("NEEDS_HEAT");
        assertThat(cold.presentation().neededTool()).isEqualTo("heater");
        SimulationResult hot = mix(65, in("h2so4", 20), in("cuo-powder", 0.5));
        assertThat(hot.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(discoveries(hot)).contains("acid-oxide");
    }

    @Test
    void peroxideAloneNeedsCatalyst() {
        SimulationResult r = mix(in("h2o2", 20), in("water", 10));
        assertThat(r.outcome()).isEqualTo(Outcome.NEEDS_CONDITIONS);
        assertThat(r.presentation().neededTool()).isEqualTo("catalyst");
    }

    @Test
    void starchIodineHotIsProcedureMismatch() {
        SimulationResult r = mix(80, in("starch", 5), in("iodine-solution", 5));
        assertThat(r.outcome()).isEqualTo(Outcome.PROCEDURE_MISMATCH);
        assertThat(r.reasonCode()).isEqualTo("TEMP_ABOVE_VALIDATED");
    }

    @Test
    void spectatorIonsGiveNoReaction() {
        SimulationResult r = mix(in("nacl", 10), in("kbr", 10));
        assertThat(r.outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(r.presentation().message()).isEqualTo(OutcomeCopy.NO_REACTION_MESSAGE);
    }

    @Test
    void unmodelledCombinationIsUnsupportedWithNoCues() {
        SimulationResult r = mix(in("bleach", 5), in("ki", 5));
        assertThat(r.outcome()).isEqualTo(Outcome.UNSUPPORTED);
        assertThat(r.cues()).isEmpty();
        assertThat(r.presentation().title()).isEqualTo(OutcomeCopy.UNSUPPORTED_TITLE);
        assertThat(mix(in("na2s2o3", 5), in("fecl3", 5)).outcome()).isEqualTo(Outcome.UNSUPPORTED);
    }

    @Test
    void outOfRangeQuantitiesAndTemperature() {
        SimulationResult tooMuch = mix(in("hcl", 60), in("naoh", 10));
        assertThat(tooMuch.outcome()).isEqualTo(Outcome.OUT_OF_RANGE);
        assertThat(tooMuch.reasonCode()).isEqualTo("QTY_ABOVE_LIMIT");
        assertThat(tooMuch.presentation().focusRef()).isEqualTo("hcl");
        assertThat(mix(95, in("hcl", 10)).reasonCode()).isEqualTo("TEMP_OUT_OF_RANGE");
        assertThat(mix(in("water", 100), in("water", 100), in("hcl", 50), in("naoh", 50)).reasonCode())
                .isIn("QTY_ABOVE_LIMIT", "VESSEL_OVERFLOW");
    }

    // ------------------------------------------------------------------ prohibited

    @Test
    void prohibitedResultsAreIdenticalAndRevealNothing() throws Exception {
        SimulationResult a = mix(pipeline, "s-a", 22, in("bleach", 5), in("hcl", 5));
        SimulationResult b = mix(pipeline, "s-b", 22, in("bleach", 5), in("ammonia", 5));
        SimulationResult c = mix(pipeline, "s-c", 22, in("kmno4-crystals", 0.1), in("glycerol", 5));
        for (SimulationResult r : List.of(a, b, c)) {
            assertThat(r.outcome()).isEqualTo(Outcome.PROHIBITED);
            assertThat(r.cues()).isEmpty();
            assertThat(r.species()).isEmpty();
            assertThat(r.measurements()).isEmpty();
        }
        String ja = MAPPER.writeValueAsString(withoutId(a));
        assertThat(MAPPER.writeValueAsString(withoutId(b))).isEqualTo(ja);
        assertThat(MAPPER.writeValueAsString(withoutId(c))).isEqualTo(ja);
        assertThat(ja).doesNotContain("SR-").doesNotContain("bleach").doesNotContain("chlor");
    }

    private static SimulationResult withoutId(SimulationResult r) {
        return new SimulationResult("x", r.outcome(), r.reasonCode(), r.reactionId(), r.reactionVersion(), r.equationLatex(),
                r.species(), r.cues(), r.measurements(), r.fidelity(), r.explanationRefs(), r.presentation());
    }

    @Test
    void repeatedProbingTriggersCooldown() {
        String session = "prober";
        for (int i = 0; i < 3; i++) {
            assertThat(mix(pipeline, session, 22, in("bleach", 5), in("hcl", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        }
        assertThatThrownBy(() -> mix(pipeline, session, 22, in("nacl", 5), in("water", 5)))
                .isInstanceOf(SafetyExceptions.Cooldown.class);
        assertThat(mix(pipeline, "someone-else", 22, in("nacl", 5), in("water", 5)).outcome()).isEqualTo(Outcome.NO_REACTION);
    }

    @Test
    void disabledEngineRefusesEverything() {
        SafetyPipeline off = newPipeline(false, new ProbeGuard(3, Duration.ofMinutes(10), Duration.ofMinutes(2), Clock.systemUTC()));
        assertThatThrownBy(() -> mix(off, "s", 22, in("hcl", 10), in("naoh", 10)))
                .isInstanceOf(SafetyExceptions.EngineDisabled.class);
    }

    @Test
    void unknownSubstanceIsRejected() {
        var req = new SimulationRequest("r", "chemistry", "sandbox", "a", null, null, null,
                List.of(new SimulationRequest.Input("dihydrogen-monoxide-plus", 5, "mL", null)), null);
        assertThatThrownBy(() -> pipeline.resolve(req, "s")).isInstanceOf(SafetyExceptions.NotInCatalogue.class);
    }

    // ------------------------------------------------------------------ every combination

    @Test
    void everyPairAndRandomMixturesResolveCleanly() {
        List<Substance> all = new ArrayList<>(CATALOGUE.all());
        Map<Outcome, Integer> counts = new EnumMap<>(Outcome.class);
        int n = 0;
        for (double temp : new double[] {22, 75}) {
            for (int i = 0; i < all.size(); i++) {
                for (int j = i + 1; j < all.size(); j++) {
                    SafetyPipeline fresh = newPipeline(true, new ProbeGuard(1_000_000, Duration.ofMinutes(10), Duration.ofMinutes(2), Clock.systemUTC()));
                    SimulationResult r = mix(fresh, "pairs", temp, mid(all.get(i)), mid(all.get(j)));
                    assertSane(r, all.get(i).id() + "+" + all.get(j).id() + "@" + temp);
                    counts.merge(r.outcome(), 1, Integer::sum);
                    n++;
                }
            }
        }
        Random rnd = new Random(42);
        SafetyPipeline fresh = newPipeline(true, new ProbeGuard(1_000_000, Duration.ofMinutes(10), Duration.ofMinutes(2), Clock.systemUTC()));
        for (int k = 0; k < 3000; k++) {
            int size = 3 + rnd.nextInt(2);
            List<In> picks = new ArrayList<>();
            for (int m = 0; m < size; m++) picks.add(random(all.get(rnd.nextInt(all.size())), rnd));
            double temp = 5 + rnd.nextInt(86);
            SimulationResult r = mix(fresh, "fuzz", temp, picks.toArray(In[]::new));
            assertSane(r, picks + "@" + temp);
            counts.merge(r.outcome(), 1, Integer::sum);
            n++;
        }
        System.out.println("Resolved " + n + " mixtures: " + counts);
        assertThat(counts.keySet()).contains(Outcome.REACTION, Outcome.NO_REACTION, Outcome.NEEDS_CONDITIONS,
                Outcome.UNSUPPORTED, Outcome.PROHIBITED, Outcome.PROCEDURE_MISMATCH);
    }

    private static In mid(Substance s) {
        return in(s.id(), round((s.limits().min() + s.limits().max()) / 4));
    }

    private static In random(Substance s, Random rnd) {
        double v = s.limits().min() + rnd.nextDouble() * (s.limits().max() - s.limits().min()) * 0.5;
        return in(s.id(), Math.max(s.limits().min(), round(v)));
    }

    private static double round(double v) {
        return Math.round(v * 100) / 100.0;
    }

    private static void assertSane(SimulationResult r, String label) {
        assertThat(r.outcome()).as(label).isNotNull();
        assertThat(r.presentation()).as(label).isNotNull();
        assertThat(r.presentation().title()).as(label).isNotBlank();
        assertThat(r.presentation().message()).as(label).isNotBlank();
        for (JsonNode cue : r.cues()) {
            assertThat(cue.get("kind")).as(label).isNotNull();
            assertThat(cue.get("target").asText()).as(label + " cue target").isNotBlank().isNotEqualTo("null");
            cue.fields().forEachRemaining(f -> {
                if (f.getValue().isNumber()) assertThat(Double.isFinite(f.getValue().asDouble())).as(label + " " + f.getKey()).isTrue();
            });
        }
        for (SimulationResult.Measurement m : r.measurements()) {
            assertThat(Double.isFinite(m.value())).as(label + " " + m.key()).isTrue();
        }
        if (r.outcome() == Outcome.REACTION) {
            assertThat(r.equationLatex()).as(label).isNotBlank();
            assertThat(r.presentation().reactions()).as(label).isNotEmpty();
            r.presentation().reactions().forEach(x -> assertThat(x.equationLatex()).as(label + " " + x.id()).isNotBlank());
        }
        if (r.outcome() == Outcome.PROHIBITED || r.outcome() == Outcome.UNSUPPORTED) {
            assertThat(r.cues()).as(label).isEmpty();
        }
    }
}
