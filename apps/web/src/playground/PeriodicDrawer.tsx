import { Glass, Kicker, PrimaryButton, Segmented } from "@labscape/lab-engine";
import { CATEGORY_COLOURS, CATEGORY_LABELS, tablePosition, type ShelfItem } from "@labscape/playground";
import { cx } from "@labscape/ui";
import { Hand, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

type Mode = "family" | "state" | "reactivity" | "en" | "radio";
const STATE_COL: Record<string, string> = { s: "#64748b", l: "#3b82f6", g: "#22d3ee" };
const STATE_NAME: Record<string, string> = { s: "Solid", l: "Liquid", g: "Gas" };
const EN_STOPS = ["#1d3a8a", "#2f7cff", "#39d6ff", "#3de8a8", "#ffd23f", "#ff7a3d", "#ff3d6b"];

function lerpStops(t: number) {
  const x = Math.max(0, Math.min(1, t)) * (EN_STOPS.length - 1);
  const i = Math.min(EN_STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const a = EN_STOPS[i]!, b = EN_STOPS[i + 1]!;
  const ch = (h: string, k: number) => parseInt(h.slice(1 + k * 2, 3 + k * 2), 16);
  const mix = [0, 1, 2].map((k) => Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * f).toString(16).padStart(2, "0"));
  return `#${mix.join("")}`;
}

/** Rough reactivity score 0..1 for the heatmap (group trends, not a measured quantity). */
function reactivity(e: NonNullable<ShelfItem["element"]>): number {
  const { row } = tablePosition(e.z);
  if (e.category === "alkali") return 0.6 + row * 0.06;
  if (e.category === "alkaline-earth") return 0.35 + row * 0.05;
  if (e.category === "halogen") return 1 - row * 0.12;
  if (e.category === "noble") return 0.02;
  if (e.category === "transition") return 0.2;
  if (e.category === "nonmetal") return e.symbol === "O" ? 0.75 : e.symbol === "N" ? 0.3 : 0.4;
  return 0.25;
}

function tileColour(it: ShelfItem, mode: Mode): string | null {
  const e = it.element!;
  if (mode === "family") return CATEGORY_COLOURS[e.category] ?? "#64748b";
  if (mode === "state") return STATE_COL[e.state] ?? null;
  if (mode === "reactivity") return lerpStops(reactivity(e));
  if (mode === "radio") return e.radioactive ? "#facc15" : null;
  return e.electronegativity == null ? null : lerpStops((e.electronegativity - 0.7) / 3.3);
}

/**
 * The periodic table drawer (v3 frame 3): soft tiles with live trend heatmaps, pick two to compare,
 * see the bond a mix would likely make, and hold either straight over the beaker.
 */
export function PeriodicDrawer({ elements, onHold, onClose }: { elements: ShelfItem[]; onHold: (it: ShelfItem) => void; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("en");
  const [sel, setSel] = useState<string[]>(["el-Na", "el-Cl"]);
  const [q, setQ] = useState("");
  const byZ = useMemo(() => new Map(elements.map((e) => [e.element!.z, e])), [elements]);
  const pick = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)));
  const chosen = sel.map((id) => elements.find((e) => e.id === id)).filter((x): x is ShelfItem => !!x);
  const match = q.trim().toLowerCase();
  const [a, b] = chosen;
  const gap = a?.element?.electronegativity != null && b?.element?.electronegativity != null ? Math.abs(a.element.electronegativity - b.element.electronegativity) : null;
  const bond = gap == null ? null : gap > 1.7 ? "ionic" : gap > 0.4 ? "polar covalent" : "covalent";

  return (
    <Glass className="absolute bottom-[92px] left-2 right-2 top-[76px] z-30 flex flex-col p-4 sm:left-4 sm:right-4 lg:bottom-[96px] lg:top-[84px] lg:right-[328px] xl:right-[372px]" role="dialog" aria-label="Periodic table">
      <div className="flex flex-wrap items-center gap-3">
        <b className="font-heading text-[22px]">Periodic table</b>
        <div className="min-w-[340px]">
          <Segmented<Mode>
            value={mode}
            label="Colour by"
            size="sm"
            onChange={setMode}
            options={[
              { id: "family", label: "Families" },
              { id: "state", label: "State" },
              { id: "reactivity", label: "Reactivity" },
              { id: "en", label: "Electronegativity" },
              { id: "radio", label: "Radioactive" },
            ]}
          />
        </div>
        <label className="flex h-8 items-center gap-2 rounded-[10px] border border-[rgba(140,180,255,.14)] bg-[rgba(4,10,28,.55)] px-2.5 text-[13px] text-[#8fa6d1]">
          <Search className="h-4 w-4" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search element" className="w-28 bg-transparent text-white placeholder:text-[#8fa6d1] focus:outline-none" aria-label="Search element" />
        </label>
        <span className="flex-1" />
        <button onClick={onClose} className="rounded-lg p-1.5 text-[#8fa6d1] hover:bg-white/[0.06] hover:text-white" aria-label="Close periodic table">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-3 grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_300px]">
        <div className="min-h-0 overflow-auto">
          <div className="grid min-w-[760px] gap-[3px]" style={{ gridTemplateColumns: "repeat(18, minmax(0, 1fr))", gridTemplateRows: "repeat(7, 46px) 10px repeat(2, 46px)" }}>
            {Array.from({ length: 118 }, (_, i) => i + 1).map((z) => {
              const it = byZ.get(z);
              const { row, col } = tablePosition(z);
              if (!it) return <div key={z} style={{ gridRow: row, gridColumn: col }} />;
              const e = it.element!;
              const c = tileColour(it, mode);
              const on = sel.includes(it.id);
              const dim = match && !(e.symbol.toLowerCase().startsWith(match) || it.name.toLowerCase().includes(match));
              const val = mode === "en" ? (e.electronegativity?.toFixed(2) ?? "—") : mode === "state" ? STATE_NAME[e.state] : mode === "radio" ? (e.radioactive ? "☢" : "") : "";
              return (
                <button
                  key={z}
                  onClick={() => pick(it.id)}
                  aria-pressed={on}
                  aria-label={`${it.name}, ${z}`}
                  className={cx("relative overflow-hidden rounded-[8px] border px-1 py-0.5 text-left transition", on ? "z-10 outline outline-2 outline-white" : "border-[rgba(140,180,255,.12)] hover:border-white/40", dim && "opacity-25")}
                  style={{ gridRow: row, gridColumn: col, background: c ? `${c}cc` : "rgba(120,160,255,.07)", boxShadow: on && c ? `0 0 22px 2px ${c}` : undefined }}
                >
                  <div className="font-mono text-[9px] leading-none text-white/75">{z}</div>
                  <div className="font-heading text-[15px] font-bold leading-tight text-white">{e.symbol}</div>
                  <div className="truncate font-mono text-[8.5px] leading-none text-white/80">{val}</div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] font-semibold text-[#8fa6d1]">
            {mode === "family" ? (
              Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1.5">
                  <i className="h-3 w-3 rounded-sm" style={{ background: CATEGORY_COLOURS[k] }} />
                  {v}
                </span>
              ))
            ) : mode === "state" ? (
              Object.entries(STATE_NAME).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1.5">
                  <i className="h-3 w-3 rounded-sm" style={{ background: STATE_COL[k] }} />
                  {v} at room temperature
                </span>
              ))
            ) : mode === "radio" ? (
              <span>Yellow: radioactive. Handle only in a simulator.</span>
            ) : (
              <>
                <span>{mode === "en" ? "0.7" : "calm"}</span>
                <i className="h-2.5 w-[260px] rounded-full" style={{ background: `linear-gradient(90deg, ${EN_STOPS.join(",")})` }} />
                <span>{mode === "en" ? "4.0 · Pauling electronegativity · grey = not measured" : "very reactive"}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <div className="rounded-[16px] border border-[rgba(140,180,255,.14)] bg-[rgba(4,10,28,.55)] p-3.5">
            <div className="flex items-center justify-between">
              <Kicker>Compare</Kicker>
              <span className="text-[11px] font-semibold text-[#8fa6d1]">{chosen.length} selected</span>
            </div>
            {chosen.length === 0 && <p className="mt-2 text-[13px] text-[#8fa6d1]">Click two elements to compare them.</p>}
            <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              {[a, b].map((it, i) =>
                it ? (
                  <div key={it.id} className="h-[104px] rounded-[14px] p-2.5" style={{ background: `${CATEGORY_COLOURS[it.element!.category] ?? "#64748b"}cc`, gridColumn: i === 0 ? 1 : 3 }}>
                    <div className="font-mono text-[11px] opacity-85">{it.element!.z}</div>
                    <div className="font-heading text-[36px] font-bold leading-none">{it.element!.symbol}</div>
                    <div className="mt-1 truncate text-[12px] font-semibold">{it.name}</div>
                  </div>
                ) : (
                  <div key={i} className="grid h-[104px] place-items-center rounded-[14px] border border-dashed border-white/15 text-[12px] text-[#8fa6d1]" style={{ gridColumn: i === 0 ? 1 : 3 }}>
                    pick one
                  </div>
                ),
              )}
              <span className="font-heading text-[13px] font-bold text-[#8fa6d1]" style={{ gridColumn: 2, gridRow: 1 }}>
                vs
              </span>
            </div>
            {a && b && (
              <div className="mt-2.5 space-y-1.5 text-[13px] font-semibold">
                {[
                  ["Electroneg.", a.element!.electronegativity?.toFixed(2) ?? "—", b.element!.electronegativity?.toFixed(2) ?? "—"],
                  ["State", STATE_NAME[a.element!.state], STATE_NAME[b.element!.state]],
                  ["Atomic mass", a.element!.atomicMass.toFixed(1), b.element!.atomicMass.toFixed(1)],
                  ["Family", CATEGORY_LABELS[a.element!.category]?.replace(/s$/, "") ?? a.element!.category, CATEGORY_LABELS[b.element!.category]?.replace(/s$/, "") ?? b.element!.category],
                ].map(([k, x, y]) => (
                  <div key={k} className="grid grid-cols-[1fr_92px_1fr] items-center gap-1.5">
                    <span className="truncate text-right">{x}</span>
                    <span className="text-center text-[11.5px] text-[#8fa6d1]">{k}</span>
                    <span className="truncate">{y}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {a && b && bond && (
            <div className="rounded-[16px] border border-[rgba(255,140,100,.35)] bg-[linear-gradient(135deg,rgba(255,90,120,.18),rgba(255,194,61,.10))] p-3.5">
              <Kicker>Predicted if they meet</Kicker>
              <p className="mt-1 text-[13px] leading-relaxed">
                Electronegativity gap <b>{gap!.toFixed(2)}</b> → a <b>{bond}</b> bond.{" "}
                {bond === "ionic" ? "One atom hands electrons to the other, making charged ions that pack into a crystal like table salt." : bond === "polar covalent" ? "They share electrons unevenly, so one end of the bond is slightly negative." : "They share electrons almost equally."}
              </p>
              <p className="mt-1.5 text-[12px] text-[#c8d6f3]">The safety engine decides what really happens when you add them to the beaker.</p>
            </div>
          )}
          {chosen.map((it) => (
            <PrimaryButton key={it.id} onClick={() => onHold(it)}>
              <Hand className="h-4 w-4" /> Hold {it.name}
            </PrimaryButton>
          ))}
        </div>
      </div>
    </Glass>
  );
}
