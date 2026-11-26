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
        this.shelfSalts = shelfSalts(catalogue);
    }

    public enum Kind { REACTION, NO_REACTION, NEEDS_CONDITIONS, PROCEDURE_MISMATCH, UNSUPPORTED }

    public record Portion(Substance substance, double amount) {}

    /** @param ref catalogue id of the substance that would satisfy the condition (e.g. the catalyst), or null */
    public record Pending(String code, String tool, String message, String ref) {
        public Pending(String code, String tool, String message) {
            this(code, tool, message, null);
        }
    }

    public record Mismatch(String code, String message) {}

    public record Reaction(
            String id, String name, String type, String equationLatex, String discoveryId, double extentMol,
            Latex.Eq participants) {}

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
            String unsupportedMessage,
            State state) {

        public List<Reaction> chemical() {
            return reactions.stream().filter(r -> !"physical".equals(r.type())).toList();
        }
    }

    /**
     * What a vessel holds once a mix has settled: enough to pour it into another vessel, or filter it,
     * and carry on from there. {@code mol} is every species still present; the ones named in
     * {@code solidKeys} are undissolved solids. {@code solids} are solids with no species of their own
     * (precipitates, metal deposits, ash), formula to mol. {@code parked} is what was dissolved when the
     * water was boiled away: the ions (and anything else) sitting in the dry crystals, species to mol,
     * which go straight back into solution when water is added. {@code portions} are the shelf items that
     * went in, scaled to the share that is here, kept for the rules that look things up by ingredient.
     */
    public record State(Map<String, Double> mol, java.util.Set<String> solidKeys, Map<String, Double> solids,
            Map<String, Double> parked, double aqMl, double organicMl, List<Portion> portions, Colour colour) {

        public boolean isEmpty() {
            return mol.isEmpty() && solids.isEmpty() && parked.isEmpty();
        }

        public double liquidMl() {
            return aqMl + organicMl;
        }

        /** The salts sitting in the dry crystals, by name, most plentiful pairing first. */
        public List<String> dryCrystals() {
            return Evaporation.pair(parked, List.of()).stream().map(Evaporation.Salt::name).toList();
        }

        public boolean hasSolid() {
            return !solids.isEmpty() || !solidKeys.isEmpty() || !parked.isEmpty();
        }

        /**
         * The share of this mixture that goes on to the next vessel.
         *
         * @param keep "all", "filtrate" (what runs through the filter paper) or "residue" (what stays on it)
         */
        public State part(String keep, double fraction) {
            double f = clamp(fraction, 0, 1);
            boolean liquid = !"residue".equals(keep);
            boolean solid = !"filtrate".equals(keep);
            Map<String, Double> m = new LinkedHashMap<>();
            java.util.Set<String> keys = new java.util.LinkedHashSet<>();
            mol.forEach((k, v) -> {
                boolean isSolid = solidKeys.contains(k);
                if (isSolid ? !solid : !liquid) return;
                m.put(k, v * f);
                if (isSolid) keys.add(k);
            });
            Map<String, Double> s = new LinkedHashMap<>();
            if (solid) solids.forEach((k, v) -> s.put(k, v * f));
            // dry crystals are a solid: they stay on the filter paper
            Map<String, Double> dry = new LinkedHashMap<>();
            if (solid) parked.forEach((k, v) -> dry.put(k, v * f));
            List<Portion> ps = new ArrayList<>();
            for (Portion p : portions) {
                Substance sub = p.substance();
                boolean solidPortion = sub.isSolid() || sub.isElement() && "liquid".equals(sub.form());
                if (!liquid && !solidPortion) continue;
                ps.add(new Portion(sub, p.amount() * f));
            }
            return new State(m, keys, s, dry, liquid ? aqMl * f : 0, liquid ? organicMl * f : 0, ps, liquid ? colour : null);
        }

        /** Two mixtures poured into one vessel. */
        public State plus(State other) {
            Map<String, Double> m = new LinkedHashMap<>(mol);
            other.mol.forEach((k, v) -> m.merge(k, v, Double::sum));
            java.util.Set<String> keys = new java.util.LinkedHashSet<>(solidKeys);
            keys.addAll(other.solidKeys);
            Map<String, Double> s = new LinkedHashMap<>(solids);
            other.solids.forEach((k, v) -> s.merge(k, v, Double::sum));
            Map<String, Double> dry = new LinkedHashMap<>(parked);
            other.parked.forEach((k, v) -> dry.merge(k, v, Double::sum));
            List<Portion> ps = new ArrayList<>(portions);
            ps.addAll(other.portions);
            Colour c = colour == null ? other.colour : other.colour == null ? colour
                    : Colour.blend(List.of(colour, other.colour), List.of(Math.max(liquidMl(), 1e-6), Math.max(other.liquidMl(), 1e-6)));
            return new State(m, keys, s, dry, aqMl + other.aqMl, organicMl + other.organicMl, merge(ps), c);
        }
    }

    public Result run(List<Portion> portions, double temperatureC) {
        return run(portions, temperatureC, false);
    }

    /** @param ignition a flame or spark has been applied to the mixture */
    public Result run(List<Portion> portions, double temperatureC, boolean ignition) {
        return run(null, portions, temperatureC, ignition);
    }

    /**
     * @param base what the vessel already holds from an earlier mix (poured in, filtered, or split), or null for
     *        an empty vessel. The new portions are added to it and every rule runs on the combined contents.
     */
    public Result run(State base, List<Portion> portions, double temperatureC, boolean ignition) {
        return run(base, portions, temperatureC, ignition, false);
    }

    /**
     * @param evaporate once everything has reacted, the vessel goes over a burner until all the water has
     *        boiled away. What was dissolved is left as dry crystals; a mixture that must not be boiled dry
     *        (still acidic, flammable, giving off toxic fumes) comes back as a procedure mismatch, unchanged.
     */
    public Result run(State base, List<Portion> portions, double temperatureC, boolean ignition, boolean evaporate) {
        Latex.resetRecent();
        return new Run(base == null || base.isEmpty() ? null : base, merge(portions), temperatureC, ignition, evaporate).execute();
    }

    /**
     * Shelf solids that simply fall apart into one kind of cation and one kind of anion in water, as
     * "cation|anion" to the species key of the solid. Boiled dry, those two ions come back as that same
     * shelf chemical, so the crystals do everything the bottle on the shelf does.
     */
    private final Map<String, String> shelfSalts;

    private static Map<String, String> shelfSalts(Catalogue catalogue) {
        Map<String, Map<String, Double>> dissolving = new LinkedHashMap<>();
        dissolving.put("CuSO4·5H2O(s)", Map.of("Cu^2+", 1.0, "SO4^2-", 1.0));
        dissolving.put("KNO3(s)", Map.of("K+", 1.0, "NO3-", 1.0));
        dissolving.put("KMnO4(s)", Map.of("K+", 1.0, "MnO4-", 1.0));
        dissolving.putAll(Run.SOLUBLE_SOLIDS);
        Phases.SOLUBLE.forEach((k, sol) -> dissolving.putIfAbsent(k, sol.ions()));
        Map<String, String> out = new LinkedHashMap<>();
        dissolving.forEach((key, ions) -> {
            if (ions.size() != 2 || !key.endsWith("(s)")) return;
            String cation = ions.keySet().stream().filter(Evaporation.CATIONS::containsKey).findFirst().orElse(null);
            String anion = ions.keySet().stream().filter(Evaporation.ANIONS::containsKey).findFirst().orElse(null);
            if (cation == null || anion == null) return;
            Evaporation.Ion c = Evaporation.CATIONS.get(cation);
            Evaporation.Ion a = Evaporation.ANIONS.get(anion);
            int g = Latex.gcd(c.charge(), a.charge());
            // one formula unit of the solid must be exactly one formula unit of the salt
            if (Math.abs(ions.get(cation) - a.charge() / g) > 1e-9 || Math.abs(ions.get(anion) - c.charge() / g) > 1e-9) return;
            if (catalogue.solidFor(key.substring(0, key.length() - 3)).isEmpty()) return;
            out.putIfAbsent(cation + "|" + anion, key);
        });
        return java.util.Collections.unmodifiableMap(out);
    }

    private static List<Portion> merge(List<Portion> portions) {
        Map<String, Portion> merged = new LinkedHashMap<>();
        for (Portion p : portions) {
            merged.merge(p.substance().id(), p, (x, y) -> new Portion(x.substance(), x.amount() + y.amount()));
        }
        return new ArrayList<>(merged.values());
    }

    // ------------------------------------------------------------------------------------------

    private final class Run implements MixtureOps {
        /** Everything in the vessel: what was carried in (scaled to the share that came) plus what is added now. */
        final List<Portion> portions;
        /** Only what is added in this stage. */
        final List<Portion> fresh;
        final State base;
        final java.util.Set<String> denseLiquidKeys = new java.util.HashSet<>();
        final double tempC;
        final double tf;
        final boolean ignition;
        /** The vessel goes over a burner at the end until the water has all boiled away. */
        final boolean evaporate;
        /** It did: there is no liquid left, only what the water was carrying. */
        boolean boiledDry;
        /** Dissolved species sitting in dry crystals, waiting for water. */
        final Map<String, Double> parked = new LinkedHashMap<>();
        /** Shelf solids that came out of solution when it was boiled dry: formula to mol. */
        final Map<String, Double> dried = new LinkedHashMap<>();
        /** Formulas listed as products only so they can be named: they are carried on as parked ions, not as solids. */
        final java.util.Set<String> namedOnly = new java.util.HashSet<>();
        double gasMl;
        boolean bleached;
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

        Run(State base, List<Portion> fresh, double tempC, boolean ignition, boolean evaporate) {
            this.base = base;
            this.fresh = fresh;
            this.tempC = tempC;
            this.ignition = ignition;
            this.evaporate = evaporate;
            this.tf = Math.pow(2.0, (tempC - 25.0) / 10.0);
            if (base == null) {
                this.portions = fresh;
            } else {
                List<Portion> all = new ArrayList<>(base.portions());
                seed(base, all);
                all.addAll(fresh);
                this.portions = merge(all);
            }
            for (Portion p : portions) {
                Substance s = p.substance();
                if (s.acid() != null) hadAcid = true;
                if (s.base() != null || s.carbonate() != null && !s.isSolid()) hadBase = true;
            }
            for (Portion p : fresh) {
                Substance s = p.substance();
                if (s.isGas()) {
                    gasMl += p.amount();
                    double n = p.amount() / RTP_ML_PER_MOL;
                    s.species().forEach((k, coef) -> add(k, coef * n));
                    continue;
                }
                if (s.isElement() && "liquid".equals(s.form())) {
                    double density = "Hg".equals(s.element().symbol()) ? 13.53 : 3.10;
                    double n = p.amount() * density / s.molarMass();
                    s.species().forEach((k, coef) -> {
                        add(k, coef * n);
                        solidTarget.put(k, "solid:" + s.id());
                        solidInitial.merge(k, coef * n, Double::sum);
                        denseLiquidKeys.add(k);
                    });
                    continue;
                }
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

        // ---------------------------------------------------------------- carried in from an earlier vessel

        /** Starts this run from what an earlier mix left behind, instead of from an empty vessel. */
        void seed(State b, List<Portion> all) {
            aqMl = b.aqMl();
            organicMl = b.organicMl();
            b.mol().forEach(mol::put);
            b.parked().forEach((k, v) -> parked.merge(k, v, Double::sum));
            for (String key : b.solidKeys()) {
                double n = b.mol().getOrDefault(key, 0.0);
                if (n <= EPS) continue;
                String formula = bare(key);
                // Drawn as a settled solid: the page only draws shelf solids that were added in this stage.
                solidTarget.put(key, "precipitate:" + formula);
                solidInitial.put(key, n);
                String hex = b.portions().stream().map(Portion::substance).filter(s -> s.species().containsKey(key))
                        .map(Substance::colour).findFirst().orElse(null);
                carriedCue(formula, n, hex);
            }
            b.solids().forEach((formula, n) -> {
                if (n <= EPS) return;
                // A precipitate that is also on the shelf (chalk, magnesium oxide, copper...) becomes that chemical,
                // so everything the shelf version does, the one made here does too.
                Substance shelf = catalogue.solidFor(formula).orElse(null);
                if (shelf != null && shelf.molarMass() != null) {
                    String key = formula + "(s)";
                    add(key, n);
                    solidTarget.putIfAbsent(key, "precipitate:" + formula);
                    solidInitial.merge(key, n, Double::sum);
                    all.add(new Portion(shelf, n * shelf.molarMass()));
                    carriedCue(formula, n, Lore.colour(formula) != null ? Lore.colour(formula) : shelf.colour());
                } else {
                    precipitates.merge(formula, n, Double::sum);
                    carriedCue(formula, n, Lore.colour(formula));
                }
            });
        }

        void carriedCue(String formula, double n, String hex) {
            Map<String, Object> c = cue("precipitate", "vessel", 0);
            c.put("id", formula);
            c.put("colour", Colour.hex(hex == null ? "#e6e6e2" : hex, 0.95).toJson());
            c.put("turbidity", round(clamp(n / Math.max(litres(), 0.02) * 30, 0.12, 0.92), 3));
            c.put("settleMs", 0);
            c.put("carried", true);
        }

        /**
         * Precipitated hydroxides and carbonates that have no shelf form still dissolve when acid is added to
         * them later (copper(II) hydroxide on a filter paper, say). Only solids carried in can be here this early.
         */
        void carriedSolidsWithAcid() {
            if (base == null || aqMl <= 0) return;
            for (Hydroxide h : HYDROXIDES) {
                double n = precipitates.getOrDefault(h.solid(), 0.0);
                if (n <= EPS || acidAvailable() <= EPS) continue;
                double[] t = consumeAcid(h.charge() * n);
                double e = (t[0] + t[1]) / h.charge();
                if (e <= EPS) continue;
                precipitates.merge(h.solid(), -e, Double::sum);
                add(h.cation(), e);
                product("H2O", h.charge() * e, "l");
                heatJ += 40_000 * h.charge() * e;
                long start = nextStart();
                Map<String, Object> c = cue("dissolve", "precipitate:" + h.solid(), start);
                c.put("durationMs", 3000L);
                c.put("fraction", round(e / n, 3));
                reaction("hydroxide-acid-" + h.symbol().toLowerCase(Locale.ROOT) + h.charge(),
                        elementName(h.symbol()) + " hydroxide dissolves in acid", "neutralisation",
                        Latex.eq(h.solid() + "(s) + " + coef(h.charge()) + "H^+ -> " + ion(h.symbol(), h.charge()) + " + "
                                + coef(h.charge()) + "H2O(l)"),
                        null, e);
                observations.add("The " + h.colourWord() + " solid " + (e >= n - EPS ? "dissolves away" : "partly dissolves")
                        + " as the acid neutralises it: an insoluble base still reacts with an acid to make a salt and water.");
            }
            for (Ppt p : INSOLUBLE) {
                if (!"CO3^2-".equals(p.anion())) continue;
                double n = precipitates.getOrDefault(p.solid(), 0.0);
                if (n <= EPS || acidAvailable() <= EPS) continue;
                int cations = p.cCharge() == 1 ? 2 : 1;
                double[] t = consumeAcid(2 * n);
                double e = (t[0] + t[1]) / 2;
                if (e <= EPS) continue;
                precipitates.merge(p.solid(), -e, Double::sum);
                add(p.cation(), cations * e);
                product("H2O", e, "l");
                long start = nextStart();
                gas("CO2", e, "vessel", 1.0, "medium", start);
                Map<String, Object> c = cue("dissolve", "precipitate:" + p.solid(), start);
                c.put("durationMs", 3500L);
                c.put("fraction", round(e / n, 3));
                String sym = p.cation().replaceAll("[\\^0-9+]", "");
                reaction("carbonate-acid-" + p.solid().toLowerCase(Locale.ROOT), p.name() + " fizzes in acid", "gas",
                        Latex.eq(p.solid() + "(s) + 2 H^+ -> " + coef(cations) + ion(sym, p.cCharge()) + " + CO2(g) + H2O(l)"),
                        "acid-carbonate", e);
                observations.add("The " + p.word() + " solid fizzes and " + (e >= n - EPS ? "disappears" : "shrinks")
                        + ": like every carbonate, " + p.name().toLowerCase(Locale.ROOT) + " gives carbon dioxide with an acid.");
            }
        }

        private static String coef(int n) {
            return n == 1 ? "" : n + " ";
        }

        private static String ion(String symbol, int charge) {
            return symbol + (charge == 1 ? "^+" : "^" + charge + "+");
        }

        /** What this run leaves in the vessel, for the next stage to start from. */
        State state(Colour endColour) {
            Map<String, Double> held = new LinkedHashMap<>();
            java.util.Set<String> solidKeys = new java.util.LinkedHashSet<>();
            mol.forEach((k, v) -> {
                if (v <= EPS || k.endsWith("(g)")) return;
                held.put(k, v);
                if (isSolidKey(k)) solidKeys.add(k);
            });
            Map<String, Double> solids = new LinkedHashMap<>();
            precipitates.forEach((k, v) -> { if (v > EPS) solids.put(k, v); });
            for (Product p : products.values()) {
                if (!"s".equals(p.phase()) || p.mol() <= EPS || precipitates.containsKey(p.formula())) continue;
                if ("CuSO4·5H2O".equals(p.formula()) && (aqMl > 0 || boiledDry)) continue; // it dissolved: the ions are in mol
                if (dried.containsKey(p.formula()) || namedOnly.contains(p.formula())) continue; // counted below, once
                solids.merge(p.formula(), p.mol(), Double::sum);
            }
            dried.forEach((k, v) -> { if (v > EPS) solids.merge(k, v, Double::sum); });
            Map<String, Double> dry = new LinkedHashMap<>();
            parked.forEach((k, v) -> { if (v > EPS) dry.put(k, v); });
            List<Portion> kept = portions.stream().filter(p -> !p.substance().isGas() && (!boiledDry || staysWhenDry(p))).toList();
            return new State(held, solidKeys, solids, dry, aqMl, organicMl, kept, aqMl > 0 ? endColour : null);
        }

        /**
         * Boiled dry, the liquids that went in are gone, and so is any shelf solid that dissolved completely:
         * if it came back out as crystals, it is carried on as that solid, not as the ingredient.
         */
        boolean staysWhenDry(Portion p) {
            Substance s = p.substance();
            if (s.isElement() && "liquid".equals(s.form())) return true;
            if (!s.isSolid()) return false;
            return s.species().keySet().stream().anyMatch(k -> isSolidKey(k) && get(k) > EPS);
        }

        boolean isSolidKey(String k) {
            return k.endsWith("(s)") || k.endsWith("(anh)") || "org:wax".equals(k) || denseLiquidKeys.contains(k);
        }

        static String bare(String key) {
            return key.replace("(s)", "").replace("(anh)", "");
        }

        // ---------------------------------------------------------------- bookkeeping

        // MixtureOps
        @Override public List<Portion> portions() { return portions; }
        @Override public double tempC() { return tempC; }
        @Override public boolean ignition() { return ignition; }
        @Override public double aqMl() { return aqMl; }
        @Override public void heat(double joules) { heatJ += joules; }
        @Override public String solidTarget(String key) { return solidTarget.get(key); }
        @Override public void observe(String text) { observations.add(text); }
        @Override public void reason(String text) { reasons.add(text); }
        @Override public void pending(String code, String tool, String message) { pending.add(new Pending(code, tool, message)); }
        @Override public void pending(String code, String tool, String message, String ref) {
            pending.add(new Pending(code, tool, message, ref));
        }
        @Override public double organicMl() { return organicMl; }
        @Override public java.util.Set<String> keys() {
            java.util.Set<String> out = new java.util.LinkedHashSet<>();
            mol.forEach((k, v) -> { if (v > EPS) out.add(k); });
            return out;
        }
        @Override public Map<String, Double> precipitates() { return precipitates; }
        @Override public void park(String key, double n) { if (n > 0) parked.merge(key, n, Double::sum); }
        @Override public java.util.Set<String> driedKeys() {
            java.util.Set<String> out = new java.util.LinkedHashSet<>();
            parked.forEach((k, v) -> { if (v > EPS) out.add(k); });
            return out;
        }
        @Override public double solidInitial(String key) { return solidInitial.getOrDefault(key, 0.0); }
        @Override public List<String> reasons() { return reasons; }
        @Override public boolean presentTag(String tag) {
            return portions.stream().anyMatch(p -> p.substance().hasTag(tag));
        }
        @Override public boolean hadAcid() { return hadAcid; }
        @Override public void bleach() { bleached = true; }
        @Override public Catalogue catalogue() { return catalogue; }

        @Override public double get(String k) { return mol.getOrDefault(k, 0.0); }
        @Override public boolean has(String k) { return get(k) > EPS; }
        @Override public void add(String k, double v) { mol.merge(k, v, Double::sum); }
        @Override public double take(String k, double v) {
            double cur = get(k);
            double t = Math.max(0, Math.min(cur, v));
            mol.put(k, cur - t);
            return t;
        }
        @Override public double molar(String k) { return aqMl <= 0 ? 0 : get(k) / (aqMl / 1000.0); }
        double litres() { return Math.max(aqMl, 1e-6) / 1000.0; }

        @Override public boolean present(String substanceId) {
            return portions.stream().anyMatch(p -> p.substance().id().equals(substanceId));
        }

        @Override
        public void product(String formula, double n, String phase) {
            products.merge(formula, new Product(formula, n, phase),
                    (a, b) -> new Product(a.formula(), a.mol() + b.mol(), a.phase()));
        }

        @Override
        public long nextStart() {
            return Math.min(1500, 220L * reactionIndex++);
        }

        @Override
        public void reaction(String id, String name, String type, String eq, String discovery, double extent) {
            reactions.add(new Reaction(id, name, type, eq, discovery, extent, Latex.structured(eq)));
        }

        @Override
        public Map<String, Object> cue(String kind, String target, long startMs) {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("kind", kind);
            c.put("target", target);
            c.put("startMs", startMs);
            cues.add(c);
            return c;
        }

        @Override
        public void gas(String gas, double n, String target, double k, String bubble, long startMs) {
            gases.merge(gas, n, Double::sum);
            product(gas, n, "g");
            double rate = clamp(Math.sqrt(n * 1e4) * 14 * k * tf, 4, 140);
            long duration = (long) clamp(9000 / Math.max(0.05, k * tf), 2200, 14000);
            Map<String, Object> c = cue("gas", target == null ? "vessel" : target, startMs);
            c.put("ratePerS", round(rate, 1));
            c.put("bubble", bubble);
            c.put("gas", gas);
            c.put("durationMs", duration);
            Lore.Gas info = Lore.GASES.get(gas);
            if (info != null) {
                if (info.colourHex() != null) c.put("colour", Colour.hex(info.colourHex(), 0.7).toJson());
                c.put("smell", info.smell());
            }
            String hazard = Lore.GAS_HAZARD.get(gas);
            if (hazard != null) {
                c.put("hazard", hazard);
                c.put("warning", Lore.GAS_WARNING.get(gas));
            }
            // how it answers a splint or damp litmus, so the bench can show the test without guessing
            Lore.GasTests tests = Lore.GAS_TESTS.get(gas);
            if (tests != null) c.put("tests", tests);
        }

        @Override
        public void precipitate(String formula, double n, String hex, long startMs, long settleMs) {
            precipitates.merge(formula, n, Double::sum);
            pptFormed.merge(formula, n, Double::sum);
            product(formula, n, "s");
            double turbidity = clamp(n / litres() * 30, 0.12, 0.92);
            Map<String, Object> c = cue("precipitate", "vessel", startMs);
            c.put("id", formula);
            c.put("colour", Colour.hex(hex, 0.95).toJson());
            c.put("turbidity", round(turbidity, 3));
            c.put("settleMs", settleMs);
            // Lead(II) iodide comes out as glittering golden plates rather than a powder.
            if ("PbI2".equals(formula)) c.put("form", "crystals");
        }

        @Override
        public void dissolveSolid(String speciesKey, double startMs, long durationMs) {
            String target = solidTarget.get(speciesKey);
            if (target == null) return;
            double initial = solidInitial.getOrDefault(speciesKey, 0.0);
            double left = get(speciesKey);
            double fraction = initial <= 0 ? 1 : clamp(1 - left / initial, 0, 1);
            Map<String, Object> c = cue("dissolve", target, (long) startMs);
            c.put("durationMs", durationMs);
            c.put("fraction", round(fraction, 3));
        }

        /** Takes protons from strong acid first, then the weak acids (strongest first). Returns {strong, weak}. */
        @Override public double[] consumeAcid(double protons) {
            double strong = take("H+", protons);
            double weak = 0;
            for (Acids.Weak w : Acids.WEAK) {
                if (!w.reactive() || protons - strong - weak <= EPS) continue;
                double t = take(w.key(), protons - strong - weak);
                if (t > 0) add(w.conj(), t / w.perAnion());
                weak += t;
            }
            return new double[] {strong, weak};
        }

        @Override public double acidAvailable() { return get("H+") + weakAcid(); }

        /** Moles of acidic protons held by reactive weak acids. */
        double weakAcid() {
            double n = 0;
            for (Acids.Weak w : Acids.WEAK) if (w.reactive()) n += get(w.key());
            return n;
        }

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
                        List.of(), List.of(), List.of(), List.of(), gap, null);
            }
            Colour startColour = startColour();

            rewet();
            physical();
            Phases.dissolve(this);
            ElementRules.apply(this);
            hydration();
            Inorganic.early(this);
            neutralise();
            carbonates();
            carriedSolidsWithAcid();
            Inorganic.afterAcidBase(this);
            Phases.acidCrystals(this);
            metalsWithAcid();
            Inorganic.amphotericMetals(this);
            sulfideWithAcid();
            oxideWithAcid();
            thiosulfateWithAcid();
            Organic.beforeOxidants(this);
            Inorganic.redox(this);
            permanganate();
            peroxide();
            iron3();
            halogens();
            copperIodide();
            iodine();
            displacement();
            precipitation();
            Organic.tests(this);
            magnesiumWater();
            starchIodine();
            Inorganic.heat(this);
            Organic.combustion(this);
            heating();
            Phases.describe(this);

            // Ammonium + hydroxide re-form ammonia (keeps ammonia mixtures at a realistic pH ~ 9-11).
            double nh = Math.min(get("NH4+"), get("OH-"));
            if (nh > EPS) {
                take("NH4+", nh);
                take("OH-", nh);
                add("NH3", nh);
            }

            double ph = ph();
            indicators(ph);
            if (evaporate) boilDry(ph);
            return finish(startColour, boiledDry ? Double.NaN : ph);
        }

        // ---------------------------------------------------------------- dry crystals and water

        /**
         * Crystals left by boiling a solution dry are drawn as a solid. If there is water in the vessel now,
         * they dissolve straight back into it: everything that was parked in them is in solution again.
         */
        void rewet() {
            if (parked.isEmpty()) return;
            List<Evaporation.Salt> salts = Evaporation.pair(parked, List.of());
            for (Evaporation.Salt salt : salts) {
                Lore.register(salt.formula(), capitalise(salt.name()), salt.hex());
                carriedCue(salt.formula(), salt.mol(), salt.hex());
            }
            boolean syrup = parked.entrySet().stream().anyMatch(e -> Evaporation.syrup(e.getKey()) && e.getValue() > 1e-5);
            if (syrup) carriedCue("syrup", 0.01, Evaporation.SYRUP_HEX);
            if (aqMl <= 0) return;
            parked.forEach(this::add);
            parked.clear();
            for (Evaporation.Salt salt : salts) redissolveCue(salt.formula());
            if (syrup) redissolveCue("syrup");
            if (!salts.isEmpty() || syrup) {
                observations.add("The dry " + (salts.isEmpty() ? "residue dissolves" : "crystals dissolve") + " again as the water goes in: "
                        + "boiling the water away did not change what was dissolved in it.");
            }
        }

        void redissolveCue(String id) {
            Map<String, Object> c = cue("dissolve", "precipitate:" + id, 0);
            c.put("durationMs", 2600L);
            c.put("fraction", 1.0);
        }

        static String capitalise(String text) {
            return text.isEmpty() ? text : Character.toUpperCase(text.charAt(0)) + text.substring(1);
        }

        /**
         * The evaporating basin: everything has reacted, and now the water is boiled away over a burner.
         * Volatile things leave with the steam, pairs of ions come out as crystals of their salt, and anything
         * else that was dissolved stays behind in the residue until water is added again.
         */
        void boilDry(double ph) {
            String[] no = Evaporation.refusal(this, ph);
            if (no != null) {
                mismatches.add(new Mismatch(no[0], no[1]));
                return;
            }
            double waterMl = aqMl;
            List<Map<String, Object>> residue = new ArrayList<>();
            List<String> left = new ArrayList<>();

            // Hard water: boiling drives carbon dioxide out of the hydrogencarbonate, and limescale is left.
            for (Ppt p : INSOLUBLE) {
                if (!"CO3^2-".equals(p.anion()) || p.cCharge() != 2) continue;
                double e = Math.min(get(p.cation()), get("HCO3-") / 2);
                if (e <= Evaporation.TRACE) continue;
                take(p.cation(), e);
                take("HCO3-", 2 * e);
                precipitates.merge(p.solid(), e, Double::sum);
                product(p.solid(), e, "s");
                residue.add(residueEntry(p.solid(), p.name().toLowerCase(Locale.ROOT), p.hex(), e));
                left.add("a " + p.word() + " crust of " + p.name().toLowerCase(Locale.ROOT)
                        + ("CaCO3".equals(p.solid()) ? " (limescale, the same thing that furs up a kettle)" : ""));
            }

            // A trace of a volatile acid goes off with the steam, and so does every dissolved gas.
            for (String anion : Evaporation.VOLATILE_ACID_ANIONS) {
                double t = Math.min(get("H+"), get(anion));
                if (t <= 0) continue;
                take("H+", t);
                take(anion, t);
            }
            boolean ammonia = get("NH3") > 1e-4;
            boolean vinegar = get("CH3COOH") > 1e-4;
            for (String k : new ArrayList<>(mol.keySet())) if (Evaporation.volatileKey(k) && !isSolidKey(k)) mol.remove(k);

            // Everything still dissolved comes out of solution.
            Map<String, Double> dissolved = new LinkedHashMap<>();
            mol.forEach((k, v) -> { if (v > EPS && !isSolidKey(k)) dissolved.put(k, v); });
            new ArrayList<>(mol.keySet()).forEach(k -> { if (!isSolidKey(k)) mol.remove(k); });
            Map<String, String> shelf = shelfSalts;
            double crystals = 0;
            for (Evaporation.Salt salt : Evaporation.pair(dissolved, new ArrayList<>(shelf.keySet()))) {
                dissolved.merge(salt.cation().key(), -salt.mol() * salt.cations(), Double::sum);
                dissolved.merge(salt.anion().key(), -salt.mol() * salt.anions(), Double::sum);
                String shelfKey = shelf.get(salt.cation().key() + "|" + salt.anion().key());
                Substance bottle = shelfKey == null ? null : catalogue.solidFor(bare(shelfKey)).orElse(null);
                String formula;
                String hex;
                if (bottle != null) {
                    // the same chemical as the bottle on the shelf: carried on as that solid
                    formula = bare(shelfKey);
                    hex = bottle.colour() != null ? bottle.colour() : salt.hex();
                    dried.merge(formula, salt.mol(), Double::sum);
                } else {
                    formula = salt.formula();
                    hex = salt.hex();
                    parked.merge(salt.cation().key(), salt.mol() * salt.cations(), Double::sum);
                    parked.merge(salt.anion().key(), salt.mol() * salt.anions(), Double::sum);
                    namedOnly.add(formula);
                    Lore.register(formula, capitalise(salt.name()), hex);
                }
                product(formula, salt.mol(), "s");
                crystals += salt.mol();
                residue.add(residueEntry(formula, salt.name(), hex, salt.mol()));
                left.add(colourOf(hex) + " crystals of " + salt.name());
            }
            // What is left over (ions with no partner, sugars, dyes, complexes) stays in the residue, exactly as much as there was.
            boolean syrup = false;
            boolean other = false;
            for (Map.Entry<String, Double> e : dissolved.entrySet()) {
                if (e.getValue() <= EPS) continue;
                parked.merge(e.getKey(), e.getValue(), Double::sum);
                if (Evaporation.syrup(e.getKey()) && e.getValue() > 1e-5) syrup = true;
                else if (e.getValue() > 1e-4 && !e.getKey().startsWith("ind:")) other = true;
            }
            if (syrup) {
                residue.add(residueEntry("syrup", "sugar syrup", Evaporation.SYRUP_HEX, 0.01));
                left.add("a sticky golden syrup that browns at the edges (sugar does not crystallise cleanly when it is boiled dry: it starts to caramelise)");
            } else if (other && left.isEmpty()) {
                residue.add(residueEntry("residue", "dried residue", "#e2ddd0", 0.005));
                left.add("a thin, dull film of dried residue");
            }

            aqMl = 0;
            boiledDry = true;
            Map<String, Object> c = cue("evaporate", "vessel", 0);
            c.put("durationMs", 9000L);
            c.put("volumeMl", round(waterMl, 1));
            c.put("residue", residue);
            reaction("evaporate-to-dryness", "Evaporating to dryness", "physical",
                    "\\text{solution} \\xrightarrow{\\text{heat}} \\text{crystals} + \\text{steam}",
                    crystals > Evaporation.TRACE ? "crystallisation" : null, Math.max(crystals, 1e-6));
            if (left.isEmpty()) {
                observations.add("The water boils away as steam and nothing at all is left behind: there was nothing dissolved in it.");
            } else {
                String list = left.size() == 1 ? left.get(0)
                        : String.join(", ", left.subList(0, left.size() - 1)) + " and " + left.get(left.size() - 1);
                observations.add("The water boils away as steam, leaving " + list + " in the basin.");
                if (crystals > Evaporation.TRACE) {
                    observations.add("Evaporating separates a dissolved solid from the water it was dissolved in. It is a physical change: "
                            + "add water and the crystals dissolve again.");
                }
            }
            if (ammonia) observations.add("The sharp smell of ammonia comes off with the steam: dissolved gases leave long before the water has gone.");
            if (vinegar) observations.add("The steam smells of vinegar: ethanoic acid boils away with the water.");
        }

        Map<String, Object> residueEntry(String formula, String name, String hex, double n) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", formula);
            r.put("name", name);
            r.put("colour", Colour.hex(hex, 1).toJson());
            r.put("amount", round(clamp(n * 60, 0.15, 1), 2));
            return r;
        }

        /** A plain word for a crystal's colour, from its hue: what a student would write in their notes. */
        static String colourOf(String hex) {
            int v;
            try {
                v = Integer.parseInt(hex.substring(1), 16);
            } catch (RuntimeException e) {
                return "white";
            }
            double r = ((v >> 16) & 255) / 255.0, g = ((v >> 8) & 255) / 255.0, b = (v & 255) / 255.0;
            double max = Math.max(r, Math.max(g, b)), min = Math.min(r, Math.min(g, b));
            double light = (max + min) / 2, spread = max - min;
            double sat = spread < 1e-9 ? 0 : spread / (1 - Math.abs(2 * light - 1));
            if (sat < 0.18 || light > 0.9) return light > 0.75 ? "white" : light < 0.25 ? "black" : "grey";
            double hue = max == r ? ((g - b) / spread + 6) % 6 : max == g ? (b - r) / spread + 2 : (r - g) / spread + 4;
            hue *= 60;
            String name = hue < 18 || hue >= 345 ? "red" : hue < 42 ? (light < 0.5 ? "brown" : "orange") : hue < 68 ? "yellow"
                    : hue < 165 ? "green" : hue < 195 ? "blue-green" : hue < 255 ? "blue" : hue < 300 ? "purple" : "pink";
            return light < 0.22 ? "dark " + name : light > 0.72 ? "pale " + name : name;
        }

        /**
         * Every catalogued combination is modelled by a rule family or described physically. The only
         * honest exception: superheavy elements, of which only a few atoms have ever existed.
         */
        String coverage() {
            for (Portion p : portions) {
                Substance s = p.substance();
                if (s.isElement() && s.element().superheavy()) return ElementRules.superheavyMessage(s);
            }
            for (int i = 0; i < portions.size(); i++) {
                for (int j = i + 1; j < portions.size(); j++) {
                    Substance a = portions.get(i).substance();
                    Substance b = portions.get(j).substance();
                    if (catalogue.isGap(a.id(), b.id())) {
                        return "LABscape has no validated model for " + a.displayName() + " with " + b.displayName() + ".";
                    }
                }
            }
            return null;
        }

        Colour startColour() {
            List<Colour> cs = new ArrayList<>();
            List<Double> ws = new ArrayList<>();
            if (base != null && base.colour() != null && base.aqMl() > 0) {
                cs.add(base.colour());
                ws.add(base.aqMl() * (0.15 + base.colour().alpha()));
            }
            for (Portion p : fresh) {
                Substance s = p.substance();
                if (s.isSolid() || s.isGas() || s.isElement()) continue;
                String mix = s.waterMiscibility();
                if (aqMl > 0 && ("immiscible".equals(mix) || "partial".equals(mix))) continue;
                double ml = volumeMl(p);
                cs.add(Colour.hex(s.colour(), s.opacity()));
                ws.add(ml * (0.15 + s.opacity()));
            }
            return cs.isEmpty() ? null : Colour.blend(cs, ws);
        }

        // ---------------------------------------------------------------- physical changes

        /** Household solids that simply dissolve into their ions: key -> {ion: count}. */
        static final Map<String, Map<String, Double>> SOLUBLE_SOLIDS = Map.of(
                "NaHCO3(s)", Map.of("Na+", 1.0, "HCO3-", 1.0),
                "Na2CO3(s)", Map.of("Na+", 2.0, "CO3^2-", 1.0),
                "NaCl(s)", Map.of("Na+", 1.0, "Cl-", 1.0),
                "MgSO4(s)", Map.of("Mg^2+", 1.0, "SO4^2-", 1.0));

        void physical() {
            if (aqMl > 0) {
                for (Map.Entry<String, Map<String, Double>> e : SOLUBLE_SOLIDS.entrySet()) {
                    if (!has(e.getKey())) continue;
                    double n = take(e.getKey(), get(e.getKey()));
                    e.getValue().forEach((ion, k) -> add(ion, k * n));
                    dissolveSolid(e.getKey(), 0, 2200);
                    if (acidAvailable() <= EPS || !e.getKey().contains("CO3")) {
                        observations.add("The white crystals dissolve and disappear into the water - a physical change.");
                    }
                }
            }
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
            if (aqMl > 0 && has("KNO3(s)")) {
                double n = take("KNO3(s)", get("KNO3(s)"));
                add("K+", n);
                add("NO3-", n);
                heatJ -= 34_900 * n;
                dissolveSolid("KNO3(s)", 0, 2400);
                observations.add("The potassium nitrate crystals dissolve, and the water gets a little colder.");
            }
            if (aqMl > 0 && has("NH4NO3(s)")) {
                double n = take("NH4NO3(s)", get("NH4NO3(s)"));
                add("NH4+", n);
                add("NO3-", n);
                heatJ -= 25_700 * n;
                dissolveSolid("NH4NO3(s)", 0, 2400);
                reaction("cold-pack", "Ammonium nitrate dissolves", "physical",
                        Latex.equation(List.of(Term.of(1, "NH4NO3", "s")),
                                List.of(Term.ion(1, "NH4", "+"), Term.ion(1, "NO3", "-")), null),
                        "cold-pack", n);
                observations.add("As the ammonium nitrate dissolves, the beaker gets noticeably cold - this takes in heat.");
            }
            boolean anyLiquid = aqMl > 0 || organicMl > 0;
            boolean anyGas = gasMl > 0;
            if (!anyLiquid && !anyGas && portions.size() > 1 && portions.stream().noneMatch(p -> p.substance().isElement())) {
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

            double e2 = 0;
            for (Acids.Weak w : Acids.WEAK) {
                double x = Math.min(get(w.key()), get("OH-"));
                if (x <= EPS) continue;
                take(w.key(), x);
                take("OH-", x);
                add(w.conj(), x / w.perAnion());
                heatJ += (w.reactive() ? 56_000 : 30_000) * x;
                e2 += x;
            }
            total += e2;

            double e3 = Math.min(get("NH3"), get("H+"));
            take("NH3", e3);
            take("H+", e3);
            add("NH4+", e3);
            heatJ += 52_000 * e3;
            total += e3;

            double e4 = 0;
            for (Acids.Weak w : Acids.WEAK) {
                if (!w.reactive()) continue;
                double x = Math.min(get("NH3"), get(w.key()));
                if (x <= EPS) continue;
                take("NH3", x);
                take(w.key(), x);
                add("NH4+", x);
                add(w.conj(), x / w.perAnion());
                heatJ += 50_000 * x;
                e4 += x;
            }
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
                if (acid != null && base != null) {
                    Substance.AcidInfo ai = acid.acid();
                    Latex.Salt salt = ammonia ? Latex.salt("NH4", 1, true, ai.anion(), ai.anionCharge(), ai.poly())
                            : Latex.salt(base.base().cation(), base.base().cationCharge(), false, ai.anion(), ai.anionCharge(), ai.poly());
                    String cationName = ammonia ? "Ammonium" : Elements.NAME.getOrDefault(base.base().cation(), base.base().cation());
                    Lore.register(salt.formula(), Lore.saltName(cationName, 1, false, ai.anion()), "#f4f4f2");
                    product(salt.formula(), total, "aq");
                }
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

            double e6 = Math.min(get("NH4+"), get("OH-"));
            boolean ammoniumSalt = portions.stream().anyMatch(p -> p.substance().hasTag("ammonium"));
            if (e6 > EPS && ammoniumSalt) {
                boolean warm = tempC >= 40 || present("nh4no3");
                take("NH4+", e6);
                take("OH-", e6);
                add("NH3", e6 * 0.5);
                if (warm) {
                    gas("NH3", e6 * 0.5, "vessel", 0.5 * tf, "fine", nextStart());
                    reaction("ammonia-release", "Ammonium salt + alkali", "gas",
                            Latex.equation(List.of(Term.ion(1, "NH4", "+"), Term.ion(1, "OH", "-")),
                                    List.of(Term.of(1, "NH3", "g"), Term.of(1, "H2O", "l")), null),
                            "ammonia-release", e6);
                    observations.add("A sharp, eye-watering smell of ammonia rises from the beaker - the test for ammonium ions. "
                            + "Damp red litmus held above it would turn blue.");
                } else {
                    nextStart();
                    Map<String, Object> c = cue("odour", "vessel", 400);
                    c.put("description", "a faint whiff of ammonia");
                    reaction("ammonium-alkali", "Ammonium ions meet hydroxide", "neutralisation",
                            Latex.eq("NH4^+ + OH^- -> NH3(aq) + H2O(l)"), null, e6);
                    observations.add("The alkali turns ammonium ions into dissolved ammonia - only a faint smell for now. "
                            + "Warm it to about 50 °C to drive off ammonia gas (the test for ammonium ions).");
                }
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
            double weakStart = weakAcid();
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
                Portion carbP = mainPortion(s -> s.carbonate() != null && !s.species().containsKey("CaCO3(s)"));
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
                boolean powder = present("caco3-powder") || present("antacid");
                Portion chipsP = mainPortion(s -> s.species().containsKey("CaCO3(s)"));
                String what = chipsP == null || "caco3-chips".equals(chipsP.substance().id()) ? "marble chips"
                        : chipsP.substance().name().toLowerCase(Locale.ROOT);
                double k = (t[0] >= t[1] ? 1.6 : 0.5) * (sulfuric ? 0.35 : 1) * (powder ? 3 : 1);
                gas("CO2", e, solidTarget.get("CaCO3(s)"), k, powder ? "medium" : "coarse", start);
                dissolveSolid("CaCO3(s)", start, (long) clamp(8000 / tf / (powder ? 3 : 1), 1500, 14000));
                Substance chipsS = catalogue.find("caco3-chips").orElseThrow();
                String eq = acid != null ? carbonateEquation(acid, chipsS)
                        : Latex.eq("CaCO3(s) + 2 H^+ -> Ca^2+ + H2O(l) + CO2(g)");
                reaction("acid-carbonate-chips", "Acid and " + what, "gas", eq, "acid-carbonate", e);
                observations.add(sulfuric
                        ? "The " + what + " fizz at first, then almost stop: insoluble calcium sulfate coats them and blocks the acid."
                        : powder ? "The powder fizzes rapidly - its large surface area makes the reaction much faster than with lumps."
                        : "The " + what + " fizz steadily, releasing carbon dioxide, and slowly get smaller.");
            }
            if (strongStart + weakStart <= EPS && has("CaCO3(s)") && aqMl > 0) {
                reasons.add("Calcium carbonate is insoluble in water - it needs an acid to react.");
            }
        }

        // ---------------------------------------------------------------- metals and oxides

        void metalsWithAcid() {
            Substance acid = mainAcid();
            List<Portion> metals = portions.stream().filter(p -> p.substance().metal() != null)
                    .sorted(Comparator.comparingDouble((Portion p) -> p.substance().metal().e0())).toList();
            for (Portion p : metals) {
                Substance s = p.substance();
                Substance.MetalInfo m = s.metal();
                String key = m.symbol() + "(s)";
                if (base != null && !has(key)) continue;
                if (m.acidRate() <= 0) {
                    boolean nitric = presentTag("nitric_acid") && m.e0() < 0.96;
                    if (hadAcid && !nitric) {
                        reasons.add(s.name() + " sits below hydrogen in the reactivity series, so it doesn't react with dilute acids"
                                + ("Au".equals(m.symbol()) || "Pt".equals(m.symbol()) ? " - not even nitric acid." : "."));
                    }
                    continue;
                }
                if (!has(key) || acidAvailable() <= EPS) continue;
                int c = m.charge();
                double n = get(key);
                boolean leadCoated = "Pb".equals(m.symbol()) && (has("Cl-") || has("SO4^2-"));
                if (leadCoated) n = Math.min(n, acidAvailable() * 0.02 / c);
                double[] t = consumeAcid(c * n);
                double e = (t[0] + t[1]) / c;
                if (e <= EPS) continue;
                take(key, e);
                add(ionKey(m.symbol(), c), e);
                heatJ += metalAcidHeat(m) * e;
                long start = nextStart();
                double strongShare = t[0] / (t[0] + t[1]);
                double k = m.acidRate() * (strongShare + 0.2 * (1 - strongShare));
                gas("H2", e * c / 2, solidTarget.get(key), k, "fine", start);
                dissolveSolid(key, start, (long) clamp(7000 / (k * tf), 1800, 14000));
                String eq;
                if (acid != null) {
                    Substance.AcidInfo a = acid.acid();
                    Latex.Salt salt = Latex.salt(m.symbol(), c, false, a.anion(), a.anionCharge(), a.poly());
                    // a M + b HnA -> s salt + h H2, balanced by scaling until every coefficient is whole.
                    int mult = 1;
                    int metalCoef = 0, acidCoef = 0, saltCoef = 0, h2 = 0;
                    for (; mult <= 12; mult++) {
                        int protons = c * mult;
                        if (protons % a.protons() != 0 || protons % 2 != 0 || mult % salt.cations() != 0) continue;
                        metalCoef = mult;
                        acidCoef = protons / a.protons();
                        saltCoef = mult / salt.cations();
                        h2 = protons / 2;
                        break;
                    }
                    String metalName = Elements.NAME.getOrDefault(m.symbol(), m.symbol());
                    Substance.ElementInfo info = Elements.INFO.get(m.symbol());
                    boolean variable = info != null && info.oxidationStates().stream().filter(o -> o > 0).count() > 1;
                    Lore.register(salt.formula(), Lore.saltName(metalName, c, variable, a.anion()), null);
                    product(salt.formula(), e / Math.max(1, salt.cations()), "aq");
                    eq = metalCoef == 0
                            ? Latex.equation(List.of(Term.of(1, m.symbol(), "s"), Term.ion(c, "H", "+")),
                                    List.of(Latex.ionTerm(1, ionKey(m.symbol(), c)), Term.of(1, "H2", "g")), null)
                            : Latex.equation(List.of(Term.of(metalCoef, m.symbol(), "s"), Term.of(acidCoef, acid.formula(), "aq")),
                                    List.of(Term.of(saltCoef, salt.formula(), "aq"), Term.of(h2, "H2", "g")), null);
                } else {
                    eq = Latex.equation(List.of(Term.of(2, m.symbol(), "s"), Term.ion(2 * c, "H", "+")),
                            List.of(Latex.ionTerm(2, ionKey(m.symbol(), c)), Term.of(c, "H2", "g")), null);
                }
                reaction("acid-metal-" + m.symbol().toLowerCase(Locale.ROOT), s.name() + " in acid", "gas", eq, "acid-metal", e);
                String speed = k > 2 ? "fizzes vigorously" : k > 0.6 ? "fizzes steadily" : "slowly gives off a few bubbles";
                observations.add(s.name() + " " + speed + " as hydrogen is released (a lit splint would go 'pop').");
                if (leadCoated) {
                    observations.add("It almost stops at once: insoluble lead(II) " + (has("Cl-") ? "chloride" : "sulfate")
                            + " coats the lead and protects it.");
                } else if (has(key)) {
                    observations.add("The acid runs out before all the " + s.name().toLowerCase(Locale.ROOT) + " is used up.");
                }
                if ("Al".equals(m.symbol())) observations.add("Aluminium starts slowly: its protective oxide layer has to be eaten through first.");
                if ("Fe".equals(m.symbol())) observations.add("The solution turns pale green: iron(II) ions.");
                if (presentTag("nitric_acid") && !"Mg".equals(m.symbol())) {
                    observations.add("With nitric acid some of the gas is nitrogen monoxide instead of hydrogen - it turns brown in air.");
                }
            }
        }

        /** Iron(II) sulfide + acid gives hydrogen sulfide: the toxic rotten-egg gas. */
        void sulfideWithAcid() {
            if (!has("FeS(s)") || acidAvailable() <= EPS) {
                if (has("FeS(s)") && aqMl > 0 && !hadAcid) reasons.add("Iron(II) sulfide is insoluble in water - it needs an acid to react.");
                return;
            }
            Substance acid = mainAcid();
            double e = Math.min(get("FeS(s)"), acidAvailable() / 2);
            double[] t = consumeAcid(2 * e);
            take("FeS(s)", e);
            add("Fe^2+", e);
            heatJ += 12_000 * e;
            long start = nextStart();
            double k = t[0] >= t[1] ? 1.3 : 0.35;
            gas("H2S", e, solidTarget.get("FeS(s)"), k, "medium", start);
            dissolveSolid("FeS(s)", start, (long) clamp(9000 / (k * tf), 2500, 14000));
            String eq;
            if (acid != null) {
                Substance.AcidInfo a = acid.acid();
                Latex.Salt salt = Latex.salt("Fe", 2, false, a.anion(), a.anionCharge(), a.poly());
                int acidCoef = Math.max(1, 2 / a.protons());
                Lore.register(salt.formula(), Lore.saltName("Iron", 2, true, a.anion()), null);
                product(salt.formula(), e, "aq");
                eq = Latex.equation(List.of(Term.of(1, "FeS", "s"), Term.of(acidCoef, acid.formula(), "aq")),
                        List.of(Term.of(1, salt.formula(), "aq"), Term.of(1, "H2S", "g")), null);
            } else {
                eq = Latex.equation(List.of(Term.of(1, "FeS", "s"), Term.ion(2, "H", "+")),
                        List.of(Term.ion(1, "Fe", "2+"), Term.of(1, "H2S", "g")), null);
            }
            reaction("acid-sulfide", "Iron sulfide and acid", "gas", eq, "acid-sulfide", e);
            observations.add("The black lumps fizz and a smell of rotten eggs fills the air: hydrogen sulfide, a toxic gas.");
            observations.add("The solution turns pale green as iron(II) ions form.");
            // Hydrogen sulfide meeting copper or lead ions gives a black metal sulfide.
            for (String[] m : new String[][] {{"Cu^2+", "CuS", "Copper(II) sulfide"}, {"Pb^2+", "PbS", "Lead(II) sulfide"}}) {
                double x = Math.min(get(m[0]), e * 0.6);
                if (x <= EPS) continue;
                take(m[0], x);
                Lore.register(m[1], m[2], "#151515");
                precipitate(m[1], x, "#151515", start + 600, 2600);
                observations.add("Hydrogen sulfide meets the metal ions and a black precipitate of " + m[2].toLowerCase(Locale.ROOT) + " forms.");
            }
        }

        double metalAcidHeat(Substance.MetalInfo m) {
            return switch (m.symbol()) {
                case "Mg" -> 467_000;
                case "Zn" -> 153_000;
                case "Fe" -> 89_000;
                default -> Math.max(30_000, -m.e0() * 96_500 * m.charge() * 0.6);
            };
        }

        static String ionKey(String symbol, int charge) {
            return charge == 1 ? symbol + "+" : symbol + "^" + charge + "+";
        }

        record Oxide(String key, String formula, String metal, int charge, int metalAtoms, String name, String colourWord) {}

        static final List<Oxide> OXIDES = List.of(
                new Oxide("CuO(s)", "CuO", "Cu", 2, 1, "Copper(II) oxide", "blue"),
                new Oxide("Fe2O3(s)", "Fe2O3", "Fe", 3, 2, "Iron(III) oxide", "yellow-brown"));

        void oxideWithAcid() {
            if (has("MnO2(s)") && hadAcid) {
                reasons.add("Manganese(IV) oxide doesn't react with dilute acids here - it's a catalyst, not a reactant.");
            }
            for (Oxide ox : OXIDES) {
                if (!has(ox.key())) continue;
                if (acidAvailable() <= EPS) {
                    if (aqMl > 0 && !hadAcid) reasons.add(ox.name() + " is insoluble in water - it needs an acid.");
                    continue;
                }
                if (tempC < 50) {
                    pending.add(new Pending("NEEDS_HEAT", "heater",
                            "This reaction needs heat to proceed. Warm the mixture to about 60 °C."));
                    continue;
                }
                Substance acid = mainAcid();
                int protonsPerOxide = ox.charge() * ox.metalAtoms();
                double n = get(ox.key());
                double[] t = consumeAcid(protonsPerOxide * n);
                double e = (t[0] + t[1]) / protonsPerOxide;
                take(ox.key(), e);
                add(ionKey(ox.metal(), ox.charge()), e * ox.metalAtoms());
                heatJ += 63_000 * e;
                product("H2O", e * protonsPerOxide / 2.0, "l");
                long start = nextStart();
                dissolveSolid(ox.key(), start, (long) clamp(9000 / tf, 2500, 9000));
                if (acid == null) {
                    reaction("acid-oxide", ox.name() + " in warm acid", "neutralisation",
                            Latex.eq(("Fe".equals(ox.metal()) ? "Fe2O3(s) + 6 H^+ -> 2 Fe^3+ + 3 H2O(l)"
                                    : ox.formula() + "(s) + 2 H^+ -> " + ox.metal() + "^2+ + H2O(l)")),
                            "acid-oxide", e);
                    observations.add("The powder dissolves in the warm acid and the solution turns " + ox.colourWord() + ".");
                    continue;
                }
                Substance.AcidInfo a = acid.acid();
                Latex.Salt salt = Latex.salt(ox.metal(), ox.charge(), false, a.anion(), a.anionCharge(), a.poly());
                int oxCoef = 1;
                while ((oxCoef * protonsPerOxide) % a.protons() != 0 || (oxCoef * ox.metalAtoms()) % salt.cations() != 0) oxCoef++;
                product(salt.formula(), e * ox.metalAtoms() / salt.cations(), "aq");
                Lore.register(salt.formula(), Lore.saltName(Elements.NAME.getOrDefault(ox.metal(), ox.metal()), ox.charge(), true, a.anion()), null);
                reaction("acid-oxide", ox.name() + " in warm acid", "neutralisation",
                        Latex.equation(List.of(Term.of(oxCoef, ox.formula(), "s"), Term.of(oxCoef * protonsPerOxide / a.protons(), acid.formula(), "aq")),
                                List.of(Term.of(oxCoef * ox.metalAtoms() / salt.cations(), salt.formula(), "aq"),
                                        Term.of(oxCoef * protonsPerOxide / 2, "H2O", "l")), null),
                        "acid-oxide", e);
                observations.add("The powder dissolves in the warm acid and the solution turns " + ox.colourWord() + ".");
            }
        }

        void thiosulfateWithAcid() {
            if (!has("S2O3^2-") || acidAvailable() <= EPS) return;
            double thio = molar("S2O3^2-");
            double acidM = molar("H+") + 0.2 * weakAcid() / litres();
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
                            "Permanganate needs acid to react cleanly. Add some dilute sulfuric acid.", "h2so4"));
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
                            "Permanganate needs acid to oxidise iodide cleanly. Add some dilute sulfuric acid.", "h2so4"));
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
            boolean enzyme = has("org:yeast") || has("org:catalase");
            if (enzyme && tempC >= 60) {
                reasons.add("The catalase enzyme has been denatured by the heat (above about 60 °C), so it no longer speeds up the breakdown of peroxide.");
                enzyme = false;
            }
            // {label for the arrow, rate constant, target key or null}
            String[] catalyst = has("MnO2(s)") || has("MnO2(ppt)") ? new String[] {"MnO2", "4.0", "MnO2(s)"}
                    : enzyme ? new String[] {"catalase", "6.0", null}
                    : has("I-") ? new String[] {"KI", "2.4", null}
                    : has("Fe^3+") ? new String[] {"Fe(III)", "2.4", null}
                    : has("CuO(s)") ? new String[] {"CuO", "1.4", "CuO(s)"}
                    : has("Fe2O3(s)") ? new String[] {"Fe2O3", "0.9", "Fe2O3(s)"}
                    : has("Co^2+") ? new String[] {"Co(II)", "0.9", null}
                    : has("Cu^2+") ? new String[] {"Cu(II)", "0.35", null}
                    : has("Fe(s)") ? new String[] {"Fe", "0.3", "Fe(s)"}
                    : has("FeS(s)") ? new String[] {"FeS", "0.4", "FeS(s)"}
                    : has("Ag+") ? new String[] {"Ag(I)", "0.4", null}
                    : null;
            if (catalyst != null) {
                double k = Double.parseDouble(catalyst[1]);
                double e = get("H2O2") * (k >= 1 ? 1 : 0.4);
                take("H2O2", e);
                heatJ += 98_000 * e;
                String target = catalyst[2] != null && has(catalyst[2]) ? solidTarget.get(catalyst[2]) : "vessel";
                gas("O2", e / 2, target == null ? "vessel" : target, k, "fine", nextStart());
                product("H2O", e, "l");
                reaction("peroxide-catalysed", "Catalytic decomposition of peroxide", "catalysis",
                        Latex.equation(List.of(Term.of(2, "H2O2", "aq")), List.of(Term.of(2, "H2O", "l"), Term.of(1, "O2", "g")),
                                catalyst[0]),
                        "catalase".equals(catalyst[0]) ? "catalase" : "peroxide-catalysed", e);
                observations.add(k >= 4 ? "Vigorous fizzing - the oxygen would relight a glowing splint. The catalyst isn't used up."
                        : k >= 1 ? "Steady fizzing as oxygen is released - a glowing splint would relight. The catalyst isn't used up."
                        : "Slow, steady bubbles of oxygen: this is only a weak catalyst for peroxide.");
                if ("catalase".equals(catalyst[0])) {
                    observations.add("A froth of oxygen bubbles foams up: catalase is one of the fastest enzymes known.");
                }
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
                            "Hydrogen peroxide decomposes only very slowly on its own. Add a catalyst such as manganese(IV) oxide.", "mno2-powder"));
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
                if (m.e0() >= 0.77) continue; // Fe3+/Fe2+ is +0.77 V: nobler metals are not attacked
                int c = m.charge();
                double e = Math.min(get(key), get("Fe^3+") / c);
                take(key, e);
                take("Fe^3+", c * e);
                add(ionKey(m.symbol(), c), e);
                add("Fe^2+", c * e);
                long start = nextStart();
                dissolveSolid(key, start, 5000);
                reaction("iron3-" + m.symbol().toLowerCase(Locale.ROOT), "Iron(III) attacks " + p.substance().name().toLowerCase(Locale.ROOT), "redox",
                        Latex.equation(List.of(Term.of(1, m.symbol(), "s"), Term.ion(c, "Fe", "3+")),
                                List.of(Latex.ionTerm(1, ionKey(m.symbol(), c)), Term.ion(c, "Fe", "2+")), null),
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

        record Ion(String key, String symbol, int charge, double e0, String depositHex, String discovery) {}

        static final List<Ion> SERIES_IONS = List.of(
                new Ion("Ag+", "Ag", 1, 0.80, "#d9dde3", "displacement-silver"),
                new Ion("Cu^2+", "Cu", 2, 0.34, "#b5653a", "displacement-copper"),
                new Ion("Pb^2+", "Pb", 2, -0.13, "#5a5f66", "displacement-other"),
                new Ion("Ni^2+", "Ni", 2, -0.25, "#4a4c50", "displacement-other"),
                new Ion("Co^2+", "Co", 2, -0.28, "#4a4c50", "displacement-other"),
                new Ion("Fe^2+", "Fe", 2, -0.44, "#3d3d3f", "displacement-other"),
                new Ion("Cr^3+", "Cr", 3, -0.74, "#7a8088", "displacement-other"),
                new Ion("Zn^2+", "Zn", 2, -0.76, "#9aa0a6", "displacement-other"),
                new Ion("Mn^2+", "Mn", 2, -1.18, "#8a8a86", "displacement-other"),
                new Ion("Al^3+", "Al", 3, -1.66, "#c4cad2", "displacement-other"),
                new Ion("Mg^2+", "Mg", 2, -2.37, "#c9cdd3", "displacement-other"));

        void displacement() {
            List<Portion> metals = portions.stream().filter(p -> p.substance().metal() != null)
                    .sorted(Comparator.comparingDouble((Portion p) -> p.substance().metal().e0())).toList();
            for (Portion p : metals) {
                Substance.MetalInfo m = p.substance().metal();
                String key = m.symbol() + "(s)";
                for (Ion ion : SERIES_IONS) {
                    if (!has(ion.key()) || ion.symbol().equals(m.symbol())) continue;
                    if (ion.e0() <= m.e0()) {
                        reasons.add(p.substance().name() + " is less reactive than " + elementName(ion.symbol())
                                + ", so it can't displace it from solution.");
                        continue;
                    }
                    if (!has(key)) continue;
                    // Aluminium's oxide film blocks it unless chloride ions are there to break the film.
                    if ("Al".equals(m.symbol()) && !has("Cl-")) {
                        reasons.add("Aluminium is more reactive, but its tough oxide layer stops it reacting here. "
                                + "Add some salt (chloride ions) and it would break through the layer and react.");
                        continue;
                    }
                    // Alkali and alkaline-earth metals react with the water first (handled with water).
                    if (m.e0() < -2.5 && aqMl > 0) continue;
                    int lcm = Latex.lcm(m.charge(), ion.charge());
                    int metalCoef = lcm / m.charge();
                    int ionCoef = lcm / ion.charge();
                    double e = Math.min(get(key) / metalCoef, get(ion.key()) / ionCoef);
                    if (e <= EPS) continue;
                    take(key, metalCoef * e);
                    take(ion.key(), ionCoef * e);
                    add(ionKey(m.symbol(), m.charge()), metalCoef * e);
                    product(ion.symbol(), ionCoef * e, "s");
                    heatJ += 96_500 * (ion.e0() - m.e0()) * m.charge() * metalCoef * e * 0.8;
                    long start = nextStart();
                    Map<String, Object> c = cue("deposit", solidTarget.get(key), start);
                    c.put("colour", Colour.hex(ion.depositHex(), 1).toJson());
                    c.put("durationMs", (long) clamp(6000 / tf, 2000, 9000));
                    c.put("form", "Ag".equals(ion.symbol()) ? "crystals" : "coating");
                    dissolveSolid(key, start, (long) clamp(9000 / tf, 3000, 12000));
                    reaction("displacement-" + m.symbol().toLowerCase(Locale.ROOT) + "-" + ion.symbol().toLowerCase(Locale.ROOT),
                            p.substance().name() + " displaces " + elementName(ion.symbol()).toLowerCase(Locale.ROOT), "displacement",
                            Latex.equation(List.of(Term.of(metalCoef, m.symbol(), "s"), Latex.ionTerm(ionCoef, ion.key())),
                                    List.of(Latex.ionTerm(metalCoef, ionKey(m.symbol(), m.charge())), Term.of(ionCoef, ion.symbol(), "s")), null),
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
            return Elements.NAME.getOrDefault(symbol, symbol);
        }

        /** Halogen displacement, halogens with alkali and thiosulfate, and chlorine bleaching. */
        void halogens() {
            String[][] order = {{"Cl2", "Cl-"}, {"Br2", "Br-"}, {"I2", "I-"}};
            for (int i = 0; i < order.length; i++) {
                for (int j = i + 1; j < order.length; j++) {
                    String x2 = order[i][0], xm = order[i][1], y2 = order[j][0], ym = order[j][1];
                    if (!has(x2) || !has(ym)) continue;
                    double e = Math.min(get(x2), get(ym) / 2);
                    take(x2, e);
                    take(ym, 2 * e);
                    add(xm, 2 * e);
                    add(y2, e);
                    nextStart();
                    String xn = x2.substring(0, x2.length() - 1);
                    String yn = y2.substring(0, y2.length() - 1);
                    reaction("halogen-displacement-" + xn.toLowerCase(Locale.ROOT) + "-" + yn.toLowerCase(Locale.ROOT),
                            elementName(xn) + " displaces " + elementName(yn).toLowerCase(Locale.ROOT), "redox",
                            Latex.equation(List.of(Term.of(1, x2, "aq"), Latex.ionTerm(2, ym)),
                                    List.of(Latex.ionTerm(2, xm), Term.of(1, y2, "aq")), null),
                            "halogen-displacement", e);
                    observations.add(elementName(xn) + " is more reactive, so it pushes " + elementName(yn).toLowerCase(Locale.ROOT)
                            + " out of solution - the colour changes to " + ("Br2".equals(y2) ? "orange" : "brown") + ".");
                }
            }
            for (String x2 : List.of("Cl2", "Br2")) {
                if (has(x2) && has("OH-")) {
                    String xn = x2.substring(0, x2.length() - 1);
                    double e = Math.min(get(x2), get("OH-") / 2);
                    take(x2, e);
                    take("OH-", 2 * e);
                    add(xn + "-", e);
                    add("O" + xn + "-", e);
                    if ("Cl2".equals(x2)) add("HOCl", e * 0.2);
                    nextStart();
                    reaction("halogen-alkali-" + xn.toLowerCase(Locale.ROOT), elementName(xn) + " + alkali", "redox",
                            Latex.equation(List.of(Term.of(1, x2, "aq"), Term.ion(2, "OH", "-")),
                                    List.of(Latex.ionTerm(1, xn + "-"), Latex.ionTerm(1, "O" + xn + "-"), Term.of(1, "H2O", "l")), null),
                            "Cl2".equals(x2) ? "chlorine-bleach" : null, e);
                    observations.add("The " + elementName(xn).toLowerCase(Locale.ROOT) + " colour fades as it reacts with the alkali"
                            + ("Cl2".equals(x2) ? " - this is exactly how household bleach is made." : "."));
                }
                if (has(x2) && has("S2O3^2-")) {
                    double e = Math.min(get(x2), get("S2O3^2-") / 2);
                    String xn = x2.substring(0, x2.length() - 1);
                    take(x2, e);
                    take("S2O3^2-", 2 * e);
                    add(xn + "-", 2 * e);
                    nextStart();
                    reaction("halogen-thiosulfate-" + xn.toLowerCase(Locale.ROOT), "Thiosulfate removes " + elementName(xn).toLowerCase(Locale.ROOT),
                            "redox",
                            Latex.equation(List.of(Term.of(1, x2, "aq"), Term.ion(2, "S2O3", "2-")),
                                    List.of(Latex.ionTerm(2, xn + "-"), Term.ion(1, "S4O6", "2-")), null),
                            "iodine-decolourised", e);
                    observations.add("Thiosulfate removes the " + elementName(xn).toLowerCase(Locale.ROOT) + " colour.");
                }
            }
            if (has("HOCl") && (has("ind:ui") || has("ind:mo") || has("ind:pp") || has("starch"))) {
                bleached = true;
                nextStart();
                reaction("chlorine-bleaches", "Chlorine bleaches the dye", "redox",
                        "\\text{HOCl} + \\text{dye} \\rightarrow \\text{colourless products}", "chlorine-bleach", get("HOCl"));
                observations.add("The indicator colour vanishes - chlorine water bleaches dyes.");
            }
        }

        // ---------------------------------------------------------------- precipitation

        /** @param ksp 0 = treat as completely insoluble; otherwise only the excess over Ksp precipitates */
        record Ppt(String cation, int cCharge, String anion, int aCharge, boolean anionPoly, String solid, String hex,
                double molarMass, String discovery, String name, String word, double ksp) {
            Ppt(String cation, int cCharge, String anion, int aCharge, boolean anionPoly, String solid, String hex,
                    double molarMass, String discovery, String name) {
                this(cation, cCharge, anion, aCharge, anionPoly, solid, hex, molarMass, discovery, name, colourWord(hex), 0);
            }
        }

        static Ppt ppt(String cation, String anion, String solid, String hex, double mm, String discovery, String name, String word) {
            return ppt(cation, anion, solid, hex, mm, discovery, name, word, 0);
        }

        static Ppt ppt(String cation, String anion, String solid, String hex, double mm, String discovery, String name, String word,
                double ksp) {
            int cc = chargeOf(cation);
            int ac = chargeOf(anion);
            boolean poly = anion.length() > 3 || anion.startsWith("SCN") || anion.startsWith("OH");
            return new Ppt(cation, cc, anion, ac, poly, solid, hex, mm, discovery, name, word, ksp);
        }

        static int chargeOf(String key) {
            int caret = key.indexOf('^');
            if (caret < 0) return 1;
            return Integer.parseInt(key.substring(caret + 1, key.length() - 1));
        }

        /** Solubility rules: every common insoluble cation/anion pair, in the order they come out of solution. */
        static final List<Ppt> INSOLUBLE = List.of(
                new Ppt("Ag+", 1, "I-", 1, false, "AgI", "#f2e27a", 234.8, "silver-halide", "Silver iodide"),
                new Ppt("Ag+", 1, "Br-", 1, false, "AgBr", "#eee3bf", 187.8, "silver-halide", "Silver bromide"),
                new Ppt("Ag+", 1, "Cl-", 1, false, "AgCl", "#f5f5f3", 143.3, "silver-halide", "Silver chloride"),
                ppt("Ag+", "SCN-", "AgSCN", "#f5f5f3", 165.95, null, "Silver thiocyanate", "white"),
                new Ppt("Ba^2+", 2, "SO4^2-", 2, true, "BaSO4", "#fbfbfb", 233.4, "barium-sulfate", "Barium sulfate"),
                ppt("Sr^2+", "SO4^2-", "SrSO4", "#fbfbfb", 183.7, "barium-sulfate", "Strontium sulfate", "white"),
                new Ppt("Pb^2+", 2, "I-", 1, false, "PbI2", "#f7c21a", 461.0, "golden-rain", "Lead(II) iodide"),
                new Ppt("Pb^2+", 2, "SO4^2-", 2, true, "PbSO4", "#fbfbfb", 303.3, "barium-sulfate", "Lead(II) sulfate"),
                ppt("Pb^2+", "CrO4^2-", "PbCrO4", "#f5c400", 323.2, "chromate-precipitates", "Lead(II) chromate", "bright yellow"),
                ppt("Ba^2+", "CrO4^2-", "BaCrO4", "#f2d93a", 253.3, "chromate-precipitates", "Barium chromate", "pale yellow"),
                ppt("Ag+", "CrO4^2-", "Ag2CrO4", "#a8321e", 331.7, "chromate-precipitates", "Silver chromate", "brick-red"),
                ppt("Ag+", "PO4^3-", "Ag3PO4", "#f0d23c", 418.6, "phosphate-precipitates", "Silver phosphate", "yellow"),
                ppt("Ca^2+", "C2O4^2-", "CaC2O4", "#f7f7f5", 128.1, "calcium-oxalate", "Calcium oxalate", "white"),
                ppt("Ba^2+", "C2O4^2-", "BaC2O4", "#f7f7f5", 225.3, "calcium-oxalate", "Barium oxalate", "white"),
                ppt("Sr^2+", "C2O4^2-", "SrC2O4", "#f7f7f5", 175.6, "calcium-oxalate", "Strontium oxalate", "white"),
                ppt("Pb^2+", "C2O4^2-", "PbC2O4", "#f7f7f5", 295.2, null, "Lead(II) oxalate", "white"),
                ppt("Ag+", "C2O4^2-", "Ag2C2O4", "#f7f7f5", 303.8, null, "Silver oxalate", "white"),
                ppt("Zn^2+", "C2O4^2-", "ZnC2O4", "#f7f7f5", 153.4, null, "Zinc oxalate", "white"),
                ppt("Cu^2+", "C2O4^2-", "CuC2O4", "#bfe0ef", 151.6, null, "Copper(II) oxalate", "pale blue-white"),
                ppt("Fe^2+", "C2O4^2-", "FeC2O4", "#f2d64a", 143.9, null, "Iron(II) oxalate", "yellow"),
                ppt("Co^2+", "C2O4^2-", "CoC2O4", "#eab2c6", 147.0, null, "Cobalt(II) oxalate", "pale pink"),
                ppt("Ni^2+", "C2O4^2-", "NiC2O4", "#b9e0b0", 146.7, null, "Nickel(II) oxalate", "pale green"),
                ppt("Mn^2+", "C2O4^2-", "MnC2O4", "#f4e2e8", 142.96, null, "Manganese(II) oxalate", "very pale pink"),
                new Ppt("Ba^2+", 2, "CO3^2-", 2, true, "BaCO3", "#f7f7f5", 197.3, "insoluble-carbonate", "Barium carbonate"),
                ppt("Sr^2+", "CO3^2-", "SrCO3", "#f7f7f5", 147.6, "insoluble-carbonate", "Strontium carbonate", "white"),
                new Ppt("Ca^2+", 2, "CO3^2-", 2, true, "CaCO3", "#f7f7f5", 100.1, "insoluble-carbonate", "Calcium carbonate"),
                new Ppt("Mg^2+", 2, "CO3^2-", 2, true, "MgCO3", "#f5f5f5", 84.3, "insoluble-carbonate", "Magnesium carbonate"),
                new Ppt("Zn^2+", 2, "CO3^2-", 2, true, "ZnCO3", "#f5f5f5", 125.4, "insoluble-carbonate", "Zinc carbonate"),
                new Ppt("Cu^2+", 2, "CO3^2-", 2, true, "CuCO3", "#58a894", 123.6, "insoluble-carbonate", "Copper(II) carbonate"),
                new Ppt("Fe^2+", 2, "CO3^2-", 2, true, "FeCO3", "#a0a88a", 115.9, "insoluble-carbonate", "Iron(II) carbonate"),
                new Ppt("Ag+", 1, "CO3^2-", 2, true, "Ag2CO3", "#efe6b0", 275.7, "insoluble-carbonate", "Silver carbonate"),
                new Ppt("Pb^2+", 2, "CO3^2-", 2, true, "PbCO3", "#f6f6f4", 267.2, "insoluble-carbonate", "Lead(II) carbonate"),
                ppt("Mn^2+", "CO3^2-", "MnCO3", "#f2d4dc", 114.9, "insoluble-carbonate", "Manganese(II) carbonate", "pale pink"),
                ppt("Co^2+", "CO3^2-", "CoCO3", "#c4709a", 118.9, "insoluble-carbonate", "Cobalt(II) carbonate", "pink-mauve"),
                ppt("Ni^2+", "CO3^2-", "NiCO3", "#9fd39a", 118.7, "insoluble-carbonate", "Nickel(II) carbonate", "pale green"),
                ppt("Ca^2+", "PO4^3-", "Ca3(PO4)2", "#f7f7f5", 310.2, "phosphate-precipitates", "Calcium phosphate", "white"),
                ppt("Ba^2+", "PO4^3-", "Ba3(PO4)2", "#f7f7f5", 602.0, "phosphate-precipitates", "Barium phosphate", "white"),
                ppt("Mg^2+", "PO4^3-", "Mg3(PO4)2", "#f7f7f5", 262.9, "phosphate-precipitates", "Magnesium phosphate", "white"),
                ppt("Zn^2+", "PO4^3-", "Zn3(PO4)2", "#f7f7f5", 386.1, "phosphate-precipitates", "Zinc phosphate", "white"),
                ppt("Cu^2+", "PO4^3-", "Cu3(PO4)2", "#6fb5d6", 380.6, "phosphate-precipitates", "Copper(II) phosphate", "pale blue"),
                ppt("Fe^2+", "PO4^3-", "Fe3(PO4)2", "#d8dfe6", 357.5, "phosphate-precipitates", "Iron(II) phosphate", "off-white"),
                ppt("Fe^3+", "PO4^3-", "FePO4", "#f2e6a8", 150.8, "phosphate-precipitates", "Iron(III) phosphate", "pale yellow"),
                ppt("Al^3+", "PO4^3-", "AlPO4", "#f7f7f5", 122.0, "phosphate-precipitates", "Aluminium phosphate", "white"),
                ppt("Cr^3+", "PO4^3-", "CrPO4", "#7a9a6a", 147.0, "phosphate-precipitates", "Chromium(III) phosphate", "grey-green"),
                ppt("Pb^2+", "PO4^3-", "Pb3(PO4)2", "#f7f7f5", 811.5, "phosphate-precipitates", "Lead(II) phosphate", "white"),
                ppt("Mn^2+", "PO4^3-", "Mn3(PO4)2", "#f2dfe4", 354.8, "phosphate-precipitates", "Manganese(II) phosphate", "pinkish-white"),
                ppt("Co^2+", "PO4^3-", "Co3(PO4)2", "#8a5aa8", 366.7, "phosphate-precipitates", "Cobalt(II) phosphate", "violet"),
                ppt("Ni^2+", "PO4^3-", "Ni3(PO4)2", "#a8d8a0", 366.0, "phosphate-precipitates", "Nickel(II) phosphate", "pale green"),
                ppt("Ba^2+", "SO3^2-", "BaSO3", "#f7f7f5", 217.4, null, "Barium sulfite", "white"),
                ppt("Ca^2+", "SO3^2-", "CaSO3", "#f7f7f5", 120.1, null, "Calcium sulfite", "white"),
                ppt("Ag+", "SO3^2-", "Ag2SO3", "#f7f7f5", 295.8, null, "Silver sulfite", "white"),
                ppt("Pb^2+", "SO3^2-", "PbSO3", "#f7f7f5", 287.3, null, "Lead(II) sulfite", "white"),
                ppt("Pb^2+", "S2O3^2-", "PbS2O3", "#f7f7f5", 319.3, null, "Lead(II) thiosulfate", "white"),
                ppt("Cu^2+", "SiO3^2-", "CuSiO3", "#3f86c8", 139.6, "chemical-garden", "Copper(II) silicate", "blue"),
                ppt("Fe^3+", "SiO3^2-", "Fe2(SiO3)3", "#a0522d", 339.9, "chemical-garden", "Iron(III) silicate", "rust-brown"),
                ppt("Fe^2+", "SiO3^2-", "FeSiO3", "#6d8f58", 131.9, "chemical-garden", "Iron(II) silicate", "green"),
                ppt("Co^2+", "SiO3^2-", "CoSiO3", "#5a5fc8", 135.0, "chemical-garden", "Cobalt(II) silicate", "dark blue"),
                ppt("Ni^2+", "SiO3^2-", "NiSiO3", "#5fbf6a", 134.8, "chemical-garden", "Nickel(II) silicate", "green"),
                ppt("Mn^2+", "SiO3^2-", "MnSiO3", "#f0d8e0", 131.0, "chemical-garden", "Manganese(II) silicate", "pale pink"),
                ppt("Ca^2+", "SiO3^2-", "CaSiO3", "#f7f7f5", 116.2, "chemical-garden", "Calcium silicate", "white"),
                ppt("Mg^2+", "SiO3^2-", "MgSiO3", "#f7f7f5", 100.4, "chemical-garden", "Magnesium silicate", "white"),
                ppt("Zn^2+", "SiO3^2-", "ZnSiO3", "#f7f7f5", 141.5, "chemical-garden", "Zinc silicate", "white"),
                ppt("Al^3+", "SiO3^2-", "Al2(SiO3)3", "#f7f7f5", 282.2, "chemical-garden", "Aluminium silicate", "white"),
                ppt("Cr^3+", "SiO3^2-", "Cr2(SiO3)3", "#4f8a5a", 332.2, "chemical-garden", "Chromium(III) silicate", "green"),
                ppt("Ca^2+", "F-", "CaF2", "#f7f7f5", 78.1, null, "Calcium fluoride", "white"),
                ppt("Mg^2+", "F-", "MgF2", "#f7f7f5", 62.3, null, "Magnesium fluoride", "white"),
                ppt("Ca^2+", "St-", "Ca(C17H35COO)2", "#f4f2ea", 607.0, "soap-scum", "Calcium stearate (scum)", "greyish-white"),
                ppt("Mg^2+", "St-", "Mg(C17H35COO)2", "#f4f2ea", 591.2, "soap-scum", "Magnesium stearate (scum)", "greyish-white"),
                // Any metal ion with a charge of 2+ or 3+ does to soap what hard water does.
                ppt("Ba^2+", "St-", "Ba(C17H35COO)2", "#f4f2ea", 704.3, "soap-scum", "Barium stearate (scum)", "greyish-white"),
                ppt("Sr^2+", "St-", "Sr(C17H35COO)2", "#f4f2ea", 654.6, "soap-scum", "Strontium stearate (scum)", "greyish-white"),
                ppt("Zn^2+", "St-", "Zn(C17H35COO)2", "#f4f2ea", 632.3, "soap-scum", "Zinc stearate (scum)", "greyish-white"),
                ppt("Pb^2+", "St-", "Pb(C17H35COO)2", "#f1efe6", 774.1, "soap-scum", "Lead(II) stearate (scum)", "greyish-white"),
                ppt("Al^3+", "St-", "Al(C17H35COO)3", "#f4f2ea", 877.4, "soap-scum", "Aluminium stearate (scum)", "greyish-white"),
                ppt("Cu^2+", "St-", "Cu(C17H35COO)2", "#7fc4c0", 630.5, "soap-scum", "Copper(II) stearate (scum)", "blue-green"),
                ppt("Fe^2+", "St-", "Fe(C17H35COO)2", "#c9c39a", 622.8, "soap-scum", "Iron(II) stearate (scum)", "dirty greenish"),
                ppt("Fe^3+", "St-", "Fe(C17H35COO)3", "#c98a4a", 906.3, "soap-scum", "Iron(III) stearate (scum)", "orange-brown"),
                ppt("Ni^2+", "St-", "Ni(C17H35COO)2", "#a9d6a0", 625.7, "soap-scum", "Nickel(II) stearate (scum)", "pale green"),
                ppt("Co^2+", "St-", "Co(C17H35COO)2", "#c9a0c0", 625.9, "soap-scum", "Cobalt(II) stearate (scum)", "pinkish"),
                ppt("Mn^2+", "St-", "Mn(C17H35COO)2", "#efe2dc", 621.9, "soap-scum", "Manganese(II) stearate (scum)", "off-white"),
                // Sparingly soluble: only the excess over the solubility product comes out.
                ppt("Ca^2+", "SO4^2-", "CaSO4", "#f6f6f4", 136.1, "calcium-sulfate", "Calcium sulfate", "faint white", 4.9e-5),
                ppt("Pb^2+", "Cl-", "PbCl2", "#f6f6f4", 278.1, null, "Lead(II) chloride", "white", 1.7e-5),
                ppt("Pb^2+", "Br-", "PbBr2", "#f6f6f4", 367.0, null, "Lead(II) bromide", "white", 6.6e-6),
                ppt("Ag+", "SO4^2-", "Ag2SO4", "#f6f6f4", 311.8, null, "Silver sulfate", "white", 1.2e-5),
                ppt("Ag+", "CH3COO-", "CH3COOAg", "#f6f6f4", 166.9, null, "Silver ethanoate", "white", 1.9e-3),
                ppt("Ca^2+", "OH-", "Ca(OH)2", "#f4f4f2", 74.1, null, "Calcium hydroxide", "white", 3.5e-5));

        record Hydroxide(String cation, String symbol, int charge, String solid, String hex, double molarMass,
                String discovery, String colourWord) {}

        static final List<Hydroxide> HYDROXIDES = List.of(
                new Hydroxide("Fe^3+", "Fe", 3, "Fe(OH)3", "#9b4a1c", 106.9, "iron3-hydroxide", "rust-brown"),
                new Hydroxide("Cu^2+", "Cu", 2, "Cu(OH)2", "#4a9fe0", 97.6, "copper-hydroxide", "pale blue"),
                new Hydroxide("Fe^2+", "Fe", 2, "Fe(OH)2", "#6d8f58", 89.9, "iron2-hydroxide", "dirty green"),
                new Hydroxide("Zn^2+", "Zn", 2, "Zn(OH)2", "#f2f2f2", 99.4, "white-hydroxide", "white"),
                new Hydroxide("Mg^2+", "Mg", 2, "Mg(OH)2", "#f2f2f2", 58.3, "white-hydroxide", "white"),
                new Hydroxide("Al^3+", "Al", 3, "Al(OH)3", "#f4f4f2", 78.0, "white-hydroxide", "white"),
                new Hydroxide("Pb^2+", "Pb", 2, "Pb(OH)2", "#f4f4f2", 241.2, "white-hydroxide", "white"),
                new Hydroxide("Ni^2+", "Ni", 2, "Ni(OH)2", "#7fc47a", 92.7, "coloured-hydroxide", "pale green"),
                new Hydroxide("Co^2+", "Co", 2, "Co(OH)2", "#5a78c8", 92.9, "coloured-hydroxide", "blue"),
                new Hydroxide("Mn^2+", "Mn", 2, "Mn(OH)2", "#efe4d8", 88.9, "coloured-hydroxide", "off-white"),
                new Hydroxide("Cr^3+", "Cr", 3, "Cr(OH)3", "#5f8a62", 103.0, "coloured-hydroxide", "grey-green"),
                new Hydroxide("Cd^2+", "Cd", 2, "Cd(OH)2", "#f4f4f2", 146.4, "white-hydroxide", "white"),
                new Hydroxide("Sn^2+", "Sn", 2, "Sn(OH)2", "#f4f4f2", 152.7, "white-hydroxide", "white"));

        /** Concentration product for a salt MxAy at the current volume. */
        double ionProduct(Ppt p, int x, int y) {
            return Math.pow(molar(p.cation()), x) * Math.pow(molar(p.anion()), y);
        }

        void precipitation() {
            if (aqMl <= 0) return;
            for (Ppt p : INSOLUBLE) {
                if (!has(p.cation()) || !has(p.anion())) continue;
                Latex.Salt salt = Latex.salt("M", p.cCharge(), false, "X", p.aCharge(), p.anionPoly());
                int x = salt.cations();
                int y = salt.anions();
                double e = Math.min(get(p.cation()) / x, get(p.anion()) / y);
                if (p.ksp() > 0) {
                    if (ionProduct(p, x, y) <= p.ksp()) continue;
                    // Bisect for the amount that brings the ion product back down to Ksp.
                    double lo = 0, hi = e;
                    double c0 = get(p.cation()), a0 = get(p.anion()), l = litres();
                    for (int it = 0; it < 50; it++) {
                        double mid = (lo + hi) / 2;
                        double q = Math.pow((c0 - x * mid) / l, x) * Math.pow((a0 - y * mid) / l, y);
                        if (q > p.ksp()) lo = mid; else hi = mid;
                    }
                    e = lo;
                }
                if (e <= EPS) continue;
                take(p.cation(), x * e);
                take(p.anion(), y * e);
                long start = nextStart();
                Lore.register(p.solid(), p.name(), p.hex());
                MOLAR_MASS.putIfAbsent(p.solid(), p.molarMass());
                precipitate(p.solid(), e, p.hex(), start, p.ksp() > 0 ? 9000 : 6500);
                reaction("precipitate-" + p.solid().toLowerCase(Locale.ROOT), p.name() + " precipitates", "precipitation",
                        Latex.equation(List.of(Latex.ionTerm(x, p.cation()), Latex.ionTerm(y, p.anion())),
                                List.of(Term.of(1, p.solid(), "s")), null),
                        p.discovery(), e);
                observations.add("PbI2".equals(p.solid())
                        ? "A brilliant golden-yellow precipitate of lead(II) iodide appears - the 'golden rain'."
                        : "CaSO4".equals(p.solid()) ? "A faint white haze forms: calcium sulfate is only sparingly soluble."
                        : p.ksp() > 0 ? "A " + p.word() + " precipitate of " + p.name().toLowerCase(Locale.ROOT)
                                + " slowly appears - it is only sparingly soluble."
                        : p.discovery() != null && p.discovery().equals("soap-scum")
                                ? ("Ca^2+".equals(p.cation()) || "Mg^2+".equals(p.cation())
                                        ? "A greyish-white scum forms instead of a lather: the calcium and magnesium ions in hard water "
                                                + "turn soap into insoluble " + p.name().toLowerCase(Locale.ROOT) + "."
                                        : "A " + p.word() + " scum forms instead of a lather: just like the ions in hard water, these metal "
                                                + "ions turn soap into insoluble " + p.name().toLowerCase(Locale.ROOT) + ".")
                        : p.discovery() != null && p.discovery().equals("chemical-garden")
                                ? "A " + p.word() + " gelatinous " + p.name().toLowerCase(Locale.ROOT)
                                        + " forms - in a chemical garden it grows up in branching towers."
                        : "A " + p.word() + " precipitate of " + p.name().toLowerCase(Locale.ROOT) + " forms instantly.");
            }
            // Iron(III), aluminium and chromium(III) carbonates don't exist: the hydroxide forms and CO2 fizzes off.
            for (String[] t : new String[][] {{"Fe^3+", "Fe(OH)3", "#9b4a1c", "rust-brown", "iron3-hydroxide"},
                    {"Al^3+", "Al(OH)3", "#f4f4f2", "white", "white-hydroxide"},
                    {"Cr^3+", "Cr(OH)3", "#5f8a62", "grey-green", null}}) {
                for (String carb : new String[] {"CO3^2-", "HCO3-"}) {
                    if (!has(t[0]) || !has(carb)) continue;
                    boolean hydrogen = "HCO3-".equals(carb);
                    double e = hydrogen ? Math.min(get(t[0]), get(carb) / 3) : Math.min(get(t[0]) / 2, get(carb) / 3);
                    double metal = hydrogen ? e : 2 * e;
                    take(t[0], metal);
                    take(carb, 3 * e);
                    long start = nextStart();
                    precipitate(t[1], metal, t[2], start, 7000);
                    gas("CO2", 3 * e, "vessel", 1.2, "medium", start);
                    String ion = t[0].substring(0, t[0].indexOf('^'));
                    reaction(ion.toLowerCase(Locale.ROOT) + "-carbonate", elementName(ion) + " ions and " + (hydrogen ? "hydrogencarbonate" : "carbonate"),
                            "precipitation",
                            hydrogen ? Latex.eq(ion + "^3+ + 3 HCO3^- -> " + t[1] + "(s) + 3 CO2(g)")
                                    : Latex.eq("2 " + ion + "^3+ + 3 CO3^2- + 3 H2O(l) -> 2 " + t[1] + "(s) + 3 CO2(g)"),
                            t[4], e);
                    observations.add("A " + t[3] + " precipitate of " + t[1] + " forms and carbon dioxide fizzes off - "
                            + "this metal has no stable carbonate.");
                }
            }
            // Hydrogencarbonate with other metal ions: the insoluble carbonate forms and CO2 is released.
            for (Ppt p : INSOLUBLE) {
                if (!"CO3^2-".equals(p.anion()) || !has(p.cation()) || !has("HCO3-")) continue;
                if (aqMl > 0 && molar(p.cation()) < 0.005) continue; // hard water stays clear until boiled
                Latex.Salt salt = Latex.salt("M", p.cCharge(), false, "X", 2, true);
                int x = salt.cations();
                double e = Math.min(get(p.cation()) / x, get("HCO3-") / 2);
                if (e <= EPS) continue;
                take(p.cation(), x * e);
                take("HCO3-", 2 * e);
                long start = nextStart();
                precipitate(p.solid(), e, p.hex(), start, 7000);
                gas("CO2", e, "vessel", 0.8, "medium", start);
                reaction("hydrogencarbonate-" + p.solid().toLowerCase(Locale.ROOT), p.name() + " from hydrogencarbonate", "precipitation",
                        Latex.equation(List.of(Latex.ionTerm(x, p.cation()), Term.ion(2, "HCO3", "-")),
                                List.of(Term.of(1, p.solid(), "s"), Term.of(1, "H2O", "l"), Term.of(1, "CO2", "g")), null),
                        p.discovery(), e);
                observations.add("A " + p.word() + " precipitate of " + p.name().toLowerCase(Locale.ROOT)
                        + " forms, and bubbles of carbon dioxide appear.");
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
                if ("Mn(OH)2".equals(h.solid())) observations.add("It slowly darkens to brown as air oxidises it.");
                if ("Co(OH)2".equals(h.solid())) observations.add("On standing it slowly turns pink, then brown in air.");
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
            Inorganic.moreComplexes(this);
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

        // ---------------------------------------------------------------- heating: steam, evaporation, sublimation

        /** Salts that crystallise out when their solution is evaporated: {cation, anion, name, colour}. */
        static final String[][] CRYSTAL_SALTS = {
                {"Cu^2+", "SO4^2-", "copper(II) sulfate", "#2f86dc"},
                {"Fe^3+", "Cl-", "iron(III) chloride", "#c98a2e"},
                {"Fe^2+", "SO4^2-", "iron(II) sulfate", "#a6d6a0"},
                {"Cu^2+", "Cl-", "copper(II) chloride", "#3fa38a"},
                {"Na+", "Cl-", "sodium chloride", "#f4f6f8"},
                {"K+", "NO3-", "potassium nitrate", "#f4f6f8"},
                {"Mg^2+", "SO4^2-", "magnesium sulfate", "#f4f6f8"},
                {"Zn^2+", "SO4^2-", "zinc sulfate", "#f4f6f8"},
                {"Na+", "SO4^2-", "sodium sulfate", "#f4f6f8"},
                {"K+", "Cl-", "potassium chloride", "#f4f6f8"},
                {"K+", "Br-", "potassium bromide", "#f4f6f8"},
                {"K+", "I-", "potassium iodide", "#f4f6f8"},
                {"Na+", "NO3-", "sodium nitrate", "#f4f6f8"},
                {"NH4+", "NO3-", "ammonium nitrate", "#f4f6f8"},
                {"NH4+", "Cl-", "ammonium chloride", "#f4f6f8"},
                {"Na+", "CH3COO-", "sodium ethanoate", "#f4f6f8"},
                {"Ca^2+", "Cl-", "calcium chloride", "#f4f6f8"},
                {"Ba^2+", "Cl-", "barium chloride", "#f4f6f8"}};

        /**
         * Physical changes the hot plate causes: steam condensing on the cooler glass, a dissolved salt
         * crystallising as water evaporates, and iodine subliming into violet vapour.
         */
        void heating() {
            if (aqMl > 0 && tempC >= 60) {
                Map<String, Object> c = cue("condense", "vessel", 600);
                c.put("colour", Colour.hex("#d6eeff", 0.8).toJson());
                c.put("amount", round(clamp((tempC - 50) / 40, 0.3, 1), 2));
                c.put("durationMs", 6000);
                observations.add("Steam rises off the hot liquid and condenses into droplets of water on the cooler glass above it.");
            }
            if (aqMl > 0 && tempC >= 80 && !evaporate) {
                for (String[] s : CRYSTAL_SALTS) {
                    if (molar(s[0]) < 0.02 || molar(s[1]) < 0.02) continue;
                    Map<String, Object> c = cue("crystals", "vessel", 2500);
                    c.put("colour", Colour.hex(s[3], 1).toJson());
                    c.put("amount", round(clamp(Math.min(molar(s[0]), molar(s[1])) * 1.5, 0.25, 1), 2));
                    c.put("durationMs", 7000);
                    c.put("label", "Crystals of " + s[2] + " growing as water evaporates");
                    observations.add("As water steams away, " + ("#f4f6f8".equals(s[3]) ? "white" : colourWord(s[3]))
                            + " crystals of " + s[2] + " start to grow around the edge of the liquid - crystallisation by evaporation.");
                    break;
                }
            }
            if (tempC >= 60) {
                for (Portion p : portions) {
                    if (!"el-I".equals(p.substance().id())) continue;
                    String key = p.substance().species().keySet().iterator().next();
                    if (!has(key)) continue;
                    Map<String, Object> c = cue("smoke", "vessel", 300);
                    c.put("colour", Colour.hex("#8a4fd0", 0.75).toJson());
                    c.put("density", 0.7);
                    c.put("durationMs", 7000);
                    c.put("label", "Violet iodine vapour");
                    observations.add("Violet iodine vapour rises from the warm crystals - iodine sublimes straight from solid to gas.");
                    break;
                }
            }
        }

        // ---------------------------------------------------------------- pH and indicators

        double ph() {
            if (aqMl <= 0) return Double.NaN;
            if (get("H2SO4(conc)") > EPS) return 0;
            double h = molar("H+");
            double oh = molar("OH-");
            double ph;
            if (h > 1e-7) {
                ph = -Math.log10(h);
            } else if (oh > 1e-7) {
                ph = 14 + Math.log10(oh);
            } else {
                ph = Double.NaN;
                // 1. The strongest weak acid present sets the pH (as a buffer when its conjugate base is there too).
                for (Acids.Weak w : Acids.WEAK) {
                    double ca = molar(w.key());
                    if (ca <= EPS) continue;
                    double cb = molar(w.conj()) * w.perAnion();
                    ph = cb > EPS ? w.pKa() + Math.log10(cb / ca) : 0.5 * (w.pKa() - Math.log10(ca));
                    break;
                }
                double nb = molar("NH3"), na = molar("NH4+");
                if (Double.isNaN(ph)) {
                    if (nb > EPS && na > EPS) ph = 9.25 + Math.log10(nb / na);
                    else if (nb > EPS) ph = 14 - 0.5 * (4.75 - Math.log10(nb));
                    else if (molar("PO4^3-") > EPS) ph = 14 - 0.5 * (1.65 - Math.log10(molar("PO4^3-")));
                    else if (molar("CO3^2-") > EPS) ph = 14 - 0.5 * (3.67 - Math.log10(molar("CO3^2-")));
                    else if (molar("HCO3-") > EPS) ph = 8.3;
                }
                if (Double.isNaN(ph)) {
                    double acidPh = Double.NaN;
                    for (Object[] a : Acids.CATION_ACIDS) {
                        double c = molar((String) a[0]);
                        if (c > EPS) {
                            double v = 0.5 * ((double) a[1] - Math.log10(c));
                            acidPh = Double.isNaN(acidPh) ? v : Math.min(acidPh, v);
                        }
                    }
                    double basePh = Double.NaN;
                    List<Object[]> bases = new ArrayList<>(Acids.OTHER_BASES);
                    for (Acids.Weak w : Acids.WEAK) bases.add(new Object[] {w.conj(), w.pKa()});
                    for (Object[] b : bases) {
                        double c = molar((String) b[0]);
                        if (c > EPS) {
                            double v = 14 - 0.5 * ((14 - (double) b[1]) - Math.log10(c));
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
            if (Double.isNaN(ph) || bleached) return;
            boolean acidBaseChemistry = hadAcid || hadBase || Math.abs(ph - 7) > 1.5;
            for (String ind : INDICATORS) {
                if (!has(ind)) continue;
                boolean changed = indicatorChanged(ind, ph);
                if (!changed || !acidBaseChemistry) {
                    reasons.add(indicatorName(ind) + " is " + indicatorWord(ind, ph)
                            + String.format(Locale.ROOT, " here (pH about %.1f) - no colour change.", ph));
                    continue;
                }
                String name = indicatorName(ind);
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
            if (kind == Kind.NO_REACTION && base != null) {
                if (!fresh.isEmpty() && finalReasons.isEmpty() && observations.isEmpty()) {
                    finalReasons.add("Nothing new forms when this is added: the particles just mix with what was already here.");
                }
            } else if (kind == Kind.NO_REACTION) {
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
                        finalReasons.add(describeMix());
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
                    pending, mismatches, finalReasons, productList, ms, null, state(endColour));
        }

        /** Plain-language description of a mixture in which nothing chemical happens. */
        String describeMix() {
            List<Substance> subs = portions.stream().map(Portion::substance).toList();
            List<String> names = subs.stream().map(s -> s.name().toLowerCase(Locale.ROOT)).toList();
            String joined = names.size() == 2 ? names.get(0) + " and " + names.get(1)
                    : String.join(", ", names.subList(0, names.size() - 1)) + " and " + names.get(names.size() - 1);
            if (subs.stream().allMatch(s -> s.acid() != null || s.hasTag("acid"))) {
                return "These are all acids, and acids don't react with each other - mixing them just gives a more dilute mixture of acids.";
            }
            if (subs.stream().allMatch(s -> s.base() != null || s.hasTag("alkali") || s.carbonate() != null && !s.isSolid())) {
                return "These are all bases, and bases don't react with each other - the mixture is just a more dilute alkaline solution.";
            }
            Substance gas = subs.stream().filter(Substance::isGas).findFirst().orElse(null);
            if (gas != null) {
                return gas.name() + " doesn't react with " + (names.size() == 2 ? names.get(subs.indexOf(gas) == 0 ? 1 : 0) : "the other substances")
                        + " at " + Math.round(tempC) + " °C - " + (aqMl > 0 ? "it bubbles through and escapes." : "the gas just surrounds it.");
            }
            boolean liquids = aqMl > 0 || organicMl > 0;
            boolean coloured = subs.stream().anyMatch(s -> !s.isSolid() && !s.isGas() && s.opacity() > 0.2);
            boolean dissolved = !observations.isEmpty();
            return "No new substance forms: " + joined + (liquids ? " simply mix" + (aqMl > 0 && organicMl <= 0 ? " into one solution" : "")
                    : " just sit together") + ", and each keeps its own particles."
                    + (dissolved ? " Dissolving is a physical change, not a reaction." : "")
                    + (coloured && liquids ? " The colour you see is just the original colours blended and diluted." : "");
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
            addColour(cs, ws, "Cl2", "#cfe35a", 30);
            addColour(cs, ws, "Br2", "#d0661a", 40);
            addColour(cs, ws, "OBr-", "#f2d84a", 6);
            addColour(cs, ws, "Ni^2+", "#5fbf6a", 6);
            addColour(cs, ws, "Co^2+", "#e58fb0", 8);
            // Chromium(III) is violet as the sulfate, green once chloride ions join it.
            addColour(cs, ws, "Cr^3+", has("Cl-") || !has("SO4^2-") ? "#4f8a5a" : "#6a4f8f", 10);
            addColour(cs, ws, "Cr2O7^2-", "#f08a1c", 60);
            addColour(cs, ws, "CrO4^2-", "#f2d21a", 40);
            addColour(cs, ws, "MnO4^2-", "#2f8a3a", 400);
            addColour(cs, ws, "[Fe(SCN)]^2+", "#9a0f12", 600);
            addColour(cs, ws, "[Fe(C2O4)3]^3-", "#b8d44a", 20);
            addColour(cs, ws, "[Fe(Sal)]^+", "#5a1f6a", 400);
            addColour(cs, ws, "Fe(CH3COO)", "#8a3a1a", 80);
            addColour(cs, ws, "[Ni(NH3)6]^2+", "#7a6ad8", 20);
            addColour(cs, ws, "[Co(NH3)6]^2+", "#c8a26a", 10);
            addColour(cs, ws, "[Cr(OH)6]^3-", "#2f6a3a", 20);
            addColour(cs, ws, "Cu(cplx)", "#1f4fd8", 30);
            addColour(cs, ws, "Cu(biuret)", "#5d8ee8", 60);
            addColour(cs, ws, "Cu(protein)", "#7a3fb0", 120);
            addColour(cs, ws, "Cu(gly)", "#1d3fc8", 30);
            addColour(cs, ws, "[Cu(S2O3)2]^3-", "#eef6fb", 0.5);
            addColour(cs, ws, "[Fe(S2O3)]^+", "#5a2a7a", 400);
            addColour(cs, ws, "dcpip", "#2b54c8", ph < 5 ? 0 : 900);
            addColour(cs, ws, "dcpip", "#e88aa8", ph < 5 ? 900 : 0);
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
            for (String ind : INDICATORS) {
                double c = molar(ind);
                if (c <= EPS || Double.isNaN(ph) || bleached) continue;
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

    /** Every pH indicator species the engine colours, in reporting order. */
    static final List<String> INDICATORS = List.of(
            "ind:pp", "ind:ui", "ind:mo", "ind:lit", "ind:btb", "ind:mr", "ind:tp", "ind:pr", "ind:rc", "ind:tur", "ind:hci");

    static String indicatorName(String ind) {
        return switch (ind) {
            case "ind:pp" -> "Phenolphthalein";
            case "ind:ui" -> "Universal indicator";
            case "ind:mo" -> "Methyl orange";
            case "ind:lit" -> "Litmus";
            case "ind:btb" -> "Bromothymol blue";
            case "ind:mr" -> "Methyl red";
            case "ind:tp" -> "Thymolphthalein";
            case "ind:pr" -> "Phenol red";
            case "ind:rc" -> "Red cabbage indicator";
            case "ind:tur" -> "Turmeric";
            default -> "Hydrogencarbonate indicator";
        };
    }

    /** Two-colour indicator: acid colour below lo, base colour above hi, a blend in between. */
    private static Colour band(double ph, double lo, double hi, String acidHex, String baseHex) {
        if (ph <= lo) return Colour.hex(acidHex, 1);
        if (ph >= hi) return Colour.hex(baseHex, 1);
        return Colour.lerp(Colour.hex(acidHex, 1), Colour.hex(baseHex, 1), (ph - lo) / (hi - lo));
    }

    private static final double[] RC_PH = {2, 4, 6, 7, 8, 10, 12};
    private static final String[] RC_HEX = {"#d8204a", "#c2407a", "#8a3f9a", "#6a3fa0", "#3f5ab8", "#2f9a7a", "#d6c82a"};

    static Colour indicatorColour(String ind, double ph) {
        return switch (ind) {
            case "ind:pp" -> Colour.hex("#e8338a", 1);
            case "ind:tp" -> Colour.hex("#2f5fd0", 1);
            case "ind:mo" -> band(ph, 3.1, 4.4, "#e0302a", "#f2c230");
            case "ind:lit" -> ph < 6.5 ? band(ph, 4.5, 6.5, "#d8343a", "#7a4fa0") : band(ph, 6.5, 8.3, "#7a4fa0", "#2f5fc8");
            case "ind:btb" -> ph < 7.0 ? band(ph, 6.0, 7.0, "#e8d02a", "#3f9a55") : band(ph, 7.0, 7.6, "#3f9a55", "#2a5fc0");
            case "ind:mr" -> band(ph, 4.4, 6.2, "#d8303a", "#f0c02a");
            case "ind:pr" -> band(ph, 6.8, 8.2, "#f0c02a", "#e0306a");
            case "ind:tur" -> band(ph, 7.4, 8.6, "#f2b81a", "#a8381a");
            case "ind:hci" -> ph < 8.3 ? band(ph, 7.6, 8.3, "#e8c02a", "#e2563a") : band(ph, 8.3, 9.2, "#e2563a", "#8a2f9a");
            case "ind:rc" -> scale(ph, RC_PH, RC_HEX);
            default -> universal(ph);
        };
    }

    static double indicatorStrength(String ind, double ph) {
        if ("ind:pp".equals(ind)) {
            return ph < 8.2 ? 0 : Math.min(1, (ph - 8.2) / 1.8);
        }
        if ("ind:tp".equals(ind)) {
            return ph < 9.3 ? 0 : Math.min(1, (ph - 9.3) / 1.2);
        }
        return 1;
    }

    /** Whether the indicator visibly differs from its colour in pure water. */
    static boolean indicatorChanged(String ind, double ph) {
        if ("ind:pp".equals(ind) || "ind:tp".equals(ind)) return indicatorStrength(ind, ph) > 0.05;
        return indicatorColour(ind, ph).distance(indicatorColour(ind, 7.0)) > 0.06;
    }

    static String indicatorWord(String ind, double ph) {
        return switch (ind) {
            case "ind:pp" -> ph < 8.2 ? "colourless" : ph < 9.5 ? "pale pink" : "bright pink";
            case "ind:tp" -> ph < 9.3 ? "colourless" : ph < 10.5 ? "pale blue" : "blue";
            case "ind:mo" -> ph < 3.1 ? "red" : ph > 4.4 ? "yellow" : "orange";
            case "ind:lit" -> ph < 5 ? "red" : ph > 8 ? "blue" : "purple";
            case "ind:btb" -> ph < 6.0 ? "yellow" : ph > 7.6 ? "blue" : "green";
            case "ind:mr" -> ph < 4.4 ? "red" : ph > 6.2 ? "yellow" : "orange";
            case "ind:pr" -> ph < 6.8 ? "yellow" : ph > 8.2 ? "red-pink" : "orange";
            case "ind:tur" -> ph < 7.4 ? "yellow" : ph > 8.6 ? "red-brown" : "orange";
            case "ind:hci" -> ph < 7.6 ? "yellow" : ph < 8.0 ? "orange" : ph < 8.8 ? "red" : "purple";
            case "ind:rc" -> ph < 3 ? "red" : ph < 5 ? "pink" : ph < 6.5 ? "purple-pink" : ph < 7.5 ? "purple"
                    : ph < 9 ? "blue" : ph < 11 ? "green" : "yellow";
            default -> ph < 2.5 ? "red" : ph < 4.5 ? "orange" : ph < 6.2 ? "yellow" : ph < 7.8 ? "green"
                    : ph < 9.5 ? "blue" : ph < 11.5 ? "indigo" : "violet";
        };
    }

    private static Colour scale(double ph, double[] phs, String[] hexes) {
        if (ph <= phs[0]) return Colour.hex(hexes[0], 1);
        for (int i = 1; i < phs.length; i++) {
            if (ph <= phs[i]) {
                double t = (ph - phs[i - 1]) / (phs[i] - phs[i - 1]);
                return Colour.lerp(Colour.hex(hexes[i - 1], 1), Colour.hex(hexes[i], 1), t);
            }
        }
        return Colour.hex(hexes[hexes.length - 1], 1);
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

    /** Molar masses of solids registered by the precipitation table and other rules. */
    static final Map<String, Double> MOLAR_MASS = new java.util.concurrent.ConcurrentHashMap<>(Map.of(
            "Cu2O", 143.1, "Ag", 107.9, "Cu", 63.5, "CHI3", 393.7, "SiO2·xH2O", 78.0, "C", 12.0));

    static double molarMassOf(String formula) {
        Double known = MOLAR_MASS.get(formula);
        if (known != null) return known;
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
            case "PbI2" -> 461.0;
            case "PbSO4" -> 303.3;
            case "PbCl2" -> 278.1;
            case "PbBr2" -> 367.0;
            case "PbCO3" -> 267.2;
            case "Al(OH)3" -> 78.0;
            case "Ca(OH)2" -> 74.1;
            default -> 100;
        };
    }

    static String colourWord(String hex) {
        return switch (hex) {
            case "#f2e27a", "#f7c21a" -> "yellow";
            case "#eee3bf", "#efe6b0" -> "cream";
            case "#58a894" -> "blue-green";
            case "#a0a88a" -> "grey-green";
            case "#151515", "#1e1e22" -> "black";
            case "#b83a22", "#c0402a" -> "brick-red";
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
