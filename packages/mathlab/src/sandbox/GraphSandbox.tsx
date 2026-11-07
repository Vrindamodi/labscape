import { Btn, Panel, ParamSlider, sf } from "@labscape/physics";
import { Eye, EyeOff, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { compile, parse, ParseError, toLatex, toText, variables, type Node } from "../core/expr";
import { slopeAt } from "../core/numeric";
import { Plot, type Mapper, type View } from "../ui/Plot";

export type GraphFn = { src: string; colour: string; hidden?: boolean };
export type GraphBuild = { fns: GraphFn[]; params: Record<string, number>; view?: View };

const COLOURS = ["#a78bfa", "#f472b6", "#7cf3ff", "#ffd43b", "#51cf66", "#ff922b"];
const RESERVED = new Set(["x", "pi", "e", "tau", "theta"]);
const MAX_FNS = 6;
export const DEFAULT_GRAPH: GraphBuild = { fns: [{ src: "a*x^2 + b*x + c", colour: COLOURS[0]! }, { src: "m*x + c", colour: COLOURS[1]! }], params: { a: 1, b: 0, c: -2, m: 1 } };

type Compiled = { ok: true; node: Node; f: (s: Record<string, number>) => number; vars: string[] } | { ok: false; error: string };

function build(src: string): Compiled {
  try {
    const node = parse(src);
    return { ok: true, node, f: compile(node), vars: [...variables(node)].filter((v) => !RESERVED.has(v)) };
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
  const [view, setView] = useState<View>(() => initial?.view ?? { x0: -6, x1: 6, y0: -5, y1: 7 });
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

  const setFn = (i: number, p: Partial<GraphFn>) => setB((x) => ({ ...x, fns: x.fns.map((f, j) => (j === i ? { ...f, ...p } : f)) }));
  const addFn = () => setB((x) => (x.fns.length >= MAX_FNS ? x : { ...x, fns: [...x.fns, { src: "", colour: COLOURS.find((c) => !x.fns.some((f) => f.colour === c)) ?? COLOURS[0]! }] }));
  const removeFn = (i: number) => setB((x) => ({ ...x, fns: x.fns.filter((_, j) => j !== i) }));

  const visible = b.fns.map((f, i) => ({ f, fn: fns[i] })).filter((v): v is { f: GraphFn; fn: (x: number) => number } => !!v.fn && !v.f.hidden && v.f.src.trim() !== "");
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
          {visible.map(({ f, fn }) => Number.isFinite(fn(probe)) && <circle key={f.colour} cx={m.X(probe)} cy={m.Y(fn(probe))} r={5} fill={f.colour} />)}
        </>
      )}
    </g>
  );

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-2">
        <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-white/[0.08]">
          <Plot curves={visible.map(({ f, fn }) => ({ f: fn, colour: f.colour, width: 2.5 }))} view={view} onView={setView} height={460} ariaLabel={`Graph of ${visible.map((v) => `y = ${v.f.src}`).join(", ") || "nothing yet"}`} overlay={overlay} />
        </div>
        <ParamSlider label="Trace x" value={probe ?? 0} min={Math.round(view.x0)} max={Math.round(view.x1)} step={0.05} onChange={setProbe} onCommit={setProbe} />
        <p className="text-xs text-white/45">Drag to pan, scroll or pinch to zoom. Dots mark roots; white rings mark where the first two curves cross.</p>
      </div>
      <div className="space-y-3">
        <Panel title="Functions" right={<Btn tone="ghost" onClick={addFn} disabled={b.fns.length >= MAX_FNS} title="Add a function"><Plus className="h-4 w-4" /></Btn>}>
          <ul className="space-y-2">
            {b.fns.map((f, i) => {
              const c = compiled[i]!;
              return (
                <li key={i}>
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: f.colour }} />
                    <span className="font-mono text-sm text-white/60">y =</span>
                    <input value={f.src} onChange={(e) => setFn(i, { src: e.target.value })} placeholder="e.g. sin(k*x)" spellCheck={false} aria-label={`Function ${i + 1}`} aria-invalid={!c.ok && f.src.trim() !== ""} className="min-w-0 flex-1 rounded-md bg-white/[0.06] px-2 py-1.5 font-mono text-sm text-white ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-[#2f80ff]" />
                    <button onClick={() => setFn(i, { hidden: !f.hidden })} className="grid h-8 w-8 place-items-center rounded text-white/50 hover:text-white" aria-label={f.hidden ? "Show" : "Hide"} aria-pressed={!f.hidden}>
                      {f.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button onClick={() => removeFn(i)} className="grid h-8 w-8 place-items-center rounded text-white/50 hover:text-red-300" aria-label="Remove">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {f.src.trim() !== "" && (c.ok ? (renderTex ? <div className="mt-1 overflow-x-auto pl-5 text-sm text-white/80" dangerouslySetInnerHTML={{ __html: renderTex(`y = ${toLatex(c.node)}`) }} /> : <p className="mt-1 pl-5 font-mono text-xs text-white/60">y = {toText(c.node)}</p>) : <p className="mt-1 pl-5 text-xs text-red-300">{c.error}</p>)}
                </li>
              );
            })}
          </ul>
        </Panel>
        {paramNames.length > 0 && (
          <Panel title="Sliders">
            <div className="space-y-3">
              {paramNames.map((p) => (
                <div key={p} className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <ParamSlider label={p} value={scope[p]!} min={Math.min(-5, Math.floor(-2 * Math.abs(scope[p]!)))} max={Math.max(5, Math.ceil(2 * Math.abs(scope[p]!)))} step={0.1} onChange={(v) => setB((x) => ({ ...x, params: { ...x.params, [p]: v } }))} onCommit={(v) => setB((x) => ({ ...x, params: { ...x.params, [p]: v } }))} />
                  </div>
                  <Btn tone={sweep === p ? "primary" : "ghost"} pressed={sweep === p} title={`Sweep ${p}`} onClick={() => setSweep((s) => (s === p ? null : p))}>
                    {sweep === p ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Btn>
                </div>
              ))}
            </div>
          </Panel>
        )}
        <Panel title="Features on screen">
          <ul className="space-y-1.5 text-sm">
            {visible.map(({ f, fn }) => {
              const roots = rootsIn(fn, view.x0, view.x1);
              return (
                <li key={f.colour} className="text-white/75">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: f.colour }} />
                  y-intercept {sf(fn(0))}
                  {roots.length ? `; roots ${roots.map((r) => sf(r)).join(", ")}` : "; no roots here"}
                  {probe !== null && `; at x = ${sf(probe)}: y = ${sf(fn(probe))}, slope ${sf(slopeAt(fn, probe))}`}
                </li>
              );
            })}
            {crossings.length > 0 && <li className="text-white">First two curves cross at x = {crossings.map((x) => sf(x)).join(", ")}</li>}
            {!visible.length && <li className="text-white/50">Type a function to start.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
