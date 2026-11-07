package com.labscape.api.core;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ReferenceTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    private JsonNode getJson(String url) throws Exception {
        String body = mvc.perform(get(url)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return mapper.readTree(body);
    }

    @Test
    void periodicTableHasEveryElementInItsOwnCell() throws Exception {
        JsonNode items = getJson("/v1/elements").get("items");
        assertThat(items.size()).isEqualTo(118);
        Set<String> cells = new HashSet<>();
        for (JsonNode e : items) {
            assertThat(cells.add(e.get("row").asInt() + ":" + e.get("col").asInt())).as("cell of " + e.get("symbol")).isTrue();
            assertThat(e.get("col").asInt()).isBetween(1, 18);
        }
        // IUPAC layout: group 3 is Sc, Y, Lu, Lr; La and Ac start the f-block rows.
        JsonNode lu = items.get(70);
        assertThat(lu.get("symbol").asText()).isEqualTo("Lu");
        assertThat(lu.get("group").asInt()).isEqualTo(3);
        assertThat(items.get(56).get("block").asText()).isEqualTo("f");
        assertThat(items.get(56).get("row").asInt()).isEqualTo(9);
        assertThat(items.get(25).get("group").asInt()).isEqualTo(8); // Fe
        assertThat(items.get(1).get("group").asInt()).isEqualTo(18); // He
        assertThat(items.get(1).get("block").asText()).isEqualTo("s");
        assertThat(items.get(117).get("period").asInt()).isEqualTo(7); // Og
        assertThat(items.get(117).get("col").asInt()).isEqualTo(18);
    }

    @Test
    void elementsLinkToTheExperimentsThatUseThem() throws Exception {
        JsonNode cu = getJson("/v1/elements/Cu");
        assertThat(cu.get("z").asInt()).isEqualTo(29);
        Set<String> slugs = new HashSet<>();
        cu.get("experiments").forEach(x -> slugs.add(x.get("slug").asText()));
        assertThat(slugs).contains("iron-nail-copper-sulfate", "precipitation-reactions", "flame-tests");
        assertThat(getJson("/v1/elements/8").get("symbol").asText()).isEqualTo("O");
        mvc.perform(get("/v1/elements/Xx")).andExpect(status().isNotFound());
    }

    @Test
    void formulasOpenTheirLabs() throws Exception {
        JsonNode items = getJson("/v1/formulas").get("items");
        assertThat(items.size()).isGreaterThanOrEqualTo(50);
        JsonNode ohm = getJson("/v1/formulas/ohms-law");
        assertThat(ohm.get("expr").asText()).isEqualTo("V - I*R");
        JsonNode lab = ohm.get("experiments").get(0);
        assertThat(lab.get("slug").asText()).isEqualTo("ohms-law");
        assertThat(lab.get("playable").asBoolean()).isTrue();
        mvc.perform(get("/v1/formulas/nope")).andExpect(status().isNotFound());
    }

    @Test
    void equipmentLinksToExperimentsAndHidesAliases() throws Exception {
        JsonNode eq = getJson("/v1/equipment");
        assertThat(eq.get("items").size()).isGreaterThanOrEqualTo(20);
        JsonNode burette = getJson("/v1/equipment/burette");
        assertThat(burette.has("aliases")).isFalse();
        assertThat(burette.get("parts").size()).isEqualTo(4);
        assertThat(burette.get("experiments").get(0).get("slug").asText()).isEqualTo("acid-base-titration");
        mvc.perform(get("/v1/equipment/nope")).andExpect(status().isNotFound());
    }
}
