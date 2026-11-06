package com.labscape.api.contracts;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * Contract 2 - one append-only lab event. Mirrors packages/contracts/src/lab-event.ts.
 * The payload stays as JSON here; Part 2's evaluator binds it per {@code type}.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record LabEvent(
        String id,
        String attemptId,
        long seq,
        long t,
        String actor,
        String type,
        JsonNode payload,
        String stateHash) {}
