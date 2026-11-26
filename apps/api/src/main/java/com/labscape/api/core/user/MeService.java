package com.labscape.api.core.user;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labscape.api.common.ApiProblem;
import com.labscape.api.contracts.RewardResult;
import com.labscape.api.core.billing.Entitlements;
import com.labscape.api.core.challenges.Challenges;
import com.labscape.api.core.notifications.Notifications;
import com.labscape.api.core.rewards.Levels;
import com.labscape.api.core.rewards.Streaks;
import com.labscape.api.core.user.Users.Profile;
import com.labscape.api.core.user.Users.User;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Builds the signed-in user's view and handles onboarding and profile edits. */
@Service
public class MeService {

    public record ProfileView(String learningLevel, List<String> interests, String preference, JsonNode avatar,
            JsonNode settings, boolean leaderboardOptOut, boolean onboarded) {}

    public record Me(UUID id, String username, String displayName, String email, boolean guest, String role,
            String ageBand, boolean minor, String timezone, Instant createdAt, ProfileView profile, long totalXp,
            RewardResult.Level level, List<RewardResult.Streak> streaks, int unreadNotifications, String plan) {}

    public record Onboarding(String learningLevel, List<String> interests, String preference, String timezone) {}

    public record Patch(String displayName, JsonNode avatar, JsonNode settings, Boolean leaderboardOptOut,
            String timezone) {}

    static final Set<String> LEVELS = Set.of("beginner", "school", "high_school", "undergraduate", "advanced", "exploring");
    static final Set<String> INTERESTS = Set.of("chemistry", "physics", "maths");
    static final Set<String> PREFERENCES = Set.of("experiments", "challenges", "explanations", "exploration");

    private final Users users;
    private final JdbcClient db;
    private final Streaks streaks;
    private final Notifications notifications;
    private final Entitlements entitlements;
    private final Challenges challenges;
    private final ObjectMapper mapper;

    public MeService(Users users, JdbcClient db, Streaks streaks, Notifications notifications,
            Entitlements entitlements, Challenges challenges, ObjectMapper mapper) {
        this.users = users;
        this.db = db;
        this.streaks = streaks;
        this.notifications = notifications;
        this.entitlements = entitlements;
        this.challenges = challenges;
        this.mapper = mapper;
    }

    /** The view returned by /v1/me and every auth endpoint. Visiting counts toward the login streak. */
    @Transactional
    public Me me(UUID userId) {
        User u = users.require(userId);
        users.touch(userId);
        LocalDate today = u.today();
        streaks.touch(userId, "login", today);
        Profile p = users.profile(userId);
        if (p.onboardedAt() != null) dailyNudges(u, today);
        return view(u, p, today);
    }

    @Transactional
    public Me onboard(UUID userId, Onboarding o) {
        if (o.learningLevel() == null || !LEVELS.contains(o.learningLevel())) {
            throw ApiProblem.badRequest("LEVEL_INVALID", "Pick a learning level.");
        }
        List<String> interests = o.interests() == null ? List.of() : o.interests().stream().filter(INTERESTS::contains).distinct().toList();
        if (interests.isEmpty()) throw ApiProblem.badRequest("INTERESTS_REQUIRED", "Pick at least one subject.");
        if (o.preference() == null || !PREFERENCES.contains(o.preference())) {
            throw ApiProblem.badRequest("PREFERENCE_INVALID", "Pick how you like to learn.");
        }
        db.sql("""
                UPDATE user_profiles SET learning_level = ?, interests = ?, preference = ?,
                       onboarded_at = COALESCE(onboarded_at, now()), updated_at = now()
                 WHERE user_id = ?
                """)
                .params(o.learningLevel(), interests.toArray(String[]::new), o.preference(), userId)
                .update();
        if (o.timezone() != null) setTimezone(userId, o.timezone());
        return me(userId);
    }

    @Transactional
    public Me patch(UUID userId, Patch p) {
        if (p.displayName() != null) {
            String n = p.displayName().trim().replaceAll("\\s+", " ");
            if (n.length() < 2 || n.length() > 40) throw ApiProblem.badRequest("NAME_INVALID", "Use a name between 2 and 40 characters.");
            db.sql("UPDATE users SET display_name = ? WHERE id = ?").params(n, userId).update();
        }
        if (p.avatar() != null) db.sql("UPDATE user_profiles SET avatar = ?::jsonb, updated_at = now() WHERE user_id = ?")
                .params(small(p.avatar()), userId).update();
        if (p.settings() != null) db.sql("UPDATE user_profiles SET settings = ?::jsonb, updated_at = now() WHERE user_id = ?")
                .params(small(p.settings()), userId).update();
        if (p.leaderboardOptOut() != null) db.sql("UPDATE user_profiles SET leaderboard_opt_out = ? WHERE user_id = ?")
                .params(p.leaderboardOptOut(), userId).update();
        if (p.timezone() != null) setTimezone(userId, p.timezone());
        return me(userId);
    }

    Me view(User u, Profile p, LocalDate today) {
        return new Me(u.id(), u.username(), u.displayName(), u.email(), u.guest(), u.role(), u.ageBand(), u.minor(),
                u.timezone(), u.createdAt(),
                new ProfileView(p.learningLevel(), p.interests(), p.preference(), json(p.avatarJson()), json(p.settingsJson()),
                        p.leaderboardOptOut(), p.onboardedAt() != null),
                u.totalXp(), Levels.of(u.totalXp()), streaks.summary(u.id(), today), notifications.unread(u.id()),
                entitlements.plan(u.id()));
    }

    /** Lazily created reminders: daily challenges ready, and a streak at risk after 8 pm local time. */
    private void dailyNudges(User u, LocalDate today) {
        if (!challenges.pick(u.id(), today).isEmpty()) {
            notifications.notify(u.id(), "challenge", "Today's challenges are ready",
                    "Three fresh challenges, " + Challenges.XP + " XP each.", "/", "challenges:" + today);
        }
        ZonedDateTime now = ZonedDateTime.now(u.zone());
        Streaks.State exp = streaks.get(u.id(), "experiment");
        if (now.getHour() >= 20 && exp.current() > 1 && today.minusDays(1).equals(exp.lastDay())) {
            notifications.notify(u.id(), "streak", "Your " + exp.current() + "-day streak is at risk",
                    "Finish one experiment before midnight to keep it.", "/library", "streak-risk:" + today);
        }
    }

    private void setTimezone(UUID userId, String tz) {
        try {
            ZoneId.of(tz);
        } catch (Exception e) {
            throw ApiProblem.badRequest("TIMEZONE_INVALID", "Unknown timezone.");
        }
        db.sql("UPDATE users SET timezone = ? WHERE id = ?").params(tz, userId).update();
    }

    private String small(JsonNode node) {
        try {
            String s = mapper.writeValueAsString(node);
            if (s.length() > 4096 || !node.isObject()) throw ApiProblem.badRequest("PAYLOAD_TOO_LARGE", "Settings must be a small object.");
            return s;
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw ApiProblem.badRequest("PAYLOAD_INVALID", "Settings must be JSON.");
        }
    }

    private JsonNode json(String s) {
        try {
            return mapper.readTree(s == null ? "{}" : s);
        } catch (Exception e) {
            return mapper.createObjectNode();
        }
    }
}
