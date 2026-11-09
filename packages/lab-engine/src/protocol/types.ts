import type { DeviationRule, LabEventType, ProtocolStep, ScoreDimension } from "@labscape/contracts";
import type { BenchSetup } from "../engine/state";

/**
 * An experiment as authored (content/experiments/<slug>.json): contract 1's protocol plus what
 * the bench, evaluator, hints, observations and demo need. Reviewed and versioned.
 */
export type ExperimentContent = {
  id: string;
  slug: string;
  version: number;
  subject: "chemistry";
  title: string;
  /** How faithful the model is; shown as a chip on the Observe stage. */
  fidelity: "exact" | "approximate" | "qualitative";
  /** Content is not published until a chemistry teacher signs it off. */
  reviewStatus: "draft" | "in_review" | "approved";
  bench: BenchSetup;
  steps: StepSpec[];
  hints: Record<string, { rung: 1 | 2 | 3; text: string }>;
  observations: Observations;
  safety: SafetyRule[];
  golden: GoldenRun;
  /** Optional "The idea" card shown before the demo: the concept in 2-3 sentences plus a picture-level analogy. */
  idea?: { text: string; analogy: string };
  scoring?: Partial<Record<ScoreDimension, number>>;
};

export type StepSpec = ProtocolStep & {
  /** Other event types that also count for this step (e.g. a burette run as liquid.drop or pour). */
  alsoActions?: LabEventType[];
  /** How the step finishes. Defaults: quantity reached, else the first matching event. */
  complete?: {
    /** A named predicate on the bench state, e.g. "pink-persists:flask-1". */
    predicate?: string;
    /** Finish on the first matching event regardless of quantity. */
    onEvent?: boolean;
  };
  optional?: boolean;
  /** Short label for the step list. */
  title: string;
  /**
   * "What if" texts keyed by deviation code (order, rate, overshoot, quantity, no-mixing,
   * not-dropwise, portion-too-big, wrong-equipment, reading) or a safety rule code: the real-world
   * consequence of that mistake in plain words, shown instead of a bare error. Display only.
   */
  whatIf?: Record<string, string>;
  /** "What if I do it differently?" pairs shown on request in Try (safe alternatives and their effect). Display only. */
  explore?: { if: string; then: string }[];
};

export type SafetyRule = {
  /** A predicate that, once true, stops the run. */
  when: string;
  code: string;
  title: string;
  message: string;
  /** Step the run rewinds to. */
  restartFrom?: string;
};

export type ObservationPrompt = { id: string; question: string; choices: string[]; answer: number; explain: string };

export type Observations = {
  whatHappened: string;
  why: string;
  equationLatex: string;
  realWorld: string[];
  prompts: ObservationPrompt[];
};

export type GoldenRun = {
  durationS: number;
  captions: DemoBeat[];
  /** A LabEvent script (id/seq/attemptId are filled in at replay time). */
  events: { t: number; type: LabEventType; payload: Record<string, unknown> }[];
};

/**
 * One beat of the demo: the caption, plus optional teaching text for the concept panel
 * (why = the science idea, safety = the safety reason). Display only.
 */
export type DemoBeat = { t: number; text: string; slow?: boolean; why?: string; safety?: string };

export type Severity = "minor" | "major" | "order" | "safety";

export type Deviation = {
  stepId: string;
  code: string;
  severity: Severity;
  message: string;
  /** procedural = how it was done; conceptual = what was understood. */
  tag: "procedural" | "conceptual";
  dimension: ScoreDimension;
  t: number;
};

export type Feedback =
  | { kind: "step-complete"; stepId: string; t: number }
  | { kind: "deviation"; deviation: Deviation; rule?: DeviationRule }
  | { kind: "safety-stop"; rule: SafetyRule; t: number }
  | { kind: "hint-suggest"; stepId: string; reason: "idle" | "fails" | "rate" | "equipment"; t: number };

export type StepProgress = {
  id: string;
  done: boolean;
  doneAt: number | null;
  amount: number;
  additions: number;
  lastAdditionAt: number | null;
  unmixedSince: number | null;
  predicateSince: number | null;
  failures: number;
  penalties: Partial<Record<ScoreDimension, number>>;
};

export type Report = {
  score: number;
  stars: 0 | 1 | 2 | 3;
  byDimension: Record<ScoreDimension, number | null>;
  deviations: Deviation[];
  steps: { id: string; title: string; done: boolean }[];
  hintsUsed: number;
  completed: boolean;
  stoppedForSafety: boolean;
};
