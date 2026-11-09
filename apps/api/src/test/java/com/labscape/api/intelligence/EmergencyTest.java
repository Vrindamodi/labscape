package com.labscape.api.intelligence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = "labscape.features.scenarios=true")
class EmergencyTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @Test
    void theSafePathScoresTopMarksAndEarnsXp() throws Exception {
        Cookie c = guest();
        JsonNode started = send(c, "/v1/emergency/scenarios/gas-fire/start", Map.of());
        assertThat(started.path("disclaimer").asText()).contains("112").contains("Training only");
        // the client never sees which choice is right
        assertThat(started.path("scene").toString()).doesNotContain("quality").doesNotContain("feedback").doesNotContain("\"next\"");
        String id = started.path("attemptId").asText();
        for (String choice : new String[] {"recognise", "people", "evacuate", "call"}) {
            JsonNode r = send(c, "/v1/emergency/attempts/" + id + "/choose", Map.of("choiceId", choice, "elapsedMs", 1500));
            assertThat(r.path("quality").asText()).as(choice).isEqualTo("best");
            assertThat(r.path("safe").asBoolean()).isTrue();
        }
        JsonNode result = send(c, "/v1/emergency/attempts/" + id + "/finish", Map.of());
        assertThat(result.path("score").asInt()).isEqualTo(100);
        assertThat(result.path("ending").path("outcome").asText()).isEqualTo("safe");
        assertThat(result.path("badgeEligible").asBoolean()).isTrue();
        assertThat(result.path("reward").path("xpAwarded").asInt()).isGreaterThan(0);
        assertThat(result.path("quizId").asText()).isEqualTo("quiz-emergency-gas-fire");
        // finishing again returns the stored result
        assertThat(send(c, "/v1/emergency/attempts/" + id + "/finish", Map.of()).path("score").asInt()).isEqualTo(100);
    }

    @Test
    void unsafeChoicesEscalateTheHazardAndAreExplained() throws Exception {
        Cookie c = guest();
        JsonNode started = send(c, "/v1/emergency/scenarios/gas-fire/start", Map.of());
        String id = started.path("attemptId").asText();
        double before = started.path("scene").path("hazard").asDouble();
        JsonNode slow = send(c, "/v1/emergency/attempts/" + id + "/choose", Map.of("choiceId", "ignore", "elapsedMs", 11000));
        assertThat(slow.path("safe").asBoolean()).isFalse();
        assertThat(slow.path("hazard").asDouble()).isGreaterThan(before);
        send(c, "/v1/emergency/attempts/" + id + "/choose", Map.of("choiceId", "look", "elapsedMs", 3000));
        JsonNode approach = send(c, "/v1/emergency/attempts/" + id + "/choose", Map.of("choiceId", "approach", "elapsedMs", 3000));
        assertThat(approach.path("feedback").asText()).contains("Do not approach a burning cylinder");
        JsonNode end = send(c, "/v1/emergency/attempts/" + id + "/choose", Map.of("choiceId", "back", "elapsedMs", 2000));
        assertThat(end.path("ending").path("outcome").asText()).isEqualTo("unsafe");
        JsonNode result = send(c, "/v1/emergency/attempts/" + id + "/finish", Map.of());
        assertThat(result.path("score").asInt()).isLessThan(30);
        assertThat(result.path("mistakes").size()).isEqualTo(4);
        assertThat(result.path("badgeEligible").asBoolean()).isFalse();
        // no more choices once it has ended
        mvc.perform(post("/v1/emergency/attempts/" + id + "/choose").cookie(c).contentType(MediaType.APPLICATION_JSON).content("{\"choiceId\":\"call\",\"elapsedMs\":1}"))
                .andExpect(status().isConflict());
    }

    @Test
    void everyScenarioIsOpenOnTheFreePlanAndBadInputIsRefused() throws Exception {
        Cookie c = guest();
        JsonNode list = mapper.readTree(mvc.perform(get("/v1/emergency/scenarios").cookie(c)).andReturn().getResponse().getContentAsString());
        assertThat(list.size()).isEqualTo(4);
        assertThat(list.get(0).path("slug").asText()).isEqualTo("gas-fire");
        assertThat(list.get(0).path("locked").asBoolean()).isFalse();
        list.forEach(s -> assertThat(s.path("locked").asBoolean()).isFalse());
        mvc.perform(post("/v1/emergency/scenarios/minor-burn/start").cookie(c).contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isOk());

        String id = send(c, "/v1/emergency/scenarios/gas-fire/start", Map.of()).path("attemptId").asText();
        mvc.perform(post("/v1/emergency/attempts/" + id + "/choose").cookie(c).contentType(MediaType.APPLICATION_JSON).content("{\"choiceId\":\"fly\",\"elapsedMs\":1}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/v1/emergency/attempts/" + id + "/finish").cookie(c).contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isConflict());
    }

    private JsonNode send(Cookie c, String path, Object body) throws Exception {
        return mapper.readTree(mvc.perform(post(path).cookie(c).contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    private Cookie guest() throws Exception {
        return mvc.perform(post("/v1/auth/guest").contentType(MediaType.APPLICATION_JSON).content("{}")).andReturn().getResponse().getCookie("ls_session");
    }
}
