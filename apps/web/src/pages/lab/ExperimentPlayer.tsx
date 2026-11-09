import type { LabEvent, RewardResult } from "@labscape/contracts";
import { runSession, stageFor, type ExperimentContent, type Report } from "@labscape/lab-engine";
import "./SimStages";
import { ChemDemo } from "./chem/ChemDemo";
import { ChemTry } from "./chem/ChemTry";
import { QuizStage } from "../../components/QuizStage";
import { AssistantLauncher } from "../../components/AssistantDock";
import { celebrate, useMotion } from "@labscape/motion";
import { MolecularView, SCENES } from "@labscape/chem-view";
import { sound } from "@labscape/audio";
import { Button, Callout, Chip, cx, ErrorState, FullscreenLab, ProgressRing, Skeleton, SubjectChip, useShell } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import katex from "katex";
import "katex/dist/katex.min.css";
import {
  ArrowLeft,
  ArrowRight,
  Atom,
  Check,
  Eye,
  FlaskConical,
  History,
  Lightbulb,
  ListChecks,
  NotebookPen,
  Play,
  RotateCcw,
  Star,
  Target,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, post } from "../../lib/api";
import { emitReward, useSession } from "../../lib/session";

type Stage = "intro" | "demo" | "try" | "observe" | "quiz" | "results";
const RAIL: { id: Stage; label: string }[] = [
  { id: "intro", label: "Intro" },
  { id: "demo", label: "Demo" },
  { id: "try", label: "Try it" },
  { id: "observe", label: "Observe" },
  { id: "quiz", label: "Quiz" },
];

type ExperimentView = {
  content: ExperimentContent;
  card: { title: string; summary: string; subject: string; difficulty: string; estimatedMinutes: number; xpReward: number; objectives: string[]; concept: string; realWorld: string[]; equipment: string[]; materials: string[]; safety: string[]; premium: boolean } | null;
  latest: { id: string; status: string; stage: string } | null;
  bestScore: number | null;
};
type Attempt = { id: string; status: string; stage: string; events: LabEvent[] };
/** status "scoring": the server is still replaying a long run; `report` is then this device's own score until the verified one arrives. */
type FinishResult = { report: Report; serverHash: string | null; hashMatches: boolean | null; status: string; reward: RewardResult | null };

export default function ExperimentPlayer() {
  const { slug = "" } = useParams();
  const q = useQuery({ queryKey: ["experiment-full", slug], queryFn: () => api<ExperimentView>(`/v1/experiments/${slug}`), retry: false });
  if (q.isLoading) return <FullscreenLab><div className="grid h-screen place-items-center bg-[#0b1020]"><Skeleton className="h-[70vh] w-[90vw] rounded-2xl" /></div></FullscreenLab>;
  if (q.isError || !q.data) {
    return (
      <div className="mx-auto max-w-lg py-16">
        <ErrorState title="This lab isn't ready yet" body={q.error instanceof ApiError ? q.error.message : "Try again in a moment."} />
      </div>
    );
  }
  return (
    <FullscreenLab>
      <Player view={q.data} />
    </FullscreenLab>
  );
}

const SUBJECT_LAB: Record<string, string> = { chemistry: "Chemistry lab", physics: "Physics lab", maths: "Maths lab" };

/** Physics and maths bring their own Demo and Try stages (registered by Part 3). */
function useSubject(content: ExperimentContent) {
  const subject = (content as unknown as { subject: string }).subject;
  const mod = subject === "chemistry" ? undefined : stageFor(subject);
  return { subject, sim: mod && mod.has(content.slug) ? mod : undefined };
}

