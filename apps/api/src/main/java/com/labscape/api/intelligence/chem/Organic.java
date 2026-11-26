package com.labscape.api.intelligence.chem;

import com.labscape.api.intelligence.chem.ChemistryEngine.Portion;
import com.labscape.api.intelligence.chem.Organics.Compound;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Organic chemistry and the classic qualitative tests: bromine water, iodoform, oxidation by acidified
 * dichromate and permanganate, Benedict's/Fehling's, Tollens', biuret, esterification and ester
 * hydrolysis, saponification, proteins, emulsions, enzymes (yeast, amylase), dehydration by
 * concentrated sulfuric acid, alkali metals with alcohols, and combustion.
 */
final class Organic {

    private Organic() {}

    private static final double EPS = ChemistryEngine.EPS;

    /** Organic compounds currently present (amount > trace), in key order. */
    private static List<Compound> present(MixtureOps m) {
        List<Compound> out = new ArrayList<>();
        for (String k : m.keys()) {
            if (!k.startsWith("org:")) continue;
            Compound c = Organics.get(k);
            if (c != null && !out.contains(c)) out.add(c);
        }
        return out;
    }

    private static String lower(String s) {
        return Lore.lower(s);
    }

    private static void colour(MixtureOps m, String fromHex, String toHex, long start, long duration) {
        Map<String, Object> c = m.cue("colour", "vessel", start);
        c.put("from", Colour.hex(fromHex, 1).toJson());
        c.put("to", Colour.hex(toHex, 1).toJson());
        c.put("durationMs", duration);
        c.put("curve", "sigmoid");
    }

    private static void smell(MixtureOps m, String description, long start) {
        m.cue("odour", "vessel", start).put("description", description);
    }

    private static double amount(MixtureOps m, Compound c) {
        return m.get(c.key()) + m.get(c.key() + "(s)");
    }

    private static double takeCompound(MixtureOps m, Compound c, double n) {
        double t = m.take(c.key(), n);
        if (t < n) t += m.take(c.key() + "(s)", n - t);
        return t;
    }

    // ================================================================================== before oxidants

    static void beforeOxidants(MixtureOps m) {
        bromineWater(m);
        iodoform(m);
        oxidations(m);
    }

    private static void bromineWater(MixtureOps m) {
        for (String x2 : List.of("Br2", "Cl2")) {
            if (m.get(x2) <= EPS) continue;
            String x = x2.substring(0, 2);
            String halogen = "Br2".equals(x2) ? "bromine" : "chlorine";
            for (Compound c : present(m)) {
                if (c.unsat() <= 0 || m.get(x2) <= EPS) continue;
                double n = amount(m, c);
                double e = Math.min(n, m.get(x2) / c.unsat());
                takeCompound(m, c, e);
                m.take(x2, e * c.unsat());
                String product = "C" + c.c() + "H" + c.h() + x + (2 * c.unsat()) + (c.o() > 0 ? "O" + (c.o() > 1 ? c.o() : "") : "");
                Lore.register(product, "Dihalogenated " + lower(c.name()) + " (addition product)", null);
                m.product(product, e, "l");
                long start = m.nextStart();
                boolean slow = "lipid".equals(c.family());
                colour(m, "Br2".equals(x2) ? "#d0661a" : "#e3ef9a", "#eef6fb", start, slow ? 6000 : 900);
                m.reaction("halogen-addition-" + c.key().substring(4), lower(c.name()) + " decolourises " + halogen + " water", "addition",
                        Latex.eq(c.formula() + " + " + (c.unsat() > 1 ? c.unsat() + " " : "") + x2 + "(aq) -> " + product),
                        "Br2".equals(x2) ? "bromine-water-test" : null, e);
                m.observe(slow ? "The " + halogen + " water slowly loses its colour as it adds across the C=C double bonds in the oil - "
                        + "the oil is unsaturated."
                        : "The " + ("Br2".equals(x2) ? "orange bromine" : "pale green chlorine") + " water is decolourised at once: "
                                + lower(c.name()) + " has a C=C double bond (it is unsaturated), and the " + halogen
                                + " adds across it.");
            }
            if (m.get(x2) > EPS && "Br2".equals(x2)) {
                // Aldehydes and aldose sugars slowly reduce bromine water.
                for (Compound c : present(m)) {
                    if (!c.has("fehling") || "org:fructose".equals(c.key()) || m.get("Br2") <= EPS) continue;
                    double e = Math.min(amount(m, c), m.get("Br2")) * 0.6;
                    if (e <= EPS) continue;
                    takeCompound(m, c, e);
                    m.take("Br2", e);
                    m.add("Br-", 2 * e);
                    m.add("H+", 2 * e);
                    m.nextStart();
                    m.reaction("bromine-oxidises-" + c.key().substring(4), "Bromine water oxidises " + lower(c.name()), "redox",
                            Latex.eq("RCHO + Br2(aq) + H2O(l) -> RCOOH + 2 Br^- + 2 H^+"), null, e);
                    m.observe("The bromine water slowly fades as it oxidises the " + lower(c.name()) + " (an aldehyde group).");
                }
                boolean saturated = present(m).stream().anyMatch(c -> List.of("alkane", "arene").contains(c.family())
                        || "org:lard".equals(c.key()));
                if (saturated && m.get("Br2") > EPS) {
                    m.reason("Alkanes have no C=C double bonds, so they don't decolourise bromine water (in the dark). "
                            + "The bromine just dissolves in the organic layer.");
                }
            }
        }
    }

