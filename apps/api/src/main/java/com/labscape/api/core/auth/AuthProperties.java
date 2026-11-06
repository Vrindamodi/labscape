package com.labscape.api.core.auth;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("labscape.auth")
public record AuthProperties(
        String jwtSecret,
        int sessionDays,
        String cookieName,
        boolean cookieSecure,
        String googleClientId,
        String adminBootstrapEmails) {

    public boolean googleEnabled() {
        return googleClientId != null && !googleClientId.isBlank();
    }

    public Set<String> bootstrapAdmins() {
        if (adminBootstrapEmails == null || adminBootstrapEmails.isBlank()) return Set.of();
        return Arrays.stream(adminBootstrapEmails.split(","))
                .map(String::trim)
                .map(String::toLowerCase)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toSet());
    }
}
