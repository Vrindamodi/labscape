package com.labscape.api.intelligence.chem;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Names, colours, gas smells and "did you know?" facts for substances and reactions. */
public final class Lore {

    private Lore() {}

    public static final String SNIFF_SAFETY = "Never sniff a gas directly - in a real lab you waft it gently towards your nose.";

    /** colourHex null = colourless. */
    public record Gas(String name, String colourHex, String smell) {}

    public static final Map<String, Gas> GASES = Map.ofEntries(
            Map.entry("H2", new Gas("Hydrogen", null, "No smell at all")),
            Map.entry("O2", new Gas("Oxygen", null, "No smell at all")),
            Map.entry("N2", new Gas("Nitrogen", null, "No smell at all")),
            Map.entry("CO2", new Gas("Carbon dioxide", null, "Almost no smell - just a faint sharp tang")),
            Map.entry("CO", new Gas("Carbon monoxide", null, "No smell - which is exactly why it is so dangerous")),
            Map.entry("Cl2", new Gas("Chlorine", "#cfe35a", "Sharp and choking, like a very strong swimming pool")),
            Map.entry("F2", new Gas("Fluorine", "#e8f0a0", "Sharp and pungent, stinging the nose")),
            Map.entry("Br2", new Gas("Bromine vapour", "#c8641e", "Sharp and choking - 'bromine' comes from the Greek for stench")),
            Map.entry("I2", new Gas("Iodine vapour", "#8a4fd0", "Sharp, like a hospital antiseptic")),
            Map.entry("NH3", new Gas("Ammonia", null, "Sharp and eye-watering, like smelling salts or strong cleaning fluid")),
            Map.entry("SO2", new Gas("Sulfur dioxide", null, "Choking, like a match that has just been struck")),
            Map.entry("H2S", new Gas("Hydrogen sulfide", null, "Rotten eggs")),
            Map.entry("HCl", new Gas("Hydrogen chloride", "#f4f7fb", "Sharp, acidic and stinging; it fumes in damp air")),
            Map.entry("HBr", new Gas("Hydrogen bromide", "#f4f7fb", "Sharp and acidic")),
            Map.entry("HI", new Gas("Hydrogen iodide", null, "Sharp and acidic")),
            Map.entry("HF", new Gas("Hydrogen fluoride", null, "Sharp and irritating")),
            Map.entry("NO2", new Gas("Nitrogen dioxide", "#b5521f", "Sharp and biting")),
            Map.entry("H2O", new Gas("Steam", "#ffffff", "No smell - just warm, damp air")));

    /** Gases that need a real-lab warning: "toxic", "corrosive" or "flammable". */
    public static final Map<String, String> GAS_HAZARD = Map.ofEntries(
            Map.entry("H2S", "toxic"), Map.entry("Cl2", "toxic"), Map.entry("SO2", "toxic"), Map.entry("NO2", "toxic"),
            Map.entry("Br2", "toxic"), Map.entry("CO", "toxic"), Map.entry("HF", "toxic"), Map.entry("F2", "toxic"),
            Map.entry("HCl", "corrosive"), Map.entry("HBr", "corrosive"), Map.entry("HI", "corrosive"), Map.entry("NH3", "corrosive"),
            Map.entry("H2", "flammable"));

    public static final Map<String, String> GAS_WARNING = Map.ofEntries(
            Map.entry("H2S", "Hydrogen sulfide is toxic even in small amounts, and it numbs your sense of smell. Fume cupboard only."),
            Map.entry("Cl2", "Chlorine is a toxic gas that damages the lungs. Fume cupboard only."),
            Map.entry("SO2", "Sulfur dioxide is toxic and can trigger asthma. Fume cupboard only."),
            Map.entry("NO2", "Nitrogen dioxide is a toxic brown gas. Fume cupboard only."),
            Map.entry("Br2", "Bromine vapour is toxic and burns skin and lungs. Fume cupboard only."),
            Map.entry("CO", "Carbon monoxide is toxic and has no smell at all. Never breathe it."),
            Map.entry("HF", "Hydrogen fluoride is extremely toxic and corrosive."),
            Map.entry("F2", "Fluorine is extremely toxic and reactive."),
            Map.entry("HCl", "Hydrogen chloride fumes are corrosive to eyes and lungs. Use a fume cupboard."),
            Map.entry("HBr", "Hydrogen bromide fumes are corrosive to eyes and lungs."),
            Map.entry("HI", "Hydrogen iodide fumes are corrosive to eyes and lungs."),
            Map.entry("NH3", "Ammonia stings the eyes and lungs. Waft, never sniff."),
            Map.entry("H2", "Hydrogen is highly flammable - keep flames away until you mean to test it."));

