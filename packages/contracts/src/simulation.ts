/**
 * Contract 3 - SimulationRequest and SimulationResult.
 * Producers: Part 2 chemistry engine, Part 3 physics and maths engines.
 * Consumers: animation layers, Part 4 safety, playground, AI.
 *
 * Rule: engines decide WHAT happens; animation layers decide HOW it looks.
 * Nothing (colour change, bubble, precipitate...) is drawn without a cue from an engine.
 *
 * v0.2.0: cues carry optional startMs; added `layers` cue, `fraction` on dissolve,
 * `stirring` condition and the optional `presentation` block used by outcome panels.
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
  conditions?: { temperatureC?: number; pressureKPa?: number; stirring?: boolean };
};

export type SimulationInput = {
  /** Catalogue id. There is no free-text chemical entry anywhere in LABscape. */
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

/**
 * Targets: "vessel" (the liquid), "solid:<catalogueId>" (a solid in the vessel),
 * "precipitate:<formula>" (a precipitate created by an earlier cue).
 */
type CueBase = { target: string; startMs?: number };

export type ObservationCue =
  | (CueBase & {
      kind: "colour";
      from: Oklab;
      to: Oklab;
      startMs: number;
      durationMs: number;
      curve: "linear" | "sigmoid" | "flash-fade";
    })
  | (CueBase & {
      kind: "gas";
      ratePerS: number;
      bubble: "fine" | "medium" | "coarse";
      gas: string;
      durationMs: number;
    })
  | (CueBase & {
      kind: "precipitate";
      id: string;
      colour: Oklab;
      turbidity: number;
      settleMs: number;
    })
  | (CueBase & { kind: "temperature"; deltaC: number; tauMs: number })
  | (CueBase & { kind: "dissolve"; durationMs: number; fraction?: number })
  | (CueBase & { kind: "deposit"; colour: Oklab; durationMs: number })
  | (CueBase & { kind: "light"; colour: Oklab; intensity: number; durationMs: number })
  | (CueBase & { kind: "layers"; colour: Oklab; volumeMl: number })
  | (CueBase & { kind: "odour"; description: string })
  | (CueBase & { kind: "sound"; soundId: string });

export type ReactionSummary = {
  id: string;
  name: string;
  /** e.g. neutralisation, precipitation, displacement, redox, gas, indicator, catalysis */
  type: string;
  equationLatex: string;
  discoveryId?: string;
};

/** User-facing copy for outcome panels. Prohibited copy is identical for every request. */
export type SimulationPresentation = {
  title: string;
  message: string;
  observations: string[];
  reactions: ReactionSummary[];
  /** needs_conditions: which control to highlight ("heater" | "catalyst" | "acid"). */
  neededTool?: string;
  /** out_of_range: which input ref to highlight. */
  focusRef?: string;
  suggestions: string[];
  discoveryIds: string[];
};

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
  presentation?: SimulationPresentation;
};
