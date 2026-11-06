/**
 * Contract 8 - Shell slots. Producer: Part 1. Consumers: everyone.
 * Labs mount into the shell only through these surfaces.
 */

/** <ContextPanel.Slot name=...> - right context panel, 360 px, collapsible. */
export type ContextPanelSlotName = "assistant" | "progress" | "info";

/** <FullscreenLab> hides all chrome; tool panels become bottom sheets. */
export type BottomSheetSnap = 0.25 | 0.55 | 0.9;

export type ToastKind = "info" | "success" | "warning" | "danger" | "reward";

export type ToastOptions = {
  kind: ToastKind;
  title: string;
  body?: string;
  durationMs?: number;
  action?: { label: string; onClick: () => void };
};

export type ModalOptions = {
  title: string;
  /** Safety modals cannot be dismissed by clicking outside. */
  dismissible: boolean;
};

/**
 * <AdSlot placement> renders ONLY in these placements (build plan 1.7).
 * Never inside experiment stages 2-5, the playground workspace, emergency simulator,
 * safety cards or the AI panel - enforced by a lint rule plus an end-to-end test.
 */
export type AdPlacement =
  | "dashboard.between_sections"
  | "library.grid_ninth"
  | "quiz.results_below_score";

export type Politeness = "polite" | "assertive";

/** Shell APIs exposed to every part. Implemented by Part 1. */
export interface ShellApi {
  toast(options: ToastOptions): void;
  announce(text: string, politeness?: Politeness): void;
  setAutosaveState(state: "saving" | "saved" | "error", at?: number): void;
}
