package com.labscape.api.intelligence.chem;

import com.labscape.api.intelligence.chem.ChemistryEngine.Portion;
import com.labscape.api.intelligence.chem.Latex.Term;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Chemistry of the 118 elements: reactions with water, direct combination (synthesis and burning),
 * halogens dissolving, and coverage decisions. Predictions for metal + non-metal products use common
 * oxidation states, so fidelity is "approximate"; anything not predictable is answered "unsupported".
 */
final class ElementRules {

    private ElementRules() {}

    enum When { SPONTANEOUS, IGNITE, CATALYST, EXTREME, NONE }

    private static final Set<String> NOBLE_METALS = Set.of("Au", "Pt", "Pd", "Rh", "Ir", "Ru", "Ag");
    private static final Set<String> AMPHOTERIC = Set.of("Al", "Zn", "Sn", "Pb", "Be", "Ga");
    private static final Set<String> COMBINING_NONMETALS = Set.of("F", "Cl", "Br", "I", "O", "S", "N", "H", "C");
    private static final List<String> NONMETAL_ORDER = List.of("F", "Cl", "O", "Br", "I", "S", "N", "H", "C");

    static final Map<String, String> FLAME = Map.ofEntries(
            Map.entry("Li", "#ff2a4a"), Map.entry("Na", "#ffb20f"), Map.entry("K", "#c08cff"), Map.entry("Rb", "#e0409f"),
            Map.entry("Cs", "#7c8cff"), Map.entry("Ca", "#ff6a2a"), Map.entry("Sr", "#ff2a3a"), Map.entry("Ba", "#a6f05a"),
            Map.entry("Cu", "#3fe0b0"), Map.entry("Mg", "#ffffff"), Map.entry("Al", "#fff6e0"), Map.entry("Fe", "#ffa040"),
            Map.entry("Zn", "#a8e0ff"), Map.entry("B", "#5cff7a"), Map.entry("S", "#5a7cff"), Map.entry("H", "#9ec8ff"),
            Map.entry("P", "#fff4d0"), Map.entry("C", "#ff8a30"));

    private static String flame(String sym) {
        return FLAME.getOrDefault(sym, "#ffb060");
    }

    // ------------------------------------------------------------------------------ coverage

    /** Returns a "not modelled" message for a pair involving an element, or null when modelled. */
    static String coverage(Substance a, Substance b) {
        for (Substance s : List.of(a, b)) {
            if (s.isElement() && s.element().superheavy()) return superheavyMessage(s);
        }
        if (a.isElement() && b.isElement()) return pairCoverage(a, b);
        Substance el = a.isElement() ? a : b;
        Substance other = el == a ? b : a;
        return compoundCoverage(el, other);
    }

    static String superheavyMessage(Substance s) {
        return "Only a handful of " + s.name() + " atoms have ever been made, and they decay within seconds - "
                + "nobody has measured its chemistry yet.";
    }

    private static String notModelled(Substance a, Substance b) {
        return "LABscape has no validated model for " + a.displayName() + " with " + b.displayName() + ".";
    }

    private static boolean oxidiser(Substance c) {
        return c.hasTag("peroxide") || c.hasTag("permanganate") || c.hasTag("hypochlorite") || c.hasTag("iodine")
                || c.hasTag("strong_oxidiser_solid") || c.hasTag("nitrate_oxidiser");
    }

    private static String compoundCoverage(Substance el, Substance c) {
        Substance.ElementInfo e = el.element();
        String sym = e.symbol();
        if ("water".equals(c.id()) || "noble".equals(e.category()) || Set.of("H", "O", "N").contains(sym)) return null;
        if ("halogen".equals(e.category())) {
            if ("F".equals(sym) || "At".equals(sym) || oxidiser(c)) return notModelled(el, c);
            return null;
        }
        if (e.isMetal()) {
            if (AMPHOTERIC.contains(sym) && c.base() != null && !c.base().ammonia()) return notModelled(el, c);
            if (oxidiser(c) || c.hasTag("oxide") || c.hasTag("catalyst") || c.hasTag("thermite_oxide")) return notModelled(el, c);
            return null;
        }
        // non-metal / metalloid solids
        if (c.base() != null || oxidiser(c)) return notModelled(el, c);
        return null;
    }

    private static String pairCoverage(Substance a, Substance b) {
        Substance.ElementInfo x = a.element();
        Substance.ElementInfo y = b.element();
        if (x.isMetal() && y.isMetal()) return null;
        if ("noble".equals(x.category()) || "noble".equals(y.category())) {
            boolean xenonFluorine = Set.of(x.symbol(), y.symbol()).equals(Set.of("Xe", "F"));
            return xenonFluorine ? notModelled(a, b) : null;
        }
        if (x.isMetal() || y.isMetal()) {
            Substance.ElementInfo nm = x.isMetal() ? y : x;
            Substance.ElementInfo metal = x.isMetal() ? x : y;
            if ("At".equals(nm.symbol()) || "Os".equals(metal.symbol()) && "O".equals(nm.symbol())) return notModelled(a, b);
            return COMBINING_NONMETALS.contains(nm.symbol()) ? null : notModelled(a, b);
        }
        return nonmetalWhen(key(x.symbol(), y.symbol())) == null ? notModelled(a, b) : null;
    }