    private static void iodoform(MixtureOps m) {
        List<Compound> positive = present(m).stream().filter(c -> c.iodoformI2() > 0).toList();
        boolean lactic = m.get("HLac") + m.get("Lac-") > EPS;
        if (positive.isEmpty() && !lactic) return;
        if (m.get("I2") <= EPS) return;
        if (m.get("OH-") <= EPS) {
            String name = positive.isEmpty() ? "lactic acid" : lower(positive.get(0).name());
            m.pending("NEEDS_ALKALI", "alkali", "The iodoform test needs alkali: add sodium hydroxide solution until the brown iodine "
                    + "colour just fades, then warm gently - " + name + " should give a pale yellow precipitate.", "naoh");
            return;
        }
        for (Compound c : positive) {
            boolean alcohol = "alcohol".equals(c.family());
            if (alcohol && m.tempC() < 40) {
                m.pending("NEEDS_HEAT", "heater", "With an alcohol the iodoform test needs gentle warming. Warm to about 60 °C.");
                continue;
            }
            int i2 = c.iodoformI2();
            int oh = i2 == 3 ? 4 : 6;
            double e = Math.min(amount(m, c), Math.min(m.get("I2") / i2, m.get("OH-") / oh));
            if (e <= EPS) continue;
            takeCompound(m, c, e);
            m.take("I2", i2 * e);
            m.take("OH-", oh * e);
            m.add("I-", (i2 == 3 ? 3 : 5) * e);
            long start = m.nextStart();
            Lore.register("CHI3", "Triiodomethane (iodoform)", "#f2e05a");
            m.precipitate("CHI3", e, "#f2e05a", start, 7000);
            smell(m, "an antiseptic, hospital-like smell (iodoform)", start + 1500);
            m.reaction("iodoform-" + c.key().substring(4), "Iodoform test: " + lower(c.name()), "precipitation",
                    i2 == 3 ? Latex.eq(c.formula() + " + 3 I2(aq) + 4 OH^- -> CHI3(s) + RCOO^- + 3 I^- + 3 H2O(l)")
                            : Latex.eq(c.formula() + " + 4 I2(aq) + 6 OH^- -> CHI3(s) + RCOO^- + 5 I^- + 5 H2O(l)"),
                    "iodoform-test", e);
            m.observe("A pale yellow precipitate of triiodomethane (iodoform) forms, with an antiseptic smell: "
                    + lower(c.name()) + " contains a CH3C=O group, or a CH3CH(OH) group that is oxidised to one.");
        }
    }

    /** Organic reducing agents with acidified dichromate and permanganate (and permanganate's alkene tests). */
    private static void oxidations(MixtureOps m) {
        boolean dichromate = m.get("Cr2O7^2-") > EPS;
        boolean permanganate = m.get("MnO4-") > EPS;
        if (!dichromate && !permanganate) return;
        boolean acid = m.get("H+") > EPS;
        boolean alkali = m.get("OH-") > EPS;
        boolean warm = m.tempC() >= 50;
        List<Compound> all = present(m);
        for (Compound c : all) {
            boolean oxidisable = c.has("oxidisable");
            boolean alkene = c.unsat() > 0;
            if ("tertiary".equals(c.cls())) {
                m.reason(c.name() + " is a tertiary alcohol: it has no hydrogen on the carbon bearing the OH group, so "
                        + (dichromate ? "acidified dichromate stays orange." : "permanganate stays purple."));
                continue;
            }
            if ("ketone".equals(c.family())) {
                m.reason(c.name() + " is a ketone: ketones resist oxidation, so the " + (dichromate ? "dichromate" : "permanganate")
                        + " colour stays.");
                continue;
            }
            // Permanganate: alkenes react cold (Baeyer test), sugars in alkali give the 'chemical chameleon'.
            if (permanganate && m.get("MnO4-") > EPS && alkene && !acid) {
                double e = Math.min(amount(m, c) * c.unsat(), m.get("MnO4-") * 1.5);
                takeCompound(m, c, e / c.unsat());
                m.take("MnO4-", e / 1.5);
                long start = m.nextStart();
                m.precipitate("MnO2", e / 1.5, "#4a2f1d", start + 400, 7000);
                m.reaction("baeyer-" + c.key().substring(4), "Permanganate oxidises the C=C bond", "redox",
                        Latex.eq("C=C + [O] + H2O(l) -> C(OH)-C(OH)", "KMnO4"), "permanganate-alkene", e);
                m.observe("The purple permanganate turns to a brown precipitate of manganese(IV) oxide in the cold - "
                        + "a test for C=C double bonds.");
                continue;
            }
            if (permanganate && alkali && m.get("MnO4-") > EPS && (c.has("fehling") || "org:glucose".equals(c.key()))) {
                double e = Math.min(amount(m, c), m.get("MnO4-"));
                takeCompound(m, c, e * 0.5);
                m.take("MnO4-", e);
                long start = m.nextStart();
                colour(m, "#7b1f8a", "#2f8a3a", start, 2500);
                colour(m, "#2f8a3a", "#b8742a", start + 3000, 3000);
                m.precipitate("MnO2", e * 0.6, "#5a3a1d", start + 5000, 7000);
                m.reaction("chemical-chameleon", "The chemical chameleon", "redox",
                        Latex.eq("MnO4^- + e^- -> MnO4^2-"), "chemical-chameleon", e);
                m.observe("The 'chemical chameleon': purple turns green (manganate(VI)), then orange-brown as manganese(IV) oxide forms.");
                continue;
            }
            if (!oxidisable) continue;
            if (!acid) {
                m.pending("NEEDS_ACID", "acid", "The " + (dichromate ? "dichromate" : "permanganate") + " needs to be acidified before it "
                        + "can oxidise " + lower(c.name()) + ". Add a little dilute sulfuric acid, then warm it.", "h2so4");
                continue;
            }
            boolean needsWarm = !"aldehyde".equals(c.family()) || dichromate;
            if (needsWarm && !warm) {
                m.pending("NEEDS_HEAT", "heater", "Warm the mixture in a water bath (about 60 °C): acidified "
                        + (dichromate ? "dichromate" : "permanganate") + " oxidises " + lower(c.name()) + " only slowly in the cold.");
                continue;
            }
            String oxidant = m.get("Cr2O7^2-") > EPS ? "Cr2O7^2-" : m.get("MnO4-") > EPS ? "MnO4-" : null;
            if (oxidant == null) break;
            boolean cr = "Cr2O7^2-".equals(oxidant);
            // [O] per oxidant: dichromate 3, permanganate 2.5.  H+ per [O]: dichromate 8/3, permanganate 6/5 (approx).
            double perO = cr ? 3 : 2.5;
            double hPerO = cr ? 8.0 / 3 : 1.2;
            double n = amount(m, c);
            double e = Math.min(n, Math.min(m.get(oxidant) * perO, m.get("H+") / hPerO));
            if (e <= EPS) continue;
            takeCompound(m, c, e);
            m.take(oxidant, e / perO);
            m.take("H+", hPerO * e);
            if (cr) m.add("Cr^3+", 2 * e / perO); else m.add("Mn^2+", e / perO);
            m.heat(150_000 * e);
            if (c.oxFormula() != null) {
                Lore.register(c.oxFormula(), Character.toUpperCase(c.oxName().charAt(0)) + c.oxName().substring(1), null);
                m.product(c.oxFormula(), e, "aq");
            }
            long start = m.nextStart();
            String over = cr ? "K2Cr2O7/H2SO4" : "KMnO4/H2SO4";
            String eq = c.oxFormula() != null
                    ? Latex.eq(c.formula() + " + [O] -> " + c.oxFormula() + ("aldehyde".equals(c.family()) || "sugar".equals(c.family())
                            ? "" : " + H2O(l)"), over)
                    : "\\text{" + c.name() + "} + [\\mathrm{O}] \\xrightarrow{\\mathrm{" + Latex.formula(over)
                            + "}} \\text{oxidation products}";
            boolean alcohol = "alcohol".equals(c.family());
            m.reaction((cr ? "dichromate-" : "permanganate-") + c.key().substring(4), (cr ? "Dichromate" : "Permanganate")
                    + " oxidises " + lower(c.name()), "redox", eq, alcohol ? "alcohol-oxidation" : cr ? "dichromate-green"
                    : "permanganate-decolourised", e);
            m.observe((cr ? "The orange dichromate turns green (chromium(III) ions)" : "The purple permanganate is decolourised")
                    + " as it oxidises the " + (alcohol ? c.cls() + " alcohol " : "") + lower(c.name())
                    + (c.oxName() != null ? " to " + c.oxName() + "." : "."));
            if ("ethanal".equals(c.oxName())) smell(m, "a sharp smell of green apples (ethanal)", start + 2000);
            if ("propanone".equals(c.oxName())) smell(m, "a sweet smell of nail-varnish remover (propanone)", start + 2000);
        }
        // Lactic acid (a secondary alcohol group) and sucrose/starch under hot acidified oxidants.
        if (acid && warm) {
            for (String[] s : new String[][] {{"HLac", "lactic acid", "pyruvic acid"}, {"org:sucrose", "sucrose", "oxidation products"},
                    {"starch", "starch", "oxidation products"}}) {
                String oxidant = m.get("Cr2O7^2-") > EPS ? "Cr2O7^2-" : m.get("MnO4-") > EPS ? "MnO4-" : null;
                if (oxidant == null || m.get(s[0]) <= EPS) continue;
                if (!"HLac".equals(s[0]) && m.tempC() < 70) continue;
                boolean cr = "Cr2O7^2-".equals(oxidant);
                double e = Math.min(m.get(s[0]) * ("starch".equals(s[0]) ? 1 : 1), m.get(oxidant) * (cr ? 3 : 2.5));
                m.take(s[0], Math.min(m.get(s[0]), e));
                m.take(oxidant, e / (cr ? 3 : 2.5));
                if (cr) m.add("Cr^3+", 2 * e / 3); else m.add("Mn^2+", e / 2.5);
                m.nextStart();
                m.reaction((cr ? "dichromate-" : "permanganate-") + s[1].replace(' ', '-'), (cr ? "Dichromate" : "Permanganate")
                        + " oxidises " + s[1], "redox", "\\text{" + s[1] + "} + [\\mathrm{O}] \\rightarrow \\text{" + s[2] + "}",
                        cr ? "dichromate-green" : "permanganate-decolourised", e);
                m.observe((cr ? "The orange colour turns green" : "The purple colour fades") + " as the hot acidified oxidant attacks the "
                        + s[1] + ".");
            }
        }
    }

