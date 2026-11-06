package com.labscape.api.intelligence.safety;

import java.util.List;

/** Fixed user-facing copy from build plan 4.1. Prohibited copy is identical for every request. */
public final class OutcomeCopy {

    private OutcomeCopy() {}

    public static final String PROHIBITED_TITLE = "Safety restriction";
    public static final String PROHIBITED_MESSAGE =
            "This experiment is not permitted in LABscape. The selected activity could involve serious physical hazards. "
                    + "LABscape does not provide instructions or simulations that facilitate the production of explosives or "
                    + "harmful substances.";
    public static final List<String> PROHIBITED_ALTERNATIVES =
            List.of("Explore reaction concepts", "Learn lab safety", "Energy transformations", "Try an emergency scenario");
    public static final String PROHIBITED_REASON = "SAFETY_RESTRICTION";

    public static final String UNSUPPORTED_TITLE = "Invalid mixing - simulation not available";
    public static final String UNSUPPORTED_MESSAGE =
            "The selected combination does not have a validated reaction model under these conditions. "
                    + "LABscape cannot reliably predict the resulting products or observations.";
    public static final List<String> UNSUPPORTED_OPTIONS =
            List.of("View substance properties", "Learn the concepts", "Try a supported combination", "Ask the AI why");

    public static final String NO_REACTION_TITLE = "No observable reaction";
    public static final String NO_REACTION_MESSAGE =
            "No observable chemical reaction is expected under these conditions.";

    public static final String OUT_OF_RANGE_TITLE = "Adjust the amount";
    public static final String NEEDS_CONDITIONS_TITLE = "Needs different conditions";
    public static final String MISMATCH_TITLE = "Conditions outside the validated model";
}
