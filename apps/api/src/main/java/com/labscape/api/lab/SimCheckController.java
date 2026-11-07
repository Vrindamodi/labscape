package com.labscape.api.lab;

import com.fasterxml.jackson.databind.JsonNode;
import com.labscape.api.common.ApiProblem;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Server re-derivation for physics and maths (build plan 3.13): the same models the browser runs
 * replay an event log and re-check every reading. Attempts use this path automatically on finish;
 * these endpoints let the playground and compare view check a run without an attempt.
 */
@RestController
public class SimCheckController {

    public record CheckRequest(String experimentSlug, JsonNode events) {}

    private final LabEngineRuntime engine;

    public SimCheckController(LabEngineRuntime engine) {
        this.engine = engine;
    }

    @PostMapping("/v1/{subject:physics|maths}/check")
    public JsonNode check(@PathVariable String subject, @RequestBody CheckRequest req) {
        if (req.experimentSlug() == null || req.experimentSlug().isBlank())
            throw ApiProblem.badRequest("EXPERIMENT_REQUIRED", "Say which experiment to check (experimentSlug).");
        if (req.events() == null || !req.events().isArray())
            throw ApiProblem.badRequest("EVENTS_REQUIRED", "Send the run's events as an array.");
        if (req.events().size() > 5000) throw ApiProblem.badRequest("TOO_MANY_EVENTS", "At most 5000 events per check.");
        JsonNode content = engine.content(req.experimentSlug()).orElse(null);
        if (content == null || !subject.equals(content.path("subject").asText()))
            throw new ApiProblem(HttpStatus.NOT_FOUND, "EXPERIMENT_NOT_FOUND", "No " + subject + " experiment called " + req.experimentSlug() + ".");
        return engine.check(subject, req.experimentSlug(), req.events().toString());
    }
}
