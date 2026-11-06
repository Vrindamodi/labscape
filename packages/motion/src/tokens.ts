/** Motion tokens from the build plan ("Motion system"). Durations in ms. */

export const dur = {
  instant: 80, // press feedback
  fast: 150, // hover, toggles, chips
  base: 240, // cards, panels, sheets
  slow: 400, // page and stage transitions
  deliberate: 700, // XP fly-to-counter, reveals
  cinematic: { min: 1200, max: 2500 }, // level-up, molecular dive, scenario intros
} as const;

export const ease = {
  standard: [0.2, 0, 0, 1], // default
  enter: [0.05, 0.7, 0.1, 1], // things arriving
  exit: [0.3, 0, 0.8, 0.15], // things leaving
} as const satisfies Record<string, readonly [number, number, number, number]>;

export const spring = {
  snappy: { stiffness: 500, damping: 32 }, // buttons, toggles
  gentle: { stiffness: 220, damping: 26 }, // panels, drawers
  bouncy: { stiffness: 320, damping: 14 }, // rewards, badges
  drag: { stiffness: 400, damping: 35 }, // equipment following the pointer
} as const;

/** Lists and grids: 40 ms per item, first 8 items only. */
export const stagger = { perItemMs: 40, maxItems: 8 } as const;

export const reducedMotion = {
  maxCrossfadeMs: 150,
  particleScale: 0.2,
  parallax: false,
  cameraMoves: false,
} as const;

/** Animation speed setting scales UI durations only (simulation speed is separate, per lab). */
export const animationSpeed = { min: 0.5, max: 2, default: 1 } as const;

export type QualityTier = "ultra" | "high" | "lite" | "2d-fallback";

/** Lite turns on when device memory < 4 GB, or fps stays < 45 for 2 s. */
export const liteTrigger = { deviceMemoryGbBelow: 4, fpsBelow: 45, sustainedMs: 2000 } as const;
export const liteTier = {
  particleScale: 0.4,
  bloom: false,
  refraction: false,
  idleBackgroundFps: 30,
} as const;

/** Celebrations are always skippable and never block input for more than this. */
export const maxCelebrationInputBlockMs = 600;

export type ParticlePreset = "confetti" | "sparkle" | "bubbles" | "embers";

export type CelebrateKind =
  | "xp"
  | "level_up"
  | "badge"
  | "streak"
  | "experiment_complete"
  | "perfect_quiz";

/** Signature of celebrate(), implemented by Part 1. */
export type CelebrateFn = (args: {
  kind: CelebrateKind;
  payload?: unknown;
  originEl?: Element | null;
}) => void;

/** Scale a UI duration by the user's animation-speed setting. */
export function scaled(ms: number, speed: number = animationSpeed.default): number {
  const s = Math.min(animationSpeed.max, Math.max(animationSpeed.min, speed));
  return Math.round(ms / s);
}
