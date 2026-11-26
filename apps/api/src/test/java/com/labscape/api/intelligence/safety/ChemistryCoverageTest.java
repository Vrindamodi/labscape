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

    // ------------------------------------------------------------------ vessels: pour, split, filter

    private static List<SimulationRequest.Input> inputs(In... inputs) {
        List<SimulationRequest.Input> list = new ArrayList<>();
        for (In i : inputs) {
            Substance s = CATALOGUE.find(i.ref()).orElseThrow(() -> new AssertionError("not in catalogue: " + i.ref()));
            list.add(new SimulationRequest.Input(i.ref(), i.amount(), s.limits().unit(), null));
        }
        return list;
    }

    /** An earlier vessel and the part of it that was carried on. */
    private static SimulationRequest.Base from(String keep, double fraction, List<SimulationRequest.Base> bases, In... inputs) {
        return new SimulationRequest.Base(inputs(inputs), new SimulationRequest.Conditions(22.0, null, null, false), bases, keep, fraction);
    }

    private static SimulationRequest chained(List<SimulationRequest.Base> bases, In... inputs) {
        return new SimulationRequest("ves-" + IDS.incrementAndGet(), "chemistry", "sandbox", "att-cov", null, null, null,
                inputs(inputs), new SimulationRequest.Conditions(22.0, null, null, false), bases);
    }

    private SimulationResult into(List<SimulationRequest.Base> bases, In... inputs) {
        return pipeline.resolve(chained(bases, inputs), "vessels-" + IDS.get());
    }

    private static double volume(SimulationResult r) {
        return r(r, "volume");
    }

    @Test
    void filteringSplitsAMixtureIntoFiltrateAndResidue() {
        In[] mix = {in("bacl2", 10), in("na2so4", 10)};
        assertThat(cues(mix(22, mix), "precipitate")).isNotEmpty();

        SimulationResult filtrate = into(List.of(from("filtrate", 1, null, mix)));
        assertThat(filtrate.outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(filtrate.presentation().title()).isEqualTo("The filtrate");
        assertThat(cues(filtrate, "precipitate")).isEmpty();
        assertThat(volume(filtrate)).isEqualTo(20.0);

        SimulationResult residue = into(List.of(from("residue", 1, null, mix)));
        assertThat(residue.presentation().title()).isEqualTo("The residue");
        assertThat(volume(residue)).isEqualTo(0.0);
        assertThat(cues(residue, "precipitate")).singleElement().satisfies(c -> {
            assertThat(c.get("id").asText()).isEqualTo("BaSO4");
            assertThat(c.get("carried").asBoolean()).isTrue();
        });
        assertThat(text(residue)).contains("barium sulfate");
        // an insoluble salt is not touched by acid
        assertThat(into(List.of(from("residue", 1, null, mix)), in("hcl", 10)).outcome()).isEqualTo(Outcome.NO_REACTION);
    }

    @Test
    void filtrateAndResidueEachCarryOnReacting() {
        // 5 mmol copper sulfate with 5 mmol hydroxide: half the copper comes out as the hydroxide, half stays dissolved
        In[] mix = {in("cuso4", 10), in("naoh", 5)};
        SimulationResult moreAlkali = into(List.of(from("filtrate", 1, null, mix)), in("naoh", 10));
        assertThat(moreAlkali.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(moreAlkali.presentation().discoveryIds()).contains("copper-hydroxide");

        SimulationResult acidOnResidue = into(List.of(from("residue", 1, null, mix)), in("hcl", 10));
        assertThat(acidOnResidue.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(acidOnResidue.presentation().reactions()).anyMatch(x -> x.id().startsWith("hydroxide-acid-cu"));
        assertThat(cues(acidOnResidue, "dissolve")).anyMatch(c -> c.get("target").asText().equals("precipitate:Cu(OH)2"));
        assertThat(text(acidOnResidue)).contains("dissolves away");

        // with no filtering, the same three chemicals in one beaker never make the solid at all: order now matters
        assertThat(mix(22, in("cuso4", 10), in("naoh", 5), in("hcl", 10)).presentation().discoveryIds())
                .doesNotContain("copper-hydroxide");
    }

    @Test
    void everyGasComesWithItsStandardTests() {
        // oxygen relights a glowing splint
        JsonNode oxygen = cues(mix(22, in("h2o2", 20), in("mno2-powder", 0.5)), "gas").stream().filter(c -> c.get("gas").asText().equals("O2")).findFirst().orElseThrow();
        assertThat(oxygen.at("/tests/glowingSplint/result").asText()).isEqualTo("relights");
        assertThat(oxygen.at("/tests/blueLitmus/result").asText()).isEqualTo("none");
        // hydrogen pops with a lit splint and leaves a glowing one alone
        JsonNode hydrogen = cues(mix(22, in("hcl", 20), in("mg-ribbon", 0.2)), "gas").stream().filter(c -> c.get("gas").asText().equals("H2")).findFirst().orElseThrow();
        assertThat(hydrogen.at("/tests/litSplint/result").asText()).isEqualTo("pop");
        assertThat(hydrogen.at("/tests/glowingSplint/result").asText()).isEqualTo("none");
        // carbon dioxide puts a splint out and is weakly acidic
        JsonNode co2 = cues(mix(22, in("hcl", 20), in("caco3-chips", 2)), "gas").stream().filter(c -> c.get("gas").asText().equals("CO2")).findFirst().orElseThrow();
        assertThat(co2.at("/tests/litSplint/result").asText()).isEqualTo("out");
        assertThat(co2.at("/tests/blueLitmus/result").asText()).isEqualTo("red");
        assertThat(co2.at("/tests/redLitmus/result").asText()).isEqualTo("none");
        assertThat(co2.at("/tests/blueLitmus/note").asText()).contains("carbon dioxide");
        // every gas the engine can name a test for says something for all four tests
        com.labscape.api.intelligence.chem.Lore.GAS_TESTS.forEach((gas, t) -> {
            assertThat(com.labscape.api.intelligence.chem.Lore.GASES).as(gas).containsKey(gas);
            for (var test : List.of(t.litSplint(), t.glowingSplint(), t.blueLitmus(), t.redLitmus())) {
                assertThat(test.result()).as(gas).isIn("pop", "brighter", "out", "relights", "red", "blue", "white", "none");
                assertThat(test.note()).as(gas).isNotBlank();
            }
            // litmus results are colours; splint results are not
            assertThat(t.blueLitmus().result()).as(gas).isIn("red", "white", "none");
            assertThat(t.redLitmus().result()).as(gas).isIn("blue", "white", "none");
        });
    }

    @Test
    void aPrecipitateThatIsOnTheShelfBehavesLikeTheShelfChemical() {
        In[] chalk = {in("cacl2", 10), in("na2co3", 10)};
        assertThat(mix(22, chalk).presentation().discoveryIds()).contains("insoluble-carbonate");
        SimulationResult fizz = into(List.of(from("residue", 1, null, chalk)), in("hcl", 10));
        assertThat(fizz.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(fizz.presentation().discoveryIds()).contains("acid-carbonate");
        assertThat(cues(fizz, "gas")).anyMatch(c -> c.get("gas").asText().equals("CO2"));

        // copper pushed out of solution by zinc is real copper: it goes on to push silver out
        In[] plated = {in("zn-granules", 1), in("cuso4", 10)};
        SimulationResult silver = into(List.of(from("residue", 1, null, plated)), in("agno3", 10));
        assertThat(silver.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(silver.presentation().discoveryIds()).contains("displacement-silver");
    }

    @Test
    void splittingHalvesAndPouringTogetherReacts() {
        SimulationResult half = into(List.of(from("all", 0.5, null, in("hcl", 10), in("naoh", 10))));
        assertThat(volume(half)).isEqualTo(10.0);
        assertThat(half.presentation().title()).isEqualTo("A share of the mixture");

        SimulationResult together = into(List.of(from("all", 1, null, in("hcl", 10)), from("all", 1, null, in("naoh", 10))));
        assertThat(together.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(together.presentation().discoveryIds()).contains("neutralisation");
        assertThat(volume(together)).isEqualTo(20.0);

        // a filtrate can be split and each half tested differently
        var filtrate = from("filtrate", 1, null, in("bacl2", 20), in("na2so4", 2));
        SimulationResult test = into(List.of(from("all", 0.5, List.of(filtrate))), in("agno3", 5));
        assertThat(test.presentation().discoveryIds()).contains("silver-halide");
        assertThat(volume(test)).isEqualTo(16.0);
    }

    @Test
    void nothingToFilterSaysSo() {
        SimulationResult r = into(List.of(from("residue", 1, null, in("nacl", 10), in("kbr", 10))));
        assertThat(r.outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(r.presentation().title()).isEqualTo("Nothing on the filter paper");
        assertThat(r.cues()).isEmpty();
    }

    @Test
    void chainedVesselsKeepEverySafetyCheck() {
        // a blocked pair stays blocked however it is brought together
        assertThat(into(List.of(from("all", 1, null, in("bleach", 5))), in("hcl", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(into(List.of(from("all", 1, null, in("bleach", 5)), from("all", 0.5, null, in("vinegar", 5)))).outcome())
                .isEqualTo(Outcome.PROHIBITED);
        // filtering something off does not launder it
        assertThat(into(List.of(from("filtrate", 1, List.of(from("residue", 1, null, in("bleach", 5), in("sand", 1))))), in("hcl", 5))
                .outcome()).isEqualTo(Outcome.PROHIBITED);

        // an earlier vessel had to respect the limits too, and the running total still counts
        assertThat(into(List.of(from("all", 0.1, null, in("hcl", 500)))).reasonCode()).isEqualTo("QTY_ABOVE_LIMIT");
        assertThat(into(List.of(from("all", 1, null, in("hcl", 50))), in("hcl", 10)).reasonCode()).isEqualTo("QTY_ABOVE_LIMIT");
        assertThat(into(List.of(from("all", 0.5, null, in("hcl", 50))), in("hcl", 10)).outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(into(List.of(from("all", 1, null, in("water", 100)), from("all", 1, null, in("tap-water", 100)))).reasonCode())
                .isEqualTo("VESSEL_OVERFLOW");

        // and a chain cannot grow without end
        SimulationRequest.Base deep = from("all", 1, null, in("water", 10));
        for (int i = 0; i < 8; i++) deep = from("all", 1, List.of(deep));
        assertThat(into(List.of(deep)).reasonCode()).isEqualTo("TOO_MANY_STEPS");
    }

    @Test
    void hintsWorkOnWhatWasCarriedIn() {
        var residue = from("residue", 1, null, in("cacl2", 10), in("na2co3", 10));
        List<SafetyPipeline.TryNext> hints = pipeline.tryNext(chained(List.of(residue)));
        assertThat(hints).isNotEmpty();
        assertThat(hints).anyMatch(h -> "add".equals(h.kind()) && "acid-carbonate".equals(h.discoveryId()));
        assertThat(pipeline.tryNext(chained(List.of(from("all", 1, null, in("bleach", 5)))))).noneMatch(h -> "hcl".equals(h.ref()));
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

    // ------------------------------------------------------------------ the evaporating basin and strong heating

    private static final SimulationRequest.Conditions BOIL_DRY = new SimulationRequest.Conditions(22.0, null, null, false, true);
    private static final SimulationRequest.Conditions ROAST = new SimulationRequest.Conditions(22.0, null, null, true, false);

    /** An earlier vessel that had something done to the whole of it (boiled dry, heated strongly) before being carried on. */
    private static SimulationRequest.Base step(SimulationRequest.Conditions done, List<SimulationRequest.Base> bases, In... inputs) {
        return new SimulationRequest.Base(inputs(inputs), done, bases, "all", 1);
    }

    private SimulationResult boilDry(List<SimulationRequest.Base> bases, In... inputs) {
        return pipeline.resolve(new SimulationRequest("dry-" + IDS.incrementAndGet(), "chemistry", "sandbox", "att-cov", null, null, null,
                inputs(inputs), BOIL_DRY, bases), "basin-" + IDS.get());
    }

    private SimulationResult roast(List<SimulationRequest.Base> bases, In... inputs) {
        return pipeline.resolve(new SimulationRequest("hot-" + IDS.incrementAndGet(), "chemistry", "sandbox", "att-cov", null, null, null,
                inputs(inputs), ROAST, bases), "basin-" + IDS.get());
    }

    private static List<String> residue(SimulationResult r) {
        List<String> names = new ArrayList<>();
        for (JsonNode c : cues(r, "evaporate")) c.get("residue").forEach(x -> names.add(x.get("name").asText()));
        return names;
    }

    @Test
    void boilingSaltWaterDryLeavesTheSaltAndWaterBringsItBack() {
        In[] brine = {in("nacl", 20)};
        SimulationResult dry = boilDry(null, brine);
        assertThat(dry.outcome()).isEqualTo(Outcome.NO_REACTION);
        assertThat(residue(dry)).containsExactly("sodium chloride");
        assertThat(volume(dry)).isZero();
        assertThat(dry.presentation().discoveryIds()).contains("crystallisation");
        assertThat(text(dry)).contains("white crystals of sodium chloride");

        // the vessel afterwards: dry crystals, nothing else
        SimulationResult after = into(List.of(step(BOIL_DRY, null, brine)));
        assertThat(after.presentation().title()).isEqualTo("What the water left behind");
        assertThat(cues(after, "precipitate")).isNotEmpty();
        assertThat(volume(after)).isZero();

        // water in: the same salt solution as before
        SimulationResult back = into(List.of(step(BOIL_DRY, null, brine)), in("water", 20));
        assertThat(volume(back)).isEqualTo(20.0);
        ChemistryEngine.State again = ENGINE.run(ENGINE.run(null, portions(brine), 100, false, true).state(), portions(in("water", 20)), 22, false).state();
        assertThat(again.mol().get("Na+")).isCloseTo(0.02, org.assertj.core.data.Offset.offset(1e-9));
        assertThat(again.mol().get("Cl-")).isCloseTo(0.02, org.assertj.core.data.Offset.offset(1e-9));
        assertThat(again.hasSolid()).isFalse();
    }

    private static List<Portion> portions(In... inputs) {
        List<Portion> out = new ArrayList<>();
        for (In i : inputs) out.add(new Portion(CATALOGUE.find(i.ref()).orElseThrow(), i.amount()));
        return out;
    }

    @Test
    void neutralisingExactlyThenBoilingDryMakesTheSalt() {
        SimulationResult dry = boilDry(null, in("hcl", 20), in("naoh", 20));
        assertThat(residue(dry)).containsExactly("sodium chloride");
        // a salt the shelf does not stock still comes out, and still goes back
        SimulationResult nitrate = boilDry(null, in("agno3", 10), in("nacl", 10));
        assertThat(residue(nitrate)).contains("sodium nitrate");
    }

    @Test
    void mixturesThatMustNotGoOverAFlameAreRefusedNotBlocked() {
        record Case(String code, In... inputs) {}
        List<Case> cases = List.of(
                new Case("EVAPORATE_ACID", in("hcl", 20)),
                new Case("EVAPORATE_ACID", in("h2so4", 20), in("naoh", 5)),
                new Case("EVAPORATE_FLAMMABLE", in("ethanol", 10), in("water", 20)),
                new Case("EVAPORATE_FLAMMABLE", in("ethanol", 10)),
                new Case("EVAPORATE_TOXIC_FUMES", in("ammonia", 20)),
                new Case("EVAPORATE_TOXIC_FUMES", in("bleach", 10)),
                new Case("EVAPORATE_UNSAFE_RESIDUE", in("tollens", 5)),
                new Case("EVAPORATE_NO_WATER", in("table-salt", 2)));
        for (Case c : cases) {
            SimulationResult r = boilDry(null, c.inputs());
            assertThat(r.outcome()).as(c.code()).isEqualTo(Outcome.PROCEDURE_MISMATCH);
            assertThat(r.reasonCode()).isEqualTo(c.code());
            assertThat(cues(r, "evaporate")).isEmpty();
            // nothing was boiled: carried on, it is the same mixture it was
            ChemistryEngine.Result same = ENGINE.run(null, portions(c.inputs()), 100, false, true);
            ChemistryEngine.Result plain = ENGINE.run(null, portions(c.inputs()), 100, false, false);
            assertThat(same.state().liquidMl()).isEqualTo(plain.state().liquidMl());
            assertThat(same.state().parked()).isEmpty();
        }
        // ammonium nitrate is never left to dry over a flame, however it got there
        assertThat(boilDry(null, in("nh4no3", 2), in("water", 20)).reasonCode()).isEqualTo("EVAPORATE_UNSAFE_RESIDUE");
        // and the hot plate's own limit is where it was: only the basin goes past 90 °C
        assertThat(mix(100, in("nacl", 20)).reasonCode()).isEqualTo("TEMP_OUT_OF_RANGE");
    }

    @Test
    void blueCrystalsComeOutGoWhiteWhenRoastedAndBlueAgainWithWater() {
        In[] solution = {in("cuso4", 20)};
        SimulationResult dry = boilDry(null, solution);
        assertThat(residue(dry)).containsExactly("copper(II) sulfate");
        assertThat(text(dry)).contains("blue crystals of copper(ii) sulfate");

        List<SimulationRequest.Base> crystals = List.of(step(BOIL_DRY, null, solution));
        SimulationResult roasted = roast(crystals);
        assertThat(roasted.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(roasted.presentation().reactions()).anyMatch(x -> x.type().equals("dehydration"));

        // the white powder is carried on, and water turns it blue again
        List<SimulationRequest.Base> white = List.of(step(ROAST, crystals));
        SimulationResult powder = into(white);
        assertThat(powder.presentation().title()).isEqualTo("After strong heating");
        assertThat(cues(powder, "precipitate")).isNotEmpty();
        SimulationResult wet = into(white, in("water", 20));
        assertThat(wet.presentation().reactions()).anyMatch(x -> x.id().equals("hydration-copper-sulfate"));
        ChemistryEngine.State end = ENGINE.run(ENGINE.run(ENGINE.run(null, portions(solution), 100, false, true).state(), List.of(), 22, true).state(),
                portions(in("water", 20)), 22, false).state();
        assertThat(end.mol().get("Cu^2+")).isCloseTo(0.01, org.assertj.core.data.Offset.offset(1e-9));
    }

    @Test
    void whatStrongHeatingLeavesIsCarriedOn() {
        // copper carbonate roasts to black copper oxide, which then dissolves in warm acid like the oxide off the shelf
        List<SimulationRequest.Base> black = List.of(step(ROAST, null, in("cuco3-powder", 1)));
        ChemistryEngine.State oxide = ENGINE.run(null, portions(in("cuco3-powder", 1)), 22, true).state();
        assertThat(oxide.solids()).containsKey("CuO");
        assertThat(oxide.mol()).doesNotContainKey("CuCO3(s)");
        SimulationResult inAcid = pipeline.resolve(new SimulationRequest("acid-" + IDS.incrementAndGet(), "chemistry", "sandbox", "att-cov",
                null, null, null, inputs(in("h2so4", 20)), new SimulationRequest.Conditions(60.0, null, null, false), black), "basin-" + IDS.get());
        assertThat(inAcid.outcome()).isEqualTo(Outcome.REACTION);
        assertThat(inAcid.presentation().discoveryIds()).contains("acid-oxide");
        assertThat(cues(inAcid, "gas")).as("no carbonate left to fizz").isEmpty();
        // baking soda leaves washing soda, which still fizzes with acid, but only half as much carbonate is there
        ChemistryEngine.State soda = ENGINE.run(null, portions(in("baking-soda", 1.68)), 22, true).state();
        assertThat(soda.solids().get("Na2CO3")).isCloseTo(0.01, org.assertj.core.data.Offset.offset(1e-5));
    }

    @Test
    void dryCrystalsStillColourAFlameAndStayOnAFilterPaper() {
        List<SimulationRequest.Base> dried = List.of(step(BOIL_DRY, null, in("srcl2", 10)));
        SimulationResult flame = roast(List.of(new SimulationRequest.Base(List.of(), new SimulationRequest.Conditions(22.0, null, null, false),
                dried, "all", 0.02)));
        assertThat(flame.presentation().reactions()).anyMatch(x -> x.id().startsWith("flame-test-"));
        ChemistryEngine.State st = ENGINE.run(null, portions(in("srcl2", 10)), 100, false, true).state();
        assertThat(st.part("filtrate", 1).isEmpty()).isTrue();
        assertThat(st.part("residue", 0.5).parked().get("Sr^2+")).isCloseTo(0.0025, org.assertj.core.data.Offset.offset(1e-9));
    }

    @Test
    void tapWaterLeavesLimescaleAndSugarLeavesSyrup() {
        SimulationResult tap = boilDry(null, in("tap-water", 100));
        assertThat(text(tap)).contains("limescale");
        SimulationResult sugar = boilDry(null, in("sucrose", 20));
        assertThat(text(sugar)).contains("syrup");
        assertThat(sugar.presentation().discoveryIds()).doesNotContain("crystallisation");
        assertThat(text(boilDry(null, in("water", 20)))).contains("nothing at all is left");
        assertThat(into(List.of(step(BOIL_DRY, null, in("water", 20)))).presentation().title()).isEqualTo("Nothing left behind");
    }

    /**
     * Every water-based bottle on the shelf, on its own and with a few common partners, goes in the basin.
     * Each is either refused and left exactly as it was, or ends with no liquid and nothing dissolved; and
     * adding the water back never loses or invents a metal ion.
     */
    @Test
    void everySolutionOnTheShelfCanGoInTheBasin() {
        List<String> metals = List.of("Na+", "K+", "Li+", "Ag+", "Ca^2+", "Mg^2+", "Ba^2+", "Sr^2+", "Zn^2+", "Pb^2+", "Al^3+", "Cu^2+",
                "Fe^2+", "Fe^3+", "Mn^2+", "Co^2+", "Ni^2+", "Cr^3+");
        List<Substance> partners = List.of("water", "naoh", "hcl", "nacl", "na2co3", "h2so4", "ammonia", "cuso4", "agno3", "bacl2", "sucrose",
                "nh4cl", "kmno4", "kno3-solution", "k2cr2o7", "milk", "na-ethanoate").stream()
                .map(id -> CATALOGUE.find(id).orElseThrow()).toList();
        List<Substance> solutions = CATALOGUE.all().stream().filter(s -> !s.isElement() && !s.isSolid() && !s.isGas() && s.aqueous()).toList();
        assertThat(solutions.size()).isGreaterThan(80);
        int dried = 0, refused = 0;
        for (Substance a : solutions) {
            for (Substance b : partners) {
                List<Substance> picks = a.id().equals(b.id()) || "water".equals(b.id()) ? List.of(a) : List.of(a, b);
                if (RULES.match(picks).isPresent()) continue;
                List<Portion> portions = picks.stream().map(x -> new Portion(x, mid(x))).toList();
                String what = picks.stream().map(Substance::id).toList().toString();
                ChemistryEngine.Result plain = ENGINE.run(null, portions, 100, false, false);
                if (plain.kind() == Kind.UNSUPPORTED) continue;
                ChemistryEngine.Result r = ENGINE.run(null, portions, 100, false, true);
                ChemistryEngine.State st = r.state();
                if (r.kind() == Kind.PROCEDURE_MISMATCH && r.reasonCode().startsWith("EVAPORATE_")) {
                    refused++;
                    assertThat(st.liquidMl()).as(what).isEqualTo(plain.state().liquidMl());
                    assertThat(st.mol()).as(what).isEqualTo(plain.state().mol());
                    continue;
                }
                dried++;
                assertThat(st.liquidMl()).as(what).isZero();
                assertThat(st.mol().keySet()).as(what + ": nothing dissolved without water").isEqualTo(st.solidKeys());
                assertThat(st.portions()).as(what).allMatch(x -> x.substance().isSolid() || x.substance().isElement());
                // an oxidiser is never left dry on something it can burn
                boolean oxidiser = st.parked().keySet().stream().anyMatch(k -> java.util.Set.of("NO3-", "MnO4-", "Cr2O7^2-", "CrO4^2-", "IO3-").contains(k))
                        || st.solids().keySet().stream().anyMatch(f -> f.matches(".*(NO3|MnO4|Cr2O7|CrO4|IO3).*"));
                boolean fuel = st.parked().keySet().stream().anyMatch(k -> k.startsWith("org:") || k.equals("NH4+") || k.equals("CH3COO-")
                        || k.equals("starch") || k.equals("SCN-")) || st.solids().keySet().stream().anyMatch(f -> f.contains("NH4"));
                assertThat(oxidiser && fuel).as(what + ": oxidiser dried with fuel").isFalse();
                if (st.isEmpty()) continue; // nothing was dissolved: the basin is simply empty
                // the dry residue can be worked on: shown as it is, roasted, and wetted again
                assertThat(ENGINE.run(st, List.of(), 22, false).state()).as(what).isNotNull();
                assertThat(ENGINE.run(st, List.of(), 22, true).state()).as(what).isNotNull();
                ChemistryEngine.State wet = ENGINE.run(st, List.of(new Portion(CATALOGUE.find("water").orElseThrow(), 50)), 22, false).state();
                assertThat(wet).as(what).isNotNull();
                assertThat(wet.parked()).as(what + ": water takes the crystals back up").isEmpty();
                for (String metal : metals) {
                    double before = plain.state().mol().getOrDefault(metal, 0.0);
                    double now = wet.mol().getOrDefault(metal, 0.0);
                    // (a solid that was already there may give up a little more of itself to fresh water: that is not inventing)
                    if (!plain.state().hasSolid()) assertThat(now).as(what + " " + metal + " is not invented").isLessThanOrEqualTo(before + 1e-9);
                    // whatever is not back in solution is sitting there as a solid, not lost
                    if (!wet.hasSolid()) assertThat(now).as(what + " " + metal + " is not lost").isCloseTo(before, org.assertj.core.data.Offset.offset(1e-9));
                }
            }
        }
        System.out.println("Basin sweep: " + dried + " boiled dry, " + refused + " refused");
        assertThat(dried).isGreaterThan(300);
        assertThat(refused).isGreaterThan(50);
    }

    @Test
    void aDriedOxidiserIsHeldToTheRulesForTheSolid() {
        // in solution these are allowed, as they always were
        assertThat(mix(22, in("kno3-solution", 10), in("sucrose", 10)).outcome()).isNotEqualTo(Outcome.PROHIBITED);
        // boiled dry they would be an oxidiser sitting on fuel: refused with the reason, and not counted as a blocked mix
        In[][] pairs = {{in("kmno4", 10), in("sucrose", 10)}, {in("kno3-solution", 10), in("glucose", 10)}, {in("k2cr2o7", 10), in("nh4cl", 10)},
                {in("agno3", 10), in("sucrose", 10)}, {in("cuno32", 10), in("milk", 10)}, {in("k2cro4", 10), in("nh42so4", 10)},
                {in("kno3-solution", 10), in("kscn", 10)}, {in("kno3-solution", 10), in("na-ethanoate", 10)}, {in("kio3", 10), in("sucrose", 10)},
                {in("kmno4", 10), in("h2so4", 10), in("feso4", 10)}};
        for (In[] pair : pairs) {
            SimulationResult r = boilDry(null, pair);
            assertThat(r.outcome()).as(pair[0].ref() + " + " + pair[1].ref()).isEqualTo(Outcome.PROCEDURE_MISMATCH);
            assertThat(r.reasonCode()).as(pair[0].ref() + " + " + pair[1].ref()).startsWith("EVAPORATE_");
        }
        // on its own an oxidiser can be crystallised, like the jar of it on the shelf...
        List<SimulationRequest.Base> nitre = List.of(step(BOIL_DRY, null, in("kno3-solution", 10)));
        assertThat(residue(boilDry(null, in("kno3-solution", 10)))).containsExactly("potassium nitrate");
        assertThat(into(nitre).outcome()).isEqualTo(Outcome.NO_REACTION);
        // ...and then nothing that burns may be added to it, exactly as for the jar
        assertThat(mix(22, in("kno3", 1), in("sugar", 1)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(into(nitre, in("sugar", 1)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(into(List.of(step(BOIL_DRY, null, in("kmno4", 10))), in("glycerol", 5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        assertThat(into(List.of(step(BOIL_DRY, null, in("kmno4", 10))), in("mg-ribbon", 0.5)).outcome()).isEqualTo(Outcome.PROHIBITED);
        // water is fine
        assertThat(into(nitre, in("water", 20)).outcome()).isNotEqualTo(Outcome.PROHIBITED);
    }
}
