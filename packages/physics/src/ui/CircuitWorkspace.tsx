import { motion, useReducedMotion } from "framer-motion";
import { Lightbulb, LightbulbOff, Power, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { BAND_HEX, colourBands, type Component } from "../core/circuit";
import { bulbConfig, bulbLit, circuitNow, fitR, isClosed, meterValue, type CircuitState } from "../labs/circuits";
import { Btn, LiveGraph, Panel, ParamSlider, ReadingInput, Readout, sf } from "./kit";
import type { SimSession } from "./useSimSession";

type Pos = { x: number; y: number; vertical?: boolean };

/** Where each part sits on the board (SVG units) per experiment. */
const LAYOUTS: Record<string, Record<string, Pos>> = {
  "ohms-law": { B: { x: 120, y: 330 }, S: { x: 120, y: 120, vertical: true }, Rh: { x: 330, y: 70 }, A: { x: 560, y: 120, vertical: true }, R: { x: 560, y: 300, vertical: true }, V: { x: 720, y: 300, vertical: true } },
  "series-and-parallel": { B: { x: 120, y: 330 }, S: { x: 120, y: 130, vertical: true }, A: { x: 330, y: 70 }, L1: { x: 560, y: 150, vertical: true }, L2: { x: 680, y: 260, vertical: true } },
};

const HALF = 42;

function terminals(id: string, p: Pos) {
  return p.vertical ? { [`${id}.a`]: { x: p.x, y: p.y - HALF }, [`${id}.b`]: { x: p.x, y: p.y + HALF } } : { [`${id}.a`]: { x: p.x + HALF, y: p.y }, [`${id}.b`]: { x: p.x - HALF, y: p.y } };
}

const NAMES: Record<string, string> = { battery: "battery", switch: "switch", rheostat: "rheostat", resistor: "resistor", ammeter: "ammeter", voltmeter: "voltmeter", bulb: "bulb", led: "LED", fuse: "fuse", cell: "cell", wire: "wire" };

export function CircuitWorkspace({ session }: { session: SimSession<CircuitState> }) {
  const s = session.state;
  const slug = session.content.slug;
  const layout = LAYOUTS[slug]!;
  const unknownId = (session.content.setup as { unknownId?: string }).unknownId;
  const reduced = useReducedMotion();
  const r = useMemo(() => circuitNow(s, unknownId), [s, unknownId]);
  const term = useMemo(() => Object.assign({}, ...s.parts.map((p) => terminals(p.id, layout[p.id]!))) as Record<string, { x: number; y: number }>, [s.parts, layout]);
  const [pending, setPending] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const ro = session.readOnly;

  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setPending(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const clickTerminal = (t: string) => {
    if (ro) return;
    if (!pending) return setPending(t);
    if (pending === t) return setPending(null);
    session.dispatch("equipment.connect", { from: pending, to: t });
    setPending(null);
  };
  const removeWire = (a: string, b: string) => !ro && session.dispatch("equipment.connect", { from: a, to: b, port: "remove" });
  const keyAct = (e: KeyboardEvent, f: () => void) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      f();
    }
  };

  const srcI = Math.abs(r.components.B?.current ?? 0);
  const shorted = r.shorted.length > 0 && isClosed(s);
  const carries = (t: string) => Math.abs(r.components[t.split(".")[0]!]?.current ?? 0) > 1e-4;

  const toSvg = (e: React.PointerEvent) => {
    const el = svg.current;
    if (!el) return null;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = el.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : null;
  };

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
      <div className="relative min-h-[320px] overflow-hidden rounded-xl bg-[radial-gradient(700px_400px_at_50%_30%,#16264a,#0a1226)] ring-1 ring-inset ring-white/10">
        <svg ref={svg} viewBox="0 0 820 420" className="h-full w-full" onPointerMove={(e) => pending && setPointer(toSvg(e))} role="application" aria-label="Circuit board. Tab to a terminal and press Enter, then another terminal, to connect a wire. Escape cancels.">
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="rgba(140,180,255,.12)" />
            </pattern>
            <radialGradient id="glow">
              <stop offset="0%" stopColor="#fff6d0" />
              <stop offset="45%" stopColor="#ffcf5a" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#ff9a1a" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="820" height="420" fill="url(#grid)" />

          {/* wires */}
          {s.wires.map(([a, b]) => {
            const p = term[a];
            const q = term[b];
            if (!p || !q) return null;
            const sag = Math.min(40, Math.hypot(q.x - p.x, q.y - p.y) * 0.12);
            const d = `M ${p.x} ${p.y} C ${p.x} ${p.y + sag}, ${q.x} ${q.y + sag}, ${q.x} ${q.y}`;
            const live = isClosed(s) && carries(a) && carries(b);
            return (
              <g key={`${a}|${b}`} className="group cursor-pointer" onClick={() => removeWire(a, b)} tabIndex={ro ? -1 : 0} role="button" aria-label={`Wire from ${a} to ${b}. Press Enter to remove.`} onKeyDown={(e) => (e.key === "Delete" || e.key === "Backspace" ? removeWire(a, b) : keyAct(e, () => removeWire(a, b)))}>
                <path d={d} stroke="transparent" strokeWidth={14} fill="none" />
                <path d={d} stroke={shorted ? "#ff4d4f" : "#d08a4a"} strokeWidth={4} fill="none" strokeLinecap="round" className="transition-colors group-hover:stroke-[#ffb27a] group-focus:stroke-[#7cf3ff]" />
                {live && !reduced && <path d={d} stroke="#fff3c4" strokeWidth={2} fill="none" strokeDasharray="2 12" strokeLinecap="round" style={{ animation: `ls-flow ${Math.max(0.25, 1.6 / Math.max(0.05, srcI * 8))}s linear infinite` }} />}
              </g>
            );
          })}
          {pending && pointer && term[pending] && <line x1={term[pending]!.x} y1={term[pending]!.y} x2={pointer.x} y2={pointer.y} stroke="#7cf3ff" strokeWidth={2.5} strokeDasharray="6 5" pointerEvents="none" />}

          {/* parts */}
          {s.parts.map((p) => (
            <Part key={p.id} part={p} pos={layout[p.id]!} state={s} r={r} tempC={s.tempC} isUnknown={p.id === unknownId} onToggle={() => !ro && p.kind === "switch" && session.dispatch("param.set", { key: "switch", value: !p.closed })} readOnly={ro} />
          ))}

          {/* terminals on top */}
          {Object.entries(term).map(([t, p]) => {
            const id = t.split(".")[0]!;
            const part = s.parts.find((x) => x.id === id)!;
            const polar = part.kind === "battery" || part.kind === "ammeter" || part.kind === "voltmeter" || part.kind === "cell";
            const sign = polar ? (t.endsWith(".a") ? "+" : "−") : "";
            return (
              <g key={t} tabIndex={ro ? -1 : 0} role="button" aria-label={`${NAMES[part.kind]} ${id} ${sign ? (sign === "+" ? "positive" : "negative") : t.endsWith(".a") ? "end 1" : "end 2"} terminal${pending === t ? ", selected" : ""}`} onClick={() => clickTerminal(t)} onKeyDown={(e) => keyAct(e, () => clickTerminal(t))} className="cursor-pointer outline-none [&:focus>circle:first-child]:stroke-[#7cf3ff]">
                <circle cx={p.x} cy={p.y} r={9} fill={pending === t ? "#7cf3ff" : "#1b2440"} stroke={sign === "+" ? "#ff6b6b" : sign === "−" ? "#4dabf7" : "#c0c7d4"} strokeWidth={2.5} />
                {sign && (
                  <text x={p.x + (layout[id]!.vertical ? 14 : 0)} y={p.y + (layout[id]!.vertical ? 4 : -13)} fontSize={12} fontWeight={800} fill={sign === "+" ? "#ff8787" : "#74c0fc"} textAnchor="middle" pointerEvents="none">
                    {sign}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <style>{"@keyframes ls-flow { to { stroke-dashoffset: -28; } }"}</style>
        {shorted && (
          <motion.div className="absolute inset-x-4 top-3 rounded-lg bg-red-600/90 px-3 py-2 text-sm font-semibold text-white shadow-lg" animate={reduced ? {} : { opacity: [1, 0.7, 1] }} transition={{ repeat: Infinity, duration: 0.8 }}>
            Short circuit: the battery is connected across almost no resistance. Open the switch.
          </motion.div>
        )}
        {r.open && isClosed(s) && !shorted && <div className="absolute inset-x-4 top-3 rounded-lg bg-amber-500/85 px-3 py-2 text-sm font-semibold text-black">The switch is closed but there is no complete loop.</div>}
        <div className="absolute bottom-2 left-3 text-[11px] text-white/45">{pending ? `Wiring from ${pending}: choose another terminal (Esc to cancel)` : "Click a terminal, then another, to run a wire. Click a wire to remove it."}</div>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">{slug === "ohms-law" ? <OhmsPanel session={session} /> : <SeriesPanel session={session} />}</div>
    </div>
  );
}

function Part({ part, pos, r, tempC, isUnknown, onToggle, readOnly, state }: { part: Component; pos: Pos; state: CircuitState; r: ReturnType<typeof circuitNow>; tempC: number; isUnknown: boolean; onToggle: () => void; readOnly: boolean }) {
  const { x, y, vertical } = pos;
  const rot = vertical ? 90 : 0;
  const removed = state.removed.includes(part.id);
  const g = (children: React.ReactNode) => (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <line x1={-HALF} y1={0} x2={HALF} y2={0} stroke="#c0c7d4" strokeWidth={3} />
      {children}
    </g>
  );
  const label = (text: string, dy = 34) => (
    <text x={x + (vertical ? 30 : 0)} y={y + (vertical ? 4 : dy)} fontSize={12} fontWeight={700} fill="rgba(220,230,255,.8)" textAnchor={vertical ? "start" : "middle"}>
      {text}
    </text>
  );
  switch (part.kind) {
    case "battery":
    case "cell":
      return (
        <g>
          {g(
            <>
              <rect x={-12} y={-24} width={24} height={48} fill="#0e1529" />
              <line x1={-6} y1={-22} x2={-6} y2={22} stroke="#ff8787" strokeWidth={4} />
              <line x1={6} y1={-12} x2={6} y2={12} stroke="#74c0fc" strokeWidth={6} />
            </>,
          )}
          {label(`${part.value ?? 1.5} V battery`, 42)}
        </g>
      );
    case "switch":
      return (
        <g onClick={onToggle} className={readOnly ? "" : "cursor-pointer"} role="switch" aria-checked={!!part.closed} aria-label={`Switch, ${part.closed ? "closed" : "open"}`} tabIndex={readOnly ? -1 : 0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())}>
          <g transform={`translate(${x} ${y}) rotate(${rot})`}>
            <line x1={-HALF} y1={0} x2={-14} y2={0} stroke="#c0c7d4" strokeWidth={3} />
            <line x1={14} y1={0} x2={HALF} y2={0} stroke="#c0c7d4" strokeWidth={3} />
            <circle cx={-14} cy={0} r={4} fill="#c0c7d4" />
            <circle cx={14} cy={0} r={4} fill="#c0c7d4" />
            <motion.line x1={-14} y1={0} x2={16} y2={0} stroke={part.closed ? "#69db7c" : "#ffd43b"} strokeWidth={4} strokeLinecap="round" animate={{ rotate: part.closed ? 0 : -32 }} style={{ originX: "-14px", originY: "0px" }} transition={{ type: "spring", stiffness: 600, damping: 22 }} />
            <rect x={-26} y={-22} width={52} height={36} fill="transparent" />
          </g>
          {label(part.closed ? "switch (on)" : "switch (off)")}
        </g>
      );
    case "resistor": {
      const bands = colourBands(part.value ?? 10);
      const warm = Math.max(0, Math.min(1, (tempC - 22) / 40));
      return (
        <g>
          {g(
            <>
              <rect x={-24} y={-9} width={48} height={18} rx={8} fill={`rgb(${214 + warm * 41},${190 - warm * 90},${150 - warm * 110})`} />
              {bands.map((b, i) => (
                <rect key={i} x={-16 + i * 9 + (i === 3 ? 6 : 0)} y={-9} width={4} height={18} fill={BAND_HEX[b]} />
              ))}
            </>,
          )}
          {label(isUnknown ? `resistor R${warm > 0.05 ? ` · ${tempC.toFixed(0)} °C` : ""}` : `${part.value} Ω`)}
        </g>
      );
    }
    case "rheostat": {
      const st = part.setting ?? 1;
      return (
        <g>
          {g(
            <>
              <rect x={-30} y={-10} width={60} height={20} rx={3} fill="#3b4252" stroke="#9aa3b2" />
              {Array.from({ length: 10 }, (_, i) => (
                <line key={i} x1={-27 + i * 6} y1={-9} x2={-27 + i * 6} y2={9} stroke="#c9a46b" strokeWidth={1.2} />
              ))}
              <polygon points={`${-28 + st * 56},-12 ${-33 + st * 56},-24 ${-23 + st * 56},-24`} fill="#7cf3ff" />
            </>,
          )}
          {label(`rheostat ${Math.round((part.value ?? 50) * st)} Ω`)}
        </g>
      );
    }
    case "bulb": {
      const p = Math.abs(r.components[part.id]?.power ?? 0);
      const glow = removed ? 0 : Math.min(1, p / 0.6);
      return (
        <g>
          {!removed ? (
            g(
              <>
                <circle r={22} fill="url(#glow)" opacity={glow} />
                <circle r={15} fill={glow > 0.05 ? `rgba(255,${200 + glow * 55},${120 + glow * 100},${0.25 + glow * 0.6})` : "rgba(255,255,255,.06)"} stroke="#e9ecef" strokeWidth={2} />
                <path d="M -9 0 q 4.5 -9 9 0 q 4.5 9 9 0" fill="none" stroke={glow > 0.05 ? `rgb(255,${150 + glow * 105},${80 + glow * 150})` : "#868e96"} strokeWidth={1.8} />
              </>,
            )
          ) : (
            <g transform={`translate(${x} ${y}) rotate(${rot})`}>
              <line x1={-HALF} y1={0} x2={-16} y2={0} stroke="#c0c7d4" strokeWidth={3} />
              <line x1={16} y1={0} x2={HALF} y2={0} stroke="#c0c7d4" strokeWidth={3} />
              <circle r={15} fill="none" stroke="#495057" strokeDasharray="4 4" />
            </g>
          )}
          {label(removed ? `${part.id} (unscrewed)` : `bulb ${part.id}`)}
        </g>
      );
    }
    case "ammeter":
    case "voltmeter": {
      const v = meterValue(r, part.id, part.kind);
      return (
        <g>
          {g(
            <>
              <circle r={19} fill="#f3efe4" stroke="#1f2937" strokeWidth={2} />
              <text y={6} textAnchor="middle" fontSize={17} fontWeight={900} fill="#1f2937">
                {part.kind === "ammeter" ? "A" : "V"}
              </text>
            </>,
          )}
          {label(`${v.toFixed(part.kind === "ammeter" ? 3 : 2)} ${part.kind === "ammeter" ? "A" : "V"}`)}
        </g>
      );
    }
    default:
      return g(<rect x={-15} y={-8} width={30} height={16} fill="#495057" />);
  }
}

/* ------------------------------------------------------------------ side panels */

function SwitchButton({ session }: { session: SimSession<CircuitState> }) {
  const on = isClosed(session.state);
  return (
    <Btn tone={on ? "danger" : "primary"} onClick={() => session.dispatch("param.set", { key: "switch", value: !on })} disabled={session.readOnly} className="w-full" pressed={on}>
      <Power className="h-4 w-4" /> {on ? "Open the switch" : "Close the switch"}
    </Btn>
  );
}

function OhmsPanel({ session }: { session: SimSession<CircuitState> }) {
  const s = session.state;
  const r = circuitNow(s, "R");
  const rheo = s.parts.find((p) => p.kind === "rheostat")!;
  const fit = fitR(s.readings);
  const ro = session.readOnly;
  return (
    <>
      <Panel title="Meters">
        <div className="grid grid-cols-2 gap-2">
          <Readout label="Voltmeter" value={meterValue(r, "V", "voltmeter").toFixed(2)} unit="V" />
          <Readout label="Ammeter" value={meterValue(r, "A", "ammeter").toFixed(3)} unit="A" />
        </div>
        <div className="mt-3 space-y-3">
          <SwitchButton session={session} />
          <ParamSlider label="Rheostat" value={rheo.setting ?? 1} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * (rheo.value ?? 50))} Ω`} onCommit={(v) => session.dispatch("param.set", { key: "rheostat", value: v })} disabled={ro} />
        </div>
      </Panel>
      <Panel title="Record your readings">
        <p className="mb-2 text-xs text-white/55">Write down what each meter shows. A reading is complete when you have both V and I.</p>
        <div className="space-y-2">
          <ReadingInput label="Voltmeter reading" unit="V" onRecord={(v) => session.dispatch("measure.read", { instrument: "voltmeter", reading: { key: "V", value: v, unit: "V" } })} disabled={ro} />
          <ReadingInput label="Ammeter reading" unit="A" onRecord={(v) => session.dispatch("measure.read", { instrument: "ammeter", reading: { key: "I", value: v, unit: "A" } })} disabled={ro} />
        </div>
        {(s.pending.V !== null || s.pending.I !== null) && <p className="mt-2 text-xs text-amber-200">Half a reading: {s.pending.V !== null ? `V = ${s.pending.V}` : `I = ${s.pending.I}`}. Now record the other meter.</p>}
      </Panel>
      <Panel title={`Readings (${s.readings.length}/5)`}>
        {s.readings.length > 0 && (
          <table className="mb-2 w-full text-xs">
            <thead className="text-white/45">
              <tr>
                <th className="text-left font-semibold">#</th>
                <th className="text-right font-semibold">V / V</th>
                <th className="text-right font-semibold">I / A</th>
                <th className="text-right font-semibold">V/I / Ω</th>
              </tr>
            </thead>
            <tbody className="font-mono text-white/85">
              {s.readings.map((x, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td className="text-right">{x.V}</td>
                  <td className="text-right">{x.I}</td>
                  <td className="text-right">{x.V && x.I ? (x.V / x.I).toFixed(2) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <LiveGraph series={[{ label: "readings", colour: "#7cf3ff", mode: "scatter", points: s.readings.filter((x) => x.V !== null && x.I !== null).map((x) => ({ x: x.I!, y: x.V! })) }]} xLabel="I / A" yLabel="V / V" height={150} fitOrigin />
        <div className="mt-2">
          <ReadingInput label="Gradient = R" unit="Ω" onRecord={(v) => session.dispatch("param.set", { key: "result:R", value: v })} disabled={ro || s.readings.length < 2} />
          {fit !== null && <p className="mt-1 text-[11px] text-white/45">Tip: the dashed line is the best fit through the origin.</p>}
        </div>
      </Panel>
    </>
  );
}

function SeriesPanel({ session }: { session: SimSession<CircuitState> }) {
  const s = session.state;
  const r = circuitNow(s);
  const cfg = bulbConfig(s);
  const ro = session.readOnly;
  return (
    <>
      <Panel title="Circuit">
        <div className="grid grid-cols-2 gap-2">
          <Readout label="Ammeter" value={meterValue(r, "A", "ammeter").toFixed(3)} unit="A" />
          <Readout label="Bulbs are in" value={cfg ?? "–"} tone={cfg ? "good" : "default"} />
        </div>
        <div className="mt-3">
          <SwitchButton session={session} />
        </div>
        <div className="mt-3">
          <ReadingInput label="Ammeter reading" unit="A" onRecord={(v) => session.dispatch("measure.read", { instrument: "ammeter", reading: { key: "I", value: v, unit: "A" } })} disabled={ro} />
        </div>
      </Panel>
      <Panel title="Bulbs">
        <div className="grid grid-cols-2 gap-2">
          {["L1", "L2"].map((id) => {
            const out = s.removed.includes(id);
            return (
              <Btn key={id} onClick={() => session.dispatch("param.set", { key: `bulb:${id}`, value: out ? "in" : "out" })} disabled={ro}>
                {out ? <Lightbulb className="h-4 w-4" /> : <LightbulbOff className="h-4 w-4" />}
                {out ? `Screw in ${id}` : `Unscrew ${id}`}
              </Btn>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Readout label="L1" value={bulbLit(r, "L1") && !s.removed.includes("L1") ? `${sf(Math.abs(r.components.L1?.power ?? 0), 2)} W` : "off"} />
          <Readout label="L2" value={bulbLit(r, "L2") && !s.removed.includes("L2") ? `${sf(Math.abs(r.components.L2?.power ?? 0), 2)} W` : "off"} />
        </div>
      </Panel>
      <Panel title="Your results">
        <div className="grid grid-cols-2 gap-2">
          <Readout label="Series current" value={s.ammeter.series ?? "–"} unit={s.ammeter.series !== undefined ? "A" : ""} />
          <Readout label="Parallel current" value={s.ammeter.parallel ?? "–"} unit={s.ammeter.parallel !== undefined ? "A" : ""} />
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-white/50">
          <Trash2 className="h-3 w-3" /> To rewire, click a wire to remove it.
        </p>
      </Panel>
    </>
  );
}
