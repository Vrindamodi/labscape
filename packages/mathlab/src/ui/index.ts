import type { WorkspaceProps } from "@labscape/physics";
import type { ComponentType } from "react";
import { BalanceWorkspace, QuadraticWorkspace, UnitCircleWorkspace } from "./AlgebraWorkspaces";
import { DiceWorkspace, RiemannWorkspace, TangentWorkspace } from "./CalculusWorkspaces";
import { TransformWorkspace } from "./TransformWorkspace";

export * from "./Plot";
export * from "./MathInput";

/** The interactive workspace for each maths experiment, by slug. */
export const MATHS_WORKSPACES: Record<string, ComponentType<WorkspaceProps>> = {
  "quadratic-explorer": QuadraticWorkspace,
  "balance-equations": BalanceWorkspace,
  "unit-circle-trig": UnitCircleWorkspace,
  "derivative-as-slope": TangentWorkspace,
  "riemann-sums": RiemannWorkspace,
  "dice-probability": DiceWorkspace,
  "graph-transformations": TransformWorkspace,
};
