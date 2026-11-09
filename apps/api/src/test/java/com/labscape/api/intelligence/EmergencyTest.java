package com.labscape.api.intelligence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labscape.api.intelligence.emergency.EmergencyController;
import com.labscape.api.intelligence.emergency.Scenarios;
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
    @Autowired Scenarios library;

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

    @Test
    void hintsClimbALadderCostFivePointsARungAndShowInTheDebrief() throws Exception {
        Cookie c = guest();
        JsonNode started = send(c, "/v1/emergency/scenarios/gas-fire/start", Map.of());
        // hints are served one rung at a time, never with the scene
        assertThat(started.toString()).doesNotContain("hints").doesNotContain("Where exactly is the flame");
        String id = started.path("attemptId").asText();
        String hint = "/v1/emergency/attempts/" + id + "/hint";

        JsonNode r1 = send(c, hint, Map.of());
        assertThat(r1.path("rung").asInt()).isEqualTo(1);
        assertThat(r1.path("rungs").asInt()).isEqualTo(3);
        assertThat(r1.path("text").asText()).isNotBlank();
        assertThat(r1.path("tool").asText(null)).isNull();
        assertThat(r1.path("cost").asInt()).isEqualTo(EmergencyController.HINT_COST);
        // rungs can't be skipped
        JsonNode r2 = send(c, hint, Map.of("rung", 3));
        assertThat(r2.path("rung").asInt()).isEqualTo(2);
        assertThat(r2.path("target").asText()).isEqualTo("regulator");
        // seeing a rung again is free
        JsonNode again = send(c, hint, Map.of("rung", 1));
        assertThat(again.path("cost").asInt()).isZero();
        assertThat(again.path("penalty").asInt()).isEqualTo(10);

        send(c, "/v1/emergency/attempts/" + id + "/choose", Map.of("choiceId", "recognise", "elapsedMs", 1500));
        send(c, hint, Map.of());
        JsonNode r3 = send(c, hint, Map.of());
        JsonNode top = send(c, hint, Map.of());
        assertThat(top.path("rung").asInt()).isEqualTo(3);
        assertThat(top.path("tool").asText()).isEqualTo("hands");
        assertThat(top.path("target").asText()).isEqualTo("brother");
        assertThat(r3.path("sceneRungs").asInt()).isEqualTo(2);
        assertThat(top.path("penalty").asInt()).isEqualTo(25);

        for (String choice : new String[] {"alert", "towel", "knob", "windows", "call"})
            send(c, "/v1/emergency/attempts/" + id + "/choose", Map.of("choiceId", choice, "elapsedMs", 1500));
        mvc.perform(post(hint).cookie(c).contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isConflict());
        JsonNode result = send(c, "/v1/emergency/attempts/" + id + "/finish", Map.of());
        assertThat(result.path("hintsUsed").asInt()).isEqualTo(5);
        assertThat(result.path("hintPenalty").asInt()).isEqualTo(25);
        assertThat(result.path("score").asInt()).isEqualTo(75);
        assertThat(result.path("badgeEligible").asBoolean()).isFalse();
        assertThat(result.path("steps").get(0).path("hints").asInt()).isEqualTo(2);
        assertThat(result.path("steps").get(1).path("hints").asInt()).isEqualTo(3);
        assertThat(result.path("steps").get(2).path("hints").asInt()).isZero();

        // every hint in every scene: the cost is capped, so a safe run still passes
        String id2 = send(c, "/v1/emergency/scenarios/gas-fire/start", Map.of()).path("attemptId").asText();
        JsonNode last = null;
        for (String choice : new String[] {"recognise", "alert", "towel", "knob", "windows", "call"}) {
            for (int i = 0; i < 3; i++) last = send(c, "/v1/emergency/attempts/" + id2 + "/hint", Map.of());
            send(c, "/v1/emergency/attempts/" + id2 + "/choose", Map.of("choiceId", choice, "elapsedMs", 1500));
        }
        assertThat(last.path("penalty").asInt()).isEqualTo(EmergencyController.HINT_CAP);
        assertThat(last.path("cost").asInt()).isZero();
        JsonNode capped = send(c, "/v1/emergency/attempts/" + id2 + "/finish", Map.of());
        assertThat(capped.path("hintsUsed").asInt()).isEqualTo(18);
        assertThat(capped.path("hintPenalty").asInt()).isEqualTo(40);
        assertThat(capped.path("score").asInt()).isEqualTo(60);
    }

    @Test
    void everySceneHasAThreeRungHintLadderThatLeadsToTheBestChoice() {
        assertThat(library.all()).hasSize(4);
        for (JsonNode s : library.all()) {
            Set<String> tools = new HashSet<>();
            s.path("tools").forEach(t -> tools.add(t.path("id").asText()));
            Set<String> spots = new HashSet<>();
            s.path("hotspots").forEach(h -> spots.add(h.path("id").asText()));
            for (JsonNode sc : s.path("scenes")) {
                String where = s.path("slug").asText() + "/" + sc.path("id").asText();
                JsonNode h = sc.path("hints");
                assertThat(h.size()).as(where).isEqualTo(3);
                h.forEach(x -> assertThat(x.path("text").asText()).as(where).hasSizeGreaterThan(15));
                assertThat(spots).as(where + " rung 2 target").contains(h.get(1).path("target").asText());
                String tool = h.get(2).path("tool").asText();
                String target = h.get(2).path("target").asText();
                assertThat(tools).as(where).contains(tool);
                // rung 3 is exactly a best choice's action, so "Show me" plays the right thing
                boolean leadsToBest = false;
                for (JsonNode ch : sc.path("choices"))
                    if (ch.path("quality").asText().equals("best"))
                        for (JsonNode a : Scenarios.actionsOf(ch)) leadsToBest |= a.path("tool").asText().equals(tool) && a.path("target").asText().equals(target);
                assertThat(leadsToBest).as(where + " rung 3 " + tool + "@" + target).isTrue();
            }
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
