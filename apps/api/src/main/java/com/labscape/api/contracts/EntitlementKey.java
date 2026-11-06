package com.labscape.api.contracts;

import com.fasterxml.jackson.annotation.JsonValue;

/** Contract 7 - mirrors ENTITLEMENT_KEYS in packages/contracts/src/entitlements.ts. */
public enum EntitlementKey {
    ADS_HIDDEN("ads.hidden"),
    LIBRARY_FULL("library.full"),
    PLAYGROUND_SESSIONS_PER_DAY("playground.sessionsPerDay"),
    EMERGENCY_ALL("emergency.all"),
    AI_MESSAGES_PER_DAY("ai.messagesPerDay"),
    ANALYTICS_DETAILED("analytics.detailed"),
    REPORTS_EXPORT("reports.export"),
    THEMES_EXCLUSIVE("themes.exclusive");

    private final String key;

    EntitlementKey(String key) {
        this.key = key;
    }

    @JsonValue
    public String key() {
        return key;
    }
}
