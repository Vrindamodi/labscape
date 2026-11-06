package com.labscape.api.core.auth;

import com.labscape.api.core.user.MeService;
import com.labscape.api.core.user.Users.User;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** /v1/auth/*: every success sets the httpOnly session cookie and returns the user's view. */
@RestController
@RequestMapping("/v1/auth")
public class AuthController {

    private final AuthService auth;
    private final SessionTokens tokens;
    private final MeService me;
    private final AuthProperties props;

    public AuthController(AuthService auth, SessionTokens tokens, MeService me, AuthProperties props) {
        this.auth = auth;
        this.tokens = tokens;
        this.me = me;
        this.props = props;
    }

    public record Providers(boolean google, String googleClientId, boolean email, boolean guest) {}

    @GetMapping("/providers")
    public Providers providers() {
        return new Providers(props.googleEnabled(), props.googleEnabled() ? props.googleClientId() : null, true, true);
    }

    public record GuestRequest(String timezone) {}

    @PostMapping("/guest")
    public ResponseEntity<MeService.Me> guest(@RequestBody(required = false) GuestRequest req, HttpServletRequest http) {
        Optional<UUID> existing = currentGuest(http);
        if (existing.isPresent()) return session(existing.get());
        return session(auth.guest(req == null ? null : req.timezone()));
    }

    @PostMapping("/register")
    public ResponseEntity<MeService.Me> register(@RequestBody AuthService.Registration req, HttpServletRequest http) {
        return session(auth.register(req, currentGuest(http)));
    }

    public record LoginRequest(String email, String password) {}

    @PostMapping("/login")
    public ResponseEntity<MeService.Me> login(@RequestBody LoginRequest req, HttpServletRequest http) {
        return session(auth.login(req.email(), req.password(), currentGuest(http)));
    }

    public record GoogleRequest(String credential, String ageBand) {}

    @PostMapping("/google")
    public ResponseEntity<MeService.Me> google(@RequestBody GoogleRequest req, HttpServletRequest http) {
        return session(auth.google(req.credential(), req.ageBand(), currentGuest(http)));
    }

    public record ForgotRequest(String email) {}

    @PostMapping("/forgot")
    public ResponseEntity<Map<String, Boolean>> forgot(@RequestBody ForgotRequest req) {
        auth.forgotPassword(req.email());
        return ResponseEntity.accepted().body(Map.of("sent", true));
    }

    public record ResetRequest(String token, String password) {}

    @PostMapping("/reset")
    public ResponseEntity<MeService.Me> reset(@RequestBody ResetRequest req) {
        return session(auth.resetPassword(req.token(), req.password()));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletResponse res) {
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, tokens.clearCookieHeader()).build();
    }

    private ResponseEntity<MeService.Me> session(User u) {
        return session(u.id(), u.role(), u.guest());
    }

    private ResponseEntity<MeService.Me> session(UUID id) {
        MeService.Me view = me.me(id);
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, tokens.cookieHeader(tokens.issue(id, view.role(), view.guest())))
                .body(view);
    }

    private ResponseEntity<MeService.Me> session(UUID id, String role, boolean guest) {
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, tokens.cookieHeader(tokens.issue(id, role, guest)))
                .body(me.me(id));
    }

    /** Auth endpoints skip cookie authentication, so read the current guest session by hand. */
    private Optional<UUID> currentGuest(HttpServletRequest http) {
        String raw = tokens.readCookie(http);
        if (raw == null) return Optional.empty();
        try {
            Jwt jwt = tokens.decoder().decode(raw);
            return Boolean.TRUE.equals(jwt.getClaimAsBoolean("guest")) ? Optional.of(UUID.fromString(jwt.getSubject()))
                    : Optional.empty();
        } catch (Exception e) {
            return Optional.empty();
        }
    }
}
