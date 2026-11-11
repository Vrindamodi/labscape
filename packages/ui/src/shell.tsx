import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, CircleAlert, Info, Sparkles, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "./components";

/**
 * Contract 8 - shell slots, implemented by Part 1 and used by every part:
 * toasts, announce() for screen readers, the autosave indicator, <ContextPanelSlot>,
 * <FullscreenLab> and <AdSlot>.
 */

export type ToastKind = "info" | "success" | "warning" | "danger" | "reward";
export type ToastOptions = {
  kind: ToastKind;
  title: string;
  body?: string | undefined;
  durationMs?: number | undefined;
  action?: { label: string; onClick: () => void } | undefined;
};
export type Politeness = "polite" | "assertive";
export type AutosaveState = { state: "idle" | "saving" | "saved" | "error"; at?: number };
export type ContextPanelSlotName = "assistant" | "progress" | "info";
export type AdPlacement = "dashboard.between_sections" | "library.grid_ninth" | "quiz.results_below_score";

type ShellCtx = {
  toast: (o: ToastOptions) => void;
  announce: (text: string, politeness?: Politeness) => void;
  setAutosaveState: (state: "saving" | "saved" | "error", at?: number) => void;
  autosave: AutosaveState;
  fullscreen: boolean;
  setFullscreen: (on: boolean) => void;
  panelTargets: Partial<Record<ContextPanelSlotName, HTMLElement | null>>;
  registerPanelTarget: (name: ContextPanelSlotName, el: HTMLElement | null) => void;
  adsHidden: boolean;
};

const Ctx = createContext<ShellCtx | null>(null);

export function useShell() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useShell must be used inside <ShellProvider>");
  return c;
}

type ToastItem = ToastOptions & { id: number };

export function ShellProvider({
  children,
  adsHidden,
  onToastSound,
}: {
  children: ReactNode;
  adsHidden: boolean;
  onToastSound?: (kind: ToastKind) => void;
}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [autosave, setAutosave] = useState<AutosaveState>({ state: "idle" });
  const [fullscreen, setFullscreen] = useState(false);
  const [panelTargets, setPanelTargets] = useState<ShellCtx["panelTargets"]>({});
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const nextId = useRef(1);
  const soundRef = useRef(onToastSound);
  soundRef.current = onToastSound;

  const toast = useCallback((o: ToastOptions) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { ...o, id }]);
    soundRef.current?.(o.kind);
    // Toasts are announced too, so screen-reader users get them.
    if (o.kind === "danger") setAssertive(`${o.title}. ${o.body ?? ""}`);
    else setPolite(`${o.title}. ${o.body ?? ""}`);
  }, []);

  const announce = useCallback((text: string, politeness: Politeness = "polite") => {
    // Clear first so repeating the same text is still announced.
    if (politeness === "assertive") {
      setAssertive("");
      window.setTimeout(() => setAssertive(text), 30);
    } else {
      setPolite("");
      window.setTimeout(() => setPolite(text), 30);
    }
  }, []);

  const setAutosaveState = useCallback((state: "saving" | "saved" | "error", at?: number) => {
    setAutosave({ state, at: at ?? Date.now() });
  }, []);

  const registerPanelTarget = useCallback((name: ContextPanelSlotName, el: HTMLElement | null) => {
    setPanelTargets((p) => (p[name] === el ? p : { ...p, [name]: el }));
  }, []);

  const value = useMemo<ShellCtx>(
    () => ({ toast, announce, setAutosaveState, autosave, fullscreen, setFullscreen, panelTargets, registerPanelTarget, adsHidden }),
    [toast, announce, setAutosaveState, autosave, fullscreen, panelTargets, registerPanelTarget, adsHidden],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <Toaster toasts={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
      <div className="sr-only" aria-live="polite" role="status">
        {polite}
      </div>
      <div className="sr-only" aria-live="assertive" role="alert">
        {assertive}
      </div>
    </Ctx.Provider>
  );
}

const TOAST_STYLE: Record<ToastKind, { c: string; I: typeof Info }> = {
  info: { c: "#22D3EE", I: Info },
  success: { c: "#22C55E", I: CheckCircle2 },
  warning: { c: "#F59E0B", I: AlertTriangle },
  danger: { c: "#EF4444", I: CircleAlert },
  reward: { c: "#FFC23D", I: Sparkles },
};

