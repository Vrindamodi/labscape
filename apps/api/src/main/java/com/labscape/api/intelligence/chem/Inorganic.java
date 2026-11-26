package com.labscape.api.intelligence.chem;

import com.labscape.api.intelligence.chem.ChemistryEngine.Portion;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Inorganic rule families beyond the engine's core: concentrated sulfuric acid, gases dissolving,
 * quicklime and plaster, complex ions (Fehling's, thiocyanate, ammines, amphoteric hydroxides),
 * conjugate bases meeting acid, sulfites and silicates, basic oxides/hydroxides/carbonates with acid,
 * amphoteric metals in alkali, redox between common oxidising and reducing agents, thermal
 * decomposition, metals burning in air and flame tests.
 */
final class Inorganic {

    private Inorganic() {}

    private static final double EPS = ChemistryEngine.EPS;

    private static double clamp(double v, double lo, double hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    private static void colour(MixtureOps m, String target, String fromHex, String toHex, long start, long duration) {
        Map<String, Object> c = m.cue("colour", target, start);
        c.put("from", Colour.hex(fromHex, 1).toJson());
        c.put("to", Colour.hex(toHex, 1).toJson());
        c.put("durationMs", duration);
        c.put("curve", "sigmoid");
    }

    static String ionKey(String symbol, int charge) {
        return charge == 1 ? symbol + "+" : symbol + "^" + charge + "+";
    }

    private static void smell(MixtureOps m, String description, long start) {
        m.cue("odour", "vessel", start).put("description", description);
    }

    // ================================================================================== early

    static void early(MixtureOps m) {
        concentratedAcid(m);
        carbonDioxideGas(m);
        quicklime(m);
        plaster(m);
        cobaltPaper(m);
        copperComplexes(m);
    }

    /** Concentrated sulfuric acid: dilution heat, dehydrating crystals, and halide salts. */
    private static void concentratedAcid(MixtureOps m) {
        double n = m.get("H2SO4(conc)");
        if (n <= EPS) return;
        double concMl = m.portions().stream().filter(p -> p.substance().hasTag("conc_acid"))
                .mapToDouble(p -> "drops".equals(p.substance().limits().unit()) ? p.amount() * 0.05 : p.amount()).sum();
        double waterMl = m.aqMl() - concMl;
        if (m.has("CuSO4·5H2O(s)") && waterMl < 1) {
            double e = Math.min(m.get("CuSO4·5H2O(s)"), n * 5);
            m.take("CuSO4·5H2O(s)", e);
            m.add("CuSO4(anh)", e);
            String target = m.solidTarget("CuSO4·5H2O(s)");
            colour(m, target == null ? "vessel" : target, "#2f86dc", "#eef0ee", m.nextStart(), 2500);
            m.reaction("dehydration-copper-sulfate", "Concentrated acid dehydrates copper sulfate", "dehydration",
                    Latex.eq("CuSO4·5H2O(s) -> CuSO4(s) + 5 H2O(l)", "conc. H2SO4"), "dehydration", e);
            m.observe("The blue crystals turn white: concentrated sulfuric acid pulls the water of crystallisation out of them.");
        }
        if (m.has("NaCl(s)") && waterMl < 1) {
            double e = Math.min(m.get("NaCl(s)"), n);
            m.take("NaCl(s)", e);
            long start = m.nextStart();
            Map<String, Object> s = m.cue("smoke", "vessel", start);
            s.put("colour", Colour.hex("#f4f7fb", 0.6).toJson());
            s.put("density", 0.5);
            s.put("durationMs", 5000);
            s.put("label", "Steamy fumes of hydrogen chloride");
            m.gas("HCl", e, "vessel", 1.2, "fine", start);
            m.reaction("conc-acid-chloride", "Concentrated sulfuric acid and a chloride", "gas",
                    Latex.eq("NaCl(s) + H2SO4(l) -> NaHSO4(s) + HCl(g)"), "conc-acid-halide", e);
            m.observe("Steamy, choking fumes of hydrogen chloride rise from the salt - this is done only in a fume cupboard.");
        }
        if (waterMl >= 0.5) {
            m.take("H2SO4(conc)", n);
            m.add("H+", 2 * n);
            m.add("SO4^2-", n);
            m.heat(95_000 * n);
            m.reaction("dilution-conc-acid", "Concentrated acid dilutes", "physical",
                    Latex.eq("H2SO4(l) -> 2 H^+ + SO4^2-", "water"), null, n);
            m.observe(n * 95_000 / Math.max(1, m.aqMl() * 4.18) > 3
                    ? "The mixture gets hot as the concentrated acid mixes with water - always add acid to water, never water to acid."
                    : "The concentrated acid mixes in and warms the liquid slightly.");
        }
    }

    /** Carbon dioxide bubbled into a solution: limewater test, carbonic acid, absorption by alkali. */
    private static void carbonDioxideGas(MixtureOps m) {
        double co2 = m.get("CO2(g)");
        if (co2 <= EPS) return;
        if (m.aqMl() <= 0) {
            m.reason("Carbon dioxide doesn't react with these substances - it just fills the vessel.");
            return;
        }
        double absorbed = co2 * 0.2;
        m.take("CO2(g)", co2);
        double ca = m.get("Ca^2+");
        double oh = m.get("OH-");
        if (oh > EPS) {
            double toCarbonate = Math.min(absorbed, oh / 2);
            m.take("OH-", 2 * toCarbonate);
            double leftover = absorbed - toCarbonate;
            long start = m.nextStart();
            if (ca > EPS) {
                double ppt = Math.min(ca, toCarbonate);
                m.take("Ca^2+", ppt);
                m.add("CO3^2-", toCarbonate - ppt);
                m.precipitate("CaCO3", ppt, "#f7f7f5", start, 8000);
                m.reaction("limewater-test", "Carbon dioxide turns limewater milky", "precipitation",
                        Latex.eq("Ca(OH)2(aq) + CO2(g) -> CaCO3(s) + H2O(l)"), "limewater-test", ppt);
                m.observe("The limewater turns milky as tiny white particles of calcium carbonate form - the test for carbon dioxide.");
                double clear = Math.min(leftover, ppt);
                if (clear > ppt * 0.5) {
                    m.precipitates().merge("CaCO3", -clear, Double::sum);
                    m.add("Ca^2+", clear);
                    m.add("HCO3-", 2 * clear);
                    Map<String, Object> d = m.cue("dissolve", "precipitate:CaCO3", start + 3000);
                    d.put("durationMs", 4000);
                    d.put("fraction", ChemistryEngine.round(clear / ppt, 3));
                    m.reaction("limewater-clears", "Excess carbon dioxide clears limewater", "precipitation",
                            Latex.eq("CaCO3(s) + CO2(g) + H2O(l) -> Ca^2+ + 2 HCO3^-"), "limewater-test", clear);
                    m.observe("With lots more carbon dioxide the milkiness clears again: soluble calcium hydrogencarbonate forms.");
                }
            } else {
                m.add("CO3^2-", toCarbonate);
                if (leftover > EPS) m.add("H2CO3", leftover);
                m.reaction("co2-alkali", "Carbon dioxide absorbed by alkali", "neutralisation",
                        Latex.eq("CO2(g) + 2 OH^- -> CO3^2- + H2O(l)"), null, toCarbonate);
                m.observe("The alkali absorbs the carbon dioxide - nothing visible, but the solution becomes a carbonate.");
            }
        } else {
            m.add("H2CO3", absorbed);
            m.reaction("carbonic-acid", "Carbon dioxide dissolves", "neutralisation",
                    Latex.eq("CO2(g) + H2O(l) -> H2CO3(aq)"), "carbonic-acid", absorbed);
            m.observe("A little carbon dioxide dissolves, making weak carbonic acid - the pH drops slightly. Most bubbles straight through.");
        }
    }

    private static void quicklime(MixtureOps m) {
        if (!m.has("CaO(s)") || m.aqMl() <= 0) return;
        double n = m.take("CaO(s)", m.get("CaO(s)"));
        m.heat(65_000 * n);
        double dissolved = Math.min(n, 0.02 * m.aqMl() / 1000.0);
        m.add("Ca^2+", dissolved);
        m.add("OH-", 2 * dissolved);
        long start = m.nextStart();
        if (n - dissolved > EPS) m.precipitate("Ca(OH)2", n - dissolved, "#f4f4f2", start + 600, 9000);
        Map<String, Object> s = m.cue("smoke", "vessel", start + 300);
        s.put("colour", Colour.hex("#ffffff", 0.5).toJson());
        s.put("density", 0.35);
        s.put("durationMs", 3500);
        s.put("label", "Steam rising from the hot lime");
        m.dissolveSolid("CaO(s)", start, 3000);
        m.reaction("slaking-lime", "Quicklime reacts with water", "hydration", Latex.eq("CaO(s) + H2O(l) -> Ca(OH)2(s)"),
                "slaking-lime", n);
        m.observe("The lumps crack, crumble and hiss as they get very hot, turning into white slaked lime; the water becomes alkaline.");
    }

    private static void plaster(MixtureOps m) {
        if (!m.has("CaSO4·½H2O(s)") || m.aqMl() <= 0) return;
        double n = m.take("CaSO4·½H2O(s)", m.get("CaSO4·½H2O(s)"));
        m.heat(17_000 * n);
        long start = m.nextStart();
        m.precipitate("CaSO4·2H2O", n, "#f7f7f3", start, 12_000);
        m.reaction("plaster-sets", "Plaster of Paris sets", "hydration", Latex.eq("2 CaSO4·½H2O(s) + 3 H2O(l) -> 2 CaSO4·2H2O(s)"),
                "plaster-sets", n);
        m.observe("The paste warms slightly and starts to set hard as interlocking crystals of gypsum grow.");
    }

    private static void cobaltPaper(MixtureOps m) {
        if (!m.has("CoCl2(anh)")) return;
        if (m.aqMl() <= 0) {
            if (m.organicMl() > 0) m.reason("These liquids contain no water, so the cobalt chloride paper stays blue.");
            return;
        }
        double n = m.take("CoCl2(anh)", m.get("CoCl2(anh)"));
        m.add("Co^2+", n);
        m.add("Cl-", 2 * n);
        String target = m.solidTarget("CoCl2(anh)");
        colour(m, target == null ? "vessel" : target, "#3b5fc8", "#e58fb0", 0, 1200);
        m.reaction("cobalt-water-test", "Water turns cobalt chloride paper pink", "hydration",
                Latex.eq("CoCl2(s) + 6 H2O(l) -> CoCl2·6H2O(s)"), "cobalt-water-test", n);
        m.observe("The blue cobalt chloride paper turns pink - the test for water.");
    }

    /** Fehling's A + B (and Benedict's) keep copper(II) dissolved as a deep blue complex in alkali. */
    private static void copperComplexes(MixtureOps m) {
        double cu = m.get("Cu^2+");
        if (cu <= EPS) return;
        double tart = m.get("Tart^2-");
        if (tart > EPS && m.get("OH-") > EPS) {
            double e = Math.min(cu, tart);
            m.take("Cu^2+", e);
            m.take("Tart^2-", e);
            m.add("Cu(cplx)", e);
            m.reaction("fehlings-mixed", "Fehling's solution forms", "complex",
                    Latex.eq("Cu^2+ + C4H4O6^2- -> [Cu(C4H4O6)](aq)"), null, e);
            m.observe("Mixing Fehling's A and B gives a clear, deep blue solution: the tartrate holds the copper(II) ions in solution.");
        }
        double cit = m.get("Cit^3-");
        if (m.get("Cu^2+") > EPS && cit > EPS && (m.get("CO3^2-") > EPS || m.get("OH-") > EPS)) {
            double e = Math.min(m.get("Cu^2+"), cit);
            m.take("Cu^2+", e);
            m.take("Cit^3-", e);
            m.add("Cu(cplx)", e);
            m.reaction("copper-citrate", "Copper(II) citrate complex", "complex", Latex.eq("Cu^2+ + C6H5O7^3- -> [Cu(C6H5O7)]^-"), null, e);
            m.observe("The copper(II) ions stay in solution as a deep blue citrate complex (this is how Benedict's solution is made).");
        }
    }

    // ================================================================================== after acid-base

    static void afterAcidBase(MixtureOps m) {
        protonateBases(m);
        sulfiteWithAcid(m);
        silicateWithAcid(m);
        basicSolids(m);
        copperOneOxide(m);
        chromateEquilibrium(m);
        ironComplexes(m);
        glycineCopper(m);
    }

    /** Leftover strong acid turns the salts of weak acids back into the weak acids (and breaks up complexes). */
    private static void protonateBases(MixtureOps m) {
        if (m.get("H+") <= EPS) return;
        for (Acids.Weak w : Acids.WEAK) {
            if ("H2CO3".equals(w.key())) continue; // hydrogencarbonate + acid fizzes: handled with carbonates
            double h = m.get("H+");
            double b = m.get(w.conj());
            if (h <= EPS || b <= EPS) continue;
            double x = Math.min(h, b * w.perAnion());
            m.take("H+", x);
            m.take(w.conj(), x / w.perAnion());
            m.add(w.key(), x);
            if ("CH3COOH".equals(w.key()) && x > 1e-4) smell(m, "a sharp smell of vinegar (ethanoic acid)", 600);
            if ("C3H7COOH".equals(w.key()) && x > 1e-4) smell(m, "rancid butter (butanoic acid)", 600);
        }
        if (m.get("H+") > EPS && m.get("F-") > EPS) {
            double x = Math.min(m.get("H+"), m.get("F-"));
            m.take("H+", x);
            m.take("F-", x);
            m.add("HF", x);
        }
        double ag = m.get("Ag(NH3)2+");
        if (ag > EPS && m.get("H+") > EPS) {
            double x = Math.min(ag, m.get("H+") / 2);
            m.take("Ag(NH3)2+", x);
            m.take("H+", 2 * x);
            m.add("Ag+", x);
            m.add("NH4+", 2 * x);
            m.reaction("diamminesilver-acid", "Acid breaks up the silver-ammonia complex", "complex",
                    Latex.eq("[Ag(NH3)2]^+ + 2 H^+ -> Ag^+ + 2 NH4^+"), null, x);
        }
        for (String cplx : List.of("Cu(cplx)", "Cu(biuret)", "[Cu(NH3)4]^2+", "Cu(gly)")) {
            double c = m.get(cplx);
            if (c <= EPS || m.get("H+") <= EPS) continue;
            double x = Math.min(c, m.get("H+") / 4);
            m.take(cplx, x);
            m.take("H+", 4 * x);
            m.add("Cu^2+", x);
            m.reaction("copper-complex-acid", "Acid releases copper(II) ions", "complex",
                    Latex.eq("[CuL4]^2+ + 4 H^+ -> Cu^2+ + 4 HL^+"), null, x);
            m.observe("The deep blue fades to the paler blue of ordinary copper(II) ions as the acid breaks up the complex.");
        }
    }

    private static void sulfiteWithAcid(MixtureOps m) {
        double s = m.get("SO3^2-");
        if (s <= EPS || m.acidAvailable() <= EPS) return;
        double e = Math.min(s, m.acidAvailable() / 2);
        m.take("SO3^2-", e);
        double[] t = m.consumeAcid(2 * e);
        long start = m.nextStart();
        m.gas("SO2", e, "vessel", t[0] >= t[1] ? 1.0 : 0.3, "fine", start);
        m.reaction("acid-sulfite", "Acid and sulfite", "gas", Latex.eq("SO3^2- + 2 H^+ -> SO2(g) + H2O(l)"), "acid-sulfite", e);
        m.observe("Small bubbles rise and a choking smell of sulfur dioxide, like a struck match, fills the air - fume cupboard only.");
    }

    private static void silicateWithAcid(MixtureOps m) {
        double s = m.get("SiO3^2-");
        if (s <= EPS || m.get("H+") <= EPS) return;
        double e = Math.min(s, m.get("H+") / 2);
        m.take("SiO3^2-", e);
        m.take("H+", 2 * e);
        long start = m.nextStart();
        Lore.register("SiO2·xH2O", "Silica gel", "#f2f4f2");
        m.precipitate("SiO2·xH2O", e, "#eef2ee", start, 9000);
        m.reaction("silica-gel", "Silica gel forms", "precipitation", Latex.eq("SiO3^2- + 2 H^+ -> SiO2(s) + H2O(l)"), null, e);
        m.observe("A clear, wobbly jelly of silica gel forms as the acid meets the water glass.");
    }

    /** Insoluble basic oxides, hydroxides and carbonates neutralise acids. */
    record BasicSolid(String key, String cation, int charge, int count, String type, String formula, String name,
            boolean needsHeat, double rate, String colourWord) {}

    static final List<BasicSolid> BASIC_SOLIDS = List.of(
            new BasicSolid("MgO(s)", "Mg", 2, 1, "oxide", "MgO", "Magnesium oxide", false, 1.0, "colourless"),
            new BasicSolid("ZnO(s)", "Zn", 2, 1, "oxide", "ZnO", "Zinc oxide", false, 0.7, "colourless"),
            new BasicSolid("Mg(OH)2(s)", "Mg", 2, 1, "hydroxide", "Mg(OH)2", "Magnesium hydroxide", false, 1.0, "colourless"),
            new BasicSolid("Ca(OH)2(s)", "Ca", 2, 1, "hydroxide", "Ca(OH)2", "Calcium hydroxide", false, 1.2, "colourless"),
            new BasicSolid("MgCO3(s)", "Mg", 2, 1, "carbonate", "MgCO3", "Magnesium carbonate", false, 1.4, "colourless"),
            new BasicSolid("CuCO3(s)", "Cu", 2, 1, "carbonate", "CuCO3", "Copper(II) carbonate", false, 1.2, "blue"),
            new BasicSolid("ZnCO3(s)", "Zn", 2, 1, "carbonate", "ZnCO3", "Zinc carbonate", false, 1.2, "colourless"));

    private static void basicSolids(MixtureOps m) {
        for (BasicSolid b : BASIC_SOLIDS) {
            if (!m.has(b.key())) continue;
            if (m.acidAvailable() <= EPS) {
                if (m.aqMl() > 0 && !m.hadAcid()) {
                    m.reason(b.name() + " is insoluble in water" + ("Ca".equals(b.cation()) ? " (only very slightly soluble)" : "")
                            + " - it settles at the bottom. It would neutralise an acid.");
                }
                continue;
            }
            int protons = b.charge() * b.count();
            double n = m.get(b.key());
            double[] t = m.consumeAcid(protons * n);
            double e = (t[0] + t[1]) / protons;
            if (e <= EPS) continue;
            m.take(b.key(), e);
            m.add(b.cation() + "^2+", e * b.count());
            boolean carbonate = "carbonate".equals(b.type());
            m.heat((carbonate ? 20_000 : 60_000) * e);
            long start = m.nextStart();
            double k = b.rate() * (t[0] >= t[1] ? 1 : 0.35);
            if (carbonate) m.gas("CO2", e, m.solidTarget(b.key()), k, "medium", start);
            m.dissolveSolid(b.key(), start, (long) clamp(7000 / k, 2000, 14000));
            String water = switch (b.type()) {
                case "oxide" -> " + H2O(l)";
                case "hydroxide" -> " + 2 H2O(l)";
                default -> " + H2O(l) + CO2(g)";
            };
            m.reaction("acid-" + b.type() + "-" + b.cation().toLowerCase(Locale.ROOT), b.name() + " neutralises acid",
                    carbonate ? "gas" : "neutralisation",
                    Latex.eq(b.formula() + "(s) + 2 H^+ -> " + b.cation() + "^2+" + water),
                    carbonate ? "acid-carbonate" : "acid-oxide", e);
            m.observe(carbonate
                    ? "The " + Lore.lower(b.name()) + " fizzes as carbon dioxide is released and dissolves"
                            + ("blue".equals(b.colourWord()) ? ", turning the solution blue." : ".")
                    : "The white powder dissolves as it neutralises the acid - no fizzing, because no gas is made.");
            if (m.has(b.key())) m.observe("Some solid is left over: the acid has been used up.");
        }
        if (m.has("Al2O3(s)") && m.hadAcid()) {
            m.reason("Aluminium oxide is very unreactive: it doesn't dissolve in dilute acid at these temperatures.");
        }
        if (m.has("SiO2(s)") && (m.hadAcid() || m.get("OH-") > EPS)) {
            m.reason("Sand (silicon dioxide) doesn't react with dilute acids or alkalis.");
        }
    }

    /** Copper(I) oxide in acid disproportionates into copper and copper(II). */
    private static void copperOneOxide(MixtureOps m) {
        if (!m.has("Cu2O(s)")) return;
        if (m.acidAvailable() <= EPS) {
            if (m.aqMl() > 0) m.reason("Copper(I) oxide is insoluble in water.");
            return;
        }
        double n = m.get("Cu2O(s)");
        double[] t = m.consumeAcid(2 * n);
        double e = (t[0] + t[1]) / 2;
        m.take("Cu2O(s)", e);
        m.add("Cu^2+", e);
        long start = m.nextStart();
        m.precipitate("Cu", e, "#b5653a", start, 6000);
        m.reaction("copper1-disproportionation", "Copper(I) oxide splits in acid", "redox",
                Latex.eq("Cu2O(s) + 2 H^+ -> Cu(s) + Cu^2+ + H2O(l)"), "disproportionation", e);
        m.observe("The red powder turns into pinkish-brown copper metal while the solution turns blue: copper(I) "
                + "splits into copper(0) and copper(II) - a disproportionation.");
    }

    private static void chromateEquilibrium(MixtureOps m) {
        if (m.get("CrO4^2-") > EPS && m.get("H+") > EPS) {
            double e = Math.min(m.get("CrO4^2-") / 2, m.get("H+") / 2);
            m.take("CrO4^2-", 2 * e);
            m.take("H+", 2 * e);
            m.add("Cr2O7^2-", e);
            m.nextStart();
            m.reaction("chromate-dichromate", "Chromate turns to dichromate in acid", "equilibrium",
                    Latex.eq("2 CrO4^2- + 2 H^+ -> Cr2O7^2- + H2O(l)"), "chromate-equilibrium", e);
            m.observe("The yellow chromate solution turns orange as acid converts it to dichromate.");
        }
        if (m.get("Cr2O7^2-") > EPS && m.get("OH-") > EPS) {
            double e = Math.min(m.get("Cr2O7^2-"), m.get("OH-") / 2);
            m.take("Cr2O7^2-", e);
            m.take("OH-", 2 * e);
            m.add("CrO4^2-", 2 * e);
            m.nextStart();
            m.reaction("dichromate-chromate", "Dichromate turns to chromate in alkali", "equilibrium",
                    Latex.eq("Cr2O7^2- + 2 OH^- -> 2 CrO4^2- + H2O(l)"), "chromate-equilibrium", e);
            m.observe("The orange dichromate turns yellow as the alkali converts it to chromate - a reversible change.");
        }
    }

    private static void ironComplexes(MixtureOps m) {
        if (m.get("Fe^3+") <= EPS) return;
        if (m.get("OH-") > EPS) return; // hydroxide wins
        if (m.get("SCN-") > EPS) {
            double e = Math.min(m.get("Fe^3+"), m.get("SCN-"));
            m.take("Fe^3+", e);
            m.take("SCN-", e);
            m.add("[Fe(SCN)]^2+", e);
            Lore.register("[Fe(SCN)]^2+", "Thiocyanatoiron(III) ion", "#9a0f12");
            m.product("[Fe(SCN)]^2+", e, "aq");
            m.nextStart();
            m.reaction("iron-thiocyanate", "Iron(III) thiocyanate complex", "complex", Latex.eq("Fe^3+ + SCN^- -> [Fe(SCN)]^2+"),
                    "iron-thiocyanate", e);
            m.observe("The solution instantly turns a deep blood-red - the very sensitive test for iron(III) ions.");
        }
        if (m.get("Fe^3+") > EPS && m.get("C2O4^2-") > EPS) {
            double e = Math.min(m.get("Fe^3+"), m.get("C2O4^2-") / 3);
            m.take("Fe^3+", e);
            m.take("C2O4^2-", 3 * e);
            m.add("[Fe(C2O4)3]^3-", e);
            m.nextStart();
            m.reaction("iron-oxalate", "Iron(III) oxalate complex", "complex", Latex.eq("Fe^3+ + 3 C2O4^2- -> [Fe(C2O4)3]^3-"),
                    null, e);
            m.observe("The orange-yellow colour turns bright lime green as the oxalate complex forms.");
        }
        if (m.get("Fe^3+") > EPS && (m.get("HSal") > EPS || m.get("Sal-") > EPS)) {
            double sal = m.get("HSal") + m.get("Sal-");
            double e = Math.min(m.get("Fe^3+"), sal);
            m.take("Fe^3+", e);
            double fromSal = m.take("Sal-", e);
            m.take("HSal", e - fromSal);
            m.add("[Fe(Sal)]^+", e);
            m.nextStart();
            m.reaction("iron-salicylate", "Iron(III) and salicylate (phenol test)", "complex",
                    Latex.eq("Fe^3+ + HOC6H4COO^- -> [Fe(OC6H4COO)]^+ + H^+"), "phenol-test", e);
            m.observe("An intense violet-purple colour appears: iron(III) chloride detects the phenol group in salicylic acid.");
        }
        if (m.get("Fe^3+") > EPS && m.molar("CH3COO-") > 0.05) {
            double e = Math.min(m.get("Fe^3+"), m.get("CH3COO-") / 3);
            m.take("Fe^3+", e);
            m.add("Fe(CH3COO)", e);
            m.nextStart();
            m.reaction("iron-ethanoate", "Iron(III) ethanoate complex", "complex", Latex.eq("3 Fe^3+ + 6 CH3COO^- -> [Fe3O(CH3COO)6]^+"),
                    null, e);
            m.observe("The solution turns a deep red-brown: iron(III) forms a complex with ethanoate ions (a test for ethanoates).");
        }
    }

    private static void glycineCopper(MixtureOps m) {
        if (m.get("Cu^2+") <= EPS || m.get("org:glycine") <= EPS) return;
        double e = Math.min(m.get("Cu^2+"), m.get("org:glycine") / 2);
        m.take("Cu^2+", e);
        m.take("org:glycine", 2 * e);
        m.add("Cu(gly)", e);
        m.nextStart();
        m.reaction("copper-glycinate", "Copper(II) glycinate", "complex", Latex.eq("Cu^2+ + 2 NH2CH2COOH -> Cu(NH2CH2COO)2(aq) + 2 H^+"),
                "copper-ammine", e);
        m.observe("The pale blue deepens to a rich royal blue: the amino acid wraps around the copper(II) ions.");
    }

    // ================================================================================== metals

    /** Aluminium, zinc, tin and lead dissolve in strong alkali, giving off hydrogen. */
    static void amphotericMetals(MixtureOps m) {
        if (m.get("OH-") <= EPS) return;
        for (Portion p : m.portions()) {
            Substance.MetalInfo mi = p.substance().metal();
            if (mi == null) continue;
            String sym = mi.symbol();
            if (!Set.of("Al", "Zn", "Sn", "Pb", "Be", "Ga").contains(sym)) {
                if (m.molar("OH-") > 0.05 && mi.e0() > -2.0) {
                    m.reason(p.substance().name() + " doesn't react with alkalis - only amphoteric metals like aluminium and zinc do.");
                }
                continue;
            }
            String key = sym + "(s)";
            if (!m.has(key) || m.molar("OH-") < 0.05) continue;
            int c = "Al".equals(sym) || "Ga".equals(sym) ? 3 : 2;
            double rate = switch (sym) {
                case "Al" -> 1.6;
                case "Zn" -> 0.25;
                default -> 0.08;
            } * Math.pow(2, (m.tempC() - 25) / 10);
            double e = Math.min(m.get(key) * clamp(rate, 0.05, 1), m.get("OH-") / (c == 3 ? 1 : 2));
            if (e <= EPS) continue;
            m.take(key, e);
            m.take("OH-", c == 3 ? e : 2 * e);
            String complex = c == 3 ? "[" + sym + "(OH)4]^-" : "[" + sym + "(OH)4]^2-";
            m.add(complex, e);
            m.heat(200_000 * e);
            long start = m.nextStart();
            m.gas("H2", e * c / 2.0, m.solidTarget(key), rate, "fine", start);
            m.dissolveSolid(key, start, (long) clamp(9000 / rate, 2500, 14000));
            String name = Elements.NAME.getOrDefault(sym, sym);
            Lore.register(complex, c == 3 ? name + "ate ion" : name + "ate ion", null);
            m.reaction("amphoteric-metal-" + sym.toLowerCase(Locale.ROOT), name + " dissolves in alkali", "gas",
                    c == 3 ? Latex.eq("2 " + sym + "(s) + 2 OH^- + 6 H2O(l) -> 2 [" + sym + "(OH)4]^- + 3 H2(g)")
                            : Latex.eq(sym + "(s) + 2 OH^- + 2 H2O(l) -> [" + sym + "(OH)4]^2- + H2(g)"),
                    "amphoteric-metal", e);
            m.observe("Al".equals(sym)
                    ? "After a slow start the aluminium fizzes vigorously and the mixture gets hot: amphoteric aluminium dissolves in "
                            + "alkali, releasing hydrogen (how some drain cleaners work)."
                    : name + " slowly gives off bubbles of hydrogen - it is amphoteric, so it dissolves in strong alkali as well as acid.");
        }
    }

    // ================================================================================== redox

    static void redox(MixtureOps m) {
        dichromate(m);
        permanganateExtras(m);
        hypochlorite(m);
        thiosulfateWithIons(m);
        iodate(m);
        halogenReductions(m);
        silverIron(m);
        iron3Reductions(m);
        metalsWithHalogens(m);
        ironSulfide(m);
        nitricNoble(m);
    }

    private static void dichromate(MixtureOps m) {
        if (m.get("Cr2O7^2-") <= EPS) return;
        boolean acid = m.get("H+") > EPS;
        String[][] reductants = {
                {"Fe^2+", "6", "Cr2O7^2- + 6 Fe^2+ + 14 H^+ -> 2 Cr^3+ + 6 Fe^3+ + 7 H2O(l)", "iron(II)", "14"},
                {"I-", "6", "Cr2O7^2- + 6 I^- + 14 H^+ -> 2 Cr^3+ + 3 I2(aq) + 7 H2O(l)", "iodide", "14"},
                {"SO3^2-", "3", "Cr2O7^2- + 3 SO3^2- + 8 H^+ -> 2 Cr^3+ + 3 SO4^2- + 4 H2O(l)", "sulfite", "8"},
                {"H2O2", "3", "Cr2O7^2- + 3 H2O2 + 8 H^+ -> 2 Cr^3+ + 3 O2(g) + 7 H2O(l)", "hydrogen peroxide", "8"},
                {"HAsc", "3", "Cr2O7^2- + 3 C6H8O6 + 8 H^+ -> 2 Cr^3+ + 3 C6H6O6 + 7 H2O(l)", "vitamin C", "8"},
                {"H2C2O4", "6", "Cr2O7^2- + 3 H2C2O4 + 8 H^+ -> 2 Cr^3+ + 6 CO2(g) + 7 H2O(l)", "oxalic acid", "8"},
                {"C2O4^2-", "3", "Cr2O7^2- + 3 C2O4^2- + 14 H^+ -> 2 Cr^3+ + 6 CO2(g) + 7 H2O(l)", "oxalate", "14"}};
        for (String[] r : reductants) {
            if (m.get(r[0]) <= EPS || m.get("Cr2O7^2-") <= EPS) continue;
            boolean needsWarm = r[0].contains("C2O4");
            if (!acid) {
                m.pending("NEEDS_ACID", "acid", "Dichromate only oxidises " + r[3] + " in acid. Add a little dilute sulfuric acid.", "h2so4");
                continue;
            }
            if (needsWarm && m.tempC() < 50) {
                m.pending("NEEDS_HEAT", "heater", "Dichromate oxidises " + r[3] + " only slowly in the cold. Warm the mixture to about 60 °C.");
                continue;
            }
            int per = Integer.parseInt(r[1]);
            int hPer = Integer.parseInt(r[4]);
            double e = Math.min(m.get("Cr2O7^2-"), Math.min(m.get(r[0]) / per, m.get("H+") / hPer));
            if (e <= EPS) continue;
            m.take("Cr2O7^2-", e);
            m.take(r[0], per * e);
            m.take("H+", hPer * e);
            m.add("Cr^3+", 2 * e);
            if ("Fe^2+".equals(r[0])) m.add("Fe^3+", 6 * e);
            if ("I-".equals(r[0])) m.add("I2", 3 * e);
            if ("SO3^2-".equals(r[0])) m.add("SO4^2-", 3 * e);
            long start = m.nextStart();
            if ("H2O2".equals(r[0])) m.gas("O2", 3 * e, "vessel", 1.0, "fine", start);
            if (r[0].contains("C2O4")) m.gas("CO2", 6 * e, "vessel", 0.6, "fine", start);
            m.heat(150_000 * e);
            m.reaction("dichromate-" + r[3].replace(' ', '-').replace("(", "").replace(")", ""), "Dichromate oxidises " + r[3], "redox",
                    Latex.eq(r[2]), "dichromate-green", e);
            m.observe("The orange dichromate turns green as chromium(III) ions form - it has oxidised the " + r[3] + "."
                    + ("I-".equals(r[0]) ? " Brown iodine appears too." : ""));
        }
    }

    private static void permanganateExtras(MixtureOps m) {
        if (m.get("MnO4-") <= EPS) return;
        boolean acid = m.get("H+") > EPS;
        // {reductant, electrons given per unit, products note, needs warmth}
        Object[][] reds = {
                {"SO3^2-", 2, "2 MnO4^- + 5 SO3^2- + 6 H^+ -> 2 Mn^2+ + 5 SO4^2- + 3 H2O(l)", "sulfite", false},
                {"S2O3^2-", 8, "8 MnO4^- + 5 S2O3^2- + 14 H^+ -> 8 Mn^2+ + 10 SO4^2- + 7 H2O(l)", "thiosulfate", false},
                {"HAsc", 2, "2 MnO4^- + 5 C6H8O6 + 6 H^+ -> 2 Mn^2+ + 5 C6H6O6 + 8 H2O(l)", "vitamin C", false},
                {"H2C2O4", 2, "2 MnO4^- + 5 H2C2O4 + 6 H^+ -> 2 Mn^2+ + 10 CO2(g) + 8 H2O(l)", "oxalic acid", true},
                {"C2O4^2-", 2, "2 MnO4^- + 5 C2O4^2- + 16 H^+ -> 2 Mn^2+ + 10 CO2(g) + 8 H2O(l)", "oxalate", true},
                {"HCOOH", 2, "2 MnO4^- + 5 HCOOH + 6 H^+ -> 2 Mn^2+ + 5 CO2(g) + 8 H2O(l)", "methanoic acid", true},
                {"Br-", 2, "2 MnO4^- + 10 Br^- + 16 H^+ -> 2 Mn^2+ + 5 Br2(aq) + 8 H2O(l)", "bromide", false}};
        for (Object[] r : reds) {
            String key = (String) r[0];
            if (m.get(key) <= EPS || m.get("MnO4-") <= EPS) continue;
            boolean warm = (boolean) r[4];
            double perMn = (double) (int) r[1] == 2 ? 2.5 : 0.625; // reductant per MnO4-
            if (!acid) {
                if ("Br-".equals(key)) continue;
                // Neutral: brown manganese(IV) oxide instead.
                double e = Math.min(m.get("MnO4-"), m.get(key) / (perMn * 0.6));
                m.take("MnO4-", e);
                m.take(key, perMn * 0.6 * e);
                long start = m.nextStart();
                m.precipitate("MnO2", e, "#4a2f1d", start, 6000);
                m.reaction("permanganate-neutral-" + r[3].toString().replace(' ', '-'), "Permanganate oxidises " + r[3] + " (no acid)", "redox",
                        "\\mathrm{MnO_{4}^{-}} + \\text{" + r[3] + "} \\rightarrow \\mathrm{MnO_{2}}_{\\mathrm{(s)}} + \\text{oxidised products}", "permanganate-decolourised", e);
                m.observe("Without acid the purple colour turns into a muddy brown precipitate of manganese(IV) oxide.");
                continue;
            }
            if (warm && m.tempC() < 50) {
                m.pending("NEEDS_HEAT", "heater", "Acidified permanganate oxidises " + r[3] + " only slowly at first. Warm it to about 60 °C.");
                continue;
            }
            if ("Br-".equals(key) && m.molar("H+") < 0.5) continue;
            double e = Math.min(m.get("MnO4-"), Math.min(m.get(key) / perMn, m.get("H+") / 3.2));
            if (e <= EPS) continue;
            m.take("MnO4-", e);
            m.take(key, perMn * e);
            m.take("H+", Math.min(m.get("H+"), 3 * e));
            m.add("Mn^2+", e);
            if ("Br-".equals(key)) m.add("Br2", 2.5 * e);
            long start = m.nextStart();
            if (key.contains("C2O4") || "HCOOH".equals(key)) m.gas("CO2", 5 * e, "vessel", 0.6, "fine", start);
            m.heat(120_000 * e);
            m.reaction("permanganate-" + r[3].toString().replace(' ', '-'), "Permanganate oxidises " + r[3], "redox",
                    Latex.eq((String) r[2]), "permanganate-decolourised", e);
            m.observe(m.get("MnO4-") > EPS ? "The purple colour fades but doesn't disappear - permanganate is left over."
                    : "The purple colour disappears as the " + r[3] + " reduces permanganate to colourless manganese(II) ions"
                            + ("Br-".equals(key) ? ", and orange bromine appears." : key.contains("C2O4") ? " (bubbles of carbon dioxide)." : "."));
        }
        // Chloride: only slowly, and only a little chlorine.
        if (acid && m.get("MnO4-") > EPS && m.molar("Cl-") > 0.5 && m.molar("H+") > 0.5) {
            double e = m.get("MnO4-") * 0.15;
            m.take("MnO4-", e);
            m.add("Mn^2+", e);
            long start = m.nextStart();
            m.gas("Cl2", 2.5 * e, "vessel", 0.2, "fine", start);
            m.reaction("permanganate-chloride", "Permanganate slowly oxidises chloride", "redox",
                    Latex.eq("2 MnO4^- + 10 Cl^- + 16 H^+ -> 2 Mn^2+ + 5 Cl2(g) + 8 H2O(l)"), "permanganate-decolourised", e);
            m.observe("The purple slowly fades and a faint smell of chlorine appears: hydrochloric acid is oxidised by permanganate, "
                    + "which is why chemists acidify permanganate with sulfuric acid instead.");
        }
        // Metals in acidified permanganate.
        for (Portion p : m.portions()) {
            Substance.MetalInfo mi = p.substance().metal();
            if (mi == null || m.get("MnO4-") <= EPS) continue;
            String key = mi.symbol() + "(s)";
            if (!m.has(key) || mi.e0() > 1.0) continue;
            if (!acid) {
                if (mi.e0() < 0) {
                    double e = Math.min(m.get("MnO4-") * 0.3, m.get(key));
                    m.take("MnO4-", e);
                    long start = m.nextStart();
                    m.precipitate("MnO2", e, "#4a2f1d", start, 8000);
                    m.reaction("permanganate-metal-" + mi.symbol().toLowerCase(Locale.ROOT), "Permanganate slowly attacks "
                            + Lore.lower(p.substance().name()), "redox",
                            "\\mathrm{MnO_{4}^{-}} + \\text{metal} \\rightarrow \\mathrm{MnO_{2}}_{\\mathrm{(s)}} + \\text{metal ions}", "permanganate-decolourised", e);
                    m.observe("Over a few minutes a brown film of manganese(IV) oxide forms on the metal and the purple fades a little.");
                }
                continue;
            }
            double e = Math.min(m.get("MnO4-"), m.get(key) * 2 / 5);
            m.take("MnO4-", e);
            m.take(key, 5.0 / 2 * e);
            m.add(ionKey(mi.symbol(), 2), 5.0 / 2 * e);
            m.add("Mn^2+", e);
            m.nextStart();
            m.reaction("permanganate-metal-acid-" + mi.symbol().toLowerCase(Locale.ROOT), "Acidified permanganate oxidises "
                    + Lore.lower(p.substance().name()), "redox",
                    Latex.eq("2 MnO4^- + 5 " + mi.symbol() + "(s) + 16 H^+ -> 2 Mn^2+ + 5 " + mi.symbol() + "^2+ + 8 H2O(l)"),
                    "permanganate-decolourised", e);
            m.observe("The purple colour fades as the metal is oxidised by the acidified permanganate.");
        }
    }

    private static void hypochlorite(MixtureOps m) {
        if (m.get("OCl-") <= EPS) return;
        if (m.get("I-") > EPS) {
            double e = Math.min(m.get("OCl-"), m.get("I-") / 2);
            m.take("OCl-", e);
            m.take("I-", 2 * e);
            m.add("I2", e);
            m.add("Cl-", e);
            m.add("OH-", 2 * e);
            m.nextStart();
            m.reaction("bleach-iodide", "Bleach oxidises iodide", "redox", Latex.eq("OCl^- + 2 I^- + H2O(l) -> I2(aq) + Cl^- + 2 OH^-"),
                    "iodide-oxidation", e);
            m.observe("The colourless mixture turns yellow-brown as the bleach oxidises iodide to iodine (starch-iodide paper uses this).");
        }
        if (m.get("OCl-") > EPS && m.get("Br-") > EPS) {
            // In alkaline bleach the bromine made is immediately turned into hypobromite, so the liquid only goes yellow.
            double e = Math.min(m.get("OCl-"), m.get("Br-"));
            m.take("OCl-", e);
            m.take("Br-", e);
            m.add("OBr-", e);
            m.add("Cl-", e);
            m.nextStart();
            m.reaction("bleach-bromide", "Bleach oxidises bromide", "redox", Latex.eq("OCl^- + Br^- -> OBr^- + Cl^-"),
                    "halogen-displacement", e);
            m.observe("The mixture turns yellow: chlorine (as hypochlorite) is more reactive than bromine, so it takes the bromide's "
                    + "electrons and leaves yellow hypobromite - the same trick is used to disinfect swimming pools.");
        }
        if (m.get("OCl-") > EPS && m.get("Fe^2+") > EPS) {
            double e = Math.min(m.get("OCl-"), m.get("Fe^2+") / 2);
            m.take("OCl-", e);
            m.take("Fe^2+", 2 * e);
            long start = m.nextStart();
            m.precipitate("Fe(OH)3", 2 * e, "#9b4a1c", start, 7000);
            m.reaction("bleach-iron2", "Bleach oxidises iron(II)", "redox",
                    Latex.eq("2 Fe^2+ + OCl^- + 4 OH^- + H2O(l) -> 2 Fe(OH)3(s) + Cl^-"), "iron3-hydroxide", e);
            m.observe("A rust-brown precipitate of iron(III) hydroxide forms as bleach oxidises the iron(II).");
        }
        if (m.get("OCl-") > EPS && m.get("Mn^2+") > EPS) {
            double e = Math.min(m.get("OCl-"), m.get("Mn^2+"));
            m.take("OCl-", e);
            m.take("Mn^2+", e);
            long start = m.nextStart();
            m.precipitate("MnO2", e, "#3a2414", start, 7000);
            m.reaction("bleach-manganese", "Bleach oxidises manganese(II)", "redox",
                    Latex.eq("Mn^2+ + OCl^- + 2 OH^- -> MnO2(s) + Cl^- + H2O(l)"), null, e);
            m.observe("A dark brown-black precipitate of manganese(IV) oxide forms.");
        }
        for (String r : List.of("S2O3^2-", "SO3^2-", "HAsc")) {
            if (m.get("OCl-") <= EPS || m.get(r) <= EPS) continue;
            double per = "S2O3^2-".equals(r) ? 4 : 1;
            double e = Math.min(m.get(r), m.get("OCl-") / per);
            m.take(r, e);
            m.take("OCl-", per * e);
            m.add("Cl-", per * e);
            m.heat(150_000 * e);
            m.nextStart();
            m.reaction("bleach-" + r.replace("^", "").replace("2-", ""), "Bleach is destroyed by a reducing agent", "redox",
                    "S2O3^2-".equals(r) ? Latex.eq("S2O3^2- + 4 OCl^- + 2 OH^- -> 2 SO4^2- + 4 Cl^- + H2O(l)")
                            : "SO3^2-".equals(r) ? Latex.eq("SO3^2- + OCl^- -> SO4^2- + Cl^-")
                            : Latex.eq("C6H8O6 + OCl^- -> C6H6O6 + Cl^- + H2O(l)"),
                    null, e);
            m.observe("No colour change, but the mixture warms slightly: the reducing agent destroys the bleach (anti-chlor).");
        }
        boolean dye = m.keys().stream().anyMatch(k -> k.startsWith("ind:") || "dcpip".equals(k));
        if (m.get("OCl-") > EPS && dye) {
            m.bleach();
            m.nextStart();
            m.reaction("bleach-dye", "Bleach destroys the dye", "redox", "\\text{OCl}^{-} + \\text{dye} \\rightarrow \\text{colourless products}",
                    "chlorine-bleach", m.get("OCl-"));
            m.observe("The indicator's colour fades away to nothing - bleach oxidises coloured dyes.");
        }
        if (m.get("OCl-") > EPS && m.has("FeS(s)")) {
            double e = Math.min(m.get("FeS(s)"), m.get("OCl-") / 4.5);
            m.take("FeS(s)", e);
            m.take("OCl-", 4.5 * e);
            long start = m.nextStart();
            m.precipitate("Fe(OH)3", e, "#9b4a1c", start, 9000);
            m.reaction("bleach-iron-sulfide", "Bleach oxidises iron(II) sulfide", "redox",
                    Latex.eq("2 FeS(s) + 9 OCl^- + 4 OH^- + H2O(l) -> 2 Fe(OH)3(s) + 2 SO4^2- + 9 Cl^-"), null, e);
            m.observe("The black lumps slowly turn rusty brown on the surface as the bleach oxidises them.");
        }
        if (m.get("OCl-") > EPS) {
            for (Portion p : m.portions()) {
                Substance.MetalInfo mi = p.substance().metal();
                if (mi != null && m.has(mi.symbol() + "(s)") && mi.e0() < 0.5) {
                    m.reason("Bleach only very slowly corrodes " + Lore.lower(p.substance().name())
                            + " - nothing visible happens in a few minutes.");
                }
            }
        }
    }

    private static void thiosulfateWithIons(MixtureOps m) {
        double th = m.get("S2O3^2-");
        if (th <= EPS) return;
        if (m.get("Fe^3+") > EPS) {
            double e = Math.min(m.get("Fe^3+") / 2, th / 2);
            m.take("Fe^3+", 2 * e);
            m.take("S2O3^2-", 2 * e);
            m.add("Fe^2+", 2 * e);
            m.add("S4O6^2-", e);
            long start = m.nextStart();
            colour(m, "vessel", "#d99a2e", "#5a2a7a", start, 500);
            m.reaction("iron3-thiosulfate", "Iron(III) oxidises thiosulfate", "redox",
                    Latex.eq("2 Fe^3+ + 2 S2O3^2- -> 2 Fe^2+ + S4O6^2-"), "iron3-reduction", e);
            m.observe("A dark violet colour flashes up at once, then fades over a few seconds to the pale green of iron(II).");
        }
        if (m.get("Cu^2+") > EPS && m.get("S2O3^2-") > EPS) {
            double e = Math.min(m.get("Cu^2+") / 2, m.get("S2O3^2-") / 6);
            m.take("Cu^2+", 2 * e);
            m.take("S2O3^2-", 6 * e);
            m.add("[Cu(S2O3)2]^3-", 2 * e);
            m.add("S4O6^2-", e);
            m.nextStart();
            m.reaction("copper-thiosulfate", "Thiosulfate reduces copper(II)", "redox",
                    Latex.eq("2 Cu^2+ + 6 S2O3^2- -> 2 [Cu(S2O3)2]^3- + S4O6^2-"), null, e);
            m.observe("The blue colour fades towards colourless (briefly greenish) as copper(II) is reduced to a copper(I) complex.");
        }
        if (m.get("Ag+") > EPS && m.get("S2O3^2-") > EPS) {
            double ag = m.get("Ag+");
            if (m.get("S2O3^2-") >= 2 * ag) {
                m.take("Ag+", ag);
                m.take("S2O3^2-", 2 * ag);
                m.add("[Ag(S2O3)2]^3-", ag);
                m.nextStart();
                m.reaction("silver-thiosulfate-complex", "Silver ions dissolve in thiosulfate", "complex",
                        Latex.eq("Ag^+ + 2 S2O3^2- -> [Ag(S2O3)2]^3-"), "photographic-fixer", ag);
                m.observe("Nothing precipitates: excess thiosulfate holds the silver in a soluble complex - this is how photographic "
                        + "'fixer' removes unexposed silver salts.");
            } else {
                double e = Math.min(ag / 2, m.get("S2O3^2-"));
                m.take("Ag+", 2 * e);
                m.take("S2O3^2-", e);
                long start = m.nextStart();
                colour(m, "vessel", "#f5f5f3", "#3a3028", start + 800, 6000);
                Lore.register("Ag2S", "Silver sulfide", "#1e1e22");
                m.precipitate("Ag2S", e, "#1e1e22", start, 9000);
                m.reaction("silver-thiosulfate", "Silver thiosulfate decomposes", "precipitation",
                        Latex.eq("2 Ag^+ + S2O3^2- + H2O(l) -> Ag2S(s) + SO4^2- + 2 H^+"), null, e);
                m.observe("A white precipitate forms, then turns yellow, orange, brown and finally black as it decomposes to silver sulfide.");
            }
        }
        if (m.get("H2O2") > EPS && m.get("S2O3^2-") > EPS && m.get("H+") <= EPS) {
            double e = Math.min(m.get("H2O2"), m.get("S2O3^2-") / 2);
            m.take("H2O2", e);
            m.take("S2O3^2-", 2 * e);
            m.add("S4O6^2-", e);
            m.add("OH-", 2 * e);
            m.heat(180_000 * e);
            m.nextStart();
            m.reaction("peroxide-thiosulfate", "Peroxide oxidises thiosulfate", "redox",
                    Latex.eq("2 S2O3^2- + H2O2 -> S4O6^2- + 2 OH^-"), null, e);
            m.observe("No colour change, but the mixture warms up and becomes alkaline as the peroxide oxidises thiosulfate.");
        }
    }

    private static void iodate(MixtureOps m) {
        if (m.get("IO3-") <= EPS) return;
        if (m.get("SO3^2-") > EPS) {
            double e = Math.min(m.get("IO3-"), m.get("SO3^2-") / 3);
            m.take("IO3-", e);
            m.take("SO3^2-", 3 * e);
            m.add("I-", e);
            m.add("SO4^2-", 3 * e);
            m.nextStart();
            m.reaction("iodate-sulfite", "Sulfite reduces iodate", "redox", Latex.eq("IO3^- + 3 SO3^2- -> I^- + 3 SO4^2-"), "iodine-clock", e);
            m.observe("At first nothing seems to happen: sulfite is quietly reducing iodate to iodide.");
        }
        if (m.get("IO3-") > EPS && m.get("I-") > EPS) {
            if (m.get("H+") <= EPS) {
                m.reason("Iodate only oxidises iodide in acid - add a little dilute acid and iodine appears.");
                return;
            }
            double e = Math.min(m.get("IO3-"), Math.min(m.get("I-") / 5, m.get("H+") / 6));
            m.take("IO3-", e);
            m.take("I-", 5 * e);
            m.take("H+", 6 * e);
            m.add("I2", 3 * e);
            m.nextStart();
            m.reaction("iodate-iodide", "Iodate and iodide make iodine", "redox", Latex.eq("IO3^- + 5 I^- + 6 H^+ -> 3 I2(aq) + 3 H2O(l)"),
                    m.has("SO3^2-") || m.portions().stream().anyMatch(p -> p.substance().hasTag("sulfite")) ? "iodine-clock" : "iodide-oxidation", e);
            m.observe("Brown iodine appears as iodate oxidises iodide in the acid.");
        }
    }

    /** Halogens taken by sulfite, iron(II) and vitamin C. */
    private static void halogenReductions(MixtureOps m) {
        String[][] halogens = {{"Cl2", "Cl-", "chlorine"}, {"Br2", "Br-", "bromine"}, {"I2", "I-", "iodine"}};
        for (String[] x : halogens) {
            if (m.get(x[0]) > EPS && m.get("SO3^2-") > EPS) {
                double e = Math.min(m.get(x[0]), m.get("SO3^2-"));
                m.take(x[0], e);
                m.take("SO3^2-", e);
                m.add(x[1], 2 * e);
                m.add("SO4^2-", e);
                m.add("H+", 2 * e);
                m.nextStart();
                m.reaction("sulfite-" + x[2], "Sulfite reduces " + x[2], "redox",
                        Latex.eq(x[0] + "(aq) + SO3^2- + H2O(l) -> 2 " + x[1].replace("-", "^-") + " + SO4^2- + 2 H^+"), "iodine-decolourised", e);
                m.observe("The " + x[2] + " colour disappears as sulfite reduces it to colourless " + x[2].replace("ine", "ide") + " ions.");
            }
            if (!"I2".equals(x[0]) && m.get(x[0]) > EPS && m.get("Fe^2+") > EPS) {
                double e = Math.min(m.get(x[0]), m.get("Fe^2+") / 2);
                m.take(x[0], e);
                m.take("Fe^2+", 2 * e);
                m.add("Fe^3+", 2 * e);
                m.add(x[1], 2 * e);
                m.nextStart();
                m.reaction("halogen-iron2-" + x[2], Character.toUpperCase(x[2].charAt(0)) + x[2].substring(1) + " oxidises iron(II)",
                        "redox", Latex.eq("2 Fe^2+ + " + x[0] + "(aq) -> 2 Fe^3+ + 2 " + x[1].replace("-", "^-")), "peroxide-iron", e);
                m.observe("The pale green iron(II) solution turns yellow-orange as the " + x[2] + " oxidises it to iron(III).");
            }
            if (m.get(x[0]) > EPS && m.get("HAsc") + m.get("Asc-") > EPS) {
                double asc = m.get("HAsc") + m.get("Asc-");
                double e = Math.min(m.get(x[0]), asc);
                m.take(x[0], e);
                double fromAsc = m.take("Asc-", e);
                m.take("HAsc", e - fromAsc);
                m.add(x[1], 2 * e);
                m.add("H+", 2 * e - fromAsc);
                m.nextStart();
                m.reaction("vitamin-c-" + x[2], "Vitamin C reduces " + x[2], "redox",
                        Latex.eq("C6H8O6 + " + x[0] + "(aq) -> C6H6O6 + 2 H^+ + 2 " + x[1].replace("-", "^-")), "vitamin-c-test", e);
                m.observe("The " + x[2] + " colour vanishes: vitamin C is a reducing agent (this is how vitamin C content is measured).");
            }
        }
        if (m.get("dcpip") > EPS && m.get("HAsc") + m.get("Asc-") > EPS) {
            double e = Math.min(m.get("dcpip"), m.get("HAsc") + m.get("Asc-"));
            m.take("dcpip", e);
            double a = m.take("HAsc", e);
            m.take("Asc-", e - a);
            m.nextStart();
            m.reaction("vitamin-c-dcpip", "Vitamin C decolourises DCPIP", "redox", Latex.eq("DCPIP(blue) + C6H8O6 -> DCPIPH2(colourless) + C6H6O6"),
                    "vitamin-c-test", e);
            m.observe("The blue DCPIP turns colourless - a positive test for vitamin C.");
        }
    }

    private static void silverIron(MixtureOps m) {
        if (m.get("Ag+") > EPS && m.get("Fe^2+") > EPS) {
            double e = Math.min(m.get("Ag+"), m.get("Fe^2+"));
            m.take("Ag+", e);
            m.take("Fe^2+", e);
            m.add("Fe^3+", e);
            long start = m.nextStart();
            m.precipitate("Ag", e, "#8a8e94", start, 9000);
            m.reaction("silver-iron2", "Iron(II) reduces silver ions", "redox", Latex.eq("Ag^+ + Fe^2+ -> Ag(s) + Fe^3+"), "displacement-silver", e);
            m.observe("A grey precipitate of finely divided silver slowly forms, and the solution turns faintly yellow as iron(III) forms.");
        }
        if (m.get("Ag+") > EPS && m.get("HAsc") + m.get("Asc-") > EPS) {
            double e = Math.min(m.get("Ag+") / 2, m.get("HAsc") + m.get("Asc-"));
            m.take("Ag+", 2 * e);
            double a = m.take("HAsc", e);
            m.take("Asc-", e - a);
            long start = m.nextStart();
            m.precipitate("Ag", 2 * e, "#5a5e64", start, 8000);
            m.reaction("silver-ascorbic", "Vitamin C reduces silver ions", "redox",
                    Latex.eq("2 Ag^+ + C6H8O6 -> 2 Ag(s) + C6H6O6 + 2 H^+"), "displacement-silver", e);
            m.observe("The solution darkens as grey-black specks of silver metal form.");
        }
    }

    private static void iron3Reductions(MixtureOps m) {
        if (m.get("Fe^3+") <= EPS) return;
        for (String r : List.of("SO3^2-", "HAsc")) {
            if (m.get(r) <= EPS || m.get("Fe^3+") <= EPS) continue;
            double e = Math.min(m.get("Fe^3+") / 2, m.get(r));
            m.take("Fe^3+", 2 * e);
            m.take(r, e);
            m.add("Fe^2+", 2 * e);
            if ("SO3^2-".equals(r)) m.add("SO4^2-", e);
            m.nextStart();
            m.reaction("iron3-" + ("HAsc".equals(r) ? "vitamin-c" : "sulfite"), "Iron(III) is reduced", "redox",
                    "HAsc".equals(r) ? Latex.eq("2 Fe^3+ + C6H8O6 -> 2 Fe^2+ + C6H6O6 + 2 H^+")
                            : Latex.eq("2 Fe^3+ + SO3^2- + H2O(l) -> 2 Fe^2+ + SO4^2- + 2 H^+"),
                    "iron3-reduction", e);
            m.observe("The yellow-orange iron(III) colour fades to the pale green of iron(II).");
        }
        if (m.has("FeS(s)") && m.get("Fe^3+") > EPS) {
            double e = Math.min(m.get("FeS(s)"), m.get("Fe^3+") / 2);
            m.take("FeS(s)", e);
            m.take("Fe^3+", 2 * e);
            m.add("Fe^2+", 3 * e);
            long start = m.nextStart();
            m.precipitate("S", e, "#f2e45c", start, 9000);
            m.reaction("iron3-sulfide", "Iron(III) oxidises iron(II) sulfide", "redox", Latex.eq("FeS(s) + 2 Fe^3+ -> 3 Fe^2+ + S(s)"),
                    "iron3-reduction", e);
            m.observe("The orange solution slowly fades to pale green and pale yellow specks of sulfur appear on the black lumps.");
        }
    }

    /** A metal dropped into a halogen solution reduces it to halide ions: the colour fades. */
    private static void metalsWithHalogens(MixtureOps m) {
        String[][] halogens = {{"Cl2", "Cl", "1.36", "chlorine water"}, {"Br2", "Br", "1.07", "bromine water"}, {"I2", "I", "0.54", "iodine"}};
        for (Portion p : m.portions()) {
            Substance.MetalInfo mi = p.substance().metal();
            if (mi == null) continue;
            String key = mi.symbol() + "(s)";
            for (String[] x : halogens) {
                if (!m.has(key) || m.get(x[0]) <= EPS || m.aqMl() <= 0) continue;
                if (mi.e0() >= Double.parseDouble(x[2]) - 0.2) {
                    m.reason(p.substance().name() + " is too unreactive to be attacked by the " + x[3] + ".");
                    continue;
                }
                int c = mi.charge();
                double e = Math.min(m.get(key), m.get(x[0]) * 2 / c);
                if ("Al".equals(mi.symbol())) e *= 0.2;
                m.take(key, e);
                m.take(x[0], c * e / 2);
                m.add(ionKey(mi.symbol(), c), e);
                m.add(x[1] + "-", c * e);
                long start = m.nextStart();
                m.dissolveSolid(key, start, 6000);
                m.heat(100_000 * e);
                Latex.Salt salt = Latex.salt(mi.symbol(), c, false, x[1], 1, false);
                m.reaction("metal-" + x[1].toLowerCase(Locale.ROOT) + "-" + mi.symbol().toLowerCase(Locale.ROOT),
                        p.substance().name() + " reacts with " + x[3], "redox",
                        Latex.eq(switch (c) {
                            case 1 -> "2 " + mi.symbol() + "(s) + " + x[0] + "(aq) -> 2 " + salt.formula() + "(aq)";
                            case 3 -> "2 " + mi.symbol() + "(s) + 3 " + x[0] + "(aq) -> 2 " + salt.formula() + "(aq)";
                            default -> mi.symbol() + "(s) + " + x[0] + "(aq) -> " + salt.formula() + "(aq)";
                        }),
                        "metal-halogen", e);
                m.observe("The " + ("I2".equals(x[0]) ? "brown iodine" : "Br2".equals(x[0]) ? "orange bromine" : "pale green chlorine")
                        + " colour fades as the " + Lore.lower(p.substance().name()) + " turns it into colourless "
                        + Elements.NAME.getOrDefault(x[1], x[1]).toLowerCase(Locale.ROOT).replace("ine", "ide") + " ions.");
            }
        }
    }

    private static void ironSulfide(MixtureOps m) {
        if (!m.has("FeS(s)")) return;
        if (m.get("Ag+") > EPS) {
            double e = Math.min(m.get("FeS(s)"), m.get("Ag+") / 2);
            m.take("FeS(s)", e);
            m.take("Ag+", 2 * e);
            m.add("Fe^2+", e);
            long start = m.nextStart();
            Lore.register("Ag2S", "Silver sulfide", "#1e1e22");
            m.precipitate("Ag2S", e, "#1e1e22", start, 8000);
            m.reaction("iron-sulfide-silver", "Silver ions take the sulfide", "precipitation", Latex.eq("FeS(s) + 2 Ag^+ -> Ag2S(s) + Fe^2+"),
                    "metal-sulfide", e);
            m.observe("The black solid stays black - but it is now silver sulfide, even less soluble than iron sulfide; the solution "
                    + "turns faintly green.");
        }
        if (m.get("I2") > EPS && m.has("FeS(s)")) {
            double e = Math.min(m.get("FeS(s)"), m.get("I2")) * 0.5;
            m.take("FeS(s)", e);
            m.take("I2", e);
            m.add("Fe^2+", e);
            m.add("I-", 2 * e);
            long start = m.nextStart();
            m.precipitate("S", e, "#f2e45c", start, 9000);
            m.reaction("iodine-iron-sulfide", "Iodine oxidises iron(II) sulfide", "redox", Latex.eq("FeS(s) + I2(aq) -> Fe^2+ + 2 I^- + S(s)"),
                    "iodine-decolourised", e);
            m.observe("The brown iodine colour slowly fades as it oxidises the sulfide to pale yellow sulfur.");
        }
    }

    /** Copper and silver dissolve in nitric acid, giving nitrogen monoxide (brown NO2 in air). */
    private static void nitricNoble(MixtureOps m) {
        if (m.get("NO3-") <= EPS || m.get("H+") <= EPS) return;
        if (!m.presentTag("nitric_acid")) return;
        for (Portion p : m.portions()) {
            Substance.MetalInfo mi = p.substance().metal();
            if (mi == null || mi.e0() <= 0 || mi.e0() >= 0.96) continue;
            String key = mi.symbol() + "(s)";
            if (!m.has(key)) continue;
            if (m.tempC() < 45) {
                m.pending("NEEDS_HEAT", "heater", "Dilute nitric acid attacks " + Lore.lower(p.substance().name())
                        + " only very slowly when cold. Warm it to about 60 °C (in a fume cupboard).");
                continue;
            }
            int c = mi.charge();
            double hPer = c == 2 ? 8.0 / 3 : 4.0 / 3;
            double noPer = c == 2 ? 2.0 / 3 : 1.0 / 3;
            double e = 0.5 * Math.min(m.get(key), Math.min(m.get("H+") / hPer, m.get("NO3-") / noPer));
            if (e <= EPS) continue;
            m.take(key, e);
            m.take("H+", hPer * e);
            m.take("NO3-", noPer * e);
            m.add(ionKey(mi.symbol(), c), e);
            long start = m.nextStart();
            m.gas("NO", noPer * e, m.solidTarget(key), 0.6, "fine", start);
            Map<String, Object> s = m.cue("smoke", "vessel", start + 1500);
            s.put("colour", Colour.hex("#b5521f", 0.6).toJson());
            s.put("density", 0.4);
            s.put("durationMs", 5000);
            s.put("label", "Brown nitrogen dioxide at the mouth of the vessel");
            m.dissolveSolid(key, start, 9000);
            m.reaction("nitric-" + mi.symbol().toLowerCase(Locale.ROOT), p.substance().name() + " in nitric acid", "redox",
                    c == 2 ? Latex.eq("3 " + mi.symbol() + "(s) + 8 H^+ + 2 NO3^- -> 3 " + mi.symbol() + "^2+ + 2 NO(g) + 4 H2O(l)")
                            : Latex.eq("3 " + mi.symbol() + "(s) + 4 H^+ + NO3^- -> 3 " + mi.symbol() + "^+ + NO(g) + 2 H2O(l)"),
                    "nitric-acid-metal", e);
            m.observe(p.substance().name() + " slowly dissolves" + ("Cu".equals(mi.symbol()) ? " and the solution turns blue" : "")
                    + "; colourless nitrogen monoxide bubbles off and turns brown (toxic NO2) as it meets the air.");
        }
    }

    // ================================================================================== after precipitation

    /** Further complex ions once hydroxides have formed: ammines and amphoteric hydroxides. */
    static void moreComplexes(MixtureOps m) {
        Map<String, Double> ppt = m.precipitates();
        double ni = ppt.getOrDefault("Ni(OH)2", 0.0);
        if (ni > EPS && m.get("NH3") > 6 * ni * 0.5) {
            double e = Math.min(ni, m.get("NH3") / 6);
            m.take("NH3", 6 * e);
            m.add("[Ni(NH3)6]^2+", e);
            m.add("OH-", 2 * e);
            ppt.merge("Ni(OH)2", -e, Double::sum);
            Map<String, Object> c = m.cue("dissolve", "precipitate:Ni(OH)2", 2200);
            c.put("durationMs", 2600);
            c.put("fraction", ChemistryEngine.round(e / ni, 3));
            m.reaction("nickel-ammine", "Hexaamminenickel(II) forms", "complex",
                    Latex.eq("Ni(OH)2(s) + 6 NH3(aq) -> [Ni(NH3)6]^2+ + 2 OH^-"), "copper-ammine", e);
            m.observe("With excess ammonia the green precipitate dissolves into a lavender-blue solution.");
        }
        double co = ppt.getOrDefault("Co(OH)2", 0.0);
        if (co > EPS && m.get("NH3") > 6 * co * 0.5) {
            double e = Math.min(co, m.get("NH3") / 6);
            m.take("NH3", 6 * e);
            m.add("[Co(NH3)6]^2+", e);
            m.add("OH-", 2 * e);
            ppt.merge("Co(OH)2", -e, Double::sum);
            m.reaction("cobalt-ammine", "Hexaamminecobalt(II) forms", "complex",
                    Latex.eq("Co(OH)2(s) + 6 NH3(aq) -> [Co(NH3)6]^2+ + 2 OH^-"), null, e);
            m.observe("In excess ammonia the precipitate dissolves to a straw-coloured solution that darkens in air.");
        }
        String[][] amph = {{"Al(OH)3", "[Al(OH)4]^-", "1", "aluminium"}, {"Pb(OH)2", "[Pb(OH)4]^2-", "2", "lead"},
                {"Cr(OH)3", "[Cr(OH)6]^3-", "3", "chromium(III)"}, {"Sn(OH)2", "[Sn(OH)4]^2-", "2", "tin"}};
        for (String[] a : amph) {
            double h = ppt.getOrDefault(a[0], 0.0);
            int need = Integer.parseInt(a[2]);
            if (h <= EPS || m.get("OH-") <= EPS) continue;
            double e = Math.min(h, m.get("OH-") / need);
            m.take("OH-", need * e);
            m.add(a[1], e);
            ppt.merge(a[0], -e, Double::sum);
            Map<String, Object> c = m.cue("dissolve", "precipitate:" + a[0], 2200);
            c.put("durationMs", 2400);
            c.put("fraction", ChemistryEngine.round(e / h, 3));
            m.reaction("amphoteric-" + a[3].replace("(iii)", "").toLowerCase(Locale.ROOT).replace("(", "").replace(")", ""),
                    Character.toUpperCase(a[3].charAt(0)) + a[3].substring(1) + " hydroxide redissolves", "complex",
                    Latex.eq(a[0] + "(s) + " + (need == 1 ? "" : need + " ") + "OH^- -> " + a[1]), "amphoteric-zinc", e);
            m.observe("Cr(OH)3".equals(a[0]) ? "In excess alkali the grey-green precipitate dissolves to a dark green solution - amphoteric."
                    : "Then the white precipitate dissolves again in the excess alkali - " + a[3] + " hydroxide is amphoteric.");
        }
    }

    // ================================================================================== heat and flame

    /**
     * @param leaves what is left in the vessel for each mole heated, so the next step can carry on from it:
     *        "s:CuO=1" a solid by formula, "k:CuSO4(anh)=1" a species of its own, "p:Fe^2+=1" an ion sitting
     *        in the dry solid until water is added
     */
    record Decomposition(String key, String name, String equation, String fromHex, String toHex, String gas, double gasPer,
            String text, String discovery, boolean hotPlateEnough, List<String> leaves) {}

    static {
        Lore.register("K2MnO4", "Potassium manganate(VI)", "#1f3a24");
        Lore.register("KNO2", "Potassium nitrite", "#f6f2d8");
        Lore.register("char", "Carbon (char)", "#2a1a0e");
    }

    static final List<Decomposition> DECOMPOSITIONS = List.of(
            new Decomposition("CuCO3(s)", "copper(II) carbonate", "CuCO3(s) -> CuO(s) + CO2(g)", "#4fa58a", "#1e1e22", "CO2", 1,
                    "The green powder turns black (copper(II) oxide) as carbon dioxide is driven off - it would turn limewater milky.",
                    "thermal-decomposition", false, List.of("s:CuO=1")),
            new Decomposition("ZnCO3(s)", "zinc carbonate", "ZnCO3(s) -> ZnO(s) + CO2(g)", "#f6f6f2", "#f2e05a", "CO2", 1,
                    "The white powder gives off carbon dioxide and turns yellow while hot - zinc oxide, which goes white again on cooling.",
                    "thermal-decomposition", false, List.of("s:ZnO=1")),
            new Decomposition("MgCO3(s)", "magnesium carbonate", "MgCO3(s) -> MgO(s) + CO2(g)", "#f6f6f2", "#fbfbf8", "CO2", 1,
                    "The powder slowly gives off carbon dioxide, leaving white magnesium oxide.", "thermal-decomposition", false, List.of("s:MgO=1")),
            new Decomposition("CaCO3(s)", "calcium carbonate", "CaCO3(s) -> CaO(s) + CO2(g)", "#f6f6f2", "#fffbe8", "CO2", 0.1,
                    "Only the edges change: calcium carbonate needs about 900 °C. With strong heating it glows brightly (limelight) and a little "
                            + "quicklime forms.", "thermal-decomposition", false, List.of("s:CaO=1")),
            new Decomposition("NaHCO3(s)", "sodium hydrogencarbonate", "2 NaHCO3(s) -> Na2CO3(s) + H2O(g) + CO2(g)", "#fbfbf8", "#fbfbf8",
                    "CO2", 0.5, "The powder gives off carbon dioxide and steam - this is what makes cakes rise in the oven.",
                    "thermal-decomposition", true, List.of("s:Na2CO3=0.5")),
            new Decomposition("CuSO4·5H2O(s)", "copper(II) sulfate crystals", "CuSO4·5H2O(s) -> CuSO4(s) + 5 H2O(g)", "#2f86dc",
                    "#eef0ee", "H2O", 5, "The blue crystals crumble to a white powder as the water of crystallisation steams off. Add water "
                            + "back and it turns blue and hot again - a reversible reaction.", "dehydration", false, List.of("k:CuSO4(anh)=1")),
            new Decomposition("CoCl2·6H2O(s)", "cobalt(II) chloride crystals", "CoCl2·6H2O(s) -> CoCl2(s) + 6 H2O(g)", "#c0466e",
                    "#3b5fc8", "H2O", 6, "The pink crystals turn blue as they lose their water.", "dehydration", false, List.of("k:CoCl2(anh)=1")),
            new Decomposition("FeSO4·7H2O(s)", "iron(II) sulfate crystals", "FeSO4·7H2O(s) -> FeSO4(s) + 7 H2O(g)", "#a9d6a0",
                    "#f2f2ea", "H2O", 7, "The green crystals lose their water and turn white; much stronger heating would break them down "
                            + "further into red-brown iron(III) oxide.", "dehydration", false, List.of("p:Fe^2+=1", "p:SO4^2-=1")),
            new Decomposition("ZnSO4·7H2O(s)", "zinc sulfate crystals", "ZnSO4·7H2O(s) -> ZnSO4(s) + 7 H2O(g)", "#f6f6f2", "#fbfbf8",
                    "H2O", 7, "The crystals melt in their own water, steam, and leave a white powder.", "dehydration", false, List.of("p:Zn^2+=1", "p:SO4^2-=1")),
            new Decomposition("MgSO4(s)", "Epsom salt", "MgSO4·7H2O(s) -> MgSO4(s) + 7 H2O(g)", "#fbfbf8", "#fbfbf8", "H2O", 7,
                    "Steam comes off the crystals and they turn to a dry white powder.", "dehydration", false, List.of("k:MgSO4(s)=1")),
            new Decomposition("KMnO4(s)", "potassium manganate(VII)", "2 KMnO4(s) -> K2MnO4(s) + MnO2(s) + O2(g)", "#3a1040", "#1f2a1f",
                    "O2", 0.5, "The purple-black crystals crackle and spit as oxygen is released (it would relight a glowing splint), "
                            + "leaving a dark green-black residue.", "thermal-decomposition", false, List.of("s:MnO2=0.5", "s:K2MnO4=0.5")),
            new Decomposition("KNO3(s)", "potassium nitrate", "2 KNO3(s) -> 2 KNO2(s) + O2(g)", "#fbfbf8", "#f6f2d8", "O2", 0.5,
                    "The crystals melt into a clear liquid and slowly give off oxygen.", "thermal-decomposition", false, List.of("s:KNO2=1")),
            new Decomposition("NH4Cl(s)", "ammonium chloride", "NH4Cl(s) -> NH3(g) + HCl(g)", "#fbfbf8", "#fbfbf8", "white-smoke", 1,
                    "The white solid seems to vanish: it splits into ammonia and hydrogen chloride, which recombine as white smoke "
                            + "and re-form the solid on the cooler glass higher up.", "thermal-decomposition", false, List.of("k:NH4Cl(s)=1")),
            new Decomposition("Ca(OH)2(s)", "calcium hydroxide", "Ca(OH)2(s) -> CaO(s) + H2O(g)", "#f4f4f2", "#fbfbf8", "H2O", 1,
                    "Steam is driven off, leaving quicklime.", "thermal-decomposition", false, List.of("s:CaO=1")),
            new Decomposition("Mg(OH)2(s)", "magnesium hydroxide", "Mg(OH)2(s) -> MgO(s) + H2O(g)", "#f4f4f2", "#fbfbf8", "H2O", 1,
                    "Steam is driven off, leaving white magnesium oxide.", "thermal-decomposition", false, List.of("s:MgO=1")),
            new Decomposition("Na2S2O3·5H2O(s)", "sodium thiosulfate crystals", "Na2S2O3·5H2O(s) -> Na2S2O3(s) + 5 H2O(l)", "#fbfbf8",
                    "#f4f6f8", "H2O", 5, "The crystals melt in their own water of crystallisation at only 48 °C.", "dehydration", true, List.of("p:Na+=2", "p:S2O3^2-=1")),
            new Decomposition("org:sucrose", "sugar", "C12H22O11(s) -> 12 C(s) + 11 H2O(g)", "#fbfbf8", "#2a1a0e", "H2O", 11,
                    "The sugar melts, turns golden-brown caramel (smell of toffee), then chars to black carbon as steam is driven off.",
                    "thermal-decomposition", false, List.of("s:char=12")),
            new Decomposition("org:glucose", "glucose", "C6H12O6(s) -> 6 C(s) + 6 H2O(g)", "#fbfbf8", "#2a1a0e", "H2O", 6,
                    "The glucose melts, caramelises and finally chars black.", "thermal-decomposition", false, List.of("s:char=6")),
            new Decomposition("starch(s)", "starch", "(C6H10O5)n(s) -> 6n C(s) + 5n H2O(g)", "#fbfbf8", "#2a1a0e", "H2O", 5,
                    "The starch browns and chars, with a smell of burnt toast.", "thermal-decomposition", false, List.of("s:char=6")));

    static void heat(MixtureOps m) {
        boolean dry = m.aqMl() <= 0 && m.organicMl() <= 0;
        boolean hot = m.tempC() >= 60;
        if (dry && (m.ignition() || hot)) decompose(m, m.ignition());
        if (m.ignition()) {
            hydrogenPop(m);
            if (dry) burnInAir(m);
            flameTest(m);
        }
    }

    private static void decompose(MixtureOps m, boolean flame) {
        for (Decomposition d : DECOMPOSITIONS) {
            if (!m.has(d.key()) || m.solidTarget(d.key()) == null) continue;
            if (!flame && !d.hotPlateEnough()) {
                m.pending("NEEDS_STRONG_HEAT", "spark", "The hot plate only reaches 90 °C - " + d.name()
                        + " needs strong heating in a Bunsen flame. Heat it in the basin over the burner, or hold a flame to it.");
                continue;
            }
            if ("NH4NO3(s)".equals(d.key())) continue;
            double n = m.get(d.key()) * ("CaCO3(s)".equals(d.key()) ? 0.1 : 1);
            m.take(d.key(), n);
            long start = m.nextStart();
            String target = m.solidTarget(d.key());
            Map<String, Object> c = m.cue("colour", target, start);
            c.put("from", Colour.hex(d.fromHex(), 1).toJson());
            c.put("to", Colour.hex(d.toHex(), 1).toJson());
            c.put("durationMs", 4000);
            c.put("curve", "sigmoid");
            switch (d.gas()) {
                case "H2O" -> {
                    Map<String, Object> cd = m.cue("condense", "vessel", start + 800);
                    cd.put("colour", Colour.hex("#d6eeff", 0.8).toJson());
                    cd.put("amount", 0.7);
                    cd.put("durationMs", 5000);
                }
                case "white-smoke" -> {
                    Map<String, Object> s = m.cue("smoke", "vessel", start + 500);
                    s.put("colour", Colour.hex("#ffffff", 0.8).toJson());
                    s.put("density", 0.6);
                    s.put("durationMs", 6000);
                    s.put("label", "White smoke of ammonium chloride re-forming");
                }
                default -> m.gas(d.gas(), n * d.gasPer(), target, 0.6, "fine", start);
            }
            if (d.key().startsWith("org:") || "starch(s)".equals(d.key())) {
                smell(m, "caramel, then burning sugar", start + 1500);
                Map<String, Object> s = m.cue("smoke", "vessel", start + 2500);
                s.put("colour", Colour.hex("#5a4a3a", 0.5).toJson());
                s.put("density", 0.4);
                s.put("durationMs", 5000);
                s.put("label", "Smoke and steam from charring sugar");
            }
            if ("CaCO3(s)".equals(d.key())) {
                Map<String, Object> l = m.cue("light", "vessel", start);
                l.put("colour", Colour.hex("#fff6e0", 1).toJson());
                l.put("intensity", 0.6);
                l.put("durationMs", 4000);
            }
            for (String leaf : d.leaves()) {
                int eq = leaf.lastIndexOf('=');
                String what = leaf.substring(2, eq);
                double made = n * Double.parseDouble(leaf.substring(eq + 1));
                switch (leaf.charAt(0)) {
                    case 's' -> m.product(what, made, "s");
                    case 'k' -> m.add(what, made);
                    default -> m.park(what, made);
                }
            }
            m.reaction("decompose-" + d.key().replaceAll("[^A-Za-z0-9]", "").toLowerCase(Locale.ROOT), "Heating " + d.name(),
                    d.discovery().equals("dehydration") ? "dehydration" : "decomposition", Latex.eq(d.equation(), "heat"), d.discovery(), n);
            m.observe(d.text());
        }
        if (m.has("NH4NO3(s)")) {
            m.reason("Ammonium nitrate must never be heated strongly - it can decompose explosively. LABscape does not simulate this.");
        }
        for (String inert : List.of("NaCl(s)", "Na2CO3(s)", "CuO(s)", "MnO2(s)", "Fe2O3(s)", "MgO(s)", "ZnO(s)", "SiO2(s)", "Al2O3(s)",
                "CaO(s)")) {
            if (m.has(inert) && m.solidTarget(inert) != null && flame) {
                m.reason("Strong heating doesn't decompose " + Lore.name(inert.replace("(s)", "")).toLowerCase(Locale.ROOT)
                        + " - it just gets very hot" + ("ZnO(s)".equals(inert) ? " (and turns yellow until it cools)." : "."));
            }
        }
    }

    /** Hydrogen meeting a flame in air: the squeaky pop. */
    private static void hydrogenPop(MixtureOps m) {
        if (m.get("H2(g)") <= EPS || m.get("O2(g)") > EPS) return;
        double e = m.take("H2(g)", m.get("H2(g)"));
        long start = m.nextStart();
        Map<String, Object> l = m.cue("light", "vessel", start);
        l.put("colour", Colour.hex("#cfe6ff", 1).toJson());
        l.put("intensity", 0.5);
        l.put("durationMs", 500);
        m.cue("sound", "vessel", start).put("soundId", "pop");
        m.reaction("hydrogen-pop", "Hydrogen burns in air", "synthesis", Latex.eq("2 H2(g) + O2(g) -> 2 H2O(l)"), "water-synthesis", e);
        m.observe("A squeaky 'pop' as the hydrogen burns with oxygen from the air - the test for hydrogen.");
    }

    private static void burnInAir(MixtureOps m) {
        if (m.portions().stream().anyMatch(p -> p.substance().isElement() && p.substance().isGas())) return;
        for (Portion p : m.portions()) {
            Substance.MetalInfo mi = p.substance().metal();
            if (mi == null) continue;
            String sym = mi.symbol();
            String key = sym + "(s)";
            if (!m.has(key)) continue;
            String name = p.substance().name();
            if (mi.e0() > 0.3 && !"Cu".equals(sym)) {
                m.reason(name + " doesn't burn or tarnish in a flame - it is a noble metal.");
                continue;
            }
            if ("Al".equals(sym)) {
                m.reason("Aluminium foil just glows: its oxide layer stops it burning. (Fine aluminium powder burns fiercely.)");
                continue;
            }
            int c = mi.charge();
            Latex.Salt oxide = Latex.salt(sym, c, false, "O", 2, false);
            double e = m.get(key) * ("Cu".equals(sym) ? 0.15 : "Fe".equals(sym) ? 0.4 : 1);
            m.take(key, e);
            m.heat(300_000 * e);
            long start = m.nextStart();
            String hex = ElementRules.FLAME.getOrDefault(sym, "#ffb060");
            boolean bright = "Mg".equals(sym) || "Ca".equals(sym);
            if (!"Cu".equals(sym)) {
                Map<String, Object> f = m.cue("flame", "vessel", start);
                f.put("colour", Colour.hex(hex, 1).toJson());
                f.put("intensity", bright ? 1.0 : 0.6);
                f.put("durationMs", 3000);
            }
            if (bright) {
                Map<String, Object> l = m.cue("light", "vessel", start);
                l.put("colour", Colour.hex("#ffffff", 1).toJson());
                l.put("intensity", 1.0);
                l.put("durationMs", 2500);
            }
            String oxHex = "Cu".equals(sym) ? "#1e1e22" : "Fe".equals(sym) ? "#2a2a2c" : "#f6f6f2";
            String target = m.solidTarget(key);
            if (target != null) {
                Map<String, Object> c2 = m.cue("colour", target, start + 500);
                c2.put("from", Colour.hex(mi.colour() == null ? "#c0c4c8" : mi.colour(), 1).toJson());
                c2.put("to", Colour.hex(oxHex, 1).toJson());
                c2.put("durationMs", 2500);
                c2.put("curve", "sigmoid");
            }
            int metalCoef = oxide.cations() * (oxide.anions() % 2 == 0 ? 1 : 2);
            int o2 = oxide.anions() * (metalCoef / oxide.cations()) / 2;
            int oxCoef = metalCoef / oxide.cations();
            Lore.register(oxide.formula(), Elements.NAME.getOrDefault(sym, sym) + " oxide", oxHex);
            m.product(oxide.formula(), e / oxide.cations(), "s");
            m.reaction("burn-in-air-" + sym.toLowerCase(Locale.ROOT), name + " heated in air", "synthesis",
                    "Fe".equals(sym) ? Latex.eq("3 Fe(s) + 2 O2(g) -> Fe3O4(s)")
                            : Latex.eq(metalCoef + " " + sym + "(s) + " + o2 + " O2(g) -> " + oxCoef + " " + oxide.formula() + "(s)"),
                    "metal-burning", e);
            m.observe(switch (sym) {
                case "Mg" -> "The magnesium burns in the air with a blinding white light, leaving white magnesium oxide ash. Never look straight at it.";
                case "Fe" -> "The iron glows and throws out bright orange sparks as it burns, leaving a black oxide.";
                case "Cu" -> "The copper doesn't burn, but its surface turns black as a layer of copper(II) oxide forms.";
                case "Zn" -> "The zinc burns with a bluish-green flame and leaves white zinc oxide (yellow while hot).";
                default -> name + " burns in the air, forming its oxide.";
            });
        }
    }

    /** Metal ions in a flame give characteristic colours. */
    private static void flameTest(MixtureOps m) {
        if (Organic.burnable(m)) return;
        String[][] ions = {{"Na+", "Na", "orange-yellow"}, {"Li+", "Li", "crimson-red"}, {"Sr^2+", "Sr", "bright red"},
                {"Ca^2+", "Ca", "brick-red"}, {"Cu^2+", "Cu", "blue-green"}, {"Ba^2+", "Ba", "apple-green"}, {"K+", "K", "lilac"}};
        Set<String> keys = m.keys();
        keys.addAll(m.driedKeys());
        for (Portion p : m.portions()) {
            Substance s = p.substance();
            if (s.isSolid() && !s.isElement()) {
                for (String k : s.species().keySet()) {
                    Phases.Soluble sol = Phases.SOLUBLE.get(k);
                    if (sol != null) keys.addAll(sol.ions().keySet());
                    if (k.startsWith("NaCl") || k.startsWith("NaHCO3") || k.startsWith("Na2CO3")) keys.add("Na+");
                    if (k.startsWith("CuSO4") || k.startsWith("CuCO3")) keys.add("Cu^2+");
                    if (k.startsWith("KNO3") || k.startsWith("KCl")) keys.add("K+");
                    if (k.startsWith("CaCO3")) keys.add("Ca^2+");
                }
            }
        }
        for (String[] ion : ions) {
            if (!keys.contains(ion[0])) continue;
            long start = m.nextStart();
            Map<String, Object> f = m.cue("flame", "vessel", start);
            f.put("colour", Colour.hex(ElementRules.FLAME.getOrDefault(ion[1], "#ffb060"), 1).toJson());
            f.put("intensity", 0.5);
            f.put("durationMs", 3500);
            String name = Elements.NAME.getOrDefault(ion[1], ion[1]).toLowerCase(Locale.ROOT);
            m.reaction("flame-test-" + ion[1].toLowerCase(Locale.ROOT), "Flame test: " + name, "physical",
                    "\\text{" + Elements.NAME.getOrDefault(ion[1], ion[1]) + " ions} \\xrightarrow{\\text{flame}} \\text{"
                            + ion[2] + " light}", "flame-test", 0);
            m.observe("In the flame the colour is " + ion[2] + " - the flame test for " + name + " ions"
                    + ("Na".equals(ion[1]) && keys.contains("K+") ? " (sodium's strong orange hides potassium's lilac; look through blue glass)." : ".")
                    + " Electrons excited by the heat give out light of a particular colour as they drop back.");
            break;
        }
    }
}
