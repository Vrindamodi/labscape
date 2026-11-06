package com.labscape.api.common;

import com.labscape.api.contracts.ContractsVersion;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Liveness and version info. Every LABscape endpoint lives under /v1. */
@RestController
@RequestMapping("/v1")
public class SystemController {

    @GetMapping("/version")
    public Map<String, String> version() {
        return Map.of("service", "labscape-api", "contracts", ContractsVersion.VALUE);
    }
}
