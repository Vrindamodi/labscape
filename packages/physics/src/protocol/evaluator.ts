import type { LabEvent, ScoreDimension } from "@labscape/contracts";
import type { ApplyCtx, SimContent, SimDeviation, SimFeedback, SimModel, SimNote, SimReport, Severity } from "./types";

export const SIM_WEIGHTS: Record<ScoreDimension, number> = {
  equipment: 15,
  sequence: 20,
  quantity: 0,
  technique: 20,
  mixing: 0,
  temperature: 0,
  timing: 0,
  measurement: 30,
  observation: 15,
};

const PENALTY: Record<Severity, number> = { minor: 0.25, major: 0.6, order: 0.4, safety: 1 };
const DEFAULT_STEP_DIMS: Partial<Record<ScoreDimension, number>> = { sequence: 1, technique: 1 };

export type SimRun<S> = { state: S; report: SimReport; feedback: SimFeedback[]; notes: SimNote[]; t: number };

/**
 * Replays an event log through a model and scores it. Used live by the UI (incrementally via
 * SimEvaluator) and by the server to re-check a finished attempt.
 */
export class SimEvaluator<S> {
  state: S;
  readonly done: Record<string, number | null> = {};
  readonly deviations: SimDeviation[] = [];
  readonly answers: Record<string, number> = {};
  hints = 0;
  stopped = false;
  t = 0;

  constructor(readonly content: SimContent, readonly model: SimModel<S>) {
    this.state = model.init(content);
    content.steps.forEach((s) => (this.done[s.id] = null));
  }

  current() {
    return this.content.steps.find((s) => this.done[s.id] === null) ?? null;
  }

  push(e: LabEvent): { feedback: SimFeedback[]; notes: SimNote[] } {
    const feedback: SimFeedback[] = [];
    if (this.stopped) return { feedback, notes: [] };
    this.t = Math.max(this.t, e.t);
    if (e.type === "hint.shown") {
      this.hints++;
      return { feedback, notes: [] };
    }
    if (e.type === "param.set" && typeof e.payload.key === "string" && e.payload.key.startsWith("answer:")) {
      this.answers[e.payload.key.slice(7)] = Number(e.payload.value);
      return { feedback, notes: [] };
    }
    const ctx: ApplyCtx = { t: e.t, content: this.content };
    const stepNow = this.current();
    const r = this.model.apply(this.state, e, ctx);
    this.state = r.state;
    for (const h of r.hits ?? []) {
      // each mistake counts once per step
      const stepId = h.stepId ?? stepNow?.id ?? "end";
      if (this.deviations.some((d) => d.code === h.code && d.stepId === stepId)) continue;
      const dev: SimDeviation = { ...h, stepId, t: e.t };
      this.deviations.push(dev);
      feedback.push({ kind: "deviation", deviation: dev });
    }
    const stop = this.model.safety?.(this.state);
    if (stop) {
      this.stopped = true;
      feedback.push({ kind: "safety-stop", ...stop, t: e.t });
      return { feedback, notes: r.notes ?? [] };
    }
    // complete as many steps, in order, as the new state satisfies
    for (let s = this.current(); s && this.model.steps[s.id]?.(this.state, ctx); s = this.current()) {
      this.done[s.id] = e.t;
      feedback.push({ kind: "step-complete", stepId: s.id, t: e.t });
    }
    return { feedback, notes: r.notes ?? [] };
  }

  private penalty(dim: ScoreDimension) {
    return this.deviations.filter((d) => d.dimension === dim).reduce((s, d) => s + PENALTY[d.severity], 0);
  }

