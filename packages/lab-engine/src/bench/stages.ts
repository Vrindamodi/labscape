import type { LabEvent } from "@labscape/contracts";
import type { ComponentType } from "react";

/**
 * Part 3 plugs its physics and maths workspaces into the shared experiment player through this
 * registry (build plan 2.1): the player keeps Intro, Observe, Quiz and Results, and asks the
 * subject's module for the Demo and Try stages.
 */
export type StageTryProps = {
  slug: string;
  attempt: { id: string; events: LabEvent[] };
  onSaved: (at: number) => void;
  onSaving: () => void;
  onSaveError: () => void;
  onDone: () => void;
  onRestart: () => void;
  announce: (text: string, priority?: "polite" | "assertive") => void;
};

export type StageDemoProps = { slug: string; onTry: () => void };

export type StageModule = {
  Try: ComponentType<StageTryProps>;
  Demo: ComponentType<StageDemoProps>;
  /** Does this module have the experiment? */
  has: (slug: string) => boolean;
};

const registry = new Map<string, StageModule>();

export function registerStage(subject: "physics" | "maths" | "chemistry", module: StageModule) {
  registry.set(subject, module);
}

export function stageFor(subject: string): StageModule | undefined {
  return registry.get(subject);
}