    // ================================================================================== tests and organic reactions

    static void tests(MixtureOps m) {
        reducingSugar(m);
        tollens(m);
        biuret(m);
        proteins(m);
        emulsion(m);
        slime(m);
        enzymes(m);
        sucroseHydrolysis(m);
        aspirinHydrolysis(m);
        esterHydrolysis(m);
        saponification(m);
        esterification(m);
        alkaliMetalAlcohol(m);
        concentratedAcidDehydration(m);
    }

    private static List<String[]> reducers(MixtureOps m, String flag) {
        List<String[]> out = new ArrayList<>();
        for (Compound c : present(m)) if (c.has(flag)) out.add(new String[] {c.key(), lower(c.name())});
        for (String k : List.of("HCOOH", "HCOO-")) if (m.get(k) > EPS) out.add(new String[] {k, "methanoic acid"});
        if ("tollens".equals(flag)) for (String k : List.of("HAsc", "Asc-")) if (m.get(k) > EPS) out.add(new String[] {k, "vitamin C"});
        return out;
    }

    private static double take(MixtureOps m, String key, double n) {
        double t = m.take(key, n);
        if (t < n) t += m.take(key + "(s)", n - t);
        return t;
    }

    private static void reducingSugar(MixtureOps m) {
        double cu = m.get("Cu(cplx)");
        if (cu <= EPS) return;
        String test = m.present("benedicts") ? "Benedict's" : "Fehling's";
        List<String[]> reds = reducers(m, "fehling");
        if (reds.isEmpty()) {
            boolean sugar = present(m).stream().anyMatch(c -> "sugar".equals(c.family())) || m.has("starch");
            if (sugar && m.tempC() >= 60) {
                m.reason(test + " solution stays blue: there is no reducing sugar here. Sucrose and starch are non-reducing "
                        + "(sucrose gives a positive test only after it is hydrolysed by acid).");
            } else if (m.tempC() >= 60 && m.aqMl() > 0) {
                m.reason(test + " solution stays blue on heating - nothing here can reduce the copper(II) ions.");
            }
            return;
        }
        if (m.tempC() < 60) {
            m.pending("NEEDS_HEAT", "heater", test + " test needs heating: stand the tube in a hot water bath (about 80 °C) for a few minutes.");
            return;
        }
        double reduced = 0;
        String name = reds.get(0)[1];
        for (String[] r : reds) {
            double left = m.get("Cu(cplx)");
            if (left <= EPS) break;
            double e = Math.min(take(m, r[0], left / 2), left / 2);
            m.take("Cu(cplx)", 2 * e);
            reduced += 2 * e;
        }
        if (reduced <= EPS) return;
        double frac = reduced / cu;
        String[] stage = frac < 0.2 ? new String[] {"#7fae4a", "green", "a little"}
                : frac < 0.5 ? new String[] {"#e8c23a", "yellow", "some"}
                : frac < 0.85 ? new String[] {"#e07a2a", "orange", "a fair amount of"}
                : new String[] {"#b83a22", "brick-red", "plenty of"};
        long start = m.nextStart();
        Lore.register("Cu2O", "Copper(I) oxide", "#b83a22");
        ChemistryEngine.MOLAR_MASS.putIfAbsent("Cu2O", 143.1);
        m.precipitate("Cu2O", reduced / 2, stage[0], start + 800, 9000);
        m.reaction("reducing-sugar-" + (test.startsWith("B") ? "benedicts" : "fehlings"), test + " test is positive", "redox",
                Latex.eq("RCHO + 2 Cu^2+ + 5 OH^- -> RCOO^- + Cu2O(s) + 3 H2O(l)"),
                test.startsWith("B") ? "benedicts-test" : "fehlings-test", reduced / 2);
        m.observe("On heating, the blue " + test + " solution turns " + stage[1] + " as a precipitate of copper(I) oxide forms - "
                + stage[2] + " reducing sugar (" + name + ") is present.");
    }

