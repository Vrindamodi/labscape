import { Btn, GuideCard, Hint, Panel, ParamSlider, sf } from "@labscape/physics";
import { Eye, EyeOff, Pause, Play, Plus, Redo2, Scan, Trash2, TrendingUp, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { compile, derivative, parse, ParseError, toLatex, toText, typoHints, variables, type Node } from "../core/expr";
import { slopeAt } from "../core/numeric";
import { Plot, type Mapper, type View } from "../ui/Plot";
import { describe, paramEffect } from "./graphExplain";

/** `slope` also draws the function's slope (its derivative) as a dashed curve in the same colour. */
export type GraphFn = { src: string; colour: string; hidden?: boolean; slope?: boolean };
export type GraphBuild = { fns: GraphFn[]; params: Record<string, number>; view?: View };

const COLOURS = ["#a78bfa", "#f472b6", "#7cf3ff", "#ffd43b", "#51cf66", "#ff922b"];
const RESERVED = new Set(["x", "pi", "e", "tau", "theta"]);
const MAX_FNS = 6;
export const DEFAULT_GRAPH: GraphBuild = { fns: [{ src: "a*x^2 + b*x + c", colour: COLOURS[0]! }, { src: "m*x + c", colour: COLOURS[1]! }], params: { a: 1, b: 0, c: -2, m: 1 } };

const HOME_VIEW: View = { x0: -6, x1: 6, y0: -5, y1: 7 };

/** Ready-made graphs to start from. Each one is worth dragging a slider on. */
export const GRAPH_IDEAS: { id: string; label: string; hint: string; build: GraphBuild }[] = [
  { id: "line", label: "Straight line", hint: "m is the steepness, c is where it crosses the y-axis.", build: { fns: [{ src: "m*x + c", colour: COLOURS[0]! }], params: { m: 1, c: 0 }, view: HOME_VIEW } },
  { id: "parabola", label: "Parabola", hint: "Turn on its slope curve: the slope is a straight line that crosses 0 at the vertex.", build: { fns: [{ src: "a*x^2 + b*x + c", colour: COLOURS[0]! }], params: { a: 1, b: 0, c: -2 }, view: HOME_VIEW } },
  { id: "cubic", label: "S-bend cubic", hint: "Drag b below 0 to grow a hill and a valley.", build: { fns: [{ src: "a*x^3 + b*x", colour: COLOURS[2]! }], params: { a: 0.5, b: -2 }, view: { x0: -5, x1: 5, y0: -6, y1: 6 } } },
  { id: "waves", label: "Sine and cosine", hint: "A is the height of the wave, k squeezes it. Cosine is sine shifted a quarter turn.", build: { fns: [{ src: "A*sin(k*x)", colour: COLOURS[2]! }, { src: "A*cos(k*x)", colour: COLOURS[1]! }], params: { A: 2, k: 1 }, view: { x0: -7, x1: 7, y0: -4, y1: 4 } } },
  { id: "beats", label: "Beats", hint: "Two notes that are nearly the same pitch: bring f close to 1 and the loud-quiet pattern stretches out.", build: { fns: [{ src: "sin(x) + sin(f*x)", colour: COLOURS[3]! }], params: { f: 1.2 }, view: { x0: -32, x1: 32, y0: -3, y1: 3 } } },
  { id: "growth", label: "Growth and decay", hint: "A bigger k grows (and decays) faster. Both curves pass through (0, 1).", build: { fns: [{ src: "exp(k*x)", colour: COLOURS[4]! }, { src: "exp(-k*x)", colour: COLOURS[1]! }], params: { k: 0.5 }, view: { x0: -5, x1: 5, y0: -1, y1: 8 } } },
  { id: "spring", label: "Dying wobble", hint: "A swing that fades: d is how quickly it dies away, w is how fast it wobbles.", build: { fns: [{ src: "A*exp(-d*x)*cos(w*x)", colour: COLOURS[0]! }], params: { A: 3, d: 0.3, w: 3 }, view: { x0: -1, x1: 12, y0: -4, y1: 4 } } },
  { id: "reciprocal", label: "One over x", hint: "It never touches either axis. Make a negative to flip it.", build: { fns: [{ src: "a/x", colour: COLOURS[5]! }], params: { a: 1 }, view: HOME_VIEW } },
  { id: "bell", label: "Bell curve", hint: "m slides the peak along, s makes it wide or narrow.", build: { fns: [{ src: "exp(-(x - m)^2/(2*s^2))", colour: COLOURS[1]! }], params: { m: 0, s: 1 }, view: { x0: -5, x1: 5, y0: -0.4, y1: 1.6 } } },
  { id: "vee", label: "V shape", hint: "abs() makes everything positive, which folds the line into a V.", build: { fns: [{ src: "a*abs(x - h) + k", colour: COLOURS[3]! }], params: { a: 1, h: 0, k: -2 }, view: HOME_VIEW } },
  { id: "circle", label: "Circle from two halves", hint: "A circle isn't one function: the top and bottom halves are drawn separately. r is the radius.", build: { fns: [{ src: "sqrt(r^2 - x^2)", colour: COLOURS[2]! }, { src: "-sqrt(r^2 - x^2)", colour: COLOURS[2]! }], params: { r: 3 }, view: { x0: -8, x1: 8, y0: -4.5, y1: 4.5 } } },
];

type Compiled = { ok: true; node: Node; f: (s: Record<string, number>) => number; vars: string[]; slope: { node: Node; f: (s: Record<string, number>) => number } | null } | { ok: false; error: string };

/** The exact slope formula (the derivative), or null where the algebra can't give one (abs, floor...). */
function slopeOf(node: Node): { node: Node; f: (s: Record<string, number>) => number } | null {
  try {
    const d = derivative(node);
    return { node: d, f: compile(d) };
  } catch {
    return null;
  }
}

function build(src: string): Compiled {
  try {
    const node = parse(src);
    return { ok: true, node, f: compile(node), vars: [...variables(node)].filter((v) => !RESERVED.has(v)), slope: slopeOf(node) };
  } catch (e) {
    return { ok: false, error: e instanceof ParseError ? e.message : "Can't read that." };
  }
}

/** Sign-change scan plus bisection: the x-intercepts inside [x0, x1]. */
export function rootsIn(f: (x: number) => number, x0: number, x1: number, n = 600): number[] {
  const out: number[] = [];
  let px = x0, py = f(x0);
  for (let i = 1; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = f(x);
    if (Number.isFinite(py) && Number.isFinite(y)) {
      if (py === 0) out.push(px);
      else if (py * y < 0) {
        let a = px, b = x, fa = py;
        for (let k = 0; k < 50; k++) {
          const m = (a + b) / 2, fm = f(m);
          if (fa * fm <= 0) b = m;
          else {
            a = m;
            fa = fm;
          }
        }
        const mid = (a + b) / 2;
        const r = Math.abs(mid) < 1e-9 * Math.max(1, Math.abs(x1 - x0)) ? 0 : mid;
        // Reject poles (tan x, 1/x): a real root has a small value there.
        if (Math.abs(f(r)) < 1e-6 * Math.max(1, Math.abs(py), Math.abs(y))) out.push(r);
      }
    }
    px = x;
    py = y;
  }
  return out.filter((r, i) => i === 0 || Math.abs(r - out[i - 1]!) > 1e-6).slice(0, 8);
}

/**
 * Multi-function graphing (build plan 4.9). Any letter other than x becomes a slider; sliders can
 * sweep on their own. Roots, the y-intercept and where the first two curves cross are worked out
 * numerically from what is on screen.
 */
export function GraphSandbox({ initial, onChange, renderTex }: { initial?: GraphBuild | null; onChange?: (b: GraphBuild) => void; /** Renders LaTeX to HTML (the app passes KaTeX); plain text otherwise. */ renderTex?: (tex: string) => string }) {
  const [b, setB] = useState<GraphBuild>(() => initial ?? DEFAULT_GRAPH);
  const [view, setView] = useState<View>(() => initial?.view ?? HOME_VIEW);
  const [idea, setIdea] = useState<string | null>(null);
  const [sweep, setSweep] = useState<string | null>(null);
  const [probe, setProbe] = useState<number | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => cb.current?.({ ...b, view }), [b, view]);

  const compiled = useMemo(() => b.fns.map((f) => build(f.src)), [b.fns]);
  const paramNames = useMemo(() => [...new Set(compiled.flatMap((c) => (c.ok ? c.vars : [])))].sort(), [compiled]);
  const scope = useMemo(() => Object.fromEntries(paramNames.map((p) => [p, b.params[p] ?? 1])), [paramNames, b.params]);
  const fns = compiled.map((c) => (c.ok ? (x: number) => c.f({ ...scope, x }) : null));

  // Sweep a parameter back and forth between -5 and 5.
  useEffect(() => {
    if (!sweep) return;
    let raf = 0, last = performance.now(), dir = 1;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setB((x) => {
        let v = (x.params[sweep] ?? 1) + dir * dt * 2;
        if (v > 5) {
          v = 5;
          dir = -1;
        }
        if (v < -5) {
          v = -5;
          dir = 1;
        }
        return { ...x, params: { ...x.params, [sweep]: Math.round(v * 100) / 100 } };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sweep]);

  // Undo/redo: every edit snapshots the build first; typing in one box (or dragging one slider) within 800 ms counts as one edit.
  const past = useRef<GraphBuild[]>([]);
  const future = useRef<GraphBuild[]>([]);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const [, bump] = useState(0);
  const edit = (update: (x: GraphBuild) => GraphBuild, key?: string) => {
    const now = Date.now();
    const merge = !!key && lastKey.current?.key === key && now - lastKey.current.at < 800;
    lastKey.current = key ? { key, at: now } : null;
    if (!merge) {
      past.current = [...past.current.slice(-49), b];
      future.current = [];
      bump((n) => n + 1);
    }
    setB(update);
  };
  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    setSweep(null);
    future.current.push(b);
    lastKey.current = null;
    setB(prev);
    bump((n) => n + 1);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(b);
    lastKey.current = null;
    setB(next);
    bump((n) => n + 1);
  };
  const setFn = (i: number, p: Partial<GraphFn>, key?: string) => edit((x) => ({ ...x, fns: x.fns.map((f, j) => (j === i ? { ...f, ...p } : f)) }), key);
  const addFn = () => edit((x) => (x.fns.length >= MAX_FNS ? x : { ...x, fns: [...x.fns, { src: "", colour: COLOURS.find((c) => !x.fns.some((f) => f.colour === c)) ?? COLOURS[0]! }] }));
  const removeFn = (i: number) => edit((x) => ({ ...x, fns: x.fns.filter((_, j) => j !== i) }));
  const applyIdea = (id: string) => {
    const g = GRAPH_IDEAS.find((x) => x.id === id);
    if (!g) return;
    setSweep(null);
    setProbe(null);
    setIdea(id);
    edit(() => ({ fns: g.build.fns.map((f) => ({ ...f })), params: { ...g.build.params } }));
    if (g.build.view) setView(g.build.view);
  };

  const visible = b.fns.map((f, i) => ({ f, fn: fns[i], c: compiled[i]!, i })).filter((v): v is { f: GraphFn; fn: (x: number) => number; c: Extract<Compiled, { ok: true }>; i: number } => !!v.fn && v.c.ok && !v.f.hidden && v.f.src.trim() !== "");
  /** Slope of a curve at x: the exact formula when there is one, a tiny-step estimate otherwise. */
  const slopeFn = (v: (typeof visible)[number]) => (x: number) => (v.c.slope ? v.c.slope.f({ ...scope, x }) : slopeAt(v.fn, x));
  const curves = visible.flatMap((v) => [{ f: v.fn, colour: v.f.colour, width: 2.5 }, ...(v.f.slope ? [{ f: slopeFn(v), colour: v.f.colour, width: 1.6, dash: [7, 6] }] : [])]);
  /** Letters used by the other functions: the likely meaning of a glued-together typo. */
  const knownFor = (i: number) => [...new Set(compiled.flatMap((c, j) => (j !== i && c.ok ? c.vars : [])))];
  const crossings = visible.length >= 2 ? rootsIn((x) => visible[0]!.fn(x) - visible[1]!.fn(x), view.x0, view.x1) : [];

  const overlay = (m: Mapper) => (
    <g>
      {visible.flatMap(({ f, fn }) =>
        rootsIn(fn, view.x0, view.x1).map((r) => <circle key={`${f.colour}${r}`} cx={m.X(r)} cy={m.Y(0)} r={4.5} fill={f.colour} stroke="#0b0f1a" strokeWidth={1.5} />),
      )}
      {crossings.map((x) => (
        <circle key={`c${x}`} cx={m.X(x)} cy={m.Y(visible[0]!.fn(x))} r={6} fill="none" stroke="#fff" strokeWidth={2} />
      ))}
      {probe !== null && (
        <>
          <line x1={m.X(probe)} x2={m.X(probe)} y1={m.Y(view.y0)} y2={m.Y(view.y1)} stroke="#ffffff30" strokeDasharray="4 4" />
          {visible.map((v) => {
            const y = v.fn(probe), k = slopeFn(v)(probe);
            if (!Number.isFinite(y)) return null;
            // A short tangent through the traced point: the slope, drawn.
            const dx = (view.x1 - view.x0) * 0.12;
            return (
              <g key={v.i}>
                {Number.isFinite(k) && <line x1={m.X(probe - dx)} y1={m.Y(y - k * dx)} x2={m.X(probe + dx)} y2={m.Y(y + k * dx)} stroke="#ffffff" strokeOpacity={0.85} strokeWidth={1.5} strokeLinecap="round" />}
                <circle cx={m.X(probe)} cy={m.Y(y)} r={5} fill={v.f.colour} stroke="#0b0f1a" strokeWidth={1.5} />
              </g>
            );
          })}
        </>
      )}
    </g>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-2">
        <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-white/[0.08]">
          <Plot curves={curves} view={view} onView={setView} height={460} ariaLabel={`Graph of ${visible.map((v) => `y = ${v.f.src}`).join(", ") || "nothing yet"}`} overlay={overlay} />
        </div>
        <ParamSlider label="Trace x" value={probe ?? 0} min={Math.round(view.x0)} max={Math.round(view.x1)} step={0.05} onChange={setProbe} onCommit={setProbe} />
        <Hint>Trace x picks one x value (the dashed line). Each curve gets a dot there with a short white tangent line through it, and "What you're seeing" lists its y and its slope: how many it goes up for 1 step right at that exact point.</Hint>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-white/45">Drag to pan, scroll or pinch to zoom. Dots mark roots; white rings mark where the first two curves cross.</p>
          <Btn tone="ghost" className="h-8 px-2.5 text-xs" title="Back to the starting view" onClick={() => setView(GRAPH_IDEAS.find((g) => g.id === idea)?.build.view ?? HOME_VIEW)}>
            <Scan className="h-3.5 w-3.5" /> Reset view
          </Btn>
        </div>
        <GuideCard
          id="graphing"
          items={[
            { term: "The grid", text: "x goes across (left = negative, right = positive), y goes up. Every point on a curve is a pair (x, y) that makes the equation true." },
            { term: "y = ...", text: "Type a rule for y. For each x, the computer works out y and joins the dots. Use * for times and ^ for powers: 2*x^2 means 2 × x²." },
            { term: "Letters become sliders", text: "Any letter other than x (like m, c, a, b) gets a slider, so you can change it and watch the curve move. Each slider says what increasing it does." },
            { term: "Dots and rings", text: "A coloured dot on the x-axis is a root: where y = 0. A white ring is where the first two curves meet: there both rules give the same y, which solves f(x) = g(x)." },
            { term: "Slope curves", text: "The little graph button next to a function draws its slope as a dashed curve. Where the dashed curve is above 0 the function is going uphill; where it crosses 0 the function has a peak or a dip." },
            { term: "Try this", text: "In y = m*x + c, drag m (the steepness) and then c (where it crosses the y-axis). In y = a*x^2 + b*x + c, watch the vertex move as you drag b. Or pick one of the ideas on the right." },
          ]}
        />
      </div>
      <div className="space-y-3">
        <Panel
          title="Functions"
          right={
            <div className="flex gap-1">
              <Btn tone="ghost" onClick={undo} disabled={!past.current.length} title="Undo"><Undo2 className="h-4 w-4" /></Btn>
              <Btn tone="ghost" onClick={redo} disabled={!future.current.length} title="Redo"><Redo2 className="h-4 w-4" /></Btn>
              <Btn tone="ghost" onClick={addFn} disabled={b.fns.length >= MAX_FNS} title="Add a function"><Plus className="h-4 w-4" /></Btn>
            </div>
          }
        >
          <ul className="space-y-2">
            {b.fns.map((f, i) => {
              const c = compiled[i]!;
              return (
                <li key={i}>
                  <div className="flex items-center gap-1">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: f.colour }} />
                    <span className="font-mono text-sm text-white/60">y =</span>
                    <input value={f.src} onChange={(e) => setFn(i, { src: e.target.value }, `src${i}`)} placeholder="e.g. sin(k*x)" spellCheck={false} aria-label={`Function ${i + 1}`} aria-invalid={!c.ok && f.src.trim() !== ""} className="min-w-0 flex-1 rounded-md bg-white/[0.06] px-2 py-1.5 font-mono text-sm text-white ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-[#2f80ff]" />
                    <button onClick={() => setFn(i, { hidden: !f.hidden })} className="grid h-8 w-7 shrink-0 place-items-center rounded text-white/50 hover:text-white" aria-label={f.hidden ? "Show" : "Hide"} aria-pressed={!f.hidden}>
                      {f.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button onClick={() => setFn(i, { slope: !f.slope })} className={`grid h-8 w-7 shrink-0 place-items-center rounded hover:text-white ${f.slope ? "bg-white/[0.08] text-white" : "text-white/50"}`} aria-label={f.slope ? "Hide its slope curve" : "Show its slope curve"} aria-pressed={!!f.slope} title="Slope curve (dashed)">
                      <TrendingUp className="h-4 w-4" />
                    </button>
                    <button onClick={() => removeFn(i)} className="grid h-8 w-7 shrink-0 place-items-center rounded text-white/50 hover:text-red-300" aria-label="Remove">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {f.src.trim() !== "" && (c.ok ? (renderTex ? <div className="mt-1 overflow-x-auto pl-5 text-sm text-white/80" dangerouslySetInnerHTML={{ __html: renderTex(`y = ${toLatex(c.node)}`) }} /> : <p className="mt-1 pl-5 font-mono text-xs text-white/60">y = {toText(c.node)}</p>) : <p className="mt-1 pl-5 text-xs text-red-300">{c.error}</p>)}
                  {c.ok && f.slope && f.src.trim() !== "" && (
                    <div className="mt-1 flex items-center gap-1.5 pl-5 text-xs text-white/55">
                      <svg width="18" height="6" aria-hidden>
                        <line x1="0" y1="3" x2="18" y2="3" stroke={f.colour} strokeWidth="1.6" strokeDasharray="5 4" />
                      </svg>
                      {c.slope ? renderTex ? <span className="overflow-x-auto text-white/75" dangerouslySetInnerHTML={{ __html: renderTex(`\\text{slope} = ${toLatex(c.slope.node)}`) }} /> : <span className="font-mono">slope = {toText(c.slope.node)}</span> : <span>slope, estimated point by point</span>}
                    </div>
                  )}
                  {c.ok &&
                    typoHints(f.src, knownFor(i)).map((t) => (
                      <div key={`${t.at}${t.word}`} role="note" className="mt-1.5 ml-5 rounded-lg bg-[#ffc23d]/10 px-2.5 py-1.5 text-xs text-[#ffe3a3] ring-1 ring-inset ring-[#ffc23d]/30">
                        <p>
                          Letters typed together are multiplied: <span className="font-mono font-semibold">{t.word}</span> is read as <span className="font-mono font-semibold">{t.parts.join(" × ")}</span>
                          {t.parts.some((v) => !compiled.some((cc, j) => j !== i && cc.ok && cc.vars.includes(v))) ? ", and each new letter gets its own slider" : ""}.{t.suggestion ? <> Did you mean <span className="font-mono font-semibold">{t.suggestion}</span>?</> : null}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {t.fixed && (
                            <button type="button" onClick={() => setFn(i, { src: t.fixed! })} className="rounded-md bg-[#ffc23d]/20 px-2 py-1 font-semibold text-white hover:bg-[#ffc23d]/30">
                              Use {t.suggestion}
                            </button>
                          )}
                          <button type="button" onClick={() => setFn(i, { src: t.explicit })} className="rounded-md px-2 py-1 font-semibold text-[#ffe3a3] ring-1 ring-inset ring-[#ffc23d]/30 hover:bg-white/[0.06]">
                            I meant {t.parts.join("×")}
                          </button>
                        </div>
                      </div>
                    ))}
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="Start from an idea">
          <div className="flex flex-wrap gap-1.5">
            {GRAPH_IDEAS.map((g) => (
              <button key={g.id} type="button" onClick={() => applyIdea(g.id)} aria-pressed={idea === g.id} className={`h-8 rounded-[10px] px-2.5 text-[13px] font-semibold transition-colors ${idea === g.id ? "bg-[rgba(61,139,255,.3)] text-white shadow-[inset_0_0_0_1px_#6aa8ff]" : "bg-white/[0.06] text-[#c8d6f3] ring-1 ring-inset ring-white/10 hover:bg-white/[0.12] hover:text-white"}`}>
                {g.label}
              </button>
            ))}
          </div>
          {idea && <p className="mt-2 text-[12.5px] leading-snug text-white/65">{GRAPH_IDEAS.find((g) => g.id === idea)?.hint}</p>}
        </Panel>
        {paramNames.length > 0 && (
          <Panel title="Sliders">
            <div className="space-y-3">
              {paramNames.map((p) => (
                <div key={p} className="space-y-1">
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <ParamSlider label={p} value={scope[p]!} min={Math.min(-5, Math.floor(-2 * Math.abs(scope[p]!)))} max={Math.max(5, Math.ceil(2 * Math.abs(scope[p]!)))} step={0.1} onChange={(v) => edit((x) => ({ ...x, params: { ...x.params, [p]: v } }), `param${p}`)} onCommit={(v) => edit((x) => ({ ...x, params: { ...x.params, [p]: v } }), `param${p}`)} />
                    </div>
                    <Btn tone={sweep === p ? "primary" : "ghost"} pressed={sweep === p} title={`Sweep ${p}`} onClick={() => setSweep((s) => (s === p ? null : p))}>
                      {sweep === p ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Btn>
                  </div>
                  {visible
                    .filter((v) => v.c.vars.includes(p))
                    .map((v) => (
                      <p key={v.f.colour} className="flex gap-1.5 text-[11.5px] leading-snug text-white/55">
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: v.f.colour }} />
                        {paramEffect(p, scope[p]!, (val) => (x) => v.c.f({ ...scope, [p]: val, x }), v.c.node)}
                      </p>
                    ))}
                </div>
              ))}
            </div>
          </Panel>
        )}
        <Panel title="What you're seeing">
          <ul className="space-y-2.5 text-[13px] leading-snug">
            {visible.map((v) => {
              const { f, fn, c } = v;
              const roots = rootsIn(fn, view.x0, view.x1);
              const d = describe(fn, c.node);
              const k = probe !== null ? slopeFn(v)(probe) : NaN;
              const flats = f.slope ? rootsIn(slopeFn(v), view.x0, view.x1) : [];
              return (
                <li key={v.i} className="text-white/75">
                  <div className="mb-0.5 flex items-center gap-1.5 font-mono text-xs text-white">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: f.colour }} />y = {f.src}
                  </div>
                  {d.text.map((t, k) => (
                    <p key={k}>{t}</p>
                  ))}
                  {d.kind !== "line" && d.kind !== "parabola" && d.kind !== "constant" && <p>{roots.length ? `On screen it crosses the x-axis (y = 0) at x = ${roots.map((r) => sf(r)).join(", ")}.` : "It does not cross the x-axis on screen."}</p>}
                  {f.slope && (
                    <p>
                      The dashed curve is its slope at every x. {flats.length ? `It crosses 0 at x = ${flats.map((r) => sf(r)).join(", ")}: exactly where this curve is flat (a peak, a dip or a level step).` : "It never crosses 0 on screen, so this curve has no peak or dip here."}
                    </p>
                  )}
                  {probe !== null && Number.isFinite(fn(probe)) && Number.isFinite(k) && (
                    <p className="text-[#bfe9ff]">
                      At x = {sf(probe)}: y = {sf(fn(probe))}. Slope there = {sf(k)} (the white tangent line), so it is {Math.abs(k) < 1e-3 ? "flat at that point" : k > 0 ? "going uphill" : "going downhill"}.
                    </p>
                  )}
                </li>
              );
            })}
            {crossings.length > 0 && (
              <li className="text-white">
                The first two curves meet at x = {crossings.map((x) => sf(x)).join(" and ")}. There both rules give the same y ({crossings.map((x) => sf(visible[0]!.fn(x))).join(" and ")}), so {crossings.length > 1 ? "these x values solve" : "this x solves"} {visible[0]!.f.src} = {visible[1]!.f.src}.
              </li>
            )}
            {visible.length >= 2 && !crossings.length && <li className="text-white/60">The first two curves do not meet on screen: no x gives them the same y here.</li>}
            {!visible.length && <li className="text-white/50">Type a function to start, for example 2*x + 1.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
