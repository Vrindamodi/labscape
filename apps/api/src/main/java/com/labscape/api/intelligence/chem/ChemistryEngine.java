package com.labscape.api.intelligence.chem;

import com.labscape.api.intelligence.chem.Latex.Term;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Rule-based school chemistry engine for allowlisted substances.
 *
 * <p>Whole-mixture model: every portion is converted to moles of species, then reaction rules
 * run in a fixed order (acid-base, carbonates, metals, oxides, redox, displacement, precipitation,
 * complexes, indicators), each consuming its limiting reagent. The engine decides WHAT happens and
 * emits observation cues; animation layers decide how it looks (contract 3).
 *
 * <p>Fidelity is "approximate": stoichiometry and solubility rules are exact; rates, colours and
 * pH are school-level models. Interim implementation owned by Part 4 Day 1 behind the
 * {@code ReactionResolver} seam - Part 2's chemistry engine replaces it.
 */
@Component
public class ChemistryEngine {

    static final double EPS = 1e-9;
    private static final double RTP_ML_PER_MOL = 24000.0;

    private final Catalogue catalogue;

    public ChemistryEngine(Catalogue catalogue) {
        this.catalogue = catalogue;
    }

    public enum Kind { REACTION, NO_REACTION, NEEDS_CONDITIONS, PROCEDURE_MISMATCH, UNSUPPORTED }

    public record Portion(Substance substance, double amount) {}

    public record Pending(String code, String tool, String message) {}

    public record Mismatch(String code, String message) {}

    public record Reaction(String id, String name, String type, String equationLatex, String discoveryId, double extentMol) {}

    public record Product(String formula, double mol, String phase) {}

    public record Measurement(String key, double value, String unit) {}

    public record Result(
            Kind kind,
            String reasonCode,
            List<Reaction> reactions,
            List<Map<String, Object>> cues,
            List<String> observations,
            List<Pending> pending,
            List<Mismatch> mismatches,
            List<String> reasons,
            List<Product> products,
            List<Measurement> measurements,
            String unsupportedMessage) {

        public List<Reaction> chemical() {
            return reactions.stream().filter(r -> !"physical".equals(r.type())).toList();
        }
    }

    public Result run(List<Portion> portions, double temperatureC) {
        return new Run(merge(portions), temperatureC).execute();
    }

    private static List<Portion> merge(List<Portion> portions) {
        Map<String, Portion> merged = new LinkedHashMap<>();
        for (Portion p : portions) {
            merged.merge(p.substance().id(), p, (x, y) -> new Portion(x.substance(), x.amount() + y.amount()));
        }
        return new ArrayList<>(merged.values());
    }

    // ------------------------------------------------------------------------------------------

    private final class Run {
        final List<Portion> portions;
        final double tempC;
        final double tf;
        final Map<String, Double> mol = new LinkedHashMap<>();
        final Map<String, String> solidTarget = new LinkedHashMap<>();
        final Map<String, Double> solidInitial = new LinkedHashMap<>();
        double aqMl;
        double organicMl;
        double heatJ;
        double basicFloor = 0;
        long clockDelayMs = 0;
        boolean starchComplex = false;
        boolean hadAcid;
        boolean hadBase;

        final List<Reaction> reactions = new ArrayList<>();
        final List<Map<String, Object>> cues = new ArrayList<>();
        final List<String> observations = new ArrayList<>();
        final List<Pending> pending = new ArrayList<>();
        final List<Mismatch> mismatches = new ArrayList<>();
        final List<String> reasons = new ArrayList<>();
        final Map<String, Product> products = new LinkedHashMap<>();
        final Map<String, Double> gases = new LinkedHashMap<>();
        final Map<String, Double> precipitates = new LinkedHashMap<>();
        final Map<String, Double> pptFormed = new LinkedHashMap<>();
        int reactionIndex = 0;

        Run(List<Portion> portions, double tempC) {
            this.portions = portions;
            this.tempC = tempC;
            this.tf = Math.pow(2.0, (tempC - 25.0) / 10.0);
            for (Portion p : portions) {
                Substance s = p.substance();
                if (s.acid() != null) hadAcid = true;
                if (s.base() != null || s.carbonate() != null && !s.isSolid()) hadBase = true;
                if (s.isSolid()) {
                    double n = p.amount() / s.molarMass();
                    s.species().forEach((k, coef) -> {
                        add(k, coef * n);
                        solidTarget.put(k, "solid:" + s.id());
                        solidInitial.merge(k, coef * n, Double::sum);
                    });
                    continue;
                }
                double ml = volumeMl(p);
                if (s.aqueous()) aqMl += ml; else organicMl += ml;
                s.species().forEach((k, molarity) -> add(k, molarity * ml / 1000.0));
            }
        }

        // ---------------------------------------------------------------- bookkeeping

        double get(String k) { return mol.getOrDefault(k, 0.0); }
        boolean has(String k) { return get(k) > EPS; }
        void add(String k, double v) { mol.merge(k, v, Double::sum); }
        double take(String k, double v) {
            double cur = get(k);
            double t = Math.max(0, Math.min(cur, v));
            mol.put(k, cur - t);
            return t;
        }
        double molar(String k) { return aqMl <= 0 ? 0 : get(k) / (aqMl / 1000.0); }
        double litres() { return Math.max(aqMl, 1e-6) / 1000.0; }

        boolean present(String substanceId) {
            return portions.stream().anyMatch(p -> p.substance().id().equals(substanceId));
        }

        void product(String formula, double n, String phase) {
            products.merge(formula, new Product(formula, n, phase),
                    (a, b) -> new Product(a.formula(), a.mol() + b.mol(), a.phase()));
        }

        long nextStart() {
            return Math.min(1500, 220L * reactionIndex++);
        }

        void reaction(String id, String name, String type, String eq, String discovery, double extent) {
            reactions.add(new Reaction(id, name, type, eq, discovery, extent));
        }

        Map<String, Object> cue(String kind, String target, long startMs) {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("kind", kind);
            c.put("target", target);
            c.put("startMs", startMs);
            cues.add(c);
            return c;
        }

        void gas(String gas, double n, String target, double k, String bubble, long startMs) {
            gases.merge(gas, n, Double::sum);
            product(gas, n, "g");
            double rate = clamp(Math.sqrt(n * 1e4) * 14 * k * tf, 4, 140);
            long duration = (long) clamp(9000 / Math.max(0.05, k * tf), 2200, 14000);
            Map<String, Object> c = cue("gas", target, startMs);
            c.put("ratePerS", round(rate, 1));
            c.put("bubble", bubble);
            c.put("gas", gas);
            c.put("durationMs", duration);
        }

        void precipitate(String formula, double n, String hex, long startMs, long settleMs) {
            precipitates.merge(formula, n, Double::sum);
            pptFormed.merge(formula, n, Double::sum);
            product(formula, n, "s");
            double turbidity = clamp(n / litres() * 30, 0.12, 0.92);
            Map<String, Object> c = cue("precipitate", "vessel", startMs);
            c.put("id", formula);
            c.put("colour", Colour.hex(hex, 0.95).toJson());
            c.put("turbidity", round(turbidity, 3));
            c.put("settleMs", settleMs);
        }

        void dissolveSolid(String speciesKey, double startMs, long durationMs) {
            String target = solidTarget.get(speciesKey);
            if (target == null) return;
            double initial = solidInitial.getOrDefault(speciesKey, 0.0);
            double left = get(speciesKey);
            double fraction = initial <= 0 ? 1 : clamp(1 - left / initial, 0, 1);
            Map<String, Object> c = cue("dissolve", target, (long) startMs);
            c.put("durationMs", durationMs);
            c.put("fraction", round(fraction, 3));
        }

        /** Takes protons from strong acid first, then ethanoic acid. Returns {strong, weak}. */
        double[] consumeAcid(double protons) {
            double strong = take("H+", protons);
            double weak = take("CH3COOH", protons - strong);
            if (weak > 0) add("CH3COO-", weak);
            return new double[] {strong, weak};
        }

        double acidAvailable() { return get("H+") + get("CH3COOH"); }

        Portion mainPortion(java.util.function.Predicate<Substance> filter) {
            return portions.stream()
                    .filter(p -> filter.test(p.substance()))
                    .max(Comparator.comparingDouble(p -> p.amount()))
                    .orElse(null);
        }

        Substance mainAcid() {
            Portion p = mainPortion(s -> s.acid() != null);
            return p == null ? null : p.substance();
        }

        // ---------------------------------------------------------------- run

        Result execute() {
            String gap = coverage();
            if (gap != null) {
                return new Result(Kind.UNSUPPORTED, "NOT_MODELLED", List.of(), List.of(), List.of(), List.of(),
                        List.of(), List.of(), List.of(), List.of(), gap);
            }
            Colour startColour = startColour();

            physical();
            hydration();
            neutralise();
            carbonates();
            metalsWithAcid();
            oxideWithAcid();
            thiosulfateWithAcid();
            permanganate();
            peroxide();
            iron3();
            copperIodide();
            iodine();
            displacement();
            precipitation();
            magnesiumWater();
            starchIodine();

            // Ammonium + hydroxide re-form ammonia (keeps ammonia mixtures at a realistic pH ~ 9-11).
            double nh = Math.min(get("NH4+"), get("OH-"));
            if (nh > EPS) {
                take("NH4+", nh);
                take("OH-", nh);
                add("NH3", nh);
            }

            double ph = ph();
            indicators(ph);
            return finish(startColour, ph);
        }