    private static String key(String a, String b) {
        return a.compareTo(b) <= 0 ? a + "|" + b : b + "|" + a;
    }

    /** null = not modelled. */
    private static When nonmetalWhen(String k) {
        return switch (k) {
            case "H|O", "Cl|H", "Br|H", "H|I", "H|S", "C|O", "O|S", "O|P" -> When.IGNITE;
            case "F|H", "Cl|P" -> When.SPONTANEOUS;
            case "H|N" -> When.CATALYST;
            case "N|O", "O|Si" -> When.EXTREME;
            case "C|H", "Cl|O", "Br|O", "I|O", "F|O", "Cl|N", "Br|N", "I|N", "F|N", "C|N" -> When.NONE;
            default -> null;
        };
    }

    // ------------------------------------------------------------------------------ apply

    static void apply(MixtureOps m) {
        List<Portion> els = m.portions().stream().filter(p -> p.substance().isElement()).toList();
        if (els.isEmpty()) return;
        for (Portion p : els) {
            if (p.substance().element().radioactive()) {
                m.observe("☢ " + p.substance().name() + " is radioactive. In a real lab it would need shielding and a licence; "
                        + "here its chemistry follows the rest of its group.");
            }
        }
        if (m.aqMl() > 0) water(m, els);
        synthesis(m);
    }

    private static String speciesKey(Substance s) {
        return s.species().keySet().iterator().next();
    }

    // ------------------------------------------------------------------------------ water

    private static void water(MixtureOps m, List<Portion> els) {
        for (Portion p : els) {
            Substance s = p.substance();
            Substance.ElementInfo e = s.element();
            String sym = e.symbol();
            String key = speciesKey(s);
            switch (e.category()) {
                case "alkali" -> alkaliWater(m, s, key);
                case "alkaline-earth" -> alkalineEarthWater(m, s, key);
                case "lanthanide" -> lanthanideWater(m, s, key);
                case "halogen" -> halogenWater(m, s, key);
                case "noble" -> m.reason(s.name() + " is a noble gas: its full outer shell of electrons means it doesn't react.");
                default -> {
                    if (Set.of("H", "O", "N").contains(sym)) {
                        m.reason(s.name() + " gas just bubbles through the water without reacting.");
                    } else if (!e.isMetal()) {
                        m.reason(s.name() + " doesn't dissolve in or react with water.");
                    }
                }
            }
        }
    }

    private static void alkaliWater(MixtureOps m, Substance s, String key) {
        double n = m.get(key);
        if (n <= ChemistryEngine.EPS) return;
        String sym = s.element().symbol();
        m.take(key, n);
        m.add(sym + "+", n);
        m.add("OH-", n);
        double heatPerMol = switch (sym) {
            case "Li" -> 222_000;
            case "Na" -> 184_000;
            default -> 196_000;
        };
        m.heat(heatPerMol * n);
        long start = m.nextStart();
        String target = m.solidTarget(key) == null ? "vessel" : m.solidTarget(key);
        double violence = switch (sym) {
            case "Li" -> 1.2;
            case "Na" -> 2.4;
            case "K" -> 3.4;
            default -> 4.5;
        };
        m.gas("H2", n / 2, target, violence, "fine", start);
        m.dissolveSolid(key, start, (long) (6000 / violence));
        if (!"Li".equals(sym)) {
            Map<String, Object> skate = m.cue("skate", target, start);
            skate.put("colour", Colour.hex("#e8ecf2", 1).toJson());
            skate.put("durationMs", (long) (6000 / violence));
        }
        if (violence >= 3) {
            Map<String, Object> f = m.cue("flame", "vessel", start + 300);
            f.put("colour", Colour.hex(flame(sym), 1).toJson());
            f.put("intensity", Math.min(1, violence / 4.5));
            f.put("durationMs", 1800);
            Map<String, Object> snd = m.cue("sound", "vessel", start + 300);
            snd.put("soundId", violence >= 4 ? "bang" : "crackle");
        } else {
            m.cue("sound", "vessel", start).put("soundId", "sizzle");
        }
        String hydroxide = sym + "OH";
        Lore.register(hydroxide, s.name() + " hydroxide", null);
        m.product(hydroxide, n, "aq");

        m.reaction("alkali-water-" + sym.toLowerCase(Locale.ROOT), s.name() + " reacts with water", "gas",
                Latex.equation(List.of(Term.of(2, sym, "s"), Term.of(2, "H2O", "l")),
                        List.of(Term.of(2, hydroxide, "aq"), Term.of(1, "H2", "g")), null),
                "alkali-water", n);
        m.observe(switch (sym) {
            case "Li" -> "Lithium floats and fizzes steadily, slowly shrinking as hydrogen bubbles off.";
            case "Na" -> "Sodium melts into a shiny silver ball that whizzes around on the surface, fizzing and hissing.";
            case "K" -> "Potassium skates across the water and the hydrogen bursts into a lilac flame with sharp crackles.";
            case "Rb" -> "Rubidium reacts explosively - a violent flash and a spray of water.";
            case "Cs" -> "Caesium explodes the instant it touches the water.";
            default -> s.name() + " reacts violently, releasing hydrogen.";
        });
        m.observe("The water becomes strongly alkaline as " + s.name().toLowerCase(Locale.ROOT) + " hydroxide forms.");
    }

