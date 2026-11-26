package com.labscape.api.intelligence.chem;

import com.labscape.api.intelligence.chem.ChemistryEngine.Portion;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Physical behaviour of a mixture: solids dissolving (with their heat of solution and solubility
 * limit), liquids mixing or separating into layers by density, halogens moving into an organic
 * layer, weak acids crystallising out, and plain-language descriptions of what you would see when
 * nothing chemical happens.
 */
final class Phases {

    private Phases() {}

    private static final double EPS = ChemistryEngine.EPS;

    /**
     * A solid that dissolves into ions (or molecules). solubility = g per 100 mL water at 20 °C and at 90 °C;
     * dH = enthalpy of solution in kJ/mol (positive = the water gets colder).
     */
    record Soluble(Map<String, Double> ions, double mm, double sol20, double sol90, double dH, String name, boolean acid) {}

    static final Map<String, Soluble> SOLUBLE = new LinkedHashMap<>();

    private static void sol(String key, String name, double mm, double s20, double s90, double dH, Object... ions) {
        Map<String, Double> m = new LinkedHashMap<>();
        for (int i = 0; i < ions.length; i += 2) m.put((String) ions[i], ((Number) ions[i + 1]).doubleValue());
        boolean acid = m.keySet().stream().anyMatch(k -> Acids.byKey(k) != null);
        SOLUBLE.put(key, new Soluble(m, mm, s20, s90, dH, name, acid));
    }

    static {
        sol("NaOH(s)", "sodium hydroxide", 40.0, 111, 300, -44.5, "Na+", 1, "OH-", 1);
        sol("CaCl2(s)", "calcium chloride", 111.0, 74, 150, -81.3, "Ca^2+", 1, "Cl-", 2);
        sol("NH4Cl(s)", "ammonium chloride", 53.5, 37, 72, 14.8, "NH4+", 1, "Cl-", 1);
        sol("Na2S2O3·5H2O(s)", "sodium thiosulfate", 248.2, 70, 230, 47.4, "Na+", 2, "S2O3^2-", 1);
        sol("CoCl2·6H2O(s)", "cobalt(II) chloride", 237.9, 53, 100, 8, "Co^2+", 1, "Cl-", 2);
        sol("FeSO4·7H2O(s)", "iron(II) sulfate", 278.0, 26, 50, 12, "Fe^2+", 1, "SO4^2-", 1);
        sol("KAl(SO4)2·12H2O(s)", "potassium alum", 474.4, 12, 80, 42, "K+", 1, "Al^3+", 1, "SO4^2-", 2);
        sol("KCr(SO4)2·12H2O(s)", "chrome alum", 499.4, 24, 50, 40, "K+", 1, "Cr^3+", 1, "SO4^2-", 2);
        sol("ZnSO4·7H2O(s)", "zinc sulfate", 287.6, 54, 80, 18, "Zn^2+", 1, "SO4^2-", 1);
        sol("NiSO4·6H2O(s)", "nickel(II) sulfate", 262.9, 40, 70, 5, "Ni^2+", 1, "SO4^2-", 1);
        sol("CuCl2·2H2O(s)", "copper(II) chloride", 170.5, 73, 110, -5, "Cu^2+", 1, "Cl-", 2);
        sol("FeCl3·6H2O(s)", "iron(III) chloride", 270.3, 92, 500, -10, "Fe^3+", 1, "Cl-", 3);
        sol("KI(s)", "potassium iodide", 166.0, 144, 200, 20.3, "K+", 1, "I-", 1);
        sol("KBr(s)", "potassium bromide", 119.0, 65, 100, 19.9, "K+", 1, "Br-", 1);
        sol("KCl(s)", "potassium chloride", 74.6, 34, 54, 17.2, "K+", 1, "Cl-", 1);
        sol("H3Cit(s)", "citric acid", 192.1, 147, 300, 22, "H3Cit", 3);
        sol("KHTart(s)", "cream of tartar", 188.2, 0.57, 6, 25, "K+", 1, "HTart-", 1);
        sol("C6H5COOH(s)", "benzoic acid", 122.1, 0.34, 4.5, 27, "C6H5COOH", 1);
        sol("HSal(s)", "salicylic acid", 138.1, 0.2, 4.0, 27, "HSal", 1);
        sol("Asp(s)", "aspirin", 180.2, 0.3, 1.0, 30, "HAsp", 1);
        sol("Ca(OH)2(s)", "calcium hydroxide", 74.1, 0.17, 0.08, -16, "Ca^2+", 1, "OH-", 2);
        sol("org:glucose", "glucose", 180.2, 91, 300, 11, "org:glucose", 1);
        sol("org:sucrose", "sugar", 342.3, 200, 400, 5.4, "org:sucrose", 1);
        sol("org:vanillin(s)", "vanillin", 152.2, 1.0, 5, 20, "org:vanillin", 1);
        sol("starch(s)", "starch", 162.1, 100, 100, 0, "starch", 1);
    }

