import { motion, useReducedMotion } from "framer-motion";
import { Lightbulb, LightbulbOff, Power, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BAND_HEX, colourBands, type Component } from "../core/circuit";
import { bulbConfig, bulbLit, circuitNow, fitR, isClosed, meterValue, ohmsWiringOk, type CircuitState } from "../labs/circuits";
import { DragHandle, easeInOut, GhostHand, LabStyles, mix, Num, paramOf, Pulse, Stage, Tag, useCommitLater, useDemoPreview, useFocusStep, useSvgDrag, V3, type Pt } from "./interact";
import { Btn, LiveGraph, Panel, ParamSlider, ReadingInput, Readout, sf } from "./kit";
import { submitted } from "./guide";
import type { SimSession } from "./useSimSession";

type Pos = { x: number; y: number; vertical?: boolean };

/** Where each part sits on the board (SVG units) per experiment. */
const LAYOUTS: Record<string, Record<string, Pos>> = {
  "ohms-law": { B: { x: 120, y: 330 }, S: { x: 120, y: 120, vertical: true }, Rh: { x: 330, y: 70 }, A: { x: 560, y: 120, vertical: true }, R: { x: 560, y: 300, vertical: true }, V: { x: 720, y: 300, vertical: true } },
  "series-and-parallel": { B: { x: 120, y: 330 }, S: { x: 120, y: 130, vertical: true }, A: { x: 330, y: 70 }, L1: { x: 560, y: 150, vertical: true }, L2: { x: 680, y: 260, vertical: true } },
};

const HALF = 42;
const SNAP = 26;

function terminals(id: string, p: Pos) {
  return p.vertical ? { [`${id}.a`]: { x: p.x, y: p.y - HALF }, [`${id}.b`]: { x: p.x, y: p.y + HALF } } : { [`${id}.a`]: { x: p.x + HALF, y: p.y }, [`${id}.b`]: { x: p.x - HALF, y: p.y } };
}

const NAMES: Record<string, string> = { battery: "battery", switch: "switch", rheostat: "rheostat", resistor: "resistor", ammeter: "ammeter", voltmeter: "voltmeter", bulb: "bulb", led: "LED", fuse: "fuse", cell: "cell", wire: "wire" };
const wireD = (p: Pt, q: Pt) => {
  const sag = Math.min(46, Math.hypot(q.x - p.x, q.y - p.y) * 0.16);
  return `M ${p.x} ${p.y} C ${p.x} ${p.y + sag}, ${q.x} ${q.y + sag}, ${q.x} ${q.y}`;
};
const key2 = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Circuit board. Drag from one terminal to another to run a wire (or click one, then the other);
 * click a wire to remove it. Throw the switch lever, slide the rheostat wiper and unscrew bulbs right
 * on the board. Meters have live needles; current flows along live wires.
 */