    private static void alkalineEarthWater(MixtureOps m, Substance s, String key) {
        String sym = s.element().symbol();
        if ("Mg".equals(sym)) return; // handled by the engine (needs hot water)
        if ("Be".equals(sym)) {
            m.reason("Beryllium is protected by an oxide layer and doesn't react with water.");
            return;
        }
        double n = m.get(key);
        if (n <= ChemistryEngine.EPS) return;
        m.take(key, n);
        m.add(sym + "^2+", n);
        m.add("OH-", 2 * n);
        m.heat(414_000 * n);
        long start = m.nextStart();
        String target = m.solidTarget(key) == null ? "vessel" : m.solidTarget(key);
        m.gas("H2", n, target, "Ca".equals(sym) ? 1.4 : 2.0, "fine", start);
        m.dissolveSolid(key, start, 5000);
        String hydroxide = sym + "(OH)2";
        Lore.register(hydroxide, s.name() + " hydroxide", "#f4f4f2");
        if ("Ca".equals(sym)) m.precipitate("Ca(OH)2", n * 0.4, "#f4f4f2", start + 800, 9000);
        m.product(hydroxide, n, "Ca".equals(sym) ? "s" : "aq");
        m.reaction("alkaline-earth-water-" + sym.toLowerCase(Locale.ROOT), s.name() + " reacts with water", "gas",
                Latex.equation(List.of(Term.of(1, sym, "s"), Term.of(2, "H2O", "l")),
                        List.of(Term.of(1, hydroxide, "Ca".equals(sym) ? "s" : "aq"), Term.of(1, "H2", "g")), null),
                "alkaline-earth-water", n);
        m.observe(s.name() + " fizzes steadily as it sinks, giving off hydrogen"
                + ("Ca".equals(sym) ? "; the water turns milky as calcium hydroxide forms." : "."));
    }

    private static void lanthanideWater(MixtureOps m, Substance s, String key) {
        double n = m.get(key) * 0.3;
        if (n <= ChemistryEngine.EPS) return;
        String sym = s.element().symbol();
        m.take(key, n);
        long start = m.nextStart();
        String target = m.solidTarget(key) == null ? "vessel" : m.solidTarget(key);
        m.gas("H2", 1.5 * n, target, 0.4, "fine", start);
        String hydroxide = sym + "(OH)3";
        Lore.register(hydroxide, s.name() + " hydroxide", "#f2f2ee");
        m.precipitate(hydroxide, n, "#f2f2ee", start + 600, 9000);
        m.reaction("lanthanide-water-" + sym.toLowerCase(Locale.ROOT), s.name() + " reacts slowly with water", "gas",
                Latex.equation(List.of(Term.of(2, sym, "s"), Term.of(6, "H2O", "l")),
                        List.of(Term.of(2, hydroxide, "s"), Term.of(3, "H2", "g")), null),
                null, n);
        m.observe(s.name() + " slowly gives off small bubbles of hydrogen, forming a white hydroxide.");
    }

    private static void halogenWater(MixtureOps m, Substance s, String key) {
        String sym = s.element().symbol();
        double litres = m.aqMl() / 1000.0;
        long start = m.nextStart();
        switch (sym) {
            case "F" -> {
                double n = m.take(key, m.get(key));
                if (n <= 0) return;
                m.add("H+", 2 * n);
                m.add("F-", 2 * n);
                m.gas("O2", n / 2, "vessel", 3.5, "fine", start);
                m.cue("sound", "vessel", start).put("soundId", "hiss");
                m.product("HF", 2 * n, "aq");
                m.reaction("fluorine-water", "Fluorine attacks water", "redox",
                        Latex.equation(List.of(Term.of(2, "F2", "g"), Term.of(2, "H2O", "l")),
                                List.of(Term.of(4, "HF", "aq"), Term.of(1, "O2", "g")), null),
                        null, n);
                m.observe("Fluorine is so reactive it rips water apart, releasing oxygen and making hydrofluoric acid.");
            }
            case "Cl" -> {
                double n = m.get(key);
                double d = m.take(key, Math.min(n, 0.09 * litres));
                if (d > 0) {
                    m.add("Cl2", d * 0.7);
                    m.add("H+", d * 0.3);
                    m.add("Cl-", d * 0.3);
                    m.add("HOCl", d * 0.3);
                    m.product("HOCl", d * 0.3, "aq");
                    m.reaction("chlorine-water", "Chlorine dissolves in water", "redox",
                            Latex.equation(List.of(Term.of(1, "Cl2", "g"), Term.of(1, "H2O", "l")),
                                    List.of(Term.of(1, "HCl", "aq"), Term.of(1, "HOCl", "aq")), null),
                            null, d);
                    Lore.register("HOCl", "Hypochlorous acid (a bleach)", null);
                    m.observe("Some chlorine dissolves, making pale green 'chlorine water' - an acidic bleach.");
                }
                if (m.get(key) > ChemistryEngine.EPS) gasCloud(m, "Cl2", start);
            }
            case "Br" -> {
                double d = m.take(key, Math.min(m.get(key), 0.2 * litres));
                if (d > 0) {
                    m.add("Br2", d);
                    m.observe("The dense red-brown bromine dissolves into orange 'bromine water'.");
                }
                if (m.get(key) > ChemistryEngine.EPS) gasCloud(m, "Br2", start);
            }
            case "I" -> {
                double limit = 0.0013 * litres + m.get("I-");
                double d = m.take(key, Math.min(m.get(key), limit));
                if (d > 0) {
                    m.add("I2", d);
                    m.observe(m.get("I-") > 0 ? "Iodine dissolves in the iodide solution, turning it brown."
                            : "A little iodine dissolves, tinting the water pale brown - most of the crystals stay put.");
                }
            }
            default -> m.reason(s.name() + " is radioactive and too rare for its reactions with water to be modelled.");
        }
    }

