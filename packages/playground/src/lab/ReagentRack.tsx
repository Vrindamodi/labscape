import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { Formula, HazardIcon, ReagentArt } from "../components/bits";
import type { ShelfItem } from "../types";
import { CATEGORY_COLOURS, CATEGORY_LABELS, tablePosition } from "../types";

type Props = {
  items: ShelfItem[];
  inHand: string | null;
  highlightId: string | null;
  onPick: (item: ShelfItem) => void;
  onInfo: (item: ShelfItem) => void;
  tab: "elements" | "chemicals";
  onTab: (t: "elements" | "chemicals") => void;
};

const CHEM_GROUPS: { id: string; label: string; match: (i: ShelfItem) => boolean }[] = [
  { id: "acid", label: "Acids", match: (i) => i.category === "acid" },
  { id: "alkali", label: "Alkalis", match: (i) => i.category === "alkali" },
  { id: "salt", label: "Salts", match: (i) => i.category === "salt" },
  {
    id: "metal",
    label: "Metals & solids",
    match: (i) => i.category === "metal" || i.category === "solid",
  },
  { id: "indicator", label: "Indicators", match: (i) => i.category === "indicator" },
  {
    id: "other",
    label: "Other",
    match: (i) => ["other", "solvent", "household"].includes(i.category),
  },
];

export function ReagentRack({ items, inHand, highlightId, onPick, onInfo, tab, onTab }: Props) {
  const [hover, setHover] = useState<ShelfItem | null>(null);
  const [query, setQuery] = useState("");
  const elements = useMemo(
    () => items.filter((i) => i.element).sort((a, b) => (a.element?.z ?? 0) - (b.element?.z ?? 0)),
    [items],
  );
  const chemicals = useMemo(() => items.filter((i) => !i.element), [items]);
  const q = query.trim().toLowerCase();
  const matches = (i: ShelfItem) =>
    !q ||
    i.name.toLowerCase().includes(q) ||
    i.formula.toLowerCase().includes(q) ||
    i.element?.symbol.toLowerCase() === q;

  return (
    <section className="lab-card flex h-full min-h-0 flex-col" aria-label="Reagents">
      <div className="flex items-center gap-1 p-2">
        {(["elements", "chemicals"] as const).map((t) => (
          <button
            key={t}
            className={`lab-tab ${tab === t ? "lab-tab-on" : ""}`}
            onClick={() => onTab(t)}
          >
            {t === "elements" ? "⚛ Periodic table" : "🧪 Chemicals"}
          </button>
        ))}
      </div>
      <div className="px-3">
        <input
          className="lab-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === "elements" ? "Search: Na, sodium…" : "Search: acid, CuSO4…"}
          aria-label="Search reagents"
        />
      </div>

      {tab === "elements" ? (
        <div className="lab-scroll min-h-0 flex-1 overflow-auto p-3">
          <div className="lab-ptable" role="grid" aria-label="Periodic table">
            {elements.map((el) => {
              const e = el.element;
              if (!e) return null;
              const { row, col } = tablePosition(e.z);
              const dim = !matches(el);
              const on = inHand === el.id;
              return (
                <motion.button
                  key={el.id}
                  className={`lab-el ${on ? "lab-el-on" : ""} ${highlightId === el.id ? "lab-el-glow" : ""}`}
                  style={{
                    gridRow: row + (row >= 9 ? 1 : 0),
                    gridColumn: col,
                    background: CATEGORY_COLOURS[e.category] ?? "#ddd",
                    opacity: dim ? 0.18 : e.superheavy ? 0.55 : 1,
                  }}
                  whileHover={{ scale: 1.35, zIndex: 5 }}
                  whileTap={{ scale: 1.1 }}
                  onMouseEnter={() => setHover(el)}
                  onFocus={() => setHover(el)}
                  onClick={() => onPick(el)}
                  aria-label={`${el.name}, ${e.z}`}
                >
                  <span className="lab-el-z">{e.z}</span>
                  <span className="lab-el-sym">{e.symbol}</span>
                  {e.radioactive && <span className="lab-el-rad">☢</span>}
                </motion.button>
              );
            })}
            <div className="lab-el-gap" style={{ gridRow: 9, gridColumn: "3 / span 16" }} />
          </div>
          <ElementCard item={hover} onInfo={onInfo} onPick={onPick} />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
              <span key={k} className="lab-legend">
                <i style={{ background: CATEGORY_COLOURS[k] }} />
                {label}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="lab-scroll min-h-0 flex-1 overflow-y-auto p-3">
          {CHEM_GROUPS.map((g) => {
            const list = chemicals.filter((i) => g.match(i) && matches(i));
            if (list.length === 0) return null;
            return (
              <div key={g.id} className="mb-3">
                <div className="lab-eyebrow mb-1.5">{g.label}</div>
                <div className="grid grid-cols-3 gap-2">
                  {list.map((item) => (
                    <motion.button
                      key={item.id}
                      className={`lab-bottle ${inHand === item.id ? "lab-bottle-on" : ""} ${highlightId === item.id ? "lab-el-glow" : ""}`}
                      style={{ ["--swatch" as string]: item.colour }}
                      whileHover={{ y: -4, rotate: -2 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => onPick(item)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onInfo(item);
                      }}
                      title={`${item.name} - click to pick up, right-click for details`}
                    >
                      <ReagentArt item={item} size={40} />
                      <span className="lab-bottle-name">{item.name}</span>
                      <Formula value={item.formula} className="lab-formula" />
                    </motion.button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ElementCard({
  item,
  onInfo,
  onPick,
}: {
  item: ShelfItem | null;
  onInfo: (i: ShelfItem) => void;
  onPick: (i: ShelfItem) => void;
}) {
  if (!item?.element) {
    return (
      <div className="lab-elcard lab-elcard-empty">
        Hover an element to see it - click to pick it up.
      </div>
    );
  }
  const e = item.element;
  const state = e.state === "g" ? "Gas" : e.state === "l" ? "Liquid" : "Solid";
  return (
    <motion.div
      key={item.id}
      className="lab-elcard"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="lab-elcard-tile" style={{ background: CATEGORY_COLOURS[e.category] }}>
        <span className="text-[10px]">{e.z}</span>
        <span className="text-2xl font-bold">{e.symbol}</span>
        <span className="text-[9px]">{e.atomicMass.toFixed(2)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <b className="text-[15px]">{item.name}</b>
          {item.hazards.slice(0, 3).map((h) => (
            <HazardIcon key={h} kind={h} />
          ))}
        </div>
        <div className="text-[11.5px] text-slate-500">
          {CATEGORY_LABELS[e.category]} · {state} at room temp
          {e.radioactive ? " · radioactive" : ""}
        </div>
        <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-slate-600">
          {item.description}
        </p>
        <div className="mt-1.5 flex gap-1.5">
          <button className="lab-mini" onClick={() => onPick(item)}>
            Pick up
          </button>
          <button className="lab-mini lab-mini-ghost" onClick={() => onInfo(item)}>
            Details
          </button>
        </div>
      </div>
    </motion.div>
  );
}