export function CircuitWorkspace({ session }: { session: SimSession<CircuitState> }) {
  const s = session.state;
  const slug = session.content.slug;
  const layout = LAYOUTS[slug]!;
  const unknownId = (session.content.setup as { unknownId?: string }).unknownId;
  const reduced = useReducedMotion();
  const ro = session.readOnly;
  const focus = useFocusStep(session);
  const demo = useDemoPreview(session, 1200);

  const term = useMemo(() => Object.assign({}, ...s.parts.map((p) => terminals(p.id, layout[p.id]!))) as Record<string, Pt>, [s.parts, layout]);
  const wiredCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [a, b] of s.wires) {
      m[a] = (m[a] ?? 0) + 1;
      m[b] = (m[b] ?? 0) + 1;
    }
    return m;
  }, [s.wires]);

  /* ---------------------------------------------------------------- local manipulation */
  const [pending, setPending] = useState<string | null>(null);
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [drag, setDrag] = useState<{ from: string; p: Pt } | null>(null);
  const [rheoLocal, setRheoLocal] = useState<number | null>(null);
  const [lever, setLever] = useState<number | null>(null);
  const [badTerm, setBadTerm] = useState<string | null>(null);
  const commitRheo = useCommitLater((v: number) => {
    session.dispatch("param.set", { key: "rheostat", value: v });
    setRheoLocal(null);
  }, 400);

  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setPending(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  // Demo glide: the rheostat wiper and the switch lever move to their next values before they land.
  const nRheo = paramOf(demo.next, "rheostat");
  const nSwitch = paramOf(demo.next, "switch");
  const kk = easeInOut(Math.max(0, (demo.k - 0.35) / 0.65));
  const rheoPart = s.parts.find((p) => p.kind === "rheostat");
  const rheoSetting = rheoLocal ?? (typeof nRheo === "number" && rheoPart ? mix(rheoPart.setting ?? 1, nRheo, kk) : (rheoPart?.setting ?? 1));
  const r = useMemo(() => {
    const shown: CircuitState = rheoPart && rheoSetting !== rheoPart.setting ? { ...s, parts: s.parts.map((p) => (p.kind === "rheostat" ? { ...p, setting: rheoSetting } : p)) } : s;
    return circuitNow(shown, unknownId);
  }, [s, rheoPart, rheoSetting, unknownId]);
  const closed = isClosed(s);
  const leverShown = lever ?? (nSwitch !== undefined ? mix(closed ? 0 : -32, nSwitch ? 0 : -32, kk) : closed ? 0 : -32);

  const connect = (from: string, to: string) => {
    if (ro || from === to) return;
    if (s.wires.some(([a, b]) => key2(a, b) === key2(from, to))) {
      setBadTerm(to);
      window.setTimeout(() => setBadTerm(null), 400);
      return;
    }
    session.dispatch("equipment.connect", { from, to });
  };
  const clickTerminal = (t: string) => {
    if (ro) return;
    if (!pending) return setPending(t);
    if (pending === t) return setPending(null);
    connect(pending, t);
    setPending(null);
  };
  const nearestTerm = (p: Pt, except: string) => {
    let best: string | null = null;
    let d = SNAP;
    for (const [t, q] of Object.entries(term)) {
      if (t === except) continue;
      const dd = Math.hypot(q.x - p.x, q.y - p.y);
      if (dd < d) {
        d = dd;
        best = t;
      }
    }
    return best;
  };
  const removeWire = (a: string, b: string) => !ro && session.dispatch("equipment.connect", { from: a, to: b, port: "remove" });
  const setSwitch = (v: boolean) => !ro && session.dispatch("param.set", { key: "switch", value: v });

  const srcI = Math.abs(r.components.B?.current ?? 0);
  const shorted = r.shorted.length > 0 && closed;
  const carries = (t: string) => Math.abs(r.components[t.split(".")[0]!]?.current ?? 0) > 1e-4;
  const wiringFrom = drag?.from ?? pending;
  const snapTarget = drag ? nearestTerm(drag.p, drag.from) : null;
  const wireEnd = drag ? (snapTarget ? term[snapTarget]! : drag.p) : pending && pointer ? pointer : null;

  /* ---------------------------------------------------------------- guidance */
  const ohms = slug === "ohms-law";
  const buildFocus = !ro && (focus === "build" || ((focus === "series" || focus === "parallel") && !closed));
  const switchPulse = !ro && ((focus === "close" && ohms && ohmsWiringOk(s) && !closed) || (focus === "switch-off" && closed) || ((focus === "series" || focus === "parallel") && bulbConfig(s) !== null && !closed) || (focus === "unscrew" && !closed && bulbConfig(s) === "parallel"));
  const rheoPulse = !ro && focus === "readings" && closed;
  const bulbPulse = !ro && focus === "unscrew" && closed && bulbConfig(s) === "parallel";

  /* ---------------------------------------------------------------- demo hand */
  let hand: Pt | null = null;
  let pressing = false;
  let follow = false;
  let demoWire: { a: Pt; b: Pt } | null = null;
  const nx = demo.next;
  if (nx?.type === "equipment.connect") {
    const pl = nx.payload as { from: string; to: string; port?: string };
    const a = term[pl.from];
    const b = term[pl.to];
    if (a && b) {
      if (pl.port === "remove") {
        hand = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + Math.min(46, Math.hypot(b.x - a.x, b.y - a.y) * 0.16) * 0.75 };
        pressing = demo.k > 0.75;
      } else {
        const t = easeInOut(Math.max(0, (demo.k - 0.3) / 0.7));
        const at = demo.k > 0.3 ? { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) } : a;
        hand = at;
        pressing = demo.k > 0.25;
        follow = demo.k > 0.3;
        if (demo.k > 0.3) demoWire = { a, b: at };
      }
    }
  } else if (nRheo !== undefined && rheoPart) {
    const p = layout[rheoPart.id]!;
    hand = { x: p.x - 28 + rheoSetting * 56, y: p.y - 30 };
    pressing = demo.k > 0.3;
    follow = demo.k > 0.35;
  } else if (nSwitch !== undefined) {
    const p = layout.S!;
    hand = { x: p.x + (p.vertical ? 18 : 0), y: p.y + (p.vertical ? 0 : -14) };
    pressing = demo.k > 0.4;
  } else if (nx?.type === "param.set" && String((nx.payload as { key: string }).key).startsWith("bulb:")) {
    const id = String((nx.payload as { key: string }).key).slice(5);
    const p = layout[id];
    if (p) {
      hand = p;
      pressing = demo.k > 0.7;
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_330px]">
      <LabStyles />
      <Stage className="min-h-[340px]">
        <svg
          viewBox="0 0 820 420"
          className="h-full w-full select-none"
          onPointerMove={(e) => {
            if (!pending) return;
            const el = e.currentTarget;
            const m = el.getScreenCTM();
            if (!m) return;
            const pt = el.createSVGPoint();
            pt.x = e.clientX;
            pt.y = e.clientY;
            const q = pt.matrixTransform(m.inverse());
            setPointer({ x: q.x, y: q.y });
          }}
          role="application"
          aria-label="Circuit board. Drag from one terminal to another to connect a wire, or Tab to a terminal and press Enter, then another. Escape cancels."
        >
          <defs>
            <pattern id="cw-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="rgba(140,180,255,.13)" />
            </pattern>
            <radialGradient id="cw-glow">
              <stop offset="0%" stopColor="#fff6d0" />
              <stop offset="45%" stopColor="#ffcf5a" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#ff9a1a" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="cw-post" cx="35%" cy="30%">
              <stop offset="0" stopColor="#ffe9a8" />
              <stop offset="1" stopColor="#b8862b" />
            </radialGradient>
            <filter id="cw-shadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodOpacity="0.45" />
            </filter>
          </defs>
          <rect width="820" height="420" fill="url(#cw-grid)" />

          {/* wires */}
          {s.wires.map(([a, b]) => {
            const p = term[a];
            const q = term[b];
            if (!p || !q) return null;
            const d = wireD(p, q);
            const live = closed && carries(a) && carries(b);
            return (
              <g key={`${a}|${b}`} className="group cursor-pointer outline-none" onClick={() => removeWire(a, b)} tabIndex={ro ? -1 : 0} role="button" aria-label={`Wire from ${a} to ${b}. Press Enter or Delete to remove.`} onKeyDown={(e) => (e.key === "Delete" || e.key === "Backspace" || e.key === "Enter" || e.key === " ") && (e.preventDefault(), removeWire(a, b))}>
                <path d={d} stroke="transparent" strokeWidth={16} fill="none" />
                <path d={d} stroke="rgba(0,0,0,.45)" strokeWidth={6} fill="none" strokeLinecap="round" transform="translate(0 3)" />
                <path d={d} stroke={shorted ? V3.red : live ? "#e6a15a" : "#c27a3e"} strokeWidth={4.5} fill="none" strokeLinecap="round" className="transition-colors group-hover:stroke-[#ff8a96] group-focus-visible:stroke-[#39d6ff]" />
                <path d={d} stroke="rgba(255,255,255,.35)" strokeWidth={1.2} fill="none" strokeLinecap="round" transform="translate(-1 -1)" />
                {live && !reduced && <path d={d} stroke="#fff3c4" strokeWidth={2.2} fill="none" strokeDasharray="2 12" strokeLinecap="round" className="ls-flow" style={{ animationDuration: `${Math.max(0.25, 1.6 / Math.max(0.05, srcI * 8))}s` }} />}
              </g>
            );
          })}
          {/* the wire being run */}
          {wiringFrom && wireEnd && term[wiringFrom] && <path d={wireD(term[wiringFrom]!, wireEnd)} stroke={snapTarget ? V3.mint : V3.cyan} strokeWidth={4} strokeLinecap="round" fill="none" strokeDasharray={snapTarget ? undefined : "7 6"} pointerEvents="none" />}
          {demoWire && <path d={wireD(demoWire.a, demoWire.b)} stroke={V3.cyan} strokeWidth={4} strokeLinecap="round" fill="none" strokeDasharray="7 6" pointerEvents="none" />}

          {/* parts */}
          {s.parts.map((p) => (
            <Part
              key={p.id}
              part={p}
              pos={layout[p.id]!}
              state={s}
              r={r}
              tempC={s.tempC}
              isUnknown={p.id === unknownId}
              readOnly={ro}
              lever={leverShown}
              setLever={setLever}
              onSwitch={setSwitch}
              switchPulse={switchPulse}
              rheo={rheoSetting}
              setRheo={setRheoLocal}
              commitRheo={(v, later) => (later ? commitRheo(v) : (session.dispatch("param.set", { key: "rheostat", value: v }), setRheoLocal(null)))}
              rheoPulse={rheoPulse}
              bulbPulse={bulbPulse}
              onBulb={(id, out) => !ro && session.dispatch("param.set", { key: `bulb:${id}`, value: out ? "in" : "out" })}
              battV={s.parts.find((x) => x.kind === "battery")?.value ?? 3}
            />
          ))}

          {/* terminals on top */}
          {Object.entries(term).map(([t, p]) => (
            <Terminal
              key={t}
              t={t}
              p={p}
              part={s.parts.find((x) => x.id === t.split(".")[0])!}
              vertical={!!layout[t.split(".")[0]!]!.vertical}
              ro={ro}
              selected={pending === t || drag?.from === t}
              target={!!wiringFrom && wiringFrom !== t}
              snapped={snapTarget === t}
              bad={badTerm === t}
              pulse={buildFocus && !wiredCount[t] && !wiringFrom}
              onClick={() => clickTerminal(t)}
              onDragStart={(pt) => {
                setPending(null);
                setDrag({ from: t, p: pt });
              }}
              onDrag={(pt) => setDrag({ from: t, p: pt })}
              onDragEnd={(pt, moved) => {
                setDrag(null);
                if (!moved) return clickTerminal(t);
                const to = nearestTerm(pt, t);
                if (to) connect(t, to);
              }}
            />
          ))}
          {buildFocus && s.wires.length === 0 && !wiringFrom && <Tag x={term["B.a"]!.x + 40} y={term["B.a"]!.y + 62} text="Drag from a terminal to another" />}
          <GhostHand at={hand} pressing={pressing} follow={follow} />
        </svg>
        {shorted && (
          <motion.div className="absolute inset-x-4 top-3 rounded-[12px] border border-[#ff8a96] bg-[#c92a3e]/90 px-3 py-2 text-sm font-semibold text-white shadow-lg" animate={reduced ? {} : { opacity: [1, 0.7, 1] }} transition={{ repeat: Infinity, duration: 0.8 }}>
            Short circuit: the battery is connected across almost no resistance. Open the switch.
          </motion.div>
        )}
        {r.open && closed && !shorted && <div className="absolute inset-x-4 top-3 rounded-[12px] border border-[#ffc23d]/60 bg-[#ffc23d]/90 px-3 py-2 text-sm font-semibold text-[#2a1d00]">The switch is closed but there is no complete loop.</div>}
        <div className="pointer-events-none absolute bottom-2.5 left-3 rounded-[10px] bg-[#060d1f]/70 px-2.5 py-1 text-[11px] text-[#a9bde4]">{pending ? `Wiring from ${pending}: click another terminal (Esc cancels)` : `Drag between terminals to wire · click a wire to remove it · ${ohms ? "drag the switch lever and rheostat wiper" : "throw the switch lever · click a bulb to unscrew it"}`}</div>
      </Stage>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">{ohms ? <OhmsPanel session={session} r={r} rheo={rheoSetting} focus={focus} /> : <SeriesPanel session={session} focus={focus} />}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ terminal */

function Terminal({ t, p, part, vertical, ro, selected, target, snapped, bad, pulse, onClick, onDragStart, onDrag, onDragEnd }: { t: string; p: Pt; part: Component; vertical: boolean; ro: boolean; selected: boolean; target: boolean; snapped: boolean; bad: boolean; pulse: boolean; onClick: () => void; onDragStart: (p: Pt) => void; onDrag: (p: Pt) => void; onDragEnd: (p: Pt, moved: boolean) => void }) {
  const polar = part.kind === "battery" || part.kind === "ammeter" || part.kind === "voltmeter" || part.kind === "cell";
  const sign = polar ? (t.endsWith(".a") ? "+" : "−") : "";
  const down = useSvgDrag({ disabled: ro, onStart: (q) => onDragStart(q), onMove: (q) => onDrag(q), onEnd: (q, moved) => onDragEnd(q, moved) });
  const ringCol = sign === "+" ? "#ff5b6b" : sign === "−" ? "#4d9bff" : "#9fb0cc";
  return (
    <g
      tabIndex={ro ? -1 : 0}
      role="button"
      aria-label={`${NAMES[part.kind]} ${part.id} ${sign ? (sign === "+" ? "positive" : "negative") : t.endsWith(".a") ? "end 1" : "end 2"} terminal${selected ? ", selected" : ""}`}
      aria-pressed={selected}
      data-guide-id={t}
      onPointerDown={down}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`ls-handle ${bad ? "ls-shake" : ""}`}
    >
      {pulse && <Pulse cx={p.x} cy={p.y} r={10} colour={V3.cyan} />}
      {target && <circle cx={p.x} cy={p.y} r={snapped ? 17 : 14} fill={snapped ? "rgba(61,232,168,.22)" : "rgba(57,214,255,.10)"} stroke={snapped ? V3.mint : "rgba(57,214,255,.55)"} strokeWidth={snapped ? 2.5 : 1.5} className={snapped ? "" : "ls-breathe"} />}
      <circle cx={p.x} cy={p.y} r={18} fill="transparent" />
      <circle cx={p.x} cy={p.y} r={10} fill={selected ? V3.cyan : "#141c33"} stroke={ringCol} strokeWidth={3} filter="url(#cw-shadow)" />
      <circle cx={p.x} cy={p.y} r={4.5} fill={selected ? "#fff" : "url(#cw-post)"} />
      <circle className="ls-focus" cx={p.x} cy={p.y} r={15} fill="none" stroke={V3.cyan} strokeWidth={2} strokeDasharray="4 3" />
      {sign && (
        <text x={p.x + (vertical ? 16 : 0)} y={p.y + (vertical ? 4 : -15)} fontSize={13} fontWeight={800} fill={sign === "+" ? "#ff8a96" : "#7db4ff"} textAnchor="middle" pointerEvents="none">
          {sign}
        </text>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ parts */

type PartProps = {
  part: Component;
  pos: Pos;
  state: CircuitState;
  r: ReturnType<typeof circuitNow>;
  tempC: number;
  isUnknown: boolean;
  readOnly: boolean;
  lever: number;
  setLever: (v: number | null) => void;
  onSwitch: (closed: boolean) => void;
  switchPulse: boolean;
  rheo: number;
  setRheo: (v: number | null) => void;
  commitRheo: (v: number, later: boolean) => void;
  rheoPulse: boolean;
  bulbPulse: boolean;
  onBulb: (id: string, out: boolean) => void;
  battV: number;
};

function Part({ part, pos, r, tempC, isUnknown, readOnly, state, lever, setLever, onSwitch, switchPulse, rheo, setRheo, commitRheo, rheoPulse, bulbPulse, onBulb, battV }: PartProps) {
  const { x, y, vertical } = pos;
  const rot = vertical ? 90 : 0;
  const removed = state.removed.includes(part.id);
  const g = (children: React.ReactNode) => (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <line x1={-HALF} y1={0} x2={HALF} y2={0} stroke="#9fb0cc" strokeWidth={3} />
      {children}
    </g>
  );
  const label = (text: React.ReactNode, dy = 36) => (
    <text x={x + (vertical ? 32 : 0)} y={y + (vertical ? 4 : dy)} fontSize={12} fontWeight={700} fill="rgba(220,232,255,.85)" textAnchor={vertical ? "start" : "middle"} pointerEvents="none">
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
              <rect x={-30} y={-20} width={60} height={40} rx={8} fill="#141c33" stroke="#3a4766" filter="url(#cw-shadow)" />
              <rect x={-30} y={-20} width={20} height={40} rx={8} fill="#c92a3e" opacity={0.85} />
              <line x1={-6} y1={-14} x2={-6} y2={14} stroke="#ff8a96" strokeWidth={4} />
              <line x1={6} y1={-8} x2={6} y2={8} stroke="#7db4ff" strokeWidth={6} />
            </>,
          )}
          {label(`${part.value ?? 1.5} V battery`, 40)}
        </g>
      );
    case "switch":
      return <SwitchPart x={x} y={y} rot={rot} vertical={!!vertical} closed={!!part.closed} lever={lever} setLever={setLever} onSwitch={onSwitch} readOnly={readOnly} pulse={switchPulse} label={label(part.closed ? "switch: ON" : "switch: off")} />;
    case "resistor": {
      const bands = colourBands(part.value ?? 10);
      const warm = Math.max(0, Math.min(1, (tempC - 22) / 40));
      return (
        <g>
          {g(
            <>
              {warm > 0.05 && <ellipse rx={34} ry={18} fill="rgba(255,120,40,.25)" className="ls-breathe" />}
              <rect x={-24} y={-10} width={48} height={20} rx={9} fill={`rgb(${214 + warm * 41},${190 - warm * 90},${150 - warm * 110})`} filter="url(#cw-shadow)" />
              {bands.map((b, i) => (
                <rect key={i} x={-16 + i * 9 + (i === 3 ? 6 : 0)} y={-10} width={4} height={20} fill={BAND_HEX[b]} />
              ))}
            </>,
          )}
          {label(isUnknown ? `resistor R${warm > 0.05 ? ` · ${tempC.toFixed(0)} °C` : ""}` : `${part.value} Ω`)}
        </g>
      );
    }
    case "rheostat":
      return <RheostatPart part={part} x={x} y={y} rheo={rheo} setRheo={setRheo} commitRheo={commitRheo} readOnly={readOnly} pulse={rheoPulse} label={label(<>rheostat {Math.round((part.value ?? 50) * rheo)} Ω</>, 40)} g={g} />;
    case "bulb": {
      const p = Math.abs(r.components[part.id]?.power ?? 0);
      const glow = removed ? 0 : Math.min(1, p / 0.6);
      return (
        <g>
          <DragHandle role="button" label={`Bulb ${part.id}, ${removed ? "unscrewed. Press Enter to screw it back in." : `${glow > 0.05 ? "lit" : "off"}. Press Enter to unscrew it.`}`} disabled={readOnly} onActivate={() => onBulb(part.id, removed)} ring={{ cx: x, cy: y, r: 20 }} pulse={bulbPulse && !removed}>
            {!removed ? (
              g(
                <>
                  <circle r={34} fill="url(#cw-glow)" opacity={glow} />
                  <circle r={16} fill={glow > 0.05 ? `rgba(255,${200 + glow * 55},${120 + glow * 100},${0.25 + glow * 0.6})` : "rgba(255,255,255,.07)"} stroke="#e9ecef" strokeWidth={2} />
                  <path d="M -9 0 q 4.5 -9 9 0 q 4.5 9 9 0" fill="none" stroke={glow > 0.05 ? `rgb(255,${150 + glow * 105},${80 + glow * 150})` : "#868e96"} strokeWidth={1.8} />
                  <circle r={22} fill="transparent" />
                </>,
              )
            ) : (
              <g transform={`translate(${x} ${y}) rotate(${rot})`}>
                <line x1={-HALF} y1={0} x2={-16} y2={0} stroke="#9fb0cc" strokeWidth={3} />
                <line x1={16} y1={0} x2={HALF} y2={0} stroke="#9fb0cc" strokeWidth={3} />
                <circle r={16} fill="rgba(255,255,255,.02)" stroke="#5b6680" strokeDasharray="4 4" />
                <circle r={22} fill="transparent" />
              </g>
            )}
          </DragHandle>
          {label(removed ? `${part.id} (unscrewed)` : `bulb ${part.id}`)}
        </g>
      );
    }
    case "ammeter":
    case "voltmeter": {
      const v = meterValue(r, part.id, part.kind);
      const max = part.kind === "ammeter" ? (v <= 0.5 ? 0.5 : v <= 1 ? 1 : 5) : Math.max(1, Math.ceil(battV));
      return (
        <g>
          <g transform={`translate(${x} ${y})`}>
            <line x1={vertical ? 0 : -HALF} y1={vertical ? -HALF : 0} x2={vertical ? 0 : HALF} y2={vertical ? HALF : 0} stroke="#9fb0cc" strokeWidth={3} />
            <MeterDial value={v} max={max} kind={part.kind} />
          </g>
          <text x={x + (vertical ? 32 : 0)} y={y + (vertical ? 4 : 40)} fontSize={13} fontWeight={800} fill="#fff" textAnchor={vertical ? "start" : "middle"} fontFamily="JetBrains Mono, monospace" pointerEvents="none">
            <Num svg value={v} digits={part.kind === "ammeter" ? 3 : 2} /> {part.kind === "ammeter" ? "A" : "V"}
          </text>
        </g>
      );
    }
    default:
      return g(<rect x={-15} y={-8} width={30} height={16} fill="#495057" />);
  }
}

/** A round analogue dial with a sprung needle. */
function MeterDial({ value, max, kind }: { value: number; max: number; kind: "ammeter" | "voltmeter" }) {
  const reduced = useReducedMotion();
  const a = -60 + Math.min(1.05, Math.abs(value) / max) * 120;
  return (
    <g filter="url(#cw-shadow)">
      <circle r={24} fill="#f3efe4" stroke="#1f2937" strokeWidth={2} />
      <path d="M -17 4 A 19 19 0 0 1 17 4" fill="none" stroke="#9ca3af" strokeWidth={1} transform="translate(0 2)" />
      {Array.from({ length: 7 }, (_, i) => {
        const t = ((-60 + i * 20) * Math.PI) / 180;
        return <line key={i} x1={Math.sin(t) * 15} y1={8 - Math.cos(t) * 15} x2={Math.sin(t) * 19} y2={8 - Math.cos(t) * 19} stroke="#1f2937" strokeWidth={i % 3 === 0 ? 1.2 : 0.6} />;
      })}
      <text y={17} textAnchor="middle" fontSize={10} fontWeight={900} fill="#1f2937">
        {kind === "ammeter" ? "A" : "V"}
      </text>
      <motion.g animate={{ rotate: a }} initial={false} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 140, damping: 9, mass: 0.6 }} style={{ originX: "0px", originY: "8px" }}>
        <line x1={0} y1={8} x2={0} y2={-12} stroke="#d93348" strokeWidth={1.6} strokeLinecap="round" />
      </motion.g>
      <circle cy={8} r={2.4} fill="#1f2937" />
    </g>
  );
}

