// @labscape/audio - owned by Part 1. Channel config is part of the shared foundation;
// the Howler.js-based sound bus is built in Part 1.

export type AudioChannel = "ui" | "lab" | "ambient" | "alert" | "voice";

export const AUDIO_CHANNELS: readonly AudioChannel[] = ["ui", "lab", "ambient", "alert", "voice"];

/** Ducking rules: alerts duck ambient by 12 dB; AI speech ducks lab sound by 8 dB. */
export const DUCKING = [
  { trigger: "alert", target: "ambient", db: -12 },
  { trigger: "voice", target: "lab", db: -8 },
] as const satisfies readonly { trigger: AudioChannel; target: AudioChannel; db: number }[];

export const MAX_SIMULTANEOUS_VOICES = 16;

/** Mobile haptics patterns. */
export type HapticPattern = "tick" | "tap" | "success";
export const HAPTICS: Record<HapticPattern, string> = {
  tick: "light tick on snap",
  tap: "medium tap on placement",
  success: "success pattern on completion",
};
