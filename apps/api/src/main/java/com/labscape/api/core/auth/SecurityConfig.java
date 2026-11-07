package com.labscape.api.core.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.www.BasicAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Stateless auth: the session JWT is read from the httpOnly cookie (or a Bearer header for tools).
 * CSRF: the cookie is SameSite=Lax and {@link OriginGuard} rejects unsafe cross-origin requests.
 */
@Configuration
public class SecurityConfig {

    /** Endpoints that need a signed-in user (guests count as signed in). */
    static final String[] AUTHENTICATED = {
        "/v1/me", "/v1/me/**", "/v1/onboarding", "/v1/progress/**", "/v1/rewards/**", "/v1/challenges/**",
        "/v1/notifications", "/v1/notifications/**", "/v1/leaderboards/**", "/v1/billing/checkout",
        "/v1/billing/subscription", "/v1/billing/subscription/**", "/v1/billing/invoices",
        "/v1/billing/sandbox/**", "/v1/auth/logout",
        "/v1/attempts", "/v1/attempts/**", "/v1/chem/simulate", "/v1/physics/check", "/v1/maths/check",
        "/v1/quizzes/*/start", "/v1/quizzes/attempts/**", "/v1/quizzes/mastery", "/v1/recommendations",
        "/v1/ai/**", "/v1/emergency/scenarios/*/start", "/v1/emergency/attempts/**",
        "/v1/notebook", "/v1/notebook/**", "/v1/reports/**", "/v1/replay/**", "/v1/playground/sessions", "/v1/playground/sessions/**"
    };

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, SessionTokens tokens, ObjectMapper mapper,
            @Value("${labscape.web-origin}") String webOrigin) throws Exception {
        http.csrf(c -> c.disable())
                .cors(c -> {})
                .httpBasic(b -> b.disable())
                .formLogin(f -> f.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .addFilterBefore(new OriginGuard(Set.of(webOrigin), mapper), BasicAuthenticationFilter.class)
                .authorizeHttpRequests(a -> a
                        .requestMatchers("/v1/admin/**").hasAnyRole("ADMIN", "SUPER_ADMIN")
                        .requestMatchers(AUTHENTICATED).authenticated()
                        .anyRequest().permitAll())
                .exceptionHandling(e -> e
                        .authenticationEntryPoint((req, res, ex) ->
                                problem(res, mapper, 401, "AUTH_REQUIRED", "Sign in or continue as a guest first."))
                        .accessDeniedHandler((req, res, ex) ->
                                problem(res, mapper, 403, "FORBIDDEN", "Your account cannot do that.")))
                .oauth2ResourceServer(o -> o
                        .bearerTokenResolver(cookieResolver(tokens))
                        .authenticationEntryPoint((req, res, ex) ->
                                problem(res, mapper, 401, "SESSION_INVALID", "Your session has ended. Please sign in again."))
                        .jwt(j -> j.decoder(tokens.decoder()).jwtAuthenticationConverter(roleConverter())));
        return http.build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }

    /** Cookie first, then Authorization: Bearer. Auth endpoints ignore a stale cookie. */
    static BearerTokenResolver cookieResolver(SessionTokens tokens) {
        DefaultBearerTokenResolver header = new DefaultBearerTokenResolver();
        return req -> {
            String path = req.getRequestURI();
            if (path.startsWith("/v1/auth/") && !path.equals("/v1/auth/logout")) return null;
            if (path.startsWith("/v1/billing/webhook")) return null;
            String cookie = tokens.readCookie(req);
            return cookie != null ? cookie : header.resolve(req);
        };
    }

    static JwtAuthenticationConverter roleConverter() {
        JwtAuthenticationConverter c = new JwtAuthenticationConverter();
        c.setJwtGrantedAuthoritiesConverter(jwt -> {
            String role = jwt.getClaimAsString("role");
            List<GrantedAuthority> out = new java.util.ArrayList<>();
            if (role != null) out.add(new SimpleGrantedAuthority("ROLE_" + role.toUpperCase()));
            if (Boolean.TRUE.equals(jwt.getClaimAsBoolean("guest"))) out.add(new SimpleGrantedAuthority("ROLE_GUEST"));
            return out;
        });
        return c;
    }

    static void problem(HttpServletResponse res, ObjectMapper mapper, int status, String code, String detail)
            throws IOException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", "https://labscape.app/problems/" + code.toLowerCase().replace('_', '-'));
        body.put("title", status == 401 ? "Unauthorized" : "Forbidden");
        body.put("status", status);
        body.put("detail", detail);
        body.put("code", code);
        res.setStatus(status);
        res.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        mapper.writeValue(res.getOutputStream(), body);
    }

    /**
     * CSRF defence in depth: a state-changing request that carries an Origin header must come from
     * the web app. Webhooks are server-to-server and signed, so they are exempt.
     */
    static final class OriginGuard extends OncePerRequestFilter {
        private final Set<String> allowed;
        private final ObjectMapper mapper;

        OriginGuard(Set<String> allowed, ObjectMapper mapper) {
            this.allowed = allowed;
            this.mapper = mapper;
        }

        @Override
        protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
                throws ServletException, IOException {
            String method = req.getMethod();
            boolean unsafe = !(HttpMethod.GET.matches(method) || HttpMethod.HEAD.matches(method)
                    || HttpMethod.OPTIONS.matches(method));
            String origin = req.getHeader("Origin");
            if (unsafe && origin != null && !req.getRequestURI().startsWith("/v1/billing/webhook")
                    && !allowed.contains(origin) && !sameHost(req, origin)) {
                problem(res, mapper, 403, "ORIGIN_REJECTED", "Request blocked: it did not come from LABscape.");
                return;
            }
            chain.doFilter(req, res);
        }

        private static boolean sameHost(HttpServletRequest req, String origin) {
            String host = req.getHeader("Host");
            return host != null && (origin.equals("http://" + host) || origin.equals("https://" + host));
        }
    }
}