function SwitchPart({ x, y, rot, vertical, closed, lever, setLever, onSwitch, readOnly, pulse, label }: { x: number; y: number; rot: number; vertical: boolean; closed: boolean; lever: number; setLever: (v: number | null) => void; onSwitch: (c: boolean) => void; readOnly: boolean; pulse: boolean; label: React.ReactNode }) {
  // pivot of the lever, in board coordinates
  const pv = vertical ? { x, y: y - 14 } : { x: x - 14, y };
  const angleAt = (p: Pt) => {
    const dx = p.x - pv.x;
    const dy = p.y - pv.y;
    const lx = vertical ? dy : dx;
    const ly = vertical ? -dx : dy;
    return Math.max(-45, Math.min(0, (Math.atan2(ly, lx) * 180) / Math.PI));
  };
  const reduced = useReducedMotion();
  return (
    <g>
      <DragHandle
        role="switch"
        checked={closed}
        label={`Switch, ${closed ? "closed" : "open"}. Drag the lever, or press Enter, to ${closed ? "open" : "close"} it.`}
        disabled={readOnly}
        ring={{ cx: x + (vertical ? 0 : 0), cy: y, r: 20 }}
        pulse={pulse}
        onDrag={(p) => setLever(angleAt(p))}
        onDragEnd={(p, moved) => {
          setLever(null);
          if (!moved) return;
          const want = angleAt(p) > -14;
          if (want !== closed) onSwitch(want);
        }}
        onActivate={() => onSwitch(!closed)}
      >
        <g transform={`translate(${x} ${y}) rotate(${rot})`}>
          <rect x={-30} y={-24} width={60} height={34} rx={8} fill="#141c33" stroke={closed ? "rgba(61,232,168,.5)" : "#3a4766"} />
          <line x1={-HALF} y1={0} x2={-14} y2={0} stroke="#9fb0cc" strokeWidth={3} />
          <line x1={14} y1={0} x2={HALF} y2={0} stroke="#9fb0cc" strokeWidth={3} />
          <circle cx={14} cy={0} r={4} fill="url(#cw-post)" />
          <g style={{ transform: `translate(-14px, 0px) rotate(${lever}deg)`, transition: reduced ? "none" : "transform .18s cubic-bezier(.3,1.6,.5,1)" }}>
            <line x1={0} y1={0} x2={32} y2={0} stroke={closed ? V3.mint : V3.amber} strokeWidth={4.5} strokeLinecap="round" />
            <circle cx={32} cy={0} r={5.5} fill={closed ? V3.mint : V3.amber} stroke="#0b1730" strokeWidth={2} />
          </g>
          <circle cx={-14} cy={0} r={4.5} fill="url(#cw-post)" />
        </g>
      </DragHandle>
      {label}
    </g>
  );
}

