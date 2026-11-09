/**
 * Contract 3 - SimulationRequest and SimulationResult.
 * Producers: Part 2 chemistry engine, Part 3 physics and maths engines.
 * Consumers: animation layers, Part 4 safety, playground, AI.
 *
 * Rule: engines decide WHAT happens; animation layers decide HOW it looks.
 * Nothing (colour change, bubble, precipitate...) is drawn without a cue from an engine.
 *
 * v0.4.0: `crystals` cue; optional `form` on precipitate and deposit cues.
 * v0.3.0: ignition condition, smoke/flame/condense/skate cues, gas colour + smell,
 * compounds, facts and structured participants.
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
  conditions?: {
    temperatureC?: number;
    pressureKPa?: number;
    stirring?: boolean;
    /** A flame or spark has been applied to the mixture (sticky for the vessel). */
    ignition?: boolean;
  };
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
      /** Visible colour of the gas, when it has one (e.g. chlorine, bromine vapour). */
      colour?: Oklab;
      /** What it smells like. Never sniff directly - waft. */
      smell?: string;
      /** Real-lab hazard of the gas, when it has one. */
      hazard?: "toxic" | "corrosive" | "flammable";
      /** One-line safety warning to show with the hazard. */
      warning?: string;
    })
  | (CueBase & {
      kind: "precipitate";
      id: string;
      colour: Oklab;
      turbidity: number;
      settleMs: number;
      /** v0.4: "crystals" for glittering plates (e.g. lead(II) iodide); default powder. */
      form?: "powder" | "crystals";
    })
  | (CueBase & { kind: "temperature"; deltaC: number; tauMs: number })
  | (CueBase & { kind: "dissolve"; durationMs: number; fraction?: number })
  | (CueBase & {
      kind: "deposit";
      colour: Oklab;
      durationMs: number;
      /** v0.4: "crystals" for a sparkly growth (silver tree); default an even coating. */
      form?: "coating" | "crystals";
    })
  | (CueBase & { kind: "light"; colour: Oklab; intensity: number; durationMs: number })
  | (CueBase & { kind: "layers"; colour: Oklab; volumeMl: number })
  | (CueBase & {
      kind: "smoke";
      colour: Oklab;
      density: number;
      durationMs: number;
      label?: string;
    })
  | (CueBase & { kind: "flame"; colour: Oklab; intensity: number; durationMs: number })
  | (CueBase & { kind: "condense"; colour: Oklab; amount: number; durationMs: number })
  | (CueBase & { kind: "skate"; colour: Oklab; durationMs: number })
  | (CueBase & { kind: "odour"; description: string })
  | (CueBase & { kind: "sound"; soundId: string })
  /** v0.4: crystals growing out of a solution as it evaporates or cools. */
  | (CueBase & { kind: "crystals"; colour: Oklab; amount: number; durationMs: number; label?: string });

export type ReactionSummary = {
  id: string;
  name: string;
  /** e.g. neutralisation, precipitation, displacement, redox, gas, indicator, catalysis */
  type: string;
  equationLatex: string;
  discoveryId?: string;
  /** Structured equation, used to animate atoms rearranging. */
  participants?: { reactants: EquationTerm[]; products: EquationTerm[] };
};

export type EquationTerm = { coef: number; formula: string; charge?: string; state?: string };

/** A substance formed, for the "compounds formed" panel. */
export type CompoundInfo = {
  formula: string;
  name: string;
  state: Phase;
  /** Display colour (hex) of the substance itself. */
  colour?: string;
  note?: string;
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
  compounds: CompoundInfo[];
  /** "Did you know?" facts about the substances and reactions involved. */
  facts: string[];
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
