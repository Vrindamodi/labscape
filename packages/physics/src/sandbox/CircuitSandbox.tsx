import { FlipHorizontal2, Info, Redo2, RotateCw, Trash2, Undo2, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { BAND_HEX, colourBands, solve, type CircuitResult, type Component, type ComponentKind, type Wire } from "../core/circuit";
import { useHistory } from "../ui/history";
import { Btn, Panel, ParamSlider, Readout, sf } from "../ui/kit";
import { brightness, BULB_FULL_W, explainCircuit, PART_INFO, storyOf, type EditAction, type Line, type Solved, type Story, type Tone } from "./circuitStory";

/**
 * A part on the free board. Terminals are "<id>.a" and "<id>.b" (a = + for batteries, anode for LEDs).
 * `vertical` turns it 90°, `flip` a further 180°, so a part has four orientations.
 */
export type BoardPart = { id: string; kind: Exclude<ComponentKind, "wire" | "cell" | "rheostat">; x: number; y: number; vertical?: boolean; flip?: boolean; value?: number; closed?: boolean; blown?: boolean };
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
  fuse: {
    label: "Fuse that blows",
    build: {
      parts: [
        { id: "B1", kind: "battery", x: 200, y: 420, value: 6 },
        { id: "S1", kind: "switch", x: 200, y: 160, closed: false },
        { id: "F1", kind: "fuse", x: 400, y: 160, value: 1 },
        { id: "L1", kind: "bulb", x: 560, y: 280, value: 12, vertical: true },
        { id: "L2", kind: "bulb", x: 680, y: 280, value: 12, vertical: true },
        { id: "L3", kind: "bulb", x: 800, y: 280, value: 12, vertical: true },
      ],
      wires: [["B1.a", "S1.b"], ["S1.a", "F1.b"], ["F1.a", "L1.b"], ["L1.b", "L2.b"], ["L2.b", "L3.b"], ["B1.b", "L1.a"], ["L1.a", "L2.a"], ["L2.a", "L3.a"]],
    },
  },
  led: {
    label: "LED one way",
    build: {
      parts: [
        { id: "B1", kind: "battery", x: 200, y: 420, value: 6 },
        { id: "R1", kind: "resistor", x: 360, y: 160, value: 220 },
        { id: "D1", kind: "led", x: 600, y: 160, flip: true },
      ],
      wires: [["B1.a", "R1.b"], ["R1.a", "D1.a"], ["D1.b", "B1.b"]],
    },
  },
};

/** 0-3: quarter turns clockwise. */
const rotOf = (p: Pick<BoardPart, "vertical" | "flip">) => (p.vertical ? 1 : 0) + (p.flip ? 2 : 0);
const fromRot = (r: number) => ({ vertical: r % 2 === 1, flip: r >= 2 });

export function terminalsOf(p: BoardPart): Record<string, { x: number; y: number }> {
  const [dx, dy] = [[HALF, 0], [0, HALF], [-HALF, 0], [0, -HALF]][rotOf(p)]!;
  return { [`${p.id}.a`]: { x: p.x + dx!, y: p.y + dy! }, [`${p.id}.b`]: { x: p.x - dx!, y: p.y - dy! } };
}

export const toComponents = (parts: BoardPart[]): Component[] =>
  parts.map((p) => ({ id: p.id, kind: p.kind, ...(p.value !== undefined ? { value: p.value } : {}), ...(p.kind === "battery" ? { internal: 0.2 } : {}), ...(p.kind === "switch" ? { closed: !!p.closed } : {}), ...(p.blown ? { blown: true } : {}) }));

/** Solves a board and marks fuses that melt, so the stored board matches what the solver found. */
export function settle(b: CircuitBuild): Solved {
  const result = solve(toComponents(b.parts), b.wires);
  const newly = result.blownFuses.filter((id) => b.parts.some((p) => p.id === id && !p.blown));
  return { build: newly.length ? { ...b, parts: b.parts.map((p) => (newly.includes(p.id) ? { ...p, blown: true } : p)) } : b, result };
}