    // ------------------------------------------------------------------------------ dissolving

    static void dissolve(MixtureOps m) {
        double waterMl = m.aqMl() - m.portions().stream().filter(p -> p.substance().hasTag("conc_acid")).mapToDouble(Phases::ml).sum();
        if (waterMl < 0.5) return;
        double t = Math.max(0, Math.min(1, (m.tempC() - 20) / 70));
        for (Map.Entry<String, Soluble> en : SOLUBLE.entrySet()) {
            String key = en.getKey();
            Soluble s = en.getValue();
            if (!m.has(key) || m.solidTarget(key) == null) continue;
            double n = m.get(key);
            double solubility = s.sol20() + (s.sol90() - s.sol20()) * t;
            double capacity = solubility * waterMl / 100.0 / s.mm();
            if (s.acid()) {
                // Bases pull a weak solid acid into solution as its salt - but only the base that any strong
                // acid in the same beaker will not use up first (otherwise it "dissolves" and then crystallises
                // straight back out of a mixture that was never alkaline).
                double base = m.get("OH-") + m.get("CO3^2-") + m.get("HCO3-") + m.get("NH3") + m.get("PO4^3-");
                capacity += Math.max(0, base - m.get("H+"));
            }
            double d = Math.min(n, capacity);
            if (d <= EPS) continue;
            boolean same = s.ions().size() == 1 && s.ions().containsKey(key.replace("(s)", ""))
                    && key.startsWith("org:") && !key.endsWith("(s)");
            if (!same) {
                m.take(key, d);
                s.ions().forEach((ion, k) -> m.add(ion, k * d));
            }
            m.heat(-s.dH() * 1000 * d);
            m.dissolveSolid(key, 0, 2600);
            String temp = s.dH() >= 10 ? " The water gets noticeably colder - dissolving it takes in heat."
                    : s.dH() <= -30 ? " The beaker gets hot - dissolving it gives out a lot of heat."
                    : s.dH() <= -10 ? " The water warms up a little." : "";
            if ("starch(s)".equals(key)) {
                m.observe("The starch powder spreads through the water as a cloudy white suspension.");
            } else if (d < n - EPS) {
                m.observe("Only some of the " + s.name() + " dissolves - the solution is saturated and the rest settles at the bottom"
                        + (s.sol90() > s.sol20() * 2 && m.tempC() < 60 ? " (it is far more soluble in hot water)." : ".") + temp);
            } else {
                m.observe("The " + s.name() + " dissolves" + (s.ions().size() > 1 ? " into its ions" : "") + "." + temp);
            }
        }
    }

    /** Solubility (mol/L at this temperature) of the solid that dissolves to give species {@code key}, or 0 if none does. */
    private static double dissolvedLimitM(String key, double tempC) {
        double t = Math.max(0, Math.min(1, (tempC - 20) / 70));
        double best = 0;
        for (Soluble s : SOLUBLE.values()) {
            Double perUnit = s.ions().get(key);
            if (perUnit == null) continue;
            double gPer100 = s.sol20() + (s.sol90() - s.sol20()) * t;
            best = Math.max(best, gPer100 * 10 / s.mm() * perUnit);
        }
        return best;
    }

