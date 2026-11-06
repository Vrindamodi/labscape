// @labscape/lab-engine - owned by Part 2.
// A pure, deterministic bench simulator: (state, LabEvent) -> state + observation cues.
// The same code runs in the browser every frame and on the server (GraalJS) to replay and score.
export * from "./engine/chem";
export * from "./engine/equipment";
export * from "./engine/reagents";
export * from "./engine/state";
export * from "./engine/reducer";
export * from "./engine/hash";
export * from "./protocol/types";
export * from "./protocol/evaluator";
export * from "./protocol/session";
export * from "./protocol/content";
// Workbench (React Three Fiber). Not imported by the server bundle (src/server.ts).
export * from "./bench/useLabSession";
export * from "./bench/Workbench";
export * from "./bench/colour";
export * from "./bench/stages";