    private static void gasCloud(MixtureOps m, String gas, long start) {
        Lore.Gas g = Lore.GASES.get(gas);
        Map<String, Object> c = m.cue("smoke", "vessel", start);
        c.put("colour", Colour.hex(g.colourHex() == null ? "#ffffff" : g.colourHex(), 0.7).toJson());
        c.put("density", 0.6);
        c.put("durationMs", 6000);
        c.put("label", g.name() + " - " + g.smell().toLowerCase(Locale.ROOT));
    }

    // ------------------------------------------------------------------------------ synthesis

    private record Part(Substance s, String key, String sym) {}

    private static void synthesis(MixtureOps m) {
        List<Part> metals = new ArrayList<>();
        List<Part> nonmetals = new ArrayList<>();
        List<Part> nobles = new ArrayList<>();
        for (Portion p : m.portions()) {
            Substance s = p.substance();
            if (s.metal() != null) {
                metals.add(new Part(s, s.metal().symbol() + "(s)", s.metal().symbol()));
            } else if (s.isElement()) {
                Part part = new Part(s, speciesKey(s), s.element().symbol());
                if ("noble".equals(s.element().category())) nobles.add(part);
                else nonmetals.add(part);
            }
        }
        nonmetals.sort(Comparator.comparingInt(p -> {
            int i = NONMETAL_ORDER.indexOf(p.sym());
            return i < 0 ? 99 : i;
        }));
        boolean anyElement = m.portions().stream().anyMatch(p -> p.substance().isElement());
        if (!anyElement) return;

        for (Part x : nonmetals) {
            for (Part metal : metals) metalNonmetal(m, metal, x);
        }
        for (int i = 0; i < nonmetals.size(); i++) {
            for (int j = i + 1; j < nonmetals.size(); j++) nonmetalPair(m, nonmetals.get(i), nonmetals.get(j));
        }
        if (metals.size() >= 2 && nonmetals.isEmpty()) {
            m.reason("Metals don't react with each other. Melted together they would form an alloy - like copper and zinc making brass.");
        }
        boolean xenonFluorine = nobles.stream().anyMatch(p -> "Xe".equals(p.sym())) && nonmetals.stream().anyMatch(p -> "F".equals(p.sym()));
        if (xenonFluorine) {
            m.reason("Xenon is one of the few noble gases that does form compounds - with fluorine it makes xenon fluorides, "
                    + "but only when heated to about 400 °C or lit by ultraviolet light, far beyond this bench.");
        } else if (!nobles.isEmpty()) {
            m.reason(nobles.get(0).s().name() + " is a noble gas: its full outer shell of electrons means it doesn't react.");
        }
    }

    private static Substance.ElementInfo info(String sym) {
        return Elements.INFO.get(sym);
    }

    private static int metalCharge(String metalSym, String x) {
        Substance.ElementInfo e = info(metalSym);
        List<Integer> pos = e == null ? List.of(2) : e.oxidationStates().stream().filter(o -> o > 0).toList();
        if (pos.isEmpty()) return 2;
        return switch (x) {
            case "F", "Cl", "Br", "O" -> pos.stream().filter(o -> o <= 3).max(Integer::compare).orElse(pos.get(0));
            case "I", "S" -> pos.stream().min(Integer::compare).orElse(pos.get(0));
            default -> pos.get(0);
        };
    }

    private static boolean variableValence(String metalSym) {
        Substance.ElementInfo e = info(metalSym);
        if (e == null) return false;
        long positives = e.oxidationStates().stream().filter(o -> o > 0).count();
        return positives > 1 && Set.of("transition", "post-transition", "lanthanide", "actinide").contains(e.category());
    }

    private static String category(String sym) {
        Substance.ElementInfo e = info(sym);
        return e == null ? "" : e.category();
    }

