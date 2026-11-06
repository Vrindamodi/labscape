/**
 * Contract 3 - SimulationRequest and SimulationResult.
 * Producers: Part 2 chemistry engine, Part 3 physics and maths engines.
 * Consumers: animation layers, Part 4 safety, playground, AI.
 *
 * Rule: engines decide WHAT happens; animation layers decide HOW it looks.
 * Nothing (colour change, bubble, precipitate...) is drawn without a cue from an engine.
 */
import type { Measurement, Oklab, Subject } from "./common";

export type SimulationMode = "experiment" | "sandbox" | "demo" | "tutorial";

export type SimulationRequest = {
  id: string;
  subject: Subject;
  mode: SimulationMode;
  attemptId: string;
  /** Experiment id + version when mode is experiment/demo/tutorial. */
  experimentId?: string;
  experimentVersion?: number;
  /** Signed reaction pack version the client engine ran (server re-checks). */
  packVersion?: string;
  inputs: SimulationInput[];
  conditions?: { temperatureC?: number; pressureKPa?: number };
};

export type SimulationInput = {
  ref: string;
  amount: number;
  unit: "mL" | "g" | "mol" | "drops";
  concentrationM?: number;
};

export type SimulationOutcome =
  | "reaction"
  | "no_reaction"
  | "needs_conditions"
  | "unsupported"
  | "out_of_range"
  | "procedure_mismatch"
  | "prohibited";

export type Phase = "s" | "l" | "g" | "aq";

export type Species = { id: string; formula: string; amountMol: number; phase: Phase };

export type ObservationCue =
  | {
      kind: "colour";
      target: string;
      from: Oklab;
      to: Oklab;
      startMs: number;
      durationMs: number;
      curve: "linear" | "sigmoid" | "flash-fade";
    }
  | {
      kind: "gas";
      target: string;
      ratePerS: number;
      bubble: "fine" | "medium" | "coarse";
      gas: string;
      durationMs: number;
    }
  | { kind: "precipitate"; target: string; colour: Oklab; turbidity: number; settleMs: number }
  | { kind: "temperature"; target: string; deltaC: number; tauMs: number }
  | { kind: "dissolve"; target: string; durationMs: number }
  | { kind: "deposit"; target: string; colour: Oklab; durationMs: number }
  | { kind: "light"; target: string; colour: Oklab; intensity: number; durationMs: number }
  | { kind: "odour"; target: string; description: string }
  | { kind: "sound"; target: string; soundId: string };

export type SimulationResult = {
  requestId: string;
  outcome: SimulationOutcome;
  /** e.g. NEEDS_HEAT, NOT_MODELLED, QTY_ABOVE_LIMIT */
  reasonCode?: string;
  reactionId?: string;
  reactionVersion?: number;
  equationLatex?: string;
  species: Species[];
  /** What the animation layer must show, in order. */
  cues: ObservationCue[];
  measurements: Measurement[];
  fidelity: "exact" | "approximate" | "qualitative";
  /** Content ids the AI and observation panel may quote. */
  explanationRefs: string[];
};
