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
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Plans, checkout and the subscription lifecycle (build plan 1.7).
 *
 * <p>Every state change goes through {@link #handleWebhook}: in Razorpay mode the provider calls it
 * with a signed payload; in sandbox mode the test sheet's "Pay" button builds the same signed event.
 * Each event id is processed once, so replayed webhooks change nothing.
 */
@Service
public class Billing {

    public record Plan(String id, String name, int pricePaise, String interval, List<String> features,
            Integer savePaise, boolean highlighted) {}

    public record Checkout(String checkoutId, String subscriptionId, String mode, String plan, int amountPaise,
            String razorpayKeyId) {}

    public record Invoice(String id, String invoiceNumber, int amountPaise, int gstPaise, String currency,
            String status, Instant createdAt, String plan) {}

    public static final List<Plan> PLANS = List.of(
            new Plan("free", "Free", 0, "forever", List.of(
                    "Selected experiments in every subject",
                    "Playground: 5 sessions a day",
                    "AI assistant: 10 messages a day",
                    "Starter emergency scenarios",
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

    private final JdbcClient db;
    private final ObjectMapper mapper;
    private final Notifications notifications;
    private final String mode;
    private final String keyId;
    private final String webhookSecret;

    public Billing(JdbcClient db, ObjectMapper mapper, Notifications notifications,
            @Value("${labscape.billing.mode}") String mode,
            @Value("${labscape.billing.razorpay-key-id:}") String keyId,
            @Value("${labscape.billing.webhook-secret}") String webhookSecret) {
        this.db = db;
        this.mapper = mapper;
        this.notifications = notifications;
        this.mode = mode;
        this.keyId = keyId;
        this.webhookSecret = webhookSecret;
    }

    public String mode() {
        return mode;
    }

    @Transactional
    public Checkout checkout(UUID userId, boolean guest, String planId) {
        if (guest) throw ApiProblem.forbidden("ACCOUNT_REQUIRED", "Create an account before subscribing.");
        Plan plan = PLANS.stream().filter(p -> p.id().equals(planId) && p.pricePaise() > 0).findFirst()
                .orElseThrow(() -> ApiProblem.badRequest("PLAN_INVALID", "Choose Monthly or Annual."));
        if (!mode.equals("sandbox")) {
            // Razorpay Subscriptions API call goes here once keys are configured for the environment.
            throw new ApiProblem(HttpStatus.SERVICE_UNAVAILABLE, "PAYMENTS_NOT_CONFIGURED",
                    "Payments are not switched on yet.");
        }
        UUID subId = UUID.randomUUID();
        String providerRef = "sub_sbx_" + subId.toString().replace("-", "").substring(0, 14);
        db.sql("INSERT INTO subscriptions (id, user_id, plan, status, provider, provider_ref) VALUES (?, ?, ?, 'pending', 'sandbox', ?)")
                .params(subId, userId, plan.id(), providerRef)
                .update();
        return new Checkout("chk_" + UUID.randomUUID().toString().substring(0, 8), providerRef, mode, plan.id(),
                plan.pricePaise(), keyId.isBlank() ? null : keyId);
    }

    /** Sandbox only: simulates the provider charging the card and sending its signed webhook. */
    @Transactional
    public void sandboxPay(UUID userId, String providerRef, boolean succeed) {
        if (!mode.equals("sandbox")) throw ApiProblem.forbidden("SANDBOX_ONLY", "Sandbox payments are disabled.");
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

    /** Verifies the HMAC-SHA256 signature, then applies the event once. Returns false for a replay. */
    @Transactional
    public boolean handleWebhook(String body, String signature) {
        if (signature == null || !MessageDigest.isEqual(sign(body).getBytes(StandardCharsets.UTF_8),
                signature.getBytes(StandardCharsets.UTF_8))) {
            throw ApiProblem.unauthorized("SIGNATURE_INVALID", "Webhook signature does not match.");
        }
        JsonNode evt;
        try {
            evt = mapper.readTree(body);
        } catch (Exception e) {
            throw ApiProblem.badRequest("PAYLOAD_INVALID", "Webhook body is not JSON.");
        }
        String eventId = evt.path("id").asText();
        String type = evt.path("event").asText();
        int inserted = db.sql("INSERT INTO webhook_events (id, provider, event_type) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
                .params(eventId, mode, type).update();
        if (inserted == 0) return false; // replay: already applied

        String ref = evt.path("payload").path("subscription").path("id").asText();
        var sub = db.sql("SELECT id, user_id, plan, current_period_end FROM subscriptions WHERE provider_ref = ? FOR UPDATE")
                .param(ref)
                .query((rs, i) -> new Object[] {rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class),
                        rs.getString("plan"), rs.getTimestamp("current_period_end")})
                .optional();
        if (sub.isEmpty()) return true;
        UUID subId = (UUID) sub.get()[0];
        UUID userId = (UUID) sub.get()[1];
        String plan = (String) sub.get()[2];
        Timestamp periodEnd = (Timestamp) sub.get()[3];

        switch (type) {
            case "subscription.activated", "subscription.charged" -> {
                OffsetDateTime from = periodEnd != null && periodEnd.toInstant().isAfter(Instant.now())
                        ? periodEnd.toInstant().atOffset(ZoneOffset.UTC) : OffsetDateTime.now(ZoneOffset.UTC);
                OffsetDateTime end = plan.equals("premium_annual") ? from.plusYears(1) : from.plusMonths(1);
                db.sql("UPDATE subscriptions SET status = 'active', current_period_end = ?, updated_at = now() WHERE id = ?")
                        .params(Timestamp.from(end.toInstant()), subId).update();
                int amount = plan.equals("premium_annual") ? 99_900 : 14_900;
                String paymentRef = evt.path("payload").path("payment").path("id").asText(null);
                db.sql("""
                        INSERT INTO payments (id, user_id, subscription_id, amount_paise, gst_paise, status, provider_ref, invoice_number)
                        VALUES (?, ?, ?, ?, ?, 'captured', ?, ?) ON CONFLICT (provider_ref) DO NOTHING
                        """)
                        .params(UUID.randomUUID(), userId, subId, amount, Math.round(amount * 18f / 118f), paymentRef,
                                invoiceNumber())
                        .update();
                notifications.notify(userId, "subscription", "Welcome to Premium ✨",
                        "Every experiment, scenario and theme is now unlocked.", "/plans", "sub-active:" + eventId);
            }
            case "payment.failed" -> {
                // 3-day grace period on failed renewals; first purchase failures just stay pending.
                if (periodEnd != null) {
                    db.sql("UPDATE subscriptions SET status = 'grace', current_period_end = GREATEST(current_period_end, now() + interval '3 days'), updated_at = now() WHERE id = ?")
                            .param(subId).update();
                    notifications.notify(userId, "subscription", "Payment didn't go through",
                            "We'll keep Premium on for 3 days while you update your payment method.", "/plans",
                            "sub-grace:" + eventId);
                }
            }
            case "subscription.cancelled" -> db.sql("UPDATE subscriptions SET status = 'cancelled', updated_at = now() WHERE id = ?")
                    .param(subId).update();
            default -> {
                // other events are recorded but need no action
            }
        }
        return true;
    }

    @Transactional
    public void setCancelAtPeriodEnd(UUID userId, boolean cancel) {
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

    String sign(String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(webhookSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private String invoiceNumber() {
        long n = db.sql("SELECT count(*) + 1 FROM payments").query(Long.class).single();
        return "LS-" + DateTimeFormatter.ofPattern("yyyyMM").format(OffsetDateTime.now(ZoneOffset.UTC)) + "-"
                + String.format("%05d", n);
    }
}
