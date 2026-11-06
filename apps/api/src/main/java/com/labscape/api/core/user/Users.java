package com.labscape.api.core.user;

import com.labscape.api.common.ApiProblem;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Data access for users and user_profiles (Part 1 tables). */
@Repository
public class Users {

    public record User(
            UUID id,
            String email,
            String passwordHash,
            String googleSub,
            String username,
            String displayName,
            boolean guest,
            String role,
            String ageBand,
            String timezone,
            long totalXp,
            Instant createdAt,
            boolean disabled) {

        public ZoneId zone() {
            try {
                return ZoneId.of(timezone);
            } catch (Exception e) {
                return ZoneId.of("Asia/Kolkata");
            }
        }

        public LocalDate today() {
            return LocalDate.now(zone());
        }

        /** Under-18 users appear by username only and get restricted community features. */
        public boolean minor() {
            return "under_13".equals(ageBand) || "13_17".equals(ageBand);
        }

        public String publicName() {
            return minor() ? username : displayName;
        }
    }

    public record Profile(
            String learningLevel,
            List<String> interests,
            String preference,
            String avatarJson,
            String settingsJson,
            boolean leaderboardOptOut,
            Instant onboardedAt) {}

    private static final String COLS = "id, email, password_hash, google_sub, username, display_name, is_guest, role, "
            + "age_band, timezone, total_xp, created_at, disabled";

    private final JdbcClient db;

    public Users(JdbcClient db) {
        this.db = db;
    }

    static User map(ResultSet rs, int i) throws SQLException {
        return new User(
                rs.getObject("id", UUID.class),
                rs.getString("email"),
                rs.getString("password_hash"),
                rs.getString("google_sub"),
                rs.getString("username"),
                rs.getString("display_name"),
                rs.getBoolean("is_guest"),
                rs.getString("role"),
                rs.getString("age_band"),
                rs.getString("timezone"),
                rs.getLong("total_xp"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getBoolean("disabled"));
    }

    public Optional<User> find(UUID id) {
        return db.sql("SELECT " + COLS + " FROM users WHERE id = ?").param(id).query(Users::map).optional();
    }

    public User require(UUID id) {
        User u = find(id).orElseThrow(() -> ApiProblem.unauthorized("SESSION_INVALID", "This account no longer exists."));
        if (u.disabled()) throw ApiProblem.forbidden("ACCOUNT_DISABLED", "This account has been disabled.");
        return u;
    }

    /** Locks the row for the rest of the transaction (serialises XP awards per user). */
    public User lock(UUID id) {
        return db.sql("SELECT " + COLS + " FROM users WHERE id = ? FOR UPDATE").param(id).query(Users::map).single();
    }

    public Optional<User> byEmail(String email) {
        return db.sql("SELECT " + COLS + " FROM users WHERE email = ?").param(email).query(Users::map).optional();
    }

    public Optional<User> byGoogleSub(String sub) {
        return db.sql("SELECT " + COLS + " FROM users WHERE google_sub = ?").param(sub).query(Users::map).optional();
    }

    public UUID create(String email, String passwordHash, String googleSub, String displayName, boolean guest,
            String role, String ageBand, String timezone) {
        UUID id = UUID.randomUUID();
        db.sql("""
                INSERT INTO users (id, email, password_hash, google_sub, username, display_name, is_guest, role,
                                   age_band, timezone, parental_consent_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IN ('under_13', '13_17') THEN now() END)
                """)
                .params(id, email, passwordHash, googleSub, uniqueUsername(displayName), displayName, guest, role,
                        ageBand, timezone == null ? "Asia/Kolkata" : timezone, ageBand)
                .update();
        db.sql("INSERT INTO user_profiles (user_id) VALUES (?)").param(id).update();
        return id;
    }

    /** Turns a guest into a full account in place, so every XP, badge and streak stays. */
    public void upgradeGuest(UUID id, String email, String passwordHash, String googleSub, String displayName,
            String ageBand, String role) {
        db.sql("""
                UPDATE users SET email = ?, password_hash = ?, google_sub = ?, display_name = ?, is_guest = false,
                       age_band = COALESCE(?, age_band), role = ?,
                       parental_consent_at = CASE WHEN COALESCE(?, age_band) IN ('under_13', '13_17') THEN now() END
                 WHERE id = ?
                """)
                .params(email, passwordHash, googleSub, displayName, ageBand, role, ageBand, id)
                .update();
    }

    public void touch(UUID id) {
        db.sql("UPDATE users SET last_seen_at = now() WHERE id = ?").param(id).update();
    }

    public void setPassword(UUID id, String hash) {
        db.sql("UPDATE users SET password_hash = ? WHERE id = ?").params(hash, id).update();
    }

    public Profile profile(UUID id) {
        return db.sql("""
                SELECT learning_level, interests, preference, avatar::text AS avatar, settings::text AS settings,
                       leaderboard_opt_out, onboarded_at
                  FROM user_profiles WHERE user_id = ?
                """)
                .param(id)
                .query((rs, i) -> new Profile(
                        rs.getString("learning_level"),
                        Arrays.asList((String[]) rs.getArray("interests").getArray()),
                        rs.getString("preference"),
                        rs.getString("avatar"),
                        rs.getString("settings"),
                        rs.getBoolean("leaderboard_opt_out"),
                        rs.getTimestamp("onboarded_at") == null ? null : rs.getTimestamp("onboarded_at").toInstant()))
                .single();
    }

    private String uniqueUsername(String displayName) {
        String base = displayName == null ? "scientist" : displayName.toLowerCase().replaceAll("[^a-z0-9]+", "");
        if (base.length() < 3) base = "scientist";
        if (base.length() > 16) base = base.substring(0, 16);
        for (int attempt = 0; attempt < 20; attempt++) {
            String candidate = base + ThreadLocalRandom.current().nextInt(1000, 10000);
            Integer n = db.sql("SELECT count(*) FROM users WHERE username = ?").param(candidate).query(Integer.class).single();
            if (n == 0) return candidate;
        }
        return base + UUID.randomUUID().toString().substring(0, 8);
    }
}
