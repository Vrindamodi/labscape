import type { RewardResult } from "@labscape/contracts";
import { QuizRunner, type QuizResult, type Started } from "@labscape/quiz";
import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { post } from "../lib/api";
import { emitReward } from "../lib/session";

const EquipmentViewer = lazy(() => import("@labscape/lab-engine").then((m) => ({ default: m.EquipmentViewer })));

/** <QuizRunner> wired to the API: start, submit, XP celebration and the 3D equipment viewer. */
export function QuizStage({ quizId, experimentAttemptId, onDone, onPractice, continueLabel }: { quizId: string; experimentAttemptId?: string; onDone: (r: QuizResult) => void; onPractice?: () => void; continueLabel?: string }) {
  const qc = useQueryClient();
  return (
    <QuizRunner
      key={quizId}
      start={() => post<Started>(quizId === "practice" ? "/v1/quizzes/practice/start" : `/v1/quizzes/${quizId}/start`, experimentAttemptId ? { experimentAttemptId } : {})}
      submit={async (attemptId, body) => {
        const r = await post<QuizResult>(`/v1/quizzes/attempts/${attemptId}/submit`, body);
        const reward = r.reward as RewardResult | undefined;
        if (reward && !reward.duplicate) emitReward({ result: reward, origin: { x: window.innerWidth / 2, y: window.innerHeight / 3 }, label: "Quiz" });
        void qc.invalidateQueries({ queryKey: ["quizzes"] });
        void qc.invalidateQueries({ queryKey: ["mastery"] });
        void qc.invalidateQueries({ queryKey: ["recommendations"] });
        return r;
      }}
      onComplete={onDone}
      {...(onPractice ? { onPractice } : {})}
      {...(continueLabel ? { continueLabel } : {})}
      renderEquipment={(kind) => (
        <Suspense fallback={null}>
          <EquipmentViewer kind={kind as never} />
        </Suspense>
      )}
    />
  );
}
