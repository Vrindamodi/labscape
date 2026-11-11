import { FullscreenLab, cx, EmptyState, ErrorState, Skeleton, SUBJECTS, type SubjectKey } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Brain, Play, Sparkles, Target } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CardTitle, PageHeader } from "../components/PageHeader";
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
      <PageHeader
        eyebrow="Labs"
        title="Quizzes"
        sub="Every experiment has a quiz, including questions on technique. We track how well you know each idea and build practice around the ones that need work."
        aside={
          me && (
            <Link to="/quizzes/practice" className="inline-flex h-11 items-center gap-2 rounded-full bg-ink-strong px-5 text-sm font-medium text-on-ink transition hover:bg-ink-strong/85">
              <Target className="h-4 w-4" /> Practise my weak spots
            </Link>
          )
        }
        className="mb-2"
      />

      {me && (recs.data?.length ?? 0) > 0 && (
        <section className="rounded-card bg-[#FFF4CF] p-5 sm:p-6" aria-label="Recommended revision">
          <h2 className="flex items-center gap-2 font-heading text-lg font-medium text-[#3d2a00]">
            <Sparkles className="h-4 w-4" /> Worth revising
          </h2>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {recs.data!.map((r) => (
              <li key={r.conceptId} className="flex items-center gap-3 rounded-[18px] bg-card px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <b className="font-medium text-ink-strong">{r.label}</b>
                  <span className="block truncate text-xs text-ink-muted">{r.experimentTitle}</span>
                </span>
                <Link to={`/quizzes/${r.quizId}`} className="rounded-full bg-ink-strong px-3 py-1 text-xs font-medium text-on-ink transition hover:bg-ink-strong/85">
                  Quiz
                </Link>
                {r.playable && r.subject && (
                  <Link to={`/lab/${r.subject}/${r.experimentSlug}`} className="rounded-full bg-line px-3 py-1 text-xs font-medium text-ink transition hover:bg-line-strong">
                    Lab
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {me && seen.length > 0 && (
        <section aria-label="Mastery" className="rounded-card bg-card p-6">
          <CardTitle icon={<Brain className="h-4 w-4 text-[#6D28D9]" />} className="text-lg">What you know</CardTitle>
          <div className="mt-4 grid gap-x-6 gap-y-2.5 md:grid-cols-2">
            {seen
              .sort((a, b) => a.pKnown - b.pKnown)
              .map((c) => (
                <div key={c.conceptId} className="flex items-center gap-3 text-sm">
                  <span className="w-48 truncate text-ink">{c.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10" role="meter" aria-label={c.label} aria-valuenow={Math.round(c.pKnown * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <div className={cx("h-full rounded-full", c.pKnown >= 0.95 ? "bg-[#1E8E3E]" : c.pKnown >= 0.6 ? "bg-accent" : "bg-[#E0A020]")} style={{ width: `${Math.round(c.pKnown * 100)}%` }} />
                  </div>
                  <span className="w-16 text-right text-xs text-ink-muted">{c.pKnown >= 0.95 ? "mastered" : `${Math.round(c.pKnown * 100)}%`}</span>
                </div>
              ))}
          </div>
        </section>
      )}

      {quizzes.isLoading && <Skeleton className="h-64 rounded-card" />}
      {quizzes.data?.length === 0 && <EmptyState title="No quizzes yet" />}
      {bySubject.map(([s, list]) =>
        list.length ? (
          <section key={s} aria-label={SUBJECTS[s].label} className="pt-2">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: SUBJECTS[s].tint }} />
              {SUBJECTS[s].label}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((q) => (
                <Link key={q.id} to={`/quizzes/${q.id}`} className="group flex flex-col rounded-card bg-card p-5 transition hover:shadow-lift">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-heading text-[17px] font-medium text-ink-strong">{q.title.replace(/ quiz$/, "")}</h3>
                    {q.bestScore !== null && <span className={cx("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", q.bestScore >= 80 ? "bg-[#DBF6E5] text-[#11703A]" : "bg-line text-ink")}>{q.bestScore}%</span>}
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    {q.draw} questions from a pool of {q.poolSize} · {Object.keys(q.concepts).length} ideas
                  </p>
                  <span className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-line px-3 py-1.5 text-xs font-medium text-ink transition group-hover:bg-ink-strong group-hover:text-on-ink">
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
