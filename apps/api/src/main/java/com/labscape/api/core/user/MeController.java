package com.labscape.api.core.user;

import com.labscape.api.contracts.ProgressEvent;
import com.labscape.api.contracts.RewardResult;
import com.labscape.api.core.challenges.Challenges;
import com.labscape.api.core.notifications.Notifications;
import com.labscape.api.core.rewards.Rewards;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** /v1/me, /v1/onboarding, /v1/progress/events, /v1/rewards/summary, /v1/challenges/today, /v1/notifications. */
@RestController
@RequestMapping("/v1")
public class MeController {

    private final MeService me;
    private final Users users;
    private final Rewards rewards;
    private final Challenges challenges;
    private final Notifications notifications;

    public MeController(MeService me, Users users, Rewards rewards, Challenges challenges, Notifications notifications) {
        this.me = me;
        this.users = users;
        this.rewards = rewards;
        this.challenges = challenges;
        this.notifications = notifications;
    }

    @GetMapping("/me")
    public MeService.Me get(@AuthenticationPrincipal Jwt jwt) {
        return me.me(id(jwt));
    }

    @PatchMapping("/me")
    public MeService.Me patch(@AuthenticationPrincipal Jwt jwt, @RequestBody MeService.Patch patch) {
        return me.patch(id(jwt), patch);
    }

    @PostMapping("/onboarding")
    public MeService.Me onboarding(@AuthenticationPrincipal Jwt jwt, @RequestBody MeService.Onboarding body) {
        return me.onboard(id(jwt), body);
    }

    /** Contract 4. Sending the same idempotencyKey twice awards XP once. */
    @PostMapping("/progress/events")
    public RewardResult event(@AuthenticationPrincipal Jwt jwt, @RequestBody ProgressEvent event) {
        return rewards.award(id(jwt), event);
    }

    @GetMapping("/rewards/summary")
    public Rewards.Summary summary(@AuthenticationPrincipal Jwt jwt) {
        return rewards.summary(id(jwt));
    }

    @GetMapping("/challenges/today")
    public List<Challenges.Today> today(@AuthenticationPrincipal Jwt jwt) {
        UUID id = id(jwt);
        return challenges.today(id, users.require(id).today());
    }

    public record NotificationList(List<Notifications.Item> items, int unread) {}

    @GetMapping("/notifications")
    public NotificationList notifications(@AuthenticationPrincipal Jwt jwt) {
        UUID id = id(jwt);
        return new NotificationList(notifications.list(id, 40), notifications.unread(id));
    }

    @PostMapping("/notifications/{id}/read")
    public ResponseEntity<Void> read(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        notifications.markRead(id(jwt), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/notifications/read-all")
    public Map<String, Integer> readAll(@AuthenticationPrincipal Jwt jwt) {
        notifications.markAllRead(id(jwt));
        return Map.of("unread", 0);
    }

    static UUID id(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }
}
