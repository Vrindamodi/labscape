import type { LabEvent, LabEventPayloadMap, LabEventType } from "@labscape/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { effectiveEvents, isUndoMarker, lastUndoable, SimEvaluator, UNDO_KEY } from "../protocol/evaluator";
import type { SimContent, SimFeedback, SimModel, SimNote, SimReport } from "../protocol/types";

export type SimMode = "try" | "demo" | "sandbox";
export type LiveSimNote = SimNote & { uid: number; at: number };

export type SimSession<S = unknown> = {
  content: SimContent;
  model: SimModel<S>;
  mode: SimMode;
  state: S;
  /** Attempt clock (ms since the session opened, or demo time). */
  now: () => number;
  dispatch: <T extends LabEventType>(type: T, payload: LabEventPayloadMap[T]) => LabEvent | null;
  events: LabEvent[];
  feedback: SimFeedback[];
  notes: LiveSimNote[];
  report: () => SimReport;
  currentStepId: string | null;
  doneSteps: Record<string, number | null>;
  stopped: boolean;
  readOnly: boolean;
  /** Demo: playback controls. */
  demo: { t: number; playing: boolean; setPlaying: (p: boolean) => void; seek: (t: number) => void; speed: number; setSpeed: (s: number) => void; duration: number; /** The next scripted event (display only: lets the bench animate toward it). */ upcoming: LabEvent | null };
  /** Restart from scratch (keeps nothing). */
  restart: () => void;
  /** Try: takes back the last student action (logged as an undo marker). Returns what was undone. */
  undo: () => LabEvent | null;
  /** The action undo would take back, or null. */
  undoable: LabEvent | null;
};

/** A few words for an action, for "Undone: ..." notes. */
export function describeAction(e: LabEvent): string {
  switch (e.type) {
    case "param.set": {
      const k = String(e.payload.key);
      const v = e.payload.value;
      if (k.startsWith("result:")) return `your answer for ${k.slice(7)} (${v})`;
      if (k === "switch") return v ? "closing the switch" : "opening the switch";
      if (typeof v === "boolean") return `${v ? "turning on" : "turning off"} ${k}`;
      return `setting ${k.replace(/[-:]/g, " ")} to ${v}`;
    }
    case "measure.read":
      return `your reading of ${e.payload.reading.value}${e.payload.reading.unit ? ` ${e.payload.reading.unit}` : ""}`;
    case "equipment.connect":
      return "that wire";
    case "equipment.place":
      return `placing ${e.payload.equipmentId}`;
    case "equipment.pickup":
      return `picking up ${e.payload.equipmentId}`;
    case "sim.start":
      return "the launch / release";
    case "sim.reset":
      return "the reset";
    case "timer.mark":
      return "that mark";
    default:
      return "your last action";
  }
}

type Options = {
  mode: SimMode;
  attemptId?: string;
  initialEvents?: LabEvent[];
  onBatch?: (events: LabEvent[]) => void;
  onFeedback?: (f: SimFeedback) => void;
  onNote?: (n: SimNote) => void;
  /** Demo mode: play this script instead of the golden run (replays of a real attempt). */
  script?: { t: number; type: LabEventType; payload: unknown }[];
  /** Demo: start playing at once (default) or wait for setPlaying(true). */
  autoplay?: boolean;
  /** Demo: starting playback speed (default 1). */
  speed?: number;
};

let uidSeq = 1;

/**
 * Drives a physics or maths model: user actions become LabEvents on the attempt clock, the
 * evaluator scores them as they happen, and new events autosave every 500 ms. In demo mode it
 * plays the golden run on its own clock (with seek and speed).
 */