    private static When metalWhen(String metal, String x) {
        String cat = category(metal);
        boolean group1 = "alkali".equals(cat);
        boolean group2 = "alkaline-earth".equals(cat) && !"Be".equals(metal);
        return switch (x) {
            case "O" -> NOBLE_METALS.contains(metal) ? When.NONE : group1 ? When.SPONTANEOUS : When.IGNITE;
            case "F" -> Set.of("Au", "Pt").contains(metal) ? When.IGNITE : When.SPONTANEOUS;
            case "Cl", "Br" -> group1 || group2 ? When.SPONTANEOUS : When.IGNITE;
            case "I" -> group1 ? When.SPONTANEOUS : Set.of("Au", "Pt", "Pd", "Rh", "Ir", "Ru").contains(metal) ? When.NONE : When.IGNITE;
            case "S" -> Set.of("Hg", "Ag").contains(metal) ? When.SPONTANEOUS
                    : Set.of("Au", "Pt", "Pd", "Rh", "Ir", "Ru").contains(metal) ? When.NONE : When.IGNITE;
            case "N" -> "Li".equals(metal) ? When.SPONTANEOUS : Set.of("Mg", "Ca", "Sr", "Ba").contains(metal) ? When.IGNITE : When.NONE;
            case "H" -> group1 || Set.of("Ca", "Sr", "Ba").contains(metal) ? When.IGNITE : When.NONE;
            case "C" -> When.EXTREME;
            default -> When.NONE;
        };
    }

    private static void metalNonmetal(MixtureOps m, Part metal, Part x) {
        double nM = m.get(metal.key());
        double nX = m.get(x.key());
        if (nM <= ChemistryEngine.EPS || nX <= ChemistryEngine.EPS) return;
        String M = metal.sym();
        String X = x.sym();
        String metalName = Elements.NAME.getOrDefault(M, M);
        When when = metalWhen(M, X);
        switch (when) {
            case NONE -> {
                m.reason(switch (X) {
                    case "O" -> metalName + " is a noble metal - it doesn't burn or tarnish in oxygen.";
                    case "N" -> "Nitrogen is very unreactive: " + metalName.toLowerCase(Locale.ROOT) + " doesn't combine with it.";
                    case "H" -> "Pd".equals(M) ? "Palladium soaks up hydrogen like a sponge, but no new compound forms."
                            : metalName + " doesn't combine with hydrogen.";
                    default -> metalName + " doesn't combine with " + Elements.NAME.getOrDefault(X, X).toLowerCase(Locale.ROOT) + ".";
                });
                return;
            }
            case EXTREME -> {
                m.pending("NEEDS_EXTREME", null, metalName + " and carbon only combine in an electric furnace at around 2000 °C - far beyond a school lab.");
                return;
            }
            case IGNITE -> {
                if (!m.ignition()) {
                    m.pending("NEEDS_IGNITION", "spark", "Nothing happens yet - " + metalName.toLowerCase(Locale.ROOT)
                            + " and " + Elements.NAME.getOrDefault(X, X).toLowerCase(Locale.ROOT)
                            + " need a flame or spark to start reacting. Use the spark igniter or Bunsen burner.");
                    return;
                }
            }
            default -> {}
        }
        int c = metalCharge(M, X);
        int a = switch (X) {
            case "O", "S" -> 2;
            case "N" -> 3;
            default -> 1;
        };
        int d = "S".equals(X) ? 1 : 2;
        Latex.Salt salt = Latex.salt(M, c, false, X, a, false);
        int y = salt.anions();
        int cP = d / Latex.gcd(y, d);
        int aM = cP * salt.cations();
        int bX = cP * y / d;
        double e = Math.min(nM / aM, nX / bX);
        if (e <= ChemistryEngine.EPS) return;
        m.take(metal.key(), aM * e);
        m.take(x.key(), bX * e);
        String product = salt.formula();
        String name = Lore.saltName(metalName, c, variableValence(M), X);
        String colourHex = productColour(product, X, M);
        Lore.register(product, name, colourHex);
        m.heat(300_000.0 * c * aM * e);

        long start = m.nextStart();
        boolean soluble = m.aqMl() > 0 && Set.of("F", "Cl", "Br", "I").contains(X)
                && Set.of("alkali", "alkaline-earth").contains(category(M));
        if (soluble) {
            String ion = c == 1 ? M + "+" : M + "^" + c + "+";
            m.add(ion, aM * e);
            m.add(X + "-", cP * y * e);
            m.product(product, cP * e, "aq");
        } else {
            m.product(product, cP * e, "s");
            m.precipitate(product, cP * e, colourHex, start + 400, 5000);
        }
        boolean burning = when == When.IGNITE || "O".equals(X) || Set.of("F", "Cl").contains(X);
        if (burning) {
            Map<String, Object> f = m.cue("flame", "vessel", start);
            f.put("colour", Colour.hex(flame(M), 1).toJson());
            f.put("intensity", "Mg".equals(M) ? 1.0 : 0.7);
            f.put("durationMs", 2600);
            if ("Mg".equals(M) || "Al".equals(M)) {
                Map<String, Object> l = m.cue("light", "vessel", start);
                l.put("colour", Colour.hex("#ffffff", 1).toJson());
                l.put("intensity", 1.0);
                l.put("durationMs", 2200);
            }
            Map<String, Object> smoke = m.cue("smoke", "vessel", start + 300);
            smoke.put("colour", Colour.hex(colourHex, 0.8).toJson());
            smoke.put("density", 0.5);
            smoke.put("durationMs", 4000);
            smoke.put("label", "Smoke of " + name.toLowerCase(Locale.ROOT));
            m.cue("sound", "vessel", start).put("soundId", "Mg".equals(M) ? "whoosh" : "crackle");
        }
        String discovery = switch (X) {
            case "O" -> "metal-burning";
            case "S" -> "metal-sulfide";
            case "N" -> "nitride";
            case "H" -> null;
            default -> "salt-synthesis";
        };
        m.reaction("synthesis-" + M.toLowerCase(Locale.ROOT) + "-" + X.toLowerCase(Locale.ROOT),
                metalName + " + " + Elements.NAME.getOrDefault(X, X).toLowerCase(Locale.ROOT), "synthesis",
                Latex.equation(List.of(Term.of(aM, M, "s"), Term.of(bX, x.s().formula(), stateOf(x.s()))),
                        List.of(Term.of(cP, product, soluble ? "aq" : "s")), null),
                discovery, e);
        m.observe(describe(M, X, metalName, name));
    }

