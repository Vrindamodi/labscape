import type { LabEvent } from "@labscape/contracts";
import { simGoldenEvents, SimEvaluator } from "../protocol/evaluator";
import type { SimContent, SimModel } from "../protocol/types";

/** What the golden run does for one step, and when (ms on the demo clock). */
export type GoldenStep = { stepId: string; events: LabEvent[]; start: number; end: number };

/**
 * Splits the golden run into steps: each scripted action belongs to the step that was current when
 * it happened. "Do this step for me" replays a step's actions through the learner's own session (so
 * scoring and the server see ordinary events); "Show me" plays just that slice of the demo.
 */
export function goldenSteps<S>(content: SimContent, model: SimModel<S>): Record<string, GoldenStep> {
  const ev = new SimEvaluator(content, model);
  const out: Record<string, GoldenStep> = {};
  for (const e of simGoldenEvents(content)) {
    const cur = ev.current()?.id;
    ev.push(e);
    if (!cur || e.type === "hint.shown") continue;
    if (e.type === "param.set" && String(e.payload.key).startsWith("answer:")) continue;
    const g = (out[cur] ??= { stepId: cur, events: [], start: e.t, end: e.t });
    g.events.push(e);
    g.end = e.t;
  }
  return out;
}

/** The first sentence of an instruction: the one line Guide me shows. */
export function firstSentence(text: string): string {
  const parts = text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  // A bare equation ("3x + 4 = 19.") is not an instruction: keep going until there are some words.
  let out = parts[0] ?? "";
  for (let i = 1; i < parts.length && (out.match(/[A-Za-z]{2,}/g) ?? []).length < 2; i++) out = `${out} ${parts[i]}`;
  return out;
}
