import {
  BohrModel,
  CATEGORIES,
  configText,
  configuration,
  OrbitalFill,
  phaseAt,
  rampColour,
  TRENDS,
  trendRange,
  trendT,
  trendValue,
  type Category,
  type Element,
  type TrendKey,
} from "@labscape/chem-view";
import { useMotion } from "@labscape/motion";
import { Button, Chip, cx, ErrorState, inputClass, Modal, Segmented, Skeleton } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { FlaskConical, Play, Plus, Radiation, Scale, Search, Thermometer, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";

type Mode = "category" | "trend" | "state" | "block";
const BLOCK_COLOUR = { s: "#ff8787", p: "#ffd43b", d: "#4dabf7", f: "#da77f2" } as const;
const PHASE_COLOUR = { solid: "#4dabf7", liquid: "#20c997", gas: "#ff922b", unknown: "#495057" } as const;
const TEMPS: [string, number][] = [
  ["Absolute zero-ish", 10],
  ["Room", 298],
  ["Your hand", 310],
  ["Boiling water", 373],
  ["Bunsen flame", 1773],
  ["Sun's surface", 5778],
];

/** Pastel tile fill: the category/trend colour mixed into white, so dark text reads on every tile. */
const tint = (c: string, pct = 42) => `color-mix(in srgb, ${c} ${pct}%, white)`;
const edge = (c: string) => `color-mix(in srgb, ${c} 70%, #1a1a1a 12%)`;

export default function PeriodicTable() {
  const q = useQuery({ queryKey: ["elements"], queryFn: () => api<{ items: Element[] }>("/v1/elements"), staleTime: Infinity });
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>("category");
  const [trend, setTrend] = useState<TrendKey>("electronegativity");
  const [kelvin, setKelvin] = useState(298);
  const [search, setSearch] = useState("");
  const [focusCat, setFocusCat] = useState<Category | null>(null);
  const [hover, setHover] = useState<Element | null>(null);
  const [compare, setCompare] = useState<number[]>([]);
  const [comparing, setComparing] = useState(false);
  const { reduced } = useMotion();

  const elements = useMemo(() => q.data?.items ?? [], [q.data]);
  const selected = elements.find((e) => e.symbol === params.get("el")) ?? null;
  const select = (e: Element | null) => {
    const next = new URLSearchParams(params);
    if (e) next.set("el", e.symbol);
    else next.delete("el");
    setParams(next, { replace: true });
  };

  const range = useMemo(() => (elements.length ? trendRange(elements, trend) : ([0, 1] as [number, number])), [elements, trend]);
  const matches = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return null;
    return new Set(elements.filter((e) => e.symbol.toLowerCase() === s || e.name.toLowerCase().includes(s) || String(e.z) === s).map((e) => e.z));
  }, [search, elements]);

  const colourOf = (e: Element): string => {
    if (mode === "category") return CATEGORIES[e.category].colour;
    if (mode === "block") return BLOCK_COLOUR[e.block];
    if (mode === "state") return PHASE_COLOUR[phaseAt(e, kelvin)];
    const v = trendValue(e, trend);
    return v === null || v <= 0 ? "#2a3247" : rampColour(TRENDS[trend].ramp, trendT(v, range, TRENDS[trend].log));
  };
  const dimmed = (e: Element) => (matches ? !matches.has(e.z) : focusCat ? e.category !== focusCat : false);

  const grid = useRef<HTMLDivElement>(null);
  const onKey = (ev: KeyboardEvent<HTMLButtonElement>, e: Element) => {
    const d: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    const step = d[ev.key];
    if (!step) return;
    ev.preventDefault();
    let [r, c] = [e.row, e.col];
    for (let i = 0; i < 18; i++) {
      r += step[0];
      c += step[1];
      if (r === 8) r += step[0];
      const hit = elements.find((x) => x.row === r && x.col === c);
      if (hit) {
        grid.current?.querySelector<HTMLButtonElement>(`[data-z="${hit.z}"]`)?.focus();
        return;
      }
      if (r < 1 || r > 10 || c < 1 || c > 18) return;
    }
  };

  const toggleCompare = (z: number) => setCompare((c) => (c.includes(z) ? c.filter((x) => x !== z) : c.length >= 4 ? [...c.slice(1), z] : [...c, z]));
  const preview = hover ?? selected;

  if (q.isError) return <ErrorState title="Couldn't load the periodic table" onRetry={() => void q.refetch()} />;

  return (
    <div className="mx-auto max-w-[1380px] pb-24">
      <PageHeader
        eyebrow="Resources"
        title="Periodic table"
        sub="All 118 elements. Colour them by family, trend, block or state at any temperature, open one to watch its electrons fill, and compare up to four side by side."
        aside={
          <label className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find: Fe, iron or 26" className={cx(inputClass, "pl-10")} aria-label="Find an element" />
          </label>
        }
        className="mb-5"
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented<Mode>
          label="Colour by"
          value={mode}
          onChange={setMode}
          options={[
            { value: "category", label: "Families" },
            { value: "trend", label: "Trends" },
            { value: "state", label: "States" },
            { value: "block", label: "Blocks" },
          ]}
        />
        {mode === "trend" && (
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(TRENDS) as TrendKey[]).map((k) => (
              <button key={k} onClick={() => setTrend(k)} className={cx("rounded-full px-3 py-1.5 text-xs font-medium transition", trend === k ? "bg-ink-strong text-on-ink" : "bg-card text-ink-muted ring-1 ring-inset ring-line hover:text-ink-strong")}>
                {TRENDS[k].label}
              </button>
            ))}
          </div>
        )}
        {mode === "state" && (
          <div className="flex min-w-[280px] flex-1 flex-wrap items-center gap-3">
            <Thermometer className="h-4 w-4 text-[#C2410C]" />
            <input type="range" min={0} max={6000} step={1} value={kelvin} onChange={(e) => setKelvin(Number(e.target.value))} className="h-1 min-w-[160px] flex-1 accent-[#ff922b]" aria-label="Temperature in kelvin" />
            <span className="w-36 font-mono text-sm text-ink-strong">
              {kelvin} K · {Math.round(kelvin - 273.15)} °C
            </span>
            <div className="flex flex-wrap gap-1">
              {TEMPS.map(([label, k]) => (
                <button key={label} onClick={() => setKelvin(k)} className={cx("rounded-full px-2.5 py-1 text-[11px] font-medium transition", kelvin === k ? "bg-[#FDE7D6] text-[#9A3412]" : "bg-card text-ink-muted ring-1 ring-inset ring-line hover:text-ink-strong")}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-panel bg-card p-4 sm:p-6">
        <div className="min-w-[980px]">
          {/* the info strip sits in the empty space above the transition metals, like a printed table's key */}
          <div ref={grid} className="relative grid grid-cols-[repeat(18,minmax(0,1fr))] gap-[5px]" style={{ gridTemplateRows: "repeat(7, minmax(0,1fr)) 14px repeat(2, minmax(0,1fr))" }} role="grid" aria-label="Periodic table">
            {q.isLoading && Array.from({ length: 118 }, (_, i) => <Skeleton key={i} className="aspect-[0.86] rounded-md" />)}
            <div className="pointer-events-none col-start-3 col-end-13 row-start-1 row-end-4 hidden items-start p-2 lg:flex">
              {preview ? <PreviewCard e={preview} colour={colourOf(preview)} mode={mode} trend={trend} kelvin={kelvin} /> : <Legend mode={mode} trend={trend} range={range} onFocus={setFocusCat} focus={focusCat} />}
            </div>
            {[["Lanthanides", 9], ["Actinides", 10]].map(([label, row]) => (
              <div key={label} className="col-span-2 flex items-center justify-end pr-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink-muted" style={{ gridRow: row as number, gridColumn: "1 / span 2" }}>
                {label}
              </div>
            ))}
            {elements.map((e) => {
              const colour = colourOf(e);
              const dim = dimmed(e);
              const v = mode === "trend" ? trendValue(e, trend) : null;
              const isSel = selected?.z === e.z;
              return (
                <button
                  key={e.z}
                  data-z={e.z}
                  role="gridcell"
                  onClick={() => select(e)}
                  onMouseEnter={() => setHover(e)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(e)}
                  onBlur={() => setHover(null)}
                  onKeyDown={(ev) => onKey(ev, e)}
                  aria-label={`${e.name}, ${e.z}`}
                  aria-selected={isSel}
                  className={cx(
                    "group relative aspect-[0.86] rounded-lg p-1 text-left text-[#1a1a1a] outline-none transition-[transform,opacity,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-accent",
                    dim ? "opacity-25" : "hover:z-10 hover:-translate-y-0.5 hover:scale-[1.12] hover:shadow-lift",
                    isSel && "z-10 scale-[1.08] shadow-lift ring-2 ring-ink-strong",
                  )}
                  style={{
                    gridRow: e.row,
                    gridColumn: e.col,
                    background: tint(colour),
                    boxShadow: isSel ? undefined : `inset 0 0 0 1px ${edge(colour)}`,
                  }}
                >
                  <span className="block text-[9px] font-semibold leading-none opacity-60">{e.z}</span>
                  <span className="mt-0.5 block text-center text-[17px] font-bold leading-none">{e.symbol}</span>
                  <span className="mt-0.5 block truncate text-center text-[8.5px] leading-none opacity-70">{mode === "trend" ? (v === null ? "-" : fmt(v, trend)) : e.name}</span>
                  {compare.includes(e.z) && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-[#1a1a1a]" />}
                  {e.experiments.length > 0 && <FlaskConical className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 opacity-50" aria-hidden />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
        <FlaskConical className="h-3 w-3" /> marks elements you can work with in a LABscape experiment. Use the arrow keys to move around the table.
      </p>

      {/* below lg the legend has no space inside the grid */}
      <div className="mt-4 rounded-card bg-card p-3 lg:hidden">
        <Legend mode={mode} trend={trend} range={range} onFocus={setFocusCat} focus={focusCat} />
      </div>

      <AnimatePresence>
        {selected && (
          <Detail
            key={selected.z}
            e={selected}
            colour={CATEGORIES[selected.category].colour}
            onClose={() => select(null)}
            inCompare={compare.includes(selected.z)}
            onCompare={() => toggleCompare(selected.z)}
            reduced={reduced}
            onJump={(sym) => select(elements.find((x) => x.symbol === sym) ?? null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {compare.length > 0 && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} className="fixed bottom-24 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-card p-2 pl-4 text-ink shadow-pop ring-1 ring-inset ring-line lg:bottom-6">
            <Scale className="h-4 w-4 text-link" />
            <span className="mr-1 text-xs font-semibold text-ink-muted">Compare</span>
            {compare.map((z) => {
              const e = elements[z - 1]!;
              return (
                <span key={z} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-bold text-[#1a1a1a]" style={{ background: tint(CATEGORIES[e.category].colour) }}>
                  {e.symbol}
                  <button onClick={() => toggleCompare(z)} aria-label={`Remove ${e.name}`} className="text-[#1a1a1a]/50 hover:text-[#1a1a1a]">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            <Button size="sm" disabled={compare.length < 2} onClick={() => setComparing(true)}>
              {compare.length < 2 ? "Pick another" : `Compare ${compare.length}`}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={comparing} onClose={() => setComparing(false)} title="Compare elements" width={880}>
        <CompareTable items={compare.map((z) => elements[z - 1]!)} />
      </Modal>
    </div>
  );
}

function fmt(v: number, key: TrendKey) {
  if (key === "discovered") return v <= 1600 ? "ancient" : String(v);
  if (key === "density") return v < 0.01 ? v.toExponential(1) : v < 10 ? v.toFixed(2) : v.toFixed(1);
  if (key === "electronegativity") return v.toFixed(2);
  return String(Math.round(v));
}

function Legend({ mode, trend, range, onFocus, focus }: { mode: Mode; trend: TrendKey; range: [number, number]; onFocus: (c: Category | null) => void; focus: Category | null }) {
  if (mode === "trend") {
    const t = TRENDS[trend];
    return (
      <div className="pointer-events-auto w-full max-w-[560px] rounded-[20px] bg-surface p-4">
        <p className="text-sm font-semibold text-ink-strong">
          {t.label} <span className="font-normal text-ink-muted">{t.unit && `(${t.unit})`}</span>
        </p>
        <div className="mt-2 h-2.5 rounded-full" style={{ background: `linear-gradient(90deg, ${t.ramp.join(",")})` }} />
        <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-muted">
          <span>{fmt(range[0], trend)}</span>
          <span>{t.log ? "log scale" : ""}</span>
          <span>{fmt(range[1], trend)}</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink">{t.explain}</p>
      </div>
    );
  }
  if (mode === "state")
    return (
      <div className="pointer-events-auto flex flex-wrap gap-2 rounded-[20px] bg-surface p-4">
        {(Object.keys(PHASE_COLOUR) as (keyof typeof PHASE_COLOUR)[]).map((p) => (
          <span key={p} className="flex items-center gap-1.5 text-xs capitalize text-ink">
            <span className="h-3 w-3 rounded" style={{ background: PHASE_COLOUR[p] }} /> {p === "unknown" ? "Not known" : p}
          </span>
        ))}
        <p className="w-full text-xs text-ink-muted">At 1 atmosphere. Drag the temperature and watch mercury and bromine melt first, tungsten last.</p>
      </div>
    );
  if (mode === "block")
    return (
      <div className="pointer-events-auto rounded-[20px] bg-surface p-4">
        <div className="flex gap-3">
          {(Object.keys(BLOCK_COLOUR) as (keyof typeof BLOCK_COLOUR)[]).map((b) => (
            <span key={b} className="flex items-center gap-1.5 text-xs text-ink">
              <span className="h-3 w-3 rounded" style={{ background: BLOCK_COLOUR[b] }} /> {b}-block
            </span>
          ))}
        </div>
        <p className="mt-2 max-w-md text-xs text-ink-muted">The block is the subshell the last electron goes into. That is why the table has this shape: 2 columns of s, 6 of p, 10 of d and 14 of f.</p>
      </div>
    );
  return (
    <div className="pointer-events-auto flex max-w-[600px] flex-wrap gap-1.5" onMouseLeave={() => onFocus(null)}>
      {(Object.keys(CATEGORIES) as Category[]).map((c) => (
        <button
          key={c}
          onMouseEnter={() => onFocus(c)}
          onFocus={() => onFocus(c)}
          onBlur={() => onFocus(null)}
          onClick={() => onFocus(focus === c ? null : c)}
          className={cx("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-[#1a1a1a] ring-1 ring-inset transition", focus === c ? "ring-ink-strong" : "ring-transparent")}
          style={{ background: tint(CATEGORIES[c].colour, focus === c ? 55 : 30) }}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: CATEGORIES[c].colour }} />
          {CATEGORIES[c].label}
        </button>
      ))}
    </div>
  );
}

function PreviewCard({ e, colour, mode, trend, kelvin }: { e: Element; colour: string; mode: Mode; trend: TrendKey; kelvin: number }) {
  const conf = configuration(e.z);
  const v = trendValue(e, trend);
  return (
    <div className="flex w-full max-w-[600px] items-center gap-4 rounded-[20px] bg-surface p-3">
      <div className="grid h-[86px] w-[78px] shrink-0 place-items-center rounded-[16px] text-[#1a1a1a]" style={{ background: tint(colour, 50), boxShadow: `inset 0 0 0 1px ${edge(colour)}` }}>
        <div className="text-center">
          <div className="text-[10px] opacity-70">{e.z}</div>
          <div className="text-3xl font-bold">{e.symbol}</div>
          <div className="text-[10px] opacity-70">{e.mass.toFixed(e.mass > 200 ? 0 : 2)}</div>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-lg font-medium text-ink-strong">{e.name}</p>
        <p className="text-xs text-ink-muted">
          {CATEGORIES[e.category].label} · period {e.period}
          {e.group ? ` · group ${e.group}` : ""} · {e.block}-block
        </p>
        <p className="mt-1 font-mono text-xs text-link">{configText(conf)}</p>
        <p className="mt-1 text-xs text-ink">
          {mode === "trend" ? `${TRENDS[trend].label}: ${v === null ? "not known" : `${fmt(v, trend)} ${TRENDS[trend].unit}`}` : mode === "state" ? `At ${kelvin} K: ${phaseAt(e, kelvin)}` : e.fact}
        </p>
      </div>
    </div>
  );
}

function Detail({ e, colour, onClose, inCompare, onCompare, reduced, onJump }: { e: Element; colour: string; onClose: () => void; inCompare: boolean; onCompare: () => void; reduced: boolean; onJump: (s: string) => void }) {
  useEffect(() => {
    const k = (ev: globalThis.KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const props: [string, string | null][] = [
    ["Atomic mass", `${e.mass} u`],
    ["Electronegativity", e.electronegativity != null ? e.electronegativity.toFixed(2) : null],
    ["Atomic radius", e.radiusPm != null ? `${e.radiusPm} pm` : null],
    ["1st ionisation energy", e.ionisationKjMol != null ? `${e.ionisationKjMol} kJ/mol` : null],
    ["Electron affinity", e.electronAffinityKjMol != null ? `${e.electronAffinityKjMol} kJ/mol` : null],
    ["Melting point", e.meltingK != null ? `${e.meltingK} K (${Math.round(e.meltingK - 273.15)} °C)` : null],
    ["Boiling point", e.boilingK != null ? `${e.boilingK} K (${Math.round(e.boilingK - 273.15)} °C)` : null],
    ["Density", e.density != null ? `${e.density < 0.01 ? e.density.toExponential(2) : e.density} g/cm³` : null],
    ["State at 25 °C", e.state],
    ["Discovered", e.discovered === 0 ? "Known since antiquity" : e.discovered != null ? String(e.discovered) : null],
  ];
  const neighbours = [e.z - 1, e.z + 1].filter((z) => z >= 1 && z <= 118);
  return (
    <>
      <motion.div className="fixed inset-0 z-40 bg-[#1a1a1a]/30 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside
        role="dialog"
        aria-label={e.name}
        className="fixed bottom-0 right-0 top-0 z-50 w-full max-w-[460px] overflow-y-auto bg-card text-ink shadow-pop sm:rounded-l-[28px]"
        initial={reduced ? { opacity: 0 } : { x: 480 }}
        animate={reduced ? { opacity: 1 } : { x: 0 }}
        exit={reduced ? { opacity: 0 } : { x: 480 }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
      >
        <div className="relative p-6" style={{ background: `radial-gradient(420px 260px at 80% 0%, ${tint(colour, 35)}, transparent 70%)` }}>
          <button onClick={onClose} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-ink-muted hover:bg-ink/[0.06] hover:text-ink-strong" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-4">
            <div className="grid h-24 w-[84px] shrink-0 place-items-center rounded-[18px] text-[#1a1a1a]" style={{ background: tint(colour, 50), boxShadow: `inset 0 0 0 1px ${edge(colour)}` }}>
              <div className="text-center">
                <div className="text-xs opacity-70">{e.z}</div>
                <div className="text-4xl font-bold">{e.symbol}</div>
              </div>
            </div>
            <div>
              <h2 className="font-heading text-[28px] font-normal tracking-[-0.02em] text-ink-strong">{e.name}</h2>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Chip>{CATEGORIES[e.category].label}</Chip>
                {e.radioactive && (
                  <Chip tone="gold">
                    <Radiation className="h-3 w-3" /> Radioactive
                  </Chip>
                )}
                {e.synthetic && <Chip>Made in labs</Chip>}
              </div>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-ink">{e.fact}</p>
        </div>

        <div className="space-y-6 px-6 pb-8">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Bohr model</h3>
            <div className="flex items-center gap-4">
              <BohrModel z={e.z} symbol={e.symbol} colour={colour} size={170} animate={!reduced} />
              <div className="text-sm text-ink">
                <p>
                  <b className="text-ink-strong">{configuration(e.z).shells.join(", ")}</b> electrons per shell.
                </p>
                <p className="mt-1 text-xs text-ink-muted">The outermost shell holds the electrons that take part in reactions.</p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Electron filling (Aufbau)</h3>
            <OrbitalFill z={e.z} reducedMotion={reduced} />
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Properties</h3>
            <dl className="grid grid-cols-2 gap-2">
              {props.map(([k, v]) => (
                <div key={k} className="rounded-[14px] bg-surface p-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{k}</dt>
                  <dd className="mt-0.5 text-sm font-semibold capitalize text-ink-strong">{v ?? <span className="font-normal normal-case text-ink-muted">Not known</span>}</dd>
                </div>
              ))}
            </dl>
            {e.oxidationStates.length > 0 && (
              <p className="mt-3 text-xs text-ink-muted">
                Common oxidation states:{" "}
                {e.oxidationStates.map((o, i) => (
                  <b key={i} className={cx("ml-1 font-mono", i === 0 ? "text-ink-strong" : "text-ink")}>
                    {o > 0 ? `+${o}` : o}
                  </b>
                ))}
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">In the lab</h3>
            {e.experiments.length ? (
              <ul className="space-y-1.5">
                {e.experiments.map((x) => (
                  <li key={x.slug}>
                    <Link to={x.playable ? `/lab/${x.subject}/${x.slug}` : `/library/${x.slug}`} className="flex items-center justify-between rounded-[14px] bg-surface px-3 py-2.5 text-sm text-ink-strong transition hover:bg-line">
                      <span className="flex items-center gap-2">
                        <FlaskConical className="h-4 w-4 text-[#0F766E]" />
                        {x.title}
                      </span>
                      {x.playable ? (
                        <span className="flex items-center gap-1 text-xs font-semibold text-link">
                          <Play className="h-3 w-3" /> Play
                        </span>
                      ) : (
                        <span className="text-xs text-ink-muted">Coming</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">No LABscape experiment uses {e.name} yet.</p>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            <Button variant={inCompare ? "secondary" : "primary"} size="sm" icon={inCompare ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />} onClick={onCompare}>
              {inCompare ? "Remove from compare" : "Add to compare"}
            </Button>
            {neighbours.map((z) => (
              <Button key={z} variant="ghost" size="sm" onClick={() => onJump(symbolOf(z))}>
                {z < e.z ? "←" : "→"} Element {z}
              </Button>
            ))}
          </div>
        </div>
      </motion.aside>
    </>
  );
}

// Symbols by atomic number for neighbour navigation without a lookup prop.
const SYMBOLS = "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(" ");
const symbolOf = (z: number) => SYMBOLS[z - 1]!;

function CompareTable({ items }: { items: Element[] }) {
  const rows: { key: TrendKey; label: string }[] = [
    { key: "mass", label: "Atomic mass (u)" },
    { key: "electronegativity", label: "Electronegativity" },
    { key: "radiusPm", label: "Atomic radius (pm)" },
    { key: "ionisationKjMol", label: "1st ionisation energy (kJ/mol)" },
    { key: "electronAffinityKjMol", label: "Electron affinity (kJ/mol)" },
    { key: "meltingK", label: "Melting point (K)" },
    { key: "density", label: "Density (g/cm³)" },
  ];
  return (
    <div className="overflow-x-auto p-5">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="w-48" />
            {items.map((e) => (
              <th key={e.z} className="px-2 pb-3 text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-[14px] text-2xl font-bold text-[#1a1a1a]" style={{ background: tint(CATEGORIES[e.category].colour, 50), boxShadow: `inset 0 0 0 1px ${edge(CATEGORIES[e.category].colour)}` }}>
                  {e.symbol}
                </div>
                <div className="mt-1 text-xs font-medium text-ink">{e.name}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-line">
            <td className="py-2 pr-3 text-xs text-ink-muted">Configuration</td>
            {items.map((e) => (
              <td key={e.z} className="px-2 py-2 text-center font-mono text-xs text-link">
                {configText(configuration(e.z))}
              </td>
            ))}
          </tr>
          {rows.map((r) => {
            const vals = items.map((e) => trendValue(e, r.key));
            const max = Math.max(...vals.map((v) => v ?? 0));
            return (
              <tr key={r.key} className="border-t border-line">
                <td className="py-2 pr-3 text-xs text-ink-muted">{r.label}</td>
                {items.map((e, i) => {
                  const v = vals[i];
                  return (
                    <td key={e.z} className="px-2 py-2">
                      <div className="text-center font-semibold text-ink-strong">{v == null ? "-" : fmt(v, r.key)}</div>
                      <div className="mt-1 h-1.5 rounded-full bg-ink/10">
                        <div className="h-full rounded-full" style={{ width: `${v && max ? (v / max) * 100 : 0}%`, background: CATEGORIES[e.category].colour }} />
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
