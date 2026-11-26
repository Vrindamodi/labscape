import type { RewardResult } from "@labscape/contracts";
import { sound } from "@labscape/audio";
import { ScenarioPlayer, type Chosen, type HintRung, type ScenarioResult, type Started } from "@labscape/scenarios";
import { cx, ErrorState, FullscreenLab, Skeleton } from "@labscape/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Crown, Droplets, Flame, Hand, Lock, ShieldAlert, Zap } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AssistantDock, emergencyChips } from "../components/AssistantDock";
import { PageHeader } from "../components/PageHeader";
import { QuizStage } from "../components/QuizStage";
import { api, post } from "../lib/api";
import { setLabContext, type PublishedContext } from "../lib/labContext";
import { emitReward, useSession } from "../lib/session";

type Card = { slug: string; title: string; summary: string; kind: "fire" | "spill" | "electric" | "burn"; minutes: number; free: boolean; locked: boolean; bestScore: number | null; reviewStatus: string };
const ICON = { fire: Flame, spill: Droplets, electric: Zap, burn: Hand } as const;
const TINT = { fire: "#ff6b35", spill: "#ffd43b", electric: "#74c0fc", burn: "#ff8787" } as const;

/** /emergency: the scenario list (build plan 4.3). No ads on any emergency screen. */
export default function Emergency() {
  const { me } = useSession();
  const q = useQuery({ queryKey: ["scenarios"], queryFn: () => api<Card[]>("/v1/emergency/scenarios") });
  if (q.isError) return <ErrorState title="Couldn't load the scenarios" onRetry={() => void q.refetch()} />;
  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <PageHeader
        eyebrow="Labs"
        title="Emergency simulator"
        sub="Step into the room and act it out: grab a wet towel, flip the MCB, reach for the eyewash. Spot the danger, do the right thing fast, and get help. Every scenario ends with a replay of what you did, a debrief and a short quiz."
        className="mb-2"
      />
      <div className="flex items-start gap-3 rounded-card bg-[#FDE3E0] p-4 text-sm text-[#7A1D16]">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Training only, not a substitute for emergency services or certified training. In a real emergency in India, call 112.</p>
      </div>
      {q.isLoading && <Skeleton className="h-48 rounded-card" />}
      <div className="grid gap-4 sm:grid-cols-2">
        {(q.data ?? []).map((s) => {
          const I = ICON[s.kind];
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-12 w-12 place-items-center rounded-full text-[#1a1a1a]" style={{ background: TINT[s.kind] }}>
                  <I className="h-6 w-6" />
                </span>
                {s.locked ? (
                  <span className="flex items-center gap-1 rounded-full bg-tint-yellow px-2.5 py-1 text-xs font-semibold text-[#3d2a00]">
                    <Crown className="h-3.5 w-3.5" /> Premium
                  </span>
                ) : s.bestScore !== null ? (
                  <span className={cx("rounded-full px-2.5 py-1 text-xs font-semibold", s.bestScore >= 80 ? "bg-[#DBF6E5] text-[#11703A]" : "bg-line text-ink")}>Best {s.bestScore}</span>
                ) : null}
              </div>
              <h2 className="mt-4 font-heading text-xl font-medium text-ink-strong">{s.title}</h2>
              <p className="mt-1 text-sm text-ink-muted">{s.summary}</p>
              <p className="mt-4 text-xs text-ink-muted">
                About {s.minutes} minutes{s.reviewStatus !== "approved" ? " · awaiting safety review" : ""}
              </p>
            </>
          );
          return s.locked ? (
            <Link key={s.slug} to="/plans" className="relative rounded-card bg-card/70 p-6">
              <Lock className="absolute bottom-5 right-5 h-4 w-4 text-ink-muted" />
              {body}
            </Link>
          ) : (
            <Link key={s.slug} to={me ? `/emergency/${s.slug}` : "/welcome"} className="rounded-card bg-card p-6 transition hover:shadow-lift">
              {body}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** /emergency/:slug: one scenario, full screen. */
export function EmergencyRun() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  return (
    <FullscreenLab>
      <div className="flex h-screen flex-col bg-[#0b0f1a] text-white">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.07] px-4">
          <button onClick={() => navigate("/emergency")} className="grid h-10 w-10 place-items-center rounded-md text-white/60 hover:bg-white/[0.06] hover:text-white" aria-label="Leave the scenario">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="font-heading font-semibold">Emergency simulator</span>
        </header>
        <div className="min-h-0 flex-1">
          <ScenarioPlayer
            start={() => post<Started>(`/v1/emergency/scenarios/${slug}/start`, {})}
            choose={(id, choiceId, elapsedMs) => post<Chosen>(`/v1/emergency/attempts/${id}/choose`, { choiceId, elapsedMs })}
            finish={(id) => post<ScenarioResult>(`/v1/emergency/attempts/${id}/finish`, {})}
            hint={(id) => post<HintRung>(`/v1/emergency/attempts/${id}/hint`, {})}
            slug={slug}
            onContext={(ctx) => setLabContext(ctx as unknown as PublishedContext | null)}
            renderHelper={(h) => (
              <AssistantDock
                compact
                panel={{
                  getContext: h.getContext,
                  onSend: h.onAsk,
                  suggestions: emergencyChips(slug),
                  title: "Safety coach",
                  subtitle: "Talks you through it; the clock is paused",
                  intro: "Stuck? Tell me what you're unsure about. I'll help you think it through first, and if you're still stuck, I'll tell you the safe move. Real emergency in India: call 112.",
                  placeholder: "Ask about this emergency…",
                  fallback: { label: "Use a hint instead", onClick: h.fallBackToHints },
                  onClose: h.onClose,
                  closeLabel: "Close the safety coach",
                }}
              />
            )}
            onResult={(r) => {
              const reward = r.reward as RewardResult | undefined;
              if (reward && !reward.duplicate) emitReward({ result: reward, origin: { x: window.innerWidth / 2, y: window.innerHeight / 3 }, label: "Emergency scenario" });
              void qc.invalidateQueries({ queryKey: ["scenarios"] });
            }}
            renderQuiz={(quizId, onDone) => <QuizStage quizId={quizId} onDone={onDone} continueLabel="Back to scenarios" />}
            onExit={() => navigate("/emergency")}
            play={(s) => sound.play(s)}
          />
        </div>
      </div>
    </FullscreenLab>
  );
}
