package com.labscape.api.intelligence.safety;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Repeated prohibited attempts trigger a cooldown and flag the session for admin review, so the
 * safety engine cannot be used as an oracle.
 *
 * <p>In-memory (single instance). Swap for a Redis sorted-set implementation before running more
 * than one API instance.
 */
@Component
public class ProbeGuard {

    private final int threshold;
    private final Duration window;
    private final Duration cooldown;
    private final Clock clock;
    private final Map<String, Deque<Instant>> hits = new ConcurrentHashMap<>();
    private final Map<String, Instant> cooldownUntil = new ConcurrentHashMap<>();

    @Autowired
    public ProbeGuard(
            @Value("${labscape.safety.probe-threshold:3}") int threshold,
            @Value("${labscape.safety.probe-window-seconds:600}") long windowSeconds,
            @Value("${labscape.safety.cooldown-seconds:120}") long cooldownSeconds) {
        this(threshold, Duration.ofSeconds(windowSeconds), Duration.ofSeconds(cooldownSeconds), Clock.systemUTC());
    }

    public ProbeGuard(int threshold, Duration window, Duration cooldown, Clock clock) {
        this.threshold = threshold;
        this.window = window;
        this.cooldown = cooldown;
        this.clock = clock;
    }

    /** Remaining cooldown, or zero when the session may continue. */
    public Duration remainingCooldown(String session) {
        Instant until = cooldownUntil.get(session);
        if (until == null) return Duration.ZERO;
        Duration left = Duration.between(clock.instant(), until);
        if (left.isNegative() || left.isZero()) {
            cooldownUntil.remove(session);
            return Duration.ZERO;
        }
        return left;
    }

    /** Records a prohibited result. Returns true when this attempt starts a cooldown (flag for review). */
    public boolean recordProhibited(String session) {
        Instant now = clock.instant();
        Deque<Instant> q = hits.computeIfAbsent(session, k -> new ArrayDeque<>());
        synchronized (q) {
            q.addLast(now);
            while (!q.isEmpty() && q.peekFirst().isBefore(now.minus(window))) q.removeFirst();
            if (q.size() >= threshold) {
                q.clear();
                cooldownUntil.put(session, now.plus(cooldown));
                return true;
            }
            return false;
        }
    }
}