/**
 * Current along each wire (A), positive from wire[0] to wire[1]. Wires join terminals into nodes,
 * so the solver has no wire currents: within each node, a spanning tree of its wires carries what
 * each terminal pushes in (Kirchhoff's current law). Redundant wires in a cycle get 0.
 */
export function wireFlows(parts: BoardPart[], wires: Wire[], r: CircuitResult): number[] {
  const inj = new Map<string, number>();
  for (const p of parts) {
    const i = r.components[p.id]?.current ?? 0;
    const src = p.kind === "battery";
    inj.set(`${p.id}.a`, src ? i : -i);
    inj.set(`${p.id}.b`, src ? -i : i);
  }
  const adj = new Map<string, { to: string; w: number }[]>();
  wires.forEach(([a, b], w) => {
    adj.set(a, [...(adj.get(a) ?? []), { to: b, w }]);
    adj.set(b, [...(adj.get(b) ?? []), { to: a, w }]);
  });
  const flows = wires.map(() => 0);
  const seen = new Set<string>();
  for (const root of adj.keys()) {
    if (seen.has(root)) continue;
    const order: string[] = [];
    const parent = new Map<string, { from: string; w: number }>();
    seen.add(root);
    const queue = [root];
    while (queue.length) {
      const t = queue.shift()!;
      order.push(t);
      for (const e of adj.get(t) ?? []) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        parent.set(e.to, { from: t, w: e.w });
        queue.push(e.to);
      }
    }
    const sub = new Map<string, number>(order.map((t) => [t, inj.get(t) ?? 0]));
    for (const t of order.reverse()) {
      const p = parent.get(t);
      if (!p) continue;
      const s = sub.get(t)!;
      flows[p.w] = wires[p.w]![0] === t ? s : -s;
      sub.set(p.from, sub.get(p.from)! + s);
    }
  }
  return flows;
}

/** A wire whose removal un-bypasses part `id` (its two ends no longer joined), or -1. */
export function bypassWire(b: CircuitBuild, id: string): number {
  const joined = (wires: Wire[]) => {
    const p = new Map<string, string>();
    const find = (x: string): string => (p.get(x) === undefined || p.get(x) === x ? x : find(p.get(x)!));
    wires.forEach(([a, c]) => p.set(find(a), find(c)));
    return find(`${id}.a`) === find(`${id}.b`);
  };
  if (!joined(b.wires)) return -1;
  const fixes = b.wires.map((_, i) => i).filter((i) => !joined(b.wires.filter((_, j) => j !== i)));
  // Prefer the wire that skips past the part over the ones that lead into it.
  return fixes.find((i) => !b.wires[i]!.some((t) => t.startsWith(`${id}.`))) ?? fixes[0] ?? -1;
}

const snap = (v: number) => Math.round(v / GRID) * GRID;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const TONE_TEXT: Record<Tone, string> = { good: "text-[#9ff0bf]", info: "text-white/75", warn: "text-[#fcd27b]", bad: "text-[#ffb4b4]" };
const TONE_CARD: Record<Tone, string> = { good: "border-[#3de8a8]/40 bg-[#3de8a8]/10", info: "border-[#5fd4ff]/35 bg-[#5fd4ff]/10", warn: "border-[#ffc23d]/45 bg-[#ffc23d]/10", bad: "border-[#ff5b6b]/55 bg-[#ff5b6b]/15" };

/**
 * Free circuit builder (build plan 4.9): drop parts, wire terminal to terminal, and the same
 * nodal-analysis solver the experiments use answers instantly. Shorts, blown fuses, ammeters
 * across a part and voltmeters in series all behave as they would on a real bench. Every edit is
 * explained in plain words, and can be undone.
 */
