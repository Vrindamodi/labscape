package com.labscape.api.contracts;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.util.List;

/** Contract 3 (request) - mirrors packages/contracts/src/simulation.ts. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SimulationRequest(
        @NotBlank @Size(max = 64) String id,
        @NotBlank String subject,
        @NotBlank String mode,
        @NotBlank @Size(max = 64) String attemptId,
        String experimentId,
        Integer experimentVersion,
        String packVersion,
        @NotNull @Size(max = 6) List<@Valid @NotNull Input> inputs,
        @Valid Conditions conditions,
        /** v0.6: what the vessel already held when the inputs were added (poured in, filtered or split from earlier mixes). */
        @Size(max = 3) List<@Valid @NotNull Base> bases) {

    /** A request for an empty vessel: the shape every caller used before vessels could be chained. */
    public SimulationRequest(String id, String subject, String mode, String attemptId, String experimentId,
            Integer experimentVersion, String packVersion, List<Input> inputs, Conditions conditions) {
        this(id, subject, mode, attemptId, experimentId, experimentVersion, packVersion, inputs, conditions, null);
    }

    public record Input(
            @NotBlank @Size(max = 64) String ref,
            @Positive double amount,
            @NotBlank String unit,
            Double concentrationM) {}

    /**
     * @param evaporate once everything in the vessel has reacted, it goes over a burner until all the water has
     *        boiled away (an evaporating basin). This is the only way to go past the hot plate's 90 °C.
     */
    public record Conditions(Double temperatureC, Double pressureKPa, Boolean stirring, Boolean ignition, Boolean evaporate) {
        public Conditions(Double temperatureC, Double pressureKPa, Boolean stirring, Boolean ignition) {
            this(temperatureC, pressureKPa, stirring, ignition, null);
        }
    }

    /**
     * An earlier mix and the part of it that came across: all of it, only what ran through a filter paper
     * ("filtrate") or only what stayed on it ("residue"), and what share (0..1) of that part.
     */
    public record Base(
            @NotNull @Size(max = 6) List<@Valid @NotNull Input> inputs,
            @Valid Conditions conditions,
            @Size(max = 3) List<@Valid @NotNull Base> bases,
            @NotBlank @Pattern(regexp = "all|filtrate|residue") String keep,
            @Positive @DecimalMax("1.0") double fraction) {}

    /** A vessel has to hold something: new inputs, or something carried in. */
    @JsonIgnore
    @AssertTrue(message = "inputs must not be empty unless bases are given")
    public boolean isHoldingSomething() {
        return inputs == null || !inputs.isEmpty() || bases != null && !bases.isEmpty();
    }
}
