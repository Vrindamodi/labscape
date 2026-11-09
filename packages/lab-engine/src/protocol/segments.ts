import type { LabEvent } from "@labscape/contracts";
import { advance, applyEvent } from "../engine/reducer";
import { initialState } from "../engine/state";
import { Evaluator } from "./evaluator";
import PRECOMPUTED from "./segments.generated.json";
import type { ExperimentContent } from "./types";

export type GoldenEvent = ExperimentContent["golden"]["events"][number];

/**
 * The part of the golden run that does one step: the recorded actions between the previous
 * step finishing and this one finishing, and the golden-run times it spans. `events` may be
 * empty for a step that only needs time to pass (waiting for crystals, the cross to vanish).
 */
export type StepSegment = { stepId: string; events: GoldenEvent[]; startT: number; endT: number };

/**
 * The compact form kept in segments.generated.json: per step [first event index, last event index
 * (inclusive; first > last when empty), startT, endT], indices into the golden events without the
 * observation answers. Replaying a long golden run takes seconds, so it is done once at build time
 * (the segments test checks the file is current: `UPDATE_SEGMENTS=1 vitest run segments`).
 */
export type SegmentTable = Record<string, { version: number; events: number; steps: Record<string, [number, number, number, number]> }>;

const EVAL_MS = 500;
const isAnswer = (e: GoldenEvent) => e.type === "param.set" && String(e.payload.key ?? "").startsWith("answer:");

const cache = new WeakMap<ExperimentContent, Record<string, StepSegment>>();

/** The step segments of the golden run: from the precomputed table when it matches, else replayed. */
export function goldenSegments(content: ExperimentContent): Record<string, StepSegment> {
  const hit = cache.get(content);
  if (hit) return hit;
  const gold = content.golden.events.filter((e) => !isAnswer(e));
  const row = (PRECOMPUTED as unknown as SegmentTable)[content.slug];
  let out: Record<string, StepSegment>;
  if (row && row.version === content.version && row.events === gold.length && content.steps.every((s) => row.steps[s.id])) {
    out = {};
    for (const s of content.steps) {
      const [a, b, startT, endT] = row.steps[s.id]!;
      out[s.id] = { stepId: s.id, events: gold.slice(a, b + 1), startT, endT };
    }
  } else out = fromTable(gold, computeSegmentTable(content));
  cache.set(content, out);
  return out;
}

function fromTable(gold: GoldenEvent[], steps: Record<string, [number, number, number, number]>): Record<string, StepSegment> {
  const out: Record<string, StepSegment> = {};
  for (const [id, [a, b, startT, endT]] of Object.entries(steps)) out[id] = { stepId: id, events: gold.slice(a, b + 1), startT, endT };
  return out;
}

/**
 * Splits the golden run into one segment per step by replaying it through the engine and the
 * evaluator (display and "do this step for me" only: nothing here changes the simulation).
 */
export function computeSegmentTable(content: ExperimentContent): Record<string, [number, number, number, number]> {
  const gold = content.golden.events.filter((e) => !isAnswer(e));
  let s = initialState(content.bench);
  const ev = new Evaluator(content);
  const doneIdx: Record<string, number> = {};
  const doneT: Record<string, number> = {};
  let last = -1;
  const mark = () => {
    for (const p of ev.steps) {
      if (p.done && doneIdx[p.id] === undefined) {
        doneIdx[p.id] = last;
        doneT[p.id] = p.doneAt ?? s.t;
      }
    }
  };
  for (let i = 0; i < gold.length; i++) {
    const g = gold[i]!;
    while (s.t + EVAL_MS <= g.t) {
      s = advance(s, EVAL_MS).state;
      ev.tick(s, s.t);
      mark();
    }
    const e = { id: `g${i}`, attemptId: "golden", seq: i + 1, t: g.t, actor: "user", type: g.type, payload: g.payload } as LabEvent;
    s = applyEvent(s, e).state;
    ev.push(e, s);
    last = i;
    mark();
  }
  const endAt = Math.max(content.golden.durationS * 1000, s.t) + 60_000;
  while (s.t < endAt && ev.current()) {
    s = advance(s, EVAL_MS).state;
    ev.tick(s, s.t);
    mark();
  }
  // In the order the golden run finished them (it may do a later step first, e.g. fill a tube early).
  const out: Record<string, [number, number, number, number]> = {};
  const order = content.steps.map((st, i) => ({ st, i })).sort((x, y) => (doneIdx[x.st.id] ?? Infinity) - (doneIdx[y.st.id] ?? Infinity) || (doneT[x.st.id] ?? Infinity) - (doneT[y.st.id] ?? Infinity) || x.i - y.i);
  let prevIdx = -1;
  let prevT = 0;
  for (const { st: step } of order) {
    const idx = doneIdx[step.id];
    if (idx === undefined) {
      out[step.id] = [prevIdx + 1, prevIdx, prevT, prevT];
      continue;
    }
    const first = gold[prevIdx + 1];
    out[step.id] = [prevIdx + 1, idx, Math.min(prevT, idx > prevIdx && first ? first.t : prevT, doneT[step.id]!), doneT[step.id]!];
    prevIdx = Math.max(prevIdx, idx);
    prevT = Math.max(prevT, doneT[step.id]!);
  }
  return out;
}

/** The whole table for a set of experiments (written to segments.generated.json). */
export function buildSegmentTable(all: ExperimentContent[]): SegmentTable {
  const out: SegmentTable = {};
  for (const c of all) out[c.slug] = { version: c.version, events: c.golden.events.filter((e) => !isAnswer(e)).length, steps: computeSegmentTable(c) };
  return out;
}
