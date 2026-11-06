package com.labscape.api.contracts;

import java.util.List;

/** Contract 4 (response) - mirrors packages/contracts/src/progress.ts. */
public record RewardResult(
        String idempotencyKey,
        boolean duplicate,
        int xpAwarded,
        List<Adjustment> adjustments,
        long totalXp,
        Level level,
        boolean levelUp,
        List<Badge> badgesUnlocked,
        List<Streak> streaks) {

    public record Adjustment(String reason, int deltaXp) {}

    public record Level(int index, String name, long xpIntoLevel, Long xpForNext) {}

    public record Badge(String id, String name) {}

    public record Streak(String kind, int days) {}
}
