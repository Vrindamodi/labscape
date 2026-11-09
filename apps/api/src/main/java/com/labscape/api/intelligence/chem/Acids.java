package com.labscape.api.intelligence.chem;

import java.util.List;

/**
 * Weak acids the engine tracks as undissociated species. Amounts are always moles of acidic
 * protons, so a triprotic acid like citric acid holds three "units" per molecule; its fully
 * deprotonated anion appears once every {@code perAnion} protons removed.
 */
final class Acids {

    private Acids() {}

    /**
     * @param reactive  strong enough to attack metals and carbonates (carbonic and boric acid are not)
     * @param solubilityM  saturation molarity in cold water; above it the acid crystallises out
     */
    record Weak(String key, double pKa, String conj, int perAnion, boolean reactive, String name, String formula,
            String acylate, String acylFormula, double solubilityM, String crystalHex) {}

    /** Ordered from strongest to weakest: protons are taken in this order. */
    static final List<Weak> WEAK = List.of(
            new Weak("H2C2O4", 1.25, "C2O4^2-", 2, true, "oxalic acid", "H2C2O4", "oxalate", "C2O4", 99, null),
            new Weak("H3PO4", 2.15, "PO4^3-", 3, true, "phosphoric acid", "H3PO4", null, null, 99, null),
            new Weak("HSal", 2.97, "Sal-", 1, true, "salicylic acid", "HOC6H4COOH", "2-hydroxybenzoate (salicylate)",
                    "HOC6H4COO", 0.016, "#fbfbf8"),
            new Weak("H3Cit", 3.13, "Cit^3-", 3, true, "citric acid", "C6H8O7", "citrate", "C6H5O7", 99, null),
            new Weak("HAsp", 3.5, "Asp-", 1, true, "aspirin", "CH3COOC6H4COOH", null, null, 0.018, "#fbfbf8"),
            new Weak("HCOOH", 3.75, "HCOO-", 1, true, "methanoic acid", "HCOOH", "methanoate", "HCOO", 99, null),
            new Weak("HLac", 3.86, "Lac-", 1, true, "lactic acid", "CH3CH(OH)COOH", "lactate", "CH3CH(OH)COO", 99, null),
            new Weak("HAsc", 4.10, "Asc-", 1, true, "ascorbic acid", "C6H8O6", null, null, 99, null),
            new Weak("C6H5COOH", 4.20, "C6H5COO-", 1, true, "benzoic acid", "C6H5COOH", "benzoate", "C6H5COO", 0.028, "#fbfbf8"),
            new Weak("HTart-", 4.34, "Tart^2-", 1, true, "hydrogentartrate", "KHC4H4O6", null, null, 99, null),
            new Weak("CH3COOH", 4.76, "CH3COO-", 1, true, "ethanoic acid", "CH3COOH", "ethanoate", "CH3COO", 99, null),
            new Weak("C3H7COOH", 4.82, "C3H7COO-", 1, true, "butanoic acid", "C3H7COOH", "butanoate", "C3H7COO", 99, null),
            new Weak("C2H5COOH", 4.87, "C2H5COO-", 1, true, "propanoic acid", "C2H5COOH", "propanoate", "C2H5COO", 99, null),
            new Weak("HSt", 4.9, "St-", 1, true, "stearic acid", "C17H35COOH", "stearate", "C17H35COO", 1e-5, "#f6f6f2"),
            new Weak("H2CO3", 6.35, "HCO3-", 1, false, "carbonic acid", "H2CO3", null, null, 99, null),
            new Weak("H3BO3", 9.24, "B(OH)4-", 1, false, "boric acid", "H3BO3", null, null, 99, null));

    static Weak byKey(String key) {
        for (Weak w : WEAK) if (w.key().equals(key)) return w;
        return null;
    }

    static Weak byConj(String conj) {
        for (Weak w : WEAK) if (w.conj().equals(conj)) return w;
        return null;
    }

    /** Hydrolysing metal ions and other weak cation acids: species and pKa. */
    static final List<Object[]> CATION_ACIDS = List.of(
            new Object[] {"Fe^3+", 2.2}, new Object[] {"Cr^3+", 4.0}, new Object[] {"Al^3+", 4.9},
            new Object[] {"Cu^2+", 7.5}, new Object[] {"Pb^2+", 7.7}, new Object[] {"Zn^2+", 9.0},
            new Object[] {"NH4+", 9.25}, new Object[] {"Fe^2+", 9.5}, new Object[] {"Co^2+", 9.6},
            new Object[] {"Ni^2+", 9.9}, new Object[] {"Mn^2+", 10.6});

    /** Weak bases that are not conjugates of the tracked acids: species and pKa of their conjugate acid. */
    static final List<Object[]> OTHER_BASES = List.of(
            new Object[] {"OCl-", 7.5}, new Object[] {"SO3^2-", 7.2}, new Object[] {"F-", 3.17},
            new Object[] {"SiO3^2-", 11.8}, new Object[] {"S2O3^2-", 1.7});
}
