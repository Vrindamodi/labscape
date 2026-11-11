package com.labscape.api.intelligence.safety;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.labscape.api.intelligence.chem.Catalogue;
import com.labscape.api.intelligence.chem.ChemistryEngine;
import com.labscape.api.intelligence.playground.PlaygroundController;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

class SafetyControllerTest {

    static final String HCL_NAOH = """
            {"id":"r1","subject":"chemistry","mode":"sandbox","attemptId":"a1",
             "inputs":[{"ref":"hcl","amount":10,"unit":"mL"},{"ref":"naoh","amount":10,"unit":"mL"}],
             "conditions":{"temperatureC":22}}
            """;

    static final String BLEACH_ACID = """
            {"id":"r2","subject":"chemistry","mode":"sandbox","attemptId":"a2",
             "inputs":[{"ref":"bleach","amount":5,"unit":"mL"},{"ref":"hcl","amount":5,"unit":"mL"}]}
            """;

    @Nested
    @WebMvcTest(controllers = {SafetyController.class, PlaygroundController.class})
    @org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc(addFilters = false)
    @Import({SafetyPipeline.class, Catalogue.class, SafetyRuleBook.class, ChemistryEngine.class, ProbeGuard.class,
            SafetyAuditSink.class, SafetyProblemAdvice.class})
    @TestPropertySource(properties = {"labscape.web-origin=http://localhost:5173", "labscape.safety.engine-enabled=true"})
    class Enabled {
        @Autowired MockMvc mvc;

        @Test
        void resolvesAReaction() throws Exception {
            mvc.perform(post("/v1/safety/resolve").contentType(MediaType.APPLICATION_JSON).content(HCL_NAOH))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.outcome").value("reaction"))
                    .andExpect(jsonPath("$.presentation.discoveryIds[0]").value("neutralisation"))
                    .andExpect(jsonPath("$.cues[0].kind").exists());
        }

        @Test
        void prohibitedNeverNamesTheRule() throws Exception {
            mvc.perform(post("/v1/safety/resolve").contentType(MediaType.APPLICATION_JSON).content(BLEACH_ACID)
                            .header("X-Lab-Session", "ctl-test"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.outcome").value("prohibited"))
                    .andExpect(jsonPath("$.reasonCode").value("SAFETY_RESTRICTION"))
                    .andExpect(jsonPath("$.cues").isEmpty());
        }

        @Test
        void validationErrorsAreProblemDetails() throws Exception {
            mvc.perform(post("/v1/safety/resolve").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"id\":\"x\",\"subject\":\"chemistry\",\"mode\":\"sandbox\",\"attemptId\":\"a\",\"inputs\":[]}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(header().string("Content-Type", MediaType.APPLICATION_PROBLEM_JSON_VALUE));
        }

        @Test
        void unknownRefIs422() throws Exception {
            mvc.perform(post("/v1/safety/resolve").contentType(MediaType.APPLICATION_JSON).content(
                            HCL_NAOH.replace("\"ref\":\"hcl\"", "\"ref\":\"mystery\"")))
                    .andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.code").value("NOT_IN_CATALOGUE"));
        }

        @Test
        void tryNextSuggestsShelfItemsWithoutMixingAnything() throws Exception {
            String acidOnly = HCL_NAOH.replace(",{\"ref\":\"naoh\",\"amount\":10,\"unit\":\"mL\"}", "");
            mvc.perform(post("/v1/playground/try-next").contentType(MediaType.APPLICATION_JSON).content(acidOnly))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.suggestions.length()").value(org.hamcrest.Matchers.greaterThan(2)))
                    .andExpect(jsonPath("$.suggestions[0].kind").value("add"))
                    .andExpect(jsonPath("$.suggestions[0].ref").exists())
                    .andExpect(jsonPath("$.suggestions[0].teaser").isNotEmpty())
                    .andExpect(jsonPath("$.suggestions[?(@.ref == 'bleach')]").isEmpty());
            // a beaker that is itself a blocked mix gets no hints at all
            mvc.perform(post("/v1/playground/try-next").contentType(MediaType.APPLICATION_JSON).content(BLEACH_ACID))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.suggestions").isEmpty());
        }

        @Test
        void aChainedRequestCarriesAnEarlierMixIntoThisVessel() throws Exception {
            // acid added to the residue filtered out of copper sulfate + sodium hydroxide
            String chained = """
                    {"id":"r3","subject":"chemistry","mode":"sandbox","attemptId":"a3",
                     "inputs":[{"ref":"hcl","amount":10,"unit":"mL"}],
                     "bases":[{"inputs":[{"ref":"cuso4","amount":10,"unit":"mL"},{"ref":"naoh","amount":5,"unit":"mL"}],
                               "keep":"residue","fraction":1}]}
                    """;
            mvc.perform(post("/v1/safety/resolve").contentType(MediaType.APPLICATION_JSON).content(chained))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.outcome").value("reaction"))
                    .andExpect(jsonPath("$.cues[?(@.carried == true)]").isNotEmpty());
            // nothing new added is fine when something was carried in, but "keep" must be one of the three parts
            mvc.perform(post("/v1/safety/resolve").contentType(MediaType.APPLICATION_JSON)
                            .content(chained.replace("\"inputs\":[{\"ref\":\"hcl\",\"amount\":10,\"unit\":\"mL\"}]", "\"inputs\":[]")))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.presentation.title").value("The residue"));
            mvc.perform(post("/v1/safety/resolve").contentType(MediaType.APPLICATION_JSON).content(chained.replace("residue", "vapour")))
                    .andExpect(status().isBadRequest());
        }

        @Test
        void catalogueHidesSafetyMetadata() throws Exception {
            mvc.perform(get("/v1/playground/catalogue"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.safetyEngineOnline").value(true))
                    .andExpect(jsonPath("$.substances[0].id").exists())
                    .andExpect(jsonPath("$.substances[0].tags").doesNotExist())
                    .andExpect(jsonPath("$.substances[0].species").doesNotExist())
                    .andExpect(jsonPath("$.discoveries.length()").value(org.hamcrest.Matchers.greaterThan(20)));
        }
    }

    @Nested
    @WebMvcTest(controllers = {SafetyController.class, PlaygroundController.class})
    @org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc(addFilters = false)
    @Import({SafetyPipeline.class, Catalogue.class, SafetyRuleBook.class, ChemistryEngine.class, ProbeGuard.class,
            SafetyAuditSink.class, SafetyProblemAdvice.class})
    @TestPropertySource(properties = {"labscape.web-origin=http://localhost:5173", "labscape.safety.engine-enabled=false"})
    class Disabled {
        @Autowired MockMvc mvc;

        @Test
        void flagOffMeansNoReactionsAtAll() throws Exception {
            mvc.perform(post("/v1/safety/resolve").contentType(MediaType.APPLICATION_JSON).content(HCL_NAOH))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.code").value("SAFETY_ENGINE_DISABLED"));
            mvc.perform(get("/v1/playground/catalogue")).andExpect(jsonPath("$.safetyEngineOnline").value(false));
        }
    }
}
