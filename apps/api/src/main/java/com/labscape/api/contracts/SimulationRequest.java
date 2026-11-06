package com.labscape.api.contracts;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
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
        @NotNull @Size(min = 1, max = 6) List<@Valid @NotNull Input> inputs,
        @Valid Conditions conditions) {

    public record Input(
            @NotBlank @Size(max = 64) String ref,
            @Positive double amount,
            @NotBlank String unit,
            Double concentrationM) {}

    public record Conditions(Double temperatureC, Double pressureKPa, Boolean stirring, Boolean ignition) {}
}
