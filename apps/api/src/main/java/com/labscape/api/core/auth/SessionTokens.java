package com.labscape.api.core.auth;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.stereotype.Component;

/**
 * Issues and reads the session JWT. The token lives only in an httpOnly, SameSite=Lax cookie, so
 * page scripts can never read it.
 */
@Component
public class SessionTokens {

    public static final String ISSUER = "labscape";

    private final AuthProperties props;
    private final JwtEncoder encoder;
    private final JwtDecoder decoder;

    public SessionTokens(AuthProperties props) {
        byte[] secret = props.jwtSecret().getBytes(StandardCharsets.UTF_8);
        if (secret.length < 32) throw new IllegalStateException("labscape.auth.jwt-secret must be at least 32 bytes");
        SecretKey key = new SecretKeySpec(secret, "HmacSHA256");
        this.props = props;
        this.encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key));
        this.decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
    }

    public JwtDecoder decoder() {
        return decoder;
    }

    public String issue(UUID userId, String role, boolean guest) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(ISSUER)
                .subject(userId.toString())
                .issuedAt(now)
                .expiresAt(now.plus(Duration.ofDays(props.sessionDays())))
                .claim("role", role)
                .claim("guest", guest)
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }

    public String cookieHeader(String token) {
        return ResponseCookie.from(props.cookieName(), token)
                .httpOnly(true)
                .secure(props.cookieSecure())
                .sameSite("Lax")
                .path("/")
                .maxAge(Duration.ofDays(props.sessionDays()))
                .build()
                .toString();
    }

    public String clearCookieHeader() {
        return ResponseCookie.from(props.cookieName(), "")
                .httpOnly(true)
                .secure(props.cookieSecure())
                .sameSite("Lax")
                .path("/")
                .maxAge(0)
                .build()
                .toString();
    }

    public String readCookie(HttpServletRequest req) {
        if (req.getCookies() == null) return null;
        for (Cookie c : req.getCookies()) {
            if (props.cookieName().equals(c.getName()) && !c.getValue().isBlank()) return c.getValue();
        }
        return null;
    }

    public static final String SET_COOKIE = HttpHeaders.SET_COOKIE;
}
