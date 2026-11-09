package com.labscape.api.intelligence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultMatcher;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PlaygroundSessionsTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @Test
    void freePlanSessionsAreUnlimitedAndResumingTodayWorks() throws Exception {
        Cookie c = guest();
        String first = null;
        for (int i = 0; i < 6; i++) {
            JsonNode s = send(c, Map.of("mode", i % 2 == 0 ? "circuits" : "graphing"), status().isOk());
            if (first == null) first = s.path("id").asText();
            assertThat(s.path("usage").path("usedToday").asInt()).isEqualTo(i + 1);
            assertThat(s.path("usage").path("limit").isNumber()).isFalse(); // no limit (null or omitted)
        }

        // Save a build, then reopen it: today's session reopens without using the limit.
        Map<String, Object> build = Map.of("parts", List.of(Map.of("id", "B1", "kind", "battery", "value", 6)), "wires", List.of());
        mvc.perform(put("/v1/playground/sessions/" + first).cookie(c).contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("title", "My first circuit", "snapshot", build)))).andExpect(status().isOk());
        JsonNode resumed = send(c, Map.of("mode", "circuits", "resume", first), status().isOk());
        assertThat(resumed.path("id").asText()).isEqualTo(first);
        assertThat(resumed.path("snapshot").path("parts").get(0).path("kind").asText()).isEqualTo("battery");

        JsonNode history = json(mvc.perform(get("/v1/playground/sessions").cookie(c)).andExpect(status().isOk()));
        assertThat(history.path("sessions").size()).isEqualTo(6);
        assertThat(history.path("sessions").get(0).path("title").asText()).isEqualTo("My first circuit");
        assertThat(history.path("usage").path("usedToday").asInt()).isEqualTo(6);

        // Wrong mode and other people's sessions are refused.
        send(c, Map.of("mode", "graphing", "resume", first), status().isBadRequest());
        send(guest(), Map.of("mode", "circuits", "resume", first), status().isNotFound());
        send(c, Map.of("mode", "alchemy"), status().isBadRequest());
    }

    private JsonNode send(Cookie c, Object body, ResultMatcher expect) throws Exception {
        return json(mvc.perform(post("/v1/playground/sessions").cookie(c).contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))).andExpect(expect));
    }

    private JsonNode json(org.springframework.test.web.servlet.ResultActions r) throws Exception {
        return mapper.readTree(r.andReturn().getResponse().getContentAsString());
    }

    private Cookie guest() throws Exception {
        return mvc.perform(post("/v1/auth/guest").contentType(MediaType.APPLICATION_JSON).content("{}")).andReturn().getResponse().getCookie("ls_session");
    }
}