function Player({ view }: { view: ExperimentView }) {
  const { content } = view;
  const { subject, sim } = useSubject(content);
  const navigate = useNavigate();
  const { me, startGuest } = useSession();
  const { toast, announce, setAutosaveState } = useShell();
  const [stage, setStage] = useState<Stage>(view.latest?.status === "in_progress" && view.latest.stage === "try" ? "try" : "intro");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [result, setResult] = useState<FinishResult | null>(null);
  const [starting, setStarting] = useState(false);
  // A long run is still being verified: check back (the quiz usually covers the wait).
  const scoringId = result?.status === "scoring" ? attempt?.id : undefined;
  useEffect(() => {
    if (!scoringId) return;
    let stop = false;
    let timer = 0;
    const check = async () => {
      try {
        const r = await api<FinishResult>(`/v1/attempts/${scoringId}/result`);
        if (stop) return;
        if (r.status !== "scoring" && r.report) return setResult(r);
      } catch {
        // keep this device's score; try again a little later
      }
      if (!stop) timer = window.setTimeout(check, 4000);
    };
    timer = window.setTimeout(check, 3000);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [scoringId]);

  const begin = useCallback(
    async (fresh = false) => {
      setStarting(true);
      try {
        if (!me) await startGuest();
        const a = await post<Attempt>("/v1/attempts", { experimentSlug: content.slug, fresh });
        setAttempt(a);
        setStage("try");
        if (a.events.length) toast({ kind: "info", title: "Welcome back", body: "Your bench is exactly as you left it." });
      } catch (e) {
        toast({ kind: "danger", title: "Couldn't open the bench", body: e instanceof ApiError ? e.message : undefined });
      } finally {
        setStarting(false);
      }
    },
    [content.slug, me, startGuest, toast],
  );

  // Resuming straight into Try.
  useEffect(() => {
    if (stage === "try" && !attempt && !starting) void begin(false);
  }, [stage, attempt, starting, begin]);

  const goto = (s: Stage) => {
    sound.play("whoosh");
    setStage(s);
  };

  return (
    <div className="flex h-screen flex-col bg-[radial-gradient(1200px_500px_at_50%_-10%,rgba(47,128,255,.18),transparent_60%),#0b1020] text-white">
      {/* stage rail: one line, the current stage highlighted; each stage has its own primary button */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.07] bg-[#0b1020]/80 px-2 backdrop-blur-xl sm:gap-3 sm:px-4">
        <button onClick={() => navigate(`/library/${content.slug}`)} className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-white/60 hover:bg-white/[0.06] hover:text-white" aria-label="Leave the lab">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-heading text-[15px] font-semibold leading-tight">{content.title}</div>
          <div className="truncate text-xs text-white/45">{SUBJECT_LAB[subject] ?? ""}</div>
        </div>
        {(() => {
          const cur = RAIL.findIndex((r) => r.id === (stage === "results" ? "quiz" : stage));
          const reachable = (id: Stage, i: number) => i <= cur || id === "demo" || id === "try";
          const open = (id: Stage) => (id === "try" && !attempt ? void begin(false) : goto(id));
          return (
            <>
              <span className="shrink-0 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white md:hidden" aria-live="polite">
                {cur + 1}/{RAIL.length} · {RAIL[cur]?.label}
              </span>
              <nav className="hidden shrink-0 items-center gap-1 md:flex" aria-label="Experiment stages">
                {RAIL.map((r, i) => {
                  const active = i === cur;
                  const done = i < cur;
                  return (
                    <div key={r.id} className="flex items-center">
                      {i > 0 && <span className={cx("mx-1 h-px w-4", done || active ? "bg-accent/60" : "bg-white/15")} aria-hidden />}
                      <button
                        disabled={!reachable(r.id, i) || active}
                        onClick={() => open(r.id)}
                        aria-current={active ? "step" : undefined}
                        className={cx(
                          "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
                          active ? "bg-accent text-white shadow-[0_0_18px_-4px_#2f80ff]" : done ? "text-state-success hover:bg-white/[0.05]" : reachable(r.id, i) ? "text-white/70 hover:bg-white/[0.06]" : "text-white/35",
                        )}
                      >
                        {done ? <Check className="h-3.5 w-3.5" /> : null}
                        {r.label}
                      </button>
                    </div>
                  );
                })}
              </nav>
            </>
          );
        })()}
        {me && <AssistantLauncher />}
      </header>

      <div className="min-h-0 flex-1">
        <AnimatePresence mode="wait">
          <motion.div key={stage} className="h-full" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            {stage === "intro" && <Intro view={view} onDemo={() => goto("demo")} onTry={() => void begin(false)} starting={starting} />}
            {stage === "demo" && (sim ? <sim.Demo slug={content.slug} onTry={() => void begin(false)} /> : <ChemDemo content={content} onTry={() => void begin(false)} />)}
            {stage === "try" &&
              (attempt && sim ? (
                <sim.Try
                  key={attempt.id}
                  slug={content.slug}
                  attempt={attempt}
                  onSaved={(at) => setAutosaveState("saved", at)}
                  onSaving={() => setAutosaveState("saving")}
                  onSaveError={() => setAutosaveState("error")}
                  onDone={() => goto("observe")}
                  announce={announce}
                  onRestart={() => void begin(true)}
                />
              ) : attempt ? (
                <ChemTry
                  key={attempt.id}
                  content={content}
                  attempt={attempt}
                  onSaved={(at) => setAutosaveState("saved", at)}
                  onSaving={() => setAutosaveState("saving")}
                  onSaveError={() => setAutosaveState("error")}
                  onDone={() => goto("observe")}
                  announce={announce}
                  onRestart={() => void begin(true)}
                />
              ) : (
                <div className="grid h-full place-items-center text-white/50">Setting up your bench…</div>
              ))}
            {stage === "observe" && attempt && (
              <Observe
                content={content}
                attemptId={attempt.id}
                onFinished={(r) => {
                  setResult(r);
                  goto("quiz");
                }}
              />
            )}
            {stage === "quiz" && <QuizStage quizId={`quiz-${content.slug}`} {...(attempt ? { experimentAttemptId: attempt.id } : {})} onDone={() => goto("results")} continueLabel="See my lab results" />}
            {stage === "results" && result && <Results content={content} result={result} attemptId={attempt?.id} onAgain={() => void begin(true)} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ================================================================== 1. intro */

function Intro({ view, onDemo, onTry, starting }: { view: ExperimentView; onDemo: () => void; onTry: () => void; starting: boolean }) {
  const { content, card } = view;
  const { subject } = useSubject(content);
  return (
    <div className="h-full overflow-y-auto px-4 py-8 sm:px-8">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="flex flex-wrap gap-2">
            <SubjectChip subject={subject} size="md" />
            <Chip tone={content.fidelity === "exact" ? "success" : content.fidelity === "approximate" ? "blue" : "violet"}>{fidelityLabel(content.fidelity)}</Chip>
            {content.reviewStatus !== "approved" && <Chip tone="warning">Awaiting teacher review</Chip>}
          </div>
          <h1 className="mt-4 font-heading text-4xl font-bold tracking-tight">{content.title}</h1>
          {card && <p className="mt-3 text-lg text-white/65">{card.summary}</p>}
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="flex items-center gap-2 font-heading font-semibold"><Target className="h-5 w-5 text-accent-cyan" />Objective</h2>
            <ul className="mt-2 space-y-1.5 text-white/75">
              {(card?.objectives ?? []).map((o) => <li key={o} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-state-success" />{o}</li>)}
            </ul>
            {card?.concept && (
              <>
                <h3 className="mt-5 flex items-center gap-2 text-sm font-semibold text-white/60"><Lightbulb className="h-4 w-4 text-[#ffd77a]" />The concept</h3>
                <p className="mt-1 text-white/75">{card.concept}</p>
              </>
            )}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button size="lg" icon={<Play className="h-5 w-5" />} onClick={onDemo}>Watch the demo</Button>
            <Button size="lg" variant="secondary" loading={starting} iconRight={<ArrowRight className="h-5 w-5" />} onClick={onTry}>
              {view.latest?.status === "in_progress" ? "Resume where I left off" : "Try it myself"}
            </Button>
          </div>
          {view.bestScore != null && <p className="mt-3 text-sm text-white/50">Your best so far: {view.bestScore}%</p>}
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="flex items-center gap-2 font-heading font-semibold"><FlaskConical className={cx("h-5 w-5", subject === "physics" ? "text-subject-physics" : subject === "maths" ? "text-subject-maths" : "text-subject-chemistry")} />{subject === "maths" ? "Your tools" : "On your bench"}</h2>
            <div className="mt-3 flex flex-wrap gap-1.5">{(card?.equipment ?? []).map((e) => <Chip key={e} tone="blue">{e}</Chip>)}</div>
            <div className="mt-3 flex flex-wrap gap-1.5">{(card?.materials ?? []).map((e) => <Chip key={e}>{e}</Chip>)}</div>
          </div>
          {(card?.safety.length ?? 0) > 0 && (
            <Callout tone="danger" title="Safety precautions">
              <ul className="space-y-1">{card!.safety.map((s) => <li key={s}>{s}</li>)}</ul>
            </Callout>
          )}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="flex items-center gap-2 font-heading font-semibold"><ListChecks className="h-5 w-5 text-white/60" />{content.steps.length} steps</h2>
            <ol className="mt-2 space-y-1 text-sm text-white/65">
              {content.steps.slice(0, 7).map((s, i) => <li key={s.id}><span className="tabular mr-2 text-white/35">{i + 1}.</span>{s.title}</li>)}
              {content.steps.length > 7 && <li className="text-white/40">…and {content.steps.length - 7} more</li>}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

function fidelityLabel(f: ExperimentContent["fidelity"]) {
  return f === "exact" ? "Exact model" : f === "approximate" ? "Approximate model" : "Conceptual model";
}

/* ================================================================== 5. observe */

function Observe({ content, attemptId, onFinished }: { content: ExperimentContent; attemptId: string; onFinished: (r: FinishResult) => void }) {
  const { toast } = useShell();
  const o = content.observations;
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [molecular, setMolecular] = useState(false);
  const eq = useMemo(() => katex.renderToString(o.equationLatex, { throwOnError: false, displayMode: true }), [o.equationLatex]);
  const allAnswered = o.prompts.every((p) => answers[p.id] !== undefined);
  const { award } = useSession();
  const openMolecular = () => {
    setMolecular((m) => !m);
    // XP once per experiment (the server dedupes on the key); feeds the "Zoom in" challenge and badge.
    if (!molecular && SCENES[content.slug]) void award({ kind: "molecular_view.opened", refId: content.slug, subject: "chemistry", idempotencyKey: `molview:${content.slug}` }, { label: "Molecular view" }).catch(() => null);
  };

  const finish = async () => {
    setBusy(true);
    try {
      // Answers become part of the attempt's event log, then the server replays and scores it.
      const attempt = await api<Attempt>(`/v1/attempts/${attemptId}`);
      const last = attempt.events.reduce((m, e) => Math.max(m, e.seq), 0);
      const t = attempt.events.reduce((m, e) => Math.max(m, e.t), 0);
      const events = o.prompts.map((p, i) => ({ id: `ans-${p.id}`, attemptId, seq: last + i + 1, t: t + 1000 + i * 100, actor: "user", type: "param.set", payload: { key: `answer:${p.id}`, value: answers[p.id] ?? -1 } }));
      await post(`/v1/attempts/${attemptId}/events`, { events, stage: "observe" });
      const r = await post<FinishResult>(`/v1/attempts/${attemptId}/finish`, { tailMs: 1000 });
      if (r.status === "scoring" || !r.report) {
        // The server is still replaying a long run: show this device's score (same engine) now.
        const local = runSession(content, [...attempt.events, ...(events as LabEvent[])], { tailMs: 1000 });
        onFinished({ report: local.report, serverHash: null, hashMatches: null, status: "scoring", reward: null });
      } else onFinished(r);
    } catch (e) {
      toast({ kind: "danger", title: "Couldn't score the run", body: e instanceof ApiError ? e.message : "Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={content.fidelity === "exact" ? "success" : content.fidelity === "approximate" ? "blue" : "violet"}>{fidelityLabel(content.fidelity)}</Chip>
          {SCENES[content.slug] && <button onClick={openMolecular} className={cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset", molecular ? "bg-ai-violet/30 text-white ring-ai-violet" : "text-[#c4b1ff] ring-ai-violet/40")} aria-pressed={molecular}>
            <Atom className="h-3.5 w-3.5" />Molecular view
          </button>}
        </div>
        <h1 className="font-heading text-3xl font-bold">What happened, and why</h1>
        {molecular && <MolecularPanel slug={content.slug} />}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="flex items-center gap-2 font-heading font-semibold"><Eye className="h-5 w-5 text-accent-cyan" />What you saw</h2>
            <p className="mt-2 text-white/75">{o.whatHappened}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="flex items-center gap-2 font-heading font-semibold"><Lightbulb className="h-5 w-5 text-[#ffd77a]" />Why</h2>
            <p className="mt-2 text-white/75">{o.why}</p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#0f1830] p-5 text-lg" dangerouslySetInnerHTML={{ __html: eq }} />
        <div className="flex flex-wrap gap-2">{o.realWorld.map((r) => <Chip key={r}>{r}</Chip>)}</div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="font-heading font-semibold">Check your understanding</h2>
          <div className="mt-4 space-y-5">
            {o.prompts.map((p) => (
              <fieldset key={p.id}>
                <legend className="text-sm font-medium">{p.question}</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {p.choices.map((c, i) => (
                    <button key={c} onClick={() => setAnswers((a) => ({ ...a, [p.id]: i }))} className={cx("rounded-lg px-3 py-2.5 text-left text-sm ring-1 ring-inset transition", answers[p.id] === i ? "bg-accent/25 text-white ring-accent" : "bg-white/[0.04] text-white/75 ring-white/10 hover:bg-white/[0.07]")} aria-pressed={answers[p.id] === i}>
                      {c}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <Button size="lg" className="mt-6" disabled={!allAnswered} loading={busy} icon={<Check className="h-5 w-5" />} onClick={() => void finish()}>
            Submit and score my run
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Molecular view (chem-view): atoms move, bonds break and form, and the atom counter balances. */
function MolecularPanel({ slug }: { slug: string }) {
  const { reduced } = useMotion();
  const scene = SCENES[slug];
  if (!scene) return <p className="rounded-xl bg-white/[0.04] p-4 text-sm text-white/60">This experiment has no molecular view yet.</p>;
  return (
    <div>
      <MolecularView scene={scene} reducedMotion={reduced} height={340} />
      <p className="mt-2 text-[11px] text-white/45">Illustrative model: sizes and distances are to scale, motion is slowed down billions of times.</p>
    </div>
  );
}

/* ================================================================== 6. quiz (Part 4) */

/* ================================================================== results */

const DIM_LABEL: Record<string, string> = { equipment: "Equipment", sequence: "Sequence", quantity: "Quantities", technique: "Technique", temperature: "Temperature", timing: "Timing", measurement: "Measurement", observation: "Observations", mixing: "Mixing" };

function Results({ content, result, onAgain, attemptId }: { content: ExperimentContent; result: FinishResult; onAgain: () => void; attemptId?: string | undefined }) {
  const { report } = result;
  const { reduced } = useMotion();
  const fired = useRef(false);
  const rewarded = useRef(false);
  useEffect(() => {
    if (!fired.current && report.completed) {
      fired.current = true;
      window.setTimeout(() => celebrate({ preset: "confetti", count: report.stars * 40 }), reduced ? 0 : 900);
    }
    // XP arrives with the verified result (which can come a little after this page opens).
    if (!rewarded.current && report.completed && result.reward && !result.reward.duplicate) {
      rewarded.current = true;
      emitReward({ result: result.reward, origin: { x: window.innerWidth / 2, y: window.innerHeight / 3 }, label: content.title });
    }
  }, [report, result, reduced, content.title]);
  const verifying = result.status === "scoring";
  const dims = Object.entries(report.byDimension).filter(([, v]) => v !== null) as [string, number][];
  // Steps the learner had done for them in Try ("Do this step for me"); the server counts them as hints.
  const assisted = useMemo(() => {
    try {
      return attemptId ? (JSON.parse(sessionStorage.getItem(`labscape.assisted.${attemptId}`) ?? "[]") as string[]) : [];
    } catch {
      return [];
    }
  }, [attemptId]);

  return (
    <div className="h-full overflow-y-auto px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-col items-center text-center">
          <ProgressRing value={report.score / 100} size={150} stroke={11} color={report.score >= 90 ? "#22C55E" : report.score >= 70 ? "#22D3EE" : "#F59E0B"}>
            <div>
              <div className="font-heading text-4xl font-bold">{report.score}</div>
              <div className="text-xs text-white/50">score</div>
            </div>
          </ProgressRing>
          <div className="mt-4 flex gap-2" aria-label={`${report.stars} of 3 stars`}>
            {[1, 2, 3].map((s) => (
              <motion.span key={s} initial={{ scale: 0, rotate: -40 }} animate={{ scale: s <= report.stars ? 1 : 0.8, rotate: 0 }} transition={{ delay: reduced ? 0 : 0.5 + s * 0.12, type: "spring", stiffness: 320, damping: 14 }}>
                <Star className={cx("h-10 w-10", s <= report.stars ? "fill-[#ffc23d] text-[#ffc23d] drop-shadow-[0_0_12px_#ffc23d]" : "text-white/15")} />
              </motion.span>
            ))}
          </div>
          <h1 className="mt-4 font-heading text-3xl font-bold">{report.completed ? (report.stars === 3 ? "Flawless technique" : "Experiment complete") : report.stoppedForSafety ? "Stopped for safety" : "Not finished yet"}</h1>
          <p className="mt-1 text-white/55">
            {verifying ? (
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 animate-pulse rounded-full bg-accent-cyan" />{content.title} · scored on this device; the server is double-checking it and will add your XP</span>
            ) : (
              <>{content.title} · scored by the server from your full event log{result.hashMatches === false ? " (re-simulated)" : ""}</>
            )}
          </p>
        </div>

        <div className="mt-8 space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          {dims.map(([d, v], i) => (
            <div key={d}>
              <div className="flex justify-between text-sm"><span>{DIM_LABEL[d] ?? d}</span><span className="tabular text-white/60">{Math.round(v * 100)}%</span></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
                <motion.div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-cyan" initial={{ width: 0 }} animate={{ width: `${v * 100}%` }} transition={{ delay: reduced ? 0 : 0.3 + i * 0.12, duration: 0.6 }} />
              </div>
            </div>
          ))}
          {report.hintsUsed > 0 && <p className="pt-1 text-[14px] text-white/55">{report.hintsUsed} hint{report.hintsUsed === 1 ? "" : "s"} used (−{Math.min(10, report.hintsUsed * 2)}% independence)</p>}
          {assisted.length > 0 && (
            <p className="text-[14px] text-white/55">
              Assisted: {assisted.length} step{assisted.length === 1 ? " was" : "s were"} done for you with “Do this step for me” (counted as hints). Try {assisted.length === 1 ? "it" : "them"} yourself next time for full marks.
            </p>
          )}
        </div>

        {report.deviations.length > 0 && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="font-heading font-semibold">What to improve</h2>
            <ul className="mt-3 space-y-2">
              {report.deviations.map((d, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <Chip tone={d.severity === "minor" ? "warning" : "danger"}>{d.severity}</Chip>
                  <span className="flex-1 text-white/75">{d.message}</span>
                  <span className="text-xs text-white/35">{d.tag}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={onAgain}>Try again</Button>
          {attemptId && <Link to={`/replay/${attemptId}`}><Button variant="secondary" icon={<History className="h-4 w-4" />}>Watch my replay</Button></Link>}
          {attemptId && <Link to={`/notebook/${attemptId}`}><Button variant="secondary" icon={<NotebookPen className="h-4 w-4" />}>Open in notebook</Button></Link>}
          <Link to={`/library?subject=${(content as unknown as { subject?: string }).subject ?? "chemistry"}`}><Button iconRight={<ArrowRight className="h-4 w-4" />}>Next experiment</Button></Link>
        </div>
      </div>
    </div>
  );
}
