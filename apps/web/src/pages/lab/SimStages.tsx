import { sound } from "@labscape/audio";
import { registerStage, type StageDemoProps, type StageTryProps } from "@labscape/lab-engine";
import { MATHS_CONTENT, MATHS_GUIDES, MATHS_MODELS, MATHS_WORKSPACES } from "@labscape/mathlab";
import { useMotion } from "@labscape/motion";
import { describeAction, PHYSICS_CONTENT, PHYSICS_GUIDES, PHYSICS_MODELS, PHYSICS_WORKSPACES, undoKey, useSimSession, type SimContent, type SimFeedback, type SimGuide, type SimModel, type SimSession, type WorkspaceProps } from "@labscape/physics";
import { Button, Chip, cx, Modal, useShell } from "@labscape/ui";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Captions, Check, CircleAlert, CircleHelp, Eye, Gauge, Lightbulb, Pause, Play, RotateCcw, ShieldAlert, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import type { LabContext } from "@labscape/contracts";
import { post } from "../../lib/api";
import { usePublishLabContext } from "../../lib/labContext";
import { useSession } from "../../lib/session";

type Sim = { content: SimContent; model: SimModel<unknown>; Workspace: ComponentType<WorkspaceProps>; guide: SimGuide | null };

function simFor(slug: string): Sim | null {
  const content = PHYSICS_CONTENT[slug] ?? MATHS_CONTENT[slug];
  const model = PHYSICS_MODELS[slug] ?? MATHS_MODELS[slug];
  const Workspace = PHYSICS_WORKSPACES[slug] ?? MATHS_WORKSPACES[slug];
  return content && model && Workspace ? { content, model, Workspace, guide: PHYSICS_GUIDES[slug] ?? MATHS_GUIDES[slug] ?? null } : null;
}

/* ================================================================== demo */

