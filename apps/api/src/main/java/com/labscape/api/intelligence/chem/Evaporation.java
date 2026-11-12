package com.labscape.api.intelligence.chem;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Boiling a solution dry in an evaporating basin: which dissolved ions come out together as which salt,
 * what leaves with the steam, and which mixtures must never go over a flame at all.
 *
 * <p>The pairing is a pure function of the ion amounts, so the same crystals can be named again later
 * from what was left behind, without storing anything but the ions themselves.
 */
final class Evaporation {

    private Evaporation() {}

    static final String WHITE = "#f4f6f8";

    /** A sugar solution boiled dry: a golden syrup, not crystals. */
    static final String SYRUP_HEX = "#c9954a";

    /**
     * @param piece how the ion is written inside a formula ("NH4", "SO4")
     * @param poly more than one atom, so it takes brackets when there are several ("(NH4)2SO4")
     * @param hex the colour it gives its salts, or null for white
     * @param organic the anion of an organic acid, written before the metal ("CH3COONa")
     */
    record Ion(String key, String piece, int charge, String name, boolean poly, String hex, boolean organic) {}

    /** One salt in the residue: {@code mol} formula units, each {@code cations} of one ion and {@code anions} of the other. */
    record Salt(String formula, String name, String hex, double mol, Ion cation, int cations, Ion anion, int anions) {}

    static final Map<String, Ion> CATIONS = new LinkedHashMap<>();
    static final Map<String, Ion> ANIONS = new LinkedHashMap<>();

    private static void cat(String key, String piece, int charge, String name, String hex) {
        CATIONS.put(key, new Ion(key, piece, charge, name, piece.length() > 2, hex, false));
    }

    private static void an(String key, String piece, int charge, String name, boolean poly, String hex, boolean organic) {
        ANIONS.put(key, new Ion(key, piece, charge, name, poly, hex, organic));
    }

    static {
        cat("Na+", "Na", 1, "sodium", null);
        cat("K+", "K", 1, "potassium", null);
        cat("Li+", "Li", 1, "lithium", null);
        cat("NH4+", "NH4", 1, "ammonium", null);
        cat("Ag+", "Ag", 1, "silver", null);
        cat("Ca^2+", "Ca", 2, "calcium", null);
        cat("Mg^2+", "Mg", 2, "magnesium", null);
        cat("Ba^2+", "Ba", 2, "barium", null);
        cat("Sr^2+", "Sr", 2, "strontium", null);
        cat("Zn^2+", "Zn", 2, "zinc", null);
        cat("Pb^2+", "Pb", 2, "lead(II)", null);
        cat("Al^3+", "Al", 3, "aluminium", null);
        cat("Cu^2+", "Cu", 2, "copper(II)", "#2f86dc");
        cat("Fe^2+", "Fe", 2, "iron(II)", "#a6d6a0");
        cat("Fe^3+", "Fe", 3, "iron(III)", "#c98a2e");
        cat("Mn^2+", "Mn", 2, "manganese(II)", "#f1cdd6");
        cat("Co^2+", "Co", 2, "cobalt(II)", "#c0466e");
        cat("Ni^2+", "Ni", 2, "nickel(II)", "#4fae6a");
        cat("Cr^3+", "Cr", 3, "chromium(III)", "#3f7d5a");

        an("Cl-", "Cl", 1, "chloride", false, null, false);
        an("SO4^2-", "SO4", 2, "sulfate", true, null, false);
        an("NO3-", "NO3", 1, "nitrate", true, null, false);
        an("Br-", "Br", 1, "bromide", false, null, false);
        an("I-", "I", 1, "iodide", false, null, false);
        an("F-", "F", 1, "fluoride", false, null, false);
        an("CO3^2-", "CO3", 2, "carbonate", true, null, false);
        an("HCO3-", "HCO3", 1, "hydrogencarbonate", true, null, false);
        an("OH-", "OH", 1, "hydroxide", true, null, false);
        an("PO4^3-", "PO4", 3, "phosphate", true, null, false);
        an("SO3^2-", "SO3", 2, "sulfite", true, null, false);
        an("S2O3^2-", "S2O3", 2, "thiosulfate", true, null, false);
        an("SCN-", "SCN", 1, "thiocyanate", true, null, false);
        an("IO3-", "IO3", 1, "iodate", true, null, false);
        an("SiO3^2-", "SiO3", 2, "silicate", true, null, false);
        an("C2O4^2-", "C2O4", 2, "ethanedioate", true, null, false);
        an("MnO4-", "MnO4", 1, "manganate(VII)", true, "#3a1040", false);
        an("CrO4^2-", "CrO4", 2, "chromate", true, "#e8c21a", false);
        an("Cr2O7^2-", "Cr2O7", 2, "dichromate", true, "#e8762a", false);
        an("CH3COO-", "CH3COO", 1, "ethanoate", true, null, true);
        an("HCOO-", "HCOO", 1, "methanoate", true, null, true);
        an("C6H5COO-", "C6H5COO", 1, "benzoate", true, null, true);
        an("St-", "C17H35COO", 1, "stearate", true, null, true);
    }

