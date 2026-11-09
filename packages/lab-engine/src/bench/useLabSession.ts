import type { LabEvent, LabEventType, ObservationCue } from "@labscape/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stateHash } from "../engine/hash";
import { advance, applyEvent, type Note } from "../engine/reducer";
import { initialState, type LabState } from "../engine/state";
import { Evaluator } from "../protocol/evaluator";
import type { ExperimentContent, Feedback, Report } from "../protocol/types";

export type LiveCue = ObservationCue & { at: number; uid: number };
export type LiveNote = Note & { at: number; uid: number };

export type SessionMode = "try" | "demo" | "sandbox";

export type LabSession = {
  state: LabState;
  mode: SessionMode;
  /** Simulation clock in ms. */
  t: number;
  speed: number;
  setSpeed: (x: number) => void;
  paused: boolean;
  setPaused: (p: boolean) => void;
  dispatch: <T extends LabEventType>(type: T, payload: Extract<LabEvent, { type: T }>["payload"], actor?: LabEvent["actor"]) => LabEvent | null;
  events: LabEvent[];
  cues: LiveCue[];
  notes: LiveNote[];
  feedback: Feedback[];
  evaluator: Evaluator | null;
  report: () => Report | null;
  hash: () => string;
  /** Demo only: jump to a time by rebuilding from the start. */
  seek: (t: number) => void;
  stopped: boolean;
  /** Rewind the whole session to just after event seq (restart from a step). */
  rewind: (keepThroughSeq: number) => void;
  /** Is there a user action to undo? */
  canUndo: boolean;
  /**
   * Undo the last user action (one gesture: a whole pour, a stirring run, one placement). Rewinds the
   * log and returns the seq kept through, so the caller can rewind the server log to match, or null.
   */
  undo: () => number | null;
};

const TICK_MS = 100;
const EVAL_MS = 500;

type Options = {
  mode: SessionMode;
  initialEvents?: LabEvent[];
  attemptId?: string;
  /** Called with new events every 500 ms (autosave). */
  onBatch?: (events: LabEvent[]) => void;
  onFeedback?: (f: Feedback) => void;
  onNote?: (n: Note) => void;
  /** Demo mode: play this script instead of the golden run (replays of a real attempt). */
  script?: { t: number; type: LabEvent["type"]; payload: unknown }[];
  /** Start with the clock paused (the demo waits for its Start button). */
  startPaused?: boolean;
};

/**
 * Drives the engine in real time: a 100 ms simulation tick, the evaluator every 500 ms, user
 * actions as LabEvents on the simulation clock. In demo mode it plays the golden run instead.
 */
