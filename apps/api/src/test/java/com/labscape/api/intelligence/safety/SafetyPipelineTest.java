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
        return mix(p, session, tempC, false, inputs);
    }

    private static SimulationResult mix(SafetyPipeline p, String session, double tempC, boolean ignition, In... inputs) {
        List<SimulationRequest.Input> list = new ArrayList<>();
        for (In i : inputs) {
            Substance s = CATALOGUE.find(i.ref()).orElseThrow();
            list.add(new SimulationRequest.Input(i.ref(), i.amount(), s.limits().unit(), null));
        }
        var req = new SimulationRequest("req-" + IDS.incrementAndGet(), "chemistry", "sandbox", "att-1", null, null, null,
                list, new SimulationRequest.Conditions(tempC, null, null, ignition));
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
    void ironSulfideAndAcidGiveToxicHydrogenSulfide() {
        SimulationResult r = mix(in("hcl", 20), in("fes", 1));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(discoveries(r)).contains("acid-sulfide");
        assertThat(r.cues()).anySatisfy(c -> {
            assertThat(c.path("gas").asText()).isEqualTo("H2S");
            assertThat(c.path("hazard").asText()).isEqualTo("toxic");
            assertThat(c.path("smell").asText()).containsIgnoringCase("rotten eggs");
        });
        assertThat(r.equationLatex()).contains("FeS").contains("H_{2}S");
    }

    @Test
    void ironSulfideAloneInWaterDoesNothing() {
        assertThat(mix(in("water", 20), in("fes", 1)).outcome()).isEqualTo(Outcome.NO_REACTION);
    }

    @Test
    void bakingSodaAndVinegarFizz() {
        SimulationResult r = mix(in("vinegar", 40), in("baking-soda", 2));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(discoveries(r)).contains("acid-hydrogencarbonate");
        assertThat(r.cues()).anySatisfy(c -> assertThat(c.path("gas").asText()).isEqualTo("CO2"));
    }

    @Test
    void bleachAndVinegarAreBlocked() {
        assertThat(mix(in("bleach", 10), in("vinegar", 10)).outcome()).isEqualTo(Outcome.PROHIBITED);
    }

    @Test
    void hydrogenIsFlaggedFlammable() {
        SimulationResult r = mix(in("hcl", 30), in("mg-ribbon", 0.2));
        assertThat(r.cues()).anySatisfy(c -> assertThat(c.path("hazard").asText()).isEqualTo("flammable"));
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
    void formerlyUnmodelledCombinationsAreNowModelled() {
        SimulationResult r = mix(in("bleach", 5), in("ki", 5));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(discoveries(r)).contains("iodide-oxidation");
        assertThat(mix(in("na2s2o3", 5), in("fecl3", 5)).outcome()).isEqualTo(Outcome.REACTION);
        assertThat(mix(in("ethanol", 10), in("ethanoic-acid", 10)).outcome()).isEqualTo(Outcome.NEEDS_CONDITIONS);
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

    // ------------------------------------------------------------------ elements

    private SimulationResult spark(In... inputs) {
        return mix(pipeline, "session-test", 22, true, inputs);
    }

    @Test
    void sodiumInWaterSkatesAndMakesAlkali() {
        SimulationResult r = mix(in("water", 50), in("el-Na", 0.2), in("phenolphthalein", 3));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(discoveries(r)).contains("alkali-water", "indicator-alkali");
        assertThat(hasCue(r, "skate")).isTrue();
        assertThat(measurement(r, "pH")).isGreaterThan(12);
        assertThat(r.presentation().compounds()).anySatisfy(c -> assertThat(c.name()).isEqualTo("Sodium hydroxide"));
    }

    @Test
    void hydrogenAndOxygenNeedASparkThenMakeWater() {
        SimulationResult cold = mix(in("el-H", 100), in("el-O", 50));
        assertThat(cold.outcome()).isEqualTo(Outcome.NEEDS_CONDITIONS);
        assertThat(cold.reasonCode()).isEqualTo("NEEDS_IGNITION");
        assertThat(cold.presentation().neededTool()).isEqualTo("spark");

        SimulationResult r = spark(in("el-H", 100), in("el-O", 50));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(discoveries(r)).contains("water-synthesis");
        assertThat(hasCue(r, "condense")).isTrue();
        assertThat(hasCue(r, "light")).isTrue();
        var reaction = r.presentation().reactions().get(0);
        assertThat(reaction.participants()).isNotNull();
        assertThat(reaction.participants().products()).anySatisfy(t -> assertThat(t.formula()).isEqualTo("H2O"));
        assertThat(r.presentation().compounds()).anySatisfy(c -> assertThat(c.name()).isEqualTo("Water"));
        assertThat(r.presentation().facts()).isNotEmpty();
    }

    private static JsonNode firstCue(SimulationResult r, String kind) {
        return r.cues().stream().filter(c -> kind.equals(c.get("kind").asText())).findFirst().orElseThrow();
    }

    @Test
    void hydrogenPopIsHeardAndLeavesDropletsOnTheGlass() {
        SimulationResult r = spark(in("el-H", 100), in("el-O", 50));
        assertThat(r.cues()).anySatisfy(c -> {
            assertThat(c.get("kind").asText()).isEqualTo("sound");
            assertThat(c.get("soundId").asText()).isIn("pop", "bang");
        });
        JsonNode condense = firstCue(r, "condense");
        assertThat(condense.get("amount").asDouble()).isGreaterThan(0.3);
        assertThat(r.presentation().message()).containsIgnoringCase("droplets");
    }

    @Test
    void heatingASaltSolutionSteamsAndGrowsCrystals() {
        SimulationResult cool = mix(22, in("cuso4", 50));
        assertThat(hasCue(cool, "crystals")).isFalse();
        assertThat(hasCue(cool, "condense")).isFalse();

        SimulationResult hot = mix(90, in("cuso4", 50));
        assertThat(hasCue(hot, "condense")).isTrue();
        JsonNode crystals = firstCue(hot, "crystals");
        assertThat(crystals.get("label").asText()).contains("copper(II) sulfate");
        assertThat(hot.presentation().observations()).anySatisfy(o -> assertThat(o).contains("crystals of copper(II) sulfate"));
    }

    @Test
    void warmIodineGivesVioletVapour() {
        SimulationResult r = mix(70, in("el-I", 0.5));
        assertThat(r.cues()).anySatisfy(c -> {
            assertThat(c.get("kind").asText()).isEqualTo("smoke");
            assertThat(c.get("label").asText()).containsIgnoringCase("iodine");
        });
    }

    @Test
    void goldenRainIsCrystallineAndSilverGrowsCrystals() {
        SimulationResult r = mix(in("pbno3", 10), in("ki", 5));
        assertThat(firstCue(r, "precipitate").get("form").asText()).isEqualTo("crystals");
        SimulationResult ag = mix(in("agno3", 20), in("cu-turnings", 1));
        assertThat(firstCue(ag, "deposit").get("form").asText()).isEqualTo("crystals");
    }

    @Test
    void sodiumAndChlorineMakeSalt() {
        SimulationResult r = mix(in("el-Na", 0.2), in("el-Cl", 100));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(discoveries(r)).contains("salt-synthesis");
        assertThat(r.equationLatex()).contains("NaCl");
        assertThat(r.presentation().compounds()).anySatisfy(c -> assertThat(c.name()).isEqualTo("Sodium chloride"));
    }

    @Test
    void magnesiumBurnsBrightly() {
        SimulationResult r = spark(in("el-Mg", 0.2), in("el-O", 100));
        assertThat(discoveries(r)).contains("metal-burning");
        assertThat(r.equationLatex()).contains("MgO");
        assertThat(hasCue(r, "flame")).isTrue();
    }

    @Test
    void ironAndSulfurNeedHeatingThenGlow() {
        assertThat(mix(in("el-Fe", 1), in("el-S", 1)).reasonCode()).isEqualTo("NEEDS_IGNITION");
        assertThat(spark(in("el-Fe", 1), in("el-S", 1)).equationLatex()).contains("FeS");
    }

    @Test
    void chlorineDisplacesBromide() {
        SimulationResult r = mix(in("kbr", 20), in("el-Cl", 50));
        assertThat(discoveries(r)).contains("halogen-displacement");
    }

    @Test
    void goldenRainAndColdPack() {
        assertThat(discoveries(mix(in("pbno3", 10), in("ki", 5)))).contains("golden-rain");
        SimulationResult cold = mix(in("water", 50), in("nh4no3", 5));
        assertThat(discoveries(cold)).contains("cold-pack");
        assertThat(measurement(cold, "temperature")).isLessThan(22);
    }

    @Test
    void nobleGasesAndSuperheavies() {
        assertThat(mix(in("el-He", 50), in("water", 20)).outcome()).isEqualTo(Outcome.NO_REACTION);
        SimulationResult og = mix(in("el-Og", 0.1), in("water", 20));
        assertThat(og.outcome()).isEqualTo(Outcome.UNSUPPORTED);
        assertThat(og.presentation().observations().get(0)).contains("handful");
    }

    @Test
    void explosiveMixturesAreProhibited() {
        assertThat(mix(in("kno3", 2), in("el-C", 1), in("el-S", 1)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(in("el-Al", 1), in("fe2o3-powder", 2)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(in("nh4no3", 2), in("sugar", 2)).outcome()).isEqualTo(Outcome.PROHIBITED);
    }

    @Test
    void radioactiveElementsCarryAWarning() {
        SimulationResult r = mix(in("el-U", 1), in("hcl", 20));
        assertThat(r.presentation().observations().stream().anyMatch(o -> o.contains("radioactive"))
                || r.presentation().message().contains("radioactive")).isTrue();
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
        SafetyPipeline pairs = newPipeline(true, new ProbeGuard(Integer.MAX_VALUE, Duration.ofMinutes(10), Duration.ofMinutes(2), Clock.systemUTC()));
        for (double temp : new double[] {22, 75}) {
            boolean ignite = temp > 50;
            for (int i = 0; i < all.size(); i++) {
                for (int j = i + 1; j < all.size(); j++) {
                    // Hot + spark: a deterministic quarter of the pairs (ChemistryCoverageTest sweeps them all at engine level).
                    if (ignite && (i + j) % 4 != 0) continue;
                    SimulationResult r = mix(pairs, "pairs", temp, ignite, mid(all.get(i)), mid(all.get(j)));
                    assertSane(r, all.get(i).id() + "+" + all.get(j).id() + "@" + temp + (ignite ? "+spark" : ""));
                    counts.merge(r.outcome(), 1, Integer::sum);
                    n++;
                }
            }
        }
        Random rnd = new Random(42);
        SafetyPipeline fresh = newPipeline(true, new ProbeGuard(Integer.MAX_VALUE, Duration.ofMinutes(10), Duration.ofMinutes(2), Clock.systemUTC()));
        for (int k = 0; k < 5000; k++) {
            int size = 3 + rnd.nextInt(2);
            List<In> picks = new ArrayList<>();
            for (int m = 0; m < size; m++) picks.add(random(all.get(rnd.nextInt(all.size())), rnd));
            double temp = 5 + rnd.nextInt(86);
            SimulationResult r = mix(fresh, "fuzz", temp, rnd.nextBoolean(), picks.toArray(In[]::new));
            assertSane(r, picks + "@" + temp);
            counts.merge(r.outcome(), 1, Integer::sum);
            n++;
        }
        System.out.println("Resolved " + n + " mixtures: " + counts);
        // Unsupported now only comes from superheavy elements; procedure mismatch has its own test (starch-iodine hot).
        assertThat(counts.keySet()).contains(Outcome.REACTION, Outcome.NO_REACTION, Outcome.NEEDS_CONDITIONS,
                Outcome.UNSUPPORTED, Outcome.PROHIBITED);
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

    // ------------------------------------------------------------------ try-next hints

    private List<SafetyPipeline.TryNext> hints(double tempC, boolean ignition, In... inputs) {
        List<SimulationRequest.Input> list = new ArrayList<>();
        for (In i : inputs) {
            Substance s = CATALOGUE.find(i.ref()).orElseThrow();
            list.add(new SimulationRequest.Input(i.ref(), i.amount(), s.limits().unit(), null));
        }
        return pipeline.tryNext(new SimulationRequest("hint-" + IDS.incrementAndGet(), "chemistry", "sandbox", "att-1", null, null,
                null, list, new SimulationRequest.Conditions(tempC, null, null, ignition)));
    }

    /** The amount the playground picks up by default for a shelf item. */
    private static In sample(String ref) {
        Substance s = CATALOGUE.find(ref).orElseThrow();
        double want = s.isSolid() ? 1 : "drops".equals(s.limits().unit()) ? 3 : s.isGas() ? 50 : 10;
        return in(ref, Math.min(want, s.limits().max()));
    }

    @Test
    void hintsOnlyNameMixesThatAreAllowedAndReallyReact() {
        for (String start : List.of("hcl", "cuso4", "water", "agno3", "vinegar", "mg-ribbon", "bleach", "ethanol")) {
            List<SafetyPipeline.TryNext> hints = hints(22, false, sample(start));
            assertThat(hints).as(start).isNotEmpty().hasSizeLessThanOrEqualTo(8);
            assertThat(hints.stream().map(h -> h.kind() + ":" + h.ref()).distinct().count()).as(start).isEqualTo(hints.size());
            for (SafetyPipeline.TryNext h : hints) {
                assertThat(h.teaser()).as(start).isNotBlank();
                if (!"add".equals(h.kind())) continue;
                SimulationResult r = mix(sample(start), sample(h.ref()));
                assertThat(r.outcome()).as(start + " + " + h.ref()).isEqualTo(Outcome.REACTION);
                assertThat(r.cues()).as(start + " + " + h.ref())
                        .noneMatch(c -> c.has("hazard") && "toxic".equals(c.get("hazard").asText()));
            }
        }
    }

    @Test
    void hintsNeverLeadTowardsABlockedMix() {
        // acid + bleach is prohibited: neither side may ever be suggested to the other
        assertThat(hints(22, false, sample("hcl"))).noneMatch(h -> "bleach".equals(h.ref()));
        assertThat(hints(22, false, sample("bleach"))).noneMatch(h -> "hcl".equals(h.ref()) || "vinegar".equals(h.ref()));
        // asking for hints is not an attempt: it never starts a cooldown
        for (int i = 0; i < 10; i++) hints(22, false, in("bleach", 5 + i * 0.5));
        assertThat(mix(in("hcl", 10), in("naoh", 10)).outcome()).isEqualTo(Outcome.REACTION);
    }

    @Test
    void hintsOfferTheBenchToolsWhenTheyWouldStartSomething() {
        assertThat(hints(22, false, sample("ethanol"))).anyMatch(h -> "spark".equals(h.kind()));
        assertThat(hints(22, true, sample("ethanol"))).noneMatch(h -> "spark".equals(h.kind()));
        assertThat(hints(22, false, sample("glucose"), sample("benedicts"))).anyMatch(h -> "heat".equals(h.kind()));
        assertThat(hints(22, false, sample("water"))).noneMatch(h -> "heat".equals(h.kind()) || "spark".equals(h.kind()));
    }

    @Test
    void hintsAreEmptyForUnknownRefsAndWhenTheEngineIsOff() {
        var bad = new SimulationRequest("hint-x", "chemistry", "sandbox", "att-1", null, null, null,
                List.of(new SimulationRequest.Input("mystery", 5, "mL", null)), null);
        assertThat(pipeline.tryNext(bad)).isEmpty();
        SafetyPipeline off = newPipeline(false, new ProbeGuard(3, Duration.ofMinutes(10), Duration.ofMinutes(2), Clock.systemUTC()));
        var ok = new SimulationRequest("hint-y", "chemistry", "sandbox", "att-1", null, null, null,
                List.of(new SimulationRequest.Input("hcl", 10, "mL", null)), null);
        assertThat(off.tryNext(ok)).isEmpty();
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
