package com.labscape.api.intelligence.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labscape.api.common.ApiProblem;
import com.labscape.api.core.billing.Entitlements;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/**
 * /v1/ai/chat (build plan 4.4): guard, facts, model, output check, log. Streams over SSE by
 * default; ?stream=false returns the whole answer as JSON.
 */
@RestController
public class AiController {

    public record ChatRequest(String conversationId, String message, JsonNode context, String level, List<ChatModel.Turn> history) {}

    public record Reply(String conversationId, String messageId, String text, List<AiTutor.Source> sources, List<AiTutor.Action> actions,
            AiTutor.Grounding grounding, String model, boolean flagged, String category, boolean contextInjected, Integer remaining) {}

    public record Rating(int rating) {}

    private final AiGuard guard;
    private final AiTutor tutor;
    private final ChatModel model;
    private final Entitlements entitlements;
    private final JdbcClient db;
    private final ObjectMapper mapper;

    public AiController(AiGuard guard, AiTutor tutor, Entitlements entitlements, JdbcClient db, ObjectMapper mapper,
            @Value("${labscape.ai.gemini-api-key:}") String apiKey, @Value("${labscape.ai.model:gemini-3.8-flash}") String modelName,
            @Value("${labscape.ai.thinking:low}") String thinking, @Value("${labscape.ai.base-url:}") String baseUrl) {
        this.guard = guard;
        this.tutor = tutor;
        this.entitlements = entitlements;
        this.db = db;
        this.mapper = mapper;
        ChatModel grounded = new GroundedTutorModel(tutor);
        this.model = apiKey == null || apiKey.isBlank() ? grounded : new GeminiChatModel(mapper, apiKey, modelName, thinking, baseUrl, grounded);
    }

    /** Everything both variants share: limits, logging, the guard and the facts. */
    private record Prepared(UUID user, UUID conversation, Integer remaining, boolean injected, String safeContextJson, Reply blocked,
            AiTutor.Facts facts, List<ChatModel.Turn> history) {}

    /** The whole answer as JSON (tests, evaluation runs, clients without SSE). */
    @PostMapping(value = "/v1/ai/chat", params = "stream=false")
    public Reply chatJson(@AuthenticationPrincipal Jwt jwt, @RequestBody ChatRequest req) {
        Prepared p = prepare(jwt, req);
        if (p.blocked() != null) return p.blocked();
        String text = model.stream(req.message(), p.facts(), p.safeContextJson(), p.history(), t -> {});
        boolean unsafe = guard.outputUnsafe(text);
        if (unsafe) text = AiGuard.REFUSAL;
        UUID mid = log(p.conversation(), p.user(), "assistant", text, model.name(), unsafe, unsafe ? "OUTPUT" : null, p.injected(), p.facts().grounding());
        return new Reply(p.conversation().toString(), mid.toString(), text, p.facts().sources(), p.facts().actions(), p.facts().grounding(), model.name(), unsafe, unsafe ? "OUTPUT" : null, p.injected(), p.remaining());
    }

    /** Streamed over SSE: meta, then tokens (or a retraction), then done. */
    @PostMapping("/v1/ai/chat")
    public ResponseEntity<StreamingResponseBody> chat(@AuthenticationPrincipal Jwt jwt, @RequestBody ChatRequest req) {
        Prepared p = prepare(jwt, req);
        if (p.blocked() != null) return sse(p.blocked(), List.of(p.blocked().text()));
        UUID conversation = p.conversation();
        UUID user = p.user();
        AiTutor.Facts facts = p.facts();
        StreamingResponseBody body = out -> {
            Reply meta = new Reply(conversation.toString(), null, null, facts.sources(), facts.actions(), facts.grounding(), model.name(), false, null, p.injected(), p.remaining());
            event(out, "meta", meta);
            StringBuilder all = new StringBuilder();
            boolean[] stopped = {false};
            model.stream(req.message(), facts, p.safeContextJson(), p.history(), t -> {
                if (stopped[0]) return;
                all.append(t);
                // Output check as it streams: anything unsafe is retracted before it can finish.
                if (guard.outputUnsafe(all.toString())) {
                    stopped[0] = true;
                    event(out, "retract", Map.of("text", AiGuard.REFUSAL));
                    return;
                }
                event(out, "token", Map.of("t", t));
            });
            String finalText = stopped[0] ? AiGuard.REFUSAL : all.toString();
            UUID mid = log(conversation, user, "assistant", finalText, model.name(), stopped[0], stopped[0] ? "OUTPUT" : null, p.injected(), facts.grounding());
            event(out, "done", Map.of("messageId", mid.toString()));
        };
        return ResponseEntity.ok().contentType(MediaType.TEXT_EVENT_STREAM).header("Cache-Control", "no-cache").header("X-Accel-Buffering", "no").body(body);
    }

