import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  title: string;
  message: string;
  alternatives: string[];
  onClose: () => void;
  onAlternative: (a: string) => void;
};

/** Blocking dialog for prohibited (e.g. explosive) combinations. Never names the hazard. */
export function ProhibitedDialog({
  open,
  title,
  message,
  alternatives,
  onClose,
  onAlternative,
}: Props) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) ok.current?.focus();
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center bg-red-950/40 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="prohibited-title"
            aria-describedby="prohibited-msg"
            className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl"
            initial={{ scale: 1.25, y: -60, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1, x: [0, -10, 9, -6, 4, 0] }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.55, ease: [0.2, 0, 0, 1] }}
          >
            <div className="flex items-center gap-4 bg-gradient-to-r from-red-500 to-rose-500 px-6 py-5 text-white">
              <svg viewBox="0 0 120 140" width="54" height="62" aria-hidden>
                <path
                  d="M60 6 L110 24 V66 C110 100 88 122 60 134 C32 122 10 100 10 66 V24 Z"
                  fill="#fff"
                  fillOpacity="0.2"
                  stroke="#fff"
                  strokeWidth="6"
                />
                <path
                  d="M40 52 L80 92 M80 52 L40 92"
                  stroke="#fff"
                  strokeWidth="11"
                  strokeLinecap="round"
                />
              </svg>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] opacity-85">
                  Safety restriction
                </div>
                <h2 id="prohibited-title" className="font-heading text-2xl font-bold leading-tight">
                  {title === "Safety restriction" ? "Not allowed in LABscape" : title}
                </h2>
              </div>
            </div>
            <div className="px-6 py-5">
              <p id="prohibited-msg" className="text-[14.5px] leading-relaxed text-slate-700">
                {message}
              </p>
              <p className="mt-2 text-[13px] text-slate-500">
                We've put that last addition back on the shelf.
              </p>
              <div className="mt-4 text-[12px] font-bold uppercase tracking-wider text-slate-400">
                Try something safe instead
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {alternatives.map((a) => (
                  <button key={a} className="lab-preset" onClick={() => onAlternative(a)}>
                    {a}
                  </button>
                ))}
              </div>
              <button ref={ok} className="lab-btn mt-5 w-full" onClick={onClose}>
                Got it
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
