package com.labscape.api.contracts;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/**
 * Contract 4 (request) - mirrors packages/contracts/src/progress.ts.
 * The same idempotencyKey must never award XP twice.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ProgressEvent(
        String idempotencyKey,
        String kind,
        Instant occurredAt,
        String subject,
        String refId,
        String attemptId,
        Integer score) {}