    /** Weak acids only sparingly soluble in water crystallise out when there is more than water can hold. */
    static void acidCrystals(MixtureOps m) {
        if (m.aqMl() <= 0) return;
        double litres = m.aqMl() / 1000.0;
        for (Acids.Weak w : Acids.WEAK) {
            if (w.crystalHex() == null) continue;
            // The same limit dissolve() used at this temperature: what dissolved from the solid can never be "too much".
            double limit = Math.max(w.solubilityM(), dissolvedLimitM(w.key(), m.tempC()));
            if (m.molar(w.key()) <= limit * 1.05) continue;
            double excess = m.get(w.key()) - limit * litres;
            if (excess <= EPS) continue;
            // Only acid made by protonating its salt here counts: undissolved solid never left the solid state.
            m.take(w.key(), excess);
            long start = m.nextStart();
            String name = Character.toUpperCase(w.name().charAt(0)) + w.name().substring(1);
            Lore.register(w.formula(), name, w.crystalHex());
            m.precipitate(w.formula(), excess, w.crystalHex(), start, 6000);
            m.reaction("acid-crystallises-" + w.key().toLowerCase(Locale.ROOT), name + " crystallises out", "precipitation",
                    Latex.equation(List.of(Latex.ionTerm(1, w.conj()), Latex.Term.ion(1, "H", "+")),
                            List.of(Latex.Term.of(1, w.formula(), "s")), null),
                    "HSt".equals(w.key()) ? "soap-scum" : "weak-acid-crystals", excess);
            m.observe("HSt".equals(w.key())
                    ? "The soap turns cloudy and a greasy white solid separates: acid turns soap back into insoluble stearic acid."
                    : "White crystals of " + w.name() + " appear: the acid is only sparingly soluble in cold water.");
        }
    }

    // ------------------------------------------------------------------------------ describing the mixture

    private record Liquid(Substance s, double ml) {}

    static void describe(MixtureOps m) {
        layers(m);
        solids(m);
        gases(m);
    }

    private static double ml(Portion p) {
        return "drops".equals(p.substance().limits().unit()) ? p.amount() * 0.05 : p.amount();
    }

