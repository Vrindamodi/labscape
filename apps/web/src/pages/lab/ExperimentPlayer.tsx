import type { LabContext, LabEvent, RewardResult } from "@labscape/contracts";
import { reagent, recordGolden, stageFor, SuitUp, useLabSession, Workbench, type ExperimentContent, type Feedback, type PpeNeed, type Report, type StepSpec } from "@labscape/lab-engine";
import "./SimStages";
import { QuizStage } from "../../components/QuizStage";
import { AssistantLauncher } from "../../components/AssistantDock";
import { usePublishLabContext } from "../../lib/labContext";
import { celebrate, useMotion } from "@labscape/motion";
import { MolecularView, SCENES } from "@labscape/chem-view";
import { sound } from "@labscape/audio";
import { Button, Callout, Chip, cx, ErrorState, FullscreenLab, Modal, ProgressRing, Skeleton, SubjectChip, useShell } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import katex from "katex";
import "katex/dist/katex.min.css";
import {
  ArrowLeft,
  ArrowRight,
  Atom,
  Captions,
  Check,
  ChevronRight,
  CircleAlert,
  Eye,
  FlaskConical,
  History,
  Lightbulb,
  ListChecks,
  NotebookPen,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Star,
  Target,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, post } from "../../lib/api";
import { emitReward, isAdmin, useSession } from "../../lib/session";

