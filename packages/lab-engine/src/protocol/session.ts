import type { LabEvent } from "@labscape/contracts";
import { stateHash } from "../engine/hash";
import { advanceTicks, applyEvent, type Note } from "../engine/reducer";
import { initialState, type LabState } from "../engine/state";
import { Evaluator } from "./evaluator";
import type { ExperimentContent, Feedback, GoldenRun, Report } from "./types";

const TICK_MS = 500;

export type SessionResult = { state: LabState; report: Report; feedback: Feedback[]; notes: Note[]; hash: string };

/**
 * Runs a whole attempt: engine + evaluator over an event log, ticking time between events.
 * The server calls exactly this (via GraalJS) to score an attempt; the demo and the tests do too.
 */
export function runSession(content: ExperimentContent, events: LabEvent[], opts: { tailMs?: number } = {}): SessionResult {
  let state = initialState(content.bench);
  const evaluator = new Evaluator(content);
  const feedback: Feedback[] = [];
  const notes: Note[] = [];
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const step = (until: number) => {
    state = advanceTicks(state, TICK_MS, until, (r) => {
      notes.push(...r.notes);
      feedback.push(...evaluator.tick(r.state, r.state.t));
    });
  };
  for (const e of sorted) {
    step(e.t);
    const r = applyEvent(state, e);
    state = r.state;
    notes.push(...r.notes);
    feedback.push(...evaluator.push(e, state));
  }
  if (opts.tailMs) step(state.t + opts.tailMs);
  return { state, report: evaluator.report(), feedback, notes, hash: stateHash(state) };
}

/** Turns a golden-run script into proper LabEvents. */
export function goldenEvents(golden: GoldenRun, attemptId = "golden", actor: LabEvent["actor"] = "demo"): LabEvent[] {
  return golden.events.map((e, i) => ({ id: `${attemptId}-${i + 1}`, attemptId, seq: i + 1, t: e.t, actor, type: e.type, payload: e.payload }) as LabEvent);
}

/**
 * Golden-run recorder (admin): turns a real run into a golden-run script. Times are rebased to
 * start 1 s in (observation answers are kept when present), and each completed step gets a draft
 * caption at the moment it finished. The run is scored too, so authors only save 3-star runs.
 */
export function recordGolden(content: ExperimentContent, events: LabEvent[]): { golden: GoldenRun; report: Report } {
  const own = [...events].sort((a, b) => a.seq - b.seq);
  const t0 = own[0]?.t ?? 0;
  const shift = (t: number) => Math.round(t - t0 + 1000);
  // Score the script exactly as it will be saved (rebased), so idle time before the first action does not count.
  const rebased = own.map((e) => ({ ...e, t: shift(e.t) }));
  const run = runSession(content, rebased, { tailMs: 1500 });
  const titles = Object.fromEntries(content.steps.map((s) => [s.id, s.title]));
  const captions = run.feedback
    .filter((f): f is Extract<Feedback, { kind: "step-complete" }> => f.kind === "step-complete")
    .map((f) => ({ t: Math.max(0, f.t - 400), text: titles[f.stepId] ?? f.stepId }));
  const last = own.length ? shift(own[own.length - 1]!.t) : 0;
  return {
    golden: {
      durationS: Math.ceil(last / 1000) + 3,
      captions,
      events: rebased.map((e) => ({ t: e.t, type: e.type, payload: e.payload as Record<string, unknown> })),
    },
    report: run.report,
  };
}
