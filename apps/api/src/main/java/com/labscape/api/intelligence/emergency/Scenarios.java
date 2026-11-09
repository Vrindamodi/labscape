package com.labscape.api.intelligence.emergency;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;

/** The reviewed emergency scenarios (content/scenarios/*.json), shared by the simulator and the assistant's safety coach. */
@Component
public class Scenarios {

    private final Map<String, JsonNode> bySlug = new LinkedHashMap<>();

    public Scenarios(ObjectMapper mapper) {
        try {
            Resource[] files = new PathMatchingResourcePatternResolver().getResources("classpath:content/scenarios/*.json");
            List<JsonNode> list = new ArrayList<>();
            for (Resource r : files) try (InputStream in = r.getInputStream()) {
                list.add(mapper.readTree(in));
            }
            // free scenario first, then by title
            list.sort((a, b) -> a.path("free").asBoolean() != b.path("free").asBoolean() ? (a.path("free").asBoolean() ? -1 : 1) : a.path("title").asText().compareTo(b.path("title").asText()));
            list.forEach(s -> bySlug.put(s.path("slug").asText(), s));
        } catch (IOException e) {
            throw new UncheckedIOException("Could not load scenarios", e);
        }
    }

    public Collection<JsonNode> all() {
        return bySlug.values();
    }

    public Optional<JsonNode> bySlug(String slug) {
        return Optional.ofNullable(slug == null ? null : bySlug.get(slug));
    }

    public static JsonNode scene(JsonNode scenario, String id) {
        for (JsonNode sc : scenario.path("scenes")) if (sc.path("id").asText().equals(id)) return sc;
        return null;
    }

    /** A choice's hands-on actions: {@code "action": {...}} or {@code "actions": [...]}. */
    public static List<JsonNode> actionsOf(JsonNode choice) {
        List<JsonNode> out = new ArrayList<>();
        if (choice.path("action").isObject()) out.add(choice.path("action"));
        choice.path("actions").forEach(out::add);
        return out;
    }

    /** The scene's best choice (the first one rated best). */
    public static JsonNode best(JsonNode scene) {
        for (JsonNode c : scene.path("choices")) if (c.path("quality").asText().equals("best")) return c;
        return null;
    }
}