type Stage = "intro" | "demo" | "try" | "observe" | "quiz" | "results";
const RAIL: { id: Stage | "hints"; label: string }[] = [
  { id: "intro", label: "Intro" },
  { id: "demo", label: "Demo" },
  { id: "try", label: "Try" },
  { id: "hints", label: "Hints" },
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
type FinishResult = { report: Report; serverHash: string; hashMatches: boolean | null; status: string; reward: RewardResult | null };

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
      {me && <AssistantLauncher />}
      {/* stage rail */}
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-white/[0.07] bg-[#0b1020]/80 px-4 backdrop-blur-xl">
        <button onClick={() => navigate(`/library/${content.slug}`)} className="grid h-10 w-10 place-items-center rounded-md text-white/60 hover:bg-white/[0.06] hover:text-white" aria-label="Leave the lab">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <div className="truncate font-heading text-base font-semibold">{content.title}</div>
          <div className="text-xs text-white/45">{SUBJECT_LAB[subject] ?? ""}</div>
        </div>
        <nav className="ml-auto flex items-center gap-1 overflow-x-auto" aria-label="Experiment stages">
          {RAIL.map((r, i) => {
            const order: (Stage | "hints")[] = ["intro", "demo", "try", "hints", "observe", "quiz", "results"];
            const cur = order.indexOf(stage === "results" ? "quiz" : stage);
            const idx = order.indexOf(r.id);
            const active = r.id === stage || (r.id === "hints" && stage === "try");
            const done = idx < cur && r.id !== "hints";
            return (
              <div key={r.id} className="flex items-center">
                {i > 0 && <ChevronRight className="mx-0.5 h-4 w-4 text-white/20" />}
                <button
                  disabled={r.id === "hints" || (r.id !== "intro" && r.id !== "demo" && idx > cur)}
                  onClick={() => r.id !== "hints" && goto(r.id)}
                  className={cx(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
                    active ? "bg-accent text-white shadow-[0_0_18px_-4px_#2f80ff]" : done ? "text-state-success" : "text-white/45",
                    r.id === "hints" && "italic",
                  )}
                  title={r.id === "hints" ? "Hints are a layer during Try" : undefined}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : <span className="tabular">{i + 1}</span>}
                  {r.label}
                </button>
              </div>
            );
          })}
        </nav>
      </header>

      <div className="min-h-0 flex-1">
        <AnimatePresence mode="wait">
          <motion.div key={stage} className="h-full" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            {stage === "intro" && <Intro view={view} onDemo={() => goto("demo")} onTry={() => void begin(false)} starting={starting} />}
            {stage === "demo" && (sim ? <sim.Demo slug={content.slug} onTry={() => void begin(false)} /> : <Demo content={content} onTry={() => void begin(false)} />)}
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
                <Try
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

/* ================================================================== 2. demo */

function Demo({ content, onTry }: { content: ExperimentContent; onTry: () => void }) {
  const session = useLabSession(content, { mode: "demo" });
  const [captions, setCaptions] = useState(true);
  const [base, setBase] = useState(1);
  const end = content.golden.events[content.golden.events.length - 1]?.t ?? content.golden.durationS * 1000;
  const caption = [...content.golden.captions].reverse().find((c) => c.t <= session.t);
  const slow = !!caption?.slow && session.t - caption.t < 6000;
  const { setSpeed } = session;
  useEffect(() => setSpeed(slow ? base * 0.5 : base), [slow, base, setSpeed]);
  const done = session.t >= end + 1500;

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1 p-3">
        <Workbench
          session={session}
          readOnly
          overlay={
            <>
              {slow && <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-[#ffc23d] px-3 py-1 text-xs font-bold text-[#2a1600]"><Eye className="h-3.5 w-3.5" />Watch closely · 0.5×</div>}
              <AnimatePresence mode="wait">
                {captions && caption && (
                  <motion.div key={caption.t} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute bottom-6 left-1/2 z-10 max-w-[80%] -translate-x-1/2 rounded-xl bg-black/70 px-5 py-3 text-center text-base font-medium backdrop-blur" aria-live="polite">
                    {caption.text}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          }
        />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-white/[0.07] px-4 py-3">
        <Button size="sm" variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => session.seek(0)}>Replay</Button>
        <Button size="sm" variant="secondary" icon={session.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />} onClick={() => session.setPaused(!session.paused)}>{session.paused ? "Play" : "Pause"}</Button>
        <input type="range" min={0} max={end + 1500} value={Math.min(session.t, end + 1500)} onChange={(e) => session.seek(Number(e.target.value))} className="min-w-[160px] flex-1 accent-[#2f80ff]" aria-label="Scrub the demo" />
        <span className="tabular w-24 text-xs text-white/55">{fmtTime(session.t)} / {fmtTime(end)}</span>
        <div className="flex rounded-lg bg-black/25 p-0.5">
          {[0.5, 1, 2].map((s) => (
            <button key={s} onClick={() => setBase(s)} className={cx("rounded-md px-2.5 py-1 text-xs font-semibold", base === s ? "bg-accent text-white" : "text-white/55")}>{s}×</button>
          ))}
        </div>
        <button onClick={() => setCaptions((c) => !c)} className={cx("grid h-8 w-8 place-items-center rounded-md", captions ? "bg-white/10 text-white" : "text-white/40")} aria-label="Captions" aria-pressed={captions}><Captions className="h-4 w-4" /></button>
        <Button size="sm" className={cx(done && "ls-breathe")} iconRight={<ArrowRight className="h-4 w-4" />} onClick={onTry}>Try it yourself</Button>
      </div>
    </div>
  );
}

function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ================================================================== 3. try (+ hints layer) */

function Try({
  content,
  attempt,
  onSaved,
  onSaving,
  onSaveError,
  onDone,
  announce,
  onRestart,
}: {
  content: ExperimentContent;
  attempt: Attempt;
  onSaved: (at: number) => void;
  onSaving: () => void;
  onSaveError: () => void;
  onDone: () => void;
  announce: (t: string, p?: "polite" | "assertive") => void;
  onRestart: () => void;
}) {
  const { toast } = useShell();
  const { reduced } = useMotion();
  const [hintRung, setHintRung] = useState<Record<string, number>>({});
  const [hintPulse, setHintPulse] = useState(false);
  const [showMe, setShowMe] = useState<StepSpec | null>(null);
  const [safety, setSafety] = useState<Extract<Feedback, { kind: "safety-stop" }> | null>(null);
  const [shake, setShake] = useState(0);
  const stepDoneSeq = useRef<Record<string, number>>({});
  const { me } = useSession();
  const recording = isAdmin(me) && new URLSearchParams(window.location.search).get("record") === "1";

  const session = useLabSession(content, {
    mode: "try",
    attemptId: attempt.id,
    initialEvents: attempt.events,
    onBatch: (batch) => {
      onSaving();
      void post(`/v1/attempts/${attempt.id}/events`, { events: batch, stage: "try" })
        .then(() => onSaved(Date.now()))
        .catch(() => onSaveError());
    },
    onNote: (n) => announce(n.text, n.tone === "danger" ? "assertive" : "polite"),
    onFeedback: (f) => {
      if (f.kind === "deviation") {
        toast({ kind: f.deviation.severity === "minor" ? "warning" : "danger", title: f.deviation.severity === "minor" ? "Careful" : "That went wrong", body: f.deviation.message });
        if (!reduced) setShake((s) => s + 1);
      } else if (f.kind === "hint-suggest") {
        setHintPulse(true);
      } else if (f.kind === "safety-stop") {
        setSafety(f);
        sound.play("error");
      } else if (f.kind === "step-complete") {
        sound.play("success");
        stepDoneSeq.current[f.stepId] = session.events[session.events.length - 1]?.seq ?? 0;
      }
    },
  });

  const ev = session.evaluator;
  const current = ev?.current() ?? null;
  const report = ev?.report();
  const done = report?.completed ?? false;

  // The assistant reads this snapshot with every question (contract 5).
  const items = Object.values(session.state.items);
  usePublishLabContext({
    surface: "experiment",
    subject: "chemistry",
    attemptId: attempt.id,
    experimentId: content.slug,
    experimentVersion: content.version,
    experimentTitle: content.title,
    stage: "try",
    ...(current ? { currentStepId: current.id } : {}),
    currentStepText: current ? `${current.title}. ${current.instruction}` : null,
    completedStepIds: (report?.steps ?? []).filter((s) => s.done).map((s) => s.id),
    userLevel: (me?.profile.learningLevel ?? "school") as LabContext["userLevel"],
    bench: items.map((it) => ({ id: it.id, kind: it.kind, ...(it.liquid && it.liquid.volumeMl > 0 ? { contents: [{ species: it.reagentId ?? "solution", volumeMl: Math.round(it.liquid.volumeMl * 10) / 10 }], temperatureC: Math.round(it.liquid.tempC) } : {}) })),
    recentEvents: session.events.slice(-8),
    readings: [],
    deviations: (report?.deviations ?? []).map((d) => ({ stepId: d.stepId, code: d.code, severity: d.severity === "safety" ? "critical" : d.severity === "minor" ? "minor" : "major" })),
    hintsShown: Object.keys(hintRung),
    highlightableIds: items.map((it) => it.id),
  });

  const showHint = () => {
    if (!current || !ev) return;
    const rung = Math.min(3, (hintRung[current.id] ?? 0) + 1) as 1 | 2 | 3;
    const h = ev.hint(current.id, rung);
    setHintRung((r) => ({ ...r, [current.id]: rung }));
    setHintPulse(false);
    session.dispatch("hint.shown", { hintId: h?.id ?? `${current.id}-${rung}`, rung, stepId: current.id });
    if (rung === 3) setShowMe(current);
  };

  const restartFrom = async (stepId: string | undefined) => {
    setSafety(null);
    const idx = stepId ? content.steps.findIndex((s) => s.id === stepId) : 0;
    const prev = idx > 0 ? content.steps[idx - 1] : undefined;
    const keep = prev ? stepDoneSeq.current[prev.id] ?? 0 : 0;
    session.rewind(keep);
    await post(`/v1/attempts/${attempt.id}/restart`, { keepThroughSeq: keep }).catch(() => {});
  };

  const curHint = current && hintRung[current.id] ? ev?.hint(current.id, hintRung[current.id] as 1 | 2 | 3) : null;

  // Suit up before the bench: goggles and a coat always, gloves when anything is corrosive,
  // toxic or an irritant. Wearing the goggles here is the experiment's own "goggles on".
  const suitKey = `labscape.suited.${attempt.id}`;
  const gogglesItem = items.find((i) => i.kind === "goggles");
  const [suited, setSuited] = useState(() => {
    try {
      return sessionStorage.getItem(suitKey) === "1" || gogglesItem?.socket === "worn" || attempt.events.length > 0;
    } catch {
      return attempt.events.length > 0;
    }
  });
  const ppe = useMemo<PpeNeed[]>(() => {
    const hz = new Set<string>();
    for (const it of items) {
      try {
        if (it.reagentId) reagent(it.reagentId).hazards.forEach((h) => hz.add(h));
      } catch {
        /* not a reagent */
      }
    }
    const gloves = hz.has("corrosive") || hz.has("toxic") || hz.has("irritant");
    return [
      { id: "coat", required: true, why: "Keeps splashes off your clothes and skin." },
      { id: "goggles", required: true, why: hz.has("corrosive") ? "Corrosive liquids on this bench can blind." : "Splashes and sparks happen without warning." },
      { id: "gloves", required: gloves, why: gloves ? `Something here is ${[...hz].filter((h) => ["corrosive", "toxic", "irritant"].includes(h)).join(" and ")}.` : "Nothing harsh here, but good habit." },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.slug]);
  const latestNotes = session.notes.slice(-6).reverse();

  return (
    <div className="grid h-full min-h-0 grid-rows-[1fr_auto] lg:grid-cols-[1fr_360px] lg:grid-rows-1">
      <motion.div key={shake} className="relative min-h-0 p-3" animate={shake ? { x: [0, -3, 3, -3, 3, 0] } : {}} transition={{ duration: 0.3 }}>
        <Workbench
          session={session}
          step={current}
          onLiveWarning={(t) => {
            toast({ kind: "warning", title: "Slow down", body: t, durationMs: 2500 });
            announce(t, "assertive");
          }}
          className={cx(shake ? "ring-2 ring-state-warning/60" : "")}
        />
        {!suited && (
          <SuitUp
            needs={ppe}
            title={content.title}
            onDone={(worn) => {
              setSuited(true);
              try {
                sessionStorage.setItem(suitKey, "1");
              } catch {
                /* private mode */
              }
              if (worn.includes("goggles") && gogglesItem && gogglesItem.socket !== "worn") session.dispatch("equipment.place", { equipmentId: gogglesItem.id, x: 0, y: 0, socket: "worn" });
              sound.play("success");
            }}
          />
        )}
      </motion.div>

      <aside className="ls-scroll m-3 flex min-h-0 flex-col gap-3 overflow-y-auto rounded-[18px] border border-[rgba(140,180,255,.16)] bg-[linear-gradient(180deg,rgba(14,26,56,.78),rgba(8,16,38,.84))] p-4 shadow-[inset_0_1px_0_rgba(200,220,255,.10),0_24px_60px_-24px_rgba(0,0,0,.8)] lg:ml-0" aria-label="Steps and observations">
        {recording && <Recorder content={content} events={session.events} />}
        <div className="rounded-[14px] border border-[rgba(110,170,255,.45)] bg-[linear-gradient(120deg,rgba(61,139,255,.18),rgba(57,214,255,.06))] p-4">
          {current ? (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-cyan">Step {content.steps.indexOf(current) + 1} of {content.steps.length}</div>
              <div className="mt-1 font-heading text-lg font-semibold">{current.title}</div>
              <p className="mt-1 text-sm text-white/75">{current.instruction}</p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 font-heading text-lg font-semibold text-state-success"><Check className="h-5 w-5" />All steps done</div>
              <p className="mt-1 text-sm text-white/70">Head to Observe to explain what you saw.</p>
            </>
          )}
          <div className="mt-3 flex gap-2">
            {current && (
              <Button size="sm" variant="secondary" className={cx(hintPulse && "ls-breathe")} icon={<Lightbulb className="h-4 w-4 text-[#ffd77a]" />} onClick={showHint}>
                {(hintRung[current.id] ?? 0) === 0 ? "Hint" : (hintRung[current.id] ?? 0) >= 3 ? "Show me again" : "More help"}
              </Button>
            )}
            {done && <Button size="sm" iconRight={<ArrowRight className="h-4 w-4" />} onClick={onDone}>Observe</Button>}
          </div>
          <AnimatePresence>
            {curHint && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-3 rounded-lg bg-[#ffc23d]/10 p-3 text-sm text-[#ffe3a3] ring-1 ring-inset ring-[#ffc23d]/30">
                <span className="mr-1 font-semibold">{["", "Nudge:", "Try this:", "Show me:"][curHint.rung]}</span>
                {curHint.text}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">Steps</div>
          <ol className="space-y-1">
            {content.steps.map((s, i) => {
              const p = ev?.progress(s.id);
              const isCur = current?.id === s.id;
              return (
                <li key={s.id} className={cx("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm", isCur && "bg-white/[0.06]")}>
                  <span className={cx("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold", p?.done ? "bg-state-success text-[#06210f]" : isCur ? "bg-accent text-white" : "bg-white/10 text-white/50")}>
                    {p?.done ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className={cx(p?.done ? "text-white/50" : isCur ? "font-medium text-white" : "text-white/60")}>{s.title}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="mt-auto">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40"><Eye className="h-3.5 w-3.5" />Observations</div>
          <ul className="space-y-1.5" aria-live="polite">
            <AnimatePresence initial={false}>
              {latestNotes.map((n) => (
                <motion.li key={n.uid} layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className={cx("rounded-lg px-3 py-2 text-sm", n.tone === "danger" ? "bg-state-danger/10 text-[#ffb4b4]" : n.tone === "warning" ? "bg-state-warning/10 text-[#fcd27b]" : n.tone === "success" ? "bg-state-success/10 text-[#9ff0bf]" : "bg-white/[0.04] text-white/70")}>
                  {n.tone === "danger" ? <CircleAlert className="mr-1.5 inline h-3.5 w-3.5" /> : n.tone === "success" ? <Sparkles className="mr-1.5 inline h-3.5 w-3.5" /> : null}
                  {n.text}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      </aside>

      {/* "Show me": replay that step from the golden run */}
      <Modal open={!!showMe} onClose={() => setShowMe(null)} title={`Show me: ${showMe?.title ?? ""}`} width={860}>
        {showMe && <ShowMe content={content} step={showMe} />}
      </Modal>

      {/* safety stop */}
      <Modal open={!!safety} onClose={() => {}} dismissible={false} title="Safety stop" width={480}>
        {safety && (
          <div className="p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-state-danger/20 text-state-danger ring-1 ring-state-danger/40"><ShieldAlert className="h-6 w-6" /></span>
              <div>
                <div className="font-heading text-lg font-semibold">{safety.rule.title}</div>
                <p className="mt-1 text-sm text-white/70">{safety.rule.message}</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={() => void restartFrom(safety.rule.restartFrom)}>Restart from that step</Button>
              <Button variant="secondary" onClick={onRestart}>Start over</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ShowMe({ content, step }: { content: ExperimentContent; step: StepSpec }) {
  const session = useLabSession(content, { mode: "demo" });
  const { seek } = session;
  // Start a few seconds before the golden run's first event for this step.
  const start = useMemo(() => {
    const e = content.golden.events.find((g) => {
      const p = g.payload as Record<string, unknown>;
      return (g.type === step.action || (step.alsoActions ?? []).includes(g.type)) && (!step.from || p.from === step.from || p.equipmentId === step.from || p.instrument === step.from);
    });
    return Math.max(0, (e?.t ?? 0) - 2500);
  }, [content, step]);
  useEffect(() => seek(start), [seek, start]);
  return (
    <div className="h-[460px] p-3">
      <Workbench session={session} readOnly />
    </div>
  );
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
      onFinished(r);
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

/** Admin golden-run recorder: score the current run and copy it as a golden-run script. */
function Recorder({ content, events }: { content: ExperimentContent; events: LabEvent[] }) {
  const { toast } = useShell();
  const [out, setOut] = useState<ReturnType<typeof recordGolden> | null>(null);
  const capture = () => setOut(recordGolden(content, events));
  const copy = async () => {
    if (!out) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(out.golden, null, 2));
      toast({ kind: "success", title: "Golden run copied", body: `Paste it as "golden" in content/experiments/${content.slug}.json, then edit the captions.` });
    } catch {
      toast({ kind: "danger", title: "Couldn't copy", body: "Your browser blocked the clipboard." });
    }
  };
  return (
    <div className="rounded-xl border border-red-400/40 bg-red-500/[0.07] p-3 text-sm">
      <div className="flex items-center gap-2 font-semibold text-red-200">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" /> Recording golden run · {events.length} events
      </div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="secondary" onClick={capture} disabled={!events.length}>Score this run</Button>
        {out && <Button size="sm" onClick={() => void copy()} disabled={out.report.deviations.length > 0}>Copy JSON</Button>}
      </div>
      {out && (
        <div className="mt-2 text-xs text-white/75">
          <p>
            <b className="text-white">{out.report.stars}★</b> · {out.report.score}% · {out.golden.durationS} s · {out.golden.captions.length} draft captions
          </p>
          {out.report.deviations.length > 0 ? <p className="mt-1 text-amber-200">Only runs with no deviations can be saved as golden runs.</p> : <p className="mt-1 text-emerald-200">Clean run. Observation answers come later at Observe, so that score shows 0 here.</p>}
          {out.report.deviations.slice(0, 4).map((d, i) => (
            <p key={i} className="mt-1 text-red-200/90">• {d.code} ({d.severity})</p>
          ))}
        </div>
      )}
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
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (report.completed) {
      window.setTimeout(() => celebrate({ preset: "confetti", count: report.stars * 40 }), reduced ? 0 : 900);
      if (result.reward && !result.reward.duplicate) emitReward({ result: result.reward, origin: { x: window.innerWidth / 2, y: window.innerHeight / 3 }, label: content.title });
    }
  }, [report, result, reduced, content.title]);
  const dims = Object.entries(report.byDimension).filter(([, v]) => v !== null) as [string, number][];

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
          <p className="mt-1 text-white/55">{content.title} · scored by the server from your full event log{result.hashMatches === false ? " (re-simulated)" : ""}</p>
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
          {report.hintsUsed > 0 && <p className="pt-1 text-xs text-white/45">{report.hintsUsed} hint{report.hintsUsed === 1 ? "" : "s"} used (−{Math.min(10, report.hintsUsed * 2)}% independence)</p>}
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
