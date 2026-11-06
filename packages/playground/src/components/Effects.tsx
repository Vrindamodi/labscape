import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { DiscoveryDef } from "../types";
import { Equation } from "./bits";

export function Ribbon({ show, text, sub }: { show: boolean; text: string; sub: string }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="ls-ribbon"
          initial={reduced ? { opacity: 0 } : { x: "-110%", skewX: -12 }}
          animate={reduced ? { opacity: 1 } : { x: "0%", skewX: -12 }}
          exit={reduced ? { opacity: 0 } : { x: "110%", skewX: -12, opacity: 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 26 }}
        >
          <div style={{ transform: "skewX(12deg)" }}>
            <div className="font-heading text-[22px] font-bold uppercase tracking-[0.12em] text-white">
              {text}
            </div>
            <div className="text-[12px] uppercase tracking-[0.2em] text-white/80">{sub}</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function DiscoveryCard({
  discovery,
  equation,
  onDone,
}: {
  discovery: DiscoveryDef | null;
  equation: string | null;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {discovery && (
        <motion.div
          className="ls-discovery-wrap"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onDone}
        >
          <motion.div
            className="ls-discovery-card"
            initial={reduced ? { opacity: 0 } : { rotateY: 180, scale: 0.6, y: 40 }}
            animate={reduced ? { opacity: 1 } : { rotateY: 0, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { scale: 0.7, y: -260, x: 380, opacity: 0 }}
            transition={{ type: "spring", stiffness: 180, damping: 18 }}
          >
            <div className="ls-eyebrow text-ai-magenta">New discovery</div>
            <div className="mt-2 font-heading text-[26px] font-bold leading-tight text-white">
              {discovery.name}
            </div>
            <div className="mt-1 text-[12px] uppercase tracking-[0.16em] text-white/50">
              {discovery.type}
            </div>
            {equation && (
              <div className="ls-equation mt-4">
                <Equation latex={equation} />
              </div>
            )}
            <motion.div
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-state-success/15 px-4 py-1.5 font-heading text-lg font-semibold text-state-success"
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.25, 1] }}
              transition={{ delay: 0.35, duration: 0.5 }}
            >
              +20 XP
            </motion.div>
            <div className="mt-4 text-[11px] text-white/40">
              Added to your discovery journal · tap to continue
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SafetyShield({ show }: { show: boolean }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="ls-shield"
          initial={reduced ? { opacity: 0 } : { scale: 1.6, y: -120, opacity: 0 }}
          animate={
            reduced
              ? { opacity: 1 }
              : { scale: [1.2, 1], y: 0, opacity: 1, x: [0, -8, 7, -5, 3, 0] }
          }
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.55, ease: [0.2, 0, 0, 1] }}
          aria-hidden
        >
          <svg viewBox="0 0 120 140" width="120" height="140">
            <defs>
              <linearGradient id="shield" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#ff5a5a" />
                <stop offset="1" stopColor="#b91c1c" />
              </linearGradient>
            </defs>
            <path
              d="M60 6 L110 24 V66 C110 100 88 122 60 134 C32 122 10 100 10 66 V24 Z"
              fill="url(#shield)"
              stroke="#fecaca"
              strokeWidth="3"
            />
            <path
              d="M38 50 L82 94 M82 50 L38 94"
              stroke="#fff"
              strokeWidth="10"
              strokeLinecap="round"
            />
          </svg>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Vignette({ colour, show }: { colour: string; show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-40"
          style={{ boxShadow: `inset 0 0 160px 40px ${colour}` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0.55] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
        />
      )}
    </AnimatePresence>
  );
}

export function FloatingNote({ text }: { text: string | null }) {
  return (
    <AnimatePresence>
      {text && (
        <motion.div
          className="ls-note"
          initial={{ opacity: 0, y: 10, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -14 }}
          transition={{ type: "spring", stiffness: 300, damping: 22 }}
        >
          {text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
