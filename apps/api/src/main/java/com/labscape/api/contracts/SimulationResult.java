package com.labscape.api.contracts;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/** Contract 3 - mirrors packages/contracts/src/simulation.ts (v0.2.0). */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SimulationResult(
        String requestId,
        Outcome outcome,
        String reasonCode,
        String reactionId,
        Integer reactionVersion,
        String equationLatex,
        List<Species> species,
        /** Observation cues in order; kept as JSON (discriminated on "kind"). */
        List<JsonNode> cues,
        List<Measurement> measurements,
        Fidelity fidelity,
        List<String> explanationRefs,
        Presentation presentation) {

    public enum Outcome {
        @JsonProperty("reaction") REACTION,
        @JsonProperty("no_reaction") NO_REACTION,
        @JsonProperty("needs_conditions") NEEDS_CONDITIONS,
        @JsonProperty("unsupported") UNSUPPORTED,
        @JsonProperty("out_of_range") OUT_OF_RANGE,
        @JsonProperty("procedure_mismatch") PROCEDURE_MISMATCH,
        @JsonProperty("prohibited") PROHIBITED
    }

    public enum Fidelity {
        @JsonProperty("exact") EXACT,
        @JsonProperty("approximate") APPROXIMATE,
        @JsonProperty("qualitative") QUALITATIVE
    }

    public record Species(String id, String formula, double amountMol, String phase) {}

    public record Measurement(String key, double value, String unit) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReactionSummary(String id, String name, String type, String equationLatex, String discoveryId) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Presentation(
            String title,
            String message,
            List<String> observations,
            List<ReactionSummary> reactions,
            String neededTool,
            String focusRef,
            List<String> suggestions,
            List<String> discoveryIds) {}
}
