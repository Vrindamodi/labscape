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
};
