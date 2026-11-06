import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import type { ShelfItem } from "../types";
import { Formula, HazardIcon, ReagentArt } from "./bits";

export const CATEGORIES: { id: string; label: string; match: (i: ShelfItem) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "acid", label: "Acids", match: (i) => i.category === "acid" },
  { id: "alkali", label: "Alkalis", match: (i) => i.category === "alkali" },
  { id: "salt", label: "Salts", match: (i) => i.category === "salt" },
  { id: "metal", label: "Metals", match: (i) => i.category === "metal" },
  { id: "solid", label: "Solids", match: (i) => i.category === "solid" },
  { id: "indicator", label: "Indicators", match: (i) => i.category === "indicator" },
  {
    id: "other",
    label: "Other",
    match: (i) => ["other", "solvent", "household"].includes(i.category),
  },
];

type Props = {
  items: ShelfItem[];
  selected: Set<string>;
  category: string;
  onCategory: (c: string) => void;
  highlightId: string | null;
  onAdd: (item: ShelfItem, el: HTMLElement) => void;
  onInfo: (item: ShelfItem) => void;
  disabled: boolean;
};

export function Shelf({
  items,
  selected,
  category,
  onCategory,
  highlightId,
  onAdd,
  onInfo,
  disabled,
}: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const cat = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (cat ? cat.match(i) : true) &&
        (!q || i.name.toLowerCase().includes(q) || i.formula.toLowerCase().includes(q)),
    );
  }, [items, category, query]);

  return (
    <section className="ls-panel flex h-full min-h-0 flex-col" aria-label="Reagent shelf">
      <header className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="ls-eyebrow">Reagent shelf</h2>
        <span className="tabular text-[11px] text-white/40">{items.length} reagents</span>
      </header>
      <div className="px-4">
        <label className="ls-search">
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden>
            <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M13.5 13.5 L18 18"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or formula"
            aria-label="Search reagents"
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-1.5" role="tablist">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={category === c.id}
              className={`ls-chip ${category === c.id ? "ls-chip-on" : ""}`}
              onClick={() => onCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ls-scroll mt-3 min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <motion.ul layout className="grid grid-cols-2 gap-2.5">
          <AnimatePresence initial={false}>
            {filtered.map((item, i) => {
              const on = selected.has(item.id);
              const glow = highlightId === item.id;
              return (
                <motion.li
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.18, delay: Math.min(i, 8) * 0.03 }}
                >
                  <motion.button
                    className={`ls-card group ${on ? "ls-card-on" : ""} ${glow ? "ls-card-glow" : ""}`}
                    style={{ ["--swatch" as string]: item.colour }}
                    whileHover={disabled ? {} : { y: -3 }}
                    whileTap={disabled ? {} : { scale: 0.97 }}
                    animate={glow ? { y: [0, -5, 0] } : { y: 0 }}
                    transition={
                      glow
                        ? { duration: 1.4, repeat: Infinity }
                        : { type: "spring", stiffness: 500, damping: 32 }
                    }
                    onClick={(e) => !disabled && onAdd(item, e.currentTarget)}
                    disabled={disabled}
                    aria-pressed={on}
                    aria-label={`Add ${item.name}${item.concentrationM ? ` ${item.concentrationM} molar` : ""} to the tray`}
                  >
                    <span className="ls-card-art">
                      <ReagentArt item={item} size={50} />
                    </span>
                    <span className="mt-1 line-clamp-2 block min-h-[31px] text-[12.5px] font-medium leading-tight text-white/90">
                      {item.name}
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-1">
                      <Formula value={item.formula} className="ls-formula truncate" />
                      {item.concentrationM !== null && (
                        <span className="tabular shrink-0 text-[10px] text-white/45">
                          {item.concentrationM} M
                        </span>
                      )}
                    </span>
                    <span className="mt-1.5 flex h-[14px] items-center gap-1">
                      {item.hazards.slice(0, 3).map((h) => (
                        <HazardIcon key={h} kind={h} />
                      ))}
                    </span>
                    {on && (
                      <motion.span
                        className="ls-card-check"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 500, damping: 20 }}
                        aria-hidden
                      >
                        ✓
                      </motion.span>
                    )}
                  </motion.button>
                  <button
                    className="ls-info-btn"
                    onClick={() => onInfo(item)}
                    aria-label={`About ${item.name}`}
                    title="Properties"
                  >
                    i
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </motion.ul>
        {filtered.length === 0 && (
          <p className="mt-6 text-center text-sm text-white/40">Nothing matches “{query}”.</p>
        )}
      </div>
    </section>
  );
}
