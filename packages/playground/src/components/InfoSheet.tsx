import { AnimatePresence, motion } from "framer-motion";
import type { ShelfItem } from "../types";
import { Formula, HazardIcon, ReagentArt } from "./bits";

const HAZARD_TEXT: Record<string, string> = {
  corrosive: "Corrosive",
  irritant: "Irritant / harmful",
  oxidising: "Oxidising",
  flammable: "Flammable",
  toxic: "Toxic",
  environmental: "Harmful to aquatic life",
};

export function InfoSheet({
  item,
  onClose,
  onAdd,
}: {
  item: ShelfItem | null;
  onClose: () => void;
  onAdd: (i: ShelfItem) => void;
}) {
  return (
    <AnimatePresence>
      {item && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-label={`${item.name} properties`}
            className="ls-panel w-full max-w-md p-6"
            style={{ ["--swatch" as string]: item.colour }}
            initial={{ y: 30, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-4">
              <div className="ls-card-art grid h-20 w-20 shrink-0 place-items-center rounded-2xl">
                <ReagentArt item={item} size={64} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="ls-eyebrow">{item.category}</div>
                <h3 className="font-heading text-xl font-semibold text-white">{item.name}</h3>
                <div className="mt-1 text-white/80">
                  <Formula value={item.formula} className="ls-formula text-[15px]" />
                  {item.concentrationM !== null && (
                    <span className="tabular ml-2 text-sm text-white/50">
                      {item.concentrationM} M
                    </span>
                  )}
                </div>
              </div>
              <button className="ls-icon-btn text-lg" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>
            <p className="mt-4 text-[14px] leading-relaxed text-white/75">{item.description}</p>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-[12.5px]">
              <div className="ls-readout">
                <dt className="text-[10px] uppercase tracking-[0.14em] text-white/40">State</dt>
                <dd className="mt-0.5 text-white/85">
                  {item.form === "solid"
                    ? `Solid (${item.solidForm})`
                    : item.form === "liquid"
                      ? "Liquid"
                      : "Solution"}
                </dd>
              </div>
              <div className="ls-readout">
                <dt className="text-[10px] uppercase tracking-[0.14em] text-white/40">
                  Validated range
                </dt>
                <dd className="tabular mt-0.5 text-white/85">
                  {item.limits.min}–{item.limits.max} {item.limits.unit}
                </dd>
              </div>
            </dl>
            {item.hazards.length > 0 && (
              <div className="mt-4">
                <div className="ls-eyebrow mb-2">Hazards</div>
                <div className="flex flex-wrap gap-2">
                  {item.hazards.map((h) => (
                    <span key={h} className="ls-chip ls-chip-static">
                      <HazardIcon kind={h} /> {HAZARD_TEXT[h] ?? h}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <button className="ls-mix mt-5 w-full" onClick={() => onAdd(item)}>
              <span className="ls-mix-shine" aria-hidden />
              <span className="relative">Add to tray</span>
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