        String coverage() {
            for (int i = 0; i < portions.size(); i++) {
                for (int j = i + 1; j < portions.size(); j++) {
                    Substance a = portions.get(i).substance();
                    Substance b = portions.get(j).substance();
                    boolean gap = catalogue.isGap(a.id(), b.id())
                            || a.isLimited() && !a.coversPair(b)
                            || b.isLimited() && !b.coversPair(a);
                    if (gap) {
                        return "LABscape has no validated model for " + a.displayName() + " with " + b.displayName() + ".";
                    }
                }
            }
            return null;
        }

        Colour startColour() {
            List<Colour> cs = new ArrayList<>();
            List<Double> ws = new ArrayList<>();
            for (Portion p : portions) {
                Substance s = p.substance();
                if (s.isSolid() || "vegetable-oil".equals(s.id())) continue;
                double ml = volumeMl(p);
                cs.add(Colour.hex(s.colour(), s.opacity()));
                ws.add(ml * (0.15 + s.opacity()));
            }
            return cs.isEmpty() ? null : Colour.blend(cs, ws);
        }

        // ---------------------------------------------------------------- physical changes

        void physical() {
            if (aqMl > 0 && has("CuSO4·5H2O(s)")) {
                double n = take("CuSO4·5H2O(s)", get("CuSO4·5H2O(s)"));
                add("Cu^2+", n);
                add("SO4^2-", n);
                dissolveSolid("CuSO4·5H2O(s)", 0, 2600);
                reaction("dissolve-copper-sulfate", "Copper sulfate dissolves", "physical",
                        Latex.equation(List.of(Term.of(1, "CuSO4·5H2O", "s")),
                                List.of(Term.ion(1, "Cu", "2+"), Term.ion(1, "SO4", "2-"), Term.of(5, "H2O", "l")), null),
                        null, n);
                observations.add("The blue crystals dissolve and colour the water blue - a physical change.");
            }
            if (aqMl > 0 && has("KMnO4(s)")) {
                double n = take("KMnO4(s)", get("KMnO4(s)"));
                add("K+", n);
                add("MnO4-", n);
                dissolveSolid("KMnO4(s)", 0, 3200);
                reaction("dissolve-permanganate", "Permanganate dissolves", "physical",
                        Latex.equation(List.of(Term.of(1, "KMnO4", "s")),
                                List.of(Term.ion(1, "K", "+"), Term.ion(1, "MnO4", "-")), null),
                        "permanganate-dissolving", n);
                observations.add("Purple streaks spread out from the crystals as they dissolve - diffusion in action.");
            }
            if (present("vegetable-oil") && (aqMl > 0 || organicMl > 0)) {
                double oilMl = portions.stream().filter(p -> p.substance().id().equals("vegetable-oil"))
                        .mapToDouble(this::volumeMlOf).sum();
                if (aqMl > 0 || organicMl - oilMl > 0) {
                    Map<String, Object> c = cue("layers", "vessel", 0);
                    c.put("colour", Colour.hex("#e9c84b", 0.6).toJson());
                    c.put("volumeMl", round(oilMl, 1));
                    reasons.add("Oil is non-polar, so it doesn't mix with water - it floats as a separate layer.");
                }
            }
            if (present("ethanol") && aqMl > 0) {
                reasons.add("Ethanol mixes completely with water, but no chemical reaction happens.");
            }
            if (aqMl <= 0 && organicMl <= 0 && portions.size() > 1) {
                reasons.add("Dry solids don't react - their particles can't move around and collide. Add water.");
            }
        }

        void hydration() {
            if (!has("CuSO4(anh)")) return;
            if (aqMl <= 0) {
                if (present("ethanol")) {
                    reasons.add("Ethanol contains no water, so anhydrous copper sulfate stays white.");
                }
                return;
            }
            double n = take("CuSO4(anh)", get("CuSO4(anh)"));
            add("Cu^2+", n);
            add("SO4^2-", n);
            heatJ += 66_000 * n;
            String target = solidTarget.get("CuSO4(anh)");
            Map<String, Object> c = cue("colour", target, 0);
            c.put("from", Colour.hex("#eef0ee", 1).toJson());
            c.put("to", Colour.hex("#2f86dc", 1).toJson());
            c.put("durationMs", 1100);
            c.put("curve", "sigmoid");
            dissolveSolid("CuSO4(anh)", 1300, 2400);
            reaction("hydration-copper-sulfate", "Hydrating copper sulfate", "hydration",
                    Latex.equation(List.of(Term.of(1, "CuSO4", "s"), Term.of(5, "H2O", "l")),
                            List.of(Term.of(1, "CuSO4·5H2O", "s")), null),
                    "water-test", n);
            product("CuSO4·5H2O", n, "s");
            observations.add("The white powder turns blue and the mixture warms - this is the chemical test for water.");
        }

        // ---------------------------------------------------------------- acids and bases

        void neutralise() {
            double total = 0;
            double e1 = Math.min(get("H+"), get("OH-"));
            take("H+", e1);
            take("OH-", e1);
            heatJ += 57_100 * e1;
            total += e1;

            double e2 = Math.min(get("CH3COOH"), get("OH-"));
            take("CH3COOH", e2);
            take("OH-", e2);
            add("CH3COO-", e2);
            heatJ += 56_000 * e2;
            total += e2;

            double e3 = Math.min(get("NH3"), get("H+"));
            take("NH3", e3);
            take("H+", e3);
            add("NH4+", e3);
            heatJ += 52_000 * e3;
            total += e3;

            double e4 = Math.min(get("NH3"), get("CH3COOH"));
            take("NH3", e4);
            take("CH3COOH", e4);
            add("NH4+", e4);
            add("CH3COO-", e4);
            heatJ += 50_000 * e4;
            total += e4;

            if (total > EPS) {
                product("H2O", e1 + e2, "l");
                Substance acid = mainAcid();
                Portion baseP = mainPortion(s -> s.base() != null);
                Substance base = baseP == null ? null : baseP.substance();
                boolean ammonia = base != null && base.base().ammonia();
                String eq = acid != null && base != null ? neutralisationEquation(acid, base)
                        : Latex.equation(List.of(Term.ion(1, "H", "+"), Term.ion(1, "OH", "-")),
                                List.of(Term.of(1, "H2O", "l")), null);
                reaction(ammonia ? "neutralisation-ammonia" : "neutralisation",
                        ammonia ? "Neutralisation with ammonia" : "Neutralisation", "neutralisation", eq,
                        ammonia ? "neutralisation-ammonia" : "neutralisation", total);
                observations.add(ammonia
                        ? "The ammonia neutralises the acid, forming an ammonium salt."
                        : "The acid and alkali cancel each other out to make a salt and water, and the mixture warms up.");
                nextStart();
            }

            double e5 = Math.min(get("HCO3-"), get("OH-"));
            if (e5 > EPS) {
                take("HCO3-", e5);
                take("OH-", e5);
                add("CO3^2-", e5);
                heatJ += 41_000 * e5;
                reaction("hydrogencarbonate-hydroxide", "Hydrogencarbonate meets hydroxide", "neutralisation",
                        Latex.equation(List.of(Term.ion(1, "HCO3", "-"), Term.ion(1, "OH", "-")),
                                List.of(Term.ion(1, "CO3", "2-"), Term.of(1, "H2O", "l")), null),
                        null, e5);
            }
        }

        String neutralisationEquation(Substance acid, Substance base) {
            Substance.AcidInfo a = acid.acid();
            Substance.BaseInfo b = base.base();
            if (b.ammonia()) {
                Latex.Salt salt = Latex.salt("NH4", 1, true, a.anion(), a.anionCharge(), a.poly());
                return Latex.equation(
                        List.of(Term.of(1, acid.formula(), "aq"), Term.of(a.protons(), "NH3", "aq")),
                        List.of(Term.of(1, salt.formula(), "aq")), null);
            }
            int n = a.protons();
            int m = b.hydroxides();
            int lcm = Latex.lcm(n, m);
            Latex.Salt salt = Latex.salt(b.cation(), b.cationCharge(), false, a.anion(), a.anionCharge(), a.poly());
            String saltState = "Ca".equals(b.cation()) && "SO4".equals(a.anion()) ? "s" : "aq";
            return Latex.equation(
                    List.of(Term.of(lcm / n, acid.formula(), "aq"), Term.of(lcm / m, base.formula(), "aq")),
                    List.of(Term.of(1, salt.formula(), saltState), Term.of(lcm, "H2O", "l")), null);
        }

