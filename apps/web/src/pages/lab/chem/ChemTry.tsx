import type { LabContext, LabEvent } from "@labscape/contracts";
import {
  DockButton,
  GhostButton,
  Glass,
  KINDS,
  Kicker,
  PrimaryButton,
  reagent,
  recordGolden,
  SuitUp,
  useLabSession,
  Workbench,
  type BenchFrame,
  type ExperimentContent,
  type Feedback,
  type Item,
  type PpeNeed,
  type StepSpec,
  type WorkbenchControl,
} from "@labscape/lab-engine";
import { sound } from "@labscape/audio";
import { useMotion } from "@labscape/motion";
import { Button, cx, Modal, useShell } from "@labscape/ui";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Beaker,
  Check,
  ChevronDown,
  CircleAlert,
  Droplet,
  Eye,
  Flame,
  FlaskConical,
  Glasses,
  Hand,
  Lightbulb,
  ListRestart,
  Pipette,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  TestTube,
  Thermometer,
  Undo2,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { post } from "../../../lib/api";
import { usePublishLabContext } from "../../../lib/labContext";
import { isAdmin, useSession } from "../../../lib/session";

type Attempt = { id: string; status: string; stage: string; events: LabEvent[] };

export type ChemTryProps = {
  content: ExperimentContent;
  attempt: Attempt;
  onSaved: (at: number) => void;
  onSaving: () => void;
  onSaveError: () => void;
  onDone: () => void;
  announce: (t: string, p?: "polite" | "assertive") => void;
  onRestart: () => void;
};

/** A "what if" card: the real consequence of what the learner just did, in plain words. */
type WhatIf = { key: number; code: string; title: string; consequence: string | null; detail: string; severity: "minor" | "major" | "safety" };

const TITLES: Record<string, string> = {
  order: "Wrong order",
  rate: "That was fast",
  overshoot: "Too much went in",
  quantity: "Not quite the right amount",
  "no-mixing": "It needed mixing",
  "not-dropwise": "Drop by drop here",
  "portion-too-big": "Smaller portions",
  "wrong-equipment": "That's a different vessel",
  reading: "Check that reading",
};

function safeReagent(id: string | undefined) {
  if (!id) return null;
  try {
    return reagent(id);
  } catch {
    return null;
  }
}

/** Looks up the authored "what if" text for a mistake: the step's own first, then any step. */
function findWhatIf(content: ExperimentContent, stepId: string, code: string): string | null {
  const own = content.steps.find((s) => s.id === stepId)?.whatIf?.[code];
  if (own) return own;
  for (const s of content.steps) if (s.whatIf?.[code]) return s.whatIf[code]!;
  return null;
}

/**
 * Try it yourself, chemistry: the playground layout around the protocol bench. "Your bench" shelf on
 * the left (click to pick up, or drag onto a glowing vessel), the 3D bench in the middle with the
 * dock (Stir, Swirl, Heat, Ice bath, Undo, Reset step), and the current step on the right with
 * hints, "what if" explanations and progress.
 *
 * Undo rewinds the event log locally and on the server (POST /restart keepThroughSeq), through one
 * ordered queue with the autosave batches so the server log always matches the bench.
 */
