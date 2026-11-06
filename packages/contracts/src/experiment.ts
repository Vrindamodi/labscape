/**
 * Contract 1 - ExperimentDefinition and Protocol.
 * Schema owner: Part 2. Content authored through Part 1's admin CMS.
 * Consumers: Part 2/3 player and evaluator; Part 4 quiz, notebook, AI.
 */
import type { Subject } from "./common";
import type { LabEventType } from "./lab-event";

export type Difficulty = "beginner" | "intermediate" | "advanced";

export type LearningLevel =
  | "beginner"
  | "school"
  | "high_school"
  | "undergraduate"
  | "advanced"
  | "exploring";

export type StageId = "intro" | "demo" | "try" | "hints" | "observe" | "quiz";

export type ExperimentDefinition = {
  id: string;
  slug: string;
  version: number;
  subject: Subject;
  topic: string;
  title: string;
  summary: string;
  difficulty: Difficulty;
  levels: LearningLevel[];
  estimatedMinutes: number;
  xpReward: number;
  /** MVP items are spec Phase 1; Later items are Phases 2-4. */
  release: "MVP" | "Later";
  intro: {
    demonstrates: string;
    objective: string;
    concept: string;
    realWorld: string[];
    safety: string[];
  };
  equipment: EquipmentRef[];
  materials: MaterialRef[];
  demo: { goldenRunId: string; durationS: number };
  protocol: Protocol;
  quizId: string;
  explanationRefs: string[];
};

export type EquipmentRef = { id: string; kind: string; label: string; capacityMl?: number };

export type MaterialRef = {
  id: string;
  name: string;
  formula?: string;
  concentrationM?: number;
  state: "s" | "l" | "g" | "aq";
  hazards: string[];
};

export type Protocol = {
  steps: ProtocolStep[];
  /** Weights per scoring dimension across the whole run; must sum to 1. */
  scoring: Partial<Record<ScoreDimension, number>>;
};

export type ScoreDimension =
  | "equipment"
  | "sequence"
  | "quantity"
  | "technique"
  | "mixing"
  | "temperature"
  | "timing"
  | "measurement"
  | "observation";

export type Tolerance = { target: number; plusMinus: number; unit: string };

export type AdditionTechnique =
  | { kind: "pour"; maxRateMlPerS?: number; maxTiltDeg?: number }
  | { kind: "slow_pour"; maxRateMlPerS: number }
  | { kind: "portions"; portionMl: number; mixBetween: boolean }
  | {
      kind: "dropwise";
      dropVolumeMl: number;
      maxRateMlPerS: number;
      appliesWithinMlOfEndpoint?: number;
    }
  | { kind: "pipette"; volume: Tolerance }
  | { kind: "solid"; massG: Tolerance };

export type MixingSpec = {
  kind: "stir_gentle" | "stir_continuous" | "swirl" | "shake" | "settle" | "none";
  during: "each_addition" | "after_addition" | "continuous";
  withinMs?: number;
};

export type DeviationSeverity = "minor" | "major" | "critical";

export type DeviationRule = {
  severity: DeviationSeverity;
  /** modelled = show the engine's real outcome; blocked = stop and explain; hint = nudge only. */
  consequence: "modelled" | "blocked" | "hint";
};

export type ProtocolStep = {
  id: string;
  instruction: string;
  requires?: string[];
  action: LabEventType;
  from?: string;
  to?: string;
  quantity?: Tolerance;
  technique?: AdditionTechnique;
  mixing?: MixingSpec;
  conditions?: { temperatureC?: Tolerance; heat?: boolean; cool?: boolean };
  waitMs?: number;
  stopWhen?: { cue: string; forMs?: number };
  measurement?: { instrument: string; readTo: number; unit: string };
  expectedCues?: string[];
  scoring?: Partial<Record<ScoreDimension, number>>;
  onDeviation?: Record<string, DeviationRule>;
  hints?: string[];
};
