/**
 * Contract 4 - ProgressEvent -> RewardResult (server-side XP).
 * Producers: any part. Consumer: Part 1 rewards service and celebrate().
 * The server is authoritative: sending the same idempotencyKey twice awards XP once.
 */
import type { IsoDateTime, Subject } from "./common";

export type ProgressEventKind =
  | "experiment.completed"
  | "quiz.completed"
  | "challenge.completed"
  | "scenario.completed"
  | "concept.discovered"
  | "chapter.completed"
  | "playground.discovery"
  | "molecular_view.opened"
  | "onboarding.completed";

export type ProgressEvent = {
  /** Client-generated ULID; required on every award request. */
  idempotencyKey: string;
  kind: ProgressEventKind;
  occurredAt: IsoDateTime;
  subject?: Subject;
  /** experimentId, quizId, scenarioId, conceptId ... depending on kind. */
  refId: string;
  attemptId?: string;
  /** 0-100, for experiments, quizzes and scenarios. */
  score?: number;
};

export type LevelName =
  | "Lab Trainee"
  | "Junior Scientist"
  | "Science Explorer"
  | "Lab Specialist"
  | "Research Scientist"
  | "Senior Researcher"
  | "Master Scientist";

export type RewardResult = {
  idempotencyKey: string;
  /** True when this key was already processed; xpAwarded is then 0. */
  duplicate: boolean;
  xpAwarded: number;
  /** Why the amount differs from the base value (repeat rule, daily cap...). */
  adjustments: { reason: string; deltaXp: number }[];
  totalXp: number;
  level: { index: number; name: LevelName; xpIntoLevel: number; xpForNext: number | null };
  levelUp: boolean;
  badgesUnlocked: { id: string; name: string }[];
  streaks: { kind: "login" | "experiment" | "quiz" | "weekly_challenge"; days: number }[];
};