    private static String stateOf(Substance s) {
        return s.isGas() ? "g" : "liquid".equals(s.form()) ? "l" : "s";
    }

    private static String productColour(String product, String x, String metal) {
        String known = Lore.colour(product);
        if (known != null) return known;
        return switch (product) {
            case "CuO", "FeS", "CuS", "Cu2S", "Ag2S", "PbS", "NiS", "CoS" -> "#1e1e22";
            case "Fe2O3", "FeCl3" -> "#8a3b1c";
            case "HgS" -> "#c0282a";
            case "CdS" -> "#f2c21a";
            case "Mg3N2" -> "#c9d77a";
            case "CuCl2" -> "#6b5a2a";
            case "PbO" -> "#f2b84a";
            case "ZnO" -> "#ffffff";
            default -> "S".equals(x) ? "#3a3a3a" : "#f4f4f2";
        };
    }

    private static String describe(String M, String X, String metalName, String productName) {
        String p = productName.toLowerCase(Locale.ROOT);
        return switch (X) {
            case "O" -> "Mg".equals(M) ? "Magnesium burns with a blinding white light, leaving a white powder of magnesium oxide."
                    : "Fe".equals(M) ? "Iron burns with showers of orange sparks, leaving " + p + "."
                    : "alkali".equals(category(M)) ? metalName + " tarnishes at once and burns with a coloured flame, forming " + p + "."
                    : metalName + " burns in oxygen, leaving " + p + ".";
            case "Cl", "F", "Br" -> metalName + " burns in the halogen, filling the vessel with smoke of " + p + ".";
            case "I" -> metalName + " slowly combines with iodine to form " + p + ".";
            case "S" -> "Hg".equals(M) ? "Mercury and sulfur combine just by mixing - that's how mercury spills are cleaned up."
                    : "The mixture glows red-hot and the glow spreads through it, leaving " + p + ".";
            case "N" -> metalName + " burns in nitrogen, forming " + p + ".";
            case "H" -> metalName + " absorbs hydrogen to form a white solid, " + p + ".";
            default -> metalName + " combines to form " + p + ".";
        };
    }

