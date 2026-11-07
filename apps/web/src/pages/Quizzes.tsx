import { FullscreenLab, cx, EmptyState, ErrorState, Skeleton, SUBJECTS, type SubjectKey } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Brain, ListChecks, Play, Sparkles, Target } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { QuizStage } from "../components/QuizStage";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

type QuizCard = { id: string; title: string; experimentSlug: string; subject: SubjectKey; poolSize: number; draw: number; concepts: Record<string, string>; bestScore: number | null; sittings: number };
type Concept = { conceptId: string; label: string; pKnown: number; attempts: number; correct: number; quizId: string; experimentSlug: string };
type Rec = { conceptId: string; label: string; pKnown: number; quizId: string; experimentSlug: string; experimentTitle: string; subject: string; playable: boolean };

/** /quizzes: every quiz, mastery by concept, and practice aimed at the weakest ideas (build plan 4.5). */
export default function Quizzes() {
  const { me } = useSession();
  const quizzes = useQuery({ queryKey: ["quizzes"], queryFn: () => api<QuizCard[]>("/v1/quizzes") });
  const mastery = useQuery({ queryKey: ["mastery"], queryFn: () => api<Concept[]>("/v1/quizzes/mastery"), enabled: !!me });
  const recs = useQuery({ queryKey: ["recommendations"], queryFn: () => api<Rec[]>("/v1/recommendations"), enabled: !!me });
  if (quizzes.isError) return <ErrorState title="Couldn't load quizzes" onRetry={() => void quizzes.refetch()} />;
  const bySubject = (["chemistry", "physics", "maths"] as SubjectKey[]).map((s) => [s, (quizzes.data ?? []).filter((q) => q.subject === s)] as const);
  const seen = (mastery.data ?? []).filter((c) => c.attempts > 0);

  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <header className="relative overflow-hidden rounded-2xl border border-white/[0.08] p-6 sm:p-7" style={{ background: "radial-gradient(700px 300px at 100% 0%, #20c99730, transparent 60%), linear-gradient(160deg,#18233f,#0e1529)" }}>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">
          <ListChecks className="h-4 w-4" /> Labs
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Quizzes</h1>
        <p className="mt-1 max-w-2xl text-sm text-white/65">Every experiment has a quiz, including questions on technique. We track how well you know each idea and build practice around the ones that need work.</p>
        {me && (
          <Link to="/quizzes/practice" className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white">
            <Target className="h-4 w-4" /> Practise my weak spots
          </Link>
        )}
      </header>

      {me && (recs.data?.length ?? 0) > 0 && (
        <section className="rounded-2xl bg-amber-400/[0.06] p-5 ring-1 ring-inset ring-amber-300/20" aria-label="Recommended revision">
          <h2 className="flex items-center gap-2 font-semibold text-amber-100">
            <Sparkles className="h-4 w-4" /> Worth revising
          </h2>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {recs.data!.map((r) => (
              <li key={r.conceptId} className="flex items-center gap-3 rounded-lg bg-black/20 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <b className="text-white">{r.label}</b>
                  <span className="block truncate text-xs text-white/50">{r.experimentTitle}</span>
                </span>
                <Link to={`/quizzes/${r.quizId}`} className="rounded-full px-2.5 py-1 text-xs font-semibold text-emerald-200 ring-1 ring-inset ring-emerald-300/40">
                  Quiz
                </Link>
                {r.playable && r.subject && (
                  <Link to={`/lab/${r.subject}/${r.experimentSlug}`} className="rounded-full px-2.5 py-1 text-xs font-semibold text-accent-cyan ring-1 ring-inset ring-accent/40">
                    Lab
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {me && seen.length > 0 && (
        <section aria-label="Mastery" className="rounded-2xl bg-white/[0.03] p-5 ring-1 ring-inset ring-white/[0.08]">
          <h2 className="flex items-center gap-2 font-semibold text-white">
            <Brain className="h-4 w-4 text-[#c4b1ff]" /> What you know
          </h2>
          <div className="mt-3 grid gap-x-6 gap-y-2 md:grid-cols-2">
            {seen
              .sort((a, b) => a.pKnown - b.pKnown)
              .map((c) => (
                <div key={c.conceptId} className="flex items-center gap-3 text-sm">
                  <span className="w-48 truncate text-white/80">{c.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10" role="meter" aria-label={c.label} aria-valuenow={Math.round(c.pKnown * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <div className={cx("h-full rounded-full", c.pKnown >= 0.95 ? "bg-emerald-400" : c.pKnown >= 0.6 ? "bg-accent" : "bg-amber-300")} style={{ width: `${Math.round(c.pKnown * 100)}%` }} />
                  </div>
                  <span className="w-16 text-right text-xs text-white/45">{c.pKnown >= 0.95 ? "mastered" : `${Math.round(c.pKnown * 100)}%`}</span>
                </div>
              ))}
          </div>
        </section>
      )}

      {quizzes.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {quizzes.data?.length === 0 && <EmptyState title="No quizzes yet" />}
      {bySubject.map(([s, list]) =>
        list.length ? (
          <section key={s} aria-label={SUBJECTS[s].label}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-white/55">
              <span className="h-2 w-2 rounded-full" style={{ background: SUBJECTS[s].color }} />
              {SUBJECTS[s].label}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((q) => (
                <Link key={q.id} to={`/quizzes/${q.id}`} className="group rounded-xl bg-white/[0.035] p-4 ring-1 ring-inset ring-white/[0.08] transition hover:bg-white/[0.06]">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-white">{q.title.replace(/ quiz$/, "")}</h3>
                    {q.bestScore !== null && <span className={cx("rounded-full px-2 py-0.5 text-xs font-bold", q.bestScore >= 80 ? "bg-emerald-400/20 text-emerald-200" : "bg-white/10 text-white/70")}>{q.bestScore}%</span>}
                  </div>
                  <p className="mt-1 text-xs text-white/50">
                    {q.draw} questions from a pool of {q.poolSize} · {Object.keys(q.concepts).length} ideas
                  </p>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent-cyan">
                    <Play className="h-3 w-3" /> {q.sittings ? "Try again" : "Start"}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}

/** /quizzes/:quizId (and /quizzes/practice): one sitting, full screen. */
export function QuizSitting() {
  const { quizId = "" } = useParams();
  const navigate = useNavigate();
  return (
    <FullscreenLab>
      <div className="flex h-screen flex-col bg-[radial-gradient(1200px_500px_at_50%_-10%,rgba(32,201,151,.14),transparent_60%),#0b1020] text-white">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.07] px-4">
          <button onClick={() => navigate("/quizzes")} className="grid h-10 w-10 place-items-center rounded-md text-white/60 hover:bg-white/[0.06] hover:text-white" aria-label="Back to quizzes">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="font-heading font-semibold">{quizId === "practice" ? "Practice" : "Quiz"}</span>
        </header>
        <div className="min-h-0 flex-1">
          <QuizStage quizId={quizId} onDone={() => navigate("/quizzes")} onPractice={() => navigate("/quizzes/practice", { replace: true })} continueLabel="Back to quizzes" />
        </div>
      </div>
    </FullscreenLab>
  );
}