function Toaster({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-24 right-4 z-[85] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2 lg:bottom-5">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastCard key={t.id} t={t} onDone={() => dismiss(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastCard({ t, onDone }: { t: ToastItem; onDone: () => void }) {
  const ms = t.durationMs ?? 4000;
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(id);
  }, [ms, onDone, paused]);
  const s = TOAST_STYLE[t.kind];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      className="pointer-events-auto relative overflow-hidden rounded-[20px] bg-card p-3.5 pr-10 text-ink shadow-pop ring-1 ring-inset ring-line"
    >
      <div className="flex gap-3">
        <span className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ background: `${s.c}2e`, color: s.c }}>
          <s.I className="h-4 w-4" style={{ filter: "brightness(.72) saturate(1.2)" }} aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink-strong">{t.title}</div>
          {t.body && <div className="mt-0.5 text-sm text-ink-muted">{t.body}</div>}
          {t.action && (
            <button
              onClick={() => {
                t.action?.onClick();
                onDone();
              }}
              className="mt-2 rounded-full bg-ink-strong px-3 py-1 text-xs font-medium text-on-ink hover:bg-ink-strong/85"
            >
              {t.action.label} →
            </button>
          )}
        </div>
      </div>
      <button onClick={onDone} aria-label="Dismiss" className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full text-ink-faint hover:bg-ink/[0.06] hover:text-ink">
        <X className="h-4 w-4" />
      </button>
      {/* hairline countdown */}
      <motion.span
        className="absolute bottom-0 left-0 h-[2px]"
        style={{ background: s.c, opacity: 0.7 }}
        initial={{ width: "100%" }}
        animate={{ width: paused ? undefined : "0%" }}
        transition={{ duration: ms / 1000, ease: "linear" }}
      />
    </motion.div>
  );
}

/** Renders children into the shell's right context panel, in the named slot. */
export function ContextPanelSlot({ name, children }: { name: ContextPanelSlotName; children: ReactNode }) {
  const { panelTargets } = useShell();
  const target = panelTargets[name];
  return target ? createPortal(children, target) : null;
}

/** Hides all shell chrome while mounted (labs, playground, emergency simulator). */
export function FullscreenLab({ children }: { children: ReactNode }) {
  const { setFullscreen } = useShell();
  useEffect(() => {
    setFullscreen(true);
    return () => setFullscreen(false);
  }, [setFullscreen]);
  return <>{children}</>;
}

const AD_SIZES: Record<AdPlacement, { minHeight: number }> = {
  "dashboard.between_sections": { minHeight: 120 },
  "library.grid_ninth": { minHeight: 280 },
  "quiz.results_below_score": { minHeight: 100 },
};

/**
 * Ads render ONLY in the three allowed placements, never inside labs, the playground, the emergency
 * simulator, safety cards or the AI panel (those surfaces mount <FullscreenLab>, which disables ads).
 * Slots reserve their size, so they never shift layout.
 */
export function AdSlot({ placement, className }: { placement: AdPlacement; className?: string }) {
  const { adsHidden, fullscreen } = useShell();
  if (adsHidden || fullscreen) return null;
  return (
    <aside
      aria-label="Advertisement"
      data-ad-placement={placement}
      className={cx(
        "relative flex items-center justify-between gap-4 overflow-hidden rounded-card border border-dashed border-line-strong bg-card/50 px-6 text-sm text-ink-muted",
        "dark:border-white/10 dark:bg-white/[0.02] dark:text-white/45",
        className,
      )}
      style={{ minHeight: AD_SIZES[placement].minHeight }}
    >
      <span className="absolute left-6 top-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">Sponsored</span>
      <span>Ad space · go Premium to remove ads</span>
      <a href="/plans" className="shrink-0 whitespace-nowrap rounded-full bg-line px-4 py-2 font-medium text-ink transition hover:bg-ink-strong hover:text-on-ink dark:bg-transparent dark:px-0 dark:font-semibold dark:text-[#ffd77a] dark:hover:bg-transparent dark:hover:underline">
        Remove ads
      </a>
    </aside>
  );
}
