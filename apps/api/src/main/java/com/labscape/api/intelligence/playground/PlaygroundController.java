package com.labscape.api.intelligence.playground;

import com.labscape.api.contracts.SimulationRequest;
import com.labscape.api.intelligence.chem.Catalogue;
import com.labscape.api.intelligence.chem.Discovery;
import com.labscape.api.intelligence.chem.Substance;
import com.labscape.api.intelligence.safety.SafetyPipeline;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * GET /v1/playground/catalogue - the chemistry shelf. Only display fields leave the server:
 * safety tags, species and model metadata stay private.
 */
@RestController
@RequestMapping("/v1/playground")
public class PlaygroundController {

    private final Catalogue catalogue;
    private final SafetyPipeline pipeline;

    public PlaygroundController(Catalogue catalogue, SafetyPipeline pipeline) {
        this.catalogue = catalogue;
        this.pipeline = pipeline;
    }

    public record ShelfItem(
            String id,
            String name,
            String formula,
            Double concentrationM,
            String category,
            String form,
            String solidForm,
            String colour,
            double opacity,
            List<String> hazards,
            Substance.Limits limits,
            String description,
            ElementView element) {}

    public record ElementView(int z, String symbol, String category, String state, Double electronegativity,
            double atomicMass, boolean radioactive, boolean superheavy) {}

    public record Conditions(double minTemperatureC, double maxTemperatureC, double defaultTemperatureC, double vesselCapacityMl) {}

    public record CatalogueResponse(
            String version,
            boolean safetyEngineOnline,
            List<ShelfItem> substances,
            List<Discovery> discoveries,
            Conditions conditions) {}

    public record TryNextResponse(List<SafetyPipeline.TryNext> suggestions) {}

    /**
     * POST /v1/playground/try-next - what would react with the beaker as it stands. Same body as
     * /v1/safety/resolve; nothing is mixed, so it never blocks, audits or counts as a prohibited attempt.
     */
    @PostMapping("/try-next")
    public TryNextResponse tryNext(@Valid @RequestBody SimulationRequest request) {
        return new TryNextResponse(pipeline.tryNext(request));
    }

    @GetMapping("/catalogue")
    public CatalogueResponse catalogue() {
        List<ShelfItem> items = catalogue.all().stream()
                .map(s -> new ShelfItem(s.id(), s.name(), s.formula(), s.concentrationM(), s.category(), s.form(),
                        s.solidForm(), s.colour(), s.opacity(), s.hazards(), s.limits(), s.description(),
                        s.element() == null ? null : new ElementView(s.element().z(), s.element().symbol(), s.element().category(),
                                s.element().state(), s.element().electronegativity(),
                                s.molarMass() == null ? 0 : (s.formula().endsWith("2") && s.formula().length() <= 3 ? s.molarMass() / 2 : s.molarMass()),
                                s.element().radioactive(), s.element().superheavy())))
                .toList();
        return new CatalogueResponse(catalogue.version(), pipeline.enabled(), items, Discovery.ALL,
                new Conditions(SafetyPipeline.MIN_TEMP_C, SafetyPipeline.MAX_TEMP_C, SafetyPipeline.DEFAULT_TEMP_C,
                        SafetyPipeline.VESSEL_CAPACITY_ML));
    }
}