    private static void tollens(MixtureOps m) {
        double ag = m.get("Ag(NH3)2+");
        if (ag <= EPS) return;
        List<String[]> reds = reducers(m, "tollens");
        if (reds.isEmpty()) {
            boolean ketone = present(m).stream().anyMatch(c -> "ketone".equals(c.family()));
            if (ketone) m.reason("No silver mirror: ketones can't be oxidised, so they don't reduce Tollens' reagent. Only aldehydes do.");
            else if (m.tempC() >= 50) m.reason("Tollens' reagent stays clear - there's no aldehyde (or other reducing agent) to make a silver mirror.");
            return;
        }
        if (m.tempC() < 50) {
            m.pending("NEEDS_HEAT", "heater", "Tollens' test needs gentle warming: stand the tube in a water bath at about 60 °C.");
            return;
        }
        double silver = 0;
        String name = reds.get(0)[1];
        for (String[] r : reds) {
            double left = m.get("Ag(NH3)2+");
            if (left <= EPS) break;
            double e = Math.min(take(m, r[0], left / 2), left / 2);
            m.take("Ag(NH3)2+", 2 * e);
            m.add("NH3", 4 * e);
            silver += 2 * e;
        }
        if (silver <= EPS) return;
        long start = m.nextStart();
        Map<String, Object> d = m.cue("deposit", "vessel", start);
        d.put("colour", Colour.hex("#d9dde3", 1).toJson());
        d.put("durationMs", 6000);
        d.put("form", "mirror");
        m.product("Ag", silver, "s");
        m.reaction("silver-mirror", "Tollens' silver mirror", "redox",
                Latex.eq("RCHO + 2 [Ag(NH3)2]^+ + 3 OH^- -> RCOO^- + 2 Ag(s) + 4 NH3(aq) + 2 H2O(l)"), "silver-mirror", silver / 2);
        m.observe("A shiny silver mirror coats the inside of the glass: the " + name + " reduces the silver ions to silver metal "
                + "(a positive test for an aldehyde). Rinse the reagent away straight after.");
    }

    private static void biuret(MixtureOps m) {
        double cu = m.get("Cu(biuret)");
        if (cu <= EPS) return;
        List<Compound> proteins = present(m).stream().filter(c -> "protein".equals(c.family())).toList();
        if (proteins.isEmpty()) {
            if (m.get("org:glycine") > EPS) {
                m.reason("The biuret reagent stays blue: glycine is a single amino acid, with no peptide bonds to detect.");
            } else if (m.aqMl() > 0) {
                m.reason("The biuret reagent stays blue - there's no protein here.");
            }
            return;
        }
        m.take("Cu(biuret)", cu);
        m.add("Cu(protein)", cu);
        long start = m.nextStart();
        colour(m, "#5d8ee8", "#7a3fb0", start, 1800);
        m.reaction("biuret-test", "Biuret test is positive", "complex", "\\text{peptide bonds} + \\mathrm{Cu^{2+}} \\xrightarrow{\\mathrm{OH^{-}}} "
                + "\\text{violet complex}", "biuret-test", cu);
        m.observe("The blue biuret reagent turns purple (lilac): copper(II) ions bond to the peptide links in the "
                + lower(proteins.get(0).name()) + " - a positive test for protein.");
    }

    private static void proteins(MixtureOps m) {
        for (Compound c : present(m)) {
            if (!"protein".equals(c.family())) continue;
            double n = m.get(c.key());
            String why = null;
            String discovery = "protein-denaturation";
            if ("org:albumin".equals(c.key()) && m.tempC() >= 65) {
                why = "The heat denatures the albumin: the clear egg white turns into a white solid, just like cooking an egg.";
            } else if (m.molar("H+") > 0.01 || "org:casein".equals(c.key()) && weakAcidity(m) > 0.02) {
                why = "org:casein".equals(c.key())
                        ? "The milk curdles: acid makes the casein protein clump together into white curds."
                        : "The acid denatures the protein, which separates out as a white solid.";
                if ("org:casein".equals(c.key())) discovery = "curdling";
            } else if (m.has("org:ethanol") || m.has("org:propanone") || m.has("org:propan-2-ol")) {
                why = "The solvent strips water from the protein molecules, so they unfold and come out as a white solid.";
            } else if (m.has("Cu^2+") || m.has("Pb^2+") || m.has("Ag+")) {
                why = "Heavy-metal ions bind to the protein and denature it - a white precipitate forms (this is why they are poisonous).";
            }
            if (why == null) continue;
            m.take(c.key(), n);
            long start = m.nextStart();
            String solid = "org:casein".equals(c.key()) ? "casein curds" : "denatured protein";
            Lore.register(solid, "org:casein".equals(c.key()) ? "Casein curds" : "Coagulated protein", "#f7f5ee");
            m.precipitate(solid, n, "#f7f5ee", start, 6000);
            m.reaction("protein-" + c.key().substring(4), lower(c.name()) + " coagulates", "denaturation",
                    "\\text{folded protein} \\rightarrow \\text{unfolded (denatured) protein}", discovery, n);
            m.observe(why);
        }
    }

    private static double weakAcidity(MixtureOps m) {
        double n = 0;
        for (Acids.Weak w : Acids.WEAK) if (w.reactive()) n += m.molar(w.key());
        return n;
    }

