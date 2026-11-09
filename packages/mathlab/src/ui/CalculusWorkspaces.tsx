import { Btn, DragHandle, easeInOut, GhostHand, LabStyles, LiveGraph, mix, Num, Panel, paramOf, ReadingInput, Readout, sf, Stage, submitted, Tag, useCommitLater, useDemoPreview, useEased, useFocusStep, V3, type SimSession } from "@labscape/physics";
import { motion, useReducedMotion } from "framer-motion";
import { Crosshair, Dice5, Divide, Play, X as Times } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { compile, derivative, fn1, parse } from "../core/expr";
import { integrate, riemann, runTrials, theory, type RiemannMethod, type Trial } from "../core/numeric";
import type { ProbSetup, ProbState, RiemannSetup, RiemannState, TangentSetup, TangentState } from "../labs/maths";
import { MathInput } from "./MathInput";
import { Plot, type View } from "./Plot";

/* ================================================================== tangent and derivative */

const TVIEW: View = { x0: -3, x1: 3, y0: -4, y1: 6 };
/** Snap x to 0.01, with a gentle detent on halves so 1.00 and 2.00 are easy to land on. */
const snapX = (x: number) => {
  const half = Math.round(x * 2) / 2;
  return Math.abs(x - half) < 0.04 ? half : Math.round(x * 100) / 100;
};

/**
 * Derivative as slope. Slide the point along the curve; drag the second point in towards it to
 * shrink h and watch the secant turn into the tangent. Limit animates h down to 0.0001.
 */
