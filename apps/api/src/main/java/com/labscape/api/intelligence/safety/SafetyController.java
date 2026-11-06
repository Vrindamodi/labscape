package com.labscape.api.intelligence.safety;

import com.labscape.api.contracts.SimulationRequest;
import com.labscape.api.contracts.SimulationResult;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** POST /v1/safety/resolve - every free-form mix must pass through here. */
@RestController
@RequestMapping("/v1/safety")
public class SafetyController {

    private final SafetyPipeline pipeline;

    public SafetyController(SafetyPipeline pipeline) {
        this.pipeline = pipeline;
    }

    @PostMapping("/resolve")
    public SimulationResult resolve(
            @Valid @RequestBody SimulationRequest request,
            @RequestHeader(value = "X-Lab-Session", required = false) String session) {
        return pipeline.resolve(request, session);
    }
}