    /** Pairs whose salt has a colour of its own, different from what the metal ion usually gives. */
    private static final Map<String, String> PAIR_HEX = Map.of("Cu^2+|Cl-", "#3fa38a");

    /** Tiny leftovers are not worth a crystal of their own. */
    static final double TRACE = 2e-6;

    /**
     * The salts a set of dissolved ions comes out as when the water goes. Pairs named in {@code first}
     * (cation key + "|" + anion key) are matched before anything else; after that the most plentiful
     * cation takes the most plentiful anion, again and again, until one side runs out.
     * Hydrogencarbonates of 2+ and 3+ metals do not exist as solids, so those pairs are never made.
     */
    static List<Salt> pair(Map<String, Double> ions, List<String> first) {
        Map<Ion, Double> pos = new LinkedHashMap<>();
        Map<Ion, Double> neg = new LinkedHashMap<>();
        ions.forEach((k, v) -> {
            if (v == null || v <= 0) return;
            Ion c = CATIONS.get(k);
            Ion a = ANIONS.get(k);
            if (c != null) pos.put(c, v * c.charge());
            if (a != null) neg.put(a, v * a.charge());
        });
        Map<String, Salt> out = new LinkedHashMap<>();
        for (String want : first) {
            int bar = want.indexOf('|');
            Ion c = CATIONS.get(want.substring(0, bar));
            Ion a = ANIONS.get(want.substring(bar + 1));
            if (c != null && a != null && pos.containsKey(c) && neg.containsKey(a)) take(c, a, pos, neg, out);
        }
        for (int guard = 0; guard < 64; guard++) {
            Ion c = most(pos, null);
            if (c == null) break;
            Ion a = most(neg, c);
            if (a == null) {
                pos.remove(c); // nothing it can pair with
                continue;
            }
            take(c, a, pos, neg, out);
        }
        return new ArrayList<>(out.values());
    }

    private static boolean possible(Ion c, Ion a) {
        return !("HCO3-".equals(a.key()) && c.charge() > 1);
    }

    private static Ion most(Map<Ion, Double> side, Ion partner) {
        Ion best = null;
        for (Map.Entry<Ion, Double> e : side.entrySet()) {
            if (e.getValue() <= TRACE) continue;
            if (partner != null && !possible(partner, e.getKey())) continue;
            if (best == null || e.getValue() > side.get(best) + 1e-12) best = e.getKey();
        }
        return best;
    }

    private static void take(Ion c, Ion a, Map<Ion, Double> pos, Map<Ion, Double> neg, Map<String, Salt> out) {
        if (!possible(c, a)) return;
        double eq = Math.min(pos.get(c), neg.get(a));
        if (eq <= TRACE) return;
        pos.merge(c, -eq, Double::sum);
        neg.merge(a, -eq, Double::sum);
        int g = Latex.gcd(c.charge(), a.charge());
        int nc = a.charge() / g;
        int na = c.charge() / g;
        double units = eq / (c.charge() * nc);
        String hex = PAIR_HEX.getOrDefault(c.key() + "|" + a.key(), a.hex() != null ? a.hex() : c.hex() != null ? c.hex() : WHITE);
        String key = c.key() + "|" + a.key();
        Salt had = out.get(key);
        out.put(key, new Salt(formula(c, nc, a, na), c.name() + " " + a.name(), hex, units + (had == null ? 0 : had.mol()), c, nc, a, na));
    }

    static String formula(Ion c, int nc, Ion a, int na) {
        String cp = nc > 1 ? (c.poly() ? "(" + c.piece() + ")" + nc : c.piece() + nc) : c.piece();
        String ap = na > 1 ? (a.poly() ? "(" + a.piece() + ")" + na : a.piece() + na) : a.piece();
        return a.organic() ? ap + cp : cp + ap;
    }

    // ------------------------------------------------------------------------------ what leaves with the steam

    /** Dissolved gases and volatile liquids: they boil off with the water and are not in the residue. */
    static final Set<String> VOLATILE = Set.of("NH3", "H2CO3", "CO2", "SO2", "H2S", "HCl", "CH3COOH", "HCOOH", "C2H5COOH",
            "C3H7COOH", "H2O2", "HOCl", "Cl2", "Br2", "I2");

    /** A trace of a volatile acid leaves as the acid itself, taking its anion with it. */
    static final List<String> VOLATILE_ACID_ANIONS = List.of("Cl-", "NO3-", "Br-", "I-");

    static boolean volatileKey(String key) {
        return VOLATILE.contains(key) || key.endsWith("(g)");
    }

    // ------------------------------------------------------------------------------ what must not be boiled dry

    /** Organic residues that are safe over a flame in water: they are neither flammable liquids nor volatile. */
    private static final Set<String> RESIDUE_ORGANICS = Set.of("org:glucose", "org:fructose", "org:sucrose", "org:lactose",
            "org:maltose", "org:casein", "org:milkfat", "org:detergent", "org:pva", "org:yeast", "org:glycine", "org:albumin",
            "org:gelatin", "org:amylase", "org:catalase", "org:glycerol", "org:vanillin", "org:wax");