export function TangentWorkspace({ session }: { session: SimSession<TangentState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as TangentSetup;
  const ro = session.readOnly;
  const reduced = useReducedMotion();
  const focus = useFocusStep(session);
  const demo = useDemoPreview(session, 1100);
  const f = useMemo(() => fn1(setup.f), [setup.f]);
  const [x, setX] = useState(s.x);
  const [h, setH] = useState(s.h);
  const [dragging, setDragging] = useState<"x" | "h" | null>(null);
  useEffect(() => setX(s.x), [s.x]);
  useEffect(() => setH(s.h), [s.h]);
  const commitX = useCommitLater((v: number) => session.dispatch("param.set", { key: "x", value: v }), 400);
  const commitH = useCommitLater((v: number) => session.dispatch("param.set", { key: "h", value: v }), 400);

  // demo: glide x and h (h on a log scale, so the Limit squeeze reads well)
  const kk = easeInOut(Math.max(0, (demo.k - 0.3) / 0.7));
  const nX = paramOf(demo.next, "x");
  const nH = paramOf(demo.next, "h");
  const logH = useEased(Math.log(Math.max(1e-4, s.h)), session.mode === "demo" ? 1600 : 0);
  const xs = session.mode === "demo" ? (typeof nX === "number" ? mix(s.x, nX, kk) : s.x) : x;
  const hs = session.mode === "demo" ? (typeof nH === "number" ? Math.exp(mix(Math.log(s.h), Math.log(nH), kk)) : Math.exp(logH)) : h;
  const slope = (f(xs + hs) - f(xs)) / hs;
  const tangent = hs < 0.01;

  // the slope trace: every x visited with a small h
  const [trace, setTrace] = useState<{ x: number; y: number }[]>([]);
  useEffect(() => {
    if (hs > 0.01) return;
    setTrace((t) => [...t.filter((p) => Math.abs(p.x - xs) > 0.02), { x: xs, y: slope }].sort((a, b) => a.x - b.x));
  }, [xs, hs, slope]);
  const correct = typeof s.results.fprime === "string";
  const fprime = useMemo(() => {
    try {
      return compile(derivative(parse(setup.f)));
    } catch {
      return null;
    }
  }, [setup.f]);

  const limit = () => {
    if (reduced) return session.dispatch("sim.start", {} as Record<string, never>);
    const h0 = h;
    const start = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / 2000);
      setH(h0 * Math.pow(1e-4 / h0, easeInOut(k)));
      if (k < 1) requestAnimationFrame(tick);
      else session.dispatch("sim.start", {} as Record<string, never>);
    };
    requestAnimationFrame(tick);
  };

  const curves = useMemo(
    () => [
      { f, colour: V3.cyan, width: 3 },
      { f: (t: number) => f(xs) + slope * (t - xs), colour: tangent ? V3.amber : "#ff922b", width: 2.2, dash: tangent ? [] : [7, 5] },
    ],
    [f, xs, slope, tangent],
  );
  // The limit step starts at x = 2 (as its instruction says), so the point comes first, then h.
  const off2 = Math.abs(s.x - 2) > 1e-9;
  const pointPulse = !ro && !dragging && (focus === "slope-at-2" || focus === "limit" ? off2 : focus === "flat");
  const hPulse = !ro && !dragging && focus === "limit" && !off2 && s.h > 0.05;
  const tip = (focus === "slope-at-2" || focus === "limit") && off2 ? "Slide the point to x = 2" : focus === "flat" ? "Find where the tangent is flat" : focus === "limit" ? "Drag the orange point in, or press Limit" : null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_320px]">
      <LabStyles />
      <div className="flex min-h-0 flex-col gap-3">
        <Plot
          curves={curves}
          view={TVIEW}
          height={330}
          ariaLabel={`f(x) = ${setup.f} with a ${tangent ? "tangent" : "secant"} at x = ${xs.toFixed(2)}`}
          overlay={(m) => (
            <g>
              {!tangent && <line x1={m.X(xs)} y1={m.Y(f(xs))} x2={m.X(xs + hs)} y2={m.Y(f(xs))} stroke="rgba(255,146,43,.5)" strokeDasharray="3 4" pointerEvents="none" />}
              {!tangent && (
                <text x={m.X(xs + hs / 2)} y={m.Y(f(xs)) + 16} fontSize={11} fill="#ffb877" textAnchor="middle" pointerEvents="none" fontFamily="JetBrains Mono, monospace">
                  h = {hs.toPrecision(2)}
                </text>
              )}
              <DragHandle
                label={`Second point, h = ${hs.toPrecision(2)} to the right. Drag it towards the first point to shrink h; arrow keys halve or double h.`}
                valueText={`h = ${hs.toPrecision(2)}`}
                value={hs}
                min={0.0001}
                max={2}
                disabled={ro}
                ring={{ cx: m.X(xs + hs), cy: m.Y(f(xs + hs)), r: 7 }}
                pulse={hPulse}
                onDragStart={() => setDragging("h")}
                onDrag={(p) => setH(Math.max(0.0001, Math.min(2, Number((m.invX(p.x) - xs).toPrecision(2)))))}
                onDragEnd={(_p, moved) => {
                  setDragging(null);
                  if (moved && h !== s.h) session.dispatch("param.set", { key: "h", value: h });
                }}
                onKey={(key) => {
                  const next = key === "ArrowLeft" || key === "ArrowDown" ? Math.max(0.0001, h / 2) : key === "ArrowRight" || key === "ArrowUp" ? Math.min(2, h * 2) : null;
                  if (next === null) return false;
                  const v = Number(next.toPrecision(2));
                  setH(v);
                  commitH(v);
                  return true;
                }}
              >
                <circle cx={m.X(xs + hs)} cy={m.Y(f(xs + hs))} r={14} fill="transparent" />
                <circle cx={m.X(xs + hs)} cy={m.Y(f(xs + hs))} r={tangent ? 3 : 6.5} fill="#ff922b" stroke="#0b1430" strokeWidth={2} />
              </DragHandle>
              <DragHandle
                label={`Point on the curve at x = ${xs.toFixed(2)}. Drag along the curve, or use the arrow keys.`}
                valueText={`x = ${xs.toFixed(2)}, slope ${sf(slope, 4)}`}
                value={xs}
                min={-2.8}
                max={2.8}
                disabled={ro}
                ring={{ cx: m.X(xs), cy: m.Y(f(xs)), r: 9 }}
                pulse={pointPulse}
                onDragStart={() => setDragging("x")}
                onDrag={(p) => setX(Math.max(-2.8, Math.min(2.8, snapX(m.invX(p.x)))))}
                onDragEnd={(_p, moved) => {
                  setDragging(null);
                  if (moved && x !== s.x) session.dispatch("param.set", { key: "x", value: x });
                }}
                onKey={(key, shift) => {
                  const st = shift ? 0.5 : 0.05;
                  const next = key === "ArrowRight" ? x + st : key === "ArrowLeft" ? x - st : null;
                  if (next === null) return false;
                  const v = Math.max(-2.8, Math.min(2.8, Math.round(next * 100) / 100));
                  setX(v);
                  commitX(v);
                  return true;
                }}
              >
                <circle cx={m.X(xs)} cy={m.Y(f(xs))} r={18} fill="transparent" />
                <circle cx={m.X(xs)} cy={m.Y(f(xs))} r={dragging === "x" ? 10 : 8} fill={V3.amber} stroke="#0b1430" strokeWidth={3} style={{ transition: "r .15s" }} />
              </DragHandle>
              <g pointerEvents="none">
                <rect x={m.X(xs) + 12} y={m.Y(f(xs)) - 34} width={104} height={22} rx={8} fill="#060d1f" fillOpacity={0.85} stroke={Math.abs(slope) < 0.1 && tangent ? V3.mint : "rgba(140,180,255,.3)"} />
                <text x={m.X(xs) + 64} y={m.Y(f(xs)) - 19} fontSize={11.5} fontWeight={700} fill={Math.abs(slope) < 0.1 && tangent ? V3.mint : "#ffe08a"} textAnchor="middle" fontFamily="JetBrains Mono, monospace">
                  slope {sf(slope, 4)}
                </text>
              </g>
              {tip && <Tag x={Math.min(m.w - 140, Math.max(140, m.X(xs)))} y={m.Y(f(xs)) > m.h / 2 ? m.Y(f(xs)) - 60 : m.Y(f(xs)) + 50} text={tip} />}
              <GhostHand at={typeof nX === "number" ? { x: m.X(xs), y: m.Y(f(xs)) } : typeof nH === "number" ? { x: m.X(xs + hs), y: m.Y(f(xs + hs)) } : null} pressing={demo.k > 0.25} follow={demo.k > 0.3} />
            </g>
          )}
        />
        <Panel title="Slope at each x (traced as you move the point with h tiny)">
          <Plot
            curves={correct && fprime ? [{ f: (t: number) => fprime({ x: t }), colour: "rgba(255,194,61,.5)", width: 2, dash: [5, 4] }] : []}
            view={{ x0: -3, x1: 3, y0: -6, y1: 24 }}
            height={150}
            lockZoom
            ariaLabel="Derivative trace"
            overlay={(m) => (
              <g>
                {trace.map((p, i) => (
                  <circle key={i} cx={m.X(p.x)} cy={m.Y(p.y)} r={2.5} fill={V3.amber} />
                ))}
                <circle cx={m.X(xs)} cy={m.Y(slope)} r={5} fill="#fff" />
              </g>
            )}
          />
        </Panel>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title={`f(x) = ${setup.f}`} glow={hPulse}>
          <div className="grid grid-cols-2 gap-2">
            <Readout label="x" value={xs.toFixed(2)} />
            <Readout label={tangent ? "tangent slope" : "secant slope"} value={sf(slope, 4)} tone={tangent ? "good" : "warn"} />
          </div>
          <div className="mt-2 rounded-[12px] bg-[#040a1c]/55 px-3 py-2 ring-1 ring-inset ring-[rgba(140,180,255,.10)]">
            <div className="ls-kicker">h (gap to the second point)</div>
            <div className="font-mono text-lg font-bold text-[#ffb877]">{hs.toPrecision(2)}</div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-[#ff922b] to-[#ffc23d]" style={{ width: `${Math.max(2, ((Math.log10(hs) + 4) / (Math.log10(2) + 4)) * 100)}%` }} />
            </div>
          </div>
          <Btn tone="primary" className="mt-2 w-full" onClick={limit} disabled={ro || h <= 0.0002}>
            <Play className="h-4 w-4" /> Limit: shrink h to zero
          </Btn>
        </Panel>
        <Panel title="Record" glow={!ro && (focus === "slope-at-2" || focus === "flat")}>
          <ReadingInput label="Slope of the tangent here" onRecord={(v) => session.dispatch("measure.read", { instrument: "tangent", reading: { key: "slope", value: v, unit: "" } })} value={submitted(session.events, "slope", "tangent")} disabled={ro} />
          <Btn className="mt-2 w-full" onClick={() => session.dispatch("measure.read", { instrument: "tangent", reading: { key: "flat-x", value: x, unit: "" } })} disabled={ro}>
            <Crosshair className="h-4 w-4" /> Mark: the tangent is flat at x = {xs.toFixed(2)}
          </Btn>
        </Panel>
        <Panel title="The derivative" glow={!ro && focus === "derivative"}>
          <MathInput label="f′(x) =" onSubmit={(e) => session.dispatch("param.set", { key: "result:fprime", value: e })} value={submitted(session.events, "result:fprime")} disabled={ro} />
        </Panel>
      </div>
    </div>
  );
}

