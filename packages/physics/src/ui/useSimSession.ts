import type { LabEvent, LabEventPayloadMap, LabEventType } from "@labscape/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SimEvaluator } from "../protocol/evaluator";
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
  demo: { t: number; playing: boolean; setPlaying: (p: boolean) => void; seek: (t: number) => void; speed: number; setSpeed: (s: number) => void; duration: number };
  /** Restart from scratch (keeps nothing). */
  restart: () => void;
};

type Options = {
  mode: SimMode;
  attemptId?: string;
  initialEvents?: LabEvent[];
  onBatch?: (events: LabEvent[]) => void;
  onFeedback?: (f: SimFeedback) => void;
  onNote?: (n: SimNote) => void;
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

  const ingest = useCallback((e: LabEvent, live: boolean) => {
    const r = evalRef.current.push(e);
    eventsRef.current.push(e);
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
  }, []);

  const reset = useCallback(
    (events: LabEvent[]) => {
      evalRef.current = new SimEvaluator(content, model);
      eventsRef.current = [];
      for (const e of [...events].sort((a, b) => a.seq - b.seq)) ingest(e, false);
      setFeedback([]);
      setNotes([]);
      rerender();
    },
    [content, model, ingest],
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
    () => content.golden.events.map((g, i) => ({ id: `demo-${i}`, attemptId: "demo", seq: i + 1, t: g.t, actor: "demo", type: g.type, payload: g.payload }) as LabEvent),
    [content],
  );
  const duration = content.golden.durationS * 1000;
  const [demoT, setDemoT] = useState(0);
  const [playing, setPlaying] = useState(opts.mode === "demo");
  const [speed, setSpeed] = useState(1);
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

  const ev = evalRef.current;
  return {
    content,
    model,
    mode: opts.mode,
    state: ev.state,
    now: opts.mode === "demo" ? () => demoTRef.current : now,
    dispatch,
    events: eventsRef.current,
    feedback,
    notes,
    report: () => ev.report(),
    currentStepId: ev.current()?.id ?? null,
    doneSteps: ev.done,
    stopped: ev.stopped,
    readOnly: opts.mode === "demo",
    demo: { t: demoT, playing, setPlaying: (p) => (p && demoTRef.current >= duration ? (seek(0), setPlaying(true)) : setPlaying(p)), seek, speed, setSpeed, duration },
    restart: () => {
      pending.current = [];
      reset([]);
      t0.current = performance.now();
    },
  };
}