export function useSimSession<S>(content: SimContent, model: SimModel<S>, opts: Options): SimSession<S> {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const evalRef = useRef<SimEvaluator<S>>(new SimEvaluator(content, model));
  const eventsRef = useRef<LabEvent[]>([]);
  const pending = useRef<LabEvent[]>([]);
  const t0 = useRef(performance.now());
  const [, force] = useState(0);
  const [feedback, setFeedback] = useState<SimFeedback[]>([]);
  const [notes, setNotes] = useState<LiveSimNote[]>([]);
  const rerender = () => force((x) => x + 1);

  /** Re-scores the log as it stands after undos (the evaluator only moves forward). */
  const rebuild = useCallback(() => {
    const ev = new SimEvaluator(content, model);
    for (const e of effectiveEvents(eventsRef.current)) ev.push(e);
    evalRef.current = ev;
  }, [content, model]);

  const ingest = useCallback((e: LabEvent, live: boolean) => {
    eventsRef.current.push(e);
    if (isUndoMarker(e)) {
      rebuild();
      return;
    }
    const r = evalRef.current.push(e);
    if (live) {
      if (r.feedback.length) {
        setFeedback((f) => [...f, ...r.feedback]);
        r.feedback.forEach((f) => optsRef.current.onFeedback?.(f));
      }
      if (r.notes.length) {
        const at = performance.now();
        setNotes((n) => [...n.slice(-30), ...r.notes.map((x) => ({ ...x, uid: uidSeq++, at }))]);
        r.notes.forEach((n) => optsRef.current.onNote?.(n));
      }
    }
  }, [rebuild]);

  const reset = useCallback(
    (events: LabEvent[]) => {
      eventsRef.current = [...events].sort((a, b) => a.seq - b.seq);
      rebuild();
      setFeedback([]);
      setNotes([]);
      rerender();
    },
    [rebuild],
  );

  // Resume: replay the saved log silently and continue the clock after its last event.
  useEffect(() => {
    if (opts.mode === "demo") return;
    const init = opts.initialEvents ?? [];
    reset(init);
    const last = init.reduce((m, e) => Math.max(m, e.t), 0);
    t0.current = performance.now() - last - (init.length ? 1000 : 0);
  }, [content.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = useCallback(() => Math.round(performance.now() - t0.current), []);

  const dispatch = useCallback(
    <T extends LabEventType>(type: T, payload: LabEventPayloadMap[T]): LabEvent | null => {
      if (optsRef.current.mode === "demo" || evalRef.current.stopped) return null;
      const seq = (eventsRef.current[eventsRef.current.length - 1]?.seq ?? 0) + 1;
      const e = { id: `${optsRef.current.attemptId ?? "local"}-${seq}-${Date.now().toString(36)}`, attemptId: optsRef.current.attemptId ?? "local", seq, t: now(), actor: "user", type, payload } as LabEvent;
      ingest(e, true);
      pending.current.push(e);
      rerender();
      return e;
    },
    [ingest, now],
  );

  // autosave
  useEffect(() => {
    if (opts.mode !== "try") return;
    const id = window.setInterval(() => {
      if (!pending.current.length) return;
      const batch = pending.current.splice(0);
      optsRef.current.onBatch?.(batch);
    }, 500);
    return () => {
      window.clearInterval(id);
      if (pending.current.length) optsRef.current.onBatch?.(pending.current.splice(0));
    };
  }, [opts.mode]);

  /* ---------------------------------------------------------------- demo playback */
  const gold = useMemo(
    () => (opts.script ?? content.golden.events).map((g, i) => ({ id: `demo-${i}`, attemptId: "demo", seq: i + 1, t: g.t, actor: "demo", type: g.type, payload: g.payload }) as LabEvent),
    [content, opts.script],
  );
  const duration = opts.script ? (opts.script[opts.script.length - 1]?.t ?? 0) + 3000 : content.golden.durationS * 1000;
  const [demoT, setDemoT] = useState(0);
  const [playing, setPlaying] = useState(opts.mode === "demo" && opts.autoplay !== false);
  const [speed, setSpeed] = useState(opts.speed ?? 1);
  const demoIdx = useRef(0);
  const demoTRef = useRef(0);

  const seek = useCallback(
    (t: number) => {
      const upTo = gold.filter((e) => e.t <= t);
      demoIdx.current = upTo.length;
      demoTRef.current = t;
      setDemoT(t);
      reset(upTo);
    },
    [gold, reset],
  );

  useEffect(() => {
    if (opts.mode !== "demo" || !playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      // Slow down around captions marked "slow" (0.5x on key moments).
      const slow = content.golden.captions.some((c) => c.slow && demoTRef.current >= c.t && demoTRef.current < c.t + 2500);
      demoTRef.current = Math.min(duration, demoTRef.current + (now - last) * speed * (slow ? 0.5 : 1));
      last = now;
      while (demoIdx.current < gold.length && gold[demoIdx.current]!.t <= demoTRef.current) ingest(gold[demoIdx.current++]!, true);
      setDemoT(demoTRef.current);
      if (demoTRef.current >= duration) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [opts.mode, playing, speed, gold, duration, ingest, content.golden.captions]);

  const undoable = opts.mode === "demo" || evalRef.current.stopped ? null : lastUndoable(eventsRef.current);
  const undo = (): LabEvent | null => {
    const target = undoable;
    if (!target || !dispatch("param.set", { key: UNDO_KEY, value: target.seq })) return null;
    // Mistakes made by that action are taken back too.
    setFeedback((f) => f.filter((x) => !(x.kind === "deviation" && x.deviation.t === target.t)));
    setNotes((n) => [...n.slice(-30), { text: `Undone: ${describeAction(target)}.`, tone: "info", uid: uidSeq++, at: performance.now() }]);
    return target;
  };

  const ev = evalRef.current;
  return {
    content,
    model,
    mode: opts.mode,
    state: ev.state,
    now: opts.mode === "demo" ? () => demoTRef.current : now,
    dispatch,
    events: effectiveEvents(eventsRef.current),
    undo,
    undoable,
    feedback,
    notes,
    report: () => ev.report(),
    currentStepId: ev.current()?.id ?? null,
    doneSteps: ev.done,
    stopped: ev.stopped,
    readOnly: opts.mode === "demo",
    demo: { t: demoT, playing, setPlaying: (p) => (p && demoTRef.current >= duration ? (seek(0), setPlaying(true)) : setPlaying(p)), seek, speed, setSpeed, duration, upcoming: opts.mode === "demo" ? (gold[demoIdx.current] ?? null) : null },
    restart: () => {
      pending.current = [];
      reset([]);
      t0.current = performance.now();
    },
  };
}