export function useLabSession(content: ExperimentContent, opts: Options): LabSession {
  const { mode } = opts;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const build = useCallback(
    (events: LabEvent[]) => {
      let s = initialState(content.bench);
      const ev = mode === "sandbox" ? null : new Evaluator(content);
      const fb: Feedback[] = [];
      const ns: Note[] = [];
      for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
        while (s.t + EVAL_MS <= e.t) {
          const r = advance(s, EVAL_MS);
          s = r.state;
          ns.push(...r.notes);
          if (ev) fb.push(...ev.tick(s, s.t));
        }
        const r = applyEvent(s, e);
        s = r.state;
        ns.push(...r.notes);
        if (ev) fb.push(...ev.push(e, s));
      }
      return { s, ev, fb, ns };
    },
    [content, mode],
  );

  const initial = useMemo(() => build(opts.initialEvents ?? []), [build]); // eslint-disable-line react-hooks/exhaustive-deps
  const stateRef = useRef<LabState>(initial.s);
  const evalRef = useRef<Evaluator | null>(initial.ev);
  const eventsRef = useRef<LabEvent[]>([...(opts.initialEvents ?? [])]);
  const seqRef = useRef(Math.max(0, ...eventsRef.current.map((e) => e.seq)));
  const pendingRef = useRef<LabEvent[]>([]);
  const demoIdx = useRef(0);
  const keyRef = useRef(1);

  const [state, setState] = useState<LabState>(initial.s);
  const [cues, setCues] = useState<LiveCue[]>([]);
  const [notes, setNotes] = useState<LiveNote[]>(() => initial.ns.slice(-30).map((n) => ({ ...n, at: 0, uid: keyRef.current++ })));
  const [feedback, setFeedback] = useState<Feedback[]>(initial.fb);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(!!opts.startPaused);
  const [stopped, setStopped] = useState(!!initial.ev?.stopped);
  const lastEval = useRef(initial.s.t);

  const absorb = useCallback((r: { cues: ObservationCue[]; notes: Note[] }, fb: Feedback[]) => {
    const now = performance.now();
    if (r.cues.length) setCues((c) => [...c.filter((x) => now - x.at < 30_000), ...r.cues.map((x) => ({ ...x, at: now, uid: keyRef.current++ }))]);
    if (r.notes.length) {
      setNotes((n) => [...n, ...r.notes.map((x) => ({ ...x, at: now, uid: keyRef.current++ }))].slice(-60));
      r.notes.forEach((n) => optsRef.current.onNote?.(n));
    }
    if (fb.length) {
      setFeedback((f) => [...f, ...fb]);
      fb.forEach((x) => optsRef.current.onFeedback?.(x));
      if (fb.some((x) => x.kind === "safety-stop")) setStopped(true);
    }
  }, []);

  const apply = useCallback(
    (e: LabEvent) => {
      const r = applyEvent(stateRef.current, e);
      stateRef.current = r.state;
      const fb = evalRef.current ? evalRef.current.push(e, r.state) : [];
      eventsRef.current.push(e);
      absorb(r, fb);
      setState(r.state);
    },
    [absorb],
  );

  const dispatch = useCallback<LabSession["dispatch"]>(
    (type, payload, actor = "user") => {
      if (evalRef.current?.stopped && mode === "try") return null;
      const e = { id: `e${Date.now().toString(36)}${seqRef.current + 1}`, attemptId: optsRef.current.attemptId ?? "local", seq: ++seqRef.current, t: Math.round(stateRef.current.t), actor, type, payload } as LabEvent;
      apply(e);
      pendingRef.current.push(e);
      return e;
    },
    [apply, mode],
  );

  // Real-time clock.
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      const dt = TICK_MS * speed;
      // Demo: fire golden-run events whose time has come.
      if (mode === "demo") {
        const gold = optsRef.current.script ?? content.golden.events;
        while (demoIdx.current < gold.length && gold[demoIdx.current]!.t <= stateRef.current.t + dt) {
          const g = gold[demoIdx.current]!;
          const target = g.t - stateRef.current.t;
          if (target > 0) {
            const r = advance(stateRef.current, target);
            stateRef.current = r.state;
            absorb(r, []);
          }
          seqRef.current += 1;
          apply({ id: `demo-${demoIdx.current}`, attemptId: "demo", seq: seqRef.current, t: g.t, actor: "demo", type: g.type, payload: g.payload } as LabEvent);
          demoIdx.current += 1;
        }
      }
      const r = advance(stateRef.current, dt);
      stateRef.current = r.state;
      let fb: Feedback[] = [];
      if (evalRef.current && r.state.t - lastEval.current >= EVAL_MS) {
        lastEval.current = r.state.t;
        fb = evalRef.current.tick(r.state, r.state.t);
      }
      absorb(r, fb);
      setState(r.state);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [paused, speed, mode, content, apply, absorb]);

  // Autosave batches every 500 ms.
  useEffect(() => {
    if (mode !== "try") return;
    const id = window.setInterval(() => {
      if (!pendingRef.current.length) return;
      const batch = pendingRef.current;
      pendingRef.current = [];
      optsRef.current.onBatch?.(batch);
    }, 500);
    return () => window.clearInterval(id);
  }, [mode]);

  const reset = useCallback(
    (events: LabEvent[]) => {
      const b = build(events);
      stateRef.current = b.s;
      evalRef.current = b.ev;
      eventsRef.current = [...events];
      seqRef.current = Math.max(0, ...events.map((e) => e.seq));
      lastEval.current = b.s.t;
      setState(b.s);
      setFeedback(b.fb);
      setCues([]);
      setStopped(!!b.ev?.stopped);
    },
    [build],
  );

  const seek = useCallback(
    (t: number) => {
      if (mode !== "demo") return;
      const evs = (optsRef.current.script ?? content.golden.events)
        .map((g, i) => ({ id: `demo-${i}`, attemptId: "demo", seq: i + 1, t: g.t, actor: "demo", type: g.type, payload: g.payload }) as LabEvent)
        .filter((e) => e.t <= t);
      demoIdx.current = evs.length;
      reset(evs);
      const r = advance(stateRef.current, Math.max(0, t - stateRef.current.t));
      stateRef.current = r.state;
      setState(r.state);
    },
    [content, mode, reset],
  );

  const rewind = useCallback(
    (keep: number) => {
      // Unsent events past the rewind point are dropped too, so autosave never re-sends them.
      pendingRef.current = pendingRef.current.filter((e) => e.seq <= keep);
      reset(eventsRef.current.filter((e) => e.seq <= keep));
    },
    [reset],
  );

  const undo = useCallback(() => {
    const keep = undoPoint(eventsRef.current);
    if (keep === null) return null;
    rewind(keep);
    return keep;
  }, [rewind]);

  return {
    state,
    mode,
    t: state.t,
    speed,
    setSpeed,
    paused,
    setPaused,
    dispatch,
    events: eventsRef.current,
    cues,
    notes,
    feedback,
    evaluator: evalRef.current,
    report: () => evalRef.current?.report() ?? null,
    hash: () => stateHash(stateRef.current),
    seek,
    stopped,
    rewind,
    canUndo: eventsRef.current.some(isAction),
    undo,
  };
}

