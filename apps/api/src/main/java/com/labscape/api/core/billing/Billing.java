package com.labscape.api.core.billing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labscape.api.common.ApiProblem;
import com.labscape.api.core.notifications.Notifications;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Plans, checkout and the subscription lifecycle (build plan 1.7).
 *
 * <p>Every state change goes through {@link #handleWebhook}: in Razorpay mode the provider calls it
 * with a signed payload; in sandbox mode the test sheet's "Pay" button builds the same signed event.
 * Each event id is processed once, so replayed webhooks change nothing. The Checkout handler's
 * {@link #verifyPayment} only grants Premium optimistically; the webhook stays the source of truth.
 */
@Service
public class Billing {

    private static final Logger log = LoggerFactory.getLogger(Billing.class);
    static final String DEV_WEBHOOK_SECRET = "dev-webhook-secret";

    public record Plan(String id, String name, int pricePaise, String interval, List<String> features,
            Integer savePaise, boolean highlighted) {}

    public record Prefill(String name, String email) {}

    public record Checkout(String checkoutId, String subscriptionId, String mode, String plan, int amountPaise,
            String razorpayKeyId, String currency, String description, Prefill prefill) {}

    public record Invoice(String id, String invoiceNumber, int amountPaise, int gstPaise, String currency,
            String status, Instant createdAt, String plan) {}

    public static final List<Plan> PLANS = List.of(
            new Plan("free", "Free", 0, "forever", List.of(
                    "Every experiment in the library",
                    "Unlimited playground sessions",
                    "AI assistant: 10 messages a day",
                    "Every emergency scenario",
                    "Basic progress tracking"), null, false),
            new Plan("premium_monthly", "Premium Monthly", 14_900, "month", List.of(
                    "No ads, ever",
                    "The full experiment library",
                    "Unlimited playground sessions",
                    "Every emergency scenario",
                    "AI assistant: 200 messages a day",
                    "Detailed analytics and report export",
                    "Exclusive themes and equipment skins"), null, false),
            new Plan("premium_annual", "Premium Annual", 99_900, "year", List.of(
                    "Everything in Monthly",
                    "Two extra challenge packs each month",
                    "Priority access to new labs"), 12 * 14_900 - 99_900, true));

    /** Paid plans and how many billing cycles a Razorpay subscription is created for (about 10 years). */
    static final Map<String, Integer> TOTAL_COUNT = Map.of("premium_monthly", 120, "premium_annual", 10);

    private final JdbcClient db;
    private final ObjectMapper mapper;
    private final Notifications notifications;
    private final RazorpayClient razorpay;
    private final String mode;
    private final String keyId;
    private final String keySecret;
    private final String webhookSecret;
    private final Map<String, String> razorpayPlans;

    public Billing(JdbcClient db, ObjectMapper mapper, Notifications notifications, RazorpayClient razorpay,
            Environment env,
            @Value("${labscape.billing.mode}") String mode,
            @Value("${labscape.billing.razorpay-key-id:}") String keyId,
            @Value("${labscape.billing.razorpay-key-secret:}") String keySecret,
            @Value("${labscape.billing.webhook-secret}") String webhookSecret) {
        this.db = db;
        this.mapper = mapper;
        this.notifications = notifications;
        this.razorpay = razorpay;
        this.mode = mode == null ? "" : mode.trim().toLowerCase(Locale.ROOT);
        this.keyId = keyId == null ? "" : keyId.trim();
        this.keySecret = keySecret == null ? "" : keySecret.trim();
        this.webhookSecret = webhookSecret == null ? "" : webhookSecret;
        Map<String, String> plans = new LinkedHashMap<>();
        for (String planId : TOTAL_COUNT.keySet()) {
            plans.put(planId, env.getProperty("labscape.billing.razorpay-plans." + planId, "").trim());
        }
        this.razorpayPlans = Map.copyOf(plans);
        validateConfig(this.mode, this.keyId, this.keySecret, this.webhookSecret, this.razorpayPlans);
        if (razorpayMode()) {
            log.info("Billing: Razorpay mode ({} keys)", this.keyId.startsWith("rzp_live_") ? "live" : "test");
        }
    }

    /** Fails startup with a clear message when Razorpay mode is missing keys, secrets or plan ids. */
    static void validateConfig(String mode, String keyId, String keySecret, String webhookSecret,
            Map<String, String> plans) {
        if (mode.equals("sandbox")) return;
        if (!mode.equals("razorpay")) {
            throw new IllegalStateException("labscape.billing.mode must be 'sandbox' or 'razorpay' (BILLING_MODE), got '"
                    + mode + "'");
        }
        List<String> missing = new ArrayList<>();
        if (keyId.isBlank()) missing.add("RAZORPAY_KEY_ID");
        else if (!keyId.startsWith("rzp_")) missing.add("RAZORPAY_KEY_ID (must start with rzp_test_ or rzp_live_)");
        if (keySecret.isBlank()) missing.add("RAZORPAY_KEY_SECRET");
        if (webhookSecret.isBlank() || webhookSecret.equals(DEV_WEBHOOK_SECRET)) {
            missing.add("RAZORPAY_WEBHOOK_SECRET (the secret set on the dashboard webhook)");
        }
        plans.forEach((planId, rzpPlan) -> {
            if (rzpPlan == null || rzpPlan.isBlank()) {
                missing.add("RAZORPAY_PLAN_" + planId.toUpperCase(Locale.ROOT)
                        + " (labscape.billing.razorpay-plans." + planId + ")");
            } else if (!rzpPlan.startsWith("plan_")) {
                missing.add("RAZORPAY_PLAN_" + planId.toUpperCase(Locale.ROOT) + " (must be a plan_... id)");
            }
        });
        if (!missing.isEmpty()) {
            throw new IllegalStateException("Billing is in razorpay mode but these settings are missing or invalid: "
                    + String.join(", ", missing) + ". Set them, or use BILLING_MODE=sandbox. See docs/payments.md.");
        }
    }

    public String mode() {
        return mode;
    }

    private boolean razorpayMode() {
        return mode.equals("razorpay");
    }

    private static Plan paidPlan(String planId) {
        return PLANS.stream().filter(p -> p.id().equals(planId) && p.pricePaise() > 0).findFirst()
                .orElseThrow(() -> ApiProblem.badRequest("PLAN_INVALID", "Choose Monthly or Annual."));
    }

    /**
     * Starts a checkout. Not transactional on purpose: the Razorpay call must not hold a database
     * connection, and a subscription created at Razorpay but never paid simply expires there.
     */
    public Checkout checkout(UUID userId, boolean guest, String planId) {
        if (guest) throw ApiProblem.forbidden("ACCOUNT_REQUIRED", "Create an account before subscribing.");
        Plan plan = paidPlan(planId);
        UUID subId = UUID.randomUUID();
        if (!razorpayMode()) {
            String providerRef = "sub_sbx_" + subId.toString().replace("-", "").substring(0, 14);
            db.sql("INSERT INTO subscriptions (id, user_id, plan, status, provider, provider_ref) VALUES (?, ?, ?, 'pending', 'sandbox', ?)")
                    .params(subId, userId, plan.id(), providerRef)
                    .update();
            return new Checkout("chk_" + UUID.randomUUID().toString().substring(0, 8), providerRef, mode, plan.id(),
                    plan.pricePaise(), keyId.isBlank() ? null : keyId, "INR", plan.name(), null);
        }

        // One live subscription per user: a second one would charge twice for the same Premium.
        db.sql("""
                SELECT current_period_end FROM subscriptions
                 WHERE user_id = ? AND status IN ('active', 'grace') AND current_period_end > now()
                 ORDER BY current_period_end DESC LIMIT 1
                """).param(userId).query(Timestamp.class).optional().ifPresent(end -> {
            throw ApiProblem.conflict("ALREADY_SUBSCRIBED", "You already have Premium until "
                    + DateTimeFormatter.ofPattern("d MMM yyyy").format(end.toInstant().atOffset(ZoneOffset.UTC))
                    + ". You can subscribe again once it ends.");
        });

        Prefill prefill = db.sql("SELECT display_name, email FROM users WHERE id = ?").param(userId)
                .query((rs, i) -> new Prefill(rs.getString("display_name"), rs.getString("email")))
                .optional().orElse(new Prefill(null, null));

        Map<String, Object> notes = new LinkedHashMap<>();
        notes.put("labscape_user_id", userId.toString());
        notes.put("labscape_plan", plan.id());
        notes.put("labscape_subscription_id", subId.toString());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("plan_id", razorpayPlans.get(plan.id()));
        body.put("total_count", TOTAL_COUNT.get(plan.id()));
        body.put("quantity", 1);
        body.put("customer_notify", 1);
        body.put("notes", notes);
        JsonNode created = razorpay.createSubscription(body);
        String providerRef = created.path("id").asText("");
        if (!providerRef.startsWith("sub_")) {
            throw new ApiProblem(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR",
                    "The payment provider did not return a subscription.");
        }
        db.sql("""
                INSERT INTO subscriptions (id, user_id, plan, status, provider, provider_ref, provider_status)
                VALUES (?, ?, ?, 'pending', 'razorpay', ?, ?)
                """)
                .params(subId, userId, plan.id(), providerRef, created.path("status").asText("created"))
                .update();
        return new Checkout("chk_" + UUID.randomUUID().toString().substring(0, 8), providerRef, mode, plan.id(),
                plan.pricePaise(), keyId, "INR", "LABscape " + plan.name(), prefill);
    }

    /**
     * Verifies the Checkout handler response: HMAC-SHA256(payment_id + "|" + subscription_id, key_secret).
     * On success the subscription is marked active with a provisional period end; the
     * subscription.activated / subscription.charged webhooks then set the real period from Razorpay.
     */
    @Transactional
    public void verifyPayment(UUID userId, String paymentId, String subscriptionId, String signature) {
        if (!razorpayMode()) throw ApiProblem.forbidden("RAZORPAY_ONLY", "Payment verification needs Razorpay mode.");
        if (isBlank(paymentId) || isBlank(subscriptionId) || isBlank(signature)) {
            throw ApiProblem.badRequest("PAYMENT_DETAILS_MISSING", "The payment details are incomplete.");
        }
        var row = db.sql("SELECT id, user_id, plan, status FROM subscriptions WHERE provider_ref = ? AND provider = 'razorpay' FOR UPDATE")
                .param(subscriptionId)
                .query((rs, i) -> new Object[] {rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class),
                        rs.getString("plan"), rs.getString("status")})
                .optional()
                .orElseThrow(() -> ApiProblem.notFound("SUBSCRIPTION_NOT_FOUND", "Unknown checkout."));
        if (!row[1].equals(userId)) throw ApiProblem.forbidden("FORBIDDEN", "Not your checkout.");
        String expected = hmacHex(keySecret, (paymentId + "|" + subscriptionId).getBytes(StandardCharsets.UTF_8));
        if (!constantTimeEquals(expected, signature)) {
            log.warn("Checkout signature mismatch for subscription {}", subscriptionId);
            throw ApiProblem.badRequest("PAYMENT_SIGNATURE_INVALID", "We couldn't confirm that payment. Nothing changed.");
        }
        String plan = (String) row[2];
        String status = (String) row[3];
        if (status.equals("pending") || status.equals("authenticated")) {
            OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
            OffsetDateTime end = plan.equals("premium_annual") ? now.plusYears(1) : now.plusMonths(1);
            db.sql("UPDATE subscriptions SET status = 'active', current_period_end = ?, updated_at = now() WHERE id = ?")
                    .params(Timestamp.from(end.toInstant()), row[0]).update();
        }
    }

    /** Sandbox only: simulates the provider charging the card and sending its signed webhook. */
    @Transactional
    public void sandboxPay(UUID userId, String providerRef, boolean succeed) {
        if (razorpayMode()) throw ApiProblem.forbidden("SANDBOX_ONLY", "Sandbox payments are disabled.");
        UUID owner = db.sql("SELECT user_id FROM subscriptions WHERE provider_ref = ?").param(providerRef)
                .query(UUID.class).optional()
                .orElseThrow(() -> ApiProblem.notFound("SUBSCRIPTION_NOT_FOUND", "Unknown checkout."));
        if (!owner.equals(userId)) throw ApiProblem.forbidden("FORBIDDEN", "Not your checkout.");
        String event = succeed ? "subscription.charged" : "payment.failed";
        String body;
        try {
            body = mapper.writeValueAsString(Map.of(
                    "id", "evt_sbx_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16),
                    "event", event,
                    "payload", Map.of("subscription", Map.of("id", providerRef),
                            "payment", Map.of("id", "pay_sbx_" + UUID.randomUUID().toString().replace("-", "").substring(0, 14)))));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        handleWebhook(body, sign(body));
    }

    /** String form used by the sandbox; the HTTP endpoint passes the raw request bytes. */
    @Transactional
    public boolean handleWebhook(String body, String signature) {
        return handleWebhook(body.getBytes(StandardCharsets.UTF_8), signature, null);
    }

    /**
     * Verifies X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret) in constant time, then
     * applies the event once (deduplicated by the x-razorpay-event-id header, else the payload id).
     * Returns false for a replay.
     */
    @Transactional
    public boolean handleWebhook(byte[] raw, String signature, String eventIdHeader) {
        if (raw == null || !constantTimeEquals(hmacHex(webhookSecret, raw), signature)) {
            throw ApiProblem.unauthorized("SIGNATURE_INVALID", "Webhook signature does not match.");
        }
        JsonNode evt;
        try {
            evt = mapper.readTree(raw);
        } catch (Exception e) {
            throw ApiProblem.badRequest("PAYLOAD_INVALID", "Webhook body is not JSON.");
        }
        if (evt == null || !evt.isObject()) throw ApiProblem.badRequest("PAYLOAD_INVALID", "Webhook body is not a JSON object.");
        String type = evt.path("event").asText("");
        String eventId = !isBlank(eventIdHeader) ? eventIdHeader.trim()
                : !evt.path("id").asText("").isBlank() ? evt.path("id").asText()
                : "sha256:" + HexFormat.of().formatHex(sha256(raw));
        int inserted = db.sql("INSERT INTO webhook_events (id, provider, event_type) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
                .params(eventId, mode, type).update();
        if (inserted == 0) return false; // replay: already applied

        JsonNode payload = evt.path("payload");
        JsonNode subEntity = entity(payload.path("subscription"));
        JsonNode payEntity = entity(payload.path("payment"));
        String ref = subEntity.path("id").asText("");
        if (ref.isBlank()) ref = payEntity.path("subscription_id").asText("");
        if (ref.isBlank()) return true; // nothing we track
        var sub = db.sql("SELECT id, user_id, plan, status, current_period_end FROM subscriptions WHERE provider_ref = ? FOR UPDATE")
                .param(ref)
                .query((rs, i) -> new Object[] {rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class),
                        rs.getString("plan"), rs.getString("status"), rs.getTimestamp("current_period_end")})
                .optional();
        if (sub.isEmpty()) {
            log.info("Webhook {} {} for unknown subscription {}", eventId, type, ref);
            return true;
        }
        UUID subId = (UUID) sub.get()[0];
        UUID userId = (UUID) sub.get()[1];
        String plan = (String) sub.get()[2];
        String status = (String) sub.get()[3];
        Timestamp periodEnd = (Timestamp) sub.get()[4];
        Timestamp providerEnd = epoch(subEntity.path("current_end"));
        String providerStatus = subEntity.path("status").asText(null);
        if (providerStatus != null) {
            db.sql("UPDATE subscriptions SET provider_status = ? WHERE id = ?").params(providerStatus, subId).update();
        }

        switch (type) {
            case "subscription.authenticated" -> {
                // Mandate set up; the first charge (and Premium) follows with activated/charged.
                if (status.equals("pending")) {
                    db.sql("UPDATE subscriptions SET status = 'authenticated', updated_at = now() WHERE id = ?")
                            .param(subId).update();
                }
            }
            case "subscription.activated" -> {
                Timestamp end = providerEnd != null ? providerEnd
                        : periodEnd != null && periodEnd.toInstant().isAfter(Instant.now()) ? periodEnd
                        : Timestamp.from(nextEnd(plan, OffsetDateTime.now(ZoneOffset.UTC)).toInstant());
                db.sql("UPDATE subscriptions SET status = 'active', current_period_end = ?, updated_at = now() WHERE id = ?")
                        .params(end, subId).update();
            }
            case "subscription.charged" -> {
                boolean firstPayment = db.sql("SELECT count(*) FROM payments WHERE subscription_id = ?")
                        .param(subId).query(Long.class).single() == 0;
                Timestamp end = providerEnd;
                if (end == null) {
                    // Sandbox (no Razorpay entity): the first charge starts the period now, renewals extend it.
                    OffsetDateTime from = !firstPayment && periodEnd != null && periodEnd.toInstant().isAfter(Instant.now())
                            ? periodEnd.toInstant().atOffset(ZoneOffset.UTC) : OffsetDateTime.now(ZoneOffset.UTC);
                    end = Timestamp.from(nextEnd(plan, from).toInstant());
                }
                db.sql("UPDATE subscriptions SET status = 'active', current_period_end = ?, updated_at = now() WHERE id = ?")
                        .params(end, subId).update();
                int amount = payEntity.path("amount").isIntegralNumber() ? payEntity.path("amount").asInt()
                        : paidPlan(plan).pricePaise();
                String paymentRef = payEntity.path("id").asText(null);
                db.sql("""
                        INSERT INTO payments (id, user_id, subscription_id, amount_paise, gst_paise, status, provider_ref, invoice_number)
                        VALUES (?, ?, ?, ?, ?, 'captured', ?, ?) ON CONFLICT (provider_ref) DO NOTHING
                        """)
                        .params(UUID.randomUUID(), userId, subId, amount, Math.round(amount * 18f / 118f), paymentRef,
                                invoiceNumber())
                        .update();
                if (firstPayment) {
                    notifications.notify(userId, "subscription", "Welcome to Premium",
                            "Every experiment, scenario and theme is now unlocked.", "/plans", "sub-active:" + eventId);
                } else {
                    notifications.notify(userId, "subscription", "Premium renewed",
                            "Thanks for staying with LABscape. Your invoice is on the Plans page.", "/plans",
                            "sub-renewed:" + eventId);
                }
            }
            case "payment.failed", "subscription.pending" -> {
                // 3-day grace period on failed renewals; first purchase failures just stay pending.
                if (periodEnd != null && !status.equals("pending") && !status.equals("authenticated")) {
                    db.sql("UPDATE subscriptions SET status = 'grace', current_period_end = GREATEST(current_period_end, now() + interval '3 days'), updated_at = now() WHERE id = ?")
                            .param(subId).update();
                    notifications.notify(userId, "subscription", "Payment didn't go through",
                            "We'll keep Premium on for 3 days while you update your payment method.", "/plans",
                            "sub-grace:" + eventId);
                }
            }
            case "subscription.halted" -> {
                // Razorpay gave up retrying: Premium ends now. A later successful charge reactivates it.
                db.sql("UPDATE subscriptions SET status = 'halted', current_period_end = LEAST(COALESCE(current_period_end, now()), now()), updated_at = now() WHERE id = ?")
                        .param(subId).update();
                notifications.notify(userId, "subscription", "Premium is paused",
                        "We couldn't collect your renewal. Update your payment method to switch Premium back on.", "/plans",
                        "sub-halted:" + eventId);
            }
            case "subscription.cancelled" -> db.sql("UPDATE subscriptions SET status = 'cancelled', cancel_at_period_end = true, updated_at = now() WHERE id = ?")
                    .param(subId).update();
            case "subscription.completed" -> db.sql("UPDATE subscriptions SET status = 'cancelled', cancel_at_period_end = true, updated_at = now() WHERE id = ?")
                    .param(subId).update();
            default -> {
                // other events are recorded but need no action
            }
        }
        return true;
    }

    /** Not transactional: the Razorpay call must succeed before we record the cancellation. */
    public void setCancelAtPeriodEnd(UUID userId, boolean cancel) {
        if (razorpayMode()) {
            if (!cancel) {
                throw ApiProblem.conflict("RESUME_NOT_SUPPORTED",
                        "A cancelled subscription can't be resumed. Subscribe again once the current period ends.");
            }
            var live = db.sql("""
                    SELECT id, provider, provider_ref FROM subscriptions
                     WHERE user_id = ? AND status IN ('active', 'grace') AND current_period_end > now()
                       AND cancel_at_period_end = false
                     ORDER BY current_period_end DESC LIMIT 1
                    """).param(userId)
                    .query((rs, i) -> new String[] {rs.getString("id"), rs.getString("provider"), rs.getString("provider_ref")})
                    .optional()
                    .orElseThrow(() -> ApiProblem.notFound("NO_SUBSCRIPTION", "You don't have an active subscription."));
            if (live[1].equals("razorpay")) razorpay.cancelSubscription(live[2], true);
            db.sql("UPDATE subscriptions SET cancel_at_period_end = true, updated_at = now() WHERE id = ?")
                    .param(UUID.fromString(live[0])).update();
            return;
        }
        int n = db.sql("""
                UPDATE subscriptions SET cancel_at_period_end = ?, updated_at = now()
                 WHERE user_id = ? AND status IN ('active', 'grace') AND current_period_end > now()
                """).params(cancel, userId).update();
        if (n == 0) throw ApiProblem.notFound("NO_SUBSCRIPTION", "You don't have an active subscription.");
    }

    public List<Invoice> invoices(UUID userId) {
        return db.sql("""
                SELECT p.id, p.invoice_number, p.amount_paise, p.gst_paise, p.currency, p.status, p.created_at, s.plan
                  FROM payments p LEFT JOIN subscriptions s ON s.id = p.subscription_id
                 WHERE p.user_id = ? ORDER BY p.created_at DESC
                """)
                .param(userId)
                .query((rs, i) -> new Invoice(rs.getString("id"), rs.getString("invoice_number"), rs.getInt("amount_paise"),
                        rs.getInt("gst_paise"), rs.getString("currency"), rs.getString("status"),
                        rs.getTimestamp("created_at").toInstant(), rs.getString("plan")))
                .list();
    }

    /** Webhook signature of a UTF-8 body (sandbox events and tests). */
    String sign(String body) {
        return hmacHex(webhookSecret, body.getBytes(StandardCharsets.UTF_8));
    }

    static String hmacHex(String secret, byte[] data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(data));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** Constant-time comparison of two hex signatures (case-insensitive for the provided one). */
    static boolean constantTimeEquals(String expectedHex, String provided) {
        if (provided == null) return false;
        return MessageDigest.isEqual(expectedHex.getBytes(StandardCharsets.US_ASCII),
                provided.trim().toLowerCase(Locale.ROOT).getBytes(StandardCharsets.US_ASCII));
    }

    private static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** Razorpay wraps entities as {"entity": {...}}; sandbox events put the fields directly. */
    private static JsonNode entity(JsonNode node) {
        return node.has("entity") && node.get("entity").isObject() ? node.get("entity") : node;
    }

    private static Timestamp epoch(JsonNode seconds) {
        return seconds.isNumber() && seconds.asLong() > 0 ? Timestamp.from(Instant.ofEpochSecond(seconds.asLong())) : null;
    }

    private static OffsetDateTime nextEnd(String plan, OffsetDateTime from) {
        return plan.equals("premium_annual") ? from.plusYears(1) : from.plusMonths(1);
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private String invoiceNumber() {
        long n = db.sql("SELECT count(*) + 1 FROM payments").query(Long.class).single();
        return "LS-" + DateTimeFormatter.ofPattern("yyyyMM").format(OffsetDateTime.now(ZoneOffset.UTC)) + "-"
                + String.format("%05d", n);
    }
}
