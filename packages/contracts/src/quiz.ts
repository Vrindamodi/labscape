/**
 * Contract 6 - QuizSpec, QuizResult and <QuizRunner>.
 * Producer: Part 4. Consumers: stage 6 of every experiment, emergency debriefs.
 * Grading happens on the server; QuizSpec sent to clients never contains answers.
 */
import type { Ulid } from "./common";

export type QuestionType =
  | "multiple_choice"
  | "true_false"
  | "match"
  | "identify_equipment"
  | "label_diagram"
  | "predict_outcome"
  | "arrange_steps"
  | "numerical"
  | "fill_blank";

type QuestionBase = { id: string; prompt: string; conceptIds: string[]; mediaUrl?: string };

export type Question =
  | (QuestionBase & {
      type: "multiple_choice";
      options: { id: string; text: string }[];
      multi: boolean;
    })
  | (QuestionBase & { type: "true_false" })
  | (QuestionBase & {
      type: "match";
      left: { id: string; text: string }[];
      right: { id: string; text: string }[];
    })
  | (QuestionBase & { type: "identify_equipment"; options: { id: string; text: string }[] })
  | (QuestionBase & {
      type: "label_diagram";
      labels: { id: string; text: string }[];
      targets: { id: string; x: number; y: number }[];
    })
  | (QuestionBase & { type: "predict_outcome"; options: { id: string; text: string }[] })
  | (QuestionBase & { type: "arrange_steps"; steps: { id: string; text: string }[] })
  | (QuestionBase & { type: "numerical"; unit: string })
  | (QuestionBase & { type: "fill_blank"; blanks: number });

export type QuizSpec = {
  id: string;
  version: number;
  title: string;
  experimentId?: string;
  scenarioId?: string;
  /** Drawn and shuffled from the pool per attempt (3-7 per experiment). */
  questions: Question[];
  passPct: number;
};

export type Answer =
  | {
      questionId: string;
      type: "multiple_choice" | "identify_equipment" | "predict_outcome";
      optionIds: string[];
    }
  | { questionId: string; type: "true_false"; value: boolean }
  | { questionId: string; type: "match"; pairs: [string, string][] }
  | { questionId: string; type: "label_diagram"; placements: [string, string][] }
  | { questionId: string; type: "arrange_steps"; order: string[] }
  | { questionId: string; type: "numerical"; value: number; unit: string }
  | { questionId: string; type: "fill_blank"; values: string[] };

export type QuizSubmission = {
  quizId: string;
  attemptId: Ulid;
  idempotencyKey: string;
  answers: Answer[];
};

export type QuizResult = {
  quizId: string;
  attemptId: Ulid;
  scorePct: number;
  passed: boolean;
  perQuestion: { questionId: string; credit: number; correct: boolean; explanation: string }[];
  xpAwarded: number;
  revisionConceptIds: string[];
};

/** Props of Part 4's <QuizRunner> component, mounted in stage 6. */
export type QuizRunnerProps = {
  quizId: string;
  attemptId: string;
  onComplete: (result: QuizResult) => void;
};
