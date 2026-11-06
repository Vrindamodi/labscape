/**
 * Contract 2 - LabEvent stream. Every user action, append-only.
 * Producers: Part 2, 3 and 4 workspaces.
 * Consumers: evaluator, notebook, replay, AI context, analytics.
 */
import type { Measurement, Ulid } from "./common";

export type LabEventType =
  | "equipment.place"
  | "equipment.pickup"
  | "equipment.connect"
  | "liquid.pour"
  | "liquid.drop"
  | "liquid.draw"
  | "solid.add"
  | "mix.stir"
  | "mix.swirl"
  | "mix.shake"
  | "heat.set"
  | "cool.set"
  | "measure.read"
  | "timer.mark"
  | "param.set"
  | "sim.start"
  | "sim.pause"
  | "sim.reset"
  | "hint.shown"
  | "step.completed"
  | "deviation"
  | "outcome";

export type LabEventPayloadMap = {
  "equipment.place": { equipmentId: string; x: number; y: number; socket?: string };
  "equipment.pickup": { equipmentId: string };
  "equipment.connect": { from: string; to: string; port?: string };
  "liquid.pour": {
    from: string;
    to: string;
    volumeMl: number;
    tiltDegMax: number;
    meanRateMlPerS: number;
    peakRateMlPerS: number;
    durationMs: number;
  };
  "liquid.drop": { from: string; to: string; drops: number; volumeMl: number };
  "liquid.draw": { from: string; into: string; volumeMl: number };
  "solid.add": { from: string; to: string; massG: number };
  "mix.stir": { target: string; intensity: "gentle" | "vigorous"; durationMs: number };
  "mix.swirl": { target: string; durationMs: number };
  "mix.shake": { target: string; durationMs: number };
  "heat.set": { target: string; powerPct: number };
  "cool.set": { target: string; method: "ice_bath" | "air" | "water" };
  "measure.read": { instrument: string; reading: Measurement; trueValue?: number };
  "timer.mark": { label: string };
  "param.set": { key: string; value: number | string | boolean };
  "sim.start": Record<string, never>;
  "sim.pause": Record<string, never>;
  "sim.reset": Record<string, never>;
  "hint.shown": { hintId: string; rung: number; stepId?: string };
  "step.completed": { stepId: string };
  deviation: { stepId: string; code: string; severity: "minor" | "major" | "critical" };
  outcome: { simulationRequestId: string; outcome: string };
};

type LabEventOf<K extends LabEventType> = {
  id: Ulid;
  /** Experiment attempt, playground session or scenario attempt. */
  attemptId: string;
  /** Monotonic per attempt; a gap means a lost event. */
  seq: number;
  /** ms since attempt start, on the simulation clock. */
  t: number;
  actor: "user" | "demo" | "system";
  type: K;
  payload: LabEventPayloadMap[K];
  /** Engine state hash after the event; replay checks it. */
  stateHash?: string;
};

/** Discriminated union: narrowing on `type` narrows `payload`. */
export type LabEvent = { [K in LabEventType]: LabEventOf<K> }[LabEventType];

export type LabEventPayload = LabEventPayloadMap[LabEventType];
