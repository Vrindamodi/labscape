package com.labscape.api.core.billing;

import com.fasterxml.jackson.annotation.JsonAlias;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1")
public class BillingController {

    private final Billing billing;
    private final Entitlements entitlements;

    public BillingController(Billing billing, Entitlements entitlements) {
        this.billing = billing;
        this.entitlements = entitlements;
    }

    public record PlansResponse(List<Billing.Plan> plans, String mode, String currentPlan) {}

    @GetMapping("/billing/plans")
    public PlansResponse plans(@AuthenticationPrincipal Jwt jwt) {
        return new PlansResponse(Billing.PLANS, billing.mode(), entitlements.plan(user(jwt)));
    }

    /** Contract 7: the plan's values. Anonymous visitors get the free tier. */
    @GetMapping("/entitlements")
    public Entitlements.View entitlements(@AuthenticationPrincipal Jwt jwt) {
        return entitlements.view(user(jwt));
    }

    public record CheckoutRequest(String plan) {}

    @PostMapping("/billing/checkout")
    public Billing.Checkout checkout(@AuthenticationPrincipal Jwt jwt, @RequestBody CheckoutRequest req) {
        return billing.checkout(user(jwt), Boolean.TRUE.equals(jwt.getClaimAsBoolean("guest")), req.plan());
    }

    /** The Razorpay Checkout handler response (snake_case as Checkout returns it, or camelCase). */
    public record VerifyRequest(
            @JsonAlias("razorpay_payment_id") String razorpayPaymentId,
            @JsonAlias("razorpay_subscription_id") String razorpaySubscriptionId,
            @JsonAlias("razorpay_signature") String razorpaySignature) {}

    /** Confirms a Checkout payment (optimistic; the webhook remains the source of truth). */
    @PostMapping("/billing/verify")
    public Entitlements.View verify(@AuthenticationPrincipal Jwt jwt, @RequestBody VerifyRequest req) {
        billing.verifyPayment(user(jwt), req.razorpayPaymentId(), req.razorpaySubscriptionId(), req.razorpaySignature());
        return entitlements.view(user(jwt));
    }

    public record SandboxPay(String subscriptionId, boolean succeed) {}

    @PostMapping("/billing/sandbox/pay")
    public Entitlements.View sandboxPay(@AuthenticationPrincipal Jwt jwt, @RequestBody SandboxPay req) {
        billing.sandboxPay(user(jwt), req.subscriptionId(), req.succeed());
        return entitlements.view(user(jwt));
    }

    @PostMapping("/billing/subscription/cancel")
    public Entitlements.View cancel(@AuthenticationPrincipal Jwt jwt) {
        billing.setCancelAtPeriodEnd(user(jwt), true);
        return entitlements.view(user(jwt));
    }

    @PostMapping("/billing/subscription/resume")
    public Entitlements.View resume(@AuthenticationPrincipal Jwt jwt) {
        billing.setCancelAtPeriodEnd(user(jwt), false);
        return entitlements.view(user(jwt));
    }

    @GetMapping("/billing/invoices")
    public List<Billing.Invoice> invoices(@AuthenticationPrincipal Jwt jwt) {
        return billing.invoices(user(jwt));
    }

    @PostMapping("/billing/webhook")
    public ResponseEntity<Map<String, Object>> webhook(@RequestBody byte[] body,
            @RequestHeader(value = "X-Razorpay-Signature", required = false) String signature,
            @RequestHeader(value = "X-Razorpay-Event-Id", required = false) String eventId) {
        // The signature covers the exact bytes Razorpay sent, so the body is never re-serialised.
        boolean applied = billing.handleWebhook(body, signature, eventId);
        return ResponseEntity.ok(Map.of("applied", applied));
    }

    private static UUID user(Jwt jwt) {
        return jwt == null ? null : UUID.fromString(jwt.getSubject());
    }
}
