import { AnimatePresence, motion } from "framer-motion";
import type { FoundDiscovery } from "../storage";
import type { DiscoveryDef } from "../types";
import { Equation } from "./bits";

export function ProgressRing({
  value,
  total,
  size = 38,
}: {
  value: number;
  total: number;
  size?: number;
}) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const pct = total ? value / total : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth="3"
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="url(#ring-grad)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        initial={false}
        animate={{ strokeDashoffset: c * (1 - pct) }}
        transition={{ duration: 0.8, ease: [0.2, 0, 0, 1] }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <defs>
        <linearGradient id="ring-grad" x1="0" x2="1">
          <stop offset="0" stopColor="#22D3EE" />
          <stop offset="1" stopColor="#E879F9" />
        </linearGradient>
      </defs>
    </svg>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  discoveries: DiscoveryDef[];
  found: Record<string, FoundDiscovery>;
  fresh: Set<string>;
};

export function DiscoveryJournal({ open, onClose, discoveries, found, fresh }: Props) {
  const count = discoveries.filter((d) => found[d.id]).length;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-label="Discovery journal"
            className="ls-panel ls-scroll relative max-h-[86vh] w-full max-w-5xl overflow-y-auto p-6"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <ProgressRing value={count} total={discoveries.length} size={46} />
                <div>
                  <div className="ls-eyebrow">Discovery journal</div>
                  <div className="font-heading text-2xl font-semibold text-white">
                    <span className="tabular">{count}</span>
                    <span className="text-white/40"> / {discoveries.length}</span> discovered
                  </div>
                </div>
              </div>
              <button className="ls-icon-btn text-lg" onClick={onClose} aria-label="Close journal">
                ×
              </button>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {discoveries.map((d, i) => {
                const f = found[d.id];
                return (
                  <motion.div
                    key={d.id}
                    className={`ls-journal-card ${f ? "ls-journal-found" : "ls-journal-hidden"}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 8) * 0.04 }}
                  >
                    {f ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="font-heading text-[16px] font-semibold text-white">
                            {d.name}
                          </span>
                          {fresh.has(d.id) && (
                            <span className="rounded-full bg-ai-magenta/20 px-2 py-0.5 text-[10px] font-bold uppercase text-ai-magenta">
                              New
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-white/40">
                          {d.type}
                        </div>
                        {f.equationLatex && (
                          <div className="ls-equation mt-3 text-[13px]">
                            <Equation latex={f.equationLatex} />
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="ls-silhouette" aria-hidden />
                          <span className="font-heading text-[16px] font-semibold text-white/30">
                            ???
                          </span>
                        </div>
                        <p className="mt-2 text-[12.5px] italic leading-snug text-white/55">
                          “{d.clue}”
                        </p>
                      </>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
