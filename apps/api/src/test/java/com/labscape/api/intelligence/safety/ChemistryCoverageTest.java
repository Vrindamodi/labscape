package com.labscape.api.intelligence.safety;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labscape.api.contracts.SimulationRequest;
import com.labscape.api.contracts.SimulationResult;
import com.labscape.api.contracts.SimulationResult.Outcome;
import com.labscape.api.intelligence.chem.Catalogue;
import com.labscape.api.intelligence.chem.ChemistryEngine;
import com.labscape.api.intelligence.chem.ChemistryEngine.Kind;
import com.labscape.api.intelligence.chem.ChemistryEngine.Portion;
import com.labscape.api.intelligence.chem.Discovery;
import com.labscape.api.intelligence.chem.Substance;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;

/**
 * The playground must give an honest, modelled answer for every combination on the shelf: a
 * reaction, a specific "needs conditions" message, a described physical outcome, or a safety block.
 */
class ChemistryCoverageTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Catalogue CATALOGUE = Catalogue.load();
    private static final ChemistryEngine ENGINE = new ChemistryEngine(CATALOGUE);
    private static final SafetyRuleBook RULES = SafetyRuleBook.load();
    private static final AtomicInteger IDS = new AtomicInteger();

    private final SafetyPipeline pipeline = newPipeline();

    private static SafetyPipeline newPipeline() {
        var noDb = new StaticListableBeanFactory().<org.springframework.jdbc.core.JdbcTemplate>getBeanProvider(
                org.springframework.jdbc.core.JdbcTemplate.class);
        return new SafetyPipeline(CATALOGUE, RULES, ENGINE,
                new ProbeGuard(Integer.MAX_VALUE, Duration.ofMinutes(10), Duration.ofMinutes(2), Clock.systemUTC()),
                new SafetyAuditSink(noDb, MAPPER), MAPPER, true);
    }

    record In(String ref, double amount) {}

    static In in(String ref, double amount) {
        return new In(ref, amount);
    }

    private SimulationResult mix(double tempC, In... inputs) {
        return mix(tempC, false, inputs);
    }

    private SimulationResult mix(double tempC, boolean ignition, In... inputs) {
        List<SimulationRequest.Input> list = new ArrayList<>();
        for (In i : inputs) {
            Substance s = CATALOGUE.find(i.ref()).orElseThrow(() -> new AssertionError("not in catalogue: " + i.ref()));
            list.add(new SimulationRequest.Input(i.ref(), i.amount(), s.limits().unit(), null));
        }
        var req = new SimulationRequest("cov-" + IDS.incrementAndGet(), "chemistry", "sandbox", "att-cov", null, null, null,
                list, new SimulationRequest.Conditions(tempC, null, null, ignition));
        return pipeline.resolve(req, "coverage-" + IDS.get());
    }

    private static List<JsonNode> cues(SimulationResult r, String kind) {
        return r.cues().stream().filter(c -> kind.equals(c.get("kind").asText())).toList();
    }

    private static String text(SimulationResult r) {
        StringBuilder sb = new StringBuilder(r.presentation().message());
        r.presentation().observations().forEach(o -> sb.append(' ').append(o));
        r.cues().forEach(c -> sb.append(' ').append(c.toString()));
        return sb.toString().toLowerCase(java.util.Locale.ROOT);
    }

    // ------------------------------------------------------------------ the student's complaint

    @Test
    void catalogueIsLargeAndIncludesIsoamylAlcohol() {
        long compounds = CATALOGUE.all().stream().filter(s -> !s.isElement()).count();
        assertThat(compounds).isGreaterThanOrEqualTo(250);
        assertThat(CATALOGUE.find("isoamyl-alcohol")).isPresent();
        assertThat(CATALOGUE.find("h2so4-conc")).isPresent();
    }

    @Test
    void ethanolAndEthanoicAcidNeedCatalystAndHeat() {
        SimulationResult r = mix(22, in("ethanol", 10), in("ethanoic-acid", 10));
        assertThat(r.outcome()).isEqualTo(Outcome.NEEDS_CONDITIONS);
        assertThat(r.reasonCode()).isEqualTo("NEEDS_CATALYST");
        assertThat(r.presentation().neededTool()).isEqualTo("catalyst");
        assertThat(r.presentation().focusRef()).isEqualTo("h2so4-conc");
        assertThat(r.presentation().message()).contains("concentrated sulfuric acid").contains("warm");

        SimulationResult catalysedCold = mix(22, in("ethanol", 10), in("ethanoic-acid", 10), in("h2so4-conc", 5));
        assertThat(catalysedCold.outcome()).isEqualTo(Outcome.NEEDS_CONDITIONS);
        assertThat(catalysedCold.presentation().neededTool()).isEqualTo("heater");
    }

    @Test
    void ethanolAndEthanoicAcidWithCatalystAndHeatMakeEthylEthanoate() {
        SimulationResult r = mix(70, in("ethanol", 10), in("ethanoic-acid", 10), in("h2so4-conc", 5));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(r.presentation().discoveryIds()).contains("esterification");
        assertThat(r.presentation().reactions()).anySatisfy(x -> {
            assertThat(x.type()).isEqualTo("esterification");
            assertThat(x.equationLatex()).contains("CH_{3}COOC_{2}H_{5}");
        });
        assertThat(cues(r, "odour")).anySatisfy(c -> assertThat(c.get("description").asText()).contains("fruity"));
        assertThat(r.presentation().compounds()).anySatisfy(c -> assertThat(c.name()).isEqualTo("Ethyl ethanoate"));
    }

    @Test
    void isoamylAlcoholMakesBananaSmellingIsoamylAcetate() {
        SimulationResult r = mix(75, in("isoamyl-alcohol", 5), in("ethanoic-acid-glacial", 5), in("h2so4-conc", 5));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(r.presentation().discoveryIds()).contains("banana-ester");
        assertThat(cues(r, "odour")).anySatisfy(c -> assertThat(c.get("description").asText()).contains("banana"));
        assertThat(r.presentation().compounds()).anySatisfy(c -> assertThat(c.name()).contains("isoamyl acetate"));
        // and without the catalyst it is an actionable needs_conditions, never "unsupported"
        assertThat(mix(22, in("isoamyl-alcohol", 5), in("ethanoic-acid", 10)).outcome()).isEqualTo(Outcome.NEEDS_CONDITIONS);
    }

    @Test
    void methylSalicylateSmellsOfWintergreen() {
        SimulationResult r = mix(75, in("methanol", 5), in("salicylic-acid", 1), in("h2so4-conc", 5));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(r.presentation().discoveryIds()).contains("wintergreen-ester");
    }

    // ------------------------------------------------------------------ organic tests

    @Test
    void cyclohexeneDecolourisesBromineWaterButHexaneDoesNot() {
        SimulationResult alkene = mix(22, in("bromine-water", 10), in("cyclohexene", 2));
        assertThat(alkene.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(alkene.presentation().discoveryIds()).contains("bromine-water-test");
        assertThat(text(alkene)).contains("decolourised");

        SimulationResult alkane = mix(22, in("bromine-water", 10), in("hexane", 2));
        assertThat(alkane.outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(cues(alkane, "layers")).anySatisfy(c -> assertThat(c.get("position").asText()).isEqualTo("top"));
        assertThat(text(alkane)).contains("no c=c");
    }

    @Test
    void glucoseTurnsBenedictsBrickRedWhenHeated() {
        assertThat(mix(22, in("glucose", 5), in("benedicts", 5)).outcome()).isEqualTo(Outcome.NEEDS_CONDITIONS);
        SimulationResult r = mix(80, in("glucose", 5), in("benedicts", 5));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(r.presentation().discoveryIds()).contains("benedicts-test");
        assertThat(cues(r, "precipitate")).anySatisfy(c -> assertThat(c.get("id").asText()).isEqualTo("Cu2O"));
        assertThat(text(r)).contains("brick-red");
        // sucrose is non-reducing
        assertThat(mix(80, in("sucrose", 5), in("benedicts", 5)).outcome()).isEqualTo(Outcome.NO_REACTION);
    }

    @Test
    void fehlingsAandBMakeADeepBlueTestThatGlucoseReduces() {
        SimulationResult r = mix(80, in("fehlings-a", 5), in("fehlings-b", 5), in("glucose", 5));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(r.presentation().discoveryIds()).contains("fehlings-test");
        assertThat(cues(r, "precipitate")).noneSatisfy(c -> assertThat(c.get("id").asText()).isEqualTo("Cu(OH)2"));
    }

    @Test
    void ethanalGivesASilverMirrorWithWarmTollens() {
        assertThat(mix(22, in("ethanal", 2), in("tollens", 5)).presentation().neededTool()).isEqualTo("heater");
        SimulationResult r = mix(60, in("ethanal", 2), in("tollens", 5));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(r.presentation().discoveryIds()).contains("silver-mirror");
        assertThat(cues(r, "deposit")).anySatisfy(c -> assertThat(c.get("form").asText()).isEqualTo("mirror"));
        assertThat(mix(60, in("propanone", 2), in("tollens", 5)).outcome()).isEqualTo(Outcome.NO_REACTION);
    }

    @Test
    void acidifiedDichromateOxidisesSecondaryButNotTertiaryAlcohols() {
        SimulationResult secondary = mix(60, in("k2cr2o7-acid", 10), in("propan-2-ol", 2));
        assertThat(secondary.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(text(secondary)).contains("green").contains("propanone");
        SimulationResult tertiary = mix(60, in("k2cr2o7-acid", 10), in("tert-butanol", 2));
        assertThat(tertiary.outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(String.join(" ", tertiary.presentation().observations())).contains("tertiary");
        assertThat(mix(22, in("k2cr2o7-acid", 10), in("ethanol", 2)).presentation().neededTool()).isEqualTo("heater");
    }

    @Test
    void iodoformTestWithEthanol() {
        assertThat(mix(22, in("iodine-solution", 10), in("ethanol", 2)).presentation().neededTool()).isEqualTo("alkali");
        SimulationResult r = mix(60, in("iodine-solution", 10), in("ethanol", 2), in("naoh", 5));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(r.presentation().discoveryIds()).contains("iodoform-test");
    }

    @Test
    void biuretTurnsPurpleWithProteinOnly() {
        assertThat(mix(22, in("biuret", 5), in("egg-albumen", 5)).presentation().discoveryIds()).contains("biuret-test");
        assertThat(mix(22, in("biuret", 5), in("glycine", 5)).outcome()).isEqualTo(Outcome.NO_REACTION);
    }

    // ------------------------------------------------------------------ inorganic families

    @Test
    void copperSulfateWithExcessAmmoniaGoesDeepBlue() {
        SimulationResult r = mix(22, in("cuso4", 5), in("ammonia", 40));
        assertThat(r.presentation().discoveryIds()).contains("copper-ammine");
        assertThat(text(r)).contains("deep royal-blue");
    }

    @Test
    void ironThreeAndThiocyanateGoBloodRed() {
        SimulationResult r = mix(22, in("fecl3", 10), in("kscn", 5));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(r.presentation().discoveryIds()).contains("iron-thiocyanate");
        assertThat(text(r)).contains("blood-red");
    }

    @Test
    void precipitateColoursFollowSolubilityRules() {
        assertThat(text(mix(22, in("agno3", 10), in("na3po4", 10)))).contains("yellow").contains("silver phosphate");
        assertThat(text(mix(22, in("cacl2", 10), in("na2c2o4", 10)))).contains("calcium oxalate");
        assertThat(text(mix(22, in("pbno3", 10), in("k2cro4", 5)))).contains("bright yellow");
        assertThat(text(mix(22, in("feso4", 10), in("naoh", 10)))).contains("green");
        assertThat(text(mix(22, in("alcl3", 5), in("naoh", 30)))).contains("amphoteric");
        assertThat(text(mix(22, in("nicl2", 5), in("ammonia", 40)))).contains("lavender");
    }

    @Test
    void acidifiedPermanganateIsDecolourisedByReducingAgents() {
        assertThat(mix(22, in("kmno4-acid", 5), in("feso4", 20)).outcome()).isEqualTo(Outcome.REACTION);
        assertThat(mix(22, in("kmno4-acid", 5), in("na2so3", 10)).outcome()).isEqualTo(Outcome.REACTION);
        assertThat(mix(22, in("kmno4-acid", 5), in("oxalic-acid", 5)).presentation().neededTool()).isEqualTo("heater");
        assertThat(mix(70, in("kmno4-acid", 5), in("oxalic-acid", 5)).outcome()).isEqualTo(Outcome.REACTION);
        assertThat(mix(22, in("kmno4", 5), in("cyclohexene", 2)).presentation().discoveryIds()).contains("permanganate-alkene");
    }

    @Test
    void halogenDisplacementAndExtractionIntoHexane() {
        SimulationResult r = mix(22, in("chlorine-water", 10), in("kbr", 5));
        assertThat(r.presentation().discoveryIds()).contains("halogen-displacement");
        SimulationResult layer = mix(22, in("iodine-solution", 10), in("hexane", 5));
        assertThat(cues(layer, "layers")).isNotEmpty();
        assertThat(text(layer)).contains("violet");
    }

    @Test
    void metalsFollowTheReactivitySeries() {
        assertThat(mix(22, in("hcl", 20), in("ag-foil", 1)).outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(mix(22, in("hcl", 20), in("zn-granules", 1)).outcome()).isEqualTo(Outcome.REACTION);
        assertThat(mix(22, in("naoh", 20), in("al-foil", 0.5)).presentation().discoveryIds()).contains("amphoteric-metal");
        assertThat(mix(22, in("cuso4", 20), in("al-foil", 0.5)).outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(mix(22, in("cucl2", 20), in("al-foil", 0.5)).outcome()).isEqualTo(Outcome.REACTION);
    }

    @Test
    void carbonDioxideTurnsLimewaterMilky() {
        SimulationResult r = mix(22, in("limewater", 20), in("co2-gas", 30));
        assertThat(r.presentation().discoveryIds()).contains("limewater-test");
    }

    @Test
    void thermalDecompositionNeedsAFlame() {
        assertThat(mix(80, in("cuco3-powder", 1)).presentation().neededTool()).isEqualTo("spark");
        SimulationResult r = mix(22, true, in("cuco3-powder", 1));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(text(r)).contains("black");
    }

    @Test
    void flammableLiquidsBurnWithAFlame() {
        SimulationResult r = mix(22, true, in("ethanol", 5));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(r.presentation().discoveryIds()).contains("combustion");
        assertThat(cues(r, "flame")).isNotEmpty();
        assertThat(mix(22, true, in("vegetable-oil", 5)).outcome()).isEqualTo(Outcome.NO_REACTION);
    }

    @Test
    void flameTestColours() {
        SimulationResult r = mix(22, true, in("licl", 5));
        assertThat(text(r)).contains("crimson");
    }

    // ------------------------------------------------------------------ physical outcomes

    @Test
    void hexaneFloatsOnWater() {
        SimulationResult r = mix(22, in("hexane", 10), in("water", 20));
        assertThat(r.outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(cues(r, "layers")).singleElement().satisfies(c -> {
            assertThat(c.get("position").asText()).isEqualTo("top");
            assertThat(c.get("volumeMl").asDouble()).isEqualTo(10.0);
        });
        assertThat(String.join(" ", r.presentation().observations())).contains("floats on");
    }

    @Test
    void isoamylAlcoholFormsALayerOnWater() {
        SimulationResult r = mix(22, in("isoamyl-alcohol", 10), in("water", 20));
        assertThat(r.outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(cues(r, "layers")).singleElement().satisfies(c -> assertThat(c.get("position").asText()).isEqualTo("top"));
        assertThat(String.join(" ", r.presentation().observations())).contains("only slightly soluble");
    }

    @Test
    void denserLiquidsSinkAndMiscibleOnesMix() {
        SimulationResult r = mix(22, in("methyl-salicylate", 5), in("water", 20));
        assertThat(cues(r, "layers")).singleElement().satisfies(c -> assertThat(c.get("position").asText()).isEqualTo("bottom"));
        SimulationResult mixes = mix(22, in("ethanol", 10), in("water", 20));
        assertThat(mixes.outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(cues(mixes, "layers")).isEmpty();
        assertThat(String.join(" ", mixes.presentation().observations())).contains("mixes completely");
    }

    @Test
    void dissolvingCanBeHotOrCold() {
        assertThat(r(mix(22, in("water", 20), in("naoh-pellets", 2)), "temperature")).isGreaterThan(30);
        assertThat(r(mix(22, in("water", 20), in("nh4cl-solid", 3)), "temperature")).isLessThan(20);
        assertThat(String.join(" ", mix(22, in("water", 20), in("sand", 2)).presentation().observations())).contains("sinks");
    }

    private static double r(SimulationResult res, String key) {
        return res.measurements().stream().filter(m -> m.key().equals(key)).findFirst().orElseThrow().value();
    }

    // ------------------------------------------------------------------ safety stays on

    @Test
    void newHazardousCombinationsAreBlocked() {
        assertThat(mix(22, in("h2o2", 5), in("propanone", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(22, in("h2so4-conc", 5), in("hno3", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(22, in("h2so4-conc", 5), in("kno3", 1)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(22, in("h2so4-conc", 5), in("methanoic-acid", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(22, in("bleach", 5), in("nh4cl", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(22, in("bleach", 5), in("toilet-cleaner", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(22, in("bleach", 5), in("window-cleaner", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(22, in("chlorine-water", 5), in("ammonia", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(22, in("naf", 5), in("hcl", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(22, in("el-I", 0.5), in("ammonia", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(22, in("h2o2", 5), in("h2so4-conc", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(22, in("kmno4-crystals", 0.1), in("ethanol", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(22, in("kno3", 1), in("glucose-powder", 1)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(22, in("agno3-acid", 5), in("ethanol", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(mix(22, in("kmno4", 5), in("toilet-cleaner", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
    }

    // ------------------------------------------------------------------ playground gaps closed

    @Test
    void bleachOxidisesBromideAndTurnsYellow() {
        SimulationResult r = mix(22, in("bleach", 10), in("kbr", 10));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(text(r)).contains("yellow");
        assertThat(mix(22, in("bleach", 10), in("kbr-crystals", 1)).outcome()).isEqualTo(Outcome.REACTION);
        // chloride is already "reduced chlorine": nothing for bleach to take
        assertThat(mix(22, in("bleach", 10), in("nacl", 10)).outcome()).isEqualTo(Outcome.NO_REACTION);
    }

    @Test
    void anyMultivalentMetalIonMakesSoapScum() {
        for (String salt : List.of("cacl2", "zncl2", "bacl2", "alcl3", "pbno3")) {
            SimulationResult r = mix(22, in("soap-solution", 10), in(salt, 10));
            assertThat(r.outcome()).as(salt).isEqualTo(Outcome.REACTION);
            assertThat(r.presentation().discoveryIds()).as(salt).contains("soap-scum");
        }
        // sodium and potassium soaps are the soluble ones
        assertThat(mix(22, in("soap-solution", 10), in("nacl", 10)).presentation().discoveryIds()).doesNotContain("soap-scum");
    }

    @Test
    void candleWaxBurnsOnlyWithAFlame() {
        assertThat(mix(22, false, in("candle-wax", 1)).outcome()).isEqualTo(Outcome.NO_REACTION);
        SimulationResult r = mix(22, true, in("candle-wax", 1));
        assertThat(r.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(cues(r, "flame")).isNotEmpty();
        assertThat(r.presentation().discoveryIds()).contains("combustion");
        assertThat(r.equationLatex()).contains("C_{25}H_{52}");
        // floating on water it stays too cool to light
        assertThat(mix(22, true, in("candle-wax", 1), in("water", 20)).outcome()).isEqualTo(Outcome.NO_REACTION);
    }

    @Test
    void detergentEmulsifiesOilInsteadOfLeavingALayer() {
        SimulationResult layers = mix(22, in("olive-oil", 10), in("water", 20));
        assertThat(cues(layers, "layers")).hasSize(1);
        assertThat(layers.presentation().title()).contains("Two layers");
        SimulationResult r = mix(22, in("olive-oil", 10), in("water", 20), in("detergent", 5));
        assertThat(r.outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(cues(r, "layers")).isEmpty();
        assertThat(r.presentation().discoveryIds()).contains("emulsifier");
        assertThat(r.presentation().title()).isEqualTo("Detergent emulsifies the oil");
        assertThat(text(r)).contains("milky");
        assertThat(Discovery.ALL).anyMatch(d -> d.id().equals("emulsifier"));
    }

    @Test
    void noReactionTitlesSayWhatHappened() {
        assertThat(mix(22, in("hcl", 10)).presentation().title()).isEqualTo("Hydrochloric acid on its own");
        assertThat(mix(22, in("water", 20), in("nh4cl-solid", 3)).presentation().title()).isEqualTo("It dissolves and the beaker cools");
        assertThat(mix(22, in("water", 20), in("naoh-pellets", 2)).presentation().title()).isEqualTo("It dissolves and the beaker warms");
        assertThat(mix(22, in("nacl", 10), in("kbr", 10)).presentation().title()).isEqualTo("They mix - no reaction");
        assertThat(mix(22, in("water", 20), in("sand", 2)).presentation().title()).isEqualTo("No observable reaction");
    }

    @Test
    void solidWeakAcidOnlyDissolvesInBaseThatIsLeftOver() {
        // equal acid and alkali leave nothing to carry the benzoic acid into solution
        SimulationResult neutral = mix(22, in("hcl", 10), in("naoh", 10), in("benzoic-acid", 1));
        assertThat(neutral.presentation().reactions()).noneMatch(x -> x.id().startsWith("acid-crystallises"));
        assertThat(text(neutral)).contains("only some of the benzoic acid dissolves");
        // plain water: a little dissolves and the rest just sits there - not a reaction, and not a free discovery
        for (String acid : List.of("benzoic-acid", "salicylic-acid", "aspirin")) {
            SimulationResult plain = mix(22, in("water", 20), in(acid, 1));
            assertThat(plain.outcome()).as(acid).isEqualTo(Outcome.NO_REACTION);
            assertThat(plain.presentation().discoveryIds()).as(acid).isEmpty();
        }
        // the real thing still works: acidifying sodium benzoate crashes benzoic acid out
        assertThat(mix(22, in("na-benzoate", 10), in("hcl", 10)).presentation().discoveryIds()).contains("weak-acid-crystals");
        // alkali alone still takes it all up as sodium benzoate
        assertThat(text(mix(22, in("naoh", 10), in("benzoic-acid", 1)))).doesNotContain("only some");
    }

    // ------------------------------------------------------------------ the sweep

    @Test
    void everyPairAndASampleOfTriplesIsModelled() {
        List<Substance> all = new ArrayList<>(CATALOGUE.all());
        Map<Kind, Integer> counts = new EnumMap<>(Kind.class);
        Map<String, Integer> noReactionReasons = new TreeMap<>();
        int prohibited = 0;
        List<String> unsupported = new ArrayList<>();
        for (double temp : new double[] {22, 75}) {
            for (int i = 0; i < all.size(); i++) {
                for (int j = i + 1; j < all.size(); j++) {
                    Substance a = all.get(i), b = all.get(j);
                    if (RULES.match(List.of(a, b)).isPresent()) {
                        prohibited++;
                        continue;
                    }
                    ChemistryEngine.Result r = ENGINE.run(List.of(new Portion(a, mid(a)), new Portion(b, mid(b))), temp, temp > 50);
                    counts.merge(r.kind(), 1, Integer::sum);
                    if (r.kind() == Kind.UNSUPPORTED && !superheavy(a) && !superheavy(b)) unsupported.add(a.id() + "+" + b.id());
                    if (r.kind() == Kind.NEEDS_CONDITIONS) {
                        assertThat(r.pending().get(0).message()).as(a.id() + "+" + b.id()).isNotBlank();
                    }
                    if (r.kind() == Kind.NO_REACTION && temp == 22) {
                        assertThat(r.reasons().size() + r.observations().size()).as(a.id() + "+" + b.id()).isPositive();
                        String why = r.reasons().isEmpty() ? r.observations().get(0) : r.reasons().get(0);
                        noReactionReasons.merge(why.length() > 60 ? why.substring(0, 60) : why, 1, Integer::sum);
                    }
                }
            }
        }
        Random rnd = new Random(7);
        for (int k = 0; k < 6000; k++) {
            List<Substance> picks = List.of(all.get(rnd.nextInt(all.size())), all.get(rnd.nextInt(all.size())),
                    all.get(rnd.nextInt(all.size())));
            if (RULES.match(picks).isPresent()) continue;
            double temp = 5 + rnd.nextInt(86);
            List<Portion> portions = picks.stream().map(s -> new Portion(s, mid(s))).toList();
            ChemistryEngine.Result r = ENGINE.run(portions, temp, rnd.nextBoolean());
            counts.merge(r.kind(), 1, Integer::sum);
            if (r.kind() == Kind.UNSUPPORTED && picks.stream().noneMatch(ChemistryCoverageTest::superheavy)) {
                unsupported.add(picks.stream().map(Substance::id).toList().toString());
            }
        }
        System.out.println("Coverage sweep: " + counts + ", prohibited pairs " + prohibited);
        noReactionReasons.entrySet().stream().sorted((x, y) -> y.getValue() - x.getValue()).limit(25)
                .forEach(e -> System.out.println("  " + e.getValue() + "x  " + e.getKey()));
        assertThat(unsupported).as("unsupported combinations").isEmpty();
    }

    private static boolean superheavy(Substance s) {
        return s.isElement() && s.element().superheavy();
    }

    private static double mid(Substance s) {
        return Math.round((s.limits().min() + s.limits().max()) / 4 * 100) / 100.0;
    }
}