function SimDemo({ slug, onTry }: StageDemoProps) {
  const sim = simFor(slug)!;
  const idea = sim.guide?.idea ?? null;
  // Long demos drag at 1x: they start at 2x (1.5x for short ones). With an idea card, wait for Start.
  const session = useSimSession(sim.content, sim.model, { mode: "demo", autoplay: !idea, speed: sim.content.golden.durationS > 25 ? 2 : 1.5 });
  const [captions, setCaptions] = useState(true);
  const [started, setStarted] = useState(!idea);
  const d = session.demo;
  const caps = sim.content.golden.captions;
  const capIdx = caps.reduce((k, c, i) => (c.t <= d.t ? i : k), -1);
  const caption = capIdx >= 0 ? caps[capIdx]! : null;
  const why = caption ? sim.guide?.beats[capIdx] : null;
  const W = sim.Workspace;
  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto_auto]">
      <div className="relative min-h-0 overflow-y-auto p-3">
        <div className="pointer-events-none h-full [&_*]:pointer-events-none" aria-hidden={false}>
          <W session={session} />
        </div>
        {!started && idea && (
          <div className="absolute inset-0 z-10 grid place-items-center overflow-y-auto bg-[#060b18]/80 p-3 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-2xl border border-[#ffd77a]/30 bg-[#0d1426] p-4 shadow-2xl sm:p-5">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffd77a]">
                <Lightbulb className="h-4 w-4" /> The big idea
              </div>
              <h3 className="mt-1 font-heading text-lg font-semibold sm:text-xl">{idea.title}</h3>
              <p className="mt-2 text-sm text-white/80">{idea.body}</p>
              <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Watch for</div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-white/75">
                {idea.watch.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" icon={<Play className="h-4 w-4" />} onClick={() => (setStarted(true), d.setPlaying(true))}>
                  Start the demo
                </Button>
                <Button size="sm" variant="secondary" iconRight={<ArrowRight className="h-4 w-4" />} onClick={onTry}>
                  Skip to Try it myself
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      <AnimatePresence initial={false} mode="wait">
        {captions && started && caption && (
          <motion.div key={caption.t} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="border-t border-white/[0.07] bg-black/40 px-4 py-2" aria-live="polite">
            <p className="text-sm font-semibold text-white sm:text-base">
              {caption.slow && <span className="mr-2 rounded bg-accent/40 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase">slow-mo</span>}
              {caption.text}
            </p>
            {why && (
              <p className="mt-0.5 text-[13px] text-[#cfe0ff]/80">
                <span className="font-semibold text-[#ffd77a]">Why: </span>
                {why}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.07] bg-[#0d1426]/80 px-4 py-3">
        <Button size="sm" variant="secondary" icon={d.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} onClick={() => (setStarted(true), d.setPlaying(!d.playing))}>
          {d.playing ? "Pause" : d.t >= d.duration ? "Replay" : "Play"}
        </Button>
        <input type="range" min={0} max={d.duration} value={d.t} onChange={(e) => d.seek(Number(e.target.value))} className="h-1 min-w-[160px] flex-1 accent-[#2f80ff]" aria-label="Demo position" />
        <span className="font-mono text-xs text-white/60 tabular-nums">
          {(d.t / 1000).toFixed(0)} / {(d.duration / 1000).toFixed(0)} s
        </span>
        <div className="flex gap-1" role="radiogroup" aria-label="Speed">
          {[1, 1.5, 2, 3].map((x) => (
            <button key={x} role="radio" aria-checked={d.speed === x} onClick={() => d.setSpeed(x)} className={cx("rounded-full px-2 py-1 text-xs font-semibold", d.speed === x ? "bg-white/15 text-white" : "text-white/50")}>
              {x}×
            </button>
          ))}
        </div>
        <button onClick={() => setCaptions((c) => !c)} aria-pressed={captions} className={cx("grid h-8 w-8 place-items-center rounded-md", captions ? "text-white" : "text-white/40")} aria-label="Captions">
          <Captions className="h-4 w-4" />
        </button>
        <Button size="sm" iconRight={<ArrowRight className="h-4 w-4" />} onClick={onTry}>
          Try it myself
        </Button>
      </div>
    </div>
  );
}

/* ================================================================== try */

function SimTry({ slug, attempt, onSaved, onSaving, onSaveError, onDone, onRestart, announce }: StageTryProps) {
  const sim = simFor(slug)!;
  const { toast } = useShell();
  const { reduced } = useMotion();
  const [rungs, setRungs] = useState<Record<string, number>>({});
  const [safety, setSafety] = useState<Extract<SimFeedback, { kind: "safety-stop" }> | null>(null);
  const [shake, setShake] = useState(0);

  const session: SimSession = useSimSession(sim.content, sim.model, {
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
        announce(f.deviation.message, "assertive");
        if (!reduced) setShake((s) => s + 1);
        sound.play("error");
      } else if (f.kind === "safety-stop") {
        setSafety(f);
        sound.play("error");
      } else if (f.kind === "step-complete") {
        sound.play("success");
        const title = sim.content.steps.find((s) => s.id === f.stepId)?.title;
        if (title) announce(`Step done: ${title}`);
      }
    },
  });

  const steps = sim.content.steps;
  const current = steps.find((s) => s.id === session.currentStepId) ?? null;
  const report = session.report();
  const done = report.completed;
  const rung = current ? rungs[current.id] ?? 0 : 0;
  const hintText = current && rung ? sim.content.hints[current.hints?.[rung - 1] ?? ""]?.text : null;
  const showHint = () => {
    if (!current) return;
    const next = Math.min(3, rung + 1);
    setRungs((r) => ({ ...r, [current.id]: next }));
    session.dispatch("hint.shown", { hintId: current.hints?.[next - 1] ?? `${current.id}-${next}`, rung: next, stepId: current.id });
  };
  const W = sim.Workspace;
  const { me } = useSession();
  usePublishLabContext({
    surface: "experiment",
    subject: sim.content.subject,
    attemptId: attempt.id,
    experimentId: slug,
    experimentVersion: sim.content.version,
    experimentTitle: sim.content.title,
    stage: "try",
    ...(current ? { currentStepId: current.id } : {}),
    currentStepText: current ? `${current.title}. ${current.instruction}` : null,
    completedStepIds: steps.filter((s) => session.doneSteps[s.id] != null).map((s) => s.id),
    userLevel: (me?.profile.learningLevel ?? "school") as LabContext["userLevel"],
    bench: [],
    recentEvents: session.events.slice(-8),
    readings: [],
    deviations: report.deviations.map((d) => ({ stepId: d.stepId, code: d.code, severity: d.severity === "safety" ? "critical" : d.severity === "minor" ? "minor" : "major" })),
    hintsShown: Object.keys(rungs),
    highlightableIds: [],
  });
  const devs = useMemo(() => session.feedback.filter((f): f is Extract<SimFeedback, { kind: "deviation" }> => f.kind === "deviation").slice(-3).reverse(), [session.feedback]);
  const notes = session.notes.slice(-5).reverse();
  const guide = sim.guide;
  const explore = current ? guide?.explore[current.id] ?? [] : [];

  // Undo (button or Ctrl+Z): takes back the last action, and any mistake it caused.
  const undo = () => {
    const e = session.undo();
    if (!e) return;
    toast({ kind: "info", title: "Undone", body: `Took back ${describeAction(e)}.` });
    announce(`Undone: ${describeAction(e)}`);
  };
  const undoRef = useRef(undo);
  undoRef.current = undo;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (undoKey(ev) !== "undo") return;
      ev.preventDefault();
      undoRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid h-full min-h-0 grid-rows-[1fr_auto] lg:grid-cols-[1fr_340px] lg:grid-rows-1">
      <motion.div key={shake} className="relative min-h-0 overflow-y-auto p-3" animate={shake ? { x: [0, -3, 3, -3, 3, 0] } : {}} transition={{ duration: 0.3 }}>
        <W session={session} />
      </motion.div>

      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-white/[0.07] bg-[#0d1426]/70 p-4" aria-label="Steps and feedback">
        <div className="rounded-xl border border-accent/40 bg-accent/[0.08] p-4">
          {current ? (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-cyan">
                Step {steps.indexOf(current) + 1} of {steps.length}
                {current.optional ? " · optional" : ""}
              </div>
              <div className="mt-1 font-heading text-lg font-semibold">{current.title}</div>
              <p className="mt-1 text-sm text-white/75">{current.instruction}</p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 font-heading text-lg font-semibold text-state-success">
                <Check className="h-5 w-5" />
                All steps done
              </div>
              <p className="mt-1 text-sm text-white/70">Head to Observe to explain what you found.</p>
            </>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {current && (
              <Button size="sm" variant="secondary" icon={<Lightbulb className="h-4 w-4 text-[#ffd77a]" />} onClick={showHint} disabled={rung >= 3}>
                {rung === 0 ? "Hint" : rung >= 3 ? "No more hints" : "More help"}
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={undo} disabled={!session.undoable} title={session.undoable ? `Undo ${describeAction(session.undoable)} (Ctrl+Z)` : "Nothing to undo"}>
              Undo
            </Button>
            {(done || (current?.optional && steps.filter((s) => !s.optional).every((s) => session.doneSteps[s.id] !== null))) && (
              <Button size="sm" iconRight={<ArrowRight className="h-4 w-4" />} onClick={onDone}>
                Observe
              </Button>
            )}
          </div>
          <AnimatePresence>
            {hintText && (
              <motion.div key={`${current?.id}-${rung}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-3 rounded-lg bg-[#ffc23d]/10 p-3 text-sm text-[#ffe3a3] ring-1 ring-inset ring-[#ffc23d]/30">
                <span className="mr-1 font-semibold">{["", "Nudge:", "Try this:", "Show me:"][rung]}</span>
                {hintText}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {explore.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
              <CircleHelp className="h-3.5 w-3.5" />
              What if…?
            </div>
            <ul className="space-y-1.5">
              {explore.map((x) => (
                <li key={x.q}>
                  <details className="group rounded-lg bg-white/[0.04] px-3 py-2 text-sm">
                    <summary className="cursor-pointer list-none font-medium text-white/85 marker:hidden">
                      <span className="mr-1 inline-block text-white/40 transition-transform group-open:rotate-90">›</span>
                      {x.q}
                    </summary>
                    <p className="mt-1 text-white/70">{x.a}</p>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">Steps</div>
          <ol className="space-y-1">
            {steps.map((s, i) => {
              const isDone = session.doneSteps[s.id] !== null && session.doneSteps[s.id] !== undefined;
              const isCur = current?.id === s.id;
              return (
                <li key={s.id} className={cx("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm", isCur && "bg-white/[0.06]")}>
                  <span className={cx("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold", isDone ? "bg-state-success text-[#06210f]" : isCur ? "bg-accent text-white" : "bg-white/10 text-white/50")}>{isDone ? <Check className="h-3 w-3" /> : i + 1}</span>
                  <span className={cx(isDone ? "text-white/50" : isCur ? "font-medium text-white" : "text-white/60")}>{s.title}</span>
                  {s.optional && <Chip>optional</Chip>}
                </li>
              );
            })}
          </ol>
        </div>

        {devs.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
              <Gauge className="h-3.5 w-3.5" />
              Technique
            </div>
            <ul className="space-y-1.5">
              {devs.map((d, i) => {
                const consequence = guide?.whatIf[d.deviation.code];
                const canUndo = i === 0 && session.undoable?.t === d.deviation.t;
                return (
                  <li key={`${d.deviation.code}-${d.deviation.t}`} className={cx("rounded-lg px-3 py-2 text-sm", d.deviation.severity === "minor" ? "bg-state-warning/10 text-[#fcd27b]" : "bg-state-danger/10 text-[#ffb4b4]")}>
                    {d.deviation.message}
                    {consequence && (
                      <p className="mt-1 text-[13px] text-white/75">
                        <span className="font-semibold text-white/90">What this changes: </span>
                        {consequence}
                      </p>
                    )}
                    {canUndo && (
                      <button type="button" onClick={undo} className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-white hover:bg-white/15">
                        <Undo2 className="h-3.5 w-3.5" /> Undo that
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-auto">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
            <Eye className="h-3.5 w-3.5" />
            Observations
          </div>
          <ul className="space-y-1.5" aria-live="polite">
            <AnimatePresence initial={false}>
              {notes.map((n) => (
                <motion.li key={n.uid} layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className={cx("rounded-lg px-3 py-2 text-sm", n.tone === "danger" ? "bg-state-danger/10 text-[#ffb4b4]" : n.tone === "warning" ? "bg-state-warning/10 text-[#fcd27b]" : n.tone === "success" ? "bg-state-success/10 text-[#9ff0bf]" : "bg-white/[0.04] text-white/70")}>
                  {n.tone === "danger" ? <CircleAlert className="mr-1.5 inline h-3.5 w-3.5" /> : n.tone === "success" ? <Sparkles className="mr-1.5 inline h-3.5 w-3.5" /> : null}
                  {n.text}
                </motion.li>
              ))}
            </AnimatePresence>
            {notes.length === 0 && <li className="text-sm text-white/40">What you find shows up here.</li>}
          </ul>
        </div>
      </aside>

      <Modal open={!!safety} onClose={() => {}} dismissible={false} title="Safety stop" width={480}>
        {safety && (
          <div className="p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-state-danger/20 text-state-danger ring-1 ring-state-danger/40">
                <ShieldAlert className="h-6 w-6" />
              </span>
              <div>
                <div className="font-heading text-lg font-semibold">{safety.title}</div>
                <p className="mt-1 text-sm text-white/70">{safety.message}</p>
              </div>
            </div>
            <div className="mt-5">
              <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={onRestart}>
                Start again
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

const has = (slug: string) => !!simFor(slug);
registerStage("physics", { Demo: SimDemo, Try: SimTry, has });
registerStage("maths", { Demo: SimDemo, Try: SimTry, has });
