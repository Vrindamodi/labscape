package com.labscape.api.intelligence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labscape.api.intelligence.quiz.QuizBank;
import com.labscape.api.intelligence.quiz.QuizGrader;
import jakarta.servlet.http.Cookie;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = "labscape.features.quizzes=true")
class QuizTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired QuizBank bank;
    @Autowired JdbcClient db;

    private JsonNode q(String json) throws Exception {
        return mapper.readTree(json.replace('\'', '"'));
    }

    @Test
    void gradesEveryQuestionTypeWithPartialCredit() throws Exception {
        assertThat(QuizGrader.grade(q("{'type':'multiple_choice','multi':false,'answer':['b']}"), q("{'optionIds':['b']}")).credit()).isEqualTo(1);
        assertThat(QuizGrader.grade(q("{'type':'multiple_choice','multi':true,'answer':['a','c']}"), q("{'optionIds':['a','d']}")).credit()).isEqualTo(0);
        assertThat(QuizGrader.grade(q("{'type':'multiple_choice','multi':true,'answer':['a','c']}"), q("{'optionIds':['a']}")).credit()).isEqualTo(0.5);
        assertThat(QuizGrader.grade(q("{'type':'true_false','answer':false}"), q("{'value':false}")).correct()).isTrue();
        assertThat(QuizGrader.grade(q("{'type':'match','answer':[['l1','r1'],['l2','r2']]}"), q("{'pairs':[['l1','r1'],['l2','r1']]}")).credit()).isEqualTo(0.5);
        assertThat(QuizGrader.grade(q("{'type':'label_diagram','answer':[['k1','a'],['k2','b']]}"), q("{'placements':[['k1','a'],['k2','b']]}")).correct()).isTrue();
        // ordering: 3 of 4 in the right relative order
        assertThat(QuizGrader.grade(q("{'type':'arrange_steps','answer':['s1','s2','s3','s4']}"), q("{'order':['s2','s1','s3','s4']}")).credit()).isEqualTo(0.75);
        JsonNode num = q("{'type':'numerical','answer':0.08,'unit':'mol/L','tolerance':{'abs':0.002},'acceptUnits':['mol/L','M']}");
        assertThat(QuizGrader.grade(num, q("{'value':0.081,'unit':'M'}")).credit()).isEqualTo(1);
        assertThat(QuizGrader.grade(num, q("{'value':0.081,'unit':'g'}")).credit()).isEqualTo(0.5);
        assertThat(QuizGrader.grade(num, q("{'value':0.09,'unit':'M'}")).credit()).isEqualTo(0);
        assertThat(QuizGrader.grade(q("{'type':'numerical','answer':6270,'unit':'J','tolerance':{'pct':2}}"), q("{'value':6300,'unit':'J'}")).correct()).isTrue();
        JsonNode blank = q("{'type':'fill_blank','answer':[['acid'],['water']]}");
        assertThat(QuizGrader.grade(blank, q("{'values':[' Acid ','WATER']}")).correct()).isTrue();
        assertThat(QuizGrader.grade(blank, q("{'values':['water','acid']}")).credit()).isEqualTo(0);
        assertThat(QuizGrader.grade(q("{'type':'fill_blank','answer':[['4x^3','4x³']]}"), q("{'values':['4x³']}")).correct()).isTrue();
    }

    @Test
    void everyExperimentHasAQuizCoveringAllNineTypes() {
        assertThat(bank.all()).hasSize(32); // 28 experiments + 4 emergency scenarios
        var types = new java.util.HashSet<String>();
        bank.all().forEach(quiz -> {
            assertThat(quiz.questions().size()).as(quiz.id()).isBetween(5, 7);
            quiz.questions().forEach(x -> types.add(x.path("type").asText()));
        });
        assertThat(types).hasSize(9);
    }

    @Test
    void aSittingLeaksNoAnswersAndIsGradedOnceWithXp() throws Exception {
        Cookie c = guest();
        JsonNode started = json(mvc.perform(post("/v1/quizzes/quiz-acid-base-titration/start").cookie(c).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        JsonNode qs = started.path("spec").path("questions");
        assertThat(qs.size()).isEqualTo(5);
        for (JsonNode x : qs) for (String secret : new String[] {"answer", "explanation", "tolerance", "acceptUnits"}) assertThat(x.has(secret)).as(secret).isFalse();

        // Answer everything correctly from the pool.
        ArrayNode answers = mapper.createArrayNode();
        for (JsonNode served : qs) answers.add(correctAnswer(bank.question("quiz-acid-base-titration", served.path("id").asText()).orElseThrow()));
        String attempt = started.path("quizAttemptId").asText();
        Map<String, Object> body = Map.of("idempotencyKey", "k-" + attempt, "answers", answers);
        JsonNode result = send(c, "/v1/quizzes/attempts/" + attempt + "/submit", body);
        assertThat(result.path("scorePct").asInt()).isEqualTo(100);
        assertThat(result.path("passed").asBoolean()).isTrue();
        assertThat(result.path("xpAwarded").asInt()).isGreaterThan(0);

        // The same submission again returns the same result and awards nothing new.
        JsonNode again = send(c, "/v1/quizzes/attempts/" + attempt + "/submit", body);
        assertThat(again.path("scorePct").asInt()).isEqualTo(100);
        long rows = db.sql("SELECT count(*) FROM xp_transactions WHERE idempotency_key = ?").param("quiz:" + attempt).query(Long.class).single();
        assertThat(rows).isEqualTo(1);
        // A different submission for the same sitting is refused.
        mvc.perform(post("/v1/quizzes/attempts/" + attempt + "/submit").cookie(c).contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("idempotencyKey", "other", "answers", answers)))).andExpect(status().isConflict());
    }

    @Test
    void wrongAnswersLowerMasteryAndDriveRecommendations() throws Exception {
        Cookie c = guest();
        JsonNode started = json(mvc.perform(post("/v1/quizzes/quiz-ohms-law/start").cookie(c).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andReturn().getResponse().getContentAsString());
        String attempt = started.path("quizAttemptId").asText();
        JsonNode result = send(c, "/v1/quizzes/attempts/" + attempt + "/submit", Map.of("idempotencyKey", "w-" + attempt, "answers", mapper.createArrayNode()));
        assertThat(result.path("scorePct").asInt()).isZero();
        assertThat(result.path("revisionConceptIds").size()).isGreaterThan(0);
        JsonNode recs = json(mvc.perform(get("/v1/recommendations").cookie(c)).andReturn().getResponse().getContentAsString());
        assertThat(recs.size()).isGreaterThan(0);
        assertThat(recs.get(0).path("experimentSlug").asText()).isEqualTo("ohms-law");
        // Practice draws questions on those weak concepts.
        JsonNode practice = json(mvc.perform(post("/v1/quizzes/practice/start").cookie(c).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(practice.path("spec").path("questions").size()).isGreaterThan(0);
    }

    @Test
    void draftsOnlyGoLiveAfterReviewAndPassingChecks() throws Exception {
        Cookie admin = admin();
        int before = bank.pool("quiz-ohms-law").size();
        // A numerical draft whose stated answer disagrees with the engine fails its check.
        ObjectNode bad = (ObjectNode) q("{'type':'numerical','prompt':'A 12 V supply drives 2 A. What is R?','conceptIds':['ohms-law'],'unit':'ohm','answer':5,'tolerance':{'abs':0.1},'explanation':'R = V / I = 6 ohm.','check':{'expr':'V/I','inputs':{'V':12,'I':2}}}");
        JsonNode badDraft = send(admin, "/v1/admin/quiz-drafts", Map.of("quizId", "quiz-ohms-law", "question", bad, "source", "ai"));
        assertThat(badDraft.path("checks").toString()).contains("\"name\":\"recomputed\",\"ok\":false");
        mvc.perform(post("/v1/admin/quiz-drafts/" + badDraft.path("id").asText() + "/approve").cookie(admin).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnprocessableEntity());
        assertThat(bank.pool("quiz-ohms-law")).hasSize(before);

        bad.put("answer", 6);
        JsonNode good = send(admin, "/v1/admin/quiz-drafts", Map.of("quizId", "quiz-ohms-law", "question", bad, "source", "ai"));
        assertThat(bank.pool("quiz-ohms-law")).hasSize(before); // still a draft
        send(admin, "/v1/admin/quiz-drafts/" + good.path("id").asText() + "/approve", Map.of("notes", "checked"));
        assertThat(bank.pool("quiz-ohms-law")).hasSize(before + 1);
    }

    /* ------------------------------------------------------------------ helpers */

    private ObjectNode correctAnswer(JsonNode q) {
        ObjectNode a = mapper.createObjectNode();
        a.put("questionId", q.path("id").asText()).put("type", q.path("type").asText());
        switch (q.path("type").asText()) {
            case "multiple_choice", "identify_equipment", "predict_outcome" -> a.set("optionIds", q.path("answer"));
            case "true_false" -> a.put("value", q.path("answer").asBoolean());
            case "match" -> a.set("pairs", q.path("answer"));
            case "label_diagram" -> a.set("placements", q.path("answer"));
            case "arrange_steps" -> a.set("order", q.path("answer"));
            case "numerical" -> a.put("value", q.path("answer").asDouble()).put("unit", q.path("unit").asText());
            case "fill_blank" -> {
                ArrayNode v = a.putArray("values");
                q.path("answer").forEach(alts -> v.add(alts.get(0).asText()));
            }
            default -> { }
        }
        return a;
    }

    private Cookie guest() throws Exception {
        return mvc.perform(post("/v1/auth/guest").contentType(MediaType.APPLICATION_JSON).content("{}")).andReturn().getResponse().getCookie("ls_session");
    }

    private Cookie admin() throws Exception {
        String email = "quiz-admin-" + UUID.randomUUID() + "@labscape.dev";
        Cookie c = mvc.perform(post("/v1/auth/register").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of(
                "email", email, "password", "correct horse battery", "displayName", "Quiz Admin", "ageBand", "18_plus", "parentalConsent", false))))
                .andReturn().getResponse().getCookie("ls_session");
        db.sql("UPDATE users SET role = 'admin' WHERE email = ?").param(email).update();
        // a fresh session picks up the new role
        return mvc.perform(post("/v1/auth/login").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of("email", email, "password", "correct horse battery"))))
                .andReturn().getResponse().getCookie("ls_session");
    }

    private JsonNode send(Cookie c, String path, Object body) throws Exception {
        return json(mvc.perform(post(path).cookie(c).contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    private JsonNode json(String s) throws Exception {
        return mapper.readTree(s);
    }
}
