package com.labscape.api.intelligence.chem;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Builds catalogue entries for all 118 elements from {@code catalogue/elements.json}. */
final class Elements {

    private Elements() {}

    private static final Map<String, String> DIATOMIC =
            Map.of("H", "H2", "N", "N2", "O", "O2", "F", "F2", "Cl", "Cl2", "Br", "Br2", "I", "I2");

    /** Standard electrode potentials E0 (V) for M^n+/M. */
    static final Map<String, Double> E0 = Map.ofEntries(
            Map.entry("Li", -3.04), Map.entry("Cs", -3.03), Map.entry("Rb", -2.98), Map.entry("K", -2.93),
            Map.entry("Fr", -2.9), Map.entry("Ba", -2.91), Map.entry("Sr", -2.89), Map.entry("Ca", -2.87),
            Map.entry("Ra", -2.8), Map.entry("Na", -2.71), Map.entry("Mg", -2.37), Map.entry("Y", -2.37),
            Map.entry("Sc", -2.03), Map.entry("Be", -1.85), Map.entry("Al", -1.66), Map.entry("Ti", -1.63),
            Map.entry("Hf", -1.55), Map.entry("Zr", -1.45), Map.entry("U", -1.38), Map.entry("Th", -1.9),
            Map.entry("Mn", -1.18), Map.entry("V", -1.18), Map.entry("Nb", -1.1), Map.entry("Zn", -0.76),
            Map.entry("Cr", -0.74), Map.entry("Ta", -0.6), Map.entry("Ga", -0.53), Map.entry("Fe", -0.44),
            Map.entry("Cd", -0.40), Map.entry("In", -0.34), Map.entry("Tl", -0.34), Map.entry("Co", -0.28),
            Map.entry("Ni", -0.25), Map.entry("Mo", -0.2), Map.entry("Sn", -0.14), Map.entry("Pb", -0.13),
            Map.entry("W", -0.12), Map.entry("Bi", 0.31), Map.entry("Cu", 0.34), Map.entry("Re", 0.3),
            Map.entry("Tc", 0.4), Map.entry("Po", 0.37), Map.entry("Ru", 0.45), Map.entry("Hg", 0.85),
            Map.entry("Ag", 0.80), Map.entry("Rh", 0.76), Map.entry("Pd", 0.95), Map.entry("Os", 0.85),
            Map.entry("Ir", 1.16), Map.entry("Pt", 1.18), Map.entry("Au", 1.50));

    /** Metals protected by a tough oxide film: they barely react with dilute acids. */
    private static final Map<String, Double> PASSIVATED = Map.of(
            "Al", 0.15, "Ti", 0.05, "Cr", 0.3, "Ta", 0.02, "Nb", 0.02, "Zr", 0.05, "Hf", 0.05, "W", 0.02, "Mo", 0.05);

    private static final Set<String> TOXIC = Set.of("Hg", "As", "Tl", "Cd", "Pb", "Be", "Se", "Os", "Ba");

    /** Element info and names by symbol, filled when the catalogue loads. */
    static final Map<String, Substance.ElementInfo> INFO = new java.util.concurrent.ConcurrentHashMap<>();

    static final Map<String, String> NAME = new java.util.concurrent.ConcurrentHashMap<>();

