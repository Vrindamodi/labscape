import balanceJson from "../../../../content/experiments/balance-equations.json";
import tangentJson from "../../../../content/experiments/derivative-as-slope.json";
import diceJson from "../../../../content/experiments/dice-probability.json";
import quadraticJson from "../../../../content/experiments/quadratic-explorer.json";
import transformJson from "../../../../content/experiments/graph-transformations.json";
import riemannJson from "../../../../content/experiments/riemann-sums.json";
import circleJson from "../../../../content/experiments/unit-circle-trig.json";
import type { SimContent, SimModel } from "@labscape/physics/protocol";
import { balanceEquations, coinsDice, quadraticExplorer, riemannSums, tangentDerivative, unitCircle } from "./maths";
import { graphTransformations } from "./transformations";

export * from "./maths";
export * from "./transformations";

/** Maths experiments: reviewed content (JSON) and the model behind each, keyed by slug. */
export const MATHS_CONTENT: Record<string, SimContent> = Object.fromEntries(
  [quadraticJson, balanceJson, circleJson, tangentJson, riemannJson, diceJson, transformJson].map((c) => [c.slug, c as unknown as SimContent]),
);

export const MATHS_MODELS: Record<string, SimModel<any>> = Object.fromEntries( // eslint-disable-line @typescript-eslint/no-explicit-any
  [quadraticExplorer, balanceEquations, unitCircle, tangentDerivative, riemannSums, coinsDice, graphTransformations].map((m) => [m.slug, m]),
);