    private static void emulsion(MixtureOps m) {
        if (m.aqMl() <= 0 || !m.has("org:ethanol")) return;
        Compound lipid = present(m).stream().filter(c -> "lipid".equals(c.family())).findFirst().orElse(null);
        if (lipid == null) return;
        long start = m.nextStart();
        colour(m, "#eef6fb", "#f6f4ec", start, 1500);
        m.reaction("emulsion-test", "Emulsion test for lipids", "physical",
                "\\text{lipid in ethanol} + \\mathrm{H_{2}O} \\rightarrow \\text{milky emulsion}", "emulsion-test", m.get(lipid.key()));
        m.observe("The liquid turns cloudy white: the fat dissolved in the ethanol comes out as tiny droplets when water is added - "
                + "a positive emulsion test for lipids.");
    }

    private static void slime(MixtureOps m) {
        if (!m.has("org:pva") || !m.has("B(OH)4-")) return;
        double e = Math.min(m.get("org:pva"), m.get("B(OH)4-"));
        m.take("B(OH)4-", e * 0.5);
        long start = m.nextStart();
        colour(m, "#fbfbf8", "#e8f2f8", start, 2000);
        m.reaction("slime", "Borate cross-links PVA", "polymer", "\\text{PVA chains} + \\mathrm{B(OH)_{4}^{-}} \\rightarrow "
                + "\\text{cross-linked gel (slime)}", "slime", e);
        m.observe("The runny glue thickens into a stretchy, wobbly slime as borate ions link the long PVA chains together.");
    }

    private static void enzymes(MixtureOps m) {
        double t = m.tempC();
        if (m.has("org:yeast")) {
            List<Compound> sugars = present(m).stream().filter(c -> c.has("ferment")).toList();
            boolean lactose = m.has("org:lactose");
            if (!sugars.isEmpty()) {
                if (t >= 50) {
                    m.reason("The yeast has been killed by the heat (above about 50 °C) - no fermentation happens.");
                } else if (t < 15) {
                    m.pending("NEEDS_HEAT", "heater", "Yeast ferments sugar only very slowly when cold. Warm it to about 35 °C.");
                } else {
                    Compound s = sugars.get(0);
                    double rate = t >= 25 ? 0.3 : 0.12;
                    double e = m.get(s.key()) * rate;
                    m.take(s.key(), e);
                    int perSugar = s.c() == 12 ? 2 : 1;
                    m.add("org:ethanol", 2 * perSugar * e);
                    long start = m.nextStart();
                    m.gas("CO2", 2 * perSugar * e, "vessel", t >= 30 ? 0.35 : 0.15, "fine", start + 1500);
                    smell(m, "a warm, bready, slightly alcoholic smell", start + 3000);
                    m.reaction("fermentation", "Yeast ferments " + lower(s.name()), "fermentation",
                            Latex.eq(s.c() == 12 ? "C12H22O11 + H2O(l) -> 4 C2H5OH(aq) + 4 CO2(g)" : "C6H12O6(aq) -> 2 C2H5OH(aq) + 2 CO2(g)",
                                    "yeast"), "fermentation", e);
                    m.observe("After a while, small bubbles of carbon dioxide rise steadily and froth forms: the yeast is fermenting the "
                            + "sugar into ethanol (anaerobic respiration)" + (t < 25 ? " - slowly, because it is cool." : "."));
                }
            } else if (lactose) {
                m.reason("Baker's yeast can't ferment lactose (milk sugar), so nothing happens.");
            }
        }
        if (m.has("org:amylase") && m.has("starch")) {
            if (t >= 60) {
                m.reason("The amylase has been denatured by the heat, so it can no longer digest the starch.");
            } else {
                double e = m.get("starch");
                m.take("starch", e);
                m.add("org:maltose", e);
                m.nextStart();
                m.reaction("starch-digestion", "Amylase digests starch", "enzyme",
                        Latex.eq("(C6H10O5)n + H2O(l) -> C12H22O11(aq)", "amylase"), "starch-digestion", e);
                m.observe("The amylase breaks the starch down into maltose" + (t >= 30 && t <= 45 ? " quickly (it's near body temperature)."
                        : " - slower than at body temperature (37 °C).") + " Iodine would no longer turn blue-black.");
            }
        }
    }

    private static void sucroseHydrolysis(MixtureOps m) {
        if (!m.has("org:sucrose") || m.molar("H+") < 0.05 || m.tempC() < 70) return;
        double e = m.get("org:sucrose") * 0.6;
        m.take("org:sucrose", e);
        m.add("org:glucose", e);
        m.add("org:fructose", e);
        m.nextStart();
        m.reaction("sucrose-hydrolysis", "Acid hydrolyses sucrose", "hydrolysis",
                Latex.eq("C12H22O11(aq) + H2O(l) -> C6H12O6(aq) + C6H12O6(aq)", "H+"), "sucrose-hydrolysis", e);
        m.observe("No visible change - but the hot acid splits sucrose into glucose and fructose, which are reducing sugars "
                + "(neutralise it and it now gives a positive Benedict's test).");
    }

    private static void aspirinHydrolysis(MixtureOps m) {
        double asp = m.get("HAsp") + m.get("Asp-");
        if (asp <= EPS) return;
        boolean alkaline = m.get("OH-") > EPS;
        if (!(alkaline && m.tempC() >= 60) && m.tempC() < 85) return;
        double e = m.take("Asp-", asp);
        e += m.take("HAsp", asp - e);
        m.add("Sal-", e);
        m.add("CH3COO-", e);
        m.take("OH-", Math.min(m.get("OH-"), e));
        m.nextStart();
        m.reaction("aspirin-hydrolysis", "Aspirin is hydrolysed", "hydrolysis",
                Latex.eq("CH3COOC6H4COOH + 2 OH^- -> HOC6H4COO^- + CH3COO^- + H2O(l)"), "aspirin-hydrolysis", e);
        m.observe("The aspirin is hydrolysed into salicylate and ethanoate - add iron(III) chloride (after acidifying) and it turns violet.");
    }

