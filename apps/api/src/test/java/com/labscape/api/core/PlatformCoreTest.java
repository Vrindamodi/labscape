package com.labscape.api.core;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Part 1 "done when" checks (build plan 1.14) against a real embedded Postgres:
 * guest merge keeps XP, duplicate ProgressEvents award once, replayed webhooks change nothing.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = "labscape.features.experiments=true")
class PlatformCoreTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    Cookie guest() throws Exception {
        MvcResult r = mvc.perform(post("/v1/auth/guest").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.guest").value(true)).andReturn();
        return r.getResponse().getCookie("ls_session");
    }

    MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder b, Cookie c, String body) {
        return b.cookie(c).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    JsonNode award(Cookie c, String key, String kind, String ref, Integer score) throws Exception {
        String body = "{\"idempotencyKey\":\"" + key + "\",\"kind\":\"" + kind + "\",\"refId\":\"" + ref + "\""
                + (score == null ? "" : ",\"score\":" + score) + "}";
        return mapper.readTree(mvc.perform(json(post("/v1/progress/events"), c, body))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    @Test
    void sameEventTwiceAwardsOnce() throws Exception {
        Cookie c = guest();
        JsonNode first = award(c, "dup-1", "playground.discovery", "acid-metal", null);
        JsonNode again = award(c, "dup-1", "playground.discovery", "acid-metal", null);
        assertThat(first.get("duplicate").asBoolean()).isFalse();
        assertThat(first.get("xpAwarded").asInt()).isGreaterThanOrEqualTo(20);
        assertThat(again.get("duplicate").asBoolean()).isTrue();
        assertThat(again.get("xpAwarded").asInt()).isZero();
        assertThat(again.get("totalXp").asLong()).isEqualTo(first.get("totalXp").asLong());
    }

    @Test
    void experimentRepeatRules() throws Exception {
        Cookie c = guest();
        // xpAwarded can include a daily challenge this event completes, so check the rule's own adjustment.
        JsonNode first = award(c, "e1", "experiment.completed", "phys-pendulum", 80);
        assertThat(first.get("xpAwarded").asInt()).isGreaterThanOrEqualTo(100);
        assertThat(first.get("adjustments")).isEmpty();
        JsonNode second = award(c, "e2", "experiment.completed", "phys-pendulum", 90);
        assertThat(second.get("adjustments").toString()).contains("REPEAT_25_PERCENT").contains("-75");
        JsonNode third = award(c, "e3", "experiment.completed", "phys-pendulum", 95);
        assertThat(third.get("adjustments").toString()).contains("REPEAT_NO_XP");
        assertThat(first.get("badgesUnlocked").toString()).contains("first_experiment");
        assertThat(second.get("badgesUnlocked")).isEmpty();
    }

    @Test
    void guestProgressSurvivesSignUpAndSignIn() throws Exception {
        // Sign-up from a guest session upgrades it in place.
        Cookie g = guest();
        award(g, "g1", "onboarding.completed", "onboarding", null);
        long xp = award(g, "g2", "playground.discovery", "neutralisation", null).get("totalXp").asLong();
        String email = "u" + UUID.randomUUID().toString().substring(0, 8) + "@test.dev";
        mvc.perform(json(post("/v1/auth/register"), g, "{\"email\":\"" + email
                        + "\",\"password\":\"longenough\",\"displayName\":\"Test User\",\"ageBand\":\"18_plus\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.guest").value(false))
                .andExpect(jsonPath("$.totalXp").value(xp));

        // A second guest signing in to that account merges into it.
        Cookie g2 = guest();
        long extra = award(g2, "h1", "playground.discovery", "acid-carbonate", null).get("totalXp").asLong();
        mvc.perform(json(post("/v1/auth/login"), g2, "{\"email\":\"" + email + "\",\"password\":\"longenough\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalXp").value(xp + extra));
    }

    @Test
    void minorsNeedParentalConsent() throws Exception {
        Cookie g = guest();
        mvc.perform(json(post("/v1/auth/register"), g,
                        "{\"email\":\"kid@test.dev\",\"password\":\"longenough\",\"displayName\":\"Kid\",\"ageBand\":\"13_17\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PARENTAL_CONSENT_REQUIRED"));
    }

    @Test
    void replayedWebhookChangesNothing() throws Exception {
        Cookie g = guest();
        String email = "p" + UUID.randomUUID().toString().substring(0, 8) + "@test.dev";
        Cookie acct = mvc.perform(json(post("/v1/auth/register"), g, "{\"email\":\"" + email
                        + "\",\"password\":\"longenough\",\"displayName\":\"Payer\",\"ageBand\":\"18_plus\"}"))
                .andReturn().getResponse().getCookie("ls_session");
        String sub = mapper.readTree(mvc.perform(json(post("/v1/billing/checkout"), acct, "{\"plan\":\"premium_monthly\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).get("subscriptionId").asText();

        String body = "{\"id\":\"evt_test_1\",\"event\":\"subscription.charged\",\"payload\":{\"subscription\":{\"id\":\"" + sub
                + "\"},\"payment\":{\"id\":\"pay_test_1\"}}}";
        String sig = hmac(body);
        mvc.perform(post("/v1/billing/webhook").header("X-Razorpay-Signature", sig).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(jsonPath("$.applied").value(true));
        String end1 = periodEnd(acct);
        mvc.perform(post("/v1/billing/webhook").header("X-Razorpay-Signature", sig).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(jsonPath("$.applied").value(false));
        assertThat(periodEnd(acct)).isEqualTo(end1);
        mvc.perform(get("/v1/billing/invoices").cookie(acct)).andExpect(jsonPath("$.length()").value(1));

        mvc.perform(post("/v1/billing/webhook").header("X-Razorpay-Signature", "bad").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void protectedEndpointsNeedASession() throws Exception {
        mvc.perform(get("/v1/me")).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("AUTH_REQUIRED"));
        mvc.perform(get("/v1/admin/stats").cookie(guest())).andExpect(status().isForbidden());
        mvc.perform(get("/v1/library/experiments")).andExpect(status().isOk());
    }

    @Test
    void librarySearchHandlesSynonymsAndTypos() throws Exception {
        mvc.perform(get("/v1/library/experiments").param("q", "neutralization"))
                .andExpect(jsonPath("$.items[0].slug").value("acid-base-titration"));
        mvc.perform(get("/v1/library/experiments").param("q", "pendlum"))
                .andExpect(jsonPath("$.items[0].slug").value("simple-pendulum"));
    }

    private String periodEnd(Cookie c) throws Exception {
        return mapper.readTree(mvc.perform(get("/v1/entitlements").cookie(c)).andReturn().getResponse().getContentAsString())
                .get("currentPeriodEnd").asText();
    }

    private static String hmac(String body) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec("test-webhook-secret".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return java.util.HexFormat.of().formatHex(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
    }
}
