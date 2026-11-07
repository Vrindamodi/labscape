import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowRight, BookOpen, Check, ShieldCheck, Siren, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SceneArt, type Kind } from "./SceneArt";

export type SceneView = { id: string; stage: "detection" | "assessment" | "decision" | "consequence"; timerS: number; growth: number; hazard: number; narration: string; choices: { id: string; label: string }[] };
export type Started = { attemptId: string; title: string; kind: Kind; disclaimer: string; scene: SceneView };
export type Chosen = { quality: "best" | "ok" | "poor" | "unsafe"; safe: boolean; feedback: string; hazard: number; next: SceneView | null; ending: { id: string; outcome: string; text: string } | null };
export type ScenarioResult = {
  score: number;
  breakdown: { id: string; label: string; score: number; weight: number }[];
  mistakes: { stage: string; choice: string; feedback: string }[];
  learn: string[];
  sources: string[];
  ending: { id: string; outcome: string; text: string };
  disclaimer: string;
  quizId: string;
  badgeEligible: boolean;
  reward?: unknown;
};

export type ScenarioPlayerProps = {
  start: () => Promise<Started>;
  choose: (attemptId: string, choiceId: string, elapsedMs: number) => Promise<Chosen>;
  finish: (attemptId: string) => Promise<ScenarioResult>;
  /** The quiz stage (the app mounts its QuizRunner here). */
  renderQuiz: (quizId: string, onDone: () => void) => ReactNode;
  onExit: () => void;
  onResult?: (r: ScenarioResult) => void;
  play?: (sound: "error" | "success" | "badge" | "whoosh" | "notify") => void;
};

const RAIL = ["detection", "assessment", "decision", "consequence", "debrief", "quiz"] as const;
type Phase = "intro" | "scene" | "feedback" | "ending" | "debrief" | "quiz";

/**
 * <ScenarioPlayer> (build plan 4.3): title card with disclaimer, then detection, assessment,
 * decision and consequence scenes with an escalating hazard, then the debrief and the quiz. A calm
 * narrator; no injuries are ever shown; no ads.
 */
