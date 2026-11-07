package com.labscape.api.core.reference;

import com.fasterxml.jackson.databind.JsonNode;
import com.labscape.api.common.ApiProblem;
import com.labscape.api.core.reference.ReferenceData.Element;
import java.time.Duration;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Public reference endpoints: the periodic table and the equipment encyclopedia. */
@RestController
@RequestMapping("/v1")
public class ReferenceController {

    public record Elements(List<Element> items) {}

    public record Equipment(JsonNode categories, List<JsonNode> items) {}

    private static final CacheControl CACHE = CacheControl.maxAge(Duration.ofHours(1)).cachePublic();

    private final ReferenceData data;

    public ReferenceController(ReferenceData data) {
        this.data = data;
    }

    @GetMapping("/elements")
    public ResponseEntity<Elements> elements() {
        return ResponseEntity.ok().cacheControl(CACHE).body(new Elements(data.elements()));
    }

    @GetMapping("/elements/{symbol}")
    public ResponseEntity<Element> element(@PathVariable String symbol) {
        Element e = data.element(symbol).orElseThrow(() ->
                new ApiProblem(HttpStatus.NOT_FOUND, "ELEMENT_NOT_FOUND", "No element " + symbol + "."));
        return ResponseEntity.ok().cacheControl(CACHE).body(e);
    }

    public record Formulas(List<JsonNode> items) {}

    @GetMapping("/formulas")
    public ResponseEntity<Formulas> formulas() {
        return ResponseEntity.ok().cacheControl(CACHE).body(new Formulas(data.formulas()));
    }

    @GetMapping("/formulas/{id}")
    public ResponseEntity<JsonNode> formula(@PathVariable String id) {
        JsonNode n = data.formula(id).orElseThrow(() ->
                new ApiProblem(HttpStatus.NOT_FOUND, "FORMULA_NOT_FOUND", "No formula " + id + "."));
        return ResponseEntity.ok().cacheControl(CACHE).body(n);
    }

    @GetMapping("/equipment")
    public ResponseEntity<Equipment> equipment() {
        return ResponseEntity.ok().cacheControl(CACHE).body(new Equipment(data.equipmentCategories(), data.equipment()));
    }

    @GetMapping("/equipment/{id}")
    public ResponseEntity<JsonNode> equipmentItem(@PathVariable String id) {
        JsonNode n = data.equipment(id).orElseThrow(() ->
                new ApiProblem(HttpStatus.NOT_FOUND, "EQUIPMENT_NOT_FOUND", "No equipment " + id + "."));
        return ResponseEntity.ok().cacheControl(CACHE).body(n);
    }
}
