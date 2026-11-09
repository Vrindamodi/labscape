package com.labscape.api.intelligence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
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
        assertThat(started.path("scene").toString()).doesNotContain("quality").doesNotContain("feedback").doesNotContain("\"next\"").doesNotContain("anim");
        // the hands-on layer: a tool tray, room hotspots and (tool, target) actions that map to choices
        assertThat(started.path("tools").size()).isGreaterThan(4);
        assertThat(started.path("hotspots").toString()).contains("regulator");
        assertThat(started.path("scene").path("actions").toString()).contains("\"tool\":\"point\"").contains("\"target\":\"regulator\"");
        assertThat(started.path("scene").path("props").toString()).contains("fire");
        String id = started.path("attemptId").asText();
        String[] path = {"recognise", "alert", "towel", "knob", "windows", "call"};
        for (String choice : path) {
            JsonNode r = send(c, "/v1/emergency/attempts/" + id + "/choose", Map.of("choiceId", choice, "elapsedMs", 1500));
            assertThat(r.path("quality").asText()).as(choice).isEqualTo("best");
            assertThat(r.path("safe").asBoolean()).isTrue();
            assertThat(r.path("anim").asText()).as(choice).isNotBlank();
        }
        JsonNode result = send(c, "/v1/emergency/attempts/" + id + "/finish", Map.of());
        assertThat(result.path("score").asInt()).isEqualTo(100);
        assertThat(result.path("ending").path("outcome").asText()).isEqualTo("safe");
        assertThat(result.path("badgeEligible").asBoolean()).isTrue();
        assertThat(result.path("reward").path("xpAwarded").asInt()).isGreaterThan(0);
        assertThat(result.path("quizId").asText()).isEqualTo("quiz-emergency-gas-fire");
        // the debrief replays every step with its scene state
        assertThat(result.path("steps").size()).isEqualTo(path.length);
        assertThat(result.path("steps").get(2).path("anim").asText()).isEqualTo("cover-towel");
        assertThat(result.path("steps").get(2).path("tool").asText()).isEqualTo("wet-towel");
        assertThat(result.path("steps").get(2).path("props").toString()).contains("fire");
        assertThat(result.path("steps").get(2).path("better").asText(null)).isNull();
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
        send(c, "/v1/emergency/attempts/" + id + "/choose", Map.of("choiceId", "fan", "elapsedMs", 3000));
        JsonNode water = send(c, "/v1/emergency/attempts/" + id + "/choose", Map.of("choiceId", "water", "elapsedMs", 3000));
        assertThat(water.path("feedback").asText()).contains("Never use water on a gas or oil fire");
        assertThat(water.path("anim").asText()).isEqualTo("water-flare");
        send(c, "/v1/emergency/attempts/" + id + "/choose", Map.of("choiceId", "match", "elapsedMs", 3000));
        send(c, "/v1/emergency/attempts/" + id + "/choose", Map.of("choiceId", "fan", "elapsedMs", 3000));
        JsonNode end = send(c, "/v1/emergency/attempts/" + id + "/choose", Map.of("choiceId", "relight", "elapsedMs", 2000));
        assertThat(end.path("ending").path("outcome").asText()).isEqualTo("unsafe");
        JsonNode result = send(c, "/v1/emergency/attempts/" + id + "/finish", Map.of());
        assertThat(result.path("score").asInt()).isLessThan(30);
        assertThat(result.path("mistakes").size()).isEqualTo(6);
        // each wrong step names the safer alternative for the debrief
        assertThat(result.path("steps").get(2).path("better").asText()).contains("wet towel");
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

    @Test
    void everyScenarioIsPlayableHandsOn() throws Exception {
        Cookie c = guest();
        JsonNode list = mapper.readTree(mvc.perform(get("/v1/emergency/scenarios").cookie(c)).andReturn().getResponse().getContentAsString());
        for (JsonNode card : list) {
            String slug = card.path("slug").asText();
            JsonNode started = send(c, "/v1/emergency/scenarios/" + slug + "/start", Map.of());
            Set<String> tools = new HashSet<>();
            started.path("tools").forEach(t -> tools.add(t.path("id").asText()));
            Set<String> spots = new HashSet<>();
            started.path("hotspots").forEach(h -> spots.add(h.path("id").asText()));
            // walk the best path, checking every choice in every scene can be made with a tool on a hotspot
            String id = started.path("attemptId").asText();
            JsonNode scene = started.path("scene");
            int guard = 0;
            while (scene.isObject() && guard++ < 20) {
                Set<String> pairs = new HashSet<>();
                Set<String> covered = new HashSet<>();
                for (JsonNode a : scene.path("actions")) {
                    assertThat(tools).as(slug + " tool " + a).contains(a.path("tool").asText());
                    assertThat(spots).as(slug + " target " + a).contains(a.path("target").asText());
                    assertThat(pairs.add(a.path("tool").asText() + "@" + a.path("target").asText())).as(slug + " duplicate action " + a).isTrue();
                    covered.add(a.path("choiceId").asText());
                }
                for (JsonNode ch : scene.path("choices")) assertThat(covered).as(slug + "/" + scene.path("id").asText()).contains(ch.path("id").asText());
                assertThat(scene.path("prompt").asText()).isNotBlank();
                JsonNode r = send(c, "/v1/emergency/attempts/" + id + "/choose", Map.of("choiceId", scene.path("choices").get(0).path("id").asText(), "elapsedMs", 1000));
                assertThat(r.path("quality").asText()).as(slug + " first choice is the best").isEqualTo("best");
                scene = r.path("next");
            }
            JsonNode result = send(c, "/v1/emergency/attempts/" + id + "/finish", Map.of());
            assertThat(result.path("score").asInt()).as(slug).isEqualTo(100);
        }
    }

    private JsonNode send(Cookie c, String path, Object body) throws Exception {
        return mapper.readTree(mvc.perform(post(path).cookie(c).contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    private Cookie guest() throws Exception {
        return mvc.perform(post("/v1/auth/guest").contentType(MediaType.APPLICATION_JSON).content("{}")).andReturn().getResponse().getCookie("ls_session");
    }
}
