import type { LabEvent } from "@labscape/contracts";
import { stateHash } from "../engine/hash";
import { advance, applyEvent, type Note } from "../engine/reducer";
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
    while (state.t + TICK_MS <= until) {
      const r = advance(state, TICK_MS);
      state = r.state;
      notes.push(...r.notes);
      feedback.push(...evaluator.tick(state, state.t));
    }
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