        String carbonateEquation(Substance acid, Substance carb) {
            Substance.AcidInfo a = acid.acid();
            Substance.CarbonateInfo c = carb.carbonate();
            int n = a.protons();
            int p = c.unitProtons();
            int s = n / Latex.gcd(p, n);
            int acidCoef = s * p / n;
            Latex.Salt salt = Latex.salt(c.cation(), c.cationCharge(), false, a.anion(), a.anionCharge(), a.poly());
            int cationTotal = s * c.cationCount();
            if (cationTotal % salt.cations() != 0) {
                return Latex.equation(List.of(Term.ion(2, "H", "+"), Term.ion(1, "CO3", "2-")),
                        List.of(Term.of(1, "H2O", "l"), Term.of(1, "CO2", "g")), null);
            }
            int saltCoef = cationTotal / salt.cations();
            String carbState = carb.isSolid() ? "s" : "aq";
            String saltState = "Ca".equals(c.cation()) && "SO4".equals(a.anion()) ? "s" : "aq";
            return Latex.equation(
                    List.of(Term.of(s, carb.formula(), carbState), Term.of(acidCoef, acid.formula(), "aq")),
                    List.of(Term.of(saltCoef, salt.formula(), saltState), Term.of(s, "H2O", "l"), Term.of(s, "CO2", "g")),
                    null);
        }

        void carbonates() {
            Substance acid = mainAcid();
            // Aqueous carbonate: first acid only converts CO3 to HCO3 (no fizz yet).
            double strongStart = get("H+");
            double weakStart = get("CH3COOH");
            double a1 = Math.min(get("CO3^2-"), acidAvailable());
            if (a1 > EPS) {
                take("CO3^2-", a1);
                consumeAcid(a1);
                add("HCO3-", a1);
                heatJ += 15_000 * a1;
            }
            double b1 = Math.min(get("HCO3-"), acidAvailable());
            double[] took = new double[] {0, 0};
            if (b1 > EPS) {
                take("HCO3-", b1);
                took = consumeAcid(b1);
                heatJ -= 12_000 * b1;
                product("H2O", b1, "l");
            }
            if (a1 + b1 > EPS) {
                Portion carbP = mainPortion(s -> s.carbonate() != null && !s.isSolid());
                Substance carb = carbP == null ? null : carbP.substance();
                boolean hydrogen = carb != null && carb.carbonate().unitProtons() == 1;
                String eq = acid != null && carb != null ? carbonateEquation(acid, carb)
                        : Latex.equation(List.of(Term.ion(1, "HCO3", "-"), Term.ion(1, "H", "+")),
                                List.of(Term.of(1, "H2O", "l"), Term.of(1, "CO2", "g")), null);
                long start = nextStart();
                if (b1 > EPS) {
                    double k = (took[0] > took[1] ? 2.5 : 0.8);
                    gas("CO2", b1, "vessel", k, "medium", start);
                    observations.add(hydrogen
                            ? "It fizzes as carbon dioxide escapes - and the mixture gets colder: this reaction takes in heat."
                            : "Bubbles of carbon dioxide fizz up through the liquid.");
                } else {
                    observations.add("No fizzing yet: the small amount of acid only turned carbonate into hydrogencarbonate. Add more acid.");
                }
                reaction(hydrogen ? "acid-hydrogencarbonate" : "acid-carbonate",
                        hydrogen ? "Acid and hydrogencarbonate" : "Acid and carbonate", "gas", eq,
                        hydrogen ? "acid-hydrogencarbonate" : "acid-carbonate", a1 + b1);
            }

            // Solid carbonate (marble chips)
            if (has("CaCO3(s)") && acidAvailable() > EPS) {
                double chips = get("CaCO3(s)");
                double e = Math.min(chips, acidAvailable() / 2);
                boolean sulfuric = acid != null && "SO4".equals(acid.acid().anion());
                if (sulfuric) e = Math.min(e, chips * 0.15);
                take("CaCO3(s)", e);
                double[] t = consumeAcid(2 * e);
                add("Ca^2+", e);
                heatJ += 15_000 * e;
                product("H2O", e, "l");
                long start = nextStart();
                double k = (t[0] >= t[1] ? 1.6 : 0.5) * (sulfuric ? 0.35 : 1);
                gas("CO2", e, solidTarget.get("CaCO3(s)"), k, "coarse", start);
                dissolveSolid("CaCO3(s)", start, (long) clamp(8000 / tf, 3000, 14000));
                Substance chipsS = catalogue.find("caco3-chips").orElseThrow();
                reaction("acid-carbonate-chips", "Acid and marble chips", "gas",
                        acid != null ? carbonateEquation(acid, chipsS) : "", "acid-carbonate", e);
                observations.add(sulfuric
                        ? "The chips fizz at first, then almost stop: insoluble calcium sulfate coats them and blocks the acid."
                        : "The marble chips fizz steadily, releasing carbon dioxide, and slowly get smaller.");
            }
            if (strongStart + weakStart <= EPS && has("CaCO3(s)") && aqMl > 0) {
                reasons.add("Calcium carbonate is insoluble in water - it needs an acid to react.");
            }
        }

        // ---------------------------------------------------------------- metals and oxides

        void metalsWithAcid() {
            Substance acid = mainAcid();
            List<Portion> metals = portions.stream().filter(p -> p.substance().metal() != null)
                    .sorted(Comparator.comparingInt((Portion p) -> -p.substance().metal().rank())).toList();
            for (Portion p : metals) {
                Substance s = p.substance();
                Substance.MetalInfo m = s.metal();
                String key = m.symbol() + "(s)";
                if (m.acidRate() <= 0) {
                    if (hadAcid) {
                        reasons.add(s.name() + ": copper sits below hydrogen in the reactivity series, so it doesn't react with dilute acids.");
                    }
                    continue;
                }
                if (!has(key) || acidAvailable() <= EPS) continue;
                double n = get(key);
                double[] t = consumeAcid(2 * n);
                double e = (t[0] + t[1]) / 2;
                if (e <= EPS) continue;
                take(key, e);
                add(m.symbol() + "^2+", e);
                heatJ += metalAcidHeat(m.symbol()) * e;
                long start = nextStart();
                double strongShare = t[0] / (t[0] + t[1]);
                double k = m.acidRate() * (strongShare + 0.2 * (1 - strongShare));
                gas("H2", e, solidTarget.get(key), k, "fine", start);
                dissolveSolid(key, start, (long) clamp(7000 / (k * tf), 1800, 14000));
                String eq;
                if (acid != null) {
                    Substance.AcidInfo a = acid.acid();
                    Latex.Salt salt = Latex.salt(m.symbol(), 2, false, a.anion(), a.anionCharge(), a.poly());
                    eq = Latex.equation(List.of(Term.of(1, m.symbol(), "s"), Term.of(2 / a.protons(), acid.formula(), "aq")),
                            List.of(Term.of(1, salt.formula(), "aq"), Term.of(1, "H2", "g")), null);
                } else {
                    eq = Latex.equation(List.of(Term.of(1, m.symbol(), "s"), Term.ion(2, "H", "+")),
                            List.of(Term.ion(1, m.symbol(), "2+"), Term.of(1, "H2", "g")), null);
                }
                reaction("acid-metal-" + m.symbol().toLowerCase(Locale.ROOT), s.name() + " in acid", "gas", eq, "acid-metal", e);
                String speed = k > 2 ? "fizzes vigorously" : k > 0.6 ? "fizzes steadily" : "slowly gives off a few bubbles";
                observations.add(s.name() + " " + speed + " as hydrogen is released (a lit splint would go 'pop').");
                if (has(key)) observations.add("The acid runs out before all the " + s.name().toLowerCase(Locale.ROOT) + " is used up.");
                if ("Fe".equals(m.symbol())) observations.add("The solution turns pale green: iron(II) ions.");
            }
        }

        double metalAcidHeat(String symbol) {
            return switch (symbol) {
                case "Mg" -> 467_000;
                case "Zn" -> 153_000;
                case "Fe" -> 89_000;
                default -> 50_000;
            };
        }

        void oxideWithAcid() {
            if (has("MnO2(s)") && hadAcid) {
                reasons.add("Manganese(IV) oxide doesn't react with dilute acids here - it's a catalyst, not a reactant.");
            }
            if (!has("CuO(s)")) return;
            if (acidAvailable() <= EPS) {
                if (aqMl > 0 && !hadAcid) reasons.add("Copper(II) oxide is insoluble in water - it needs an acid.");
                return;
            }
            if (tempC < 50) {
                pending.add(new Pending("NEEDS_HEAT", "heater",
                        "This reaction needs heat to proceed. Warm the mixture to about 60 °C."));
                return;
            }
            Substance acid = mainAcid();
            double n = get("CuO(s)");
            double[] t = consumeAcid(2 * n);
            double e = (t[0] + t[1]) / 2;
            take("CuO(s)", e);
            add("Cu^2+", e);
            heatJ += 63_000 * e;
            product("H2O", e, "l");
            long start = nextStart();
            dissolveSolid("CuO(s)", start, (long) clamp(9000 / tf, 2500, 9000));
            Substance.AcidInfo a = acid.acid();
            Latex.Salt salt = Latex.salt("Cu", 2, false, a.anion(), a.anionCharge(), a.poly());
            reaction("acid-oxide", "Copper(II) oxide in warm acid", "neutralisation",
                    Latex.equation(List.of(Term.of(1, "CuO", "s"), Term.of(2 / a.protons(), acid.formula(), "aq")),
                            List.of(Term.of(1, salt.formula(), "aq"), Term.of(1, "H2O", "l")), null),
                    "acid-oxide", e);
            observations.add("The black powder dissolves in the warm acid and the solution turns blue.");
        }

