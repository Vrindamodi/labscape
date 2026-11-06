package com.labscape.api.core.billing;

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
    public ResponseEntity<Map<String, Object>> webhook(@RequestBody String body,
            @RequestHeader(value = "X-Razorpay-Signature", required = false) String signature) {
        boolean applied = billing.handleWebhook(body, signature);
        return ResponseEntity.ok(Map.of("applied", applied));
    }

    private static UUID user(Jwt jwt) {
        return jwt == null ? null : UUID.fromString(jwt.getSubject());
    }
}
