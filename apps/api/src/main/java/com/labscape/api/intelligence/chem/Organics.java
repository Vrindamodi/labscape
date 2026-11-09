package com.labscape.api.intelligence.chem;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Organic compounds the engine knows, keyed by their species key ("org:ethanol"). Catalogue entries
 * only reference these keys; everything chemical about the molecule lives here.
 */
final class Organics {

    private Organics() {}

    /**
     * @param family  alcohol, aldehyde, ketone, ester, alkane, alkene, arene, sugar, lipid, protein, amino-acid, enzyme, other
     * @param cls  alcohol class: primary, secondary, tertiary (null otherwise)
     * @param c @param h @param o  molecular formula counts (combustion); 0 = does not burn here
     * @param unsat  C=C double bonds per molecule (bromine water)
     * @param iodoformI2  moles of I2 per molecule in the iodoform test (0 = negative)
     * @param ohCount  OH groups that can be esterified
     * @param flags  fehling (Fehling's/Benedict's positive), tollens, oxidisable (warm acidified dichromate /
     *     permanganate), ferment (yeast), sooty (smoky flame), hydrolysable (sucrose)
     * @param oxName @param oxFormula  product of mild oxidation
     * @param esterAlcohol @param esterAcid  for esters: the alcohol key and weak-acid key they hydrolyse to
     */
    record Compound(String key, String name, String formula, String family, String cls, int c, int h, int o, double molarMass,
            int unsat, int iodoformI2, int ohCount, Set<String> flags, String alkyl, String alkylFormula, String smell,
            String oxName, String oxFormula, String esterAlcohol, String esterAcid) {

        boolean has(String flag) {
            return flags.contains(flag);
        }
    }

    static final Map<String, Compound> ALL = new LinkedHashMap<>();

    private static void add(Compound c) {
        ALL.put(c.key(), c);
    }

    private static void alcohol(String key, String name, String formula, String cls, int c, int h, int o, double mm, int iodo,
            int oh, String alkyl, String alkylFormula, String smell, String oxName, String oxFormula, String... extra) {
        Set<String> flags = new java.util.HashSet<>(Set.of(extra));
        if (!"tertiary".equals(cls)) flags.add("oxidisable");
        add(new Compound(key, name, formula, "alcohol", cls, c, h, o, mm, 0, iodo, oh, Set.copyOf(flags), alkyl, alkylFormula,
                smell, oxName, oxFormula, null, null));
    }

    private static void plain(String key, String name, String formula, String family, int c, int h, int o, double mm, int unsat,
            int iodo, String smell, String oxName, String oxFormula, String... flags) {
        add(new Compound(key, name, formula, family, null, c, h, o, mm, unsat, iodo, 0, Set.of(flags), null, null, smell,
                oxName, oxFormula, null, null));
    }

    private static void ester(String key, String name, String formula, int c, int h, int o, double mm, String alcohol,
            String acid, String smell, String... flags) {
        add(new Compound(key, name, formula, "ester", null, c, h, o, mm, 0, 0, 0, Set.of(flags), null, null, smell, null, null,
                alcohol, acid));
    }