        void thiosulfateWithAcid() {
            if (!has("S2O3^2-") || acidAvailable() <= EPS) return;
            double thio = molar("S2O3^2-");
            double acidM = molar("H+") + 0.2 * molar("CH3COOH");
            double e = Math.min(get("S2O3^2-"), acidAvailable() / 2);
            take("S2O3^2-", e);
            consumeAcid(2 * e);
            product("SO2", e, "aq");
            product("H2O", e, "l");
            long settle = (long) clamp(12_000 / (Math.max(0.05, thio * acidM * 40) * tf), 1500, 20_000);
            long start = nextStart();
            precipitate("S", e, "#f2e45c", start, settle);
            Map<String, Object> c = cue("odour", "vessel", start + settle / 2);
            c.put("description", "a sharp smell of sulfur dioxide");
            reaction("thiosulfate-acid", "Thiosulfate and acid", "precipitation",
                    Latex.equation(List.of(Term.ion(1, "S2O3", "2-"), Term.ion(2, "H", "+")),
                            List.of(Term.of(1, "S", "s"), Term.of(1, "SO2", "aq"), Term.of(1, "H2O", "l")), null),
                    "thiosulfate-acid", e);
            observations.add(String.format(Locale.ROOT,
                    "The mixture slowly turns cloudy yellow as sulfur forms (about %.0f s here). Warmer or more concentrated = faster.",
                    settle / 1000.0));
        }

        // ---------------------------------------------------------------- redox

        void permanganate() {
            if (!has("MnO4-")) return;
            if (has("Fe^2+")) {
                if (get("H+") > EPS) {
                    double e = Math.min(get("MnO4-"), Math.min(get("Fe^2+") / 5, get("H+") / 8));
                    take("MnO4-", e);
                    take("Fe^2+", 5 * e);
                    take("H+", 8 * e);
                    add("Mn^2+", e);
                    add("Fe^3+", 5 * e);
                    heatJ += 100_000 * e;
                    nextStart();
                    reaction("permanganate-iron", "Permanganate oxidises iron(II)", "redox",
                            Latex.equation(List.of(Term.ion(1, "MnO4", "-"), Term.ion(5, "Fe", "2+"), Term.ion(8, "H", "+")),
                                    List.of(Term.ion(1, "Mn", "2+"), Term.ion(5, "Fe", "3+"), Term.of(4, "H2O", "l")), null),
                            "permanganate-decolourised", e);
                    observations.add(get("MnO4-") > EPS
                            ? "The purple colour fades as iron(II) is oxidised - but there's permanganate left over."
                            : "The purple colour disappears instantly as iron(II) is oxidised to iron(III).");
                } else {
                    pending.add(new Pending("NEEDS_ACID", "acid",
                            "Permanganate needs acid to react cleanly. Add some dilute sulfuric acid."));
                }
            }
            if (has("MnO4-") && has("I-")) {
                if (get("H+") > EPS) {
                    double e = Math.min(get("MnO4-") / 2, Math.min(get("I-") / 10, get("H+") / 16));
                    take("MnO4-", 2 * e);
                    take("I-", 10 * e);
                    take("H+", 16 * e);
                    add("Mn^2+", 2 * e);
                    add("I2", 5 * e);
                    nextStart();
                    reaction("permanganate-iodide", "Permanganate oxidises iodide", "redox",
                            Latex.equation(List.of(Term.ion(2, "MnO4", "-"), Term.ion(10, "I", "-"), Term.ion(16, "H", "+")),
                                    List.of(Term.ion(2, "Mn", "2+"), Term.of(5, "I2", "aq"), Term.of(8, "H2O", "l")), null),
                            "iodide-oxidation", e);
                    observations.add("The purple colour vanishes and the solution turns brown as iodine forms.");
                } else {
                    pending.add(new Pending("NEEDS_ACID", "acid",
                            "Permanganate needs acid to oxidise iodide cleanly. Add some dilute sulfuric acid."));
                }
            }
        }

        void peroxide() {
            if (!has("H2O2")) return;
            boolean reacted = false;
            if (has("Fe^2+")) {
                double e = Math.min(get("H2O2"), get("Fe^2+") / 2);
                take("H2O2", e);
                take("Fe^2+", 2 * e);
                add("Fe^3+", 2 * e);
                take("H+", 2 * e);
                heatJ += 80_000 * e;
                nextStart();
                reaction("peroxide-iron", "Peroxide oxidises iron(II)", "redox",
                        Latex.equation(List.of(Term.ion(2, "Fe", "2+"), Term.of(1, "H2O2", "aq"), Term.ion(2, "H", "+")),
                                List.of(Term.ion(2, "Fe", "3+"), Term.of(2, "H2O", "l")), null),
                        "peroxide-iron", e);
                observations.add("The pale green solution turns yellow-brown as iron(II) is oxidised to iron(III).");
                reacted = true;
            }
            if (has("H2O2") && has("I-") && get("H+") > EPS) {
                double h = molar("H2O2"), i = molar("I-"), hp = molar("H+");
                double e = Math.min(get("H2O2"), Math.min(get("I-") / 2, get("H+") / 2));
                take("H2O2", e);
                take("I-", 2 * e);
                take("H+", 2 * e);
                add("I2", e);
                clockDelayMs = (long) clamp(9000 / (Math.max(0.05, h * i * hp * 200) * tf), 600, 15_000);
                nextStart();
                reaction("peroxide-iodide", "Peroxide oxidises iodide", "redox",
                        Latex.equation(List.of(Term.of(1, "H2O2", "aq"), Term.ion(2, "I", "-"), Term.ion(2, "H", "+")),
                                List.of(Term.of(1, "I2", "aq"), Term.of(2, "H2O", "l")), null),
                        "iodide-oxidation", e);
                observations.add("Slowly the colourless mixture turns yellow-brown as iodine forms.");
                reacted = true;
            }
            if (has("H2O2") && has("MnO4-")) {
                if (get("H+") > EPS) {
                    double e = Math.min(get("MnO4-") / 2, Math.min(get("H2O2") / 5, get("H+") / 6));
                    take("MnO4-", 2 * e);
                    take("H2O2", 5 * e);
                    take("H+", 6 * e);
                    add("Mn^2+", 2 * e);
                    gas("O2", 5 * e, "vessel", 2.0, "fine", nextStart());
                    reaction("permanganate-peroxide", "Permanganate and peroxide", "redox",
                            Latex.equation(List.of(Term.ion(2, "MnO4", "-"), Term.of(5, "H2O2", "aq"), Term.ion(6, "H", "+")),
                                    List.of(Term.ion(2, "Mn", "2+"), Term.of(5, "O2", "g"), Term.of(8, "H2O", "l")), null),
                            "permanganate-decolourised", e);
                    observations.add("The purple colour fades while oxygen fizzes off.");
                } else {
                    double e = Math.min(get("MnO4-") / 2, get("H2O2") / 3);
                    take("MnO4-", 2 * e);
                    take("H2O2", 3 * e);
                    add("MnO2(ppt)", 2 * e);
                    add("OH-", 2 * e);
                    long start = nextStart();
                    precipitate("MnO2", 2 * e, "#4a2f1d", start, 6000);
                    gas("O2", 3 * e, "vessel", 1.5, "fine", start);
                    reaction("permanganate-peroxide-neutral", "Permanganate and peroxide (no acid)", "redox",
                            Latex.equation(List.of(Term.ion(2, "MnO4", "-"), Term.of(3, "H2O2", "aq")),
                                    List.of(Term.of(2, "MnO2", "s"), Term.of(3, "O2", "g"), Term.ion(2, "OH", "-"), Term.of(2, "H2O", "l")), null),
                            null, e);
                    observations.add("Without acid, the purple turns to a brown sludge of manganese(IV) oxide, and oxygen bubbles off.");
                }
                reacted = true;
            }
            if (!has("H2O2")) return;
            String catalyst = has("MnO2(s)") || has("MnO2(ppt)") ? "MnO2"
                    : has("I-") ? "KI"
                    : has("Fe^3+") ? "Fe^{3+}"
                    : null;
            if (catalyst != null) {
                double e = get("H2O2");
                take("H2O2", e);
                heatJ += 98_000 * e;
                double k = "MnO2".equals(catalyst) ? 4.0 : 2.4;
                gas("O2", e / 2, catalyst.equals("MnO2") && has("MnO2(s)") ? solidTarget.get("MnO2(s)") : "vessel", k, "fine", nextStart());
                product("H2O", e, "l");
                reaction("peroxide-catalysed", "Catalytic decomposition of peroxide", "catalysis",
                        Latex.equation(List.of(Term.of(2, "H2O2", "aq")), List.of(Term.of(2, "H2O", "l"), Term.of(1, "O2", "g")),
                                catalyst.startsWith("Fe") ? "Fe(III)" : catalyst),
                        "peroxide-catalysed", e);
                observations.add("Vigorous fizzing - the oxygen would relight a glowing splint. The catalyst isn't used up.");
                return;
            }
            if (!reacted) {
                if (tempC >= 70) {
                    double e = get("H2O2") * 0.15;
                    take("H2O2", e);
                    gas("O2", e / 2, "vessel", 0.25, "fine", nextStart());
                    reaction("peroxide-thermal", "Peroxide decomposes when hot", "gas",
                            Latex.equation(List.of(Term.of(2, "H2O2", "aq")), List.of(Term.of(2, "H2O", "l"), Term.of(1, "O2", "g")), null),
                            null, e);
                    observations.add("A few small bubbles of oxygen appear: heat slowly decomposes hydrogen peroxide.");
                } else {
                    pending.add(new Pending("NEEDS_CATALYST", "catalyst",
                            "Hydrogen peroxide decomposes only very slowly on its own. Add a catalyst such as manganese(IV) oxide."));
                }
            }
        }