  report(): SimReport {
    const weights = { ...SIM_WEIGHTS, ...(this.content.scoring ?? {}) };
    const byDimension = {} as Record<ScoreDimension, number | null>;
    let total = 0;
    let wsum = 0;
    for (const dim of Object.keys(weights) as ScoreDimension[]) {
      const w = weights[dim];
      if (!w) {
        byDimension[dim] = null;
        continue;
      }
      let score: number | null;
      if (dim === "observation") {
        const ps = this.content.observations.prompts;
        score = ps.length ? ps.filter((p) => this.answers[p.id] === p.answer).length / ps.length : null;
      } else {
        const relevant = this.content.steps.filter((s) => ((s.scoring ?? DEFAULT_STEP_DIMS)[dim] ?? 0) > 0);
        if (!relevant.length) score = this.deviations.some((d) => d.dimension === dim) || dim === "sequence" ? 1 - this.penalty(dim) * 0.5 : null;
        else score = relevant.filter((s) => this.done[s.id] !== null).length / relevant.length - this.penalty(dim) * 0.5;
      }
      byDimension[dim] = score === null ? null : Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
      if (score !== null) {
        total += w * Math.max(0, Math.min(1, score));
        wsum += w;
      }
    }
    let pct = wsum ? (total / wsum) * 100 : 0;
    pct *= 1 - Math.min(0.1, this.hints * 0.02);
    if (this.stopped) pct = Math.min(pct, 40);
    const completed = !this.stopped && this.content.steps.filter((s) => !s.optional).every((s) => this.done[s.id] !== null);
    const score = Math.round(pct);
    return {
      score,
      stars: !completed ? 0 : score >= 90 ? 3 : score >= 70 ? 2 : 1,
      byDimension,
      deviations: [...this.deviations],
      steps: this.content.steps.map((s) => ({ id: s.id, title: s.title, done: this.done[s.id] !== null })),
      hintsUsed: this.hints,
      completed,
      stoppedForSafety: this.stopped,
    };
  }
}

/**
 * Undo in a Try stage is itself logged (the event log is append-only): a `param.set` with this key
 * and the seq of the event it takes back. Replays skip both.
 */
export const UNDO_KEY = "__undo";

export const isUndoMarker = (e: LabEvent): e is Extract<LabEvent, { type: "param.set" }> => e.type === "param.set" && e.payload.key === UNDO_KEY;

/** Events that are not student actions and cannot be undone. */
const NOT_UNDOABLE = new Set<LabEvent["type"]>(["hint.shown", "step.completed", "deviation", "outcome"]);

/** The log as it stands after undos: in seq order, without markers or the events they took back. */
export function effectiveEvents(events: LabEvent[]): LabEvent[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const undone = new Set(sorted.filter(isUndoMarker).map((e) => Number(e.payload.value)));
  return sorted.filter((e) => !isUndoMarker(e) && !undone.has(e.seq));
}

/** The most recent student action that undo would take back, if any. */
export function lastUndoable(events: LabEvent[]): LabEvent | null {
  const eff = effectiveEvents(events);
  for (let i = eff.length - 1; i >= 0; i--) {
    const e = eff[i]!;
    if (e.actor === "user" && !NOT_UNDOABLE.has(e.type) && !(e.type === "param.set" && String(e.payload.key).startsWith("answer:"))) return e;
  }
  return null;
}

export function runSim<S>(content: SimContent, model: SimModel<S>, events: LabEvent[]): SimRun<S> {
  const ev = new SimEvaluator(content, model);
  const feedback: SimFeedback[] = [];
  const notes: SimNote[] = [];
  for (const e of effectiveEvents(events)) {
    const r = ev.push(e);
    feedback.push(...r.feedback);
    notes.push(...r.notes);
  }
  return { state: ev.state, report: ev.report(), feedback, notes, t: ev.t };
}

/** Golden-run script -> LabEvents. */
export function simGoldenEvents(content: SimContent, attemptId = "golden", actor: LabEvent["actor"] = "demo"): LabEvent[] {
  return content.golden.events.map((e, i) => ({ id: `${attemptId}-${i + 1}`, attemptId, seq: i + 1, t: e.t, actor, type: e.type, payload: e.payload }) as LabEvent);
}

/** Small stable hash of a JSON-able state (6-significant-figure rounding), for replay checks. */
export function simHash(x: unknown): string {
  const s = JSON.stringify(x, (_k, v) => (typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v));
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