    private static final Map<String, String> NAMES = new ConcurrentHashMap<>(Map.ofEntries(
            Map.entry("H2O", "Water"), Map.entry("H2", "Hydrogen gas"), Map.entry("O2", "Oxygen gas"),
            Map.entry("CO2", "Carbon dioxide"), Map.entry("CO", "Carbon monoxide"), Map.entry("SO2", "Sulfur dioxide"),
            Map.entry("NH3", "Ammonia"), Map.entry("S", "Sulfur"), Map.entry("Cu", "Copper"), Map.entry("Ag", "Silver"),
            Map.entry("Fe", "Iron"), Map.entry("Zn", "Zinc"), Map.entry("Mg", "Magnesium"), Map.entry("Pb", "Lead"),
            Map.entry("AgCl", "Silver chloride"), Map.entry("AgBr", "Silver bromide"), Map.entry("AgI", "Silver iodide"),
            Map.entry("BaSO4", "Barium sulfate"), Map.entry("BaCO3", "Barium carbonate"), Map.entry("CaCO3", "Calcium carbonate"),
            Map.entry("MgCO3", "Magnesium carbonate"), Map.entry("ZnCO3", "Zinc carbonate"), Map.entry("CuCO3", "Copper(II) carbonate"),
            Map.entry("FeCO3", "Iron(II) carbonate"), Map.entry("Ag2CO3", "Silver carbonate"), Map.entry("Fe(OH)3", "Iron(III) hydroxide"),
            Map.entry("Cu(OH)2", "Copper(II) hydroxide"), Map.entry("Fe(OH)2", "Iron(II) hydroxide"), Map.entry("Zn(OH)2", "Zinc hydroxide"),
            Map.entry("Mg(OH)2", "Magnesium hydroxide"), Map.entry("Ca(OH)2", "Calcium hydroxide"), Map.entry("Ag2O", "Silver oxide"),
            Map.entry("CaSO4", "Calcium sulfate"), Map.entry("CuI", "Copper(I) iodide"), Map.entry("MnO2", "Manganese(IV) oxide"),
            Map.entry("CuSO4·5H2O", "Copper(II) sulfate crystals"), Map.entry("[Cu(NH3)4]^2+", "Tetraamminecopper(II) ion"),
            Map.entry("[Zn(OH)4]^2-", "Zincate ion"), Map.entry("[Zn(NH3)4]^2+", "Tetraamminezinc ion"),
            Map.entry("PbI2", "Lead(II) iodide"), Map.entry("PbCl2", "Lead(II) chloride"), Map.entry("PbBr2", "Lead(II) bromide"),
            Map.entry("PbSO4", "Lead(II) sulfate"), Map.entry("Pb(OH)2", "Lead(II) hydroxide"), Map.entry("Al(OH)3", "Aluminium hydroxide"),
            Map.entry("Ni(OH)2", "Nickel(II) hydroxide"), Map.entry("Co(OH)2", "Cobalt(II) hydroxide"), Map.entry("Mn(OH)2", "Manganese(II) hydroxide"),
            Map.entry("Cr(OH)3", "Chromium(III) hydroxide"), Map.entry("HCl", "Hydrogen chloride"), Map.entry("HBr", "Hydrogen bromide"),
            Map.entry("HI", "Hydrogen iodide"), Map.entry("HF", "Hydrogen fluoride"), Map.entry("H2S", "Hydrogen sulfide"), Map.entry("FeS", "Iron(II) sulfide"),
            Map.entry("P4O10", "Phosphorus(V) oxide"), Map.entry("PCl3", "Phosphorus trichloride"), Map.entry("I2", "Iodine"),
            Map.entry("Br2", "Bromine"), Map.entry("Cl2", "Chlorine"), Map.entry("NaOCl", "Sodium hypochlorite (bleach)")));