    private static void layers(MixtureOps m) {
        List<Liquid> aqueous = new ArrayList<>();
        List<Liquid> both = new ArrayList<>();
        List<Liquid> polar = new ArrayList<>();
        List<Liquid> partial = new ArrayList<>();
        List<Liquid> oily = new ArrayList<>();
        Substance bromine = null;
        Substance mercury = null;
        for (Portion p : m.portions()) {
            Substance s = p.substance();
            if (s.isElement()) {
                if ("liquid".equals(s.form()) && "Br".equals(s.element().symbol())) bromine = s;
                if ("liquid".equals(s.form()) && "Hg".equals(s.element().symbol())) mercury = s;
                continue;
            }
            if (s.isSolid() || s.isGas()) continue;
            Liquid l = new Liquid(s, ml(p));
            switch (s.waterMiscibility()) {
                case "aqueous" -> aqueous.add(l);
                case "miscible" -> both.add(l);
                case "polar" -> polar.add(l);
                case "partial" -> partial.add(l);
                default -> oily.add(l);
            }
        }
        double waterMl = aqueous.stream().mapToDouble(Liquid::ml).sum();
        double polarMl = waterMl + polar.stream().mapToDouble(Liquid::ml).sum();
        boolean water = waterMl > 0;

        List<Liquid> top = new ArrayList<>(oily);
        List<String> notes = new ArrayList<>();
        if (water) {
            for (Liquid l : both) {
                notes.add(l.s().name() + " mixes completely with water - no layers, and no chemical reaction from mixing alone.");
            }
            for (Liquid l : polar) {
                notes.add(l.s().name() + " mixes completely with water.");
            }
            for (Liquid l : partial) {
                double sol = l.s().solubility() == null ? 2 : l.s().solubility();
                double canDissolve = sol * waterMl / 100.0 / l.s().densityOr(0.85);
                if (canDissolve >= l.ml() - 0.05) {
                    notes.add("A little " + Lore.lower(l.s().name()) + " dissolves completely in this much water "
                            + "(it is only slightly soluble - about " + fmt(sol) + " g per 100 mL).");
                } else {
                    top.add(new Liquid(l.s(), l.ml() - canDissolve));
                    notes.add(l.s().name() + " is only slightly soluble in water (about " + fmt(sol)
                            + " g per 100 mL), so most of it forms a separate layer.");
                }
            }
            polarMl += both.stream().mapToDouble(Liquid::ml).sum();
        } else {
            // No water: alcohols and ketones mix with oils; glycerol, methanol and diols do not.
            top.addAll(both);
            top.addAll(partial);
        }

        List<Liquid> lower = new ArrayList<>(aqueous);
        if (!water && polar.isEmpty()) lower.clear();
        lower.addAll(polar);
        if (water) lower.addAll(both);
        boolean twoPhases = !top.isEmpty() && !lower.isEmpty() && (water || !polar.isEmpty());
        // Detergent or soap wraps the oil in tiny droplets, so the layers never form: an emulsion.
        boolean emulsifier = water && (m.presentTag("detergent") || m.get("St-") > EPS);
        if (twoPhases && emulsifier) {
            double oilMl = top.stream().mapToDouble(Liquid::ml).sum();
            String oil = top.size() == 1 ? Lore.lower(top.get(0).s().name()) : "oily liquids";
            long start = m.nextStart();
            Map<String, Object> c = m.cue("colour", "vessel", start);
            c.put("from", Colour.hex("#eef6fb", 0.2).toJson());
            c.put("to", Colour.hex("#f1eedd", 0.9).toJson());
            c.put("durationMs", 1600);
            c.put("curve", "sigmoid");
            m.reaction("emulsifier", "Detergent emulsifies the oil", "physical",
                    "\\text{oil} + \\text{water} \\xrightarrow{\\text{detergent}} \\text{emulsion (tiny oil droplets in water)}",
                    "emulsifier", oilMl / 1000.0);
            m.observe("Instead of floating as a layer, the " + oil + " breaks into tiny droplets and the whole liquid turns milky: "
                    + "each detergent particle has an oil-loving tail and a water-loving head, so it holds oil and water together.");
            m.reason("This is an emulsion - a physical mixture, not a new substance. It is how washing-up liquid lifts grease off plates.");
        } else if (twoPhases) {
            double topMl = top.stream().mapToDouble(Liquid::ml).sum();
            double topDensity = top.stream().mapToDouble(l -> l.ml() * l.s().densityOr(0.85)).sum() / Math.max(topMl, 1e-9);
            double lowMl = lower.stream().mapToDouble(Liquid::ml).sum();
            double lowDensity = lower.stream().mapToDouble(l -> l.ml() * l.s().densityOr(l.s().aqueous() ? 1.0 : 1.0)).sum()
                    / Math.max(lowMl, 1e-9);
            boolean floats = topDensity < lowDensity;
            String organicName = top.size() == 1 ? top.get(0).s().name() : "The oily liquids";
            String waterName = water ? "the water" : Lore.lower(lower.get(0).s().name());
            String colourHex = top.size() == 1 ? top.get(0).s().colour() : "#f2e8b0";
            double alpha = top.size() == 1 ? Math.max(0.12, top.get(0).s().opacity()) : 0.4;
            // Halogens move out of water into the non-polar layer, colouring it.
            String extracted = null;
            if (water) {
                double i2 = m.get("I2"), br2 = m.get("Br2");
                if (i2 > EPS) {
                    m.take("I2", i2 * 0.85);
                    m.add("I2(org)", i2 * 0.85);
                    colourHex = "#a03aa8";
                    alpha = 0.7;
                    extracted = "iodine";
                } else if (br2 > EPS) {
                    m.take("Br2", br2 * 0.8);
                    m.add("Br2(org)", br2 * 0.8);
                    colourHex = "#d0561a";
                    alpha = 0.7;
                    extracted = "bromine";
                }
            }
            Map<String, Object> c = m.cue("layers", "vessel", 0);
            c.put("colour", Colour.hex(colourHex, Math.min(0.85, alpha)).toJson());
            c.put("volumeMl", ChemistryEngine.round(topMl, 1));
            c.put("position", floats ? "top" : "bottom");
            c.put("label", organicName + (floats ? " floats on top" : " sinks to the bottom") + " as a separate layer");
            m.reason(organicName + (top.size() == 1 ? " doesn't" : " don't") + " mix with " + waterName
                    + String.format(Locale.ROOT, ": the liquids form two layers, and the %s one (%.2f g/cm³) %s %s (%.2f g/cm³).",
                            floats ? "less dense" : "denser", topDensity, floats ? "floats on" : "sinks below", waterName,
                            lowDensity));
            if (extracted != null) {
                m.observe("The " + extracted + " moves out of the water into the "
                        + (floats ? "top" : "bottom") + " layer, which turns " + ("iodine".equals(extracted) ? "violet-pink" : "orange-red")
                        + " - halogens are far more soluble in non-polar solvents.");
            }
        } else if (!water && !top.isEmpty() && top.size() + polar.size() > 1) {
            m.reason("These organic liquids all dissolve in each other, making one clear liquid - no reaction.");
        } else if (!water && polar.size() > 1) {
            m.reason("These liquids mix completely - no reaction.");
        }
        if (water) notes.forEach(m::reason);
        if (bromine != null && water) {
            m.reason("Liquid bromine is very dense (3.1 g/cm³): what doesn't dissolve sinks to the bottom as a dark red-brown layer.");
        }
        if (mercury != null && (water || !top.isEmpty())) {
            m.reason("Mercury is a liquid metal (13.5 g/cm³) - it sinks straight to the bottom as silvery beads and doesn't dissolve.");
        }
    }

