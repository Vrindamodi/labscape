import type { ComponentType } from "react";

/**
 * Part 3 plugs its physics and maths workspaces into stage 3 ("Try it yourself") of the shared
 * experiment player through this registry (build plan 2.1).
 */
export type StageModuleProps = { slug: string; attemptId: string | null; onComplete: (score: number) => void };
export type StageModule = { Try: ComponentType<StageModuleProps> };

const registry = new Map<string, StageModule>();

export function registerStage(subject: "physics" | "maths" | "chemistry", module: StageModule) {
  registry.set(subject, module);
}

export function stageFor(subject: string): StageModule | undefined {
  return registry.get(subject);
}