    static List<Substance> load(ObjectMapper mapper) {
        try (InputStream in = Elements.class.getResourceAsStream("/catalogue/elements.json")) {
            if (in == null) throw new IllegalStateException("Missing elements.json");
            JsonNode rows = mapper.readTree(in).get("elements");
            List<Substance> out = new ArrayList<>();
            for (int i = 0; i < rows.size(); i++) out.add(build(i + 1, rows.get(i)));
            return out;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static Substance build(int z, JsonNode r) {
        String sym = r.get(0).asText();
        String name = r.get(1).asText();
        double mass = r.get(2).asDouble();
        String cat = r.get(3).asText();
        String state = r.get(4).asText();
        String colour = r.get(5).asText();
        Double en = r.get(6).isNull() ? null : r.get(6).asDouble();
        List<Integer> ox = new ArrayList<>();
        r.get(7).forEach(n -> ox.add(n.asInt()));
        String flags = r.get(8).asText();
        String fact = r.get(9).asText();
        boolean radioactive = flags.contains("R");
        boolean superheavy = flags.contains("S");

        Substance.ElementInfo info = new Substance.ElementInfo(z, sym, cat, state, en, ox, radioactive, superheavy, fact);
        INFO.put(sym, info);
        NAME.put(sym, name);
        boolean metal = info.isMetal();
        String formula = DIATOMIC.getOrDefault(sym, sym);

        String form = switch (state) {
            case "g" -> "gas";
            case "l" -> "liquid";
            default -> "solid";
        };
        String solidForm = !"solid".equals(form) ? null
                : metal ? "granules"
                : "I".equals(sym) ? "crystals"
                : "powder";

        Substance.Limits limits;
        if ("gas".equals(form)) limits = new Substance.Limits(10, 250, "mL");
        else if ("Br".equals(sym)) limits = new Substance.Limits(0.2, 3, "mL");
        else if ("Hg".equals(sym)) limits = new Substance.Limits(1, 10, "mL");
        else if (Set.of("K", "Rb", "Cs", "Fr").contains(sym)) limits = new Substance.Limits(0.02, 0.2, "g");
        else if (Set.of("Li", "Na").contains(sym)) limits = new Substance.Limits(0.05, 0.5, "g");
        else if (superheavy) limits = new Substance.Limits(0.01, 1, "g");
        else limits = new Substance.Limits(0.05, 5, "g");

        double opacity = switch (sym) {
            case "Cl" -> 0.35;
            case "F" -> 0.18;
            case "Br" -> 0.95;
            default -> "gas".equals(form) ? 0.04 : 1;
        };

        String speciesKey = switch (form) {
            case "gas" -> formula + "(g)";
            case "liquid" -> metal ? sym + "(s)" : formula + "(l)";
            default -> metal ? sym + "(s)" : formula + "(s)";
        };
        double molar = DIATOMIC.containsKey(sym) ? mass * 2 : mass;

        List<String> tags = new ArrayList<>();
        tags.add("element");
        if (radioactive) tags.add("radioactive");
        if ("halogen".equals(cat)) tags.add("halogen");
        if ("noble".equals(cat)) tags.add("noble");
        if (Set.of("alkali", "alkaline-earth", "lanthanide").contains(cat) || Set.of("Al", "Zn", "Fe", "Ti").contains(sym)) {
            tags.add("reactive_metal");
        }
        // Safety tags used by the prohibited-pattern rules.
        if ("I".equals(sym)) tags.add("iodine");
        if ("F".equals(sym)) tags.add("fluorine");
        if ("Cl".equals(sym)) tags.add("chlorine_source");
        if ("Hg".equals(sym)) tags.add("mercury");
        if ("S".equals(sym)) tags.add("sulfur_element");
        if (Set.of("C", "S", "P").contains(sym)) {
            tags.add("fuel");
            tags.add("fuel_element");
        }

        List<String> hazards = new ArrayList<>();
        if (radioactive) hazards.add("radioactive");
        if ("alkali".equals(cat)) hazards.addAll(List.of("flammable", "corrosive"));
        if (Set.of("F", "Cl", "Br").contains(sym)) hazards.addAll(List.of("toxic", "corrosive"));
        if (TOXIC.contains(sym)) hazards.add("toxic");
        if (Set.of("H", "P").contains(sym)) hazards.add("flammable");
        if ("O".equals(sym)) hazards.add("oxidising");

        Substance.MetalInfo metalInfo = null;
        if (metal) {
            double e0 = E0.getOrDefault(sym, switch (cat) {
                case "alkali" -> -2.9;
                case "alkaline-earth" -> -2.8;
                case "lanthanide" -> -2.3;
                case "actinide" -> -1.9;
                case "post-transition" -> -0.2;
                default -> -0.3;
            });
            double rate = e0 < 0 ? Math.min(3.5, Math.max(0.05, -e0 * 1.1)) * PASSIVATED.getOrDefault(sym, 1.0) : 0;
            int charge = info.commonPositive() > 0 ? info.commonPositive() : 2;
            metalInfo = new Substance.MetalInfo(sym, charge, e0, rate, colour);
        }

        return Substance.basic("el-" + sym, name, formula, null, "element", form, solidForm, false, colour, opacity,
                hazards, limits, "element", List.of(), Map.of(speciesKey, 1.0), null, null, null, metalInfo, molar,
                tags, fact, info);
    }
}
