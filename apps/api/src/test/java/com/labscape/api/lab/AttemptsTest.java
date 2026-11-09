package com.labscape.api.lab;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.Cookie;
import java.util.Iterator;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Part 2 "done when": replaying an event log on the server (GraalJS) produces the same state hash
 * as the browser engine (V8) and the same score; completion awards XP exactly once.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AttemptsTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired LabEngineRuntime engine;

    @Test
    void graalJsReplayMatchesTheBrowserEngineForEveryGoldenRun() throws Exception {
        JsonNode expected = mapper.readTree(new ClassPathResource("engine-golden-hashes.json").getInputStream());
        Iterator<Map.Entry<String, JsonNode>> it = expected.fields();
        int checked = 0;
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            JsonNode content = engine.content(e.getKey()).orElseThrow();
            JsonNode result = engine.score(e.getKey(), golden(content).toString(), 1000);
            assertThat(result.path("hash").asText()).as(e.getKey()).isEqualTo(e.getValue().path("hash").asText());
            assertThat(result.path("report").path("score").asInt()).as(e.getKey()).isEqualTo(e.getValue().path("score").asInt());
            checked++;
        }
        assertThat(checked).isEqualTo(28); // 13 chemistry + 8 physics + 7 maths
    }

    @Test
    void anAttemptIsSavedResumedScoredAndRewardedOnce() throws Exception {
        Cookie c = mvc.perform(post("/v1/auth/guest").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andReturn().getResponse().getCookie("ls_session");
        JsonNode attempt = json(mvc.perform(post("/v1/attempts").cookie(c).contentType(MediaType.APPLICATION_JSON)
                .content("{\"experimentSlug\":\"precipitation-reactions\"}")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        String id = attempt.path("id").asText();
        ArrayNode events = golden(engine.content("precipitation-reactions").orElseThrow());

        // Autosave in two batches; the second batch overlaps the first and is deduplicated.
        ArrayNode first = mapper.createArrayNode();
        ArrayNode second = mapper.createArrayNode();
        for (int i = 0; i < events.size(); i++) (i < 6 ? first : second).add(events.get(i));
        second.insert(0, events.get(5));
        send(c, "/v1/attempts/" + id + "/events", Map.of("events", first, "stage", "try"));
        JsonNode saved = send(c, "/v1/attempts/" + id + "/events", Map.of("events", second));
        assertThat(saved.path("lastSeq").asInt()).isEqualTo(events.size());

        // Resume returns the same attempt with every event.
        JsonNode resumed = json(mvc.perform(post("/v1/attempts").cookie(c).contentType(MediaType.APPLICATION_JSON)
                .content("{\"experimentSlug\":\"precipitation-reactions\"}")).andReturn().getResponse().getContentAsString());
        assertThat(resumed.path("id").asText()).isEqualTo(id);
        assertThat(resumed.path("events").size()).isEqualTo(events.size());

        JsonNode done = send(c, "/v1/attempts/" + id + "/finish", Map.of("tailMs", 1000));
        assertThat(done.path("status").asText()).isEqualTo("completed");
        assertThat(done.path("report").path("stars").asInt()).isEqualTo(3);
        assertThat(done.path("reward").path("xpAwarded").asInt()).isGreaterThanOrEqualTo(100);

        // Finishing again re-scores but cannot award XP twice.
        mvc.perform(post("/v1/attempts/" + id + "/finish").cookie(c).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reward.duplicate").value(true));
    }

    @Test
    void undoRewindsTheLogAndLaterEventsReuseTheirSeqs() throws Exception {
        Cookie c = mvc.perform(post("/v1/auth/guest").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andReturn().getResponse().getCookie("ls_session");
        String id = send(c, "/v1/attempts", Map.of("experimentSlug", "precipitation-reactions")).path("id").asText();
        ArrayNode events = golden(engine.content("precipitation-reactions").orElseThrow());

        // The learner does the first two actions, then a wrong one (seq 3)...
        ArrayNode firstTwo = mapper.createArrayNode();
        firstTwo.add(events.get(0));
        firstTwo.add(events.get(1));
        send(c, "/v1/attempts/" + id + "/events", Map.of("events", firstTwo, "stage", "try"));
        ObjectNode wrong = events.get(2).deepCopy();
        ((ObjectNode) wrong.path("payload")).put("from", "bacl2");
        wrong.put("id", "wrong-3");
        send(c, "/v1/attempts/" + id + "/events", Map.of("events", mapper.createArrayNode().add(wrong)));

        // ...undoes it (the client rewinds the server log to seq 2), then carries on with the right events.
        JsonNode rewound = send(c, "/v1/attempts/" + id + "/restart", Map.of("keepThroughSeq", 2));
        assertThat(rewound.path("events").size()).isEqualTo(2);
        ArrayNode rest = mapper.createArrayNode();
        for (int i = 2; i < events.size(); i++) rest.add(events.get(i));
        JsonNode saved = send(c, "/v1/attempts/" + id + "/events", Map.of("events", rest));
        assertThat(saved.path("inserted").asInt()).isEqualTo(events.size() - 2);

        // The undone event is gone, so the replayed run is clean.
        JsonNode done = send(c, "/v1/attempts/" + id + "/finish", Map.of("tailMs", 1000));
        assertThat(done.path("status").asText()).isEqualTo("completed");
        assertThat(done.path("report").path("stars").asInt()).isEqualTo(3);
    }

    @Test
    void physicsAndMathsAttemptsAreScoredOnTheServer() throws Exception {
        Cookie c = mvc.perform(post("/v1/auth/guest").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andReturn().getResponse().getCookie("ls_session");
        for (String slug : new String[] {"ohms-law", "riemann-sums"}) {
            JsonNode attempt = send(c, "/v1/attempts", Map.of("experimentSlug", slug));
            String id = attempt.path("id").asText();
            send(c, "/v1/attempts/" + id + "/events", Map.of("events", golden(engine.content(slug).orElseThrow()), "stage", "try"));
            JsonNode done = send(c, "/v1/attempts/" + id + "/finish", Map.of());
            assertThat(done.path("report").path("stars").asInt()).as(slug).isEqualTo(3);
            assertThat(done.path("reward").path("xpAwarded").asInt()).as(slug).isGreaterThan(0);
        }
    }

    @Test
    void checkEndpointsReDeriveReadings() throws Exception {
        Cookie c = mvc.perform(post("/v1/auth/guest").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andReturn().getResponse().getCookie("ls_session");
        ArrayNode events = golden(engine.content("projectile-motion").orElseThrow());
        assertThat(send(c, "/v1/physics/check", Map.of("experimentSlug", "projectile-motion", "events", events)).path("report").path("stars").asInt()).isEqualTo(3);

        // A tape reading that does not match where the ball landed is caught by the server.
        for (JsonNode e : events)
            if (e.path("type").asText().equals("measure.read")) ((ObjectNode) e.path("payload").path("reading")).put("value", 38.0);
        JsonNode bad = send(c, "/v1/physics/check", Map.of("experimentSlug", "projectile-motion", "events", events));
        assertThat(bad.path("report").path("deviations").toString()).contains("tape-misread");

        // Subjects are not interchangeable, and anonymous calls are refused.
        mvc.perform(post("/v1/maths/check").cookie(c).contentType(MediaType.APPLICATION_JSON)
                .content("{\"experimentSlug\":\"projectile-motion\",\"events\":[]}")).andExpect(status().isNotFound());
        mvc.perform(post("/v1/maths/check").contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isUnauthorized());
    }

    @Test
    void experimentsAndPacksArePublic() throws Exception {
        mvc.perform(get("/v1/experiments/acid-base-titration"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.steps.length()").value(15))
                .andExpect(jsonPath("$.card.slug").value("acid-base-titration"));
        mvc.perform(get("/v1/chem/packs/flame-tests")).andExpect(jsonPath("$.signature").isString());
        mvc.perform(get("/v1/experiments/nope")).andExpect(status().isNotFound());
        mvc.perform(post("/v1/attempts").contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isUnauthorized());
    }

    private ArrayNode golden(JsonNode content) {
        ArrayNode out = mapper.createArrayNode();
        int seq = 0;
        for (JsonNode e : content.path("golden").path("events")) {
            seq++;
            ObjectNode o = out.addObject();
            o.put("id", "golden-" + seq);
            o.put("attemptId", "golden");
            o.put("seq", seq);
            o.put("t", e.path("t").asLong());
            o.put("actor", "demo");
            o.put("type", e.path("type").asText());
            o.set("payload", e.path("payload"));
        }
        return out;
    }

    private JsonNode send(Cookie c, String path, Object body) throws Exception {
        return json(mvc.perform(post(path).cookie(c).contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    private JsonNode json(String s) throws Exception {
        return mapper.readTree(s);
    }
}