    private static void esterHydrolysis(MixtureOps m) {
        for (Compound c : present(m)) {
            if (!"ester".equals(c.family())) continue;
            if (m.molar("OH-") < 0.05 && m.get("OH-") < amount(m, c)) {
                if (m.get("OH-") <= EPS) continue;
            }
            if (m.get("OH-") <= EPS) continue;
            if (m.tempC() < 50) {
                m.pending("NEEDS_HEAT", "heater", "Esters are hydrolysed by alkali only slowly in the cold. Warm to about 70 °C (reflux in a real lab).");
                continue;
            }
            double e = Math.min(amount(m, c), m.get("OH-"));
            takeCompound(m, c, e);
            m.take("OH-", e);
            Acids.Weak acid = Acids.byKey(c.esterAcid());
            if (acid != null) m.add(acid.conj(), e);
            if (c.esterAlcohol() != null) m.add(c.esterAlcohol(), e);
            m.nextStart();
            Compound alcohol = Organics.get(c.esterAlcohol());
            m.reaction("ester-hydrolysis-" + c.key().substring(4), "Alkali hydrolyses " + lower(c.name()), "hydrolysis",
                    Latex.eq(c.formula() + " + OH^- -> " + (acid == null ? "RCOO^-" : acid.acylFormula() + "^-") + " + "
                            + (alcohol == null ? "ROH" : alcohol.formula())), "ester-hydrolysis", e);
            m.observe("The fruity smell of the ester fades and the oily layer disappears as the alkali splits it into "
                    + (alcohol == null ? "an alcohol" : lower(alcohol.name())) + " and a salt.");
        }
    }

    private static void saponification(MixtureOps m) {
        List<Compound> lipids = present(m).stream().filter(c -> "lipid".equals(c.family())).toList();
        if (lipids.isEmpty() || m.get("OH-") <= EPS) return;
        if (m.tempC() < 70) {
            m.pending("NEEDS_HEAT", "heater", "Saponification (making soap) needs heat: warm the fat and alkali to about 80 °C and stir.");
            return;
        }
        for (Compound c : lipids) {
            double e = Math.min(amount(m, c), m.get("OH-") / 3);
            if (e <= EPS) continue;
            takeCompound(m, c, e);
            m.take("OH-", 3 * e);
            m.add("St-", 3 * e);
            m.add("org:glycerol", e);
            m.product("C17H35COONa", 3 * e, "aq");
            Lore.register("C17H35COONa", "Soap (sodium salt of a fatty acid)", "#f3f5f1");
            long start = m.nextStart();
            Map<String, Object> f = m.cue("precipitate", "vessel", start + 2000);
            f.put("id", "soap-froth");
            f.put("colour", Colour.hex("#fbfbf6", 0.7).toJson());
            f.put("turbidity", 0.3);
            f.put("settleMs", 9000);
            m.reaction("saponification", "Saponification: making soap", "hydrolysis",
                    Latex.eq("(C17H35COO)3C3H5 + 3 NaOH(aq) -> 3 C17H35COONa(aq) + C3H5(OH)3(aq)"), "saponification", e);
            m.observe("The oily layer gradually disappears and the mixture turns frothy and soapy: the hot alkali splits the fat into "
                    + "soap and glycerol.");
        }
    }

    private static void esterification(MixtureOps m) {
        List<Compound> alcohols = present(m).stream().filter(c -> "alcohol".equals(c.family())).toList();
        if (alcohols.isEmpty()) return;
        // Solid organic acids (benzoic, salicylic...) dissolve readily in the alcohol itself.
        for (Map.Entry<String, Phases.Soluble> en : Phases.SOLUBLE.entrySet()) {
            if (!en.getValue().acid() || !m.has(en.getKey()) || en.getKey().startsWith("KHTart")) continue;
            double n = m.take(en.getKey(), m.get(en.getKey()));
            en.getValue().ions().forEach((ion, k) -> m.add(ion, k * n));
        }
        List<Acids.Weak> acids = new ArrayList<>();
        for (Acids.Weak w : Acids.WEAK) if (w.acylate() != null && m.get(w.key()) > EPS) acids.add(w);
        if (acids.isEmpty()) return;
        boolean catalyst = m.presentTag("conc_acid");
        boolean warm = m.tempC() >= 60;
        Compound alcohol = alcohols.stream().filter(a -> !"tertiary".equals(a.cls())).findFirst().orElse(null);
        Acids.Weak acid = acids.get(0);
        if (alcohol == null) {
            m.reason(alcohols.get(0).name() + " is a tertiary alcohol: with an acid catalyst it mostly loses water to form an alkene "
                    + "rather than making an ester.");
            return;
        }
        Organics.Ester ester = Organics.esterOf(alcohol, acid);
        String pair = lower(alcohol.name()) + " and " + acid.name();
        if (!catalyst || !warm) {
            String msg = !catalyst && !warm
                    ? "No reaction yet: " + pair + " make an ester (" + lower(ester.name()) + ") only with a catalyst. Add a few drops "
                            + "of concentrated sulfuric acid and warm the mixture in a water bath (about 70 °C)."
                    : !catalyst ? "Warming alone isn't enough: " + pair + " need a few drops of concentrated sulfuric acid as a catalyst "
                            + "to make " + lower(ester.name()) + " (dilute acid won't do)."
                    : "The catalyst is in - now warm the mixture in a water bath to about 70 °C for a few minutes to make "
                            + lower(ester.name()) + ".";
            m.pending(!catalyst ? "NEEDS_CATALYST" : "NEEDS_HEAT",
                    !catalyst ? "catalyst" : "heater", msg, !catalyst ? "h2so4-conc" : null);
            return;
        }
        double alcOh = m.get(alcohol.key()) * alcohol.ohCount();
        double acidGroups = m.get(acid.key());
        double water = m.aqMl() / 18.0;
        double k = 4;
        double b = water + k * (alcOh + acidGroups);
        double x = (b - Math.sqrt(Math.max(0, b * b - 4 * (k - 1) * k * alcOh * acidGroups))) / (2 * (k - 1));
        x = Math.max(0, Math.min(x, Math.min(alcOh, acidGroups)));
        if (x <= EPS) return;
        m.take(alcohol.key(), x / alcohol.ohCount());
        m.take(acid.key(), x);
        m.add(ester.key(), x);
        Lore.register(ester.formula(), ester.name(), "#f6f2d8");
        m.product(ester.formula(), x / Math.max(alcohol.ohCount(), acid.perAnion()), "l");
        m.product("H2O", x, "l");
        long start = m.nextStart();
        smell(m, "a sweet, fruity smell of " + ester.smell(), start + 2500);
        Map<String, Object> cd = m.cue("condense", "vessel", start + 800);
        cd.put("colour", Colour.hex("#e8f2f8", 0.6).toJson());
        cd.put("amount", 0.4);
        cd.put("durationMs", 5000);
        String acidFormula = acid.formula();
        String eq;
        if (alcohol.ohCount() > 1) {
            eq = Latex.eq(alcohol.formula() + " + " + alcohol.ohCount() + " " + acidFormula + " -> " + ester.formula() + " + "
                    + alcohol.ohCount() + " H2O(l)", "conc. H2SO4");
        } else if (acid.perAnion() > 1) {
            eq = Latex.eq(acid.perAnion() + " " + alcohol.formula() + " + " + acidFormula + " -> " + ester.formula() + " + "
                    + acid.perAnion() + " H2O(l)", "conc. H2SO4");
        } else {
            eq = Latex.eq(alcohol.formula() + " + " + acidFormula + " -> " + ester.formula() + " + H2O(l)", "conc. H2SO4");
        }
        String discovery = ester.key().equals("org:3-methylbutyl-ethanoate") || ester.key().equals("org:pentyl-ethanoate") ? "banana-ester"
                : ester.key().equals("org:methyl-salicylate") ? "wintergreen-ester" : "esterification";
        m.reaction("esterification-" + ester.key().substring(4).replace(':', '-'), "Making " + lower(ester.name()), "esterification", eq,
                discovery, x);
        m.observe("After a few minutes in the hot water bath a sweet, fruity smell appears - " + ester.smell() + ": the ester "
                + lower(ester.name()) + " has formed.");
        m.observe("Esterification is reversible and slow, so only part of the acid and alcohol react; the concentrated sulfuric acid "
                + "is a catalyst. Pour the mixture into sodium carbonate solution and the ester floats as oily drops.");
    }

