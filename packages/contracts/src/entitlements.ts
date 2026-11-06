/**
 * Contract 7 - Entitlements: useEntitlement(key) on the client plus a server check.
 * Producer: Part 1. Consumers: everyone who gates a feature.
 * The server is authoritative; the client hook only shapes the UI.
 */

export const ENTITLEMENT_KEYS = [
  "ads.hidden",
  "library.full",
  "playground.sessionsPerDay",
  "emergency.all",
  "ai.messagesPerDay",
  "analytics.detailed",
  "reports.export",
  "themes.exclusive",
] as const;

export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

export type PlanId = "free" | "premium_monthly" | "premium_annual";

/** Boolean entitlements are on/off; numeric ones are limits (null = unlimited). */
export type EntitlementValue = boolean | number | null;

export type Entitlements = {
  plan: PlanId;
  values: Record<EntitlementKey, EntitlementValue>;
  /** Remaining usage today for numeric limits. */
  usage: Partial<Record<EntitlementKey, { used: number; resetsAt: string }>>;
};

/** Shape returned by the client hook useEntitlement(key). */
export type EntitlementState = {
  key: EntitlementKey;
  allowed: boolean;
  limit: number | null;
  remaining: number | null;
  loading: boolean;
};
