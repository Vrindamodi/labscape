/**
 * Entry point for the server bundle (apps/api runs it inside the JVM with GraalJS).
 * Strings in, strings out: the Java side never touches engine types directly.
 */
import type { LabEvent } from "@labscape/contracts";
import { advance, replay } from "./engine/reducer";
import { stateHash } from "./engine/hash";
import { look, type BenchSetup } from "./engine/state";
import { EXPERIMENTS } from "./protocol/content";
import { runSession } from "./protocol/session";
import { MATHS_CONTENT, MATHS_MODELS } from "@labscape/mathlab/labs";
import { PHYSICS_CONTENT, PHYSICS_MODELS } from "@labscape/physics/labs";
import { runSim, simHash, type SimContent, type SimModel } from "@labscape/physics/protocol";
import { compile, parse } from "@labscape/mathlab/core";

export const ENGINE_VERSION = "2.0.0";
/** Physics and maths models (Part 3), reported alongside the chemistry engine version. */
export const SIM_VERSION = "3.0.0";

const SIM: Record<string, { content: SimContent; model: SimModel<unknown> }> = Object.fromEntries(
  [...Object.entries(PHYSICS_CONTENT).map(([k, c]) => [k, { content: c, model: PHYSICS_MODELS[k]! }] as const), ...Object.entries(MATHS_CONTENT).map(([k, c]) => [k, { content: c, model: MATHS_MODELS[k]! }] as const)],
);

/** Physics or maths: replay the log through the model and score it (the server re-derives every reading). */
function scoreSim(slug: string, events: LabEvent[]): string {
  const s = SIM[slug]!;
  const r = runSim(s.content, s.model, events);
  return JSON.stringify({ engineVersion: SIM_VERSION, hash: simHash(r.state), report: r.report, simTimeMs: r.t });
}

/** /v1/physics/check and /v1/maths/check: score an event log for a subject without an attempt. */
export function checkJson(subject: string, slug: string, eventsJson: string): string {
  const s = SIM[slug];
  if (!s || s.content.subject !== subject) throw new Error(`Unknown ${subject} experiment ${slug}`);
  return scoreSim(slug, JSON.parse(eventsJson) as LabEvent[]);
}

/** Replays an attempt's log against the experiment and returns the report and final hash. */
export function scoreJson(slug: string, eventsJson: string, tailMs: number): string {
  const content = EXPERIMENTS[slug];
  if (!content && SIM[slug]) return scoreSim(slug, JSON.parse(eventsJson) as LabEvent[]);
  if (!content) throw new Error(`Unknown experiment ${slug}`);
  const events = JSON.parse(eventsJson) as LabEvent[];
  const r = runSession(content, events, { tailMs });
  return JSON.stringify({ engineVersion: ENGINE_VERSION, hash: r.hash, report: r.report, simTimeMs: r.state.t });
}

/** The full authored content for one experiment (bench, steps, hints, observations, golden run). */
export function contentJson(slug: string): string | null {
  const c = EXPERIMENTS[slug] ?? SIM[slug]?.content;
  return c ? JSON.stringify(c) : null;
}

export function slugsJson(): string {
  return JSON.stringify([...Object.keys(EXPERIMENTS), ...Object.keys(SIM)]);
}

/** Sandbox simulation: a bench and an event log in, the final look of every vessel out. */
export function simulateJson(benchJson: string, eventsJson: string, tailMs: number): string {
  const bench = JSON.parse(benchJson) as BenchSetup;
  const events = JSON.parse(eventsJson) as LabEvent[];
  let { state, notes, cues } = replay(bench, events);
  if (tailMs > 0) {
    const r = advance(state, tailMs);
    state = r.state;
    notes = [...notes, ...r.notes];
    cues = [...cues, ...r.cues];
  }
  const vessels = Object.fromEntries(Object.values(state.items).map((it) => [it.id, look(it)]));
  return JSON.stringify({ engineVersion: ENGINE_VERSION, hash: stateHash(state), vessels, notes, cues, seen: state.seen });
}

/** Evaluates an expression with given values (quiz drafts: numerical answers are recomputed here). */
export function evaluateJson(expr: string, scopeJson: string): number {
  return compile(parse(expr))(JSON.parse(scopeJson) as Record<string, number>);
}