export function ScenarioPlayer({ start, choose, finish, renderQuiz, onExit, onResult, play }: ScenarioPlayerProps) {
  const reduced = useReducedMotion();
  const [run, setRun] = useState<Started | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [scene, setScene] = useState<SceneView | null>(null);
  const [hazard, setHazard] = useState(0);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [busy, setBusy] = useState(false);
  const sceneStart = useRef(0);

  useEffect(() => {
    start()
      .then((s) => {
        setRun(s);
        setScene(s.scene);
        setHazard(s.scene.hazard);
        play?.("error");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't start the scenario."));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The hazard grows while the learner hesitates.
  useEffect(() => {
    if (phase !== "scene" || !scene) return;
    sceneStart.current = performance.now();
    const base = scene.hazard;
    const id = window.setInterval(() => setHazard(Math.min(100, base + (scene.growth * (performance.now() - sceneStart.current)) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [phase, scene]);

  const pick = async (choiceId: string) => {
    if (!run || busy) return;
    setBusy(true);
    try {
      const c = await choose(run.attemptId, choiceId, Math.round(performance.now() - sceneStart.current));
      setChosen(c);
      setHazard(c.hazard);
      play?.(c.safe ? "success" : "error");
      setPhase("feedback");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    if (!run || !chosen) return;
    if (chosen.next) {
      setScene(chosen.next);
      setHazard(chosen.next.hazard);
      setChosen(null);
      setPhase("scene");
      play?.("whoosh");
      return;
    }
    setPhase("ending");
    setBusy(true);
    try {
      const r = await finish(run.attemptId);
      setResult(r);
      onResult?.(r);
      if (r.badgeEligible) play?.("badge");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't score the run.");
    } finally {
      setBusy(false);
    }
  };

  if (error)
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <p className="text-white/80">{error}</p>
          <button onClick={onExit} className="mt-4 rounded-md bg-white/10 px-4 py-2 text-sm text-white">
            Back
          </button>
        </div>
      </div>
    );
  if (!run || !scene) return <div className="grid h-full place-items-center text-white/50">Preparing the scenario…</div>;

  const railIndex = phase === "debrief" ? 4 : phase === "quiz" ? 5 : phase === "ending" ? 3 : RAIL.indexOf(scene.stage);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto px-4 py-2" aria-label="Scenario stages">
        {RAIL.map((r, i) => (
          <span key={r} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold capitalize ${i === railIndex ? "bg-red-500/80 text-white" : i < railIndex ? "text-emerald-300" : "text-white/40"}`}>
            {i < railIndex ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>}
            {r}
          </span>
        ))}
      </nav>

      <AnimatePresence mode="wait">
        {phase === "intro" && (
          <motion.div key="intro" className="grid min-h-0 flex-1 place-items-center bg-black px-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.1 : 1.2 }}>
            <div className="max-w-xl text-center">
              <motion.div initial={reduced ? false : { scale: 1.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.4, type: "spring", stiffness: 200, damping: 14 }} className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-red-600/90 text-white shadow-[0_0_40px_#e03131]">
                <Siren className="h-8 w-8" />
              </motion.div>
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-300">Emergency scenario</p>
              <h1 className="mt-2 font-heading text-4xl font-extrabold uppercase tracking-tight text-white">{run.title}</h1>
              <p className="mt-5 rounded-xl bg-white/[0.06] p-4 text-sm leading-relaxed text-white/75 ring-1 ring-inset ring-white/10">{run.disclaimer}</p>
              <button onClick={() => setPhase("scene")} className="mt-6 inline-flex h-12 items-center gap-2 rounded-md bg-red-600 px-6 font-semibold text-white">
                Begin <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          </motion.div>
        )}

        {(phase === "scene" || phase === "feedback" || phase === "ending") && (
          <motion.div key="play" className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="relative min-h-[240px] overflow-hidden rounded-2xl ring-1 ring-inset ring-white/10">
              <SceneArt kind={run.kind} hazard={hazard} calm={phase === "feedback" && !!chosen?.safe} alarm={phase === "feedback" && !!chosen && !chosen.safe} />
              <HazardMeter value={hazard} />
            </div>
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
              <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-inset ring-white/10">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-red-300">{scene.stage}</p>
                  {phase === "scene" && <Countdown key={scene.id} seconds={scene.timerS} />}
                </div>
                <p className="mt-2 text-base leading-relaxed text-white">{scene.narration}</p>
              </div>
              {phase === "scene" && (
                <div className="space-y-2" role="group" aria-label="What do you do?">
                  {scene.choices.map((c, i) => (
                    <motion.button key={c.id} onClick={() => void pick(c.id)} disabled={busy} initial={reduced ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : 0.12 * i, duration: 0.32 }} className="w-full rounded-xl bg-white/[0.06] px-4 py-3 text-left text-sm font-medium text-white ring-1 ring-inset ring-white/15 transition hover:bg-white/[0.1] disabled:opacity-50">
                      {c.label}
                    </motion.button>
                  ))}
                </div>
              )}
              {phase === "feedback" && chosen && (
                <motion.div initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`rounded-2xl p-4 ring-1 ring-inset ${chosen.safe ? "bg-emerald-400/10 ring-emerald-300/30" : "bg-red-500/10 ring-red-400/40"}`} aria-live="assertive">
                  <p className={`flex items-center gap-2 font-semibold ${chosen.safe ? "text-emerald-200" : "text-red-200"}`}>
                    {chosen.safe ? <ShieldCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                    {chosen.quality === "best" ? "Good call" : chosen.quality === "ok" ? "Reasonable" : chosen.quality === "poor" ? "Not the best choice" : "Unsafe"}
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/85">{chosen.feedback}</p>
                  {chosen.ending && <p className="mt-3 rounded-lg bg-black/25 p-3 text-sm text-white/80">{chosen.ending.text}</p>}
                  <button onClick={() => void next()} className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-md bg-white/10 px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/15">
                    {chosen.next ? "Continue" : "See how you did"} <ArrowRight className="h-4 w-4" />
                  </button>
                </motion.div>
              )}
              {phase === "ending" && (
                <div className="rounded-2xl bg-white/[0.04] p-4 text-sm text-white/70 ring-1 ring-inset ring-white/10">
                  {result ? (
                    <button onClick={() => setPhase("debrief")} className="inline-flex h-10 items-center gap-1.5 rounded-md bg-accent px-4 font-semibold text-white">
                      Debrief <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : (
                    "Scoring your run…"
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {phase === "debrief" && result && <Debrief key="debrief" r={result} onQuiz={() => setPhase("quiz")} onExit={onExit} reduced={!!reduced} />}

        {phase === "quiz" && result && (
          <motion.div key="quiz" className="min-h-0 flex-1" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {renderQuiz(result.quizId, onExit)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HazardMeter({ value }: { value: number }) {
  const colour = value > 70 ? "#e03131" : value > 40 ? "#f59f00" : "#40c057";
  return (
    <div className="absolute bottom-3 left-3 right-3 rounded-lg bg-black/55 p-2 backdrop-blur" role="meter" aria-label="Danger level" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className="mb-1 flex justify-between text-[10px] font-bold uppercase tracking-wide text-white/70">
        <span>Danger</span>
        <span>{Math.round(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <motion.div className="h-full rounded-full" animate={{ width: `${value}%`, backgroundColor: colour }} transition={{ duration: 0.3 }} />
      </div>
    </div>
  );
}

function Countdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const t0 = performance.now();
    const id = window.setInterval(() => setLeft(Math.max(0, seconds - (performance.now() - t0) / 1000)), 200);
    return () => window.clearInterval(id);
  }, [seconds]);
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <span className="flex items-center gap-1.5 text-xs text-white/60" aria-label={`${Math.ceil(left)} seconds`}>
      <svg width={34} height={34} viewBox="0 0 34 34">
        <circle cx={17} cy={17} r={r} stroke="rgba(255,255,255,.12)" strokeWidth={3} fill="none" />
        <circle cx={17} cy={17} r={r} stroke={left < seconds * 0.3 ? "#e03131" : "#ffd43b"} strokeWidth={3} fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - left / seconds)} transform="rotate(-90 17 17)" />
        <text x={17} y={21} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">
          {Math.ceil(left)}
        </text>
      </svg>
      {left === 0 && <span className="text-red-300">Decide now: it's getting worse</span>}
    </span>
  );
}

function Debrief({ r, onQuiz, onExit, reduced }: { r: ScenarioResult; onQuiz: () => void; onExit: () => void; reduced: boolean }) {
  const rad = 52;
  const c = 2 * Math.PI * rad;
  return (
    <motion.div className="min-h-0 flex-1 overflow-y-auto px-4 py-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex flex-wrap items-center gap-6">
          <svg width={130} height={130} viewBox="0 0 130 130" role="img" aria-label={`Safety score ${r.score}`}>
            <circle cx={65} cy={65} r={rad} stroke="rgba(255,255,255,.1)" strokeWidth={11} fill="none" />
            <motion.circle cx={65} cy={65} r={rad} stroke={r.score >= 80 ? "#20c997" : r.score >= 50 ? "#f59f00" : "#e03131"} strokeWidth={11} fill="none" strokeLinecap="round" transform="rotate(-90 65 65)" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - r.score / 100) }} transition={{ duration: reduced ? 0 : 1.2 }} />
            <text x={65} y={72} textAnchor="middle" fontSize={30} fontWeight={800} fill="#fff">
              {r.score}
            </text>
          </svg>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Safety score</p>
            <h2 className="font-heading text-2xl font-bold text-white">{r.ending.outcome === "safe" ? "Everyone is safe" : "That could have gone badly"}</h2>
            {r.badgeEligible && (
              <motion.p initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 12, delay: 0.8 }} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-3 py-1 text-sm font-semibold text-emerald-200">
                <ShieldCheck className="h-4 w-4" /> Safety award: 80+
              </motion.p>
            )}
          </div>
        </div>
        <div className="space-y-2 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/[0.08]">
          {r.breakdown.map((d, i) => (
            <div key={d.id} className="flex items-center gap-3 text-sm">
              <span className="w-48 text-white/75">{d.label}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${d.score}%` }} transition={{ delay: reduced ? 0 : 0.3 + i * 0.12, duration: 0.6 }} />
              </div>
              <span className="w-10 text-right font-mono text-xs text-white/60">{d.score}</span>
            </div>
          ))}
        </div>
        {r.mistakes.length > 0 && (
          <div className="rounded-2xl bg-red-500/[0.06] p-4 ring-1 ring-inset ring-red-400/20">
            <h3 className="flex items-center gap-2 font-semibold text-red-100">
              <X className="h-4 w-4" /> What to do differently
            </h3>
            <ul className="mt-2 space-y-2 text-sm">
              {r.mistakes.map((m, i) => (
                <li key={i}>
                  <span className="text-white/50">{m.stage}: </span>
                  <span className="text-white/80">"{m.choice}"</span>
                  <p className="text-white/65">{m.feedback}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="rounded-2xl bg-emerald-400/[0.06] p-4 ring-1 ring-inset ring-emerald-300/20">
          <h3 className="flex items-center gap-2 font-semibold text-emerald-100">
            <BookOpen className="h-4 w-4" /> Remember
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/80">
            {r.learn.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-white/45">Based on: {r.sources.join("; ")}.</p>
        </div>
        <p className="rounded-xl bg-white/[0.04] p-3 text-xs text-white/55">{r.disclaimer}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={onQuiz} className="inline-flex h-11 items-center gap-1.5 rounded-md bg-accent px-5 text-sm font-semibold text-white">
            Take the safety quiz <ArrowRight className="h-4 w-4" />
          </button>
          <button onClick={onExit} className="inline-flex h-11 items-center rounded-md bg-white/[0.07] px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/10">
            Back to scenarios
          </button>
        </div>
      </div>
    </motion.div>
  );
}
