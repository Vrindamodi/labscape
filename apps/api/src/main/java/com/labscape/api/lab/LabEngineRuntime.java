package com.labscape.api.lab;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;
import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Engine;
import org.graalvm.polyglot.Source;
import org.graalvm.polyglot.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * Runs the shared TypeScript lab engine (packages/lab-engine, bundled to engine/lab-engine.js)
 * inside the JVM with GraalJS. The server therefore replays and scores attempts with exactly the
 * code the browser ran, which is what makes server state hashes match client ones.
 *
 * <p>One shared {@link Engine} caches the parsed source; each call gets its own short-lived
 * {@link Context} (contexts are single-threaded), so calls are safe from any request thread.
 */
@Component
public class LabEngineRuntime {

    private final Engine engine;
    private final Source source;
    private final ObjectMapper mapper;
    private final Map<String, JsonNode> contentCache = new ConcurrentHashMap<>();
    private final String engineVersion;

    public LabEngineRuntime(ObjectMapper mapper) {
        this.mapper = mapper;
        this.engine = Engine.newBuilder("js")
                .option("engine.WarnInterpreterOnly", "false")
                .build();
        try (InputStream in = new ClassPathResource("engine/lab-engine.js").getInputStream()) {
            String code = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            this.source = Source.newBuilder("js", code + "\n;LabEngine;", "lab-engine.js").build();
        } catch (IOException e) {
            throw new UncheckedIOException("Lab engine bundle missing: run pnpm --filter @labscape/lab-engine build:server", e);
        }
        this.engineVersion = call(api -> api.getMember("ENGINE_VERSION").asString());
    }

    public String engineVersion() {
        return engineVersion;
    }

    public List<String> slugs() {
        return read(call(api -> api.getMember("slugsJson").execute().asString()), List.class);
    }

    public Optional<JsonNode> content(String slug) {
        JsonNode cached = contentCache.get(slug);
        if (cached != null) return Optional.of(cached);
        String json = call(api -> {
            Value v = api.getMember("contentJson").execute(slug);
            return v.isNull() ? null : v.asString();
        });
        if (json == null) return Optional.empty();
        JsonNode node = read(json, JsonNode.class);
        contentCache.put(slug, node);
        return Optional.of(node);
    }

    /** Replays the event log and scores it. Returns {engineVersion, hash, report, simTimeMs}. */
    public JsonNode score(String slug, String eventsJson, long tailMs) {
        return read(call(api -> api.getMember("scoreJson").execute(slug, eventsJson, tailMs).asString()), JsonNode.class);
    }

    /** Evaluates an expression with the maths engine (same parser the browser uses). */
    public double evaluate(String expr, String scopeJson) {
        return call(api -> api.getMember("evaluateJson").execute(expr, scopeJson).asDouble());
    }

    /** Physics or maths: scores an event log for one experiment of that subject (no attempt needed). */
    public JsonNode check(String subject, String slug, String eventsJson) {
        return read(call(api -> api.getMember("checkJson").execute(subject, slug, eventsJson).asString()), JsonNode.class);
    }

    /** Sandbox: bench + events in, final vessel looks, notes and cues out. */
    public JsonNode simulate(String benchJson, String eventsJson, long tailMs) {
        return read(call(api -> api.getMember("simulateJson").execute(benchJson, eventsJson, tailMs).asString()), JsonNode.class);
    }

    private <T> T call(java.util.function.Function<Value, T> fn) {
        try (Context ctx = Context.newBuilder("js").engine(engine).allowAllAccess(false).build()) {
            Value api = ctx.eval(source);
            return fn.apply(api);
        }
    }

    private <T> T read(String json, Class<T> type) {
        try {
            return mapper.readValue(json, type);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @PreDestroy
    void close() {
        engine.close();
    }
}
