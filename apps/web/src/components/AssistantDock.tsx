import { AssistantPanel, type AiAction, type AssistantPanelProps } from "@labscape/assistant";
import { useMotion } from "@labscape/motion";
import { useShell } from "@labscape/ui";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { post } from "../lib/api";
import { getLabContext, useLabContext } from "../lib/labContext";
import { useSession } from "../lib/session";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

/** Suggestion chips inside the emergency simulator. */
export const EMERGENCY_CHIPS = ["I don't know what to do", "What is the safest first step?", "Why not water?"];
/** The third chip asks about the tempting wrong move in that scenario (cool water is right for a burn). */
const WHY_NOT: Record<string, string> = {
  "gas-fire": "Why not water?",
  "chemical-spill": "Why not mop it up with paper towels?",
  "electrical-short": "Why not wiggle the plugs?",
  "minor-burn": "Why not put ice on it?",
};
export const emergencyChips = (slug?: string) => [EMERGENCY_CHIPS[0]!, EMERGENCY_CHIPS[1]!, (slug && WHY_NOT[slug]) || "What should I avoid?"];

type PanelOverrides = Partial<Pick<AssistantPanelProps, "getContext" | "suggestions" | "title" | "subtitle" | "intro" | "placeholder" | "onSend" | "fallback" | "onClose" | "closeLabel">>;

/** The assistant wired to the app: endpoint, live LabContext, actions, rating and level. `panel` overrides suit other surfaces (the emergency coach). */
export function AssistantDock({ compact, panel }: { compact?: boolean; panel?: PanelOverrides }) {
  const navigate = useNavigate();
  const { me } = useSession();
  const ctx = useLabContext();
  const { toast } = useShell();
  const onAction = (a: AiAction) => {
    if (a.type === "highlight")
      window.dispatchEvent(new CustomEvent("labscape:highlight", { detail: a.target }));
    else if (a.type === "openFormula") navigate(`/formulas?f=${encodeURIComponent(a.target)}`);
    else if (a.target.startsWith("/")) navigate(a.target);
  };
  const chips =
    ctx?.surface === "emergency"
      ? EMERGENCY_CHIPS
      : ctx?.surface === "experiment"
      ? [
          "Why did it change colour?",
          "What should I do next?",
          "What did I do wrong?",
          "Explain it more simply",
        ]
      : [
          "What is a burette for?",
          "Explain Ohm's law",
          "Recommend an experiment",
          "Explain it more simply",
        ];
  return (
    <AssistantPanel
      endpoint={`${BASE}/v1/ai/chat`}
      getContext={getLabContext}
      onAction={onAction}
      onSave={(text) => {
        const c = getLabContext();
        const attemptId = c?.surface === "emergency" ? undefined : c?.attemptId;
        void post("/v1/notebook/clips", {
          text,
          source: "assistant",
          ...(attemptId ? { attemptId } : {}),
        })
          .then(() => toast({ kind: "success", title: "Saved to your notebook" }))
          .catch(() => toast({ kind: "danger", title: "Couldn't save that answer" }));
      }}
      rate={(id, rating) => post(`/v1/ai/messages/${id}/rate`, { rating }).then(() => {})}
      {...(me?.profile.learningLevel ? { level: me.profile.learningLevel } : {})}
      {...(ctx?.surface === "emergency" ? {} : { guideText: ctx?.currentStepText ?? null })}
      suggestions={chips}
      {...(compact ? { compact } : {})}
      {...panel}
    />
  );
}

/** Inside full-screen labs: an orb button in the lab's top bar (so it never covers bench controls) that opens the assistant as a side sheet (bottom sheet on phones). */
export function AssistantLauncher() {
  const [open, setOpen] = useState(false);
  const { reduced } = useMotion();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#8b5cf6,#e879f9)] py-1.5 pl-1.5 pr-3 text-xs font-semibold text-white shadow-[0_8px_24px_-8px_rgba(139,92,246,.8)]"
        aria-label="Ask the assistant"
      >
        <span className="h-5 w-5 rounded-full bg-[radial-gradient(circle_at_35%_30%,#fff,#f0abfc_40%,#8b5cf6)]" />{" "}
        Ask
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <>
              <motion.div
                className="fixed inset-0 z-40 bg-black/30"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setOpen(false)}
              />
              <motion.aside
                role="dialog"
                aria-label="Science assistant"
                data-surface="dark"
                className="fixed inset-x-0 bottom-0 z-50 flex h-[78vh] flex-col rounded-t-2xl border-t border-white/10 bg-[#0d1426] p-4 shadow-2xl sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-0 sm:h-auto sm:w-[400px] sm:rounded-none sm:border-l sm:border-t-0"
                initial={reduced ? { opacity: 0 } : { y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={reduced ? { opacity: 0 } : { y: 40, opacity: 0 }}
                transition={{ type: "spring", stiffness: 360, damping: 34 }}
              >
                <button
                  onClick={() => setOpen(false)}
                  className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-md text-white/60 hover:bg-white/10"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
                <AssistantDock compact />
              </motion.aside>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/** "Show me": a pulsing cyan ring around any element tagged data-highlight-id. */
export function HighlightLayer() {
  const [box, setBox] = useState<DOMRect | null>(null);
  const { reduced } = useMotion();
  useEffect(() => {
    let t = 0;
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      // the bench may need a moment to render the label it is about to highlight
      window.setTimeout(() => {
        const el = document.querySelector<HTMLElement>(`[data-highlight-id="${CSS.escape(id)}"]`);
        if (!el) return;
        el.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
        setBox(el.getBoundingClientRect());
        window.clearTimeout(t);
        t = window.setTimeout(() => setBox(null), 3200);
      }, 120);
    };
    window.addEventListener("labscape:highlight", on);
    return () => window.removeEventListener("labscape:highlight", on);
  }, [reduced]);
  return (
    <AnimatePresence>
      {box && (
        <motion.div
          className="pointer-events-none fixed z-[60] rounded-xl ring-4 ring-[#22d3ee] shadow-[0_0_30px_#22d3ee]"
          style={{
            left: box.left - 8,
            top: box.top - 8,
            width: box.width + 16,
            height: box.height + 16,
          }}
          initial={{ opacity: 0, scale: 1.2 }}
          animate={reduced ? { opacity: 1, scale: 1 } : { opacity: [1, 0.5, 1], scale: 1 }}
          exit={{ opacity: 0 }}
          transition={
            reduced
              ? { duration: 0.1 }
              : { opacity: { repeat: Infinity, duration: 0.9 }, scale: { duration: 0.3 } }
          }
        />
      )}
    </AnimatePresence>
  );
}
