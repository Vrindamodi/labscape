import type { LabContext, LabEvent, LabEventType } from "@labscape/contracts";
import {
  DockButton,
  GhostButton,
  Glass,
  goldenSegments,
  KINDS,
  Kicker,
  PrimaryButton,
  reagent,
  recordGolden,
  stepHands,
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
  Crosshair,
  Droplet,
  Eye,
  FastForward,
  Flame,
  FlaskConical,
  Glasses,
  Hand,
  Lightbulb,
  ListRestart,
  Pipette,
  Play,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  TestTube,
  Thermometer,
  Undo2,
  Wand2,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { post } from "../../../lib/api";
import { usePublishLabContext } from "../../../lib/labContext";
import { isAdmin, useSession } from "../../../lib/session";
import { stagesFor } from "./stages";

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
type WhatIf = { key: number; stepId: string; code: string; title: string; consequence: string | null; detail: string; severity: "minor" | "major" | "safety" };

const TITLES: Record<string, string> = {
  order: "Wrong order",
  rate: "That was fast",
  overshoot: "Too much went in",
  quantity: "Not quite the right amount",
  "no-mixing": "It needed mixing",
  "not-dropwise": "Drop by drop here",
  "portion-too-big": "Smaller portions",
  "wrong-equipment": "That's a different vessel",
  "wrong-target": "Wrong container for this step",
  reading: "Check that reading",
};

/** Simulation speed while time is skipped ahead (waiting for a reaction). */
const SKIP_SPEED = 40;
const GUIDE_KEY = "labscape.guide";

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

/** "Sodium hydroxide 0.100 M" -> "sodium hydroxide 0.100 M" (a leading acronym such as "HCl" stays). */
const lower = (s: string | undefined) => (s ? (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s) : "item");

/** One short sentence: exactly what to do next for this step, given what is in hand. */
function nextMove(step: StepSpec, held: string | null, items: Record<string, Item>, pourMode: "pour" | "drop" | "pipette-out" | null): string {
  const { pick, target } = stepHands(step, items);
  const name = (id: string | null) => lower(id ? items[id]?.label : undefined);
  const holdingPick = !!pick && held === pick;
  if (holdingPick && pourMode === "pour") return step.quantity ? `Press Pour: it stops by itself at ${step.quantity.target} ${step.quantity.unit}.` : "Press Pour, then Stop when it is enough.";
  if (holdingPick && pourMode === "drop") return "Press “Add one drop”, one at a time, and watch what happens.";
  if (holdingPick && pourMode === "pipette-out") return "Press “Let it drain” to empty the pipette into the flask.";
  switch (step.action) {
    case "timer.mark":
      return "Now watch what happens. Press “Skip ahead” to speed up time.";
    case "mix.swirl":
      return "Press Swirl in the tool bar under the bench.";
    case "mix.stir":
      return "Press Stir in the tool bar under the bench.";
    case "mix.shake":
      return "Press Shake in the tool bar under the bench.";
    case "heat.set":
      return pick && items[pick]?.gasOn ? "Press “Heat off” in the tool bar to turn the Bunsen off." : "Press Heat in the tool bar to light the Bunsen burner.";
    case "measure.read":
      return holdingPick ? "Press “Read the scale”, line your eye up with the liquid, then Record." : `Click the ${name(pick)} to pick it up.`;
    default:
      break;
  }
  if (step.action === "equipment.place" && pick && items[pick]?.kind === "goggles") return "Press Goggles in the tool bar to put them on.";
  if (pick && items[pick]?.kind === "burette_50" && step.action === "liquid.drop") {
    return holdingPick ? "Slide the tap open a little to let it run, and close it (slide to 0) when the step is done." : "Click the burette to take hold of its tap.";
  }
  if (step.action === "liquid.draw") return holdingPick ? `Click the ${name(target)}, then line the level up with the mark and press Draw.` : `Click the ${name(pick)} to pick it up.`;
  if (step.action === "param.set") return holdingPick ? "Use the button in the “In your hand” card." : `Click the ${name(pick)} to pick it up.`;
  if (!pick) return step.instruction;
  if (!holdingPick) return `Click the glowing ${name(pick)} to pick it up.`;
  if (target) return step.action === "liquid.pour" ? `Now click the ${name(target)}, then press Pour.` : `Now click the glowing ${name(target)}.`;
  return "Use the button in the “In your hand” card.";
}

/** The one-click way to do a transfer step (pour, drops, tip in, use on), or null. */
function quickAction(content: ExperimentContent, step: StepSpec, items: Record<string, Item>): { label: string; from: string; to: string; amount?: number } | null {
  const { pick, target } = stepHands(step, items);
  if (!pick || !target || items[pick]?.kind === "burette_50") return null;
  const to = lower(items[target]?.label);
  if (step.action === "liquid.pour") {
    const golden = content.golden.events.find((e) => e.type === "liquid.pour" && e.payload.from === pick && e.payload.to === target);
    const amount = step.quantity?.unit === "mL" ? step.quantity.target : typeof golden?.payload.volumeMl === "number" ? golden.payload.volumeMl : undefined;
    return { label: amount ? `Pour ${amount} mL into the ${to}` : `Pour into the ${to}`, from: pick, to: target, ...(amount ? { amount } : {}) };
  }
  if (step.action === "liquid.drop") return { label: `Add drops to the ${to}`, from: pick, to: target };
  if (step.action === "solid.add") return { label: `Tip it into the ${to}`, from: pick, to: target };
  if (step.action === "liquid.draw") return { label: `Draw up from the ${to}`, from: pick, to: target };
  if (step.action === "equipment.connect" || step.action === "equipment.place") return { label: `Use it on the ${to}`, from: pick, to: target };
  return null;
}

/**
 * Try it yourself, chemistry. "Your bench" shelf on the left (a strip on top on narrow screens),
 * the 3D bench in the middle with a status line and the tool dock under it (nothing sits on top of
 * the apparatus), and the step panel on the right (a bottom sheet on narrow screens) with the
 * stage, the step, Guide me, the in-hand card and what you see now.
 *
 * Guide me (on by default) says exactly what to click next, glows only that thing, and offers
 * "Do this step for me" (plays the golden run's events for the step through the same session, so
 * the server log stays consistent; recorded as a hint) and "Show me" (that part of the demo).
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
  const [pastWhatIfs, setPastWhatIfs] = useState<WhatIf[]>([]);
  const [live, setLive] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [pourMode, setPourMode] = useState<"pour" | "drop" | "pipette-out" | null>(null);
  const [handSlot, setHandSlot] = useState<HTMLElement | null>(null);
  const [manualCam, setManualCam] = useState(false);
  const [recentre, setRecentre] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [guideOn, setGuideOn] = useState(() => {
    try {
      return localStorage.getItem(GUIDE_KEY) !== "0";
    } catch {
      return true;
    }
  });
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
        setWhatIf({ key: ++whatIfKey.current, stepId: d.stepId, code: d.code, title: TITLES[d.code] ?? "Something to know", consequence, detail: d.message, severity: d.severity === "minor" ? "minor" : "major" });
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
  const doneIds = useMemo(() => new Set((report?.steps ?? []).filter((s) => s.done).map((s) => s.id)), [report]);

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
    completedStepIds: [...doneIds],
    userLevel: (me?.profile.learningLevel ?? "school") as LabContext["userLevel"],
    bench: items.map((it) => ({ id: it.id, kind: it.kind, ...(it.liquid && it.liquid.volumeMl > 0 ? { contents: [{ species: it.reagentId ?? "solution", volumeMl: Math.round(it.liquid.volumeMl * 10) / 10 }], temperatureC: Math.round(it.liquid.tempC) } : {}) })),
    recentEvents: session.events.slice(-8),
    readings: [],
    deviations: (report?.deviations ?? []).map((d) => ({ stepId: d.stepId, code: d.code, severity: d.severity === "safety" ? "critical" : d.severity === "minor" ? "minor" : "major" })),
    hintsShown: Object.keys(hintRung),
    highlightableIds: items.map((it) => it.id),
  });

  /* ---------------------------------------------------------------- stages and the "now" */

  const stages = useMemo(() => stagesFor(content), [content]);
  const stageIdx = current ? Math.max(0, stages.findIndex((g) => g.steps.includes(current.id))) : stages.length;
  const stage = stages[stageIdx];

  // Feedback belongs to the step it was about: when the step changes, old cards and notes move to
  // "Earlier" so "What you see" only shows what is relevant now.
  const [stepStart, setStepStart] = useState(() => performance.now());
  const prevStep = useRef(current?.id);
  useEffect(() => {
    if (prevStep.current === current?.id) return;
    prevStep.current = current?.id;
    setStepStart(performance.now());
    setHintPulse(false);
    setWhatIf((w) => {
      if (w) setPastWhatIfs((p) => [...p, w].slice(-8));
      return null;
    });
  }, [current?.id]);
  const nowNotes = session.notes.filter((n) => n.at >= stepStart - 4000).slice(-4).reverse();
  const earlierNotes = session.notes.filter((n) => n.at < stepStart - 4000).slice(-10).reverse();

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

  /* ---------------------------------------------------------------- do this step for me, skip ahead */

  // "Do this step for me": the golden run's events for this step, sent through the same session at
  // their recorded pace (long gaps run faster), so the server replays exactly what the bench shows.
  const assist = useRef<{ stepId: string; events: { t: number; type: LabEventType; payload: Record<string, unknown> }[]; i: number; t0: number | null; segStart: number; span: number } | null>(null);
  const [assisting, setAssisting] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);
  const assistedKey = `labscape.assisted.${attempt.id}`;

  const doForMe = () => {
    if (!current || !ev || assisting || session.stopped) return;
    const step = current;
    setPreparing(true);
    // Let the button show "Getting ready" before the golden run is split (it replays the run).
    window.setTimeout(() => {
      const seg = goldenSegments(content)[step.id];
      setPreparing(false);
      control.current?.putDown();
      if (canReset && resetKeep !== null) rewindTo(resetKeep);
      session.dispatch("hint.shown", { hintId: `assist:${step.id}`, rung: 3, stepId: step.id });
      try {
        const list = new Set<string>(JSON.parse(sessionStorage.getItem(assistedKey) ?? "[]") as string[]);
        list.add(step.id);
        sessionStorage.setItem(assistedKey, JSON.stringify([...list]));
      } catch {
        /* private mode */
      }
      // The recorded drops show the flow; opening the tap here as well would drip onto the bench.
      const events = (seg?.events ?? []).filter((g) => !(g.type === "param.set" && String(g.payload.key).startsWith("stopcock:")));
      // Keep the recorded timing from when this step began (time in a flame, a wait before the next
      // addition); time the learner already spent counts.
      const began = Math.max(0, ...content.steps.slice(0, content.steps.indexOf(step)).map((s) => ev.progress(s.id).doneAt ?? 0));
      const segStart = seg?.startT ?? events[0]?.t ?? 0;
      assist.current = { stepId: step.id, events, i: 0, t0: began, segStart, span: Math.max(0, (seg?.endT ?? 0) - segStart) };
      setAssisting(step.id);
      announce(`Doing "${step.title}" for you. Watch the bench.`, "polite");
    }, 30);
  };

  useEffect(() => {
    const a = assist.current;
    if (!a) return;
    if (a.t0 === null) a.t0 = session.t;
    const el = session.t - a.t0;
    while (a.i < a.events.length && a.events[a.i]!.t - a.segStart <= el + 50) {
      const g = a.events[a.i++]!;
      session.dispatch(g.type, g.payload as never);
    }
    const finished = ev?.progress(a.stepId).done || session.stopped;
    const gaveUp = a.i >= a.events.length && el > a.span + 120_000;
    if (finished || gaveUp) {
      assist.current = null;
      setAssisting(null);
      setSimSpeed(1);
      if (gaveUp) announce("That step needs a different start. Try Reset, then Do this step for me again.", "polite");
      return;
    }
    const nextIn = a.i < a.events.length ? a.events[a.i]!.t - a.segStart - el : Infinity;
    setSimSpeed(nextIn === Infinity ? SKIP_SPEED : nextIn > 3000 ? 8 : 1.5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.t, assisting]);

  const waitStep = current?.action === "timer.mark";
  const skip = () => {
    if (!current || skipping) return;
    session.dispatch("timer.mark", { label: current.title });
    setSkipping(true);
  };
  useEffect(() => {
    setSkipping(false);
  }, [current?.id]);
  // Skipping starts as a watchable time-lapse (×8 for 5 s: the cross fading, the foam rising) and
  // only then runs fast, so the change itself is always seen.
  const [skipFast, setSkipFast] = useState(false);
  useEffect(() => {
    setSkipFast(false);
    if (!skipping) return;
    const id = window.setTimeout(() => setSkipFast(true), 5000);
    return () => window.clearTimeout(id);
  }, [skipping]);
  const speed = assisting ? simSpeed : skipping ? (skipFast ? SKIP_SPEED : 8) : 1;
  const { setSpeed } = session;
  useEffect(() => setSpeed(speed), [speed, setSpeed]);

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

  // One calm move per step to fit what the step uses (and what it stands in); the whole bench when
  // the run is done. Once the learner moves the camera it is theirs until Re-centre.
  const hands = stepHands(current, session.state.items);
  const frame = useMemo<BenchFrame>(() => {
    const st = session.state.items;
    const ids = new Set<string>();
    for (const id of [hands.pick, hands.target, current?.from, current?.to]) {
      if (!id || !st[id] || st[id]!.socket === "worn") continue;
      ids.add(id);
      const host = st[id]!.socket?.split(":")[1];
      if (host && st[host]) ids.add(host);
    }
    if (!ids.size) return { key: `all-${recentre}`, ids: content.bench.items.map((i) => i.id) };
    // Filling a clamped burette happens at its top: show it whole for that step.
    const tall = current?.action === "liquid.pour" && !!current.to && st[current.to]?.kind === "burette_50";
    return { key: `step:${current!.id}-${recentre}`, ids: [...ids], tall };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, content, recentre]);

  const guide = current ? (!held ? hands.pick ?? undefined : held === hands.pick ? hands.target ?? undefined : undefined) : undefined;

  const finish = async () => {
    // Let the last autosave batch go out before Observe reads the log.
    await new Promise((r) => window.setTimeout(r, 600));
    await queue.current;
    onDone();
  };

  // On narrow screens the step panel is a bottom sheet: open it when something is picked up.
  useEffect(() => {
    if (held) setSheetOpen(true);
  }, [held]);

  const setGuide = (on: boolean) => {
    setGuideOn(on);
    try {
      localStorage.setItem(GUIDE_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  };

  const quick = current && guideOn ? quickAction(content, current, session.state.items) : null;
  const subIdx = current && stage ? stage.steps.indexOf(current.id) : -1;

  return (
    <div className="relative h-full min-h-0">
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] min-[700px]:grid-cols-[minmax(0,1fr)_320px] min-[700px]:grid-rows-[auto_minmax(0,1fr)] min-[1100px]:grid-cols-[260px_minmax(0,1fr)_340px] min-[1100px]:grid-rows-1">
        <BenchShelf items={items} glow={guideOn || !held ? guide : undefined} held={held} control={control} />

        {/* bench: the canvas, a status line and the dock, stacked (nothing on top of the apparatus) */}
        <div className="relative min-h-[260px] px-2 pb-2 min-[1100px]:px-0 min-[1100px]:py-3" data-testid="bench-column">
          <Workbench
            session={session}
            step={current}
            chrome="studio"
            control={control}
            onHeldChange={setHeld}
            onPourChange={setPourMode}
            frame={manualCam ? null : frame}
            onUserCamera={() => setManualCam(true)}
            handSlot={handSlot}
            stripMessage={
              live ? (
                <span className="text-[#ffe3a3]" role="alert">
                  {live}
                </span>
              ) : assisting ? (
                <span className="flex items-center gap-2 text-[#9fd8ff]">
                  <Wand2 className="h-4 w-4" /> Doing this step for you… watch the bench
                </span>
              ) : skipping ? (
                <span className="flex items-center gap-2 text-[#9fd8ff]">
                  <FastForward className="h-4 w-4" /> Skipping ahead in time (×{speed})
                </span>
              ) : undefined
            }
            stripExtra={
              manualCam ? (
                <button
                  onClick={() => {
                    setManualCam(false);
                    setRecentre((n) => n + 1);
                  }}
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.08] px-2.5 text-[13px] font-semibold text-white hover:bg-white/[0.14]"
                  title="Point the camera at this step again"
                >
                  <Crosshair className="h-4 w-4" /> Re-centre
                </button>
              ) : null
            }
            onLiveWarning={(text) => {
              setLive(text);
              announce(text, "assertive");
              window.setTimeout(() => setLive((l) => (l === text ? null : l)), 2600);
            }}
            dockExtra={
              <>
                <DockButton icon={<Undo2 />} label="Undo" kbd="Ctrl+Z" disabled={!session.canUndo || !!assisting} title="Undo your last action (Ctrl+Z)" onClick={undo} />
                <DockButton icon={<ListRestart />} label="Reset" tone="danger" disabled={!canReset || !!assisting} title="Put the bench back to the start of this step" onClick={() => resetKeep !== null && rewindTo(resetKeep)} />
              </>
            }
            overlay={showMe ? <ShowMeInPlace content={content} step={showMe} onClose={() => setShowMe(null)} /> : null}
          />
        </div>

        {/* step panel (a bottom sheet below 1100 px) */}
        <aside className="min-h-0 px-2 pb-2 max-[699px]:max-h-[40vh] min-[700px]:overflow-y-auto min-[700px]:py-2 min-[700px]:pl-0 min-[1100px]:p-3 min-[1100px]:pl-0" aria-label="Your step">
          <Glass className="flex max-h-full min-h-full flex-col gap-3 overflow-y-auto p-4 [scrollbar-width:thin] max-[699px]:max-h-[40vh] max-[699px]:min-h-0">
            {recording && <Recorder content={content} events={session.events} />}

            {/* stage header */}
            <div className="flex items-start justify-between gap-2">
              <button className="min-w-0 flex-1 text-left min-[700px]:pointer-events-none" onClick={() => setSheetOpen((o) => !o)} aria-expanded={sheetOpen}>
                <Kicker className="flex items-center gap-1.5 text-[#39d6ff]">
                  {current ? `Stage ${stageIdx + 1} of ${stages.length}` : "All stages done"}
                  <ChevronDown className={cx("h-4 w-4 transition-transform min-[700px]:hidden", sheetOpen && "rotate-180")} />
                </Kicker>
                <div className="truncate font-heading text-[18px] font-bold leading-tight">{stage?.title ?? "Finished"}</div>
              </button>
              <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[13px] font-semibold text-[#c8d6f3]" title="Guide me: shows exactly what to click next">
                Guide me
                <span className={cx("relative h-6 w-10 rounded-full transition-colors", guideOn ? "bg-[#3d8bff]" : "bg-white/15")}>
                  <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left]", guideOn ? "left-[18px]" : "left-0.5")} />
                </span>
                <input type="checkbox" className="sr-only" checked={guideOn} onChange={(e) => setGuide(e.target.checked)} />
              </label>
            </div>
            <ol className="flex gap-1.5" aria-label="Stages">
              {stages.map((g, i) => (
                <li key={g.title} title={g.title} className={cx("h-2 flex-1 rounded-full", i < stageIdx ? "bg-[#3de8a8]" : i === stageIdx ? "bg-[#3d8bff] shadow-[0_0_8px_#3d8bff]" : "bg-white/15")}>
                  <span className="sr-only">
                    {g.title}
                    {i < stageIdx ? " (done)" : i === stageIdx ? " (now)" : ""}
                  </span>
                </li>
              ))}
            </ol>

            <div className={cx("flex flex-col gap-3", !sheetOpen && "max-[699px]:hidden")}>
              <AnimatePresence>
                {whatIf && <WhatIfCard key={whatIf.key} w={whatIf} reduced={reduced} canUndo={session.canUndo} onUndo={undo} onClose={() => setWhatIf(null)} />}
              </AnimatePresence>

              {current ? (
                <div>
                  {stage && stage.steps.length > 1 && (
                    <div className="flex items-center gap-2">
                      <Kicker>
                        Part {subIdx + 1} of {stage.steps.length}
                      </Kicker>
                      <span className="flex gap-1" aria-hidden>
                        {stage.steps.map((id) => (
                          <span key={id} className={cx("h-1.5 w-1.5 rounded-full", doneIds.has(id) ? "bg-[#3de8a8]" : id === current.id ? "bg-[#3d8bff]" : "bg-white/20")} />
                        ))}
                      </span>
                    </div>
                  )}
                  <h2 className="mt-1 font-heading text-[20px] font-bold leading-tight">{current.title}</h2>
                  <p className="mt-1.5 text-[15.5px] leading-snug text-[#dbe7ff]">{current.instruction}</p>
                  {current.quantity && (
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1 text-[14px] tabular-nums text-[#c8d6f3]">
                      Target {current.quantity.target} {current.quantity.unit} <span className="text-[#8fa6d1]">± {current.quantity.plusMinus}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 font-heading text-[19px] font-semibold text-[#3de8a8]">
                    <Check className="h-5 w-5" /> All steps done
                  </div>
                  <p className="mt-1 text-[15px] text-[#c8d6f3]">Nice work. Next, explain what you saw.</p>
                </div>
              )}

              {done && (
                <PrimaryButton className="h-11 w-full text-[15px]" onClick={() => void finish()}>
                  Go to Observe <ArrowRight className="h-4 w-4" />
                </PrimaryButton>
              )}

              {/* Guide me: the one next move, plus help that always works */}
              {current && guideOn && (
                <div className="rounded-[14px] border border-[rgba(57,214,255,.4)] bg-[rgba(57,214,255,.08)] p-3" aria-live="polite">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#39d6ff] text-[#032433] motion-safe:animate-pulse">
                      <Hand className="h-4 w-4" />
                    </span>
                    <p className="text-[16px] font-semibold leading-snug text-white">{assisting ? "Watch: this step is being done for you." : nextMove(current, held, session.state.items, pourMode)}</p>
                  </div>
                  {quick && !assisting && !pourMode && (
                    <PrimaryButton className="mt-3 h-11 w-full text-[15px]" onClick={() => control.current?.transfer(quick.from, quick.to, quick.amount)}>
                      {quick.label}
                    </PrimaryButton>
                  )}
                </div>
              )}

              {current && waitStep && (
                <PrimaryButton className="h-11 w-full text-[15px]" disabled={skipping || !!assisting} onClick={skip}>
                  <FastForward className="h-4 w-4" /> {skipping ? "Skipping ahead…" : "Skip ahead (speed up time)"}
                </PrimaryButton>
              )}

              {current && (
                <div className="flex flex-wrap gap-2">
                  <GhostButton className="h-10 flex-1" disabled={!!assisting || preparing || session.stopped} onClick={doForMe} title="Plays the right action for this step on your bench. It counts as a hint.">
                    <Wand2 className="h-4 w-4 text-[#9fd8ff]" /> {preparing ? "Getting ready…" : assisting ? "Doing it…" : "Do this step for me"}
                  </GhostButton>
                  <GhostButton className="h-10" onClick={() => setShowMe(current)} title="Watch this step from the demo">
                    <Play className="h-4 w-4" /> Show me
                  </GhostButton>
                  <GhostButton className={cx("h-10", hintPulse && "ls-breathe")} onClick={showHint}>
                    <Lightbulb className="h-4 w-4 text-[#ffd77a]" /> {(hintRung[current.id] ?? 0) === 0 ? "Hint" : "More help"}
                  </GhostButton>
                </div>
              )}

              <AnimatePresence initial={false}>
                {curHint && current && (
                  <motion.div key={`${current.id}-${curHint.rung}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="rounded-lg bg-[#ffc23d]/10 p-3 text-[15px] text-[#ffe3a3] ring-1 ring-inset ring-[#ffc23d]/30">
                      <span className="mr-1 font-semibold">{["", "Nudge:", "Try this:", "Show me:"][curHint.rung]}</span>
                      {curHint.text}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* the in-hand card and readouts (portalled from the bench) */}
              <div ref={setHandSlot} className="empty:hidden" />

              {current && <Explore step={current} />}

              {nowNotes.length > 0 && (
                <div>
                  <Kicker className="mb-1.5 flex items-center gap-1.5">
                    <Eye className="h-4 w-4" /> What you see
                  </Kicker>
                  <ul className="space-y-1.5" aria-live="polite">
                    {nowNotes.map((n) => (
                      <li key={n.uid} className={cx("rounded-lg px-3 py-2 text-[14px] leading-snug", n.tone === "danger" ? "bg-state-danger/10 text-[#ffb4b4]" : n.tone === "warning" ? "bg-state-warning/10 text-[#fcd27b]" : n.tone === "success" ? "bg-state-success/10 text-[#9ff0bf]" : "bg-white/[0.04] text-white/80")}>
                        {n.tone === "danger" ? <CircleAlert className="mr-1.5 inline h-4 w-4" /> : n.tone === "success" ? <Sparkles className="mr-1.5 inline h-4 w-4" /> : null}
                        {n.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(earlierNotes.length > 0 || pastWhatIfs.length > 0) && (
                <details className="group rounded-lg bg-white/[0.03] px-3 py-2 text-[14px] text-[#a9bde4]">
                  <summary className="cursor-pointer select-none font-semibold text-[#c8d6f3]">Earlier ({earlierNotes.length + pastWhatIfs.length})</summary>
                  <ul className="mt-2 space-y-1.5">
                    {pastWhatIfs
                      .slice()
                      .reverse()
                      .map((w) => (
                        <li key={`w${w.key}`} className="leading-snug">
                          <b className="text-[#ffd77a]">{w.title}:</b> {w.detail}
                        </li>
                      ))}
                    {earlierNotes.map((n) => (
                      <li key={n.uid} className="leading-snug">
                        {n.text}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
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
                <p className="mt-1 text-[15px] text-white/80">{safety.rule.message}</p>
              </div>
            </div>
            {findWhatIf(content, current?.id ?? "", safety.rule.code) && (
              <div className="mt-4 rounded-xl border border-[rgba(255,194,61,.35)] bg-[rgba(255,194,61,.08)] p-3 text-[15px] text-[#fff1cf]">
                <b className="mr-1 text-[#ffd77a]">In a real lab:</b>
                {findWhatIf(content, current?.id ?? "", safety.rule.code)}
              </div>
            )}
            <p className="mt-3 text-[14px] text-white/60">Nobody was hurt: this is a simulation. Undo puts the bench back to just before that action.</p>
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
      <span className="sr-only" aria-live="polite">
        {current ? `Step ${curIdx + 1} of ${content.steps.length}: ${current.title}` : "All steps done"}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ explore */

function Explore({ step }: { step: StepSpec }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [step.id]);
  const explore = step.explore ?? [];
  if (!explore.length) return null;
  return (
    <div>
      <button className="flex items-center gap-1.5 text-[14px] font-semibold text-[#c9b8ff] hover:text-white" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        What if I did it differently? <ChevronDown className={cx("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul key="explore" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-2 space-y-2 overflow-hidden" aria-label="What if I do it differently?">
            {explore.map((x) => (
              <li key={x.if} className="rounded-[12px] border border-[rgba(167,123,255,.3)] bg-[rgba(167,123,255,.10)] p-3 text-[14px] leading-snug">
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
          <div className={cx("text-[13px] font-bold uppercase tracking-[0.06em]", minor ? "text-[#ffd77a]" : "text-[#ff9b9b]")}>What that would do</div>
          <div className="font-heading text-[17px] font-bold leading-tight">{w.title}</div>
        </div>
        <button onClick={onClose} className="rounded p-1 text-white/60 hover:text-white" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-[15px] leading-snug text-[#fff1e6]">{w.consequence ?? w.detail}</p>
      {w.consequence && <p className="mt-1.5 text-[14px] text-white/65">{w.detail}</p>}
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
  const glowRef = useRef<HTMLButtonElement | null>(null);

  // Keep the glowing tile in view on the narrow horizontal strip.
  useEffect(() => {
    glowRef.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [glow]);

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
    const glowing = glow === it.id && held !== it.id;
    return (
      <button
        key={it.id}
        ref={glowing ? glowRef : undefined}
        onPointerDown={(e) => onDown(e, it)}
        onClick={() => {
          if (drag.current?.moved || worn) return;
          control.current?.choose(it.id);
        }}
        aria-pressed={held === it.id}
        disabled={worn}
        data-shelf-id={it.id}
        title={worn ? `${it.label}: worn` : `${it.label}: click to pick up, or drag onto the bench`}
        className={cx(
          "group relative flex shrink-0 items-center gap-2.5 rounded-[12px] border px-2.5 py-2 text-left transition max-[1099px]:w-[176px] min-[1100px]:w-full",
          "touch-pan-x min-[1100px]:touch-pan-y",
          held === it.id ? "border-[#6aa8ff] bg-[rgba(61,139,255,.2)] shadow-[0_0_0_1px_#6aa8ff]" : glowing ? "border-[#39d6ff] bg-[rgba(57,214,255,.14)] shadow-[0_0_0_2px_rgba(57,214,255,.55),0_0_18px_rgba(57,214,255,.35)]" : "border-[rgba(140,180,255,.12)] bg-[rgba(4,10,28,.45)] hover:border-[rgba(140,180,255,.35)]",
          worn && "opacity-60",
        )}
      >
        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-[#cfe0ff]" style={{ background: r ? `radial-gradient(circle at 50% 60%, ${r.hex}cc, ${r.hex}33)` : "rgba(120,160,255,.12)" }}>
          {worn ? <Check className="h-5 w-5 text-[#3de8a8]" /> : iconFor(it)}
          {r && r.hazards.length > 0 && <i className="absolute -right-1 -top-1 h-3 w-3 rotate-45 rounded-[2px] border-[1.6px] border-[#ff5b6b] bg-white" title={r.hazards.join(", ")} />}
        </span>
        <span className="min-w-0 flex-1">
          <b className="line-clamp-2 block text-[14px] font-semibold leading-tight text-white" title={it.label}>{it.label}</b>
          <span className="block truncate text-[13px] leading-tight text-[#a9bde4]">{sub}</span>
        </span>
        {held === it.id && <Hand className="h-4 w-4 shrink-0 text-[#6aa8ff]" />}
        {glowing && <span className="pointer-events-none absolute -left-1 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[#39d6ff] motion-safe:animate-ping" aria-hidden />}
      </button>
    );
  };

  return (
    <>
      <nav className="min-h-0 px-2 pt-2 min-[700px]:max-[1099px]:col-span-2 min-[1100px]:overflow-y-auto min-[1100px]:p-3" aria-label="Your bench">
        <Glass className="flex gap-2 overflow-x-auto p-2 [scrollbar-width:thin] min-[1100px]:min-h-full min-[1100px]:flex-col min-[1100px]:overflow-visible min-[1100px]:p-3">
          <div className="hidden min-[1100px]:block">
            <b className="font-heading text-[18px]">Your bench</b>
            <p className="text-[14px] leading-snug text-[#a9bde4]">Click to pick up, or drag onto the bench.</p>
          </div>
          {chemicals.length > 0 && <Kicker className="hidden min-[1100px]:mt-1 min-[1100px]:block">Chemicals</Kicker>}
          {chemicals.map(tile)}
          {kit.length > 0 && <Kicker className="hidden min-[1100px]:mt-2 min-[1100px]:block">Equipment</Kicker>}
          {kit.map(tile)}
        </Glass>
      </nav>
      {ghost && ghostItem && (
        <div className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[130%] rounded-full bg-[rgba(61,139,255,.92)] px-3 py-1 text-[13px] font-semibold text-white shadow-lg" style={{ left: ghost.x, top: ghost.y }}>
          {ghostItem.label}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ show me, recorder */

/** "Show me": this step's part of the demo, played in place over the bench, then it stops. */
function ShowMeInPlace({ content, step, onClose }: { content: ExperimentContent; step: StepSpec; onClose: () => void }) {
  const session = useLabSession(content, { mode: "demo", startPaused: true });
  const { seek, setSpeed, setPaused } = session;
  // Cheap window first (the first golden event of this step); the exact one once it is known.
  const [win, setWin] = useState(() => {
    const e = content.golden.events.find((g) => {
      const p = g.payload as Record<string, unknown>;
      return (g.type === step.action || (step.alsoActions ?? []).includes(g.type)) && (!step.from || p.from === step.from || p.equipmentId === step.from || p.instrument === step.from || p.to === step.from);
    });
    const start = Math.max(0, (e?.t ?? 0) - 1500);
    return { start, end: start + 9000 };
  });
  const [run, setRun] = useState(0);
  useEffect(() => {
    const id = window.setTimeout(() => {
      const seg = goldenSegments(content)[step.id];
      if (seg) {
        const s = Math.max(0, seg.startT - 500, (seg.events[0]?.t ?? seg.startT) - 2500);
        setWin({ start: s, end: Math.max(s + 3000, seg.endT + 1500) });
      }
    }, 60);
    return () => window.clearTimeout(id);
  }, [content, step.id]);
  useEffect(() => {
    seek(win.start);
    setPaused(false);
  }, [seek, setPaused, win.start, run]);
  const span = win.end - win.start;
  const over = session.t >= win.end;
  // A long wait inside the step plays as a short time-lapse.
  const lapse = span > 15000;
  useEffect(() => setSpeed(lapse ? span / 8000 : 1), [setSpeed, lapse, span]);
  useEffect(() => {
    if (over) setPaused(true);
  }, [over, setPaused]);
  const hands = stepHands(step, session.state.items);
  const ids = [hands.pick, hands.target].filter((x): x is string => !!x);
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[#0b1530]">
      <div className="relative min-h-0 flex-1">
        <Workbench session={session} readOnly frame={ids.length ? { key: `show-${step.id}`, ids } : { key: "show-all", ids: content.bench.items.map((i) => i.id) }} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-[rgba(4,10,28,.9)] px-3 py-2">
        <span className="flex min-w-0 flex-1 items-center gap-2 text-[15px] font-semibold text-white">
          <Play className="h-4 w-4 shrink-0 text-[#39d6ff]" />
          <span className="truncate">Show me: {step.title}</span>
          {lapse && !over && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[13px] text-[#9fd8ff]">
              <FastForward className="h-3.5 w-3.5 fill-current" aria-hidden /> time-lapse
            </span>
          )}
        </span>
        <GhostButton className="h-9" onClick={() => setRun((n) => n + 1)}>
          <RotateCcw className="h-4 w-4" /> Again
        </GhostButton>
        <PrimaryButton className="h-9" onClick={onClose}>
          {over ? "My turn" : "Close"}
        </PrimaryButton>
      </div>
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
