package com.labscape.api.intelligence.chem;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;

/**
 * One allowlisted catalogue entry. Solution species are molarities; solid species are
 * mol per mol of formula unit. Tags are server-only (used by safety rules) and never sent
 * to clients.
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
        String description) {

    public record Limits(double min, double max, String unit) {}

    public record AcidInfo(int protons, String anion, int anionCharge, boolean poly, boolean strong) {}

    public record BaseInfo(String cation, int cationCharge, int hydroxides, boolean ammonia) {}

    public record CarbonateInfo(String cation, int cationCharge, int cationCount, int unitProtons) {}

    public record MetalInfo(String symbol, int charge, int rank, double acidRate, String colour) {}

    public boolean isSolid() {
        return "solid".equals(form);
    }

    public boolean isLimited() {
        return "limited".equals(model);
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
