/** Wire types for the emergency simulator (mirrors EmergencyController). */
export type Kind = "fire" | "spill" | "electric" | "burn";

export type Tool = { id: string; label: string; hint?: string };
/** A target in the 640x360 room. */
export type Hotspot = { id: string; label: string; x: number; y: number; w: number; h: number };
/** Using `tool` on `target` makes the choice `choiceId`. */
export type SceneAction = { choiceId: string; tool: string; target: string };

export type SceneView = {
  id: string;
  stage: "detection" | "assessment" | "decision" | "consequence";
  timerS: number;
  growth: number;
  hazard: number;
  narration: string;
  prompt?: string;
  /** Persistent state of the room in this scene (towel on the regulator, power off...). */
  props?: string[];
  choices: { id: string; label: string }[];
  actions?: SceneAction[];
};

export type Started = { attemptId: string; title: string; kind: Kind; disclaimer: string; scene: SceneView; tools?: Tool[]; hotspots?: Hotspot[] };

export type Chosen = {
  quality: "best" | "ok" | "poor" | "unsafe";
  safe: boolean;
  feedback: string;
  hazard: number;
  next: SceneView | null;
  ending: { id: string; outcome: string; text: string } | null;
  /** The consequence animation for this choice. */
  anim?: string;
};

export type Step = {
  scene: string;
  stage: string;
  choice: string;
  label: string;
  quality: Chosen["quality"];
  feedback: string;
  /** The best choice in that scene, when this one wasn't it. */
  better?: string | null;
  hazard: number;
  anim: string;
  props: string[];
  tool?: string | null;
  target?: string | null;
  /** Hint rungs taken in that scene. */
  hints?: number;
};

/** One rung of a scene's hint ladder (1 nudge, 2 where to look, 3 what to do). */
export type HintRung = {
  scene: string;
  rung: number;
  rungs: number;
  text: string;
  tool?: string | null;
  target?: string | null;
  /** Points this rung cost (0 when seen before). */
  cost: number;
  sceneRungs: number;
  /** The run's total hint cost so far. */
  penalty: number;
};

/**
 * What the assistant sees of the scenario (LabContext, surface "emergency"). The server answers from the reviewed
 * scenario looked up by `scenarioSlug` + `sceneId`; the free text here only helps a language model phrase it.
 */
export type EmergencyAiContext = {
  surface: "emergency";
  attemptId: string;
  userLevel: "school";
  scenarioSlug: string;
  scenarioTitle: string;
  sceneId: string;
  stage: string;
  narration: string;
  prompt: string;
  hazard: number;
  /** Questions already asked to the assistant in this scene: the coach nudges first, then gives the safe move. */
  askedBefore: number;
  hintRung: number;
  tools: string[];
  places: string[];
  /** What the student has done so far in the run. */
  done: { scene: string; did: string; quality: Chosen["quality"] }[];
  completedStepIds: string[];
  hintsShown: string[];
  highlightableIds: string[];
  bench: never[];
  recentEvents: never[];
  readings: never[];
  deviations: never[];
};

export type ScenarioResult = {
  score: number;
  breakdown: { id: string; label: string; score: number; weight: number }[];
  mistakes: { stage: string; choice: string; feedback: string }[];
  learn: string[];
  sources: string[];
  ending: { id: string; outcome: string; text: string };
  disclaimer: string;
  quizId: string;
  badgeEligible: boolean;
  reward?: unknown;
  steps?: Step[] | null;
  hintsUsed?: number;
  hintPenalty?: number;
};