        void iron3() {
            if (!has("Fe^3+")) return;
            if (has("I-")) {
                double e = Math.min(get("Fe^3+") / 2, get("I-") / 2);
                take("Fe^3+", 2 * e);
                take("I-", 2 * e);
                add("Fe^2+", 2 * e);
                add("I2", e);
                nextStart();
                reaction("iron3-iodide", "Iron(III) oxidises iodide", "redox",
                        Latex.equation(List.of(Term.ion(2, "Fe", "3+"), Term.ion(2, "I", "-")),
                                List.of(Term.ion(2, "Fe", "2+"), Term.of(1, "I2", "aq")), null),
                        "iodide-oxidation", e);
                observations.add("The orange solution darkens to brown as iodine is released.");
            }
            for (Portion p : portions) {
                Substance.MetalInfo m = p.substance().metal();
                if (m == null || !has("Fe^3+")) continue;
                String key = m.symbol() + "(s)";
                if (!has(key)) continue;
                double e = Math.min(get(key), get("Fe^3+") / 2);
                take(key, e);
                take("Fe^3+", 2 * e);
                add(m.symbol() + "^2+", e);
                add("Fe^2+", 2 * e);
                long start = nextStart();
                dissolveSolid(key, start, 5000);
                reaction("iron3-" + m.symbol().toLowerCase(Locale.ROOT), "Iron(III) attacks " + p.substance().name().toLowerCase(Locale.ROOT), "redox",
                        Latex.equation(List.of(Term.of(1, m.symbol(), "s"), Term.ion(2, "Fe", "3+")),
                                List.of(Term.ion(1, m.symbol(), "2+"), Term.ion(2, "Fe", "2+")), null),
                        "iron3-reduction", e);
                observations.add("The metal is slowly eaten away and the orange-yellow solution fades towards pale green.");
            }
        }

        void copperIodide() {
            if (!has("Cu^2+") || !has("I-")) return;
            double e = Math.min(get("Cu^2+") / 2, get("I-") / 4);
            take("Cu^2+", 2 * e);
            take("I-", 4 * e);
            add("I2", e);
            long start = nextStart();
            precipitate("CuI", 2 * e, "#e8ddc8", start, 7000);
            reaction("copper-iodide", "Copper(II) and iodide", "redox",
                    Latex.equation(List.of(Term.ion(2, "Cu", "2+"), Term.ion(4, "I", "-")),
                            List.of(Term.of(2, "CuI", "s"), Term.of(1, "I2", "aq")), null),
                    "copper-iodide", e);
            observations.add("The blue solution turns brown (iodine) with an off-white precipitate of copper(I) iodide.");
        }

        void iodine() {
            if (!has("I2")) return;
            if (has("S2O3^2-")) {
                double e = Math.min(get("I2"), get("S2O3^2-") / 2);
                take("I2", e);
                take("S2O3^2-", 2 * e);
                add("I-", 2 * e);
                nextStart();
                reaction("iodine-thiosulfate", "Thiosulfate reduces iodine", "redox",
                        Latex.equation(List.of(Term.of(1, "I2", "aq"), Term.ion(2, "S2O3", "2-")),
                                List.of(Term.ion(2, "I", "-"), Term.ion(1, "S4O6", "2-")), null),
                        "iodine-decolourised", e);
                observations.add(has("I2") ? "Some of the brown iodine colour disappears."
                        : "The brown iodine colour disappears completely.");
            }
            if (has("I2") && has("OH-")) {
                double e = Math.min(get("I2") / 3, get("OH-") / 6);
                take("I2", 3 * e);
                take("OH-", 6 * e);
                add("I-", 5 * e);
                nextStart();
                reaction("iodine-alkali", "Alkali decolourises iodine", "redox",
                        Latex.equation(List.of(Term.of(3, "I2", "aq"), Term.ion(6, "OH", "-")),
                                List.of(Term.ion(5, "I", "-"), Term.ion(1, "IO3", "-"), Term.of(3, "H2O", "l")), null),
                        "iodine-decolourised", e);
                observations.add("The brown colour fades as the alkali turns iodine into colourless iodide and iodate.");
            }
        }

        // ---------------------------------------------------------------- displacement

        record Ion(String key, String symbol, int charge, int rank, String depositHex, String discovery) {}

        static final List<Ion> SERIES_IONS = List.of(
                new Ion("Ag+", "Ag", 1, 1, "#d9dde3", "displacement-silver"),
                new Ion("Cu^2+", "Cu", 2, 2, "#b5653a", "displacement-copper"),
                new Ion("Fe^2+", "Fe", 2, 3, "#3d3d3f", "displacement-other"),
                new Ion("Zn^2+", "Zn", 2, 4, "#9aa0a6", "displacement-other"),
                new Ion("Mg^2+", "Mg", 2, 5, "#c9cdd3", "displacement-other"));

        void displacement() {
            List<Portion> metals = portions.stream().filter(p -> p.substance().metal() != null)
                    .sorted(Comparator.comparingInt((Portion p) -> -p.substance().metal().rank())).toList();
            for (Portion p : metals) {
                Substance.MetalInfo m = p.substance().metal();
                String key = m.symbol() + "(s)";
                for (Ion ion : SERIES_IONS) {
                    if (!has(ion.key()) || ion.symbol().equals(m.symbol())) continue;
                    if (ion.rank() > m.rank()) {
                        reasons.add(p.substance().name() + " is less reactive than " + elementName(ion.symbol())
                                + ", so it can't displace it from solution.");
                        continue;
                    }
                    if (!has(key)) continue;
                    int lcm = Latex.lcm(m.charge(), ion.charge());
                    int metalCoef = lcm / m.charge();
                    int ionCoef = lcm / ion.charge();
                    double e = Math.min(get(key) / metalCoef, get(ion.key()) / ionCoef);
                    if (e <= EPS) continue;
                    take(key, metalCoef * e);
                    take(ion.key(), ionCoef * e);
                    add(m.symbol() + "^2+", metalCoef * e);
                    product(ion.symbol(), ionCoef * e, "s");
                    heatJ += 90_000 * (m.rank() - ion.rank()) * metalCoef * e;
                    long start = nextStart();
                    Map<String, Object> c = cue("deposit", solidTarget.get(key), start);
                    c.put("colour", Colour.hex(ion.depositHex(), 1).toJson());
                    c.put("durationMs", (long) clamp(6000 / tf, 2000, 9000));
                    dissolveSolid(key, start, (long) clamp(9000 / tf, 3000, 12000));
                    reaction("displacement-" + m.symbol().toLowerCase(Locale.ROOT) + "-" + ion.symbol().toLowerCase(Locale.ROOT),
                            p.substance().name() + " displaces " + elementName(ion.symbol()).toLowerCase(Locale.ROOT), "displacement",
                            Latex.equation(List.of(Term.of(metalCoef, m.symbol(), "s"), Latex.ionTerm(ionCoef, ion.key())),
                                    List.of(Term.ion(metalCoef, m.symbol(), "2+"), Term.of(ionCoef, ion.symbol(), "s")), null),
                            ion.discovery(), e);
                    observations.add(switch (ion.symbol()) {
                        case "Cu" -> "A pinky-brown coating of copper grows on the " + p.substance().name().toLowerCase(Locale.ROOT)
                                + " and the blue colour fades.";
                        case "Ag" -> "Sparkling grey-white silver crystals grow on the metal"
                                + ("Cu".equals(m.symbol()) ? " and the solution slowly turns blue." : ".");
                        default -> "A dark coating of " + elementName(ion.symbol()).toLowerCase(Locale.ROOT) + " forms on the metal.";
                    });
                }
            }
        }

        String elementName(String symbol) {
            return switch (symbol) {
                case "Ag" -> "Silver";
                case "Cu" -> "Copper";
                case "Fe" -> "Iron";
                case "Zn" -> "Zinc";
                case "Mg" -> "Magnesium";
                default -> symbol;
            };
        }

        // ---------------------------------------------------------------- precipitation

        record Ppt(String cation, int cCharge, String anion, int aCharge, boolean anionPoly, String solid, String hex,
                double molarMass, String discovery, String name) {}

