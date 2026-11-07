package com.labscape.api.intelligence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labscape.api.lab.LabEngineRuntime;
import jakarta.servlet.http.Cookie;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class NotebookTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired LabEngineRuntime engine;

    /** Runs the golden run as a real attempt and finishes it; returns the attempt id. */
    private String completedAttempt(Cookie c, String slug) throws Exception {
        String id = send(c, "/v1/attempts", Map.of("experimentSlug", slug, "fresh", true)).path("id").asText();
        ArrayNode events = mapper.createArrayNode();
        int seq = 0;
        for (JsonNode e : engine.content(slug).orElseThrow().path("golden").path("events")) {
            ObjectNode o = events.addObject();
            o.put("id", "g-" + (++seq)).put("attemptId", id).put("seq", seq).put("t", e.path("t").asLong()).put("actor", "user").put("type", e.path("type").asText());
            o.set("payload", e.path("payload"));
        }
        send(c, "/v1/attempts/" + id + "/events", Map.of("events", events, "stage", "try"));
        send(c, "/v1/attempts/" + id + "/finish", Map.of("tailMs", 1000));
        return id;
    }

    @Test
    void theNotebookIsGeneratedFromTheEventLog() throws Exception {
        Cookie c = guest();
        String id = completedAttempt(c, "ohms-law");
        JsonNode index = getJson(c, "/v1/notebook");
        assertThat(index.path("entries").get(0).path("attemptId").asText()).isEqualTo(id);

        JsonNode e = getJson(c, "/v1/notebook/" + id);
        assertThat(e.path("title").asText()).isEqualTo("Ohm's law");
        int events = engine.content("ohms-law").orElseThrow().path("golden").path("events").size();
        assertThat(e.path("actions").size()).isEqualTo(events); // every event became a line
        assertThat(e.path("actions").get(0).path("text").asText()).isEqualTo("Connected B.a to S.a");
        assertThat(e.path("actions").get(0).path("time").asText()).isEqualTo("00:01");
        assertThat(e.path("readings").size()).isEqualTo(10);
        assertThat(e.path("equationLatex").asText()).isEqualTo("V = IR");
        assertThat(e.path("stars").asInt()).isEqualTo(3);
        assertThat(e.path("suggestedConclusion").asText()).isNotBlank();
    }

    @Test
    void notesClipsAndExportRules() throws Exception {
        Cookie c = guest();
        String id = completedAttempt(c, "riemann-sums");
        mvc.perform(put("/v1/notebook/" + id).cookie(c).contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("notes", "Midpoint closes in fastest.", "conclusion", "The area is 8/3.")))).andExpect(status().isOk());
        send(c, "/v1/notebook/clips", Map.of("text", "Left sums under-estimate rising curves.", "source", "assistant", "attemptId", id));
        JsonNode e = getJson(c, "/v1/notebook/" + id);
        assertThat(e.path("notes").asText()).startsWith("Midpoint closes in fastest.").contains("> Left sums under-estimate");
        assertThat(e.path("conclusion").asText()).isEqualTo("The area is 8/3.");

        send(c, "/v1/notebook/clips", Map.of("text", "What is a burette for?", "source", "assistant"));
        assertThat(getJson(c, "/v1/notebook").path("clips").size()).isEqualTo(1);

        // PDF export is a premium feature
        mvc.perform(get("/v1/reports/" + id).cookie(c)).andExpect(status().isPaymentRequired());
        // nobody else can read it
        mvc.perform(get("/v1/notebook/" + id).cookie(guest())).andExpect(status().isNotFound());
    }

    @Test
    void replayReproducesTheStoredStateHash() throws Exception {
        Cookie c = guest();
        // every MVP experiment: 7 chemistry, 6 physics, 6 maths
        for (String slug : engine.slugs()) {
            String id = completedAttempt(c, slug);
            JsonNode r = getJson(c, "/v1/replay/" + id);
            assertThat(r.path("events").size()).as(slug).isGreaterThan(3);
            JsonNode v = getJson(c, "/v1/replay/" + id + "/verify");
            assertThat(v.path("storedHash").asText()).as(slug).isNotBlank();
            assertThat(v.path("hashMatches").asBoolean()).as(slug).isTrue();
        }
    }

    private JsonNode getJson(Cookie c, String path) throws Exception {
        return mapper.readTree(mvc.perform(get(path).cookie(c)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    private JsonNode send(Cookie c, String path, Object body) throws Exception {
        return mapper.readTree(mvc.perform(post(path).cookie(c).contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    private Cookie guest() throws Exception {
        return mvc.perform(post("/v1/auth/guest").contentType(MediaType.APPLICATION_JSON).content("{}")).andReturn().getResponse().getCookie("ls_session");
    }
}