    static {
        alcohol("org:methanol", "Methanol", "CH3OH", "primary", 1, 4, 1, 32.04, 0, 1, "methyl", "CH3",
                "a faint, alcoholic smell", "methanal", "HCHO");
        alcohol("org:ethanol", "Ethanol", "C2H5OH", "primary", 2, 6, 1, 46.07, 4, 1, "ethyl", "C2H5",
                "a sharp, alcoholic smell", "ethanal", "CH3CHO");
        alcohol("org:propan-1-ol", "Propan-1-ol", "C3H7OH", "primary", 3, 8, 1, 60.10, 0, 1, "propyl", "C3H7",
                "a sharp, alcoholic smell", "propanal", "C2H5CHO");
        alcohol("org:propan-2-ol", "Propan-2-ol", "(CH3)2CHOH", "secondary", 3, 8, 1, 60.10, 4, 1, "propan-2-yl (isopropyl)",
                "CH(CH3)2", "the smell of rubbing alcohol", "propanone", "CH3COCH3");
        alcohol("org:butan-1-ol", "Butan-1-ol", "C4H9OH", "primary", 4, 10, 1, 74.12, 0, 1, "butyl", "C4H9",
                "a strong, sweet, banana-like alcohol smell", "butanal", "C3H7CHO");
        alcohol("org:butan-2-ol", "Butan-2-ol", "CH3CH(OH)C2H5", "secondary", 4, 10, 1, 74.12, 4, 1, "butan-2-yl", "CH(CH3)C2H5",
                "a strong alcohol smell", "butanone", "CH3COC2H5");
        alcohol("org:2-methylpropan-2-ol", "2-Methylpropan-2-ol", "(CH3)3COH", "tertiary", 4, 10, 1, 74.12, 0, 1, "tert-butyl",
                "C(CH3)3", "a camphor-like smell", null, null);
        alcohol("org:3-methylbutan-1-ol", "Isoamyl alcohol", "(CH3)2CHCH2CH2OH", "primary", 5, 12, 1, 88.15, 0, 1,
                "3-methylbutyl (isoamyl)", "CH2CH2CH(CH3)2", "a musty, unpleasant 'fusel oil' smell", "3-methylbutanal",
                "(CH3)2CHCH2CHO");
        alcohol("org:pentan-1-ol", "Pentan-1-ol", "C5H11OH", "primary", 5, 12, 1, 88.15, 0, 1, "pentyl", "C5H11",
                "a mild, fusel-oil smell", "pentanal", "C4H9CHO");
        alcohol("org:octan-1-ol", "Octan-1-ol", "C8H17OH", "primary", 8, 18, 1, 130.23, 0, 1, "octyl", "C8H17",
                "a fatty, citrus-like smell", "octanal", "C7H15CHO");
        alcohol("org:cyclohexanol", "Cyclohexanol", "C6H11OH", "secondary", 6, 12, 1, 100.16, 0, 1, "cyclohexyl", "C6H11",
                "a camphor-like smell", "cyclohexanone", "C6H10O");
        alcohol("org:benzyl-alcohol", "Benzyl alcohol", "C6H5CH2OH", "primary", 7, 8, 1, 108.14, 0, 1, "benzyl", "CH2C6H5",
                "a faint, sweet smell", "benzaldehyde", "C6H5CHO", "sooty");
        alcohol("org:glycerol", "Glycerol", "C3H5(OH)3", "primary", 3, 8, 3, 92.09, 0, 3, "propane-1,2,3-triyl (glyceryl)",
                "C3H5", "no smell", null, null);
        alcohol("org:ethane-1,2-diol", "Ethane-1,2-diol", "HOCH2CH2OH", "primary", 2, 6, 2, 62.07, 0, 2, "ethane-1,2-diyl",
                "C2H4", "no smell", null, null);

        plain("org:methanal", "Methanal", "HCHO", "aldehyde", 1, 2, 1, 30.03, 0, 0, "a pungent, choking smell", "methanoic acid",
                "HCOOH", "fehling", "tollens", "oxidisable");
        plain("org:ethanal", "Ethanal", "CH3CHO", "aldehyde", 2, 4, 1, 44.05, 0, 3, "a sharp smell of green apples", "ethanoic acid",
                "CH3COOH", "fehling", "tollens", "oxidisable");
        plain("org:benzaldehyde", "Benzaldehyde", "C6H5CHO", "aldehyde", 7, 6, 1, 106.12, 0, 0, "almonds and marzipan",
                "benzoic acid", "C6H5COOH", "tollens", "oxidisable", "sooty");
        plain("org:vanillin", "Vanillin", "C8H8O3", "aldehyde", 8, 8, 3, 152.15, 0, 0, "vanilla", "vanillic acid", "C8H8O4",
                "tollens", "oxidisable", "sooty");
        plain("org:cinnamaldehyde", "Cinnamaldehyde", "C6H5CH=CHCHO", "aldehyde", 9, 8, 1, 132.16, 1, 0, "cinnamon",
                "cinnamic acid", "C6H5CH=CHCOOH", "tollens", "oxidisable", "sooty");
        plain("org:propanone", "Propanone", "CH3COCH3", "ketone", 3, 6, 1, 58.08, 0, 3, "a sweet, nail-varnish-remover smell",
                null, null);
        plain("org:butanone", "Butanone", "CH3COC2H5", "ketone", 4, 8, 1, 72.11, 0, 3, "a sweet, acetone-like smell", null, null);

        plain("org:glucose", "Glucose", "C6H12O6", "sugar", 6, 12, 6, 180.16, 0, 0, null, "gluconic acid", "C6H12O7",
                "fehling", "tollens", "oxidisable", "ferment");
        plain("org:fructose", "Fructose", "C6H12O6", "sugar", 6, 12, 6, 180.16, 0, 0, null, "oxidised sugar acids", "C6H12O7",
                "fehling", "tollens", "oxidisable", "ferment");
        plain("org:sucrose", "Sucrose", "C12H22O11", "sugar", 12, 22, 11, 342.30, 0, 0, null, null, null, "ferment", "hydrolysable");
        plain("org:lactose", "Lactose", "C12H22O11", "sugar", 12, 22, 11, 342.30, 0, 0, null, "lactobionic acid", "C12H22O12",
                "fehling", "tollens", "oxidisable");
        plain("org:maltose", "Maltose", "C12H22O11", "sugar", 12, 22, 11, 342.30, 0, 0, null, "maltobionic acid", "C12H22O12",
                "fehling", "tollens", "oxidisable", "ferment");

        ester("org:ethyl-ethanoate", "Ethyl ethanoate", "CH3COOC2H5", 4, 8, 2, 88.11, "org:ethanol", "CH3COOH",
                "pear drops - sweet and fruity, like nail-varnish remover");
        ester("org:3-methylbutyl-ethanoate", "3-Methylbutyl ethanoate (isoamyl acetate)", "CH3COOCH2CH2CH(CH3)2", 7, 14, 2, 130.19,
                "org:3-methylbutan-1-ol", "CH3COOH", "bananas and pear drops");
        ester("org:methyl-salicylate", "Methyl salicylate", "HOC6H4COOCH3", 8, 8, 3, 152.15, "org:methanol", "HSal",
                "wintergreen - like muscle-rub cream", "sooty");
        ester("org:ethyl-butanoate", "Ethyl butanoate", "C3H7COOC2H5", 6, 12, 2, 116.16, "org:ethanol", "C3H7COOH", "pineapple");
        ester("org:methyl-ethanoate", "Methyl ethanoate", "CH3COOCH3", 3, 6, 2, 74.08, "org:methanol", "CH3COOH",
                "a sweet, glue-like fruity smell");
        ester("org:propyl-ethanoate", "Propyl ethanoate", "CH3COOC3H7", 5, 10, 2, 102.13, "org:propan-1-ol", "CH3COOH", "pears");
        ester("org:butyl-ethanoate", "Butyl ethanoate", "CH3COOC4H9", 6, 12, 2, 116.16, "org:butan-1-ol", "CH3COOH",
                "apples, with a hint of banana");
        ester("org:pentyl-ethanoate", "Pentyl ethanoate", "CH3COOC5H11", 7, 14, 2, 130.19, "org:pentan-1-ol", "CH3COOH", "bananas");
        ester("org:octyl-ethanoate", "Octyl ethanoate", "CH3COOC8H17", 10, 20, 2, 172.27, "org:octan-1-ol", "CH3COOH", "oranges");
        ester("org:benzyl-ethanoate", "Benzyl ethanoate", "CH3COOCH2C6H5", 9, 10, 2, 150.17, "org:benzyl-alcohol", "CH3COOH",
                "jasmine flowers", "sooty");
        ester("org:methyl-butanoate", "Methyl butanoate", "C3H7COOCH3", 5, 10, 2, 102.13, "org:methanol", "C3H7COOH",
                "apples and pineapple");
        ester("org:ethyl-methanoate", "Ethyl methanoate", "HCOOC2H5", 3, 6, 2, 74.08, "org:ethanol", "HCOOH", "rum and raspberries");
        ester("org:methyl-benzoate", "Methyl benzoate", "C6H5COOCH3", 8, 8, 2, 136.15, "org:methanol", "C6H5COOH",
                "a fruity, feijoa-like smell", "sooty");
        ester("org:ethyl-propanoate", "Ethyl propanoate", "C2H5COOC2H5", 5, 10, 2, 102.13, "org:ethanol", "C2H5COOH",
                "pineapple");

        plain("org:hexane", "Hexane", "C6H14", "alkane", 6, 14, 0, 86.18, 0, 0, "a petrol-like smell", null, null);
        plain("org:cyclohexane", "Cyclohexane", "C6H12", "alkane", 6, 12, 0, 84.16, 0, 0, "a mild, petrol-like smell", null, null);
        plain("org:heptane", "Heptane", "C7H16", "alkane", 7, 16, 0, 100.20, 0, 0, "a petrol-like smell", null, null);
        plain("org:pentane", "Pentane", "C5H12", "alkane", 5, 12, 0, 72.15, 0, 0, "a petrol-like smell", null, null);
        plain("org:octane", "Octane", "C8H18", "alkane", 8, 18, 0, 114.23, 0, 0, "a petrol-like smell", null, null);
        plain("org:kerosene", "Kerosene", "C12H26", "alkane", 12, 26, 0, 170.3, 0, 0, "a paraffin-heater smell", null, null, "sooty");
        plain("org:paraffin", "Liquid paraffin", "C18H38", "alkane", 18, 38, 0, 254.5, 0, 0, "almost no smell", null, null, "sooty");
        plain("org:wax", "Paraffin wax", "C25H52", "alkane", 25, 52, 0, 352.7, 0, 0, "a faint waxy smell", null, null, "sooty");
        plain("org:methane", "Methane", "CH4", "alkane", 1, 4, 0, 16.04, 0, 0, "no smell (gas suppliers add a smelly warning chemical)",
                null, null);
        plain("org:butane", "Butane", "C4H10", "alkane", 4, 10, 0, 58.12, 0, 0, "almost no smell", null, null);
        plain("org:cyclohexene", "Cyclohexene", "C6H10", "alkene", 6, 10, 0, 82.14, 1, 0, "a sharp, petrol-like smell", null, null,
                "sooty");
        plain("org:hex-1-ene", "Hex-1-ene", "C6H12", "alkene", 6, 12, 0, 84.16, 1, 0, "a petrol-like smell", null, null, "sooty");
        plain("org:ethene", "Ethene", "C2H4", "alkene", 2, 4, 0, 28.05, 1, 0, "a faintly sweet smell", null, null, "sooty");
        plain("org:limonene", "Limonene", "C10H16", "alkene", 10, 16, 0, 136.24, 2, 0, "oranges", null, null, "sooty");
        plain("org:toluene", "Methylbenzene", "C6H5CH3", "arene", 7, 8, 0, 92.14, 0, 0, "a sweet, paint-thinner smell", null, null,
                "sooty");

        plain("org:oil", "Vegetable oil (triglyceride)", "C57H104O6", "lipid", 57, 104, 6, 885, 3, 0, null, null, null, "sooty");
        plain("org:lard", "Lard (saturated fat)", "C51H98O6", "lipid", 51, 98, 6, 807, 0, 0, null, null, null, "sooty");
        plain("org:milkfat", "Milk fat", "C51H98O6", "lipid", 0, 0, 0, 807, 0, 0, null, null, null);
        plain("org:albumin", "Albumin (egg-white protein)", "protein", "protein", 0, 0, 0, 66000, 0, 0, null, null, null);
        plain("org:casein", "Casein (milk protein)", "protein", "protein", 0, 0, 0, 24000, 0, 0, null, null, null);
        plain("org:gelatin", "Gelatin", "protein", "protein", 0, 0, 0, 90000, 0, 0, null, null, null);
        plain("org:glycine", "Glycine", "NH2CH2COOH", "amino-acid", 0, 0, 0, 75.07, 0, 0, null, null, null);
        plain("org:yeast", "Yeast", "yeast", "enzyme", 0, 0, 0, 1, 0, 0, "a warm, bready smell", null, null);
        plain("org:amylase", "Amylase", "enzyme", "enzyme", 0, 0, 0, 1, 0, 0, null, null, null);
        plain("org:catalase", "Catalase", "enzyme", "enzyme", 0, 0, 0, 1, 0, 0, null, null, null);
        plain("org:detergent", "Detergent", "C12H25OSO3Na", "other", 0, 0, 0, 288.4, 0, 0, null, null, null);
        plain("org:pva", "Polyvinyl alcohol", "(C2H4O)n", "other", 0, 0, 0, 44.05, 0, 0, null, null, null);
    }

