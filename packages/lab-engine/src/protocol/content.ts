import titration from "../../../../content/experiments/acid-base-titration.json";
import dilution from "../../../../content/experiments/diluting-acid-safely.json";
import flame from "../../../../content/experiments/flame-tests.json";
import hydrogen from "../../../../content/experiments/hydrogen-pop-test.json";
import ironNail from "../../../../content/experiments/iron-nail-copper-sulfate.json";
import indicators from "../../../../content/experiments/ph-indicators.json";
import precipitation from "../../../../content/experiments/precipitation-reactions.json";
import type { ExperimentContent } from "./types";

/** Reviewed experiment content, keyed by slug. JSON lives in content/experiments for review. */
export const EXPERIMENTS: Record<string, ExperimentContent> = Object.fromEntries(
  [indicators, titration, precipitation, hydrogen, ironNail, dilution, flame].map((c) => c as unknown as ExperimentContent).map((c) => [c.slug, c]),
);

export function experiment(slug: string): ExperimentContent | null {
  return EXPERIMENTS[slug] ?? null;
}