/* ================================================================== Riemann sums */

/**
 * Riemann sums. Drag the width handle under the first strip to set how many strips fit (n), or
 * halve / double n; switch the sampling method. The sum is shown against n as it converges.
 */
export function RiemannWorkspace({ session }: { session: SimSession<RiemannState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as RiemannSetup;
  const ro = session.readOnly;
  const reduced = useReducedMotion();
  const focus = useFocusStep(session);
  const demo = useDemoPreview(session, 1100);
  const f = useMemo(() => fn1(setup.f), [setup.f]);
  const exact = useMemo(() => integrate(f, setup.a, setup.b), [f, setup.a, setup.b]);
  const [nLocal, setNLocal] = useState<number | null>(null);
  const nNext = paramOf(demo.next, "n");
  const n = nLocal ?? s.n;
  const r = riemann(f, setup.a, setup.b, n, s.method);
  const conv = useMemo(() => [1, 2, 4, 8, 16, 32, 64, 128, 256].map((k) => ({ x: k, y: riemann(f, setup.a, setup.b, k, s.method).sum })), [f, setup.a, setup.b, s.method]);
  const set = (k: string, v: number | string) => session.dispatch("param.set", { key: k, value: v });
  const commitN = useCommitLater((v: number) => {
    if (v !== s.n) set("n", v);
    setNLocal(null);
  }, 400);
  const width = (setup.b - setup.a) / n;
  const kk = easeInOut(Math.max(0, (demo.k - 0.3) / 0.7));
  const handleW = typeof nNext === "number" ? mix(width, (setup.b - setup.a) / nNext, kk) : width;
  const view = useMemo(() => ({ x0: setup.a - 0.4, x1: setup.b + 0.4, y0: -0.9, y1: f(setup.b) * 1.2 }), [setup.a, setup.b, f]);
  const methodPulse = !ro && ((focus === "left-4" && s.method !== "left") || (focus === "right-4" && s.method !== "right"));
  const nPulse = !ro && ((focus === "left-4" || focus === "right-4") && s.n !== 4);

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_320px]">
      <LabStyles />
      <div className="flex min-h-0 flex-col gap-3">
        <Plot
          curves={[{ f, colour: V3.cyan, width: 3 }]}
          view={view}
          height={340}
          ariaLabel={`${n} ${s.method} rectangles under y = ${setup.f}`}
          overlay={(m) => {
            const hx = m.X(setup.a + handleW);
            const hy = m.Y(0) + 22;
            return (
              <g>
                {r.rects.map((q, i) => {
                  const top = q.h;
                  const under = s.method === "trapezoid" ? true : top <= Math.min(f(q.x0), f(q.x1)) + 1e-12;
                  const d = s.method === "trapezoid" ? `M ${m.X(q.x0)} ${m.Y(0)} L ${m.X(q.x0)} ${m.Y(q.h)} L ${m.X(q.x1)} ${m.Y(q.h2!)} L ${m.X(q.x1)} ${m.Y(0)} Z` : `M ${m.X(q.x0)} ${m.Y(0)} L ${m.X(q.x0)} ${m.Y(top)} L ${m.X(q.x1)} ${m.Y(top)} L ${m.X(q.x1)} ${m.Y(0)} Z`;
                  return (
                    <motion.path
                      key={`${n}-${s.method}-${i}`}
                      d={d}
                      fill={under ? "rgba(61,232,168,.28)" : "rgba(255,169,77,.32)"}
                      stroke={under ? V3.mint : "#ffa94d"}
                      strokeWidth={1}
                      initial={reduced || nLocal !== null ? false : { opacity: 0, scaleY: 0.4 }}
                      animate={{ opacity: 1, scaleY: 1 }}
                      transition={{ delay: reduced || nLocal !== null ? 0 : Math.min(0.6, i * 0.02), duration: 0.22 }}
                      style={{ originY: `${m.Y(0)}px` }}
                      pointerEvents="none"
                    />
                  );
                })}
                {/* width handle under the first strip */}
                <line x1={m.X(setup.a)} y1={hy} x2={hx} y2={hy} stroke={V3.amber} strokeWidth={2} pointerEvents="none" />
                <line x1={m.X(setup.a)} y1={hy - 6} x2={m.X(setup.a)} y2={hy + 6} stroke={V3.amber} strokeWidth={2} pointerEvents="none" />
                <text x={(m.X(setup.a) + hx) / 2} y={hy + 18} fontSize={11} fontWeight={700} textAnchor="middle" fill={V3.amber} pointerEvents="none" fontFamily="JetBrains Mono, monospace">
                  w = {sf(handleW, 3)}
                </text>
                <DragHandle
                  label={`Strip width handle: ${n} strips of width ${sf(width, 3)}. Drag left for more strips, right for fewer; arrow keys change n by one.`}
                  valueText={`n = ${n}`}
                  value={n}
                  min={1}
                  max={64}
                  disabled={ro}
                  ring={{ cx: hx, cy: hy, r: 8 }}
                  pulse={nPulse}
                  onDrag={(p) => setNLocal(Math.max(1, Math.min(64, Math.round((setup.b - setup.a) / Math.max(1e-3, m.invX(p.x) - setup.a)))))}
                  onDragEnd={(_p, moved) => {
                    if (moved && nLocal !== null && nLocal !== s.n) set("n", nLocal);
                    setNLocal(null);
                  }}
                  onKey={(key, shift) => {
                    const st = shift ? 4 : 1;
                    const next = key === "ArrowLeft" || key === "ArrowUp" ? Math.min(64, n + st) : key === "ArrowRight" || key === "ArrowDown" ? Math.max(1, n - st) : null;
                    if (next === null) return false;
                    setNLocal(next);
                    commitN(next);
                    return true;
                  }}
                >
                  <circle cx={hx} cy={hy} r={16} fill="transparent" />
                  <rect x={hx - 7} y={hy - 9} width={14} height={18} rx={5} fill="#0b1430" stroke={V3.amber} strokeWidth={2.5} />
                  <line x1={hx - 2} y1={hy - 4} x2={hx - 2} y2={hy + 4} stroke={V3.amber} strokeWidth={1.4} />
                  <line x1={hx + 2} y1={hy - 4} x2={hx + 2} y2={hy + 4} stroke={V3.amber} strokeWidth={1.4} />
                </DragHandle>
                {nPulse && <Tag x={hx + 70} y={hy - 2} text="Drag to set 4 strips" anchor="start" />}
                <GhostHand at={typeof nNext === "number" ? { x: hx, y: hy } : null} pressing={demo.k > 0.25} follow={demo.k > 0.3} />
              </g>
            );
          }}
        />
        <Panel title="Sum against n">
          <LiveGraph series={[{ label: `${s.method} sum`, colour: "#ffa94d", points: conv }, { label: "exact area", colour: V3.mint, points: conv.map((p) => ({ x: p.x, y: exact })) }]} xLabel="n" yLabel="sum" height={130} yMin={Math.min(...conv.map((p) => p.y), exact) * 0.9} />
        </Panel>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title={`Area under y = ${setup.f} from ${setup.a} to ${setup.b}`} glow={methodPulse}>
          <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Rectangle method">
            {(["left", "right", "midpoint", "trapezoid"] as RiemannMethod[]).map((mm) => (
              <button key={mm} type="button" role="radio" aria-checked={s.method === mm} onClick={() => set("method", mm)} disabled={ro} className="ls-chip h-10 justify-center capitalize">
                {mm}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Btn onClick={() => set("n", Math.max(1, Math.floor(s.n / 2)))} disabled={ro || s.n <= 1} title="Halve n">
              <Divide className="h-4 w-4" />2
            </Btn>
            <div className="flex-1 text-center font-mono text-xl font-bold text-white">
              n = <Num value={n} digits={0} />
            </div>
            <Btn onClick={() => set("n", Math.min(1024, s.n * 2))} disabled={ro || s.n >= 1024} title="Double n">
              <Times className="h-4 w-4" />2
            </Btn>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Readout label="Sum of areas" value={r.sum.toFixed(4)} />
            <Readout label="Width each" value={sf(width, 4)} />
          </div>
        </Panel>
        <Panel title="Record" glow={!ro && (focus === "left-4" || focus === "right-4" || focus === "converge") && !methodPulse && !nPulse}>
          <ReadingInput label="Sum" onRecord={(v) => session.dispatch("measure.read", { instrument: "sums", reading: { key: "sum", value: v, unit: "" } })} value={submitted(session.events, "sum", "sums")} disabled={ro} />
          {s.reads.length > 0 && (
            <table className="mt-2 w-full text-xs">
              <thead className="text-[#8fa6d1]">
                <tr>
                  <th className="text-left font-semibold">method</th>
                  <th className="text-right font-semibold">n</th>
                  <th className="text-right font-semibold">sum</th>
                </tr>
              </thead>
              <tbody className="font-mono text-white/85">
                {s.reads.map((x, i) => (
                  <tr key={i}>
                    <td>{x.method}</td>
                    <td className="text-right">{x.n}</td>
                    <td className="text-right">{x.sum}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="The exact area" glow={!ro && focus === "area"}>
          <ReadingInput label="Area" onRecord={(v) => session.dispatch("param.set", { key: "result:area", value: v })} value={submitted(session.events, "result:area")} disabled={ro} />
        </Panel>
      </div>
    </div>
  );
}

/* ================================================================== coins and dice */

const KIND_LABEL: Record<Trial, string> = { coin: "Coin", die: "Die", "two-dice": "Two dice", spinner: "Spinner" };
const outcomeLabel = (k: Trial, o: number) => (k === "coin" ? (o === 1 ? "H" : "T") : String(o));
const PIPS: Record<number, [number, number][]> = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]] };
/** Two faces that make a two-dice total (the model stores only totals). */
const facesFor = (total: number): [number, number] => {
  const lo = Math.max(1, total - 6);
  const hi = Math.min(6, total - 1);
  const a = lo + ((total * 3) % (hi - lo + 1));
  return [a, total - a];
};

function DieFace({ value, size = 64 }: { value: number; size?: number }) {
  const p = size / 4;
  return (
    <div className="relative rounded-[14px] bg-[linear-gradient(145deg,#ffffff,#d9e2f2)] shadow-[inset_0_-4px_0_rgba(0,0,0,.12),0_12px_24px_-10px_rgba(0,0,0,.8)]" style={{ width: size, height: size }}>
      {(PIPS[value] ?? []).map(([cx, cy], i) => (
        <span key={i} className="absolute rounded-full bg-[#1b2236]" style={{ width: p * 0.62, height: p * 0.62, left: size * (0.24 + cx * 0.26) - p * 0.31, top: size * (0.24 + cy * 0.26) - p * 0.31 }} />
      ))}
    </div>
  );
}

function CoinFace({ heads, size = 70 }: { heads: boolean; size?: number }) {
  return (
    <div className="grid place-items-center rounded-full font-mono text-2xl font-black text-[#5c3d00] shadow-[inset_0_-4px_0_rgba(0,0,0,.18),0_12px_24px_-10px_rgba(0,0,0,.8)]" style={{ width: size, height: size, background: "radial-gradient(circle at 35% 30%,#fff0b8,#e0a91a 60%,#a87700)" }}>
      {heads ? "H" : "T"}
    </div>
  );
}

/**
 * Coins and dice. Flick the die (or coin) across the felt: it tumbles and lands on the first
 * outcome of the run, then the rest of the trials stream into the histogram. Outcomes come from the
 * seeded generator in the model; the animation only shows them.
 */
export function DiceWorkspace({ session }: { session: SimSession<ProbState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as ProbSetup;
  const ro = session.readOnly;
  const reduced = useReducedMotion();
  const focus = useFocusStep(session);
  const demo = useDemoPreview(session, 1000);
  const last = s.runs[s.runs.length - 1];
  const lastIdx = s.runs.length - 1;
  const seq = useMemo(() => (last ? runTrials(last.kind, last.n, setup.seed + lastIdx * 7919).outcomes : null), [last, lastIdx, setup.seed]);
  const [shown, setShown] = useState(last ? Infinity : 0);
  const raf = useRef(0);

  /* ---------------------------------------------------------------- the throw */
  const tray = useRef<HTMLDivElement>(null);
  const [toss, setToss] = useState<{ id: number; vx: number; vy: number } | null>(null);
  const [face, setFace] = useState<number[]>([6, 3]);
  const flick = useRef<{ vx: number; vy: number } | null>(null);
  const seenRuns = useRef(s.runs.length);
  const landsAt = useRef(0);
  const [grab, setGrab] = useState<{ x: number; y: number } | null>(null);
  const grabStart = useRef<{ x: number; y: number; t: number; px: number; py: number } | null>(null);

  const finalFaces = (): number[] => {
    if (!seq || !last) return face;
    const o = seq[0]!;
    if (last.kind === "two-dice") return facesFor(o);
    return [o];
  };

  useLayoutEffect(() => {
    if (s.runs.length <= seenRuns.current) {
      seenRuns.current = s.runs.length;
      return;
    }
    seenRuns.current = s.runs.length;
    const v = flick.current ?? { vx: 520, vy: -160 };
    flick.current = null;
    if (reduced) {
      setFace(finalFaces());
      setToss(null);
      return;
    }
    landsAt.current = performance.now() + 850;
    setToss({ id: Date.now(), vx: v.vx, vy: v.vy });
    // tumble faces while it flies
    const id = window.setInterval(() => setFace([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]), 70);
    const done = window.setTimeout(() => {
      window.clearInterval(id);
      setFace(finalFaces());
    }, 850);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(done);
    };
  }, [s.runs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // stream the rest of the run into the histogram once the throw lands
  useEffect(() => {
    if (!seq) return;
    if (reduced) {
      setShown(seq.length);
      return;
    }
    const total = seq.length;
    const ms = total <= 20 ? total * 140 : 1500;
    const start = Math.max(performance.now(), landsAt.current);
    const tick = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - start) / ms));
      setShown(Math.max(now < start ? 0 : 1, Math.round(total * k)));
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [seq, reduced]);

  const roll = (v?: { vx: number; vy: number }) => {
    if (ro) return;
    flick.current = v ?? null;
    session.dispatch("sim.start", {} as Record<string, never>);
  };

  const kind = last?.kind ?? s.kind;
  const th = theory(kind);
  const shownN = seq ? Math.min(shown, seq.length) : 0;
  const counts = new Map<number, number>();
  if (seq) for (let i = 0; i < shownN; i++) counts.set(seq[i]!, (counts.get(seq[i]!) ?? 0) + 1);
  const maxP = Math.max(...[...th.values()], ...[...counts.values()].map((c) => c / Math.max(1, shownN)));
  const freqLine = useMemo(() => {
    if (!seq || kind !== "coin") return [];
    const out: { x: number; y: number }[] = [];
    let heads = 0;
    const every = Math.max(1, Math.floor(seq.length / 300));
    for (let i = 0; i < seq.length; i++) {
      heads += seq[i] === 1 ? 1 : 0;
      if (i % every === 0 || i === seq.length - 1) out.push({ x: i + 1, y: heads / (i + 1) });
    }
    return out;
  }, [seq, kind]);
  const recent = seq ? Array.from(seq.slice(Math.max(0, shownN - 14), shownN)) : [];
  const throwKind = s.kind;
  const rollPulse = !ro && !grab && (focus === "ten-flips" || focus === "dice-sum" || focus === "thousand") && !(focus === "thousand" && s.runs.some((r) => r.kind === "coin" && r.n >= 1000));
  const demoRoll = demo.next?.type === "sim.start";

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_300px]">
      <LabStyles />
      <div className="flex min-h-0 flex-col gap-3">
        <Stage className="min-h-[190px]">
          <div
            ref={tray}
            className="relative h-[190px] overflow-hidden rounded-[18px] bg-[radial-gradient(120%_120%_at_50%_0%,#1f6b4f,#0f3b2c_60%,#0a2a20)] shadow-[inset_0_0_0_6px_rgba(60,40,20,.7),inset_0_10px_40px_rgba(0,0,0,.5)]"
            onPointerMove={(e) => {
              if (!grabStart.current) return;
              const b = tray.current!.getBoundingClientRect();
              setGrab({ x: e.clientX - b.left, y: e.clientY - b.top });
            }}
          >
            <div className="pointer-events-none absolute right-4 top-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/50">{throwKind === "coin" ? "flick the coin" : throwKind === "two-dice" ? "flick the dice" : "flick the die"} · {s.trials.toLocaleString()} {s.kind === "coin" ? "flips" : "throws"}</div>
            <motion.div
              key={toss?.id ?? "rest"}
              role="button"
              data-guide={rollPulse ? "target" : undefined}
              tabIndex={ro ? -1 : 0}
              aria-label={`${KIND_LABEL[throwKind]}. Drag and flick it across the felt, or press Enter, to run ${s.trials.toLocaleString()} trials.`}
              className={`absolute left-6 top-[54px] flex touch-none gap-2 outline-none focus-visible:ring-2 focus-visible:ring-[#39d6ff] ${ro ? "" : "cursor-grab active:cursor-grabbing"}`}
              style={grab ? { x: grab.x - 60, y: grab.y - 90 } : {}}
              initial={toss ? { x: 0, y: 0, rotate: 0 } : false}
              animate={toss && !grab ? { x: [0, toss.vx * 0.45, toss.vx * 0.7, toss.vx * 0.8], y: [0, Math.max(-40, toss.vy * 0.2), 30, 12], rotate: [0, 300, 560, 720], rotateY: throwKind === "coin" ? [0, 900, 1620, 1800] : 0 } : {}}
              transition={{ duration: 0.85, times: [0, 0.4, 0.75, 1], ease: "easeOut" }}
              onPointerDown={(e) => {
                if (ro) return;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                const b = tray.current!.getBoundingClientRect();
                grabStart.current = { x: e.clientX, y: e.clientY, t: performance.now(), px: e.clientX, py: e.clientY };
                setGrab({ x: e.clientX - b.left, y: e.clientY - b.top });
              }}
              onPointerMove={(e) => {
                const g0 = grabStart.current;
                if (!g0) return;
                const now = performance.now();
                if (now - g0.t > 60) grabStart.current = { ...g0, t: now, px: e.clientX, py: e.clientY };
              }}
              onPointerUp={(e) => {
                const g0 = grabStart.current;
                grabStart.current = null;
                setGrab(null);
                if (!g0) return;
                const dt = Math.max(16, performance.now() - g0.t);
                const vx = ((e.clientX - g0.px) / dt) * 1000;
                const vy = ((e.clientY - g0.py) / dt) * 1000;
                const moved = Math.hypot(e.clientX - g0.x, e.clientY - g0.y);
                roll(moved > 6 ? { vx: Math.max(240, Math.min(900, Math.abs(vx) || 520)), vy: Math.max(-400, Math.min(200, vy)) } : undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  roll();
                }
              }}
            >
              {rollPulse && <span className={`pointer-events-none absolute -inset-3 animate-ping border-2 border-[#39d6ff]/70 motion-reduce:animate-none ${throwKind === "coin" ? "rounded-full" : "rounded-[18px]"}`} aria-hidden />}
              {throwKind === "coin" ? <CoinFace heads={(last?.kind === "coin" && seq ? seq[0] : 1) === 1} /> : throwKind === "two-dice" ? [0, 1].map((i) => <DieFace key={i} value={face[i] ?? 1} />) : <DieFace value={face[0] ?? 1} />}
            </motion.div>
            {rollPulse && !toss && (
              <div className="pointer-events-none absolute left-[120px] top-[150px] rounded-full bg-[#060d1f]/80 px-3 py-1 text-[11px] font-bold text-[#39d6ff] ring-1 ring-[#39d6ff]/50">Grab it and flick →</div>
            )}
            {demoRoll && (
              <svg className="pointer-events-none absolute inset-0 h-full w-full">
                <GhostHand at={{ x: 60 + demo.k * 120, y: 96 }} pressing={demo.k > 0.3} follow />
              </svg>
            )}
          </div>
        </Stage>
        <Panel title={last ? `${KIND_LABEL[kind]} × ${last.n.toLocaleString()} (showing ${shownN.toLocaleString()})` : "Run some trials"}>
          <div className="flex h-12 items-center gap-1.5 overflow-hidden" aria-live="polite">
            {recent.map((o, i) => (
              <motion.span key={`${shownN}-${i}`} initial={reduced ? false : { rotateY: 180, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} transition={{ duration: 0.3 }} className={`grid h-10 w-10 shrink-0 place-items-center font-mono text-base font-black ${kind === "coin" ? "rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffe8a1,#d4a017)] text-[#5c3d00]" : "rounded-[10px] bg-white text-[#1f2937]"}`}>
                {outcomeLabel(kind, o)}
              </motion.span>
            ))}
          </div>
          <div className="mt-3 flex h-44 items-end gap-1.5" role="img" aria-label="Histogram of relative frequency against theory">
            {[...th.keys()].map((k) => {
              const rel = (counts.get(k) ?? 0) / Math.max(1, shownN);
              return (
                <div key={k} className="relative flex flex-1 flex-col items-center justify-end">
                  <motion.div className="w-full rounded-t-[6px] bg-gradient-to-t from-[#1d5fe0] to-[#39d6ff]" animate={{ height: `${(rel / maxP) * 150}px` }} transition={{ duration: reduced ? 0 : 0.25 }} />
                  <div className="absolute w-full border-t-2 border-dashed border-[#ffc23d]" style={{ bottom: `${(th.get(k)! / maxP) * 150 + 18}px` }} />
                  <span className="mt-1 font-mono text-[11px] text-white/70">{outcomeLabel(kind, k)}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-[#8fa6d1]">Bars: what happened. Dashed lines: theory.</p>
        </Panel>
        {kind === "coin" && freqLine.length > 1 && (
          <Panel title="Relative frequency of heads as the flips add up">
            <LiveGraph series={[{ label: "heads ÷ flips", colour: V3.cyan, points: freqLine }, { label: "0.5", colour: V3.amber, points: [{ x: 1, y: 0.5 }, { x: freqLine[freqLine.length - 1]!.x, y: 0.5 }] }]} xLabel="flips" yLabel="frequency" height={130} />
          </Panel>
        )}
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Experiment" glow={!ro && (focus === "dice-sum" ? s.kind !== "two-dice" || s.trials < 1000 : focus === "thousand" ? s.trials < 1000 || s.kind !== "coin" : false)}>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="What to throw">
            {(["coin", "die", "two-dice"] as Trial[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={s.kind === k} onClick={() => session.dispatch("param.set", { key: "kind", value: k })} disabled={ro} className="ls-chip h-10 justify-center">
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Number of trials">
            {[10, 100, 1000, 10000].map((k) => (
              <button key={k} type="button" role="radio" aria-checked={s.trials === k} onClick={() => session.dispatch("param.set", { key: "trials", value: k })} disabled={ro} className="ls-chip h-10 justify-center font-mono">
                {k.toLocaleString()}
              </button>
            ))}
          </div>
          <Btn tone="primary" className="mt-2 w-full" onClick={() => roll()} disabled={ro}>
            <Dice5 className="h-4 w-4" /> Run {s.trials.toLocaleString()} {s.kind === "coin" ? "flips" : "throws"}
          </Btn>
        </Panel>
        {last && (
          <Panel title="Counts">
            <div className="grid grid-cols-3 gap-1.5">
              {[...th.keys()].map((k) => (
                <Readout key={k} label={outcomeLabel(kind, k)} value={(last.counts[k] ?? 0).toLocaleString()} />
              ))}
            </div>
          </Panel>
        )}
        <Panel title="Record" glow={!ro && (focus === "thousand" ? s.runs.some((r) => r.kind === "coin" && r.n >= 1000) : focus === "mode")}>
          <ReadingInput label="Relative frequency of heads" onRecord={(v) => session.dispatch("measure.read", { instrument: "trials", reading: { key: "heads-freq", value: v, unit: "" } })} value={submitted(session.events, "heads-freq", "trials")} disabled={ro} />
          <div className="mt-2">
            <ReadingInput label="Most likely total of two dice" onRecord={(v) => session.dispatch("param.set", { key: "result:mode", value: v })} value={submitted(session.events, "result:mode")} disabled={ro} />
          </div>
        </Panel>
      </div>
    </div>
  );
}