    static Compound get(String key) {
        String k = key.endsWith("(s)") ? key.substring(0, key.length() - 3) : key;
        return ALL.get(k);
    }

    /** Ester produced from an alcohol and a weak acid: name, formula and smell. */
    record Ester(String name, String formula, String smell, String key) {}

    static Ester esterOf(Compound alcohol, Acids.Weak acid) {
        for (Compound c : ALL.values()) {
            if ("ester".equals(c.family()) && alcohol.key().equals(c.esterAlcohol()) && acid.key().equals(c.esterAcid())) {
                return new Ester(c.name(), c.formula(), c.smell(), c.key());
            }
        }
        String alkyl = alcohol.alkyl() == null ? alcohol.name().toLowerCase(java.util.Locale.ROOT) : alcohol.alkyl();
        String name = Character.toUpperCase(alkyl.charAt(0)) + alkyl.substring(1) + " " + acid.acylate();
        if (alcohol.ohCount() == 3) name = "Glyceryl tri" + acid.acylate() + (acid.key().equals("CH3COOH") ? " (triacetin)" : "");
        if (alcohol.ohCount() == 2) name = "Ethane-1,2-diyl di" + acid.acylate();
        String smell = switch (alcohol.key() + "|" + acid.key()) {
            case "org:pentan-1-ol|C3H7COOH" -> "apricots";
            case "org:ethanol|HSal" -> "minty wintergreen";
            case "org:ethanol|C6H5COOH" -> "a sweet, fruity-minty smell";
            case "org:ethanol|HLac" -> "a mild, buttery fruit smell";
            case "org:propan-2-ol|CH3COOH" -> "fruity, like pear drops";
            case "org:3-methylbutan-1-ol|C3H7COOH" -> "apricots and pears";
            default -> alcohol.ohCount() > 1 ? "almost no smell" : "a sweet, fruity smell";
        };
        String formula = acid.acylFormula() + (alcohol.alkylFormula() == null ? "R" : alcohol.alkylFormula());
        if (alcohol.ohCount() > 1) formula = alcohol.alkylFormula() + "(" + acid.acylFormula() + ")" + alcohol.ohCount();
        return new Ester(name, formula, smell, "org:ester:" + alcohol.key().substring(4) + ":" + acid.key());
    }
}
