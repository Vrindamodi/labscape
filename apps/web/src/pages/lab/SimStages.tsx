import { sound } from "@labscape/audio";
import { registerStage, type StageDemoProps, type StageTryProps } from "@labscape/lab-engine";
import { MATHS_CONTENT, MATHS_MODELS, MATHS_WORKSPACES } from "@labscape/mathlab";
import { useMotion } from "@labscape/motion";
import { PHYSICS_CONTENT, PHYSICS_MODELS, PHYSICS_WORKSPACES, useSimSession, type SimContent, type SimFeedback, type SimModel, type SimSession, type WorkspaceProps } from "@labscape/physics";
import { Button, Chip, cx, Modal, useShell } from "@labscape/ui";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Captions, Check, CircleAlert, Eye, Gauge, Lightbulb, Pause, Play, RotateCcw, ShieldAlert, Sparkles } from "lucide-react";
import { useMemo, useState, type ComponentType } from "react";
import { post } from "../../lib/api";

type Sim = { content: SimContent; model: SimModel<unknown>; Workspace: ComponentType<WorkspaceProps> };

function simFor(slug: string): Sim | null {
  const content = PHYSICS_CONTENT[slug] ?? MATHS_CONTENT[slug];
  const model = PHYSICS_MODELS[slug] ?? MATHS_MODELS[slug];
  const Workspace = PHYSICS_WORKSPACES[slug] ?? MATHS_WORKSPACES[slug];
  return content && model && Workspace ? { content, model, Workspace } : null;
}

/* ================================================================== demo */

function SimDemo({ slug, onTry }: StageDemoProps) {
  const sim = simFor(slug)!;
  const session = useSimSession(sim.content, sim.model, { mode: "demo" });
  const [captions, setCaptions] = useState(true);
  const d = session.demo;
  const caption = [...sim.content.golden.captions].reverse().find((c) => c.t <= d.t);
  const W = sim.Workspace;
  return (
    <div className="grid h-full min-h-0 grid-rows-[1fr_auto]">
      <div className="relative min-h-0 p-3">
        <div className="pointer-events-none h-full [&_*]:pointer-events-none" aria-hidden={false}>
          <W session={session} />
        </div>
        <AnimatePresence>
          {captions && caption && (
            <motion.div key={caption.t} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-x-0 bottom-6 mx-auto w-fit max-w-[80%] rounded-xl bg-black/75 px-4 py-2 text-center text-base font-medium text-white shadow-xl" aria-live="polite">
              {caption.slow && <span className="mr-2 rounded bg-accent/40 px-1.5 py-0.5 text-[10px] font-bold uppercase">slow-mo</span>}
              {caption.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.07] bg-[#0d1426]/80 px-4 py-3">
        <Button size="sm" variant="secondary" icon={d.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} onClick={() => d.setPlaying(!d.playing)}>
          {d.playing ? "Pause" : d.t >= d.duration ? "Replay" : "Play"}
        </Button>
        <input type="range" min={0} max={d.duration} value={d.t} onChange={(e) => d.seek(Number(e.target.value))} className="h-1 min-w-[160px] flex-1 accent-[#2f80ff]" aria-label="Demo position" />
        <span className="font-mono text-xs text-white/60 tabular-nums">
          {(d.t / 1000).toFixed(0)} / {(d.duration / 1000).toFixed(0)} s
        </span>
        <div className="flex gap-1" role="radiogroup" aria-label="Speed">
          {[0.5, 1, 2].map((x) => (
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
  const devs = useMemo(() => session.feedback.filter((f): f is Extract<SimFeedback, { kind: "deviation" }> => f.kind === "deviation").slice(-3).reverse(), [session.feedback]);
  const notes = session.notes.slice(-5).reverse();

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
              {devs.map((d) => (
                <li key={`${d.deviation.code}-${d.deviation.t}`} className={cx("rounded-lg px-3 py-2 text-sm", d.deviation.severity === "minor" ? "bg-state-warning/10 text-[#fcd27b]" : "bg-state-danger/10 text-[#ffb4b4]")}>
                  {d.deviation.message}
                </li>
              ))}
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
