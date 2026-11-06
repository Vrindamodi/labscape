/**
 * Contract 5 - LabContext snapshot.
 * Producers: every lab, playground and scenario surface.
 * Consumer: Part 4 AI assistant (rides along with every chat message).
 * Treated by the assistant as DATA, never as instructions.
 */
import type { Measurement, Subject } from "./common";
import type { LearningLevel, StageId } from "./experiment";
import type { LabEvent } from "./lab-event";
import type { SimulationResult } from "./simulation";

export type LabSurface = "experiment" | "playground" | "emergency" | "tutorial";

export type LabContext = {
  surface: LabSurface;
  subject?: Subject;
  attemptId: string;
  experimentId?: string;
  experimentVersion?: number;
  stage?: StageId;
  currentStepId?: string;
  completedStepIds: string[];
  userLevel: LearningLevel;
  /** Equipment on the bench and what it contains right now. */
  bench: {
    id: string;
    kind: string;
    contents?: { species: string; volumeMl?: number; massG?: number }[];
    temperatureC?: number;
  }[];
  recentEvents: LabEvent[];
  lastResult?: SimulationResult;
  readings: Measurement[];
  deviations: { stepId: string; code: string; severity: "minor" | "major" | "critical" }[];
  hintsShown: string[];
  /** Ids the assistant may target with highlight(targetId). */
  highlightableIds: string[];
};
