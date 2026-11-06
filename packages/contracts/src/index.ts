/**
 * @labscape/contracts - the eight shared contracts.
 * Frozen at v1 after week 1. Any change is a PR approved by all four part owners,
 * versioned with semver (CONTRACTS_VERSION below + package.json).
 * Java mirror: apps/api/src/main/java/com/labscape/api/contracts.
 */
export const CONTRACTS_VERSION = "0.3.0";

export * from "./common";
export * from "./experiment"; // 1
export * from "./lab-event"; // 2
export * from "./simulation"; // 3
export * from "./progress"; // 4
export * from "./lab-context"; // 5
export * from "./quiz"; // 6
export * from "./entitlements"; // 7
export * from "./shell-slots"; // 8
