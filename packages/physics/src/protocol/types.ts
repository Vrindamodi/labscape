import type { LabEvent, LabEventType, ScoreDimension } from "@labscape/contracts";

/**
 * A physics or maths experiment as authored in content/experiments/<slug>.json (what a subject
 * teacher reviews). Behaviour lives in a matching SimModel keyed by slug.
 */
export type SimContent<Setup = Record<string, unknown>> = {
  id: string;
  slug: string;
  version: number;
  subject: "physics" | "maths";
  title: string;
  fidelity: "exact" | "approximate" | "qualitative";
  reviewStatus: "draft" | "in_review" | "approved";
  /** Experiment-specific configuration the model reads (components, targets, seeds, functions). */
  setup: Setup;
  steps: SimStep[];
  hints: Record<string, { rung: 1 | 2 | 3; text: string }>;
  observations: SimObservations;
  golden: SimGolden;
  scoring?: Partial<Record<ScoreDimension, number>>;
};

export type SimStep = {
  id: string;
  title: string;
  instruction: string;
  /** What the student does, for the step card and the demo. */
  action: LabEventType;
  optional?: boolean;
  /** Dimensions this step counts towards (default: sequence + technique). */
  scoring?: Partial<Record<ScoreDimension, number>>;
  hints?: string[];
};

export type SimObservations = {
  whatHappened: string;
  why: string;
  equationLatex: string;
  realWorld: string[];
  prompts: { id: string; question: string; choices: string[]; answer: number; explain: string }[];
};

export type SimGolden = {
  durationS: number;
  captions: { t: number; text: string; slow?: boolean }[];
  events: { t: number; type: LabEventType; payload: Record<string, unknown> }[];
};

export type Severity = "minor" | "major" | "order" | "safety";

export type SimDeviation = {
  stepId: string;
  code: string;
  severity: Severity;
  message: string;
  tag: "procedural" | "conceptual";
  dimension: ScoreDimension;
  t: number;
};

/** What a rule reports; the evaluator fills in the step and time. */
export type RuleHit = Omit<SimDeviation, "stepId" | "t"> & { stepId?: string };

export type SimNote = { text: string; tone: "info" | "success" | "warning" | "danger" };

export type SimFeedback =
  | { kind: "step-complete"; stepId: string; t: number }
  | { kind: "deviation"; deviation: SimDeviation }
  | { kind: "safety-stop"; code: string; title: string; message: string; t: number };

/** Same shape as the chemistry evaluator's Report, so Results, XP and the API need no changes. */
export type SimReport = {
  score: number;
  stars: 0 | 1 | 2 | 3;
  byDimension: Record<ScoreDimension, number | null>;
  deviations: SimDeviation[];
  steps: { id: string; title: string; done: boolean }[];
  hintsUsed: number;
  completed: boolean;
  stoppedForSafety: boolean;
};

export type ApplyCtx = { t: number; content: SimContent };

/**
 * The behaviour behind one experiment: a pure reducer over LabEvents, the checks that complete each
 * step, and rules that spot mistakes. Everything here also runs on the server (GraalJS).
 */
export type SimModel<S = unknown> = {
  slug: string;
  init: (content: SimContent) => S;
  apply: (state: S, e: LabEvent, ctx: ApplyCtx) => { state: S; notes?: SimNote[]; hits?: RuleHit[] };
  /** Step id -> is it done in this state? Steps complete strictly in order. */
  steps: Record<string, (s: S, ctx: ApplyCtx) => boolean>;
  /** A safety hit stops the run (e.g. a dead short left connected). */
  safety?: (s: S) => { code: string; title: string; message: string } | null;
  /** Values for the readout panel and observation stage. */
  readouts?: (s: S) => Record<string, number | string | boolean | null>;
};