    private static void nonmetalPair(MixtureOps m, Part a, Part b) {
        String k = key(a.sym(), b.sym());
        When when = nonmetalWhen(k);
        if (when == null) {
            if (m.get(a.key()) > ChemistryEngine.EPS && m.get(b.key()) > ChemistryEngine.EPS) {
                m.reason(a.s().name() + " and " + b.s().name().toLowerCase(Locale.ROOT) + " don't combine just by mixing at "
                        + "these temperatures - nothing visible happens.");
            }
            return;
        }
        Part first = a.sym().compareTo(b.sym()) <= 0 ? a : b;
        Part second = first == a ? b : a;
        if (m.get(first.key()) <= ChemistryEngine.EPS || m.get(second.key()) <= ChemistryEngine.EPS) return;
        String an = first.s().name();
        String bn = second.s().name();
        switch (when) {
            case NONE -> {
                m.reason(an + " and " + bn.toLowerCase(Locale.ROOT) + " don't combine directly.");
                return;
            }
            case CATALYST -> {
                m.pending("NEEDS_CATALYST", "catalyst", "Nitrogen and hydrogen only make ammonia with an iron catalyst at about "
                        + "450 °C and 200 atmospheres - the industrial Haber process.");
                return;
            }
            case EXTREME -> {
                m.pending("NEEDS_EXTREME", null, "N|O".equals(k)
                        ? "Nitrogen and oxygen only combine at about 3000 °C - like inside a lightning bolt."
                        : "Silicon only burns in a very hot furnace.");
                return;
            }
            case IGNITE -> {
                if (!m.ignition()) {
                    m.pending("NEEDS_IGNITION", "spark", "Nothing happens yet - " + an.toLowerCase(Locale.ROOT) + " and "
                            + bn.toLowerCase(Locale.ROOT) + " need a flame or spark to start reacting. Use the spark igniter.");
                    return;
                }
            }
            default -> {}
        }
        long start = m.nextStart();
        switch (k) {
            case "H|O" -> {
                double e = Math.min(m.get("H2(g)") / 2, m.get("O2(g)"));
                m.take("H2(g)", 2 * e);
                m.take("O2(g)", e);
                m.heat(286_000 * 2 * e);
                m.product("H2O", 2 * e, "l");
                double total = 3 * e * 24000;
                flash(m, "#cfe6ff", Math.min(1, total / 300), start);
                m.cue("sound", "vessel", start).put("soundId", total >= 150 ? "bang" : "pop");
                Map<String, Object> c = m.cue("condense", "vessel", start + 400);
                c.put("colour", Colour.hex("#bfe4ff", 0.8).toJson());
                c.put("amount", Math.min(1, 0.45 + 2 * e * 18 / 0.4));
                c.put("durationMs", 3500);
                Map<String, Object> st = m.cue("smoke", "vessel", start + 200);
                st.put("colour", Colour.hex("#ffffff", 0.5).toJson());
                st.put("density", 0.3);
                st.put("durationMs", 2500);
                st.put("label", "Steam - no smell, just warm damp air");
                m.reaction("water-synthesis", "Hydrogen burns in oxygen", "synthesis",
                        Latex.equation(List.of(Term.of(2, "H2", "g"), Term.of(1, "O2", "g")), List.of(Term.of(2, "H2O", "l")), null),
                        "water-synthesis", e);
                m.observe(total >= 150 ? "BANG! The gases explode with a flash, and droplets of water mist the inside of the glass."
                        : "A sharp squeaky 'pop' and a flash - then tiny droplets of water appear on the cold glass.");
                m.observe("Two hydrogen molecules and one oxygen molecule rearrange their atoms into two water molecules.");
            }
            case "Cl|H", "Br|H", "F|H", "H|I" -> {
                String halogen = k.startsWith("H") ? "I" : k.substring(0, k.indexOf('|'));
                String hKey = "H2(g)";
                String xKey = first.sym().equals("H") ? second.key() : first.key();
                double e = Math.min(m.get(hKey), m.get(xKey));
                if ("I".equals(halogen)) e *= 0.2;
                m.take(hKey, e);
                m.take(xKey, e);
                String product = "H" + halogen;
                m.product(product, 2 * e, m.aqMl() > 0 ? "aq" : "g");
                if (m.aqMl() > 0) {
                    m.add("H+", 2 * e);
                    m.add(halogen + "-", 2 * e);
                } else {
                    Lore.Gas g = Lore.GASES.get(product);
                    Map<String, Object> s = m.cue("smoke", "vessel", start + 200);
                    s.put("colour", Colour.hex("#f2f6fa", 0.6).toJson());
                    s.put("density", 0.4);
                    s.put("durationMs", 4000);
                    s.put("label", g.name() + " - " + g.smell().toLowerCase(Locale.ROOT));
                }
                flash(m, "F".equals(halogen) ? "#ffffff" : "#fff0b0", "F".equals(halogen) ? 1 : 0.6, start);
                m.cue("sound", "vessel", start).put("soundId", "F".equals(halogen) || "Cl".equals(halogen) ? "bang" : "pop");
                m.reaction("hydrogen-" + halogen.toLowerCase(Locale.ROOT), "Hydrogen + " + second.s().name().toLowerCase(Locale.ROOT), "synthesis",
                        Latex.equation(List.of(Term.of(1, "H2", "g"), Term.of(1, halogen + "2", stateOf("H".equals(first.sym()) ? second.s() : first.s()))),
                                List.of(Term.of(2, product, "g")), null),
                        "Cl".equals(halogen) ? "hydrogen-chloride" : null, e);
                m.observe("I".equals(halogen) ? "Only some of the hydrogen and iodine combine - this reaction is reversible."
                        : "The gases combine with a flash, making " + Lore.name(product).toLowerCase(Locale.ROOT)
                                + (m.aqMl() > 0 ? ", which dissolves to form an acid." : ", which fumes in moist air."));
            }
            case "H|S" -> {
                double e = Math.min(m.get("H2(g)"), m.get("S(s)"));
                m.take("H2(g)", e);
                m.take("S(s)", e);
                m.gas("H2S", e, "vessel", 0.6, "fine", start);
                m.reaction("hydrogen-sulfide", "Hydrogen + sulfur", "synthesis",
                        Latex.equation(List.of(Term.of(1, "H2", "g"), Term.of(1, "S", "s")), List.of(Term.of(1, "H2S", "g")), null),
                        null, e);
                m.observe("Hot sulfur and hydrogen make hydrogen sulfide - the gas that smells of rotten eggs.");
            }
            case "C|O" -> {
                double nC = m.get("C(s)");
                double nO = m.get("O2(g)");
                boolean complete = nO >= nC;
                double e = complete ? nC : Math.min(nC / 2, nO);
                m.take("C(s)", complete ? e : 2 * e);
                m.take("O2(g)", e);
                String gas = complete ? "CO2" : "CO";
                m.gas(gas, complete ? e : 2 * e, "vessel", 0.3, "fine", start);
                m.heat(394_000 * e);
                glow(m, "#ff7a20", start);
                m.cue("sound", "vessel", start).put("soundId", "crackle");
                m.reaction("carbon-burning", "Carbon burns", "synthesis",
                        complete ? Latex.equation(List.of(Term.of(1, "C", "s"), Term.of(1, "O2", "g")), List.of(Term.of(1, "CO2", "g")), null)
                                : Latex.equation(List.of(Term.of(2, "C", "s"), Term.of(1, "O2", "g")), List.of(Term.of(2, "CO", "g")), null),
                        "nonmetal-burning", e);
                m.observe(complete ? "The carbon glows bright orange and slowly burns away to carbon dioxide."
                        : "With too little oxygen, the carbon makes carbon monoxide - the dangerous, odourless gas from faulty boilers.");
            }
            case "O|S" -> {
                double e = Math.min(m.get("S(s)"), m.get("O2(g)"));
                m.take("S(s)", e);
                m.take("O2(g)", e);
                m.heat(297_000 * e);
                Map<String, Object> f = m.cue("flame", "vessel", start);
                f.put("colour", Colour.hex(flame("S"), 1).toJson());
                f.put("intensity", 0.6);
                f.put("durationMs", 3500);
                if (m.aqMl() > 0) {
                    m.add("H+", 0.3 * e);
                    m.product("SO2", e, "aq");
                } else {
                    m.gas("SO2", e, "vessel", 0.4, "fine", start);
                }
                m.reaction("sulfur-burning", "Sulfur burns", "synthesis",
                        Latex.equation(List.of(Term.of(1, "S", "s"), Term.of(1, "O2", "g")), List.of(Term.of(1, "SO2", "g")), null),
                        "nonmetal-burning", e);
                m.observe("Sulfur melts and burns with a beautiful pale blue flame, giving off choking sulfur dioxide.");
            }
            case "O|P" -> {
                double e = Math.min(m.get("P(s)") / 4, m.get("O2(g)") / 5);
                m.take("P(s)", 4 * e);
                m.take("O2(g)", 5 * e);
                m.heat(2_984_000 * e);
                flash(m, "#fff4d0", 0.8, start);
                Map<String, Object> s = m.cue("smoke", "vessel", start + 200);
                s.put("colour", Colour.hex("#ffffff", 0.9).toJson());
                s.put("density", 1.0);
                s.put("durationMs", 6000);
                s.put("label", "Thick white smoke of phosphorus oxide");
                if (m.aqMl() > 0) m.add("H+", 4 * e);
                m.product("P4O10", e, "s");
                m.reaction("phosphorus-burning", "Phosphorus burns", "synthesis",
                        Latex.equation(List.of(Term.of(4, "P", "s"), Term.of(5, "O2", "g")), List.of(Term.of(1, "P4O10", "s")), null),
                        "nonmetal-burning", e);
                m.observe("Phosphorus burns with a brilliant flame and clouds of dense white smoke.");
            }
            case "Cl|P" -> {
                double e = Math.min(m.get("P(s)") / 2, m.get("Cl2(g)") / 3);
                m.take("P(s)", 2 * e);
                m.take("Cl2(g)", 3 * e);
                Map<String, Object> s = m.cue("smoke", "vessel", start);
                s.put("colour", Colour.hex("#f4f6e8", 0.7).toJson());
                s.put("density", 0.6);
                s.put("durationMs", 4000);
                s.put("label", "Misty fumes of phosphorus trichloride");
                m.product("PCl3", 2 * e, "l");
                m.reaction("phosphorus-chlorine", "Phosphorus + chlorine", "synthesis",
                        Latex.equation(List.of(Term.of(2, "P", "s"), Term.of(3, "Cl2", "g")), List.of(Term.of(2, "PCl3", "l")), null),
                        "salt-synthesis", e);
                m.observe("Phosphorus catches fire in chlorine by itself, giving misty fumes of phosphorus trichloride.");
            }
            default -> {}
        }
    }

    private static void flash(MixtureOps m, String hex, double intensity, long start) {
        Map<String, Object> l = m.cue("light", "vessel", start);
        l.put("colour", Colour.hex(hex, 1).toJson());
        l.put("intensity", intensity);
        l.put("durationMs", 600);
    }

    private static void glow(MixtureOps m, String hex, long start) {
        Map<String, Object> l = m.cue("light", "vessel", start);
        l.put("colour", Colour.hex(hex, 1).toJson());
        l.put("intensity", 0.5);
        l.put("durationMs", 4000);
    }
}