    private static final Map<String, String> COLOURS = new ConcurrentHashMap<>(Map.ofEntries(
            Map.entry("H2O", "#7cc8ff"), Map.entry("AgCl", "#f5f5f3"), Map.entry("AgBr", "#eee3bf"), Map.entry("AgI", "#f2e27a"),
            Map.entry("BaSO4", "#fbfbfb"), Map.entry("CaCO3", "#f7f7f5"), Map.entry("CuCO3", "#58a894"), Map.entry("Fe(OH)3", "#9b4a1c"),
            Map.entry("Cu(OH)2", "#4a9fe0"), Map.entry("Fe(OH)2", "#6d8f58"), Map.entry("Ag2O", "#5a3a22"), Map.entry("S", "#f2e45c"),
            Map.entry("Cu", "#b5653a"), Map.entry("Ag", "#d9dde3"), Map.entry("CuI", "#e8ddc8"), Map.entry("MnO2", "#4a2f1d"),
            Map.entry("PbI2", "#f7c21a"), Map.entry("CuSO4·5H2O", "#2f86dc"), Map.entry("[Cu(NH3)4]^2+", "#1d3fd0"),
            Map.entry("Ni(OH)2", "#7fc47a"), Map.entry("Co(OH)2", "#5a78c8"), Map.entry("Cr(OH)3", "#5f8a62"), Map.entry("P4O10", "#ffffff"),
            Map.entry("Cl2", "#cfe35a"), Map.entry("Br2", "#c8641e"), Map.entry("I2", "#5a2a6a")));

    private static final Map<String, String> REACTION_FACTS = Map.ofEntries(
            Map.entry("neutralisation", "Indigestion tablets work by neutralisation: a mild base cancels out excess stomach acid."),
            Map.entry("neutralisation-ammonia", "Ammonium salts made this way are among the most-used fertilisers in the world."),
            Map.entry("acid-carbonate", "Limestone buildings and statues slowly dissolve in acid rain by this same reaction."),
            Map.entry("acid-hydrogencarbonate", "Baking powder makes cakes rise by releasing carbon dioxide bubbles in the batter."),
            Map.entry("acid-sulfide", "Hydrogen sulfide is what makes rotten eggs and stink bombs smell - and volcanoes too."),
            Map.entry("acid-metal", "Hydrogen made like this filled the first hydrogen balloons in 1783."),
            Map.entry("acid-oxide", "Metal oxides are 'basic': they neutralise acids just like alkalis do."),
            Map.entry("thiosulfate-acid", "Chemists time how long a cross under the flask takes to disappear to measure reaction rate."),
            Map.entry("peroxide-catalysed", "Your liver contains catalase, an enzyme that breaks down hydrogen peroxide millions of times faster."),
            Map.entry("iodide-oxidation", "The iodine clock reaction can be tuned to change colour after almost exactly any number of seconds."),
            Map.entry("starch-iodine", "The blue-black colour comes from iodine atoms lining up inside coiled starch molecules."),
            Map.entry("permanganate-decolourised", "Permanganate is so strongly coloured that it can be seen at one part per million."),
            Map.entry("displacement-copper", "Copper used to be mined this way: scrap iron was dropped into copper-rich water."),
            Map.entry("displacement-silver", "The 'silver tree' growing on copper wire is a classic chemistry demonstration."),
            Map.entry("silver-halide", "Silver halides darken in light - the basis of old photographic film."),
            Map.entry("barium-sulfate", "Barium sulfate is so insoluble it is safe to swallow for X-ray 'barium meals'."),
            Map.entry("copper-ammine", "This deep blue complex can dissolve cellulose - it was once used to make artificial silk."),
            Map.entry("amphoteric-zinc", "Amphoteric substances react with both acids and bases."),
            Map.entry("water-test", "Anhydrous copper sulfate is used to check whether a liquid contains water."),
            Map.entry("alkali-water", "The further down group 1 you go, the more violent the reaction with water becomes."),
            Map.entry("alkaline-earth-water", "Calcium hydroxide made this way is 'slaked lime', used in mortar and plaster."),
            Map.entry("water-synthesis", "Hydrogen and oxygen combining releases so much energy that it launched the Space Shuttle."),
            Map.entry("hydrogen-chloride", "Dissolve hydrogen chloride in water and you get hydrochloric acid - the acid in your stomach."),
            Map.entry("metal-burning", "Fireworks get their sparkle from burning metal powders like magnesium and aluminium."),
            Map.entry("salt-synthesis", "Sodium and chlorine are both dangerous alone, but together they make table salt."),
            Map.entry("metal-sulfide", "Many metal ores in the ground are sulfides, such as galena (lead sulfide)."),
            Map.entry("nitride", "Magnesium burning in air makes a little magnesium nitride as well as the oxide."),
            Map.entry("nonmetal-burning", "Burning sulfur-containing fuels makes sulfur dioxide, one cause of acid rain."),
            Map.entry("halogen-displacement", "A more reactive halogen always pushes a less reactive one out of its compounds."),
            Map.entry("chlorine-bleach", "Bleach is made by bubbling chlorine through sodium hydroxide solution."),
            Map.entry("golden-rain", "Lead(II) iodide dissolves in hot water and recrystallises as shimmering golden flakes."),
            Map.entry("cold-pack", "Instant cold packs work because dissolving ammonium nitrate takes in heat."),
            Map.entry("ammonia-release", "Warming an ammonium salt with alkali and testing with damp red litmus is the test for ammonium ions."),
            Map.entry("indicator-acid", "Red cabbage juice is a natural indicator - it turns red in acid."),
            Map.entry("indicator-alkali", "Hydrangea flowers change colour depending on the pH of the soil."),
            Map.entry("iron3-reduction", "Iron(III) chloride is used to etch copper circuit boards."),
            Map.entry("magnesium-water", "Magnesium reacts so slowly with cold water that you'd wait days to collect a test tube of hydrogen."),
            Map.entry("copper-hydroxide", "Coloured hydroxide precipitates are used to identify metal ions in unknown solutions."),
            Map.entry("iron3-hydroxide", "Rust is mostly hydrated iron(III) oxide - closely related to this brown solid."),
            Map.entry("iron2-hydroxide", "Iron(II) hydroxide turns brown in air as oxygen converts it to iron(III)."),
            Map.entry("white-hydroxide", "Magnesium hydroxide is the 'milk of magnesia' antacid."),
            Map.entry("insoluble-carbonate", "Stalactites in caves are made of calcium carbonate that precipitated out of water."),
            Map.entry("calcium-sulfate", "Calcium sulfate is the mineral gypsum, used to make plaster of Paris."),
            Map.entry("copper-iodide", "Copper(I) iodide is used in cloud seeding to help rain form."),
            Map.entry("iodine-decolourised", "Thiosulfate removing iodine colour is used to measure how much iodine a sample holds."),
            Map.entry("peroxide-iron", "Iron(II) turning to iron(III) is why fresh iron supplements can stain brown."),
            Map.entry("permanganate-dissolving", "Diffusion spreads the purple colour without any stirring at all."));

