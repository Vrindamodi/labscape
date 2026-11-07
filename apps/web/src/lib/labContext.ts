import type { LabContext } from "@labscape/contracts";
import { useEffect, useSyncExternalStore } from "react";

/**
 * The live LabContext (contract 5): whichever lab, playground or scenario is open publishes a
 * snapshot here, and the assistant reads it with every message. It is data, never instructions.
 */
export type PublishedContext = LabContext & { currentStepText?: string | null; experimentTitle?: string };

let current: PublishedContext | null = null;
const listeners = new Set<() => void>();

export function setLabContext(ctx: PublishedContext | null) {
  current = ctx;
  listeners.forEach((l) => l());
}

export const getLabContext = () => current;

export function useLabContext() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => current,
  );
}

/** Publishes a context while the calling component is mounted; clears it on unmount. */
export function usePublishLabContext(ctx: PublishedContext | null) {
  const key = ctx ? JSON.stringify(ctx) : "";
  useEffect(() => {
    setLabContext(ctx);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setLabContext(null), []);
}