        static final List<Ppt> INSOLUBLE = List.of(
                new Ppt("Ag+", 1, "I-", 1, false, "AgI", "#f2e27a", 234.8, "silver-halide", "Silver iodide"),
                new Ppt("Ag+", 1, "Br-", 1, false, "AgBr", "#eee3bf", 187.8, "silver-halide", "Silver bromide"),
                new Ppt("Ag+", 1, "Cl-", 1, false, "AgCl", "#f5f5f3", 143.3, "silver-halide", "Silver chloride"),
                new Ppt("Ba^2+", 2, "SO4^2-", 2, true, "BaSO4", "#fbfbfb", 233.4, "barium-sulfate", "Barium sulfate"),
                new Ppt("Ba^2+", 2, "CO3^2-", 2, true, "BaCO3", "#f7f7f5", 197.3, "insoluble-carbonate", "Barium carbonate"),
                new Ppt("Ca^2+", 2, "CO3^2-", 2, true, "CaCO3", "#f7f7f5", 100.1, "insoluble-carbonate", "Calcium carbonate"),
                new Ppt("Mg^2+", 2, "CO3^2-", 2, true, "MgCO3", "#f5f5f5", 84.3, "insoluble-carbonate", "Magnesium carbonate"),
                new Ppt("Zn^2+", 2, "CO3^2-", 2, true, "ZnCO3", "#f5f5f5", 125.4, "insoluble-carbonate", "Zinc carbonate"),
                new Ppt("Cu^2+", 2, "CO3^2-", 2, true, "CuCO3", "#58a894", 123.6, "insoluble-carbonate", "Copper(II) carbonate"),
                new Ppt("Fe^2+", 2, "CO3^2-", 2, true, "FeCO3", "#a0a88a", 115.9, "insoluble-carbonate", "Iron(II) carbonate"),
                new Ppt("Ag+", 1, "CO3^2-", 2, true, "Ag2CO3", "#efe6b0", 275.7, "insoluble-carbonate", "Silver carbonate"));

        record Hydroxide(String cation, String symbol, int charge, String solid, String hex, double molarMass,
                String discovery, String colourWord) {}

        static final List<Hydroxide> HYDROXIDES = List.of(
                new Hydroxide("Fe^3+", "Fe", 3, "Fe(OH)3", "#9b4a1c", 106.9, "iron3-hydroxide", "rust-brown"),
                new Hydroxide("Cu^2+", "Cu", 2, "Cu(OH)2", "#4a9fe0", 97.6, "copper-hydroxide", "pale blue"),
                new Hydroxide("Fe^2+", "Fe", 2, "Fe(OH)2", "#6d8f58", 89.9, "iron2-hydroxide", "dirty green"),
                new Hydroxide("Zn^2+", "Zn", 2, "Zn(OH)2", "#f2f2f2", 99.4, "white-hydroxide", "white"),
                new Hydroxide("Mg^2+", "Mg", 2, "Mg(OH)2", "#f2f2f2", 58.3, "white-hydroxide", "white"));

        void precipitation() {
            if (aqMl <= 0) return;
            for (Ppt p : INSOLUBLE) {
                if (!has(p.cation()) || !has(p.anion())) continue;
                Latex.Salt salt = Latex.salt("M", p.cCharge(), false, "X", p.aCharge(), p.anionPoly());
                int x = salt.cations();
                int y = salt.anions();
                double e = Math.min(get(p.cation()) / x, get(p.anion()) / y);
                if (e <= EPS) continue;
                take(p.cation(), x * e);
                take(p.anion(), y * e);
                long start = nextStart();
                precipitate(p.solid(), e, p.hex(), start, 6500);
                reaction("precipitate-" + p.solid().toLowerCase(Locale.ROOT), p.name() + " precipitates", "precipitation",
                        Latex.equation(List.of(Latex.ionTerm(x, p.cation()), Latex.ionTerm(y, p.anion())),
                                List.of(Term.of(1, p.solid(), "s")), null),
                        p.discovery(), e);
                observations.add("A " + colourWord(p.hex()) + " precipitate of " + p.name().toLowerCase(Locale.ROOT) + " forms instantly.");
            }
            // Iron(III) + carbonate: hydrolyses to iron(III) hydroxide with fizzing.
            if (has("Fe^3+") && has("CO3^2-")) {
                double e = Math.min(get("Fe^3+") / 2, get("CO3^2-") / 3);
                take("Fe^3+", 2 * e);
                take("CO3^2-", 3 * e);
                long start = nextStart();
                precipitate("Fe(OH)3", 2 * e, "#9b4a1c", start, 7000);
                gas("CO2", 3 * e, "vessel", 1.2, "medium", start);
                reaction("iron3-carbonate", "Iron(III) and carbonate", "precipitation",
                        Latex.equation(List.of(Term.ion(2, "Fe", "3+"), Term.ion(3, "CO3", "2-"), Term.of(3, "H2O", "l")),
                                List.of(Term.of(2, "Fe(OH)3", "s"), Term.of(3, "CO2", "g")), null),
                        "iron3-hydroxide", e);
                observations.add("A rust-brown precipitate forms and carbon dioxide fizzes off.");
            }
            // Calcium sulfate is only sparingly soluble (Ksp ~ 4.9e-5).
            if (has("Ca^2+") && has("SO4^2-")) {
                double q = molar("Ca^2+") * molar("SO4^2-");
                if (q > 4.9e-5) {
                    double e = Math.min(get("Ca^2+"), get("SO4^2-")) - Math.sqrt(4.9e-5) * litres();
                    if (e > EPS) {
                        take("Ca^2+", e);
                        take("SO4^2-", e);
                        long start = nextStart();
                        precipitate("CaSO4", e, "#f6f6f4", start, 9000);
                        reaction("precipitate-caso4", "Calcium sulfate precipitates", "precipitation",
                                Latex.equation(List.of(Term.ion(1, "Ca", "2+"), Term.ion(1, "SO4", "2-")),
                                        List.of(Term.of(1, "CaSO4", "s")), null),
                                "calcium-sulfate", e);
                        observations.add("A faint white haze forms: calcium sulfate is only sparingly soluble.");
                    }
                }
            }
            // Silver oxide from silver ions and hydroxide.
            if (has("Ag+") && has("OH-")) {
                double e = Math.min(get("Ag+") / 2, get("OH-") / 2);
                take("Ag+", 2 * e);
                take("OH-", 2 * e);
                long start = nextStart();
                precipitate("Ag2O", e, "#5a3a22", start, 6000);
                reaction("precipitate-ag2o", "Silver oxide precipitates", "precipitation",
                        Latex.equation(List.of(Term.ion(2, "Ag", "+"), Term.ion(2, "OH", "-")),
                                List.of(Term.of(1, "Ag2O", "s"), Term.of(1, "H2O", "l")), null),
                        null, e);
                observations.add("A brown precipitate of silver oxide forms.");
            }
            for (Hydroxide h : HYDROXIDES) {
                if (!has(h.cation())) continue;
                double available = get("OH-") + get("NH3");
                double e = Math.min(get(h.cation()), available / h.charge());
                if (e <= EPS) continue;
                double fromOh = take("OH-", h.charge() * e);
                double fromNh3 = take("NH3", h.charge() * e - fromOh);
                add("NH4+", fromNh3);
                take(h.cation(), e);
                long start = nextStart();
                precipitate(h.solid(), e, h.hex(), start, 7000);
                reaction("hydroxide-" + h.solid().toLowerCase(Locale.ROOT), h.solid() + " precipitates", "precipitation",
                        Latex.equation(List.of(Latex.ionTerm(1, h.cation()), Term.ion(h.charge(), "OH", "-")),
                                List.of(Term.of(1, h.solid(), "s")), null),
                        h.discovery(), e);
                observations.add("A " + h.colourWord() + " precipitate of " + h.solid() + " forms"
                        + (fromNh3 > fromOh ? " (ammonia supplies the hydroxide ions)." : "."));
                if ("Fe(OH)2".equals(h.solid())) observations.add("Left in air, it would slowly turn orange-brown as it oxidises.");
            }
            complexes();
        }

        void complexes() {
            double cu = precipitates.getOrDefault("Cu(OH)2", 0.0);
            if (cu > EPS && get("NH3") > EPS) {
                double e = Math.min(cu, get("NH3") / 4);
                take("NH3", 4 * e);
                add("[Cu(NH3)4]^2+", e);
                add("OH-", 2 * e);
                product("[Cu(NH3)4]^2+", e, "aq");
                precipitates.merge("Cu(OH)2", -e, Double::sum);
                Map<String, Object> c = cue("dissolve", "precipitate:Cu(OH)2", 2200);
                c.put("durationMs", 2600);
                c.put("fraction", round(e / cu, 3));
                reaction("copper-ammine", "Tetraamminecopper(II) forms", "complex",
                        Latex.equation(List.of(Term.of(1, "Cu(OH)2", "s"), Term.of(4, "NH3", "aq")),
                                List.of(Latex.ionTerm(1, "[Cu(NH3)4]^2+"), Term.ion(2, "OH", "-")), null),
                        "copper-ammine", e);
                observations.add(e >= cu - EPS
                        ? "With excess ammonia the pale blue precipitate dissolves into a deep royal-blue solution."
                        : "Some of the precipitate dissolves into deep royal blue - add more ammonia to dissolve it all.");
            }
            double zn = precipitates.getOrDefault("Zn(OH)2", 0.0);
            if (zn > EPS && (get("OH-") > EPS || get("NH3") > EPS)) {
                boolean viaOh = get("OH-") > EPS;
                double e = viaOh ? Math.min(zn, get("OH-") / 2) : Math.min(zn, get("NH3") / 4);
                product(viaOh ? "[Zn(OH)4]^2-" : "[Zn(NH3)4]^2+", e, "aq");
                if (viaOh) {
                    take("OH-", 2 * e);
                    add("[Zn(OH)4]^2-", e);
                } else {
                    take("NH3", 4 * e);
                    add("[Zn(NH3)4]^2+", e);
                    add("OH-", 2 * e);
                }
                precipitates.merge("Zn(OH)2", -e, Double::sum);
                Map<String, Object> c = cue("dissolve", "precipitate:Zn(OH)2", 2200);
                c.put("durationMs", 2400);
                c.put("fraction", round(e / zn, 3));
                reaction(viaOh ? "amphoteric-zinc" : "zinc-ammine", viaOh ? "Zinc hydroxide redissolves" : "Zinc ammine forms",
                        "complex",
                        viaOh ? Latex.equation(List.of(Term.of(1, "Zn(OH)2", "s"), Term.ion(2, "OH", "-")),
                                        List.of(Latex.ionTerm(1, "[Zn(OH)4]^2-")), null)
                                : Latex.equation(List.of(Term.of(1, "Zn(OH)2", "s"), Term.of(4, "NH3", "aq")),
                                        List.of(Latex.ionTerm(1, "[Zn(NH3)4]^2+"), Term.ion(2, "OH", "-")), null),
                        viaOh ? "amphoteric-zinc" : null, e);
                observations.add("Then the white precipitate dissolves again in the excess "
                        + (viaOh ? "alkali - zinc hydroxide is amphoteric." : "ammonia, forming a colourless complex."));
            }
        }