    private static final Map<String, String> FUMES = Map.of("Cl2", "chlorine", "HOCl", "chlorine", "OCl-", "chlorine",
            "Br2", "bromine", "I2", "iodine");

    /** Sugars and the like: boiled dry they leave a syrup that browns, not crystals. */
    static boolean syrup(String key) {
        return Set.of("org:glucose", "org:fructose", "org:sucrose", "org:lactose", "org:maltose").contains(key);
    }

    /**
     * Why this mixture must not be boiled dry over a flame, as {code, message}, or null when it is safe to.
     * Decided from what is in the vessel once everything in it has finished reacting.
     */
    static String[] refusal(MixtureOps m, double ph) {
        if (m.has("Ag(NH3)2+")) {
            return new String[] {"EVAPORATE_UNSAFE_RESIDUE", "Tollens' reagent is never boiled dry or left to dry out: what it leaves "
                    + "behind can explode. It is washed away with plenty of water instead, so it stays off the burner."};
        }
        if (m.organicMl() > 0.05) {
            return new String[] {"EVAPORATE_FLAMMABLE", "This mixture has an organic liquid in it. A flammable liquid is never heated "
                    + "over a naked flame, because its vapour can catch fire, so it stays off the burner."};
        }
        for (String k : m.keys()) {
            if (k.startsWith("org:") && !k.endsWith("(s)") && !RESIDUE_ORGANICS.contains(k) && m.get(k) > 1e-6) {
                return new String[] {"EVAPORATE_FLAMMABLE", "This mixture has an organic liquid dissolved in it. Its vapour could catch "
                        + "fire over a naked flame, so it stays off the burner."};
            }
        }
        if (m.aqMl() <= 1e-9) {
            return new String[] {"EVAPORATE_NO_WATER", "There is no water here to boil away. Evaporating separates a dissolved solid "
                    + "from the water it is dissolved in."};
        }
        for (Map.Entry<String, String> f : FUMES.entrySet()) {
            if (m.get(f.getKey()) > 1e-6) {
                return new String[] {"EVAPORATE_TOXIC_FUMES", "Boiling this would drive " + f.getValue() + " out into the room as a "
                        + "toxic vapour. That is only ever done in a fume cupboard, so it stays off the burner."};
            }
        }
        if (m.molar("NH3") > 0.1) {
            return new String[] {"EVAPORATE_TOXIC_FUMES", "Boiling this would drive the ammonia out into the room all at once, and "
                    + "ammonia gas burns the eyes and throat. That is done in a fume cupboard, so it stays off the burner."};
        }
        if (m.get("H2SO4(conc)") > 1e-9 || m.molar("H+") > 0.01) {
            String at = Double.isNaN(ph) ? "" : String.format(Locale.ROOT, " (pH %.1f)", ph);
            return new String[] {"EVAPORATE_ACID", "This is still strongly acidic" + at + ". Boiling it down would concentrate the acid "
                    + "and drive off choking fumes. Use the acid up first: neutralise it exactly, or add more of the solid than can react "
                    + "and filter off what is left over."};
        }
        if (m.get("NH4+") > 1e-5 && m.get("NO3-") > 1e-5) {
            return new String[] {"EVAPORATE_UNSAFE_RESIDUE", "This would leave ammonium nitrate behind, and ammonium nitrate must never "
                    + "be heated dry over a flame: it can decompose violently. It stays off the burner."};
        }
        // An oxidiser must never be left as a dry solid mixed with something it can burn.
        // (Any amount counts: a protein or a starch is a great deal of fuel in very few moles.)
        boolean oxidiser = OXIDISERS.stream().anyMatch(k -> m.get(k) > 1e-8);
        if (oxidiser) {
            for (String k : m.keys()) {
                if (m.get(k) > 1e-8 && burns(k)) {
                    return new String[] {"EVAPORATE_UNSAFE_RESIDUE", "This would leave an oxidiser dried onto something it can burn. "
                            + "A dry mixture like that can catch fire violently when it is heated, so it stays off the burner."};
                }
            }
        }
        return null;
    }

    /** Anions that feed a fire once they are in a dry solid. */
    static final Set<String> OXIDISERS = Set.of("NO3-", "MnO4-", "Cr2O7^2-", "CrO4^2-", "IO3-");

    private static final Set<String> FUELS = Set.of("starch", "NH4+", "SCN-", "CH3COO-", "HCOO-", "C6H5COO-", "St-", "Cit^3-", "Tart^2-",
            "HTart-", "C2O4^2-", "Lac-", "Asc-", "Sal-", "Asp-", "H3Cit", "HLac", "HAsc", "H2C2O4", "HSal", "HAsp", "C6H5COOH", "HSt",
            "S2O3^2-", "SO3^2-");

    /** A dissolved species that would be fuel for an oxidiser in a dry residue: anything organic, ammonium, thiocyanate, sulfur anions. */
    private static boolean burns(String key) {
        return key.startsWith("org:") || FUELS.contains(key);
    }
}
