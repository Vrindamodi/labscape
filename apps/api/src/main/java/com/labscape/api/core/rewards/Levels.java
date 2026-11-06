package com.labscape.api.core.rewards;

import com.labscape.api.contracts.RewardResult;
import java.util.List;

/** Seven levels with the build plan's proposed thresholds (tune after playtests). */
public final class Levels {

    public static final List<String> NAMES = List.of(
            "Lab Trainee", "Junior Scientist", "Science Explorer", "Lab Specialist",
            "Research Scientist", "Senior Researcher", "Master Scientist");

    public static final long[] THRESHOLDS = {0, 500, 1_500, 3_500, 7_000, 12_000, 20_000};

    private Levels() {}

    public static int index(long totalXp) {
        int i = 0;
        while (i + 1 < THRESHOLDS.length && totalXp >= THRESHOLDS[i + 1]) i++;
        return i;
    }

    public static RewardResult.Level of(long totalXp) {
        int i = index(totalXp);
        Long next = i + 1 < THRESHOLDS.length ? THRESHOLDS[i + 1] - THRESHOLDS[i] : null;
        return new RewardResult.Level(i, NAMES.get(i), totalXp - THRESHOLDS[i], next);
    }
}
