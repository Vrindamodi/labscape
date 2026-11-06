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
      className="pointer-events-auto relative overflow-hidden rounded-lg border border-white/10 bg-[#141b2e]/95 p-3.5 pr-10 shadow-[0_20px_50px_-20px_rgba(0,0,0,.9)] backdrop-blur-xl"
      style={{ boxShadow: `inset 3px 0 0 ${s.c}, 0 20px 50px -20px rgba(0,0,0,.9)` }}
    >
      <div className="flex gap-3">
        <s.I className="mt-0.5 h-5 w-5 shrink-0" style={{ color: s.c }} aria-hidden />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">{t.title}</div>
          {t.body && <div className="mt-0.5 text-sm text-white/65">{t.body}</div>}
          {t.action && (
            <button
              onClick={() => {
                t.action?.onClick();
                onDone();
              }}
              className="mt-2 text-sm font-semibold"
              style={{ color: s.c }}
            >
              {t.action.label} →
            </button>
          )}
        </div>
      </div>
      <button onClick={onDone} aria-label="Dismiss" className="absolute right-2 top-2 rounded p-1 text-white/40 hover:text-white">
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
        "relative flex items-center justify-between gap-4 overflow-hidden rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-5 text-sm text-white/45",
        className,
      )}
      style={{ minHeight: AD_SIZES[placement].minHeight }}
    >
      <span className="absolute left-3 top-2 text-[10px] uppercase tracking-[0.2em] text-white/30">Sponsored</span>
      <span>Ad space · go Premium to remove ads</span>
      <a href="/plans" className="font-semibold text-[#ffd77a] hover:underline">
        Remove ads
      </a>
    </aside>
  );
}