const MIX = new Set(["mix.swirl", "mix.stir", "mix.shake"]);
/** Events further apart than this (simulation time) belong to different gestures. */
const GESTURE_GAP_MS = 1500;

function isAction(e: LabEvent) {
  if (e.actor !== "user" || e.type === "hint.shown") return false;
  return !(e.type === "param.set" && String(e.payload.key).startsWith("answer:"));
}

function gestureKey(e: LabEvent) {
  const p = e.payload as Record<string, unknown>;
  return [e.type, p.from ?? p.equipmentId ?? p.instrument ?? p.target ?? p.key ?? "", p.to ?? p.into ?? ""].join("|");
}

/**
 * Where to rewind to for one undo: the seq just before the last user gesture. A gesture is a run of
 * events with the same type and items (a pour arrives as many small chunks, a burette as many drops)
 * plus any stirring or swirling done during it, with no pause longer than 1.5 s. Null: nothing to undo.
 */
export function undoPoint(events: LabEvent[]): number | null {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  let i = sorted.length - 1;
  while (i >= 0 && !isAction(sorted[i]!)) i--;
  if (i < 0) return null;
  const last = sorted[i]!;
  const key = gestureKey(last);
  const lastIsMix = MIX.has(last.type);
  let j = i;
  while (j > 0) {
    const p = sorted[j - 1]!;
    const next = sorted[j]!;
    if (!isAction(p) || next.t - p.t > GESTURE_GAP_MS) break;
    const k = gestureKey(p);
    if (k === key || (lastIsMix ? MIX.has(p.type) && k.split("|")[1] === key.split("|")[1] : MIX.has(p.type))) j--;
    else break;
  }
  return j > 0 ? sorted[j - 1]!.seq : 0;
}
