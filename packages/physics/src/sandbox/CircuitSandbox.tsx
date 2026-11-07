import { RotateCw, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { BAND_HEX, colourBands, solve, type Component, type ComponentKind, type Wire } from "../core/circuit";
import { Btn, Panel, ParamSlider, Readout, sf } from "../ui/kit";

/** A part on the free board. Terminals are "<id>.a" and "<id>.b" (a = + for batteries, anode for LEDs). */
export type BoardPart = { id: string; kind: Exclude<ComponentKind, "wire" | "cell" | "rheostat">; x: number; y: number; vertical?: boolean; value?: number; closed?: boolean; blown?: boolean };
export type CircuitBuild = { parts: BoardPart[]; wires: Wire[] };

const W = 960, H = 560, GRID = 20, HALF = 40;
const SPEC: Record<BoardPart["kind"], { label: string; prefix: string; value?: { min: number; max: number; step: number; unit: string; def: number; name: string } }> = {
  battery: { label: "Battery", prefix: "B", value: { min: 1.5, max: 12, step: 0.5, unit: "V", def: 6, name: "Voltage" } },
  bulb: { label: "Bulb", prefix: "L", value: { min: 2, max: 60, step: 1, unit: "Ω", def: 12, name: "Resistance" } },
  resistor: { label: "Resistor", prefix: "R", value: { min: 1, max: 220, step: 1, unit: "Ω", def: 10, name: "Resistance" } },
  switch: { label: "Switch", prefix: "S" },
  ammeter: { label: "Ammeter", prefix: "A" },
  voltmeter: { label: "Voltmeter", prefix: "V" },
  led: { label: "LED", prefix: "D" },
  fuse: { label: "Fuse", prefix: "F", value: { min: 0.1, max: 5, step: 0.1, unit: "A", def: 1, name: "Rating" } },
};
/** Nominal power that makes a bulb glow fully, W. */
const BULB_FULL_W = 3;

export const CIRCUIT_EXAMPLES: Record<string, { label: string; build: CircuitBuild }> = {
  loop: {
    label: "Simple loop",
    build: {
      parts: [
        { id: "B1", kind: "battery", x: 200, y: 420, value: 6 },
        { id: "S1", kind: "switch", x: 200, y: 160, closed: true },
        { id: "L1", kind: "bulb", x: 520, y: 160, value: 12 },
        { id: "A1", kind: "ammeter", x: 520, y: 420 },
      ],
      wires: [["B1.a", "A1.b"], ["A1.a", "L1.a"], ["L1.b", "S1.a"], ["S1.b", "B1.b"]],
    },
  },
  series: {
    label: "Two bulbs in series",
    build: {
      parts: [
        { id: "B1", kind: "battery", x: 200, y: 420, value: 6 },
        { id: "L1", kind: "bulb", x: 360, y: 160, value: 12 },
        { id: "L2", kind: "bulb", x: 600, y: 160, value: 12 },
      ],
      wires: [["B1.a", "L2.a"], ["L2.b", "L1.a"], ["L1.b", "B1.b"]],
    },
  },
  parallel: {
    label: "Two bulbs in parallel",
    build: {
      parts: [
        { id: "B1", kind: "battery", x: 200, y: 420, value: 6 },
        { id: "L1", kind: "bulb", x: 440, y: 280, value: 12, vertical: true },
        { id: "L2", kind: "bulb", x: 640, y: 280, value: 12, vertical: true },
      ],
      wires: [["B1.a", "L1.b"], ["L1.b", "L2.b"], ["B1.b", "L1.a"], ["L1.a", "L2.a"]],
    },
  },
  ohm: {
    label: "Ohm's law set-up",
    build: {
      parts: [
        { id: "B1", kind: "battery", x: 180, y: 420, value: 3 },
        { id: "R1", kind: "resistor", x: 480, y: 160, value: 10 },
        { id: "A1", kind: "ammeter", x: 480, y: 420 },
        { id: "V1", kind: "voltmeter", x: 480, y: 60 },
      ],
      wires: [["B1.a", "A1.b"], ["A1.a", "R1.a"], ["R1.b", "B1.b"], ["V1.a", "R1.a"], ["V1.b", "R1.b"]],
    },
  },
};

export function terminalsOf(p: BoardPart): Record<string, { x: number; y: number }> {
  return p.vertical
    ? { [`${p.id}.a`]: { x: p.x, y: p.y + HALF }, [`${p.id}.b`]: { x: p.x, y: p.y - HALF } }
    : { [`${p.id}.a`]: { x: p.x + HALF, y: p.y }, [`${p.id}.b`]: { x: p.x - HALF, y: p.y } };
}

export const toComponents = (parts: BoardPart[]): Component[] =>
  parts.map((p) => ({ id: p.id, kind: p.kind, ...(p.value !== undefined ? { value: p.value } : {}), ...(p.kind === "battery" ? { internal: 0.2 } : {}), ...(p.kind === "switch" ? { closed: !!p.closed } : {}), ...(p.blown ? { blown: true } : {}) }));

const snap = (v: number) => Math.round(v / GRID) * GRID;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Free circuit builder (build plan 4.9): drop parts, wire terminal to terminal, and the same
 * nodal-analysis solver the experiments use answers instantly. Shorts, blown fuses, ammeters
 * across a part and voltmeters in series all behave as they would on a real bench.
 */
export function CircuitSandbox({ initial, onChange }: { initial?: CircuitBuild | null; onChange?: (b: CircuitBuild) => void }) {
  const [build, setBuild] = useState<CircuitBuild>(() => initial ?? CIRCUIT_EXAMPLES.loop!.build);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const update = useCallback((f: (b: CircuitBuild) => CircuitBuild) => setBuild((b) => f(b)), []);
  useEffect(() => onChangeRef.current?.(build), [build]);

  const result = useMemo(() => solve(toComponents(build.parts), build.wires), [build]);
  // Fuses that blow stay blown until reset.
  useEffect(() => {
    const newly = result.blownFuses.filter((id) => build.parts.some((p) => p.id === id && !p.blown));
    if (newly.length) update((b) => ({ ...b, parts: b.parts.map((p) => (newly.includes(p.id) ? { ...p, blown: true } : p)) }));
  }, [result.blownFuses, build.parts, update]);

  const term = useMemo(() => Object.assign({}, ...build.parts.map(terminalsOf)) as Record<string, { x: number; y: number }>, [build.parts]);
  const sourceI = build.parts.filter((p) => p.kind === "battery").reduce((m, p) => Math.max(m, Math.abs(result.components[p.id]?.current ?? 0)), 0);
  const live = sourceI > 1e-4;
  const shorted = result.shorted.length > 0;
  const sel = build.parts.find((p) => p.id === selected) ?? null;

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const add = (kind: BoardPart["kind"]) => {
    const spec = SPEC[kind];
    const n = build.parts.filter((p) => p.kind === kind).length + 1;
    let id = `${spec.prefix}${n}`;
    let k = n;
    while (build.parts.some((p) => p.id === id)) id = `${spec.prefix}${++k}`;
    // First free grid slot along the top rows.
    let x = 120, y = 80;
    for (let tries = 0; tries < 60 && build.parts.some((p) => Math.abs(p.x - x) < 120 && Math.abs(p.y - y) < 80); tries++) {
      x += 140;
      if (x > W - 100) {
        x = 120;
        y += 120;
      }
    }
    const part: BoardPart = { id, kind, x, y, ...(spec.value ? { value: spec.value.def } : {}), ...(kind === "switch" ? { closed: false } : {}) };
    update((b) => ({ ...b, parts: [...b.parts, part] }));
    setSelected(id);
  };
  const patch = (id: string, p: Partial<BoardPart>) => update((b) => ({ ...b, parts: b.parts.map((q) => (q.id === id ? { ...q, ...p } : q)) }));
  const remove = (id: string) => {
    update((b) => ({ parts: b.parts.filter((p) => p.id !== id), wires: b.wires.filter(([a, c]) => !a.startsWith(`${id}.`) && !c.startsWith(`${id}.`)) }));
    setSelected(null);
  };
  const clickTerminal = (t: string) => {
    if (!pending) return setPending(t);
    if (pending === t || pending.split(".")[0] === t.split(".")[0]) return setPending(null);
    const [a, b] = [pending, t];
    update((bd) => (bd.wires.some(([x, y]) => (x === a && y === b) || (x === b && y === a)) ? bd : { ...bd, wires: [...bd.wires, [a, b]] }));
    setPending(null);
  };
  const removeWire = (i: number) => update((b) => ({ ...b, wires: b.wires.filter((_, j) => j !== i) }));

  const onPartDown = (e: PointerEvent, p: BoardPart) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const q = toSvg(e);
    drag.current = { id: p.id, dx: q.x - p.x, dy: q.y - p.y, moved: false };
    setSelected(p.id);
  };
  const onMove = (e: PointerEvent) => {
    const q = toSvg(e);
    if (pending) setPointer(q);
    const d = drag.current;
    if (!d) return;
    const x = clamp(snap(q.x - d.dx), 60, W - 60), y = clamp(snap(q.y - d.dy), 50, H - 50);
    const p = build.parts.find((pp) => pp.id === d.id);
    if (p && (p.x !== x || p.y !== y)) {
      d.moved = true;
      patch(d.id, { x, y });
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    // A tap on a switch toggles it.
    if (d && !d.moved) {
      const p = build.parts.find((pp) => pp.id === d.id);
      if (p?.kind === "switch") patch(p.id, { closed: !p.closed });
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") return setPending(null), setSelected(null);
    if (!sel) return;
    const step = e.shiftKey ? GRID * 5 : GRID;
    const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (mv[e.key]) {
      e.preventDefault();
      patch(sel.id, { x: clamp(sel.x + mv[e.key]![0], 60, W - 60), y: clamp(sel.y + mv[e.key]![1], 50, H - 50) });
    } else if (e.key === "Delete" || e.key === "Backspace") remove(sel.id);
    else if (e.key === "r") patch(sel.id, { vertical: !sel.vertical });
    else if (e.key === " " && sel.kind === "switch") {
      e.preventDefault();
      patch(sel.id, { closed: !sel.closed });
    }
  };

  const reading = (p: BoardPart) => {
    const c = result.components[p.id];
    if (!c) return null;
    if (p.kind === "ammeter") return `${sf(Math.abs(c.current))} A`;
    if (p.kind === "voltmeter") return `${sf(Math.abs(c.voltage))} V`;
    return null;
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Add a part">
          {(Object.keys(SPEC) as BoardPart["kind"][]).map((k) => (
            <Btn key={k} onClick={() => add(k)}>
              + {SPEC[k].label}
            </Btn>
          ))}
        </div>
        <div className="relative overflow-hidden rounded-xl bg-[#0a1020] ring-1 ring-inset ring-white/[0.08]">
          <svg
            ref={svg}
            viewBox={`0 0 ${W} ${H}`}
            className="block w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-[#2f80ff]"
            tabIndex={0}
            role="application"
            aria-label="Circuit board. Add parts from the toolbar, drag to move, click two terminals to wire them. Arrow keys move the selected part, R rotates, Delete removes."
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerDown={() => {
              setSelected(null);
              setPending(null);
            }}
            onKeyDown={onKey}
          >
            <defs>
              <pattern id="cs-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
                <circle cx={1} cy={1} r={1} fill="#ffffff14" />
              </pattern>
              <radialGradient id="cs-glow">
                <stop offset="0" stopColor="#ffd43b" stopOpacity="0.9" />
                <stop offset="1" stopColor="#ffd43b" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width={W} height={H} fill="url(#cs-grid)" />

            {build.wires.map(([a, b], i) => {
              const p = term[a], q = term[b];
              if (!p || !q) return null;
              const hot = shorted && (result.shortPath.includes(a.split(".")[0]!) || result.shortPath.includes(b.split(".")[0]!));
              const d = `M${p.x} ${p.y} L${q.x} ${p.y} L${q.x} ${q.y}`;
              return (
                <g key={i}>
                  <path d={d} fill="none" stroke={hot ? "#ff4d4f" : live ? "#5fd4ff" : "#5b6478"} strokeWidth={3.5} strokeLinejoin="round" />
                  {live && !hot && <path d={d} fill="none" stroke="#e8fbff" strokeWidth={2} strokeDasharray="2 14" className="cs-flow" style={{ animationDuration: `${clamp(1.6 / Math.log10(10 + sourceI * 100), 0.25, 1.6)}s` }} />}
                  <path d={d} fill="none" stroke="transparent" strokeWidth={14} className="cursor-pointer" onPointerDown={(e) => e.stopPropagation()} onClick={() => removeWire(i)}>
                    <title>Remove this wire</title>
                  </path>
                </g>
              );
            })}

            {build.parts.map((p) => (
              <PartGlyph key={p.id} p={p} selected={selected === p.id} power={Math.abs(result.components[p.id]?.power ?? 0)} on={!!result.components[p.id]?.on} reading={reading(p)} onDown={(e) => onPartDown(e, p)} />
            ))}

            {Object.entries(term).map(([t, pt]) => (
              <circle
                key={t}
                cx={pt.x}
                cy={pt.y}
                r={pending === t ? 9 : 7}
                className="cursor-crosshair"
                fill={pending === t ? "#2f80ff" : t.endsWith(".a") && /^[BD]/.test(t) ? "#ff6b6b" : "#c9d1e4"}
                stroke="#0a1020"
                strokeWidth={2}
                tabIndex={0}
                role="button"
                aria-label={`Terminal ${t}${pending === t ? ", selected" : ""}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  clickTerminal(t);
                }}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), e.stopPropagation(), clickTerminal(t))}
              />
            ))}
            {pending && pointer && term[pending] && <line x1={term[pending]!.x} y1={term[pending]!.y} x2={pointer.x} y2={pointer.y} stroke="#2f80ff" strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />}
          </svg>
          {shorted && (
            <div role="alert" className="absolute left-3 top-3 flex items-center gap-2 rounded-lg bg-red-500/90 px-3 py-1.5 text-sm font-semibold text-white shadow-lg">
              <Zap className="h-4 w-4" /> Short circuit: the battery is connected straight across itself.
            </div>
          )}
          <style>{`.cs-flow{animation:cs-flow linear infinite}@keyframes cs-flow{to{stroke-dashoffset:-32}}@media (prefers-reduced-motion:reduce){.cs-flow{animation:none}}`}</style>
        </div>
        <p className="text-xs text-white/45">Click a terminal, then another, to wire them. Click a wire to remove it. Tap a switch to flip it. Red terminals are + on batteries and the anode on LEDs.</p>
      </div>

      <div className="space-y-3">
        <Panel title="Examples">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(CIRCUIT_EXAMPLES).map(([k, ex]) => (
              <Btn key={k} onClick={() => (setBuild(structuredClone(ex.build)), setSelected(null))}>
                {ex.label}
              </Btn>
            ))}
            <Btn tone="ghost" onClick={() => (setBuild({ parts: [], wires: [] }), setSelected(null))}>
              Clear board
            </Btn>
          </div>
        </Panel>
        {sel ? (
          <Panel
            title={`${SPEC[sel.kind].label} ${sel.id}`}
            right={
              <div className="flex gap-1">
                <Btn tone="ghost" title="Rotate (R)" onClick={() => patch(sel.id, { vertical: !sel.vertical })}>
                  <RotateCw className="h-4 w-4" />
                </Btn>
                <Btn tone="danger" title="Remove (Delete)" onClick={() => remove(sel.id)}>
                  <Trash2 className="h-4 w-4" />
                </Btn>
              </div>
            }
          >
            <div className="space-y-3">
              {SPEC[sel.kind].value && (
                <ParamSlider label={SPEC[sel.kind].value!.name} value={sel.value ?? SPEC[sel.kind].value!.def} min={SPEC[sel.kind].value!.min} max={SPEC[sel.kind].value!.max} step={SPEC[sel.kind].value!.step} unit={SPEC[sel.kind].value!.unit} onChange={(v) => patch(sel.id, { value: v })} onCommit={(v) => patch(sel.id, { value: v })} />
              )}
              {sel.kind === "switch" && <Btn tone={sel.closed ? "primary" : "secondary"} pressed={!!sel.closed} onClick={() => patch(sel.id, { closed: !sel.closed })}>{sel.closed ? "Closed (on)" : "Open (off)"}</Btn>}
              {sel.kind === "fuse" && sel.blown && <Btn onClick={() => patch(sel.id, { blown: false })}>Replace the fuse</Btn>}
              <div className="grid grid-cols-3 gap-2">
                <Readout label="Current" value={sf(Math.abs(result.components[sel.id]?.current ?? 0))} unit="A" />
                <Readout label="Voltage" value={sf(Math.abs(result.components[sel.id]?.voltage ?? 0))} unit="V" />
                <Readout label="Power" value={sf(Math.abs(result.components[sel.id]?.power ?? 0))} unit="W" />
              </div>
            </div>
          </Panel>
        ) : (
          <Panel title="Circuit">
            <div className="grid grid-cols-2 gap-2">
              <Readout label="Battery current" value={sf(sourceI)} unit="A" tone={shorted ? "bad" : "default"} />
              <Readout label="Parts" value={build.parts.length} />
            </div>
            <p className="mt-2 text-xs text-white/50">Select a part to change it or read its current, voltage and power.</p>
          </Panel>
        )}
        <Diagnostics result={result} partsCount={build.parts.length} />
      </div>
    </div>
  );
}

function Diagnostics({ result, partsCount }: { result: ReturnType<typeof solve>; partsCount: number }) {
  const notes: { tone: "warn" | "bad" | "info"; text: string }[] = [];
  if (result.shorted.length) notes.push({ tone: "bad", text: "Short circuit. A huge current flows and the battery would get hot. Add a load (a bulb or resistor) in the path." });
  result.blownFuses.forEach((f) => notes.push({ tone: "warn", text: `Fuse ${f} has blown: the current went over its rating, so it broke the circuit to protect it.` }));
  result.ammeterAcross.forEach((a) => notes.push({ tone: "warn", text: `Ammeter ${a} is across a part. Ammeters have almost no resistance, so they belong in series.` }));
  result.voltmeterInSeries.forEach((v) => notes.push({ tone: "warn", text: `Voltmeter ${v} is in series. Its huge resistance starves the circuit; put it across a part instead.` }));
  if (result.open && partsCount > 1) notes.push({ tone: "info", text: "No current is flowing. Is there a complete loop from + back to −, with every switch closed?" });
  if (!notes.length) return null;
  return (
    <Panel title="What's happening">
      <ul className="space-y-1.5 text-sm" aria-live="polite">
        {notes.map((n, i) => (
          <li key={i} className={n.tone === "bad" ? "text-red-300" : n.tone === "warn" ? "text-amber-200" : "text-white/70"}>
            {n.text}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PartGlyph({ p, selected, power, on, reading, onDown }: { p: BoardPart; selected: boolean; power: number; on: boolean; reading: string | null; onDown: (e: PointerEvent) => void }) {
  const rot = p.vertical ? 90 : 0;
  const glow = p.kind === "bulb" ? Math.min(1, power / BULB_FULL_W) : p.kind === "led" && on ? 0.8 : 0;
  const stroke = "#e7ecf7";
  return (
    <g transform={`translate(${p.x} ${p.y})`} className="cursor-grab" onPointerDown={onDown} role="img" aria-label={`${SPEC[p.kind].label} ${p.id}${reading ? ` reads ${reading}` : ""}`}>
      {glow > 0.02 && <circle r={26 + 40 * glow} fill="url(#cs-glow)" opacity={0.35 + 0.6 * glow} />}
      {selected && <rect x={-52} y={-34} width={104} height={68} rx={10} fill="none" stroke="#2f80ff" strokeDasharray="5 4" />}
      <g transform={`rotate(${rot})`}>
        <line x1={-HALF} y1={0} x2={-18} y2={0} stroke={stroke} strokeWidth={3} />
        <line x1={18} y1={0} x2={HALF} y2={0} stroke={stroke} strokeWidth={3} />
        {p.kind === "battery" && (
          <>
            <rect x={-18} y={-20} width={36} height={40} fill="#0a1020" />
            <line x1={6} y1={-18} x2={6} y2={18} stroke={stroke} strokeWidth={3} />
            <line x1={-6} y1={-10} x2={-6} y2={10} stroke={stroke} strokeWidth={6} />
            <line x1={-18} y1={0} x2={-6} y2={0} stroke={stroke} strokeWidth={3} />
            <line x1={6} y1={0} x2={18} y2={0} stroke={stroke} strokeWidth={3} />
          </>
        )}
        {p.kind === "resistor" && (
          <>
            <rect x={-18} y={-8} width={36} height={16} rx={3} fill="#d6b27a" stroke={stroke} strokeWidth={1.5} />
            {colourBands(p.value ?? 10).slice(0, 4).map((b, i) => (
              <rect key={i} x={-12 + i * 7} y={-8} width={3.5} height={16} fill={BAND_HEX[b] ?? "#000"} />
            ))}
          </>
        )}
        {p.kind === "bulb" && (
          <>
            <circle r={16} fill={glow > 0.02 ? `rgba(255,212,59,${0.25 + 0.75 * glow})` : "#141b2e"} stroke={stroke} strokeWidth={2.5} />
            <path d="M-11 -11 L11 11 M11 -11 L-11 11" stroke={glow > 0.02 ? "#7a5200" : "#59607a"} strokeWidth={2} />
          </>
        )}
        {p.kind === "switch" && (
          <>
            <line x1={-18} y1={0} x2={-12} y2={0} stroke={stroke} strokeWidth={3} />
            <circle cx={-12} cy={0} r={3} fill={stroke} />
            <circle cx={14} cy={0} r={3} fill={stroke} />
            <line x1={-12} y1={0} x2={14} y2={p.closed ? 0 : -16} stroke={p.closed ? "#51cf66" : stroke} strokeWidth={3} strokeLinecap="round" />
            <line x1={14} y1={0} x2={18} y2={0} stroke={stroke} strokeWidth={3} />
          </>
        )}
        {(p.kind === "ammeter" || p.kind === "voltmeter") && (
          <>
            <circle r={17} fill="#141b2e" stroke={stroke} strokeWidth={2.5} />
            <text textAnchor="middle" dy={6} transform={`rotate(${-rot})`} className="fill-white text-[17px] font-bold">
              {p.kind === "ammeter" ? "A" : "V"}
            </text>
          </>
        )}
        {p.kind === "led" && (
          <>
            <path d="M-10 -12 L10 0 L-10 12 Z" fill={on ? "#ff6b6b" : "#141b2e"} stroke={stroke} strokeWidth={2} />
            <line x1={10} y1={-12} x2={10} y2={12} stroke={stroke} strokeWidth={3} />
            <line x1={-18} y1={0} x2={-10} y2={0} stroke={stroke} strokeWidth={3} />
            <line x1={10} y1={0} x2={18} y2={0} stroke={stroke} strokeWidth={3} />
          </>
        )}
        {p.kind === "fuse" && (
          <>
            <rect x={-18} y={-7} width={36} height={14} rx={2} fill="#141b2e" stroke={stroke} strokeWidth={2} />
            {p.blown ? <path d="M-14 0 H-3 M3 0 H14" stroke="#ff6b6b" strokeWidth={2} /> : <line x1={-14} y1={0} x2={14} y2={0} stroke={stroke} strokeWidth={1.5} />}
          </>
        )}
      </g>
      <text x={0} y={p.vertical ? 4 : 34} dx={p.vertical ? 30 : 0} textAnchor={p.vertical ? "start" : "middle"} className="fill-white/60 text-[12px]">
        {p.id}
        {p.value !== undefined && SPEC[p.kind].value ? ` · ${p.value}${SPEC[p.kind].value!.unit}` : ""}
      </text>
      {reading && (
        <text x={0} y={p.vertical ? 22 : -28} dx={p.vertical ? 30 : 0} textAnchor={p.vertical ? "start" : "middle"} className="fill-[#7cf3ff] font-mono text-[14px] font-semibold">
          {reading}
        </text>
      )}
    </g>
  );
}
