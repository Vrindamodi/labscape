package com.labscape.api.core.billing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labscape.api.common.ApiProblem;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Minimal Razorpay REST client (Subscriptions only): Basic auth with key_id:key_secret, JSON in and
 * out, bounded timeouts. Provider failures become {@link ApiProblem}s with a stable code; the key
 * secret and the Authorization header are never logged.
 */
@Component
public class RazorpayClient {

    private static final Logger log = LoggerFactory.getLogger(RazorpayClient.class);
    private static final Pattern SUBSCRIPTION_ID = Pattern.compile("sub_[A-Za-z0-9]{1,40}");

    private final ObjectMapper mapper;
    private final String baseUrl;
    private final String authHeader;
    private final HttpClient http;
    private final Duration requestTimeout;

    public RazorpayClient(ObjectMapper mapper,
            @Value("${labscape.billing.razorpay-base-url:https://api.razorpay.com/v1}") String baseUrl,
            @Value("${labscape.billing.razorpay-key-id:}") String keyId,
            @Value("${labscape.billing.razorpay-key-secret:}") String keySecret,
            @Value("${labscape.billing.razorpay-timeout-seconds:15}") int timeoutSeconds) {
        this.mapper = mapper;
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.authHeader = "Basic " + Base64.getEncoder()
                .encodeToString((keyId + ":" + keySecret).getBytes(StandardCharsets.UTF_8));
        this.requestTimeout = Duration.ofSeconds(timeoutSeconds);
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }

    /** POST /subscriptions. Returns the created subscription entity. */
    public JsonNode createSubscription(Map<String, Object> body) {
        return post("/subscriptions", body);
    }

    /** POST /subscriptions/{id}/cancel, at the end of the current cycle when {@code atCycleEnd}. */
    public JsonNode cancelSubscription(String subscriptionId, boolean atCycleEnd) {
        if (subscriptionId == null || !SUBSCRIPTION_ID.matcher(subscriptionId).matches()) {
            throw ApiProblem.badRequest("SUBSCRIPTION_INVALID", "That subscription id is not valid.");
        }
        return post("/subscriptions/" + subscriptionId + "/cancel", Map.of("cancel_at_cycle_end", atCycleEnd ? 1 : 0));
    }

    JsonNode post(String path, Object body) {
        String json;
        try {
            json = mapper.writeValueAsString(body);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(requestTimeout)
                .header("Authorization", authHeader)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> res;
        try {
            res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (HttpTimeoutException e) {
            log.warn("Razorpay POST {} timed out", path);
            throw unavailable();
        } catch (IOException e) {
            log.warn("Razorpay POST {} failed: {}", path, e.getClass().getSimpleName());
            throw unavailable();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw unavailable();
        }
        int status = res.statusCode();
        JsonNode node = parse(res.body());
        if (status >= 200 && status < 300) {
            if (node == null) throw new ApiProblem(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR",
                    "The payment provider sent an unreadable response.");
            return node;
        }
        String code = node == null ? "" : node.path("error").path("code").asText("");
        String description = node == null ? "" : node.path("error").path("description").asText("");
        log.warn("Razorpay POST {} -> HTTP {} {} {}", path, status, code, description);
        if (status == 401) {
            throw new ApiProblem(HttpStatus.SERVICE_UNAVAILABLE, "PAYMENT_PROVIDER_AUTH",
                    "Payments are misconfigured right now. Please try again later.");
        }
        if (status >= 500 || status == 429) throw unavailable();
        throw new ApiProblem(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_REJECTED",
                description.isBlank() ? "The payment provider rejected the request." : "Razorpay: " + description);
    }

    private JsonNode parse(String body) {
        if (body == null || body.isBlank()) return null;
        try {
            return mapper.readTree(body);
        } catch (IOException e) {
            return null;
        }
    }

    private static ApiProblem unavailable() {
        return new ApiProblem(HttpStatus.SERVICE_UNAVAILABLE, "PAYMENT_PROVIDER_UNAVAILABLE",
                "The payment provider is not responding. Please try again in a moment.");
    }
}
