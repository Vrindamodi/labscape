package com.labscape.api.core.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import jakarta.servlet.http.Cookie;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Razorpay Subscriptions end to end against a local stub of the Razorpay API (a JDK HttpServer; no
 * network): checkout, Checkout-signature verification, signed webhooks over raw bytes, idempotency,
 * every lifecycle event, and cancel at period end.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RazorpayBillingTest {

    static final String KEY_ID = "rzp_test_abc123";
    static final String KEY_SECRET = "test_key_secret";
    static final String WEBHOOK_SECRET = "rzp-webhook-secret";

    record Recorded(String method, String path, String authorization, String body) {}

    static final List<Recorded> REQUESTS = new CopyOnWriteArrayList<>();
    static final AtomicInteger SEQ = new AtomicInteger();
    static volatile int failStatus = 0;
    static HttpServer stub;

    @DynamicPropertySource
    static void razorpay(DynamicPropertyRegistry r) throws IOException {
        if (stub == null) {
            stub = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            stub.createContext("/v1/", ex -> {
                String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                String path = ex.getRequestURI().getPath();
                REQUESTS.add(new Recorded(ex.getRequestMethod(), path, ex.getRequestHeaders().getFirst("Authorization"), body));
                int code;
                String out;
                if (failStatus != 0) {
                    code = failStatus;
                    out = "{\"error\":{\"code\":\"BAD_REQUEST_ERROR\",\"description\":\"The plan id provided does not exist\"}}";
                } else if (path.equals("/v1/subscriptions")) {
                    code = 200;
                    out = "{\"id\":\"sub_TEST" + SEQ.incrementAndGet() + "\",\"entity\":\"subscription\",\"status\":\"created\"}";
                } else if (path.matches("/v1/subscriptions/sub_\\w+/cancel")) {
                    code = 200;
                    out = "{\"id\":\"" + path.split("/")[3] + "\",\"entity\":\"subscription\",\"status\":\"active\"}";
                } else {
                    code = 404;
                    out = "{\"error\":{\"code\":\"BAD_REQUEST_ERROR\",\"description\":\"not found\"}}";
                }
                byte[] bytes = out.getBytes(StandardCharsets.UTF_8);
                ex.getResponseHeaders().add("Content-Type", "application/json");
                ex.sendResponseHeaders(code, bytes.length);
                ex.getResponseBody().write(bytes);
                ex.close();
            });
            stub.start();
        }
        r.add("labscape.billing.mode", () -> "razorpay");
        r.add("labscape.billing.razorpay-key-id", () -> KEY_ID);
        r.add("labscape.billing.razorpay-key-secret", () -> KEY_SECRET);
        r.add("labscape.billing.webhook-secret", () -> WEBHOOK_SECRET);
        r.add("labscape.billing.razorpay-plans.premium_monthly", () -> "plan_MONTHLYtest");
        r.add("labscape.billing.razorpay-plans.premium_annual", () -> "plan_ANNUALtest");
        r.add("labscape.billing.razorpay-base-url", () -> "http://127.0.0.1:" + stub.getAddress().getPort() + "/v1");
    }

    @AfterAll
    static void stopStub() {
        if (stub != null) stub.stop(0);
        stub = null;
    }

    @AfterEach
    void reset() {
        failStatus = 0;
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcClient db;

    record Account(Cookie cookie, String id, String email) {}

    // ------------------------------------------------------------------ checkout

    @Test
    void checkoutCreatesARazorpaySubscription() throws Exception {
        Account a = account();
        JsonNode co = checkout(a, "premium_monthly").andExpect(status().isOk()).andReturn().json();
        String sub = co.get("subscriptionId").asText();
        assertThat(sub).startsWith("sub_TEST");
        assertThat(co.get("mode").asText()).isEqualTo("razorpay");
        assertThat(co.get("razorpayKeyId").asText()).isEqualTo(KEY_ID);
        assertThat(co.get("amountPaise").asInt()).isEqualTo(14_900);
        assertThat(co.get("currency").asText()).isEqualTo("INR");
        assertThat(co.get("prefill").get("email").asText()).isEqualTo(a.email());
        assertThat(co.get("prefill").get("name").asText()).isEqualTo("Razor Payer");

        Recorded req = REQUESTS.stream().filter(r -> r.path().equals("/v1/subscriptions") && r.body().contains(a.id()))
                .findFirst().orElseThrow();
        assertThat(req.method()).isEqualTo("POST");
        assertThat(req.authorization()).isEqualTo("Basic "
                + Base64.getEncoder().encodeToString((KEY_ID + ":" + KEY_SECRET).getBytes(StandardCharsets.UTF_8)));
        JsonNode body = mapper.readTree(req.body());
        assertThat(body.get("plan_id").asText()).isEqualTo("plan_MONTHLYtest");
        assertThat(body.get("total_count").asInt()).isEqualTo(120);
        assertThat(body.get("customer_notify").asInt()).isEqualTo(1);
        assertThat(body.get("notes").get("labscape_user_id").asText()).isEqualTo(a.id());
        assertThat(body.get("notes").get("labscape_plan").asText()).isEqualTo("premium_monthly");

        assertThat(subStatus(sub)).isEqualTo("pending");
        assertThat(entitlements(a).get("plan").asText()).isEqualTo("free");
    }

    @Test
    void annualCheckoutUsesTheAnnualPlan() throws Exception {
        Account a = account();
        checkout(a, "premium_annual").andExpect(status().isOk()).andExpect(jsonPath("$.amountPaise").value(99_900));
        JsonNode body = mapper.readTree(REQUESTS.stream()
                .filter(r -> r.path().equals("/v1/subscriptions") && r.body().contains(a.id())).findFirst().orElseThrow().body());
        assertThat(body.get("plan_id").asText()).isEqualTo("plan_ANNUALtest");
        assertThat(body.get("total_count").asInt()).isEqualTo(10);
    }

    @Test
    void providerErrorsBecomeClearProblems() throws Exception {
        Account a = account();
        failStatus = 400;
        checkout(a, "premium_monthly").andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("PAYMENT_PROVIDER_REJECTED"));
        failStatus = 500;
        checkout(a, "premium_monthly").andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("PAYMENT_PROVIDER_UNAVAILABLE"));
        failStatus = 401;
        checkout(a, "premium_monthly").andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("PAYMENT_PROVIDER_AUTH"));
        assertThat(db.sql("SELECT count(*) FROM subscriptions WHERE user_id = ?").param(UUID.fromString(a.id()))
                .query(Long.class).single()).isZero();
    }

    @Test
    void guestsAndUnknownPlansCannotCheckOut() throws Exception {
        Cookie g = guest();
        mvc.perform(json(post("/v1/billing/checkout"), g, "{\"plan\":\"premium_monthly\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCOUNT_REQUIRED"));
        checkout(account(), "free").andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("PLAN_INVALID"));
    }

    @Test
    void secondSubscriptionWhilePremiumIsRefused() throws Exception {
        Account a = account();
        String sub = newSubscription(a);
        webhook("subscription.activated", sub, null, end(30), "active");
        checkout(a, "premium_annual").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ALREADY_SUBSCRIBED"));
    }

    @Test
    void sandboxPaymentsAreOffInRazorpayMode() throws Exception {
        Account a = account();
        String sub = newSubscription(a);
        mvc.perform(json(post("/v1/billing/sandbox/pay"), a.cookie(), "{\"subscriptionId\":\"" + sub + "\",\"succeed\":true}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("SANDBOX_ONLY"));
        mvc.perform(get("/v1/billing/plans")).andExpect(jsonPath("$.mode").value("razorpay"));
    }

    // ------------------------------------------------------------------ verify (Checkout handler)

    @Test
    void verifyAcceptsAValidCheckoutSignature() throws Exception {
        Account a = account();
        String sub = newSubscription(a);
        String sig = Billing.hmacHex(KEY_SECRET, ("pay_OK1|" + sub).getBytes(StandardCharsets.UTF_8));
        mvc.perform(json(post("/v1/billing/verify"), a.cookie(), "{\"razorpay_payment_id\":\"pay_OK1\",\"razorpay_subscription_id\":\""
                        + sub + "\",\"razorpay_signature\":\"" + sig + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.plan").value("premium_monthly"))
                .andExpect(jsonPath("$.status").value("active"));
        assertThat(subStatus(sub)).isEqualTo("active");
        // Optimistic only: the invoice is written by the subscription.charged webhook.
        mvc.perform(get("/v1/billing/invoices").cookie(a.cookie())).andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void verifyRejectsTamperedOrWronglySignedPayments() throws Exception {
        Account a = account();
        String sub = newSubscription(a);
        String good = Billing.hmacHex(KEY_SECRET, ("pay_OK2|" + sub).getBytes(StandardCharsets.UTF_8));
        // Tampered: the signature is for a different payment id.
        verify(a, "pay_OTHER", sub, good).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PAYMENT_SIGNATURE_INVALID"));
        // Signed with the wrong secret.
        String wrong = Billing.hmacHex("not-the-secret", ("pay_OK2|" + sub).getBytes(StandardCharsets.UTF_8));
        verify(a, "pay_OK2", sub, wrong).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PAYMENT_SIGNATURE_INVALID"));
        verify(a, "pay_OK2", sub, "").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PAYMENT_DETAILS_MISSING"));
        assertThat(subStatus(sub)).isEqualTo("pending");
        assertThat(entitlements(a).get("plan").asText()).isEqualTo("free");

        // Someone else's checkout, even correctly signed.
        verify(account(), "pay_OK2", sub, good).andExpect(status().isForbidden());
        verify(a, "pay_OK2", "sub_UNKNOWN", good).andExpect(status().isNotFound());
        mvc.perform(post("/v1/billing/verify").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
    }

    // ------------------------------------------------------------------ webhook signature + idempotency

    @Test
    void webhookSignatureIsCheckedOverTheRawBytes() throws Exception {
        Account a = account();
        String sub = newSubscription(a);
        // Odd spacing and non-ASCII: any re-serialisation would break the signature.
        String body = "{ \"entity\":\"event\",  \"event\":\"subscription.authenticated\",\n \"payload\":{\"subscription\":{\"entity\":{\"id\":\""
                + sub + "\",\"status\":\"authenticated\",\"notes\":{\"memo\":\"₹ café\"}}}}}";
        byte[] raw = body.getBytes(StandardCharsets.UTF_8);
        String sig = Billing.hmacHex(WEBHOOK_SECRET, raw);

        // Tampered body, wrong secret, missing header: all refused, nothing recorded.
        postWebhook(body + " ", sig, "evt_raw_1").andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("SIGNATURE_INVALID"));
        postWebhook(body, Billing.hmacHex("wrong-secret", raw), "evt_raw_1").andExpect(status().isUnauthorized());
        postWebhook(body, null, "evt_raw_1").andExpect(status().isUnauthorized());
        assertThat(subStatus(sub)).isEqualTo("pending");

        // Valid, from a foreign origin with no session: webhooks bypass auth and the origin guard.
        mvc.perform(post("/v1/billing/webhook").header("Origin", "https://api.razorpay.com")
                        .header("X-Razorpay-Signature", sig).header("X-Razorpay-Event-Id", "evt_raw_1")
                        .contentType(MediaType.APPLICATION_JSON).content(raw))
                .andExpect(status().isOk()).andExpect(jsonPath("$.applied").value(true));
        assertThat(subStatus(sub)).isEqualTo("authenticated");
    }

    @Test
    void replayedWebhooksAreAppliedOnce() throws Exception {
        Account a = account();
        String sub = newSubscription(a);
        String body = event("subscription.charged", sub, "pay_IDEM1", end(30), "active");
        String sig = Billing.hmacHex(WEBHOOK_SECRET, body.getBytes(StandardCharsets.UTF_8));
        postWebhook(body, sig, "evt_idem_1").andExpect(jsonPath("$.applied").value(true));
        String periodEnd = entitlements(a).get("currentPeriodEnd").asText();
        postWebhook(body, sig, "evt_idem_1").andExpect(status().isOk()).andExpect(jsonPath("$.applied").value(false));
        // A redelivery under a new event id still cannot double-invoice the same payment.
        postWebhook(body, sig, "evt_idem_2").andExpect(jsonPath("$.applied").value(true));
        assertThat(entitlements(a).get("currentPeriodEnd").asText()).isEqualTo(periodEnd);
        mvc.perform(get("/v1/billing/invoices").cookie(a.cookie())).andExpect(jsonPath("$.length()").value(1));
    }

    // ------------------------------------------------------------------ lifecycle

    @Test
    void fullLifecycleFollowsTheWebhooks() throws Exception {
        Account a = account();
        String sub = newSubscription(a);

        webhook("subscription.authenticated", sub, null, null, "authenticated");
        assertThat(subStatus(sub)).isEqualTo("authenticated");
        assertThat(entitlements(a).get("plan").asText()).isEqualTo("free");

        long end1 = end(30);
        webhook("subscription.activated", sub, null, end1, "active");
        JsonNode e = entitlements(a);
        assertThat(e.get("plan").asText()).isEqualTo("premium_monthly");
        assertThat(e.get("status").asText()).isEqualTo("active");
        assertThat(Instant.parse(e.get("currentPeriodEnd").asText()).getEpochSecond()).isEqualTo(end1);
        mvc.perform(get("/v1/billing/invoices").cookie(a.cookie())).andExpect(jsonPath("$.length()").value(0));

        webhook("subscription.charged", sub, "pay_LC1", end1, "active");
        mvc.perform(get("/v1/billing/invoices").cookie(a.cookie()))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].amountPaise").value(14_900))
                .andExpect(jsonPath("$[0].gstPaise").value(2273));

        // Renewal fails: Razorpay retries (pending) and Premium stays on in grace.
        webhook("subscription.pending", sub, null, end1, "pending");
        assertThat(entitlements(a).get("status").asText()).isEqualTo("grace");
        assertThat(entitlements(a).get("plan").asText()).isEqualTo("premium_monthly");

        long end2 = end(60);
        webhook("subscription.charged", sub, "pay_LC2", end2, "active");
        e = entitlements(a);
        assertThat(e.get("status").asText()).isEqualTo("active");
        assertThat(Instant.parse(e.get("currentPeriodEnd").asText()).getEpochSecond()).isEqualTo(end2);
        mvc.perform(get("/v1/billing/invoices").cookie(a.cookie())).andExpect(jsonPath("$.length()").value(2));

        // Retries exhausted: halted switches Premium off ...
        webhook("subscription.halted", sub, null, end2, "halted");
        assertThat(subStatus(sub)).isEqualTo("halted");
        assertThat(entitlements(a).get("plan").asText()).isEqualTo("free");

        // ... until a later charge succeeds.
        long end3 = end(30);
        webhook("subscription.charged", sub, "pay_LC3", end3, "active");
        assertThat(entitlements(a).get("plan").asText()).isEqualTo("premium_monthly");

        // Cancelled: no renewal, but what was paid for stays on until the period ends.
        webhook("subscription.cancelled", sub, null, end3, "cancelled");
        e = entitlements(a);
        assertThat(e.get("status").asText()).isEqualTo("cancelled");
        assertThat(e.get("plan").asText()).isEqualTo("premium_monthly");
        assertThat(e.get("cancelAtPeriodEnd").asBoolean()).isTrue();
        assertThat(db.sql("SELECT provider_status FROM subscriptions WHERE provider_ref = ?").param(sub)
                .query(String.class).single()).isEqualTo("cancelled");
    }

    @Test
    void completedSubscriptionsStopRenewing() throws Exception {
        Account a = account();
        String sub = newSubscription(a);
        webhook("subscription.charged", sub, "pay_CMP1", end(30), "active");
        webhook("subscription.completed", sub, null, end(30), "completed");
        JsonNode e = entitlements(a);
        assertThat(e.get("status").asText()).isEqualTo("cancelled");
        assertThat(e.get("cancelAtPeriodEnd").asBoolean()).isTrue();
        assertThat(e.get("plan").asText()).isEqualTo("premium_monthly");
    }

    @Test
    void paymentFailedStartsGraceOnlyForRenewals() throws Exception {
        Account a = account();
        String sub = newSubscription(a);
        // First purchase failing changes nothing (still pending, still free).
        paymentFailed(sub, "pay_F1", "evt_pf_1");
        assertThat(subStatus(sub)).isEqualTo("pending");

        webhook("subscription.charged", sub, "pay_F2", end(1), "active");
        paymentFailed(sub, "pay_F3", "evt_pf_2");
        JsonNode e = entitlements(a);
        assertThat(e.get("status").asText()).isEqualTo("grace");
        assertThat(Instant.parse(e.get("currentPeriodEnd").asText())).isAfter(Instant.now().plus(2, ChronoUnit.DAYS));
    }

    // ------------------------------------------------------------------ cancel

    @Test
    void cancelGoesThroughRazorpayAtCycleEnd() throws Exception {
        Account a = account();
        String sub = newSubscription(a);
        webhook("subscription.activated", sub, null, end(30), "active");

        mvc.perform(json(post("/v1/billing/subscription/cancel"), a.cookie(), "{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cancelAtPeriodEnd").value(true))
                .andExpect(jsonPath("$.plan").value("premium_monthly"));
        Recorded req = REQUESTS.stream().filter(r -> r.path().equals("/v1/subscriptions/" + sub + "/cancel"))
                .findFirst().orElseThrow();
        assertThat(req.method()).isEqualTo("POST");
        assertThat(mapper.readTree(req.body()).get("cancel_at_cycle_end").asInt()).isEqualTo(1);

        mvc.perform(json(post("/v1/billing/subscription/resume"), a.cookie(), "{}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("RESUME_NOT_SUPPORTED"));
        mvc.perform(json(post("/v1/billing/subscription/cancel"), a.cookie(), "{}"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NO_SUBSCRIPTION"));
    }

    @Test
    void failedProviderCancelChangesNothing() throws Exception {
        Account a = account();
        String sub = newSubscription(a);
        webhook("subscription.activated", sub, null, end(30), "active");
        failStatus = 400;
        mvc.perform(json(post("/v1/billing/subscription/cancel"), a.cookie(), "{}"))
                .andExpect(status().isBadGateway());
        assertThat(entitlements(a).get("cancelAtPeriodEnd").asBoolean()).isFalse();
    }

    // ------------------------------------------------------------------ startup validation

    @Test
    void razorpayModeFailsFastWithoutKeysOrPlans() {
        Map<String, String> plans = Map.of("premium_monthly", "plan_A", "premium_annual", "plan_B");
        Billing.validateConfig("sandbox", "", "", "dev-webhook-secret", Map.of("premium_monthly", ""));
        Billing.validateConfig("razorpay", KEY_ID, KEY_SECRET, WEBHOOK_SECRET, plans);
        assertThatThrownBy(() -> Billing.validateConfig("razorpay", "", "", "dev-webhook-secret",
                Map.of("premium_monthly", "", "premium_annual", "")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("RAZORPAY_KEY_ID")
                .hasMessageContaining("RAZORPAY_KEY_SECRET")
                .hasMessageContaining("RAZORPAY_WEBHOOK_SECRET")
                .hasMessageContaining("RAZORPAY_PLAN_PREMIUM_MONTHLY")
                .hasMessageContaining("RAZORPAY_PLAN_PREMIUM_ANNUAL");
        assertThatThrownBy(() -> Billing.validateConfig("razorpay", KEY_ID, KEY_SECRET, WEBHOOK_SECRET,
                Map.of("premium_monthly", "plan_A", "premium_annual", "")))
                .hasMessageContaining("RAZORPAY_PLAN_PREMIUM_ANNUAL")
                .satisfies(t -> assertThat(t.getMessage()).doesNotContain(KEY_SECRET));
        assertThatThrownBy(() -> Billing.validateConfig("stripe", KEY_ID, KEY_SECRET, WEBHOOK_SECRET, plans))
                .hasMessageContaining("sandbox' or 'razorpay");
    }

    @Test
    void signatureComparisonIsExact() {
        String sig = Billing.hmacHex("s", "body".getBytes(StandardCharsets.UTF_8));
        assertThat(Billing.constantTimeEquals(sig, sig)).isTrue();
        assertThat(Billing.constantTimeEquals(sig, sig.toUpperCase())).isTrue();
        assertThat(Billing.constantTimeEquals(sig, sig.substring(1))).isFalse();
        assertThat(Billing.constantTimeEquals(sig, null)).isFalse();
        assertThat(Billing.constantTimeEquals(sig, Billing.hmacHex("t", "body".getBytes(StandardCharsets.UTF_8)))).isFalse();
    }

    // ------------------------------------------------------------------ helpers

    Cookie guest() throws Exception {
        return mvc.perform(post("/v1/auth/guest").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie("ls_session");
    }

    Account account() throws Exception {
        String email = "rzp" + UUID.randomUUID().toString().substring(0, 8) + "@test.dev";
        var res = mvc.perform(json(post("/v1/auth/register"), guest(), "{\"email\":\"" + email
                        + "\",\"password\":\"longenough\",\"displayName\":\"Razor Payer\",\"ageBand\":\"18_plus\"}"))
                .andExpect(status().isOk()).andReturn().getResponse();
        return new Account(res.getCookie("ls_session"), mapper.readTree(res.getContentAsString()).get("id").asText(), email);
    }

    MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder b, Cookie c, String body) {
        return b.cookie(c).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    interface Json {
        JsonNode json() throws Exception;
    }

    CheckoutCall checkout(Account a, String plan) throws Exception {
        return new CheckoutCall(mvc.perform(json(post("/v1/billing/checkout"), a.cookie(), "{\"plan\":\"" + plan + "\"}")), mapper);
    }

    record CheckoutCall(ResultActions actions, ObjectMapper mapper) {
        CheckoutCall andExpect(org.springframework.test.web.servlet.ResultMatcher m) throws Exception {
            actions.andExpect(m);
            return this;
        }

        Json andReturn() {
            return () -> mapper.readTree(actions.andReturn().getResponse().getContentAsString());
        }
    }

    String newSubscription(Account a) throws Exception {
        return checkout(a, "premium_monthly").andExpect(status().isOk()).andReturn().json().get("subscriptionId").asText();
    }

    ResultActions verify(Account a, String payment, String sub, String sig) throws Exception {
        return mvc.perform(json(post("/v1/billing/verify"), a.cookie(), mapper.writeValueAsString(Map.of(
                "razorpayPaymentId", payment, "razorpaySubscriptionId", sub, "razorpaySignature", sig))));
    }

    JsonNode entitlements(Account a) throws Exception {
        return mapper.readTree(mvc.perform(get("/v1/entitlements").cookie(a.cookie())).andReturn().getResponse().getContentAsString());
    }

    String subStatus(String providerRef) {
        return db.sql("SELECT status FROM subscriptions WHERE provider_ref = ?").param(providerRef).query(String.class).single();
    }

    static long end(int days) {
        return Instant.now().plus(days, ChronoUnit.DAYS).getEpochSecond();
    }

    /** A webhook body shaped like Razorpay's (entity wrappers, no top-level id). */
    String event(String type, String sub, String paymentId, Long currentEnd, String subStatus) throws Exception {
        Map<String, Object> subEntity = new java.util.LinkedHashMap<>();
        subEntity.put("id", sub);
        subEntity.put("entity", "subscription");
        subEntity.put("plan_id", "plan_MONTHLYtest");
        subEntity.put("status", subStatus);
        if (currentEnd != null) subEntity.put("current_end", currentEnd);
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("subscription", Map.of("entity", subEntity));
        if (paymentId != null) {
            payload.put("payment", Map.of("entity", Map.of("id", paymentId, "entity", "payment", "amount", 14_900,
                    "currency", "INR", "status", "captured")));
        }
        return mapper.writeValueAsString(Map.of("entity", "event", "account_id", "acc_test", "event", type,
                "contains", paymentId == null ? List.of("subscription") : List.of("subscription", "payment"),
                "payload", payload, "created_at", Instant.now().getEpochSecond()));
    }

    void webhook(String type, String sub, String paymentId, Long currentEnd, String subStatus) throws Exception {
        String body = event(type, sub, paymentId, currentEnd, subStatus);
        postWebhook(body, Billing.hmacHex(WEBHOOK_SECRET, body.getBytes(StandardCharsets.UTF_8)),
                "evt_" + UUID.randomUUID().toString().replace("-", "").substring(0, 14))
                .andExpect(status().isOk()).andExpect(jsonPath("$.applied").value(true));
    }

    void paymentFailed(String sub, String paymentId, String eventId) throws Exception {
        String body = mapper.writeValueAsString(Map.of("entity", "event", "event", "payment.failed", "contains", List.of("payment"),
                "payload", Map.of("payment", Map.of("entity", Map.of("id", paymentId, "entity", "payment",
                        "amount", 14_900, "status", "failed", "subscription_id", sub)))));
        postWebhook(body, Billing.hmacHex(WEBHOOK_SECRET, body.getBytes(StandardCharsets.UTF_8)), eventId)
                .andExpect(status().isOk());
    }

    ResultActions postWebhook(String body, String signature, String eventId) throws Exception {
        MockHttpServletRequestBuilder b = post("/v1/billing/webhook").contentType(MediaType.APPLICATION_JSON)
                .content(body.getBytes(StandardCharsets.UTF_8)).header("X-Razorpay-Event-Id", eventId);
        if (signature != null) b = b.header("X-Razorpay-Signature", signature);
        return mvc.perform(b);
    }
}
