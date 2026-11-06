package com.labscape.api.core.auth;

import com.labscape.api.common.ApiProblem;
import com.labscape.api.core.user.Users;
import com.labscape.api.core.user.Users.User;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Base64;
import java.util.Deque;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Accounts: email + password, Google, and guests. A guest is a real (flagged) user row, so signing up
 * from a guest session upgrades it in place and signing in to an existing account merges the guest's
 * progress into it. Either way no XP is lost.
 */
@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$");
    private static final SecureRandom RANDOM = new SecureRandom();

    private final Users users;
    private final JdbcClient db;
    private final PasswordEncoder passwords;
    private final AuthProperties props;
    private final String webOrigin;
    private final Map<String, Deque<Instant>> loginAttempts = new ConcurrentHashMap<>();
    private volatile NimbusJwtDecoder googleDecoder;

    public AuthService(Users users, JdbcClient db, PasswordEncoder passwords, AuthProperties props,
            @Value("${labscape.web-origin}") String webOrigin) {
        this.users = users;
        this.db = db;
        this.passwords = passwords;
        this.props = props;
        this.webOrigin = webOrigin;
    }

    public record Registration(String email, String password, String displayName, String ageBand,
            boolean parentalConsent, String timezone) {}

    @Transactional
    public User guest(String timezone) {
        UUID id = users.create(null, null, null, "Guest Scientist", true, "student", null, timezone);
        return users.require(id);
    }

    @Transactional
    public User register(Registration r, Optional<UUID> currentGuest) {
        String email = normaliseEmail(r.email());
        if (r.password() == null || r.password().length() < 8) {
            throw ApiProblem.badRequest("WEAK_PASSWORD", "Use at least 8 characters for your password.");
        }
        String name = cleanName(r.displayName());
        checkAge(r.ageBand(), r.parentalConsent());
        if (users.byEmail(email).isPresent()) {
            throw ApiProblem.conflict("EMAIL_TAKEN", "An account with this email already exists. Try signing in.");
        }
        String hash = passwords.encode(r.password());
        String role = props.bootstrapAdmins().contains(email) ? "super_admin" : "student";
        Optional<User> guest = currentGuest.flatMap(users::find).filter(User::guest);
        if (guest.isPresent()) {
            users.upgradeGuest(guest.get().id(), email, hash, null, name, r.ageBand(), role);
            return users.require(guest.get().id());
        }
        return users.require(users.create(email, hash, null, name, false, role, r.ageBand(), r.timezone()));
    }

    @Transactional
    public User login(String rawEmail, String password, Optional<UUID> currentGuest) {
        String email = normaliseEmail(rawEmail);
        throttle(email);
        User u = users.byEmail(email)
                .filter(x -> x.passwordHash() != null && passwords.matches(password == null ? "" : password, x.passwordHash()))
                .orElseThrow(() -> ApiProblem.unauthorized("BAD_CREDENTIALS", "That email and password don't match."));
        if (u.disabled()) throw ApiProblem.forbidden("ACCOUNT_DISABLED", "This account has been disabled.");
        loginAttempts.remove(email);
        currentGuest.flatMap(users::find).filter(User::guest).filter(g -> !g.id().equals(u.id()))
                .ifPresent(g -> mergeGuest(g.id(), u.id()));
        return users.require(u.id());
    }

    @Transactional
    public User google(String credential, String ageBand, Optional<UUID> currentGuest) {
        if (!props.googleEnabled()) {
            throw new ApiProblem(HttpStatus.SERVICE_UNAVAILABLE, "GOOGLE_DISABLED", "Google sign-in is not configured.");
        }
        Jwt token;
        try {
            token = googleDecoder().decode(credential);
        } catch (Exception e) {
            throw ApiProblem.unauthorized("GOOGLE_TOKEN_INVALID", "Google sign-in failed. Please try again.");
        }
        String sub = token.getSubject();
        String email = normaliseEmail(token.getClaimAsString("email"));
        if (!Boolean.TRUE.equals(token.getClaimAsBoolean("email_verified"))) {
            throw ApiProblem.unauthorized("GOOGLE_EMAIL_UNVERIFIED", "Your Google email is not verified.");
        }
        Optional<User> existing = users.byGoogleSub(sub).or(() -> users.byEmail(email));
        if (existing.isPresent()) {
            User u = existing.get();
            if (u.googleSub() == null) db.sql("UPDATE users SET google_sub = ? WHERE id = ?").params(sub, u.id()).update();
            currentGuest.flatMap(users::find).filter(User::guest).filter(g -> !g.id().equals(u.id()))
                    .ifPresent(g -> mergeGuest(g.id(), u.id()));
            return users.require(u.id());
        }
        String name = cleanName(Optional.ofNullable(token.getClaimAsString("name")).orElse(email.split("@")[0]));
        String role = props.bootstrapAdmins().contains(email) ? "super_admin" : "student";
        Optional<User> guest = currentGuest.flatMap(users::find).filter(User::guest);
        if (guest.isPresent()) {
            users.upgradeGuest(guest.get().id(), email, null, sub, name, ageBand, role);
            return users.require(guest.get().id());
        }
        return users.require(users.create(email, null, sub, name, false, role, ageBand, null));
    }

    /** Always succeeds, so the response never reveals whether an email has an account. */
    @Transactional
    public void forgotPassword(String rawEmail) {
        String email;
        try {
            email = normaliseEmail(rawEmail);
        } catch (ApiProblem e) {
            return;
        }
        users.byEmail(email).filter(u -> !u.disabled()).ifPresent(u -> {
            byte[] raw = new byte[32];
            RANDOM.nextBytes(raw);
            String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
            db.sql("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
                    .params(sha256(token), u.id(), java.sql.Timestamp.from(Instant.now().plus(Duration.ofHours(1))))
                    .update();
            // Email delivery lands with notifications (Later). Until then the link is logged for dev use.
            log.info("Password reset link for {}: {}/reset-password?token={}", email, webOrigin, token);
        });
    }

    @Transactional
    public User resetPassword(String token, String newPassword) {
        if (newPassword == null || newPassword.length() < 8) {
            throw ApiProblem.badRequest("WEAK_PASSWORD", "Use at least 8 characters for your password.");
        }
        UUID userId = db.sql("""
                UPDATE password_resets SET used_at = now()
                 WHERE token_hash = ? AND used_at IS NULL AND expires_at > now()
                RETURNING user_id
                """)
                .param(sha256(token == null ? "" : token))
                .query(UUID.class)
                .optional()
                .orElseThrow(() -> ApiProblem.badRequest("RESET_LINK_INVALID", "This reset link has expired. Ask for a new one."));
        users.setPassword(userId, passwords.encode(newPassword));
        return users.require(userId);
    }

    /** Moves everything a guest earned into an existing account, then deletes the guest. */
    void mergeGuest(UUID guest, UUID target) {
        db.sql("""
                INSERT INTO xp_transactions (user_id, idempotency_key, kind, ref_id, subject, score, base_xp, xp,
                                             adjustments, created_at)
                SELECT :target,
                       -- the same key on both accounts (e.g. the same daily challenge) keeps both awards
                       CASE WHEN EXISTS (SELECT 1 FROM xp_transactions t WHERE t.user_id = :target AND t.idempotency_key = g.idempotency_key)
                            THEN g.idempotency_key || ':merged:' || CAST(:guest AS text) ELSE g.idempotency_key END,
                       kind, ref_id, subject, score, base_xp, xp, adjustments, created_at
                  FROM xp_transactions g WHERE g.user_id = :guest
                ON CONFLICT (user_id, idempotency_key) DO NOTHING
                """).param("target", target).param("guest", guest).update();
        db.sql("""
                INSERT INTO user_achievements (user_id, achievement_id, unlocked_at)
                SELECT :target, achievement_id, unlocked_at FROM user_achievements WHERE user_id = :guest
                ON CONFLICT DO NOTHING
                """).param("target", target).param("guest", guest).update();
        db.sql("""
                INSERT INTO streaks (user_id, kind, current_days, best_days, last_day, freeze_week, freeze_used_on)
                SELECT :target, kind, current_days, best_days, last_day, freeze_week, freeze_used_on
                  FROM streaks WHERE user_id = :guest
                ON CONFLICT (user_id, kind) DO UPDATE SET
                    current_days = GREATEST(streaks.current_days, EXCLUDED.current_days),
                    best_days = GREATEST(streaks.best_days, EXCLUDED.best_days),
                    last_day = GREATEST(streaks.last_day, EXCLUDED.last_day)
                """).param("target", target).param("guest", guest).update();
        db.sql("""
                INSERT INTO daily_challenge_progress (user_id, day, challenge_id, progress, completed_at)
                SELECT :target, day, challenge_id, progress, completed_at FROM daily_challenge_progress WHERE user_id = :guest
                ON CONFLICT (user_id, day, challenge_id) DO UPDATE SET
                    progress = GREATEST(daily_challenge_progress.progress, EXCLUDED.progress),
                    completed_at = COALESCE(daily_challenge_progress.completed_at, EXCLUDED.completed_at)
                """).param("target", target).param("guest", guest).update();
        db.sql("""
                UPDATE user_profiles t SET
                    learning_level = COALESCE(t.learning_level, g.learning_level),
                    interests = CASE WHEN cardinality(t.interests) = 0 THEN g.interests ELSE t.interests END,
                    preference = COALESCE(t.preference, g.preference),
                    onboarded_at = COALESCE(t.onboarded_at, g.onboarded_at)
                  FROM user_profiles g WHERE t.user_id = :target AND g.user_id = :guest
                """).param("target", target).param("guest", guest).update();
        db.sql("UPDATE users SET total_xp = (SELECT COALESCE(SUM(xp), 0) FROM xp_transactions WHERE user_id = :target) WHERE id = :target")
                .param("target", target).update();
        db.sql("DELETE FROM users WHERE id = ?").param(guest).update();
    }

    private void throttle(String email) {
        Deque<Instant> q = loginAttempts.computeIfAbsent(email, k -> new ArrayDeque<>());
        synchronized (q) {
            Instant cutoff = Instant.now().minus(Duration.ofMinutes(15));
            while (!q.isEmpty() && q.peekFirst().isBefore(cutoff)) q.pollFirst();
            if (q.size() >= 10) {
                throw new ApiProblem(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_ATTEMPTS",
                        "Too many sign-in attempts. Wait a few minutes and try again.");
            }
            q.addLast(Instant.now());
        }
    }

    private NimbusJwtDecoder googleDecoder() {
        if (googleDecoder == null) {
            NimbusJwtDecoder d = NimbusJwtDecoder.withJwkSetUri("https://www.googleapis.com/oauth2/v3/certs").build();
            d.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                    JwtValidators.createDefault(),
                    jwt -> {
                        String iss = String.valueOf(jwt.getClaims().get("iss"));
                        boolean issOk = iss.equals("accounts.google.com") || iss.equals("https://accounts.google.com");
                        boolean audOk = jwt.getAudience() != null && jwt.getAudience().contains(props.googleClientId());
                        return issOk && audOk ? OAuth2TokenValidatorResult.success()
                                : OAuth2TokenValidatorResult.failure(new org.springframework.security.oauth2.core.OAuth2Error("invalid_token"));
                    }));
            googleDecoder = d;
        }
        return googleDecoder;
    }

    private static void checkAge(String ageBand, boolean consent) {
        if (ageBand == null || !(ageBand.equals("under_13") || ageBand.equals("13_17") || ageBand.equals("18_plus"))) {
            throw ApiProblem.badRequest("AGE_BAND_REQUIRED", "Tell us your age range first.");
        }
        if (!ageBand.equals("18_plus") && !consent) {
            throw ApiProblem.badRequest("PARENTAL_CONSENT_REQUIRED",
                    "A parent or guardian needs to agree before you can create an account.");
        }
    }

    static String normaliseEmail(String email) {
        String e = email == null ? "" : email.trim().toLowerCase();
        if (!EMAIL.matcher(e).matches() || e.length() > 254) {
            throw ApiProblem.badRequest("EMAIL_INVALID", "That doesn't look like an email address.");
        }
        return e;
    }

    static String cleanName(String name) {
        String n = name == null ? "" : name.trim().replaceAll("\\s+", " ");
        if (n.length() < 2 || n.length() > 40) {
            throw ApiProblem.badRequest("NAME_INVALID", "Use a name between 2 and 40 characters.");
        }
        return n;
    }

    static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