    private static void alkaliMetalAlcohol(MixtureOps m) {
        if (m.aqMl() > 0) return;
        for (Portion p : m.portions()) {
            Substance s = p.substance();
            if (!s.isElement() || !"alkali".equals(s.element().category())) continue;
            String key = s.species().keySet().iterator().next();
            if (!m.has(key)) continue;
            Compound alcohol = present(m).stream().filter(c -> "alcohol".equals(c.family())).findFirst().orElse(null);
            if (alcohol == null) {
                if (present(m).stream().anyMatch(c -> List.of("alkane", "lipid").contains(c.family()))) {
                    m.reason(s.name() + " doesn't react with oils or alkanes - that's exactly why it is stored under oil.");
                }
                continue;
            }
            double e = Math.min(m.get(key), m.get(alcohol.key()));
            m.take(key, e);
            m.take(alcohol.key(), e);
            String sym = s.element().symbol();
            String alkoxide = sym + "O" + (alcohol.alkylFormula() == null ? "R" : alcohol.alkylFormula());
            m.heat(150_000 * e);
            long start = m.nextStart();
            m.gas("H2", e / 2, m.solidTarget(key) == null ? "vessel" : m.solidTarget(key), "Li".equals(sym) ? 0.3 : 0.8, "fine", start);
            m.dissolveSolid(key, start, 8000);
            Lore.register(alkoxide, Elements.NAME.getOrDefault(sym, sym) + " " + (alcohol.alkyl() == null ? "alkoxide"
                    : alkoxide(alcohol.alkyl())), null);
            m.reaction("metal-alcohol-" + sym.toLowerCase(Locale.ROOT), s.name() + " reacts with " + lower(alcohol.name()), "gas",
                    Latex.eq("2 " + sym + "(s) + 2 " + alcohol.formula() + "(l) -> 2 " + alkoxide + " + H2(g)"), "metal-alcohol", e);
            m.observe(s.name() + " fizzes steadily in the " + lower(alcohol.name()) + " - much more gently than in water - giving off "
                    + "hydrogen and forming " + Lore.name(alkoxide).toLowerCase(Locale.ROOT) + ".");
        }
    }

    private static String alkoxide(String alkyl) {
        String base = alkyl.replaceAll(" .*", "");
        return (base.endsWith("yl") ? base.substring(0, base.length() - 2) : base) + "oxide";
    }

    private static void concentratedAcidDehydration(MixtureOps m) {
        double acid = m.get("H2SO4(conc)");
        if (acid <= EPS) return;
        for (String key : List.of("org:sucrose", "org:glucose", "starch(s)")) {
            if (!m.has(key) || m.solidTarget(key) == null) continue;
            double n = m.take(key, m.get(key));
            m.take("H2SO4(conc)", Math.min(m.get("H2SO4(conc)"), n * 0.2));
            m.heat(200_000 * n);
            long start = m.nextStart();
            String target = m.solidTarget(key);
            Map<String, Object> c = m.cue("colour", target, start);
            c.put("from", Colour.hex("#fbfbf8", 1).toJson());
            c.put("to", Colour.hex("#141210", 1).toJson());
            c.put("durationMs", 5000);
            c.put("curve", "sigmoid");
            Map<String, Object> s = m.cue("smoke", "vessel", start + 2000);
            s.put("colour", Colour.hex("#e8e8e8", 0.6).toJson());
            s.put("density", 0.6);
            s.put("durationMs", 6000);
            s.put("label", "Steam and choking fumes from the charring sugar");
            m.gas("SO2", n * 0.2, "vessel", 0.3, "fine", start + 2500);
            m.product("C", n * 6, "s");
            m.reaction("carbon-snake", "Concentrated sulfuric acid dehydrates sugar", "dehydration",
                    "starch(s)".equals(key) ? Latex.eq("(C6H10O5)n -> 6n C(s) + 5n H2O(g)", "conc. H2SO4")
                            : "org:glucose".equals(key) ? Latex.eq("C6H12O6(s) -> 6 C(s) + 6 H2O(g)", "conc. H2SO4")
                            : Latex.eq("C12H22O11(s) -> 12 C(s) + 11 H2O(g)", "conc. H2SO4"),
                    "dehydration", n);
            m.observe("The white sugar turns yellow, brown, then black, swelling into a steaming column of porous carbon - the "
                    + "acid pulls the water out of the sugar. It gets very hot and gives off choking fumes: a fume-cupboard demonstration.");
        }
        if (m.get("H2SO4(conc)") > EPS && present(m).stream().anyMatch(c -> "alcohol".equals(c.family()))) {
            boolean acidPresent = Acids.WEAK.stream().anyMatch(w -> w.acylate() != null && m.get(w.key()) > EPS);
            if (!acidPresent) {
                m.reason("Concentrated sulfuric acid only turns an alcohol into an alkene when heated to about 170 °C - far hotter than "
                        + "the water bath. Add a carboxylic acid and warm it to make an ester instead.");
            }
        }
    }

