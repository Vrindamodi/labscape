/**
 * Contract 3 - SimulationRequest and SimulationResult.
 * Producers: Part 2 chemistry engine, Part 3 physics and maths engines.
 * Consumers: animation layers, Part 4 safety, playground, AI.
 *
 * Rule: engines decide WHAT happens; animation layers decide HOW it looks.
 * Nothing (colour change, bubble, precipitate...) is drawn without a cue from an engine.
 *
 * v0.8.0 (additive): the `evaporate` condition boils a vessel dry over a burner once everything in it has
 * reacted (an evaporating basin); it answers with an `evaporate` cue naming the residue, or with a procedure
 * mismatch (reason code `EVAPORATE_...`) when the mixture must not go over a flame. Dry crystals carried on
 * through `bases` dissolve again when water is added, and what strong heating leaves is carried on too.
 * v0.7.0 (additive): `gas` cues may carry `tests`, how the gas answers a lit splint, a glowing splint and
 * damp red and blue litmus.
 * v0.6.0 (additive): a request may carry `bases` - earlier mixes that were poured, split or filtered into
 * this vessel before its own inputs were added - so products persist from one vessel to the next; precipitate
 * cues may be `carried` (a solid that was already there, shown settled with no fanfare).
 * v0.5.0 (additive): `layers` cues carry optional `position` ("top" | "bottom") and `label`;
 * deposit cues may use `form: "mirror"` (silver mirror on the glass, target "vessel");
 * needs_conditions may set `focusRef` to the catalogue id that satisfies the condition (e.g. "h2so4-conc"),
 * and `neededTool` may also be "alkali" or "spark" (strong heating with the flame tool).
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
    /**
     * v0.8: once everything has reacted, the vessel goes over a burner until all the water has boiled away.
     * The only way past the hot plate's 90 °C; `temperatureC` is ignored for that stage.
     */
    evaporate?: boolean;
  };
  /** v0.6: what the vessel already held when `inputs` were added. With bases, `inputs` may be empty. At most 3. */
  bases?: SimulationBase[];
};

/**
 * v0.6: an earlier mix and the part of it that came across. The server replays it (and whatever it was
 * made from) with the same engine, then hands on `fraction` of the kept part: everything ("all"), only what
 * runs through a filter paper ("filtrate") or only what stays on it ("residue"). Every safety check covers
 * the whole chain.
 */
/**
 * One standard gas test. `result` is what it shows: "pop", "brighter", "out" or "relights" for a splint, the
 * colour a damp litmus paper ends up ("red", "blue", or "white" when bleached), or "none" when nothing changes.
 */
export type GasTest = { result: "pop" | "brighter" | "out" | "relights" | "red" | "blue" | "white" | "none"; note: string };
export type GasTests = { litSplint: GasTest; glowingSplint: GasTest; blueLitmus: GasTest; redLitmus: GasTest };

export type SimulationBase = {
  inputs: SimulationInput[];
  conditions?: SimulationRequest["conditions"];
  bases?: SimulationBase[];
  keep: "all" | "filtrate" | "residue";
  /** Share of the kept part that was carried on, 0 < fraction <= 1. */
  fraction: number;
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
      /** How the gas answers the standard tests, when the engine knows (v0.7.0). */
      tests?: GasTests;
    })
  | (CueBase & {
      kind: "precipitate";
      id: string;
      colour: Oklab;
      turbidity: number;
      settleMs: number;
      /** v0.4: "crystals" for glittering plates (e.g. lead(II) iodide); default powder. */
      form?: "powder" | "crystals";
      /** v0.6: this solid was carried in from an earlier vessel; it did not just form. */
      carried?: boolean;
    })
  | (CueBase & { kind: "temperature"; deltaC: number; tauMs: number })
  | (CueBase & { kind: "dissolve"; durationMs: number; fraction?: number })
  | (CueBase & {
      kind: "deposit";
      colour: Oklab;
      durationMs: number;
      /** v0.4: "crystals" for a sparkly growth (silver tree); default an even coating. v0.5: "mirror" = silver mirror on the glass. */
      form?: "coating" | "crystals" | "mirror";
    })
  | (CueBase & { kind: "light"; colour: Oklab; intensity: number; durationMs: number })
  | (CueBase & {
      kind: "layers";
      colour: Oklab;
      volumeMl: number;
      /** v0.5: where the separate layer sits - "top" (less dense than the rest, e.g. oil, hexane) or "bottom". Default top. */
      position?: "top" | "bottom";
      /** v0.5: caption, e.g. "Hexane floats on top as a separate layer". */
      label?: string;
    })
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
  | (CueBase & { kind: "crystals"; colour: Oklab; amount: number; durationMs: number; label?: string })
  /** v0.8: the water (`volumeMl` of it) boils away; `residue` is what it leaves, most first. `amount` is 0..1, how much to draw. */
  | (CueBase & { kind: "evaporate"; durationMs: number; volumeMl: number; residue: { id: string; name: string; colour: Oklab; amount: number }[] });

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
  /** needs_conditions: which control to highlight ("heater" | "catalyst" | "acid" | "alkali" | "spark"). */
  neededTool?: string;
  /** out_of_range: which input ref to highlight. needs_conditions: the catalogue id that would satisfy the condition. */
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