export function ChemTry({ content, attempt, onSaved, onSaving, onSaveError, onDone, announce, onRestart }: ChemTryProps) {
  const { reduced } = useMotion();
  const { me } = useSession();
  const recording = isAdmin(me) && new URLSearchParams(window.location.search).get("record") === "1";
  const [hintRung, setHintRung] = useState<Record<string, number>>({});
  const [hintPulse, setHintPulse] = useState(false);
  const [showMe, setShowMe] = useState<StepSpec | null>(null);
  const [safety, setSafety] = useState<Extract<Feedback, { kind: "safety-stop" }> | null>(null);
  const [whatIf, setWhatIf] = useState<WhatIf | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const control = useRef<WorkbenchControl | null>(null);
  const whatIfKey = useRef(0);

  // One ordered queue for every server write: autosave batches and rewinds never overtake each other.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(
    (job: () => Promise<unknown>) => {
      queue.current = queue.current.then(job).then(
        () => onSaved(Date.now()),
        () => onSaveError(),
      );
    },
    [onSaved, onSaveError],
  );

  const session = useLabSession(content, {
    mode: "try",
    attemptId: attempt.id,
    initialEvents: attempt.events,
    onBatch: (batch) => {
      onSaving();
      enqueue(() => post(`/v1/attempts/${attempt.id}/events`, { events: batch, stage: "try" }));
    },
    onNote: (n) => announce(n.text, n.tone === "danger" ? "assertive" : "polite"),
    onFeedback: (f) => {
      if (f.kind === "deviation") {
        const d = f.deviation;
        if (d.severity === "safety") return;
        const consequence = findWhatIf(content, d.stepId, d.code);
        setWhatIf({ key: ++whatIfKey.current, code: d.code, title: TITLES[d.code] ?? "Something to know", consequence, detail: d.message, severity: d.severity === "minor" ? "minor" : "major" });
        announce(`${TITLES[d.code] ?? "Careful"}. ${consequence ?? d.message}`, "assertive");
        sound.play("error");
      } else if (f.kind === "hint-suggest") {
        setHintPulse(true);
      } else if (f.kind === "safety-stop") {
        setSafety(f);
        sound.play("error");
      } else if (f.kind === "step-complete") {
        sound.play("success");
      }
    },
  });

  const ev = session.evaluator;
  const current = ev?.current() ?? null;
  const report = ev?.report();
  const done = report?.completed ?? false;
  const items = Object.values(session.state.items);
  const curIdx = current ? content.steps.indexOf(current) : content.steps.length;

  // The assistant reads this snapshot with every question (contract 5).
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

  /* ---------------------------------------------------------------- undo and rewinds */

  const syncRewind = useCallback(
    (keep: number) => {
      onSaving();
      enqueue(() => post(`/v1/attempts/${attempt.id}/restart`, { keepThroughSeq: keep }));
    },
    [attempt.id, enqueue, onSaving],
  );

  const undo = useCallback(() => {
    const keep = session.undo();
    if (keep === null) return;
    control.current?.putDown();
    setWhatIf(null);
    setSafety(null);
    syncRewind(keep);
    sound.play("whoosh");
    announce("Undone. The bench is back to how it was before that.", "polite");
  }, [session, syncRewind, announce]);

  /** The seq to keep so that the run restarts at the beginning of this step. */
  const keepBefore = useCallback(
    (stepId: string | undefined) => {
      if (!ev) return 0;
      const idx = stepId ? Math.max(0, content.steps.findIndex((s) => s.id === stepId)) : 0;
      const times = content.steps
        .slice(0, idx)
        .map((s) => ev.progress(s.id).doneAt)
        .filter((x): x is number => x !== null);
      const since = times.length ? Math.max(...times) : -1;
      return session.events.filter((e) => e.t <= since).reduce((m, e) => Math.max(m, e.seq), 0);
    },
    [ev, content.steps, session.events],
  );

  const rewindTo = useCallback(
    (keep: number) => {
      control.current?.putDown();
      session.rewind(keep);
      setWhatIf(null);
      setSafety(null);
      syncRewind(keep);
      sound.play("whoosh");
    },
    [session, syncRewind],
  );

  const resetKeep = current ? keepBefore(current.id) : null;
  const canReset = resetKeep !== null && session.events.some((e) => e.seq > resetKeep && e.actor === "user" && e.type !== "hint.shown");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  /* ---------------------------------------------------------------- hints */

  const showHint = () => {
    if (!current || !ev) return;
    const rung = Math.min(3, (hintRung[current.id] ?? 0) + 1) as 1 | 2 | 3;
    const h = ev.hint(current.id, rung);
    setHintRung((r) => ({ ...r, [current.id]: rung }));
    setHintPulse(false);
    session.dispatch("hint.shown", { hintId: h?.id ?? `${current.id}-${rung}`, rung, stepId: current.id });
    if (rung === 3) setShowMe(current);
  };
  const curHint = current && hintRung[current.id] ? ev?.hint(current.id, hintRung[current.id] as 1 | 2 | 3) : null;

  /* ---------------------------------------------------------------- suit up */

  // Goggles and a coat always, gloves when anything is corrosive, toxic or an irritant. Wearing the
  // goggles here is the experiment's own "goggles on".
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
    for (const it of content.bench.items) safeReagent(it.fill?.reagentId)?.hazards.forEach((h) => hz.add(h));
    const gloves = hz.has("corrosive") || hz.has("toxic") || hz.has("irritant");
    return [
      { id: "coat", required: true, why: "Keeps splashes off your clothes and skin." },
      { id: "goggles", required: true, why: hz.has("corrosive") ? "Corrosive liquids on this bench can blind." : "Splashes and sparks happen without warning." },
      { id: "gloves", required: gloves, why: gloves ? `Something here is ${[...hz].filter((h) => ["corrosive", "toxic", "irritant"].includes(h)).join(" and ")}.` : "Nothing harsh here, but good habit." },
    ];
  }, [content.bench.items]);

  /* ---------------------------------------------------------------- camera */

  // Close-up on what the current step uses; the whole bench when the run is done.
  const frame = useMemo<BenchFrame>(() => {
    const ids = current ? [current.from, current.to].filter((x): x is string => !!x && !!session.state.items[x] && session.state.items[x]!.socket !== "worn") : [];
    if (!ids.length) return { key: "all", ids: content.bench.items.map((i) => i.id) };
    return { key: `step:${current!.id}`, ids };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, content]);

  const guide = current ? (!held ? current.from : held === current.from ? current.to : undefined) : undefined;

  const finish = async () => {
    // Let the last autosave batch go out before Observe reads the log.
    await new Promise((r) => window.setTimeout(r, 600));
    await queue.current;
    onDone();
  };

  const latestNotes = session.notes.slice(-4).reverse();

  return (
    <div className="relative h-full min-h-0">
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] lg:grid-cols-[228px_minmax(0,1fr)_340px] lg:grid-rows-1">
        <BenchShelf items={items} glow={guide} held={held} control={control} />

        {/* bench */}
        <div className="relative min-h-[240px] px-2 lg:px-0 lg:py-3">
          <Workbench
            session={session}
            step={current}
            chrome="studio"
            control={control}
            onHeldChange={setHeld}
            frame={frame}
            onLiveWarning={(text) => {
              setLive(text);
              announce(text, "assertive");
              window.setTimeout(() => setLive((l) => (l === text ? null : l)), 2600);
            }}
            dockExtra={
              <>
                <DockButton icon={<Undo2 />} label="Undo" kbd="Ctrl Z" disabled={!session.canUndo} title="Undo your last action" onClick={undo} />
                <DockButton icon={<ListRestart />} label="Reset step" tone="danger" disabled={!canReset} title="Put the bench back to the start of this step" onClick={() => resetKeep !== null && rewindTo(resetKeep)} />
              </>
            }
            overlay={
              <AnimatePresence>
                {live && (
                  <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="pointer-events-none absolute bottom-[128px] left-1/2 z-[8] w-max max-w-[calc(100%-24px)] -translate-x-1/2" role="alert">
                    <div className="rounded-[12px] border border-[rgba(255,194,61,.5)] bg-[rgba(60,44,6,.92)] px-3 py-1.5 text-[13px] font-semibold text-[#ffe3a3]">{live}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            }
          />
        </div>

        {/* step panel */}
        <aside className="min-h-0 overflow-y-auto p-2 max-lg:max-h-[34vh] lg:p-3" aria-label="Your step">
          <Glass className="flex min-h-full flex-col gap-3 p-4">
            {recording && <Recorder content={content} events={session.events} />}

            <AnimatePresence>
              {whatIf && <WhatIfCard key={whatIf.key} w={whatIf} reduced={reduced} canUndo={session.canUndo} onUndo={undo} onClose={() => setWhatIf(null)} />}
            </AnimatePresence>

            {current ? (
              <StepCard
                content={content}
                step={current}
                index={curIdx}
                doneIds={new Set((report?.steps ?? []).filter((s) => s.done).map((s) => s.id))}
                hintLabel={(hintRung[current.id] ?? 0) === 0 ? "Hint" : (hintRung[current.id] ?? 0) >= 3 ? "Show me again" : "More help"}
                hintPulse={hintPulse}
                onHint={showHint}
                hint={curHint ? { rung: curHint.rung, text: curHint.text } : null}
              />
            ) : (
              <div>
                <div className="flex items-center gap-2 font-heading text-lg font-semibold text-[#3de8a8]">
                  <Check className="h-5 w-5" /> All steps done
                </div>
                <p className="mt-1 text-sm text-[#c8d6f3]">Nice work. Next, explain what you saw.</p>
              </div>
            )}

            {done && (
              <PrimaryButton className="h-11 w-full text-[15px]" onClick={() => void finish()}>
                Go to Observe <ArrowRight className="h-4 w-4" />
              </PrimaryButton>
            )}

            {latestNotes.length > 0 && (
              <div className="mt-auto hidden lg:block">
                <Kicker className="mb-1.5 flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5" /> What you see
                </Kicker>
                <ul className="space-y-1.5" aria-live="polite">
                  {latestNotes.map((n) => (
                    <li key={n.uid} className={cx("rounded-lg px-3 py-2 text-[13px] leading-snug", n.tone === "danger" ? "bg-state-danger/10 text-[#ffb4b4]" : n.tone === "warning" ? "bg-state-warning/10 text-[#fcd27b]" : n.tone === "success" ? "bg-state-success/10 text-[#9ff0bf]" : "bg-white/[0.04] text-white/75")}>
                      {n.tone === "danger" ? <CircleAlert className="mr-1.5 inline h-3.5 w-3.5" /> : n.tone === "success" ? <Sparkles className="mr-1.5 inline h-3.5 w-3.5" /> : null}
                      {n.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Glass>
        </aside>
      </div>

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

      {/* "Show me": replay that step from the golden run */}
      <Modal open={!!showMe} onClose={() => setShowMe(null)} title={`Show me: ${showMe?.title ?? ""}`} width={860}>
        {showMe && <ShowMe content={content} step={showMe} />}
      </Modal>

      {/* safety stop */}
      <Modal open={!!safety} onClose={() => {}} dismissible={false} title="Safety stop" width={500}>
        {safety && (
          <div className="p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-state-danger/20 text-state-danger ring-1 ring-state-danger/40">
                <ShieldAlert className="h-6 w-6" />
              </span>
              <div>
                <div className="font-heading text-lg font-semibold">{safety.rule.title}</div>
                <p className="mt-1 text-sm text-white/75">{safety.rule.message}</p>
              </div>
            </div>
            {findWhatIf(content, current?.id ?? "", safety.rule.code) && (
              <div className="mt-4 rounded-xl border border-[rgba(255,194,61,.35)] bg-[rgba(255,194,61,.08)] p-3 text-sm text-[#fff1cf]">
                <b className="mr-1 text-[#ffd77a]">In a real lab:</b>
                {findWhatIf(content, current?.id ?? "", safety.rule.code)}
              </div>
            )}
            <p className="mt-3 text-xs text-white/50">Nobody was hurt: this is a simulation. Undo puts the bench back to just before that action.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button icon={<Undo2 className="h-4 w-4" />} onClick={undo} disabled={!session.canUndo}>
                Undo that
              </Button>
              <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => rewindTo(keepBefore(safety.rule.restartFrom))}>
                Restart from that step
              </Button>
              <Button variant="ghost" onClick={onRestart}>
                Start over
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ step card */

function StepCard(p: { content: ExperimentContent; step: StepSpec; index: number; doneIds: Set<string>; hintLabel: string; hintPulse: boolean; onHint: () => void; hint: { rung: number; text: string } | null }) {
  const { content, step } = p;
  const [exploreOpen, setExploreOpen] = useState(false);
  useEffect(() => setExploreOpen(false), [step.id]);
  const explore = step.explore ?? [];
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Kicker className="text-[#39d6ff]">
          Step {p.index + 1} of {content.steps.length}
        </Kicker>
        <div className="flex flex-wrap justify-end gap-1" aria-hidden>
          {content.steps.map((s, i) => (
            <span key={s.id} title={s.title} className={cx("h-2 w-2 rounded-full", p.doneIds.has(s.id) ? "bg-[#3de8a8]" : i === p.index ? "bg-[#3d8bff] shadow-[0_0_8px_#3d8bff]" : "bg-white/15")} />
          ))}
        </div>
      </div>
      <h2 className="mt-1.5 font-heading text-[20px] font-bold leading-tight">{step.title}</h2>
      <p className="mt-1.5 text-[14.5px] leading-snug text-[#dbe7ff]">{step.instruction}</p>
      {step.quantity && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1 font-mono text-[12.5px] text-[#c8d6f3]">
          Target {step.quantity.target} {step.quantity.unit} <span className="text-[#8fa6d1]">± {step.quantity.plusMinus}</span>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <GhostButton className={cx("h-9", p.hintPulse && "ls-breathe")} onClick={p.onHint}>
          <Lightbulb className="h-4 w-4 text-[#ffd77a]" /> {p.hintLabel}
        </GhostButton>
        {explore.length > 0 && (
          <GhostButton className="h-9" onClick={() => setExploreOpen((o) => !o)} aria-expanded={exploreOpen}>
            What if…? <ChevronDown className={cx("h-4 w-4 transition-transform", exploreOpen && "rotate-180")} />
          </GhostButton>
        )}
      </div>
      <AnimatePresence initial={false}>
        {p.hint && (
          <motion.div key={`${step.id}-${p.hint.rung}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-3 rounded-lg bg-[#ffc23d]/10 p-3 text-[13.5px] text-[#ffe3a3] ring-1 ring-inset ring-[#ffc23d]/30">
              <span className="mr-1 font-semibold">{["", "Nudge:", "Try this:", "Show me:"][p.hint.rung]}</span>
              {p.hint.text}
            </div>
          </motion.div>
        )}
        {exploreOpen && (
          <motion.ul key="explore" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-3 space-y-2 overflow-hidden" aria-label="What if I do it differently?">
            {explore.map((x) => (
              <li key={x.if} className="rounded-[12px] border border-[rgba(167,123,255,.3)] bg-[rgba(167,123,255,.10)] p-3 text-[13px] leading-snug">
                <div className="font-semibold text-white">What if I {x.if}?</div>
                <div className="mt-0.5 text-[#e2d8ff]">{x.then}</div>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ what-if card */

function WhatIfCard({ w, reduced, canUndo, onUndo, onClose }: { w: WhatIf; reduced: boolean; canUndo: boolean; onUndo: () => void; onClose: () => void }) {
  const minor = w.severity === "minor";
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, height: 0 }}
      className={cx("rounded-[16px] border p-3.5", minor ? "border-[rgba(255,194,61,.45)] bg-[rgba(60,44,6,.55)]" : "border-[rgba(255,120,120,.5)] bg-[rgba(70,12,20,.55)]")}
      role="alert"
    >
      <div className="flex items-start gap-2.5">
        <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-[10px]", minor ? "bg-[rgba(255,194,61,.2)] text-[#ffd77a]" : "bg-[rgba(255,91,107,.2)] text-[#ff9b9b]")}>
          <Lightbulb className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className={cx("text-[11px] font-bold uppercase tracking-[0.08em]", minor ? "text-[#ffd77a]" : "text-[#ff9b9b]")}>What that would do</div>
          <div className="font-heading text-[16px] font-bold leading-tight">{w.title}</div>
        </div>
        <button onClick={onClose} className="rounded p-1 text-white/50 hover:text-white" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-[13.5px] leading-snug text-[#fff1e6]">{w.consequence ?? w.detail}</p>
      {w.consequence && <p className="mt-1.5 text-[12px] text-white/55">{w.detail}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {canUndo && (
          <PrimaryButton className="h-9" onClick={onUndo}>
            <Undo2 className="h-4 w-4" /> Undo that
          </PrimaryButton>
        )}
        <GhostButton className="h-9" onClick={onClose}>
          Keep going
        </GhostButton>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ shelf */

function iconFor(it: Item): ReactNode {
  const c = "h-5 w-5";
  switch (it.kind) {
    case "test_tube":
    case "boiling_tube":
      return <TestTube className={c} />;
    case "beaker_100":
    case "beaker_250":
    case "measuring_cylinder_10":
    case "measuring_cylinder_50":
      return <Beaker className={c} />;
    case "conical_flask_100":
      return <FlaskConical className={c} />;
    case "pipette_10":
    case "burette_50":
      return <Pipette className={c} />;
    case "dropper_bottle":
    case "wash_bottle":
      return <Droplet className={c} />;
    case "thermometer":
      return <Thermometer className={c} />;
    case "bunsen":
    case "splint":
      return <Flame className={c} />;
    case "goggles":
      return <Glasses className={c} />;
    default:
      return <Wrench className={c} />;
  }
}

const fmtMl = (v: number) => (v < 10 ? v.toFixed(1) : Math.round(v).toString());

function BenchShelf({ items, glow, held, control }: { items: Item[]; glow: string | undefined; held: string | null; control: MutableRefObject<WorkbenchControl | null> }) {
  const chemicals = items.filter((it) => (it.kind === "reagent_bottle" || it.kind === "dropper_bottle" || it.kind === "watch_glass") && it.socket !== "worn");
  const kit = items.filter((it) => !chemicals.includes(it));
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null);

  const onDown = (e: ReactPointerEvent, it: Item) => {
    if (it.socket === "worn" || e.button !== 0) return;
    drag.current = { id: it.id, x: e.clientX, y: e.clientY, moved: false };
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) {
        d.moved = true;
        control.current?.dragFromShelf(d.id);
      }
      if (d.moved) setGhost({ id: d.id, x: e.clientX, y: e.clientY });
    };
    const up = () => {
      // A drag ends inside the bench (it handles the drop); a press without movement is a click.
      window.setTimeout(() => {
        drag.current = null;
        setGhost(null);
      }, 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [control]);

  const ghostItem = ghost ? items.find((i) => i.id === ghost.id) : null;

  const tile = (it: Item) => {
    const r = safeReagent(it.reagentId);
    const worn = it.socket === "worn";
    const vol = it.liquid?.volumeMl ?? 0;
    const sub = worn ? "Worn" : r ? `${r.formula}${vol > 0 ? ` · ${fmtMl(vol)} mL` : ""}` : vol > 0 ? `${fmtMl(vol)} mL` : KINDS[it.kind].label;
    return (
      <button
        key={it.id}
        onPointerDown={(e) => onDown(e, it)}
        onClick={() => {
          if (drag.current?.moved || worn) return;
          control.current?.pickUp(it.id);
        }}
        aria-pressed={held === it.id}
        disabled={worn}
        title={worn ? `${it.label}: worn` : `${it.label}: click to pick up, or drag onto the bench`}
        className={cx(
          "group flex shrink-0 items-center gap-2.5 rounded-[12px] border px-2.5 py-2 text-left transition max-lg:w-[164px] lg:w-full",
          "touch-pan-x lg:touch-pan-y",
          held === it.id ? "border-[#6aa8ff] bg-[rgba(61,139,255,.2)] shadow-[0_0_0_1px_#6aa8ff]" : glow === it.id ? "animate-pulse border-[#39d6ff] bg-[rgba(57,214,255,.10)]" : "border-[rgba(140,180,255,.12)] bg-[rgba(4,10,28,.45)] hover:border-[rgba(140,180,255,.35)]",
          worn && "opacity-60",
        )}
      >
        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-[#cfe0ff]" style={{ background: r ? `radial-gradient(circle at 50% 60%, ${r.hex}cc, ${r.hex}33)` : "rgba(120,160,255,.12)" }}>
          {worn ? <Check className="h-5 w-5 text-[#3de8a8]" /> : iconFor(it)}
          {r && r.hazards.length > 0 && <i className="absolute -right-1 -top-1 h-3 w-3 rotate-45 rounded-[2px] border-[1.6px] border-[#ff5b6b] bg-white" title={r.hazards.join(", ")} />}
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[13px] font-semibold text-white">{it.label}</b>
          <span className="block truncate font-mono text-[11px] text-[#8fa6d1]">{sub}</span>
        </span>
        {held === it.id && <Hand className="h-4 w-4 shrink-0 text-[#6aa8ff]" />}
      </button>
    );
  };

  return (
    <>
      <nav className="min-h-0 px-2 pt-2 lg:overflow-y-auto lg:p-3" aria-label="Your bench">
        <Glass className="flex gap-2 overflow-x-auto p-2 [scrollbar-width:thin] lg:min-h-full lg:flex-col lg:overflow-visible lg:p-3">
          <div className="hidden lg:block">
            <b className="font-heading text-[15px]">Your bench</b>
            <p className="text-[11.5px] text-[#8fa6d1]">Click to pick up, or drag onto a glowing vessel.</p>
          </div>
          {chemicals.length > 0 && <Kicker className="hidden lg:mt-1 lg:block">Chemicals</Kicker>}
          {chemicals.map(tile)}
          {kit.length > 0 && <Kicker className="hidden lg:mt-2 lg:block">Equipment</Kicker>}
          {kit.map(tile)}
        </Glass>
      </nav>
      {ghost && ghostItem && (
        <div className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[130%] rounded-full bg-[rgba(61,139,255,.92)] px-3 py-1 text-[12px] font-semibold text-white shadow-lg" style={{ left: ghost.x, top: ghost.y }}>
          {ghostItem.label}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ show me, recorder */

function ShowMe({ content, step }: { content: ExperimentContent; step: StepSpec }) {
  const session = useLabSession(content, { mode: "demo" });
  const { seek, setSpeed } = session;
  // Start a couple of seconds before the golden run's first event for this step.
  const start = useMemo(() => {
    const e = content.golden.events.find((g) => {
      const p = g.payload as Record<string, unknown>;
      return (g.type === step.action || (step.alsoActions ?? []).includes(g.type)) && (!step.from || p.from === step.from || p.equipmentId === step.from || p.instrument === step.from);
    });
    return Math.max(0, (e?.t ?? 0) - 2000);
  }, [content, step]);
  useEffect(() => {
    seek(start);
    setSpeed(1.5);
  }, [seek, setSpeed, start]);
  const ids = [step.from, step.to].filter((x): x is string => !!x && !!content.bench.items.find((i) => i.id === x));
  return (
    <div className="h-[min(460px,60vh)] p-3">
      <Workbench session={session} readOnly frame={ids.length ? { key: step.id, ids } : null} />
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
        <Button size="sm" variant="secondary" onClick={capture} disabled={!events.length}>
          Score this run
        </Button>
        {out && (
          <Button size="sm" onClick={() => void copy()} disabled={out.report.deviations.length > 0}>
            Copy JSON
          </Button>
        )}
      </div>
      {out && (
        <div className="mt-2 text-xs text-white/75">
          <p>
            <b className="text-white">{out.report.stars}★</b> · {out.report.score}% · {out.golden.durationS} s · {out.golden.captions.length} draft captions
          </p>
          {out.report.deviations.length > 0 ? <p className="mt-1 text-amber-200">Only runs with no deviations can be saved as golden runs.</p> : <p className="mt-1 text-emerald-200">Clean run. Observation answers come later at Observe, so that score shows 0 here.</p>}
          {out.report.deviations.slice(0, 4).map((d, i) => (
            <p key={i} className="mt-1 text-red-200/90">
              • {d.code} ({d.severity})
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