        void magnesiumWater() {
            boolean waterOnly = aqMl > 0 && !hadAcid && portions.stream()
                    .noneMatch(p -> p.substance().species().keySet().stream().anyMatch(k -> k.endsWith("+") || k.endsWith("-"))
                            && !p.substance().isSolid());
            if (!waterOnly) return;
            for (Portion p : portions) {
                Substance.MetalInfo m = p.substance().metal();
                if (m == null) continue;
                String key = m.symbol() + "(s)";
                if (!has(key)) continue;
                if (!"Mg".equals(m.symbol())) {
                    reasons.add(p.substance().name() + " doesn't react with water at these temperatures.");
                    continue;
                }
                if (tempC < 70) {
                    pending.add(new Pending("NEEDS_HEAT", "heater",
                            "Magnesium reacts only extremely slowly with cold water. Heat the water to at least 70 °C."));
                    continue;
                }
                double e = get(key) * 0.08;
                take(key, e);
                product("Mg(OH)2", e, "s");
                basicFloor = 10.3;
                long start = nextStart();
                gas("H2", e, solidTarget.get(key), 0.3, "fine", start);
                reaction("magnesium-water", "Magnesium and hot water", "gas",
                        Latex.equation(List.of(Term.of(1, "Mg", "s"), Term.of(2, "H2O", "l")),
                                List.of(Term.of(1, "Mg(OH)2", "s"), Term.of(1, "H2", "g")), null),
                        "magnesium-water", e);
                observations.add("Slow streams of hydrogen bubbles rise from the magnesium; the water becomes slightly alkaline.");
            }
        }

        void starchIodine() {
            if (!has("starch") || !has("I2")) return;
            if (tempC > 50) {
                mismatches.add(new Mismatch("TEMP_ABOVE_VALIDATED",
                        "The starch-iodine test is validated at room temperature: the blue-black colour fades when hot. Cool the mixture below 50 °C."));
                return;
            }
            starchComplex = true;
            nextStart();
            reaction("starch-iodine", "Starch-iodine complex", "indicator",
                    "\\mathrm{I_{2}}_{\\mathrm{(aq)}} + \\text{starch} \\rightarrow \\text{blue-black complex}",
                    "starch-iodine", get("I2"));
            observations.add(clockDelayMs > 0
                    ? "After a pause, the whole mixture suddenly turns blue-black - an iodine clock!"
                    : "The mixture turns an intense blue-black: the starch test for iodine is positive.");
        }

        // ---------------------------------------------------------------- pH and indicators

        double ph() {
            if (aqMl <= 0) return Double.NaN;
            double h = molar("H+");
            double oh = molar("OH-");
            double ph;
            if (h > 1e-7) {
                ph = -Math.log10(h);
            } else if (oh > 1e-7) {
                ph = 14 + Math.log10(oh);
            } else {
                double ca = molar("CH3COOH"), cb = molar("CH3COO-"), nb = molar("NH3"), na = molar("NH4+");
                if (ca > EPS && cb > EPS) ph = 4.76 + Math.log10(cb / ca);
                else if (nb > EPS && na > EPS) ph = 9.25 + Math.log10(nb / na);
                else if (ca > EPS) ph = 0.5 * (4.76 - Math.log10(ca));
                else if (nb > EPS) ph = 14 - 0.5 * (4.75 - Math.log10(nb));
                else if (molar("CO3^2-") > EPS) ph = 14 - 0.5 * (3.67 - Math.log10(molar("CO3^2-")));
                else if (molar("HCO3-") > EPS) ph = 8.3;
                else {
                    double acidPh = Double.NaN;
                    double[][] acids = {{molar("NH4+"), 9.25}, {molar("Cu^2+"), 7.5}, {molar("Fe^3+"), 2.2},
                            {molar("Zn^2+"), 9.0}, {molar("Fe^2+"), 9.5}};
                    for (double[] a : acids) {
                        if (a[0] > EPS) {
                            double v = 0.5 * (a[1] - Math.log10(a[0]));
                            acidPh = Double.isNaN(acidPh) ? v : Math.min(acidPh, v);
                        }
                    }
                    double basePh = Double.NaN;
                    double[][] bases = {{molar("CH3COO-"), 9.25}, {molar("OCl-"), 6.5}};
                    for (double[] b : bases) {
                        if (b[0] > EPS) {
                            double v = 14 - 0.5 * (b[1] - Math.log10(b[0]));
                            basePh = Double.isNaN(basePh) ? v : Math.max(basePh, v);
                        }
                    }
                    ph = !Double.isNaN(acidPh) ? Math.min(acidPh, 7) : !Double.isNaN(basePh) ? Math.max(basePh, 7) : 7.0;
                }
            }
            ph = Math.max(ph, basicFloor);
            return clamp(ph, 0, 14);
        }

        void indicators(double ph) {
            if (Double.isNaN(ph)) return;
            boolean acidBaseChemistry = hadAcid || hadBase || Math.abs(ph - 7) > 1.5;
            for (String ind : List.of("ind:pp", "ind:ui", "ind:mo")) {
                if (!has(ind)) continue;
                Colour neutral = indicatorColour(ind, 7.0);
                Colour now = indicatorColour(ind, ph);
                boolean changed = now.distance(neutral) > 0.06;
                if (!changed || !acidBaseChemistry) continue;
                String name = switch (ind) {
                    case "ind:pp" -> "Phenolphthalein";
                    case "ind:ui" -> "Universal indicator";
                    default -> "Methyl orange";
                };
                boolean acidic = ph < 7;
                nextStart();
                reaction("indicator-" + ind.substring(4), name + (acidic ? " in acid" : " in alkali"), "indicator",
                        "\\text{" + name + "}: \\text{pH } " + String.format(Locale.ROOT, "%.1f", ph)
                                + " \\Rightarrow \\text{" + indicatorWord(ind, ph) + "}",
                        acidic ? "indicator-acid" : "indicator-alkali", 0);
                observations.add(name + " turns " + indicatorWord(ind, ph) + String.format(Locale.ROOT, " (pH about %.1f).", ph));
            }
        }

        // ---------------------------------------------------------------- finish

