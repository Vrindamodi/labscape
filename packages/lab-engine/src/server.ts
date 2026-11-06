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

export const ENGINE_VERSION = "2.0.0";

/** Replays an attempt's log against the experiment and returns the report and final hash. */
export function scoreJson(slug: string, eventsJson: string, tailMs: number): string {
  const content = EXPERIMENTS[slug];
  if (!content) throw new Error(`Unknown experiment ${slug}`);
  const events = JSON.parse(eventsJson) as LabEvent[];
  const r = runSession(content, events, { tailMs });
  return JSON.stringify({ engineVersion: ENGINE_VERSION, hash: r.hash, report: r.report, simTimeMs: r.state.t });
}

/** The full authored content for one experiment (bench, steps, hints, observations, golden run). */
export function contentJson(slug: string): string | null {
  const c = EXPERIMENTS[slug];
  return c ? JSON.stringify(c) : null;
}

export function slugsJson(): string {
  return JSON.stringify(Object.keys(EXPERIMENTS));
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
