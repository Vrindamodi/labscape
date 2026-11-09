import type { RewardResult } from "@labscape/contracts";
import { sound } from "@labscape/audio";
import { ScenarioPlayer, type Chosen, type HintRung, type ScenarioResult, type Started } from "@labscape/scenarios";
import { cx, ErrorState, FullscreenLab, Skeleton } from "@labscape/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Crown, Droplets, Flame, Hand, Lock, ShieldAlert, Zap } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AssistantDock, emergencyChips } from "../components/AssistantDock";
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
      <header className="relative overflow-hidden rounded-2xl border border-white/[0.08] p-6 sm:p-7" style={{ background: "radial-gradient(700px 300px at 100% 0%, #e0313140, transparent 60%), linear-gradient(160deg,#18233f,#0e1529)" }}>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-red-300">
          <ShieldAlert className="h-4 w-4" /> Labs
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Emergency simulator</h1>
        <p className="mt-1 max-w-2xl text-sm text-white/65">Step into the room and act it out: grab a wet towel, flip the MCB, reach for the eyewash. Spot the danger, do the right thing fast, and get help. Every scenario ends with a replay of what you did, a debrief and a short quiz.</p>
        <p className="mt-3 text-xs text-white/45">Training only, not a substitute for emergency services or certified training. In a real emergency in India, call 112.</p>
      </header>
      {q.isLoading && <Skeleton className="h-48 rounded-2xl" />}
      <div className="grid gap-4 sm:grid-cols-2">
        {(q.data ?? []).map((s) => {
          const I = ICON[s.kind];
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-11 w-11 place-items-center rounded-xl" style={{ background: `${TINT[s.kind]}25`, color: TINT[s.kind] }}>
                  <I className="h-6 w-6" />
                </span>
                {s.locked ? (
                  <span className="flex items-center gap-1 rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-semibold text-amber-200">
                    <Crown className="h-3.5 w-3.5" /> Premium
                  </span>
                ) : s.bestScore !== null ? (
                  <span className={cx("rounded-full px-2.5 py-1 text-xs font-bold", s.bestScore >= 80 ? "bg-emerald-400/20 text-emerald-200" : "bg-white/10 text-white/70")}>Best {s.bestScore}</span>
                ) : null}
              </div>
              <h2 className="mt-3 text-lg font-bold text-white">{s.title}</h2>
              <p className="mt-1 text-sm text-white/60">{s.summary}</p>
              <p className="mt-3 text-xs text-white/40">
                About {s.minutes} minutes{s.reviewStatus !== "approved" ? " · awaiting safety review" : ""}
              </p>
            </>
          );
          return s.locked ? (
            <Link key={s.slug} to="/plans" className="relative rounded-2xl bg-white/[0.03] p-5 opacity-75 ring-1 ring-inset ring-white/[0.08]">
              <Lock className="absolute right-4 bottom-4 h-4 w-4 text-white/30" />
              {body}
            </Link>
          ) : (
            <Link key={s.slug} to={me ? `/emergency/${s.slug}` : "/welcome"} className="rounded-2xl bg-white/[0.035] p-5 ring-1 ring-inset ring-white/[0.08] transition hover:bg-white/[0.06]">
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