    // ================================================================================== combustion

    /** True when a flame applied now would set something burning. */
    static boolean burnable(MixtureOps m) {
        if (!m.ignition()) return false;
        for (Portion p : m.portions()) if (burns(m, p) == null) return true;
        return false;
    }

    /** Null when this portion catches fire; otherwise the reason it doesn't. */
    private static String burns(MixtureOps m, Portion p) {
        Substance s = p.substance();
        // Candle wax is the one solid fuel here: the flame melts it and burns the vapour, as a wick does.
        boolean wax = s.isSolid() && s.species().containsKey("org:wax");
        if (!s.hasTag("fuel") || !wax && (s.flashPointC() == null || s.isSolid())) return "n/a";
        String key = s.species().keySet().iterator().next();
        Compound c = Organics.get(key);
        if (c == null || c.c() == 0 || m.get(key) <= EPS) return "n/a";
        if (s.isGas()) return null;
        if (wax) return m.aqMl() > 0 ? "The wax is floating on water, which keeps it too cool to catch light." : null;
        if (m.tempC() < s.flashPointC() - 3) {
            return s.name() + " won't catch light at " + Math.round(m.tempC()) + " °C: its flash point is about "
                    + Math.round(s.flashPointC()) + " °C, so not enough vapour forms above it for a flame to ignite.";
        }
        String mix = s.waterMiscibility();
        double total = m.aqMl() + m.organicMl();
        double mine = "drops".equals(s.limits().unit()) ? p.amount() * 0.05 : p.amount();
        if (m.aqMl() > 0 && ("miscible".equals(mix) || "polar".equals(mix) || "aqueous".equals(mix)) && mine / total < 0.4) {
            return "There's too much water mixed in for the " + lower(s.name()) + " to burn.";
        }
        return null;
    }

    static void combustion(MixtureOps m) {
        if (!m.ignition()) return;
        boolean oxygen = m.get("O2(g)") > EPS;
        for (Portion p : m.portions()) {
            String why = burns(m, p);
            if (why != null) {
                if (!"n/a".equals(why)) m.reason(why);
                continue;
            }
            Substance s = p.substance();
            String key = s.species().keySet().iterator().next();
            Compound c = Organics.get(key);
            double n = m.get(key);
            if (n <= EPS) continue;
            int x = c.c(), h = c.h(), o = c.o();
            int o2Quarter = 4 * x + h - 2 * o; // O2 needed, in quarters
            int mult = 1;
            while ((mult * o2Quarter) % 4 != 0 || (mult * h) % 2 != 0) mult *= 2;
            int fuel = mult, ox = mult * o2Quarter / 4, co2 = mult * x, water = mult * h / 2;
            double burned = s.isGas() ? n : Math.min(n, 0.08); // a beaker fire burns a few mL before you put it out
            m.take(key, burned);
            double o2mol = burned * o2Quarter / 4.0;
            if (oxygen) m.take("O2(g)", Math.min(m.get("O2(g)"), o2mol));
            m.heat(440_000 * o2mol * (s.isGas() ? 0.3 : 0.15));
            m.product("CO2", burned * x, "g");
            m.product("H2O", burned * h / 2.0, "g");
            long start = m.nextStart();
            boolean sooty = c.has("sooty");
            boolean methanol = "org:methanol".equals(key);
            boolean blue = methanol || "alcohol".equals(c.family()) || "org:methane".equals(key) || "org:butane".equals(key)
                    || "ketone".equals(c.family());
            String hex = methanol ? "#9ec8ff" : sooty ? "#ff9a2a" : blue ? "#5f9cff" : "#ffcf6a";
            Map<String, Object> f = m.cue("flame", "vessel", start);
            f.put("colour", Colour.hex(hex, 1).toJson());
            f.put("intensity", methanol ? 0.35 : oxygen ? 1.0 : s.isGas() ? 0.8 : 0.7);
            f.put("durationMs", s.isGas() ? 2500 : 6000);
            if (sooty) {
                Map<String, Object> sm = m.cue("smoke", "vessel", start + 400);
                sm.put("colour", Colour.hex("#1a1a1a", 0.7).toJson());
                sm.put("density", 0.6);
                sm.put("durationMs", 6000);
                sm.put("label", "Black sooty smoke (unburnt carbon)");
            }
            Map<String, Object> cd = m.cue("condense", "vessel", start + 800);
            cd.put("colour", Colour.hex("#d6eeff", 0.7).toJson());
            cd.put("amount", 0.5);
            cd.put("durationMs", 4000);
            m.cue("sound", "vessel", start).put("soundId", s.isGas() && oxygen ? "bang" : "whoosh");
            String formula = "org:oil".equals(key) ? "C57H104O6" : "C" + (x > 1 ? x : "") + "H" + h + (o > 0 ? "O" + (o > 1 ? o : "") : "");
            m.reaction("combustion-" + key.substring(4), lower(c.name()) + " burns", "combustion",
                    Latex.eq((fuel > 1 ? fuel + " " : "") + formula + " + " + ox + " O2(g) -> " + co2 + " CO2(g) + " + water + " H2O(l)"),
                    "combustion", burned);
            m.observe("org:wax".equals(key)
                    ? "The wax melts, its hot vapour catches light and it burns with a steady yellow flame - a candle without a wick. "
                            + "A wisp of black soot shows that not all of the carbon gets enough oxygen to burn."
                    : methanol ? "Methanol burns with an almost invisible pale blue flame - dangerous, because you can hardly see it."
                    : sooty ? "It burns with a smoky yellow-orange flame, giving off black soot: there isn't enough oxygen to burn all the carbon."
                    : blue ? lower(c.name()).substring(0, 1).toUpperCase(Locale.ROOT) + lower(c.name()).substring(1)
                            + " burns with a clean blue flame, making carbon dioxide and water."
                    : "It burns with a bright yellow flame, making carbon dioxide and water vapour.");
            if (s.isGas() && oxygen) m.observe("Mixed with pure oxygen the gas explodes with a bang rather than burning quietly.");
            m.observe("Water droplets form on the cool glass above - one of the products of combustion.");
        }
    }
}