export function CircuitSandbox({ initial, onChange }: { initial?: CircuitBuild | null; onChange?: (b: CircuitBuild) => void }) {
  const [story, setStory] = useState<(Story & { key: number }) | null>(null);
  const storySeq = useRef(0);
  const stepped = useRef<"undo" | "redo" | null>(null);
  const hist = useHistory<CircuitBuild>(() => settle(initial ?? CIRCUIT_EXAMPLES.loop!.build).build, (k) => (stepped.current = k));
  const build = hist.value;
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [hl, setHl] = useState<string[]>([]);
  const [sparks, setSparks] = useState<Record<string, number>>({});
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean; seq: number } | null>(null);
  const dragSeq = useRef(0);
  const slide = useRef<{ id: string; before: CircuitBuild; from: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => onChangeRef.current?.(build), [build]);

  const result = useMemo(() => solve(toComponents(build.parts), build.wires), [build]);
  const flows = useMemo(() => wireFlows(build.parts, build.wires, result), [build, result]);
  const explained = useMemo(() => explainCircuit({ build, result }), [build, result]);

  const say = useCallback((s: Story | null) => s && setStory({ ...s, key: ++storySeq.current }), []);
  // Undo/redo (buttons or keys) land here once the board has changed.
  const prevBuild = useRef(build);
  useEffect(() => {
    if (stepped.current && prevBuild.current !== build) {
      say(storyOf({ build: prevBuild.current, result: solve(toComponents(prevBuild.current.parts), prevBuild.current.wires) }, { build, result }, { kind: stepped.current }));
      stepped.current = null;
    }
    prevBuild.current = build;
  }, [build, result, say]);

  /** Every edit goes through here: settle fuses, record one undo step, explain what changed. */
  const commit = (action: EditAction, f: (b: CircuitBuild) => CircuitBuild, opts?: { group?: string; mergeMs?: number }) => {
    const next = settle(f(build));
    hist.set(() => next.build, opts);
    const blown = Object.keys(next.result.fuseTrip ?? {});
    if (blown.length) setSparks((s) => ({ ...s, ...Object.fromEntries(blown.map((id) => [id, Date.now()])) }));
    if (action.kind !== "move" || blown.length) say(storyOf({ build, result }, next, action));
  };

  const term = useMemo(() => Object.assign({}, ...build.parts.map(terminalsOf)) as Record<string, { x: number; y: number }>, [build.parts]);
  const sourceI = build.parts.filter((p) => p.kind === "battery").reduce((m, p) => Math.max(m, Math.abs(result.components[p.id]?.current ?? 0)), 0);
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
    commit({ kind: "add", id }, (b) => ({ ...b, parts: [...b.parts, part] }));
    setSelected(id);
  };
  const patchOf = (id: string, p: Partial<BoardPart>) => (b: CircuitBuild) => ({ ...b, parts: b.parts.map((q) => (q.id === id ? { ...q, ...p } : q)) });
  const toggleSwitch = (p: BoardPart) => commit({ kind: "switch", id: p.id, closed: !p.closed }, patchOf(p.id, { closed: !p.closed }));
  const rotate = (p: BoardPart, by = 1) => commit({ kind: "rotate", id: p.id }, patchOf(p.id, fromRot((rotOf(p) + by) % 4)));
  const remove = (id: string) => {
    commit({ kind: "remove", id }, (b) => ({ parts: b.parts.filter((p) => p.id !== id), wires: b.wires.filter(([a, c]) => !a.startsWith(`${id}.`) && !c.startsWith(`${id}.`)) }));
    setSelected(null);
  };
  const clickTerminal = (t: string) => {
    if (!pending) return setPending(t);
    if (pending === t || pending.split(".")[0] === t.split(".")[0]) return setPending(null);
    const [a, b] = [pending, t];
    if (!build.wires.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) commit({ kind: "wire" }, (bd) => ({ ...bd, wires: [...bd.wires, [a, b]] }));
    setPending(null);
  };
  const removeWire = (i: number) => commit({ kind: "unwire" }, (b) => ({ ...b, wires: b.wires.filter((_, j) => j !== i) }));
  const setValue = (p: BoardPart, v: number) => {
    if (!slide.current || slide.current.id !== p.id) slide.current = { id: p.id, before: build, from: p.value ?? SPEC[p.kind].value!.def };
    commit({ kind: "move" }, patchOf(p.id, { value: v }), { group: `value:${p.id}`, mergeMs: 4000 });
  };
  const settleValue = (p: BoardPart, v: number) => {
    const s = slide.current;
    slide.current = null;
    if (!s || s.id !== p.id || s.from === v) return;
    say(storyOf({ build: s.before, result: solve(toComponents(s.before.parts), s.before.wires) }, settle(build), { kind: "value", id: p.id, from: s.from, to: v }));
  };

  const onPartDown = (e: PointerEvent, p: BoardPart) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const q = toSvg(e);
    drag.current = { id: p.id, dx: q.x - p.x, dy: q.y - p.y, moved: false, seq: ++dragSeq.current };
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
      commit({ kind: "move" }, patchOf(d.id, { x, y }), { group: `drag:${d.seq}`, mergeMs: 600_000 });
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    // A tap on a switch toggles it.
    if (d && !d.moved) {
      const p = build.parts.find((pp) => pp.id === d.id);
      if (p?.kind === "switch") toggleSwitch(p);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") return setPending(null), setSelected(null);
    if (!sel || e.ctrlKey || e.metaKey) return;
    const step = e.shiftKey ? GRID * 5 : GRID;
    const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (mv[e.key]) {
      e.preventDefault();
      commit({ kind: "move" }, patchOf(sel.id, { x: clamp(sel.x + mv[e.key]![0], 60, W - 60), y: clamp(sel.y + mv[e.key]![1], 50, H - 50) }), { group: `key:${sel.id}` });
    } else if (e.key === "Delete" || e.key === "Backspace") remove(sel.id);
    else if (e.key === "r") rotate(sel);
    else if (e.key === " " && sel.kind === "switch") {
      e.preventDefault();
      toggleSwitch(sel);
    }
  };

  const reading = (p: BoardPart) => {
    const c = result.components[p.id];
    if (!c) return null;
    if (p.kind === "ammeter") return `${sf(Math.abs(c.current))} A`;
    if (p.kind === "voltmeter") return `${sf(Math.abs(c.voltage))} V`;
    return null;
  };
  const bypass = sel && result.bypassed.includes(sel.id) ? bypassWire(build, sel.id) : -1;
  const selInfo = sel ? explained.lines.filter((l) => l.ids?.includes(sel.id) && l.ids.length <= 2) : [];

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Add a part">
            {(Object.keys(SPEC) as BoardPart["kind"][]).map((k) => (
              <Btn key={k} onClick={() => add(k)} title={PART_INFO[k]}>
                + {SPEC[k].label}
              </Btn>
            ))}
          </div>
          <div className="ml-auto flex gap-1" role="toolbar" aria-label="History">
            <Btn tone="ghost" title="Undo (Ctrl+Z)" onClick={hist.undo} disabled={!hist.canUndo}>
              <Undo2 className="h-4 w-4" /> <span className="hidden sm:inline">Undo</span>
            </Btn>
            <Btn tone="ghost" title="Redo (Ctrl+Shift+Z)" onClick={hist.redo} disabled={!hist.canRedo}>
              <Redo2 className="h-4 w-4" /> <span className="hidden sm:inline">Redo</span>
            </Btn>
          </div>
        </div>
        <div className="relative overflow-hidden rounded-xl bg-[#0a1020] ring-1 ring-inset ring-white/[0.08]">
          <svg
            ref={svg}
            viewBox={`0 0 ${W} ${H}`}
            className="block w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-[#2f80ff]"
            tabIndex={0}
            role="application"
            aria-label="Circuit board. Add parts from the toolbar, drag to move, click two terminals to wire them. Arrow keys move the selected part, R rotates, Delete removes, Ctrl+Z undoes."
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
              <radialGradient id="cs-led-glow">
                <stop offset="0" stopColor="#ff6b6b" stopOpacity="0.9" />
                <stop offset="1" stopColor="#ff6b6b" stopOpacity="0" />
              </radialGradient>
              <filter id="cs-hot" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" />
              </filter>
            </defs>
            <rect width={W} height={H} fill="url(#cs-grid)" />

            {build.wires.map(([a, b], i) => {
              const p = term[a], q = term[b];
              if (!p || !q) return null;
              const hot = shorted && (result.shortPath.includes(a.split(".")[0]!) || result.shortPath.includes(b.split(".")[0]!));
              const d = `M${p.x} ${p.y} L${q.x} ${p.y} L${q.x} ${q.y}`;
              const f = flows[i] ?? 0;
              const amps = Math.abs(f);
              // Dot speed is proportional to the current in this wire (clamped so it stays visible).
              const pxPerS = clamp(160 * amps, 6, 600);
              return (
                <g key={i}>
                  {hot && <path d={d} fill="none" stroke="#ff4d4f" strokeWidth={12} filter="url(#cs-hot)" className="cs-pulse" />}
                  <path d={d} fill="none" stroke={hot ? "#ff4d4f" : amps > 1e-4 ? "#5fd4ff" : "#5b6478"} strokeWidth={3.5} strokeLinejoin="round" />
                  {amps > 1e-4 && <path d={d} fill="none" stroke={hot ? "#fff3bf" : "#e8fbff"} strokeWidth={4.5} strokeLinecap="round" strokeDasharray="0 16" className="cs-flow" style={{ animationDuration: `${16 / pxPerS}s`, animationDirection: f > 0 ? "normal" : "reverse" }} />}
                  <path d={d} fill="none" stroke="transparent" strokeWidth={14} className="cursor-pointer" onPointerDown={(e) => e.stopPropagation()} onClick={() => removeWire(i)}>
                    <title>{amps > 1e-4 ? `${sf(amps)} A flows along this wire. Click to remove it.` : "No current in this wire. Click to remove it."}</title>
                  </path>
                </g>
              );
            })}

            {build.parts.map((p) => (
              <PartGlyph key={p.id} p={p} selected={selected === p.id} lit={hl.includes(p.id)} power={Math.abs(result.components[p.id]?.power ?? 0)} on={!!result.components[p.id]?.on} reversed={p.kind === "led" && (result.components[p.id]?.voltage ?? 0) < -0.05} heat={p.kind === "fuse" ? Math.abs(result.components[p.id]?.current ?? 0) / (p.value ?? 1) : 0} meter={p.kind === "ammeter" ? Math.abs(result.components[p.id]?.current ?? 0) : p.kind === "voltmeter" ? Math.abs(result.components[p.id]?.voltage ?? 0) : 0} spark={sparks[p.id]} bypassed={result.bypassed.includes(p.id)} reading={reading(p)} onDown={(e) => onPartDown(e, p)} />
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
              >
                <title>{t.endsWith(".a") && t.startsWith("B") ? "+ terminal" : t.endsWith(".a") && t.startsWith("D") ? "+ leg (anode)" : "Terminal"}: click it, then another terminal, to join them with a wire</title>
              </circle>
            ))}
            {pending && pointer && term[pending] && <line x1={term[pending]!.x} y1={term[pending]!.y} x2={pointer.x} y2={pointer.y} stroke="#2f80ff" strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />}
          </svg>
          {shorted && (
            <div role="alert" className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-semibold text-white shadow-lg sm:text-sm">
              <Zap className="h-4 w-4 shrink-0" /> Short circuit: the battery is connected almost straight across itself.
            </div>
          )}
          <style>{`.cs-flow{animation:cs-flow linear infinite}@keyframes cs-flow{to{stroke-dashoffset:-16}}.cs-pulse{animation:cs-pulse 0.8s ease-in-out infinite alternate}@keyframes cs-pulse{from{opacity:.35}to{opacity:.9}}.cs-spark{animation:cs-spark 1.1s ease-out forwards;transform-box:fill-box;transform-origin:center}@keyframes cs-spark{0%{opacity:1;transform:scale(.3)}100%{opacity:0;transform:scale(2.4)}}@media (prefers-reduced-motion:reduce){.cs-flow,.cs-pulse,.cs-spark{animation:none}}`}</style>
        </div>
        {story && (
          <div key={story.key} role="status" aria-live="polite" className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${TONE_CARD[story.tone]}`}>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-white">{story.title}</div>
              <p className="text-white/80">{story.body}</p>
            </div>
            <button type="button" onClick={() => setStory(null)} className="grid h-7 w-7 shrink-0 place-items-center rounded text-white/50 hover:text-white" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <p className="text-xs text-white/45">Click a terminal, then another, to wire them. Click a wire to remove it. Tap a switch to flip it. Red terminals are + on batteries and the + leg on LEDs. Moving dots show the current (from + to −): faster dots, more current. Ctrl+Z undoes.</p>
      </div>

      <div className="min-w-0 space-y-3">
        <Panel title="Examples">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(CIRCUIT_EXAMPLES).map(([k, ex]) => (
              <Btn key={k} onClick={() => (commit({ kind: "example" }, () => structuredClone(ex.build)), setSelected(null))}>
                {ex.label}
              </Btn>
            ))}
            <Btn tone="ghost" onClick={() => (commit({ kind: "clear" }, () => ({ parts: [], wires: [] })), setSelected(null))}>
              Clear board
            </Btn>
          </div>
        </Panel>
        {sel ? (
          <Panel
            title={`${SPEC[sel.kind].label} ${sel.id}`}
            right={
              <div className="flex gap-1">
                <Btn tone="ghost" title="Rotate a quarter turn (R)" onClick={() => rotate(sel)}>
                  <RotateCw className="h-4 w-4" />
                </Btn>
                {(sel.kind === "led" || sel.kind === "battery") && (
                  <Btn tone="ghost" title="Flip it round (swap + and −)" onClick={() => rotate(sel, 2)}>
                    <FlipHorizontal2 className="h-4 w-4" />
                  </Btn>
                )}
                <Btn tone="danger" title="Remove (Delete)" onClick={() => remove(sel.id)}>
                  <Trash2 className="h-4 w-4" />
                </Btn>
              </div>
            }
          >
            <div className="space-y-3">
              <p className="flex gap-1.5 text-xs text-white/60">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8fa6d1]" />
                {PART_INFO[sel.kind]}
              </p>
              {SPEC[sel.kind].value && (
                <ParamSlider label={SPEC[sel.kind].value!.name} value={sel.value ?? SPEC[sel.kind].value!.def} min={SPEC[sel.kind].value!.min} max={SPEC[sel.kind].value!.max} step={SPEC[sel.kind].value!.step} unit={SPEC[sel.kind].value!.unit} onChange={(v) => setValue(sel, v)} onCommit={(v) => settleValue(sel, v)} />
              )}
              {sel.kind === "switch" && (
                <Btn tone={sel.closed ? "primary" : "secondary"} pressed={!!sel.closed} onClick={() => toggleSwitch(sel)}>
                  {sel.closed ? "Closed (on)" : "Open (off)"}
                </Btn>
              )}
              {sel.kind === "fuse" && sel.blown && <Btn onClick={() => commit({ kind: "replace-fuse", id: sel.id }, patchOf(sel.id, { blown: false }))}>Replace the fuse</Btn>}
              <div className="grid grid-cols-3 gap-2">
                <Readout label="Current" value={sf(Math.abs(result.components[sel.id]?.current ?? 0))} unit="A" />
                <Readout label="Voltage" value={sf(Math.abs(result.components[sel.id]?.voltage ?? 0))} unit="V" />
                <Readout label="Power" value={sf(Math.abs(result.components[sel.id]?.power ?? 0))} unit="W" />
              </div>
              {bypass >= 0 && (
                <div className="rounded-lg bg-[#ffc23d]/10 p-2 text-xs text-[#fcd27b] ring-1 ring-inset ring-[#ffc23d]/30">
                  <p>A wire joins both ends of {sel.id}, so the current goes round it and it reads 0. It is not really in the loop.</p>
                  <Btn className="mt-2 h-8" onClick={() => removeWire(bypass)}>
                    Remove the wire that skips {sel.id}
                  </Btn>
                </div>
              )}
              {selInfo.map((l, i) => (
                <p key={i} className={`text-xs ${TONE_TEXT[l.tone]}`}>
                  {l.text}
                </p>
              ))}
            </div>
          </Panel>
        ) : (
          <Panel title="Circuit">
            <div className="grid grid-cols-2 gap-2">
              <Readout label="Battery current" value={sf(sourceI)} unit="A" tone={shorted ? "bad" : "default"} />
              <Readout label="Parts" value={build.parts.length} />
            </div>
            <p className="mt-2 text-xs text-white/50">Select a part to change it, read its current, voltage and power, and find out what it does.</p>
          </Panel>
        )}
        <Explainer headline={explained.headline} lines={explained.lines} onHover={setHl} />
      </div>
    </div>
  );
}

function Explainer({ headline, lines, onHover }: { headline: Line; lines: Line[]; onHover: (ids: string[]) => void }) {
  return (
    <Panel title="What's happening">
      <p className={`text-sm font-semibold ${TONE_TEXT[headline.tone]}`} aria-live="polite">
        {headline.text}
      </p>
      <ul className="mt-2 space-y-1.5 text-[13px] leading-snug">
        {lines.map((l, i) => (
          <li key={i} className={`rounded-md px-1.5 py-1 ${TONE_TEXT[l.tone]} ${l.ids?.length ? "hover:bg-white/[0.05]" : ""}`} onPointerEnter={() => onHover(l.ids ?? [])} onPointerLeave={() => onHover([])}>
            {l.text}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PartGlyph({ p, selected, lit, power, on, reversed, heat, meter, spark, bypassed, reading, onDown }: { p: BoardPart; selected: boolean; lit: boolean; power: number; on: boolean; reversed: boolean; heat: number; meter: number; spark: number | undefined; bypassed: boolean; reading: string | null; onDown: (e: PointerEvent) => void }) {
  const rot = rotOf(p) * 90;
  const vert = rotOf(p) % 2 === 1;
  const glow = p.kind === "bulb" ? Math.min(1, power / BULB_FULL_W) : 0;
  const stroke = "#e7ecf7";
  const level = p.kind === "bulb" ? brightness(power) : null;
  // Meter scale: the next of 1, 2, 5, 10, 20 above the reading.
  const full = [1, 2, 5, 10, 20, 50].find((m) => meter <= m) ?? 100;
  const needle = -60 + 120 * Math.min(1, meter / full);
  const fuseCol = heat > 0.85 ? "#ff6b3d" : heat > 0.5 ? "#ffb347" : stroke;
  return (
    <g transform={`translate(${p.x} ${p.y})`} className="cursor-grab" onPointerDown={onDown} role="img" aria-label={`${SPEC[p.kind].label} ${p.id}${reading ? ` reads ${reading}` : ""}${level && level !== "off" ? `, ${level}` : ""}`}>
      <title>{`${SPEC[p.kind].label} ${p.id}. ${PART_INFO[p.kind]}`}</title>
      {glow > 0.01 && <circle r={26 + 40 * glow} fill="url(#cs-glow)" opacity={0.35 + 0.6 * glow} />}
      {glow > 0.4 &&
        Array.from({ length: 8 }, (_, k) => {
          const a = (k * Math.PI) / 4;
          return <line key={k} x1={Math.cos(a) * 22} y1={Math.sin(a) * 22} x2={Math.cos(a) * (24 + 14 * glow)} y2={Math.sin(a) * (24 + 14 * glow)} stroke="#ffe066" strokeWidth={2} strokeLinecap="round" opacity={glow} />;
        })}
      {p.kind === "led" && on && <circle r={34} fill="url(#cs-led-glow)" opacity={0.85} />}
      {(selected || lit) && <rect x={-52} y={-34} width={104} height={68} rx={10} fill="none" stroke={lit ? "#ffd43b" : "#2f80ff"} strokeWidth={lit ? 2.5 : 1} strokeDasharray={lit ? undefined : "5 4"} transform={vert ? "rotate(90)" : undefined} />}
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
            <text x={14} y={-10} textAnchor="middle" transform={`rotate(${-rot} 14 -10)`} className="fill-[#ff8787] text-[13px] font-bold">
              +
            </text>
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
            <circle r={16} fill={glow > 0.01 ? `rgba(255,212,59,${0.25 + 0.75 * glow})` : "#141b2e"} stroke={stroke} strokeWidth={2.5} />
            <path d="M-11 -11 L11 11 M11 -11 L-11 11" stroke={glow > 0.01 ? "#7a5200" : "#59607a"} strokeWidth={2} />
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
          <g transform={`rotate(${-rot})`}>
            <circle r={19} fill="#f3efe4" stroke={stroke} strokeWidth={2.5} />
            <path d="M-13 3 A14 14 0 0 1 13 3" fill="none" stroke="#9aa3b5" strokeWidth={1} />
            <text textAnchor="middle" y={13} className="fill-[#1f2937] text-[10px] font-bold">
              {p.kind === "ammeter" ? "A" : "V"}
            </text>
            <line x1={0} y1={6} x2={0} y2={-11} stroke="#e03131" strokeWidth={1.8} strokeLinecap="round" transform={`rotate(${needle} 0 6)`} style={{ transition: "transform 400ms cubic-bezier(.3,1.6,.5,1)" }} />
            <circle cy={6} r={2} fill="#1f2937" />
          </g>
        )}
        {p.kind === "led" && (
          <>
            <path d="M10 -12 L-10 0 L10 12 Z" fill={on ? "#ff6b6b" : "#141b2e"} stroke={stroke} strokeWidth={2} />
            <line x1={-10} y1={-12} x2={-10} y2={12} stroke={stroke} strokeWidth={3} />
            <line x1={-18} y1={0} x2={-10} y2={0} stroke={stroke} strokeWidth={3} />
            <line x1={10} y1={0} x2={18} y2={0} stroke={stroke} strokeWidth={3} />
          </>
        )}
        {p.kind === "fuse" && (
          <>
            <rect x={-18} y={-7} width={36} height={14} rx={2} fill="#141b2e" stroke={stroke} strokeWidth={2} />
            {p.blown ? (
              <>
                <path d="M-14 0 H-5 M5 0 H14" stroke="#ff6b6b" strokeWidth={2} />
                <circle cx={-4} cy={1.5} r={2.2} fill="#ffa94d" />
                <circle cx={4} cy={-1.5} r={2.2} fill="#ffa94d" />
              </>
            ) : (
              <line x1={-14} y1={0} x2={14} y2={0} stroke={fuseCol} strokeWidth={heat > 0.5 ? 2.5 : 1.5} />
            )}
          </>
        )}
      </g>
      {p.kind === "fuse" && p.blown && spark && (
        <g key={spark} className="cs-spark" pointerEvents="none">
          {Array.from({ length: 10 }, (_, k) => {
            const a = (k * Math.PI) / 5;
            return <line key={k} x1={Math.cos(a) * 6} y1={Math.sin(a) * 6} x2={Math.cos(a) * 22} y2={Math.sin(a) * 22} stroke={k % 2 ? "#ffd43b" : "#ff922b"} strokeWidth={2.5} strokeLinecap="round" />;
          })}
        </g>
      )}
      <text x={0} y={vert ? 4 : 34} dx={vert ? 30 : 0} textAnchor={vert ? "start" : "middle"} className="fill-white/60 text-[12px]">
        {p.id}
        {p.value !== undefined && SPEC[p.kind].value ? ` · ${p.value}${SPEC[p.kind].value!.unit}` : ""}
        {p.kind === "fuse" && p.blown ? " · melted" : ""}
      </text>
      {reversed && (
        <text x={0} y={vert ? 22 : -26} dx={vert ? 30 : 0} textAnchor={vert ? "start" : "middle"} className="fill-[#ffa8a8] text-[12px] font-semibold">
          ✕ backwards
        </text>
      )}
      {bypassed && (
        <text x={0} y={vert ? 22 : -26} dx={vert ? 30 : 0} textAnchor={vert ? "start" : "middle"} className="fill-[#fcd27b] text-[12px] font-semibold">
          bypassed
        </text>
      )}
      {reading && (
        <text x={0} y={vert ? 22 : -28} dx={vert ? 30 : 0} textAnchor={vert ? "start" : "middle"} className="fill-[#7cf3ff] font-mono text-[14px] font-semibold">
          {reading}
        </text>
      )}
    </g>
  );
}