function RheostatPart({ part, x, y, rheo, setRheo, commitRheo, readOnly, pulse, label, g }: { part: Component; x: number; y: number; rheo: number; setRheo: (v: number | null) => void; commitRheo: (v: number, later: boolean) => void; readOnly: boolean; pulse: boolean; label: React.ReactNode; g: (c: React.ReactNode) => React.ReactNode }) {
  const wx = x - 28 + rheo * 56;
  const [live, setLive] = useState<number | null>(null);
  return (
    <g>
      {g(
        <>
          <rect x={-32} y={-11} width={64} height={22} rx={5} fill="#2b3142" stroke="#8794ad" filter="url(#cw-shadow)" />
          {Array.from({ length: 14 }, (_, i) => (
            <line key={i} x1={-29 + i * 4.4} y1={-10} x2={-29 + i * 4.4} y2={10} stroke="#c9a46b" strokeWidth={1.3} />
          ))}
          <rect x={-32} y={-26} width={64} height={4} rx={2} fill="#5b6680" />
        </>,
      )}
      <DragHandle
        label={`Rheostat wiper. Drag it left or right, or use the arrow keys. ${Math.round((part.value ?? 50) * rheo)} ohms in the circuit.`}
        valueText={`${Math.round(rheo * 100)} percent, ${Math.round((part.value ?? 50) * rheo)} ohms`}
        value={rheo}
        min={0}
        max={1}
        disabled={readOnly}
        ring={{ cx: wx, cy: y - 30, r: 9 }}
        pulse={pulse}
        onDrag={(p) => {
          const v = Math.round(Math.max(0, Math.min(1, (p.x - (x - 28)) / 56)) * 100) / 100;
          setLive(v);
          setRheo(v);
        }}
        onDragEnd={(_p, moved) => {
          if (moved && live !== null) commitRheo(live, false);
          setLive(null);
        }}
        onKey={(key, shift) => {
          const st = shift ? 0.1 : 0.02;
          const next = key === "ArrowRight" || key === "ArrowUp" ? Math.min(1, rheo + st) : key === "ArrowLeft" || key === "ArrowDown" ? Math.max(0, rheo - st) : null;
          if (next === null) return false;
          const v = Math.round(next * 100) / 100;
          setRheo(v);
          commitRheo(v, true);
          return true;
        }}
      >
        <rect x={wx - 14} y={y - 44} width={28} height={30} fill="transparent" />
        <line x1={wx} y1={y - 24} x2={wx} y2={y - 11} stroke="#dbe7ff" strokeWidth={2} />
        <rect x={wx - 8} y={y - 38} width={16} height={14} rx={4} fill={live !== null ? V3.cyan : "#dbe7ff"} stroke="#0b1730" strokeWidth={1.5} />
        <path d={`M${wx - 4} ${y - 11} l4 6 l4 -6 z`} fill="#dbe7ff" />
      </DragHandle>
      {label}
    </g>
  );
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

function BigMeter({ label, value, digits, unit, tone }: { label: string; value: number; digits: number; unit: string; tone: string }) {
  return (
    <div className="rounded-[14px] bg-[#040a1c]/60 px-3 py-2.5 ring-1 ring-inset ring-[rgba(140,180,255,.12)]">
      <div className="ls-kicker">{label}</div>
      <div className="font-mono text-[26px] font-bold leading-8" style={{ color: tone }}>
        <Num value={value} digits={digits} />
        <span className="ml-1 text-sm text-white/45">{unit}</span>
      </div>
    </div>
  );
}

function OhmsPanel({ session, r, rheo, focus }: { session: SimSession<CircuitState>; r: ReturnType<typeof circuitNow>; rheo: number; focus: string | null }) {
  const s = session.state;
  const rheoPart = s.parts.find((p) => p.kind === "rheostat")!;
  const fit = fitR(s.readings);
  const ro = session.readOnly;
  return (
    <>
      <Panel title="Meters" glow={!ro && focus === "readings"}>
        <div className="grid grid-cols-2 gap-2">
          <BigMeter label="Voltmeter" value={meterValue(r, "V", "voltmeter")} digits={2} unit="V" tone={V3.cyan} />
          <BigMeter label="Ammeter" value={meterValue(r, "A", "ammeter")} digits={3} unit="A" tone={V3.amber} />
        </div>
        <div className="mt-3 space-y-3">
          <SwitchButton session={session} />
          <ParamSlider guideId="param:rheostat" label="Rheostat" value={rheo} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * (rheoPart.value ?? 50))} Ω`} onCommit={(v) => session.dispatch("param.set", { key: "rheostat", value: v })} disabled={ro} />
        </div>
      </Panel>
      <Panel title="Record your readings" glow={!ro && focus === "readings"}>
        <p className="mb-2 text-xs text-[#8fa6d1]">Write down what each meter shows. A reading is complete when you have both V and I.</p>
        <div className="space-y-2">
          <ReadingInput label="Voltmeter reading" unit="V" onRecord={(v) => session.dispatch("measure.read", { instrument: "voltmeter", reading: { key: "V", value: v, unit: "V" } })} value={submitted(session.events, "V", "voltmeter")} disabled={ro} />
          <ReadingInput label="Ammeter reading" unit="A" onRecord={(v) => session.dispatch("measure.read", { instrument: "ammeter", reading: { key: "I", value: v, unit: "A" } })} value={submitted(session.events, "I", "ammeter")} disabled={ro} />
        </div>
        {(s.pending.V !== null || s.pending.I !== null) && <p className="mt-2 text-xs text-[#ffc23d]">Half a reading: {s.pending.V !== null ? `V = ${s.pending.V}` : `I = ${s.pending.I}`}. Now record the other meter.</p>}
      </Panel>
      <Panel title={`Readings (${s.readings.length}/5)`} glow={!ro && focus === "result"}>
        {s.readings.length > 0 && (
          <table className="mb-2 w-full text-xs">
            <thead className="text-[#8fa6d1]">
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
        <LiveGraph series={[{ label: "readings", colour: V3.cyan, mode: "scatter", points: s.readings.filter((x) => x.V !== null && x.I !== null).map((x) => ({ x: x.I!, y: x.V! })) }]} xLabel="I / A" yLabel="V / V" height={150} fitOrigin />
        <div className="mt-2">
          <ReadingInput label="Gradient = R" unit="Ω" onRecord={(v) => session.dispatch("param.set", { key: "result:R", value: v })} value={submitted(session.events, "result:R")} disabled={ro || s.readings.length < 2} />
          {fit !== null && <p className="mt-1 text-[11px] text-[#8fa6d1]">Tip: the dashed line is the best fit through the origin.</p>}
        </div>
      </Panel>
    </>
  );
}

function SeriesPanel({ session, focus }: { session: SimSession<CircuitState>; focus: string | null }) {
  const s = session.state;
  const r = circuitNow(s);
  const cfg = bulbConfig(s);
  const ro = session.readOnly;
  return (
    <>
      <Panel title="Circuit" glow={!ro && (focus === "series-read" || focus === "parallel-read")}>
        <div className="grid grid-cols-2 gap-2">
          <BigMeter label="Ammeter" value={meterValue(r, "A", "ammeter")} digits={3} unit="A" tone={V3.amber} />
          <Readout label="Bulbs are in" value={cfg ?? "–"} tone={cfg ? "good" : "default"} />
        </div>
        <div className="mt-3">
          <SwitchButton session={session} />
        </div>
        <div className="mt-3">
          <ReadingInput label="Ammeter reading" unit="A" onRecord={(v) => session.dispatch("measure.read", { instrument: "ammeter", reading: { key: "I", value: v, unit: "A" } })} value={submitted(session.events, "I", "ammeter")} disabled={ro} />
        </div>
      </Panel>
      <Panel title="Bulbs" glow={!ro && focus === "unscrew"}>
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
        <p className="mt-2 text-[11px] text-[#8fa6d1]">Or click a bulb on the board to unscrew it.</p>
      </Panel>
      <Panel title="Your results">
        <div className="grid grid-cols-2 gap-2">
          <Readout label="Series current" value={s.ammeter.series ?? "–"} unit={s.ammeter.series !== undefined ? "A" : ""} />
          <Readout label="Parallel current" value={s.ammeter.parallel ?? "–"} unit={s.ammeter.parallel !== undefined ? "A" : ""} />
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-[#8fa6d1]">
          <Trash2 className="h-3 w-3" /> To rewire, click a wire to remove it.
        </p>
      </Panel>
    </>
  );
}