    private static void solids(MixtureOps m) {
        boolean water = m.aqMl() > 0;
        boolean liquid = water || m.organicMl() > 0;
        for (Portion p : m.portions()) {
            Substance s = p.substance();
            if (!s.isSolid()) continue;
            for (String key : s.species().keySet()) {
                double initial = m.solidInitial(key);
                if (initial <= EPS || m.get(key) < initial * 0.9) continue;
                String name = s.name();
                boolean mentioned = m.reasons().stream().anyMatch(r -> r.contains(name) || r.toLowerCase(Locale.ROOT)
                        .contains(name.toLowerCase(Locale.ROOT)));
                if (mentioned) continue;
                if (water) {
                    if (SOLUBLE.containsKey(key)) continue; // saturated: already described
                    if (s.isElement() && "I".equals(s.element().symbol())) continue;
                    if (s.metal() != null) {
                        m.reason(name + " doesn't dissolve - the metal just sits at the bottom, unchanged.");
                    } else if (key.startsWith("org:wax")) {
                        m.reason("Wax is non-polar and less dense than water - it floats and doesn't dissolve.");
                    } else {
                        m.reason(name + " doesn't dissolve in water - it sinks to the bottom and stays there unchanged.");
                    }
                } else if (liquid) {
                    if (s.isElement() && "I".equals(s.element().symbol())) {
                        m.reason("Iodine dissolves in organic solvents, giving a violet (or brown, in alcohols) solution.");
                    } else {
                        m.reason(name + " doesn't dissolve in this liquid - salts and most solids need water.");
                    }
                }
                break;
            }
        }
    }

    private static void gases(MixtureOps m) {
        if (m.aqMl() <= 0 && m.organicMl() <= 0) return;
        for (Portion p : m.portions()) {
            Substance s = p.substance();
            if (!s.isGas() || s.isElement()) continue;
            String key = s.species().keySet().iterator().next();
            if (m.get(key) <= EPS) continue;
            if (key.startsWith("org:") && m.aqMl() > 0) {
                m.reason(s.name() + " is almost insoluble in water - it just bubbles through and escapes.");
            }
        }
    }

    static String fmt(double v) {
        return v == Math.rint(v) ? String.valueOf((long) v) : String.format(Locale.ROOT, "%.1f", v);
    }
}
