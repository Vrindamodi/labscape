package com.labscape.api.intelligence;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labscape.api.intelligence.ai.AiTutor;
import com.labscape.api.intelligence.ai.ChatModel;
import com.labscape.api.intelligence.ai.GeminiChatModel;
import com.sun.net.httpserver.HttpServer;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The Gemini connection against a local stand-in for the Gemini API that speaks its streaming
 * format. It checks what LABscape sends and what it does with each way a reply can end; it does not
 * prove anything about the real service.
 */
class GeminiChatModelTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final List<JsonNode> requests = new CopyOnWriteArrayList<>();
    private final List<String> paths = new CopyOnWriteArrayList<>();
    private final List<String> keys = new CopyOnWriteArrayList<>();
    private HttpServer server;
    private volatile int status = 200;
    private volatile String reply = "";
    private int fallbackCalls;

    private final ChatModel builtIn = new ChatModel() {
        @Override
        public String name() {
            return "built-in";
        }

        @Override
        public String stream(String question, AiTutor.Facts facts, String contextJson, List<Turn> history, Consumer<String> sink) {
            fallbackCalls++;
            String text = facts.fixedText() != null ? facts.fixedText() : "BUILT-IN ANSWER";
            sink.accept(text);
            return text;
        }
    };

    private static String chunk(String json) {
        return "data: " + json + "\n\n";
    }

    /** One streamed piece of the answer; `finish` is null while more is coming. */
    private static String text(String piece, String finish) {
        return chunk("{\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"" + piece + "\"}]}," + (finish == null ? "" : "\"finishReason\":\"" + finish + "\",")
                + "\"index\":0}],\"usageMetadata\":{\"promptTokenCount\":10,\"candidatesTokenCount\":3,\"totalTokenCount\":13}}");
    }

    private static String thought(String piece) {
        return chunk("{\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"" + piece + "\",\"thought\":true}]},\"index\":0}]}");
    }

    /** The model stopped without writing anything more. */
    private static String ended(String finish) {
        return chunk("{\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[]},\"finishReason\":\"" + finish + "\",\"index\":0}]}");
    }

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requests.add(mapper.readTree(exchange.getRequestBody().readAllBytes()));
            paths.add(exchange.getRequestURI().toString());
            keys.add(String.valueOf(exchange.getRequestHeaders().getFirst("x-goog-api-key")));
            byte[] body = reply.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("content-type", status == 200 ? "text/event-stream" : "application/json");
            exchange.sendResponseHeaders(status, body.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(body);
            }
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private GeminiChatModel model() {
        return new GeminiChatModel(mapper, "test-key", "gemini-3.8-flash", "low", "http://127.0.0.1:" + server.getAddress().getPort(), builtIn);
    }

    private static AiTutor.Facts facts(AiTutor.Intent intent, String source, boolean modelled, String fixed, String... points) {
        return new AiTutor.Facts(intent, "school", null, List.of(points), null, List.of(), List.of(), new AiTutor.Grounding(source, null, modelled), fixed);
    }

    @Test
    void streamsTheAnswerAndSendsWhatGeminiNeeds() {
        reply = thought("PRIVATE REASONING") + text("A mole is ", null) + text("a counting unit.", "STOP");
        List<String> shown = new ArrayList<>();
        List<ChatModel.Turn> history = List.of(new ChatModel.Turn("assistant", "Left over from an earlier error"), new ChatModel.Turn("user", "hi"),
                new ChatModel.Turn("assistant", "Hello!"));
        String answer = model().stream("What is a mole?", facts(AiTutor.Intent.CONCEPT, "content", true, null, "**Mole**: the counting unit."), "{\"surface\":\"tutorial\"}", history, shown::add);

        assertThat(answer).isEqualTo("A mole is a counting unit.");
        assertThat(shown).containsExactly("A mole is ", "a counting unit.");
        assertThat(fallbackCalls).isZero();
        assertThat(requests).hasSize(1);
        // the streaming method of the chosen model, with the key in Google's header
        assertThat(paths.get(0)).contains("models/gemini-3.8-flash:streamGenerateContent").contains("alt=sse");
        assertThat(keys.get(0)).isEqualTo("test-key");
        JsonNode sent = requests.get(0);
        assertThat(sent.path("systemInstruction").toString()).contains("Never name a product").contains("never", "instructions");
        // room for thinking as well as the answer, at the configured thinking level
        assertThat(sent.path("generationConfig").path("maxOutputTokens").asInt()).isGreaterThanOrEqualTo(4000);
        assertThat(sent.path("generationConfig").path("thinkingConfig").path("thinkingLevel").asText()).isEqualToIgnoringCase("low");
        // the conversation starts with the learner; earlier answers are "model" turns; the question travels with the facts and the lab context
        JsonNode contents = sent.get("contents");
        assertThat(contents.get(0).get("role").asText()).isEqualTo("user");
        assertThat(contents.get(0).toString()).contains("hi").doesNotContain("Left over");
        assertThat(contents.get(1).get("role").asText()).isEqualTo("model");
        JsonNode last = contents.get(contents.size() - 1);
        assertThat(last.get("role").asText()).isEqualTo("user");
        assertThat(last.toString()).contains("<facts>").contains("the counting unit").contains("<lab_context>").contains("tutorial").contains("Question: What is a mole?");
    }

    @Test
    void theBuiltInTutorAnswersWhenTheServiceFails() {
        status = 500;
        reply = "{\"error\":{\"code\":500,\"message\":\"boom\",\"status\":\"INTERNAL\"}}";
        List<String> shown = new ArrayList<>();
        String answer = model().stream("What is a mole?", facts(AiTutor.Intent.CONCEPT, "content", true, null, "x"), null, List.of(), shown::add);
        assertThat(answer).isEqualTo("BUILT-IN ANSWER");
        assertThat(shown).containsExactly("BUILT-IN ANSWER");
        assertThat(fallbackCalls).isEqualTo(1);
    }

    @Test
    void theBuiltInTutorAnswersWhenGeminiBlocksOrSaysNothing() {
        for (String silent : List.of(chunk("{\"promptFeedback\":{\"blockReason\":\"SAFETY\"}}"), ended("SAFETY"), thought("only thinking") + ended("MAX_TOKENS"), ended("STOP"))) {
            fallbackCalls = 0;
            reply = silent;
            List<String> shown = new ArrayList<>();
            String answer = model().stream("What is a mole?", facts(AiTutor.Intent.CONCEPT, "content", true, null, "x"), null, List.of(), shown::add);
            assertThat(answer).as(silent).isEqualTo("BUILT-IN ANSWER");
            assertThat(shown).as(silent).containsExactly("BUILT-IN ANSWER");
            assertThat(fallbackCalls).as(silent).isEqualTo(1);
        }
    }

    @Test
    void anAnswerThatStopsPartWayIsClosedNotAnsweredTwice() {
        // the token limit, a safety stop after some text, and a stream that just ends without a finish reason
        for (String tail : List.of(ended("MAX_TOKENS"), ended("SAFETY"), "")) {
            fallbackCalls = 0;
            reply = text("Ice floats because ", null) + tail;
            List<String> shown = new ArrayList<>();
            String answer = model().stream("why does ice float", facts(AiTutor.Intent.CONCEPT, "content", true, null, "x"), null, List.of(), shown::add);
            assertThat(answer).as(tail).startsWith("Ice floats because ").endsWith("pick it up.)").doesNotContain("BUILT-IN");
            assertThat(String.join("", shown)).as(tail).isEqualTo(answer);
            assertThat(fallbackCalls).as(tail).isZero();
        }
    }

    @Test
    void wordingTheAppFixesNeverReachesTheModel() {
        reply = text("something else", "STOP");
        String answer = model().stream("mix bleach and vinegar", facts(AiTutor.Intent.MIX, "engine", true, "This one is blocked."), null, List.of(), t -> { });
        assertThat(answer).isEqualTo("This one is blocked.");
        assertThat(requests).isEmpty();
    }

    @Test
    void withNoLessonTheModelIsToldSoRatherThanHandedTheNotCoveredWording() {
        reply = text("Black holes are regions of very strong gravity.", "STOP");
        model().stream("Tell me about black holes", facts(AiTutor.Intent.CONCEPT, "none", true, null, AiTutor.NOT_COVERED, "Try rephrasing."), null, List.of(), t -> { });
        assertThat(requests.get(0).get("contents").get(0).toString()).contains("LABscape has no lesson that answers this").doesNotContain("so I won't guess");
        // an unmodelled mixture keeps its facts: the model must still be told it is not modelled
        requests.clear();
        model().stream("mix caffeine and toothpaste", facts(AiTutor.Intent.MIX, "none", false, null, AiTutor.NOT_MODELLED), null, List.of(), t -> { });
        assertThat(requests.get(0).get("contents").get(0).toString()).contains("validated model");
    }
}
