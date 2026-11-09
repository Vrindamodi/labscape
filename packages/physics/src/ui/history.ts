import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Undo/redo history for a sandbox. Edits that share a `group` within `mergeMs` of each other fold
 * into one step (a drag, a slider being moved), so one Ctrl+Z undoes the whole gesture.
 */
export type History<T> = { past: T[]; present: T; future: T[]; group: string | null; at: number };

export const HISTORY_LIMIT = 100;

export const historyInit = <T>(present: T): History<T> => ({ past: [], present, future: [], group: null, at: 0 });

/** Records `next`. `merge` replaces the present without a new undo step (follow-on effects). */
export function historyPush<T>(h: History<T>, next: T, opts: { group?: string; merge?: boolean; now?: number; mergeMs?: number } = {}): History<T> {
  if (Object.is(next, h.present)) return h;
  const now = opts.now ?? Date.now();
  const same = !!opts.group && opts.group === h.group && now - h.at < (opts.mergeMs ?? 1500);
  if (opts.merge || same) return { ...h, present: next, at: same ? now : h.at };
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [], group: opts.group ?? null, at: now };
}

export function historyUndo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future], group: null, at: 0 };
}

export function historyRedo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1), group: null, at: 0 };
}

/** True for Ctrl/Cmd+Z (undo) or Ctrl/Cmd+Shift+Z / Ctrl+Y (redo) outside text fields. */
export function undoKey(e: KeyboardEvent): "undo" | "redo" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) && (t as HTMLInputElement).type !== "range" && (t as HTMLInputElement).type !== "checkbox") return null;
  const k = e.key.toLowerCase();
  if (k === "z") return e.shiftKey ? "redo" : "undo";
  if (k === "y") return "redo";
  return null;
}

/** React wrapper: state with undo/redo and the keyboard shortcuts bound to the window. */
export function useHistory<T>(initial: () => T, onStep?: (kind: "undo" | "redo") => void) {
  const [h, setH] = useState<History<T>>(() => historyInit(initial()));
  const set = useCallback((f: (prev: T) => T, opts?: { group?: string; merge?: boolean; mergeMs?: number }) => setH((x) => historyPush(x, f(x.present), opts)), []);
  const reset = useCallback((v: T) => setH((x) => historyPush(x, v)), []);
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const hRef = useRef(h);
  hRef.current = h;
  const undo = useCallback(() => {
    if (!hRef.current.past.length) return;
    setH(historyUndo);
    stepRef.current?.("undo");
  }, []);
  const redo = useCallback(() => {
    if (!hRef.current.future.length) return;
    setH(historyRedo);
    stepRef.current?.("redo");
  }, []);
  const keys = useRef({ undo, redo });
  keys.current = { undo, redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = undoKey(e);
      if (!k) return;
      e.preventDefault();
      keys.current[k]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { value: h.present, set, reset, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