    private Prepared prepare(Jwt jwt, ChatRequest req) {
        UUID user = UUID.fromString(jwt.getSubject());
        if (req.message() == null || req.message().isBlank()) throw ApiProblem.badRequest("MESSAGE_REQUIRED", "Ask a question.");
        if (req.message().length() > 2000) throw ApiProblem.badRequest("MESSAGE_TOO_LONG", "Keep questions under 2,000 characters.");

        Integer limit = entitlements.limit(user, "ai.messagesPerDay");
        int used = db.sql("SELECT count(*) FROM ai_messages WHERE user_id = ? AND role = 'user' AND created_at >= date_trunc('day', now())").param(user).query(Integer.class).single();
        if (limit != null && used >= limit)
            throw new ApiProblem(HttpStatus.TOO_MANY_REQUESTS, "AI_LIMIT_REACHED", "You've used today's " + limit + " questions. Premium raises the limit, or come back tomorrow.");
        Integer remaining = limit == null ? null : limit - used - 1;

        UUID conversation = conversation(user, req);
        String contextJson = req.context() == null ? null : req.context().toString();
        boolean injected = guard.contextInjected(contextJson);
        JsonNode context = injected ? stripFreeText(req.context()) : req.context();
        String safeContextJson = context == null ? null : context.toString();
        log(conversation, user, "user", req.message(), null, false, null, injected, null);

        AiGuard.Verdict v = guard.check(req.message());
        if (v.blocked()) {
            UUID mid = log(conversation, user, "assistant", v.reply(), "guard", true, v.category().name(), injected, null);
            Reply r = new Reply(conversation.toString(), mid.toString(), v.reply(), List.of(), List.of(), new AiTutor.Grounding("guard", null, true), "guard", true, v.category().name(), injected, remaining);
            return new Prepared(user, conversation, remaining, injected, safeContextJson, r, null, List.of());
        }

        List<ChatModel.Turn> history = req.history() == null ? List.of() : req.history();
        String previous = null;
        for (int i = history.size() - 1; i >= 0 && previous == null; i--) if ("user".equals(history.get(i).role())) previous = history.get(i).text();
        AiTutor.Facts facts = tutor.analyse(req.message(), context, req.level(), previous, user);
        return new Prepared(user, conversation, remaining, injected, safeContextJson, null, facts, history);
    }

    @PostMapping("/v1/ai/messages/{id}/rate")
    public Map<String, Object> rate(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody Rating r) {
        if (r.rating() != 1 && r.rating() != -1) throw ApiProblem.badRequest("BAD_RATING", "Rate 1 or -1.");
        int n = db.sql("UPDATE ai_messages SET rating = ? WHERE id = ? AND user_id = ? AND role = 'assistant'").params((short) r.rating(), id, UUID.fromString(jwt.getSubject())).update();
        if (n == 0) throw ApiProblem.notFound("MESSAGE_NOT_FOUND", "No such answer.");
        return Map.of("id", id.toString(), "rating", r.rating());
    }

    /** Server speech-to-text needs a speech model; until one is configured the app uses the browser's. */
    @PostMapping("/v1/ai/voice")
    public void voice() {
        throw new ApiProblem(HttpStatus.SERVICE_UNAVAILABLE, "VOICE_SERVER_UNAVAILABLE", "Server speech recognition isn't set up; the app uses your browser's speech recognition instead.");
    }

    /* ------------------------------------------------------------------ helpers */

    private ResponseEntity<StreamingResponseBody> sse(Reply r, List<String> chunks) {
        StreamingResponseBody body = out -> {
            event(out, "meta", new Reply(r.conversationId(), null, null, r.sources(), r.actions(), r.grounding(), r.model(), r.flagged(), r.category(), r.contextInjected(), r.remaining()));
            for (String c : chunks) event(out, "token", Map.of("t", c));
            event(out, "done", Map.of("messageId", r.messageId()));
        };
        return ResponseEntity.ok().contentType(MediaType.TEXT_EVENT_STREAM).header("Cache-Control", "no-cache").body(body);
    }

    private void event(OutputStream out, String name, Object data) {
        try {
            out.write(("event: " + name + "\ndata: " + mapper.writeValueAsString(data) + "\n\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
        } catch (IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    private UUID conversation(UUID user, ChatRequest req) {
        if (req.conversationId() != null) {
            try {
                UUID id = UUID.fromString(req.conversationId());
                if (db.sql("SELECT count(*) FROM ai_conversations WHERE id = ? AND user_id = ?").params(id, user).query(Integer.class).single() > 0) return id;
            } catch (IllegalArgumentException ignored) {
                // not ours or not an id: start a new one
            }
        }
        UUID id = UUID.randomUUID();
        JsonNode c = req.context();
        db.sql("INSERT INTO ai_conversations (id, user_id, surface, experiment) VALUES (?, ?, ?, ?)")
                .params(id, user, c == null ? null : c.path("surface").asText(null), c == null ? null : c.path("experimentId").asText(null)).update();
        return id;
    }

    private UUID log(UUID conversation, UUID user, String role, String content, String modelName, boolean flagged, String category, boolean injected, AiTutor.Grounding g) {
        UUID id = UUID.randomUUID();
        String grounding;
        try {
            grounding = g == null ? null : mapper.writeValueAsString(g);
        } catch (IOException e) {
            grounding = null;
        }
        db.sql("INSERT INTO ai_messages (id, conversation_id, user_id, role, content, model, flagged, category, context_injected, grounding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)")
                .params(id, conversation, user, role, content, modelName, flagged, category, injected, grounding).update();
        return id;
    }

    /** Keeps the structural parts of the context and drops free text where instructions could hide. */
    private JsonNode stripFreeText(JsonNode ctx) {
        ObjectNode o = mapper.createObjectNode();
        for (String k : List.of("surface", "subject", "attemptId", "experimentId", "experimentVersion", "stage", "currentStepId", "completedStepIds", "userLevel", "highlightableIds",
                "scenarioSlug", "sceneId", "askedBefore", "hintRung", "hazard"))
            if (ctx.has(k)) o.set(k, ctx.get(k));
        List<String> dropped = new ArrayList<>();
        ctx.fieldNames().forEachRemaining(f -> {
            if (!o.has(f)) dropped.add(f);
        });
        Map<String, Object> note = new LinkedHashMap<>();
        note.put("droppedFields", dropped);
        o.set("_guard", mapper.valueToTree(note));
        return o;
    }
}