        Result finish(Colour startColour, double ph) {
            List<Reaction> chemical = reactions.stream().filter(r -> !"physical".equals(r.type())).toList();
            Kind kind = !mismatches.isEmpty() ? Kind.PROCEDURE_MISMATCH
                    : !chemical.isEmpty() ? Kind.REACTION
                    : !pending.isEmpty() ? Kind.NEEDS_CONDITIONS
                    : Kind.NO_REACTION;
            String reasonCode = switch (kind) {
                case PROCEDURE_MISMATCH -> mismatches.get(0).code();
                case NEEDS_CONDITIONS -> pending.get(0).code();
                case NO_REACTION -> "NO_OBSERVABLE_REACTION";
                default -> null;
            };

            double liquidMl = aqMl + organicMl;
            double deltaT = liquidMl > 0 ? clamp(heatJ / (liquidMl * 4.18), -40, 60) : 0;
            if (kind != Kind.REACTION && kind != Kind.NO_REACTION) deltaT = 0;
            double finalT = Math.min(100, tempC + deltaT);

            List<Map<String, Object>> finalCues = new ArrayList<>();
            Colour endColour = solutionColour(ph);
            if (startColour != null && aqMl > 0) {
                Map<String, Object> c = new LinkedHashMap<>();
                c.put("kind", "colour");
                c.put("target", "vessel");
                boolean reacting = kind == Kind.REACTION;
                c.put("startMs", reacting && starchComplex ? clockDelayMs : 0);
                c.put("from", startColour.toJson());
                c.put("to", (reacting || kind == Kind.NO_REACTION ? endColour : startColour).toJson());
                c.put("durationMs", reacting ? (starchComplex && clockDelayMs > 0 ? 450 : 1800) : 900);
                c.put("curve", reacting && starchComplex && clockDelayMs > 0 ? "flash-fade" : reacting ? "sigmoid" : "linear");
                finalCues.add(c);
            }
            if (kind == Kind.REACTION || kind == Kind.NO_REACTION) {
                finalCues.addAll(cues);
                if (Math.abs(deltaT) >= 0.2) {
                    Map<String, Object> c = new LinkedHashMap<>();
                    c.put("kind", "temperature");
                    c.put("target", "vessel");
                    c.put("startMs", 0);
                    c.put("deltaC", round(deltaT, 2));
                    c.put("tauMs", 5000);
                    finalCues.add(c);
                }
            }
            finalCues.sort(Comparator.comparingLong(c -> ((Number) c.getOrDefault("startMs", 0)).longValue()));

            List<Measurement> ms = new ArrayList<>();
            if (!Double.isNaN(ph) && (kind == Kind.REACTION || kind == Kind.NO_REACTION)) ms.add(new Measurement("pH", round(ph, 2), "pH"));
            ms.add(new Measurement("temperature", round(kind == Kind.REACTION || kind == Kind.NO_REACTION ? finalT : tempC, 1), "°C"));
            if (kind == Kind.REACTION) {
                if (Math.abs(deltaT) >= 0.05) ms.add(new Measurement("deltaT", round(deltaT, 2), "°C"));
                gases.forEach((g, n) -> ms.add(new Measurement("gas:" + g, round(n * RTP_ML_PER_MOL, 1), "mL")));
                double mass = 0;
                for (Map.Entry<String, Double> e : pptFormed.entrySet()) mass += e.getValue() * molarMassOf(e.getKey());
                if (mass > 0) ms.add(new Measurement("precipitate", round(mass, 3), "g"));
            }
            ms.add(new Measurement("volume", round(liquidMl, 1), "mL"));

            List<String> finalReasons = new ArrayList<>(reasons);
            if (kind == Kind.NO_REACTION) {
                if (portions.size() == 1) {
                    finalReasons.add("There's only one substance here - nothing for it to react with.");
                } else if (finalReasons.isEmpty()) {
                    long ionic = portions.stream().filter(p -> !p.substance().isSolid() && p.substance().aqueous()
                            && p.substance().species().keySet().stream().anyMatch(k -> k.endsWith("+") || k.endsWith("-"))).count();
                    if (present("water") && portions.size() == 2) {
                        finalReasons.add("Water only dilutes the other substance - the particles spread out, but nothing new forms.");
                    } else if (ionic >= 2) {
                        finalReasons.add("Every possible pair of ions here is soluble, so all the ions stay dissolved and nothing new forms.");
                    } else {
                        finalReasons.add("These substances simply mix: no new substances form under these conditions.");
                    }
                }
            }
            if (kind == Kind.REACTION) {
                for (Pending p : pending) observations.add("Not everything reacted: " + p.message());
            }
            List<Product> productList = kind == Kind.REACTION ? new ArrayList<>(products.values()) : List.of();
            return new Result(kind, reasonCode, kind == Kind.REACTION ? reactions
                    : reactions.stream().filter(r -> "physical".equals(r.type())).toList(),
                    finalCues, kind == Kind.REACTION || kind == Kind.NO_REACTION ? observations : List.of(),
                    pending, mismatches, finalReasons, productList, ms, null);
        }

        Colour solutionColour(double ph) {
            List<Colour> cs = new ArrayList<>();
            List<Double> ws = new ArrayList<>();
            addColour(cs, ws, "Cu^2+", "#3a8ee0", 3.2);
            addColour(cs, ws, "[Cu(NH3)4]^2+", "#1d3fd0", 30);
            addColour(cs, ws, "Fe^2+", "#a6d6a0", 4);
            addColour(cs, ws, "Fe^3+", "#d99a2e", 14);
            addColour(cs, ws, "MnO4-", "#7b1f8a", 700);
            addColour(cs, ws, "Mn^2+", "#f6dbe6", 0.5);
            addColour(cs, ws, "OCl-", "#eef5b8", 0.3);
            double i2 = molar("I2");
            if (i2 > EPS) {
                if (starchComplex) {
                    cs.add(Colour.hex("#141433", 1));
                    ws.add(Math.min(40, i2 * 3000));
                } else {
                    cs.add(Colour.lerp(Colour.hex("#e7c34a", 1), Colour.hex("#7a3b0d", 1), Math.min(1, i2 / 0.008)));
                    ws.add(i2 * 90);
                }
            }
            for (String ind : List.of("ind:pp", "ind:ui", "ind:mo")) {
                double c = molar(ind);
                if (c <= EPS || Double.isNaN(ph)) continue;
                double strength = indicatorStrength(ind, ph) * c * 9000;
                if (strength > 0) {
                    cs.add(indicatorColour(ind, ph));
                    ws.add(strength);
                }
            }
            double total = ws.stream().mapToDouble(Double::doubleValue).sum();
            if (total <= EPS) return Colour.CLEAR;
            Colour mixed = Colour.blend(cs, ws);
            double alpha = 0.06 + (1 - Math.exp(-0.9 * total)) * 0.86;
            return mixed.withAlpha(alpha);
        }

        void addColour(List<Colour> cs, List<Double> ws, String species, String hex, double k) {
            double c = molar(species);
            if (c > EPS) {
                cs.add(Colour.hex(hex, 1));
                ws.add(c * k);
            }
        }

        double volumeMl(Portion p) {
            return volumeMlOf(p);
        }

        double volumeMlOf(Portion p) {
            return "drops".equals(p.substance().limits().unit()) ? p.amount() * 0.05 : p.amount();
        }
    }

    // ------------------------------------------------------------------------------ indicators

    static Colour indicatorColour(String ind, double ph) {
        return switch (ind) {
            case "ind:pp" -> Colour.hex("#e8338a", 1);
            case "ind:mo" -> ph < 3.1 ? Colour.hex("#e0302a", 1)
                    : ph > 4.4 ? Colour.hex("#f2c230", 1)
                    : Colour.lerp(Colour.hex("#e0302a", 1), Colour.hex("#f2c230", 1), (ph - 3.1) / 1.3);
            default -> universal(ph);
        };
    }

    static double indicatorStrength(String ind, double ph) {
        if ("ind:pp".equals(ind)) {
            return ph < 8.2 ? 0 : Math.min(1, (ph - 8.2) / 1.8);
        }
        return 1;
    }

    static String indicatorWord(String ind, double ph) {
        return switch (ind) {
            case "ind:pp" -> ph < 8.2 ? "colourless" : ph < 9.5 ? "pale pink" : "bright pink";
            case "ind:mo" -> ph < 3.1 ? "red" : ph > 4.4 ? "yellow" : "orange";
            default -> ph < 2.5 ? "red" : ph < 4.5 ? "orange" : ph < 6.2 ? "yellow" : ph < 7.8 ? "green"
                    : ph < 9.5 ? "blue" : ph < 11.5 ? "indigo" : "violet";
        };
    }

    private static final double[] UI_PH = {1, 3, 5, 7, 9, 11, 13};
    private static final String[] UI_HEX = {"#e3261f", "#f2701d", "#f2c51d", "#3fa535", "#1f6fd1", "#3b3fb6", "#6a2c9e"};

    static Colour universal(double ph) {
        if (ph <= UI_PH[0]) return Colour.hex(UI_HEX[0], 1);
        for (int i = 1; i < UI_PH.length; i++) {
            if (ph <= UI_PH[i]) {
                double t = (ph - UI_PH[i - 1]) / (UI_PH[i] - UI_PH[i - 1]);
                return Colour.lerp(Colour.hex(UI_HEX[i - 1], 1), Colour.hex(UI_HEX[i], 1), t);
            }
        }
        return Colour.hex(UI_HEX[UI_HEX.length - 1], 1);
    }

    // ------------------------------------------------------------------------------ helpers

    static double molarMassOf(String formula) {
        return switch (formula) {
            case "AgI" -> 234.8;
            case "AgBr" -> 187.8;
            case "AgCl" -> 143.3;
            case "BaSO4" -> 233.4;
            case "BaCO3" -> 197.3;
            case "CaCO3" -> 100.1;
            case "MgCO3" -> 84.3;
            case "ZnCO3" -> 125.4;
            case "CuCO3" -> 123.6;
            case "FeCO3" -> 115.9;
            case "Ag2CO3" -> 275.7;
            case "Fe(OH)3" -> 106.9;
            case "Cu(OH)2" -> 97.6;
            case "Fe(OH)2" -> 89.9;
            case "Zn(OH)2" -> 99.4;
            case "Mg(OH)2" -> 58.3;
            case "Ag2O" -> 231.7;
            case "CaSO4" -> 136.1;
            case "CuI" -> 190.5;
            case "MnO2" -> 86.9;
            case "S" -> 32.1;
            default -> 100;
        };
    }

    static String colourWord(String hex) {
        return switch (hex) {
            case "#f2e27a" -> "yellow";
            case "#eee3bf", "#efe6b0" -> "cream";
            case "#58a894" -> "blue-green";
            case "#a0a88a" -> "grey-green";
            default -> "white";
        };
    }

    static double clamp(double v, double lo, double hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    static double round(double v, int places) {
        double f = Math.pow(10, places);
        return Math.round(v * f) / f;
    }
}
