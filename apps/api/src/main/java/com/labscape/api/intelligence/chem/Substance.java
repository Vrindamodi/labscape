package com.labscape.api.intelligence.chem;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;

/**
 * One allowlisted catalogue entry (a compound/solution or one of the 118 elements). Solution species
 * are molarities; solid species are mol per mol of formula unit; gases are measured in mL at RTP.
 * Tags are server-only (used by safety rules) and never sent to clients.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Substance(
        String id,
        String name,
        String formula,
        Double concentrationM,
        String category,
        String form,
        String solidForm,
        boolean aqueous,
        String colour,
        double opacity,
        List<String> hazards,
        Limits limits,
        String model,
        List<String> inertWith,
        Map<String, Double> species,
        AcidInfo acid,
        BaseInfo base,
        CarbonateInfo carbonate,
        MetalInfo metal,
        Double molarMass,
        List<String> tags,
        String description,
        ElementInfo element,
        Double density,
        String miscibility,
        Double solubility,
        Double flashPointC) {

    public record Limits(double min, double max, String unit) {}

    public record AcidInfo(int protons, String anion, int anionCharge, boolean poly, boolean strong) {}

    public record BaseInfo(String cation, int cationCharge, int hydroxides, boolean ammonia) {}

    public record CarbonateInfo(String cation, int cationCharge, int cationCount, int unitProtons) {}

    /** e0 = standard electrode potential (V) of M^n+/M: lower = more reactive. */
    public record MetalInfo(String symbol, int charge, double e0, double acidRate, String colour) {}

    /** Present only for the 118 elements. */
    public record ElementInfo(
            int z,
            String symbol,
            String category,
            String state,
            Double electronegativity,
            List<Integer> oxidationStates,
            boolean radioactive,
            boolean superheavy,
            String fact) {

        public boolean isMetal() {
            return switch (category) {
                case "alkali", "alkaline-earth", "transition", "post-transition", "lanthanide", "actinide" -> true;
                default -> false;
            };
        }

        public int commonPositive() {
            return oxidationStates.stream().filter(o -> o > 0).findFirst().orElse(0);
        }

        public int commonNegative() {
            return oxidationStates.stream().filter(o -> o < 0).findFirst().orElse(0);
        }
    }

    /** Catalogue entry without physical data (used for the 118 elements). */
    static Substance basic(
            String id, String name, String formula, Double concentrationM, String category, String form, String solidForm,
            boolean aqueous, String colour, double opacity, List<String> hazards, Limits limits, String model,
            List<String> inertWith, Map<String, Double> species, AcidInfo acid, BaseInfo base, CarbonateInfo carbonate,
            MetalInfo metal, Double molarMass, List<String> tags, String description, ElementInfo element) {
        return new Substance(id, name, formula, concentrationM, category, form, solidForm, aqueous, colour, opacity, hazards,
                limits, model, inertWith, species, acid, base, carbonate, metal, molarMass, tags, description, element,
                null, null, null, null);
    }

    /**
     * How a liquid behaves with water: "aqueous" (it is a water solution), "miscible" (mixes with water and
     * with oils), "polar" (mixes with water but not with oils), "partial" (a little dissolves, the rest forms a
     * layer) or "immiscible". Solids and gases answer "n/a".
     */
    public String waterMiscibility() {
        if (isSolid() || isGas()) return "n/a";
        if (aqueous) return "aqueous";
        return miscibility != null ? miscibility : "immiscible";
    }

    public double densityOr(double fallback) {
        return density == null ? fallback : density;
    }

    public boolean isSolid() {
        return "solid".equals(form);
    }

    public boolean isGas() {
        return "gas".equals(form);
    }

    public boolean isLimited() {
        return "limited".equals(model);
    }

    public boolean isElement() {
        return element != null;
    }

    public boolean hasTag(String tag) {
        return tags != null && tags.contains(tag);
    }

    /** True when this limited-model substance is known to be inert with {@code other}. */
    public boolean coversPair(Substance other) {
        if (inertWith == null) {
            return false;
        }
        return inertWith.contains(other.id()) || inertWith.contains("category:" + other.category());
    }

    public String displayName() {
        return concentrationM == null ? name : name + " (" + trim(concentrationM) + " M)";
    }

    private static String trim(double v) {
        return v == Math.rint(v) ? String.valueOf((long) v) : String.valueOf(v);
    }
}