    public static String name(String formula) {
        return NAMES.getOrDefault(formula, formula);
    }

    public static String colour(String formula) {
        return COLOURS.get(formula);
    }

    public static void register(String formula, String name, String colourHex) {
        NAMES.putIfAbsent(formula, name);
        if (colourHex != null) COLOURS.putIfAbsent(formula, colourHex);
    }

    public static String reactionFact(String discoveryId) {
        return discoveryId == null ? null : REACTION_FACTS.get(discoveryId);
    }

    private static final Map<String, String> ANIONS = Map.ofEntries(
            Map.entry("Cl", "chloride"), Map.entry("Br", "bromide"), Map.entry("I", "iodide"), Map.entry("F", "fluoride"),
            Map.entry("O", "oxide"), Map.entry("S", "sulfide"), Map.entry("N", "nitride"), Map.entry("H", "hydride"),
            Map.entry("SO4", "sulfate"), Map.entry("NO3", "nitrate"), Map.entry("CO3", "carbonate"),
            Map.entry("CH3COO", "ethanoate"), Map.entry("OH", "hydroxide"), Map.entry("HCO3", "hydrogencarbonate"));

    /** "Iron", 3, "Cl", variable valence -> "Iron(III) chloride". */
    public static String saltName(String metalName, int charge, boolean variableValence, String anion) {
        String roman = switch (charge) {
            case 1 -> "I";
            case 2 -> "II";
            case 3 -> "III";
            case 4 -> "IV";
            case 5 -> "V";
            case 6 -> "VI";
            default -> String.valueOf(charge);
        };
        String cation = variableValence ? metalName + "(" + roman + ")" : metalName;
        return cation + " " + ANIONS.getOrDefault(anion, anion);
    }
}
