import { Btn, LiveGraph, Panel, ParamSlider, ReadingInput, Readout, sf, type SimSession } from "@labscape/physics";
import { motion, useReducedMotion } from "framer-motion";
import { Crosshair, Dice5, Divide, Play, X as Times } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { derivative, fn1, parse, compile } from "../core/expr";
import { integrate, riemann, runTrials, theory, type RiemannMethod, type Trial } from "../core/numeric";
import type { ProbSetup, ProbState, RiemannSetup, RiemannState, TangentSetup, TangentState } from "../labs/maths";
import { MathInput } from "./MathInput";
import { Handle, Plot, type View } from "./Plot";

/* ================================================================== tangent and derivative */

const TVIEW: View = { x0: -3, x1: 3, y0: -4, y1: 6 };

export function TangentWorkspace({ session }: { session: SimSession<TangentState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as TangentSetup;
  const ro = session.readOnly;
  const reduced = useReducedMotion();
  const f = useMemo(() => fn1(setup.f), [setup.f]);
  const [x, setX] = useState(s.x);
  const [h, setH] = useState(s.h);
  useEffect(() => setX(s.x), [s.x]);
  useEffect(() => setH(s.h), [s.h]);
  const slope = (f(x + h) - f(x)) / h;
  // the slope trace below: every x visited with a small h
  const [trace, setTrace] = useState<{ x: number; y: number }[]>([]);
  useEffect(() => {
    if (h > 0.01) return;
    setTrace((t) => [...t.filter((p) => Math.abs(p.x - x) > 0.02), { x, y: slope }].sort((a, b) => a.x - b.x));
  }, [x, h, slope]);
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
      setH(h0 * Math.pow(1e-4 / h0, k));
      if (k < 1) requestAnimationFrame(tick);
      else session.dispatch("sim.start", {} as Record<string, never>);
    };
    requestAnimationFrame(tick);
  };

  const curves = useMemo(
    () => [
      { f, colour: "#7cf3ff", width: 3 },
      { f: (t: number) => f(x) + slope * (t - x), colour: h < 0.01 ? "#ffd43b" : "#ff922b", width: 2, dash: h < 0.01 ? [] : [7, 5] },
    ],
    [f, x, slope, h],
  );

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-h-0 flex-col gap-3">
        <Plot
          curves={curves}
          view={TVIEW}
          height={330}
          ariaLabel={`f(x) = ${setup.f} with a ${h < 0.01 ? "tangent" : "secant"} at x = ${x.toFixed(2)}`}
          overlay={(m) => (
            <g>
              {h >= 0.01 && <circle cx={m.X(x + h)} cy={m.Y(f(x + h))} r={6} fill="#ff922b" />}
              <Handle m={m} x={x} y={f(x)} label={`Point on the curve at x = ${x.toFixed(2)}`} keyStep={0.05} onDrag={(nx) => !ro && setX(Math.max(-2.8, Math.min(2.8, Math.round(nx * 100) / 100)))} onDragEnd={() => !ro && session.dispatch("param.set", { key: "x", value: x })} />
              <text x={m.X(x) + 12} y={m.Y(f(x)) - 12} fontSize={12} fontWeight={700} fill="#ffe066">
                slope {sf(slope, 4)}
              </text>
            </g>
          )}
        />
        <Panel title="Slope at each x (traced as you move the point with h tiny)">
          <Plot
            curves={correct && fprime ? [{ f: (t: number) => fprime({ x: t }), colour: "rgba(255,212,59,.5)", width: 2, dash: [5, 4] }] : []}
            view={{ x0: -3, x1: 3, y0: -6, y1: 24 }}
            height={150}
            lockZoom
            ariaLabel="Derivative trace"
            overlay={(m) => (
              <g>
                {trace.map((p, i) => (
                  <circle key={i} cx={m.X(p.x)} cy={m.Y(p.y)} r={2.5} fill="#ffd43b" />
                ))}
                <circle cx={m.X(x)} cy={m.Y(slope)} r={5} fill="#fff" />
              </g>
            )}
          />
        </Panel>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title={`f(x) = ${setup.f}`}>
          <ParamSlider label="h (gap to the second point)" value={h} min={0.0001} max={2} step={0.0001} format={(v) => v.toPrecision(2)} onChange={setH} onCommit={(v) => session.dispatch("param.set", { key: "h", value: v })} disabled={ro} />
          <Btn tone="primary" className="mt-2 w-full" onClick={limit} disabled={ro || h <= 0.0002}>
            <Play className="h-4 w-4" /> Limit: shrink h to zero
          </Btn>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Readout label="x" value={x.toFixed(2)} />
            <Readout label={h < 0.01 ? "tangent slope" : "secant slope"} value={sf(slope, 4)} tone={h < 0.01 ? "good" : "warn"} />
          </div>
        </Panel>
        <Panel title="Record">
          <ReadingInput label="Slope of the tangent here" onRecord={(v) => session.dispatch("measure.read", { instrument: "tangent", reading: { key: "slope", value: v, unit: "" } })} disabled={ro} />
          <Btn className="mt-2 w-full" onClick={() => session.dispatch("measure.read", { instrument: "tangent", reading: { key: "flat-x", value: x, unit: "" } })} disabled={ro}>
            <Crosshair className="h-4 w-4" /> Mark: the tangent is flat at x = {x.toFixed(2)}
          </Btn>
        </Panel>
        <Panel title="The derivative">
          <MathInput label="f′(x) =" onSubmit={(e) => session.dispatch("param.set", { key: "result:fprime", value: e })} disabled={ro} />
        </Panel>
      </div>
    </div>
  );
}

/* ================================================================== Riemann sums */

export function RiemannWorkspace({ session }: { session: SimSession<RiemannState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as RiemannSetup;
  const ro = session.readOnly;
  const reduced = useReducedMotion();
  const f = useMemo(() => fn1(setup.f), [setup.f]);
  const exact = useMemo(() => integrate(f, setup.a, setup.b), [f, setup.a, setup.b]);
  const r = riemann(f, setup.a, setup.b, s.n, s.method);
  const conv = useMemo(() => [1, 2, 4, 8, 16, 32, 64, 128, 256].map((n) => ({ x: n, y: riemann(f, setup.a, setup.b, n, s.method).sum })), [f, setup.a, setup.b, s.method]);
  const set = (k: string, v: number | string) => session.dispatch("param.set", { key: k, value: v });

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-h-0 flex-col gap-3">
        <Plot
          curves={[{ f, colour: "#7cf3ff", width: 3 }]}
          view={{ x0: setup.a - 0.4, x1: setup.b + 0.4, y0: -0.6, y1: f(setup.b) * 1.2 }}
          height={340}
          ariaLabel={`${s.n} ${s.method} rectangles under y = ${setup.f}`}
          overlay={(m) => (
            <g>
              {r.rects.map((q, i) => {
                const top = q.h;
                const under = s.method === "trapezoid" ? true : top <= Math.min(f(q.x0), f(q.x1)) + 1e-12;
                const d =
                  s.method === "trapezoid"
                    ? `M ${m.X(q.x0)} ${m.Y(0)} L ${m.X(q.x0)} ${m.Y(q.h)} L ${m.X(q.x1)} ${m.Y(q.h2!)} L ${m.X(q.x1)} ${m.Y(0)} Z`
                    : `M ${m.X(q.x0)} ${m.Y(0)} L ${m.X(q.x0)} ${m.Y(top)} L ${m.X(q.x1)} ${m.Y(top)} L ${m.X(q.x1)} ${m.Y(0)} Z`;
                return (
                  <motion.path
                    key={`${s.n}-${s.method}-${i}`}
                    d={d}
                    fill={under ? "rgba(32,201,151,.35)" : "rgba(255,169,77,.35)"}
                    stroke={under ? "#20c997" : "#ffa94d"}
                    strokeWidth={1}
                    initial={reduced ? false : { opacity: 0, scaleY: 0.6 }}
                    animate={{ opacity: 1, scaleY: 1 }}
                    transition={{ delay: reduced ? 0 : Math.min(1.2, i * 0.03), duration: 0.2 }}
                    style={{ originY: `${m.Y(0)}px` }}
                  />
                );
              })}
            </g>
          )}
        />
        <Panel title="Sum against n">
          <LiveGraph series={[{ label: `${s.method} sum`, colour: "#ffa94d", points: conv }, { label: "exact area", colour: "#69db7c", points: conv.map((p) => ({ x: p.x, y: exact })) }]} xLabel="n" yLabel="sum" height={130} yMin={Math.min(...conv.map((p) => p.y), exact) * 0.9} />
        </Panel>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title={`Area under y = ${setup.f} from ${setup.a} to ${setup.b}`}>
          <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Rectangle method">
            {(["left", "right", "midpoint", "trapezoid"] as RiemannMethod[]).map((m) => (
              <Btn key={m} onClick={() => set("method", m)} tone={s.method === m ? "primary" : "secondary"} pressed={s.method === m} disabled={ro}>
                {m}
              </Btn>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Btn onClick={() => set("n", Math.max(1, Math.floor(s.n / 2)))} disabled={ro || s.n <= 1} title="Halve n">
              <Divide className="h-4 w-4" />2
            </Btn>
            <div className="flex-1 text-center font-mono text-lg font-bold text-white">n = {s.n}</div>
            <Btn onClick={() => set("n", Math.min(1024, s.n * 2))} disabled={ro || s.n >= 1024} title="Double n">
              <Times className="h-4 w-4" />2
            </Btn>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Readout label="Sum of areas" value={r.sum.toFixed(4)} />
            <Readout label="Width each" value={sf((setup.b - setup.a) / s.n, 4)} />
          </div>
        </Panel>
        <Panel title="Record">
          <ReadingInput label="Sum" onRecord={(v) => session.dispatch("measure.read", { instrument: "sums", reading: { key: "sum", value: v, unit: "" } })} disabled={ro} />
          {s.reads.length > 0 && (
            <table className="mt-2 w-full text-xs">
              <thead className="text-white/45">
                <tr>
                  <th className="text-left">method</th>
                  <th className="text-right">n</th>
                  <th className="text-right">sum</th>
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
        <Panel title="The exact area">
          <ReadingInput label="Area" onRecord={(v) => session.dispatch("param.set", { key: "result:area", value: v })} disabled={ro} />
        </Panel>
      </div>
    </div>
  );
}

/* ================================================================== coins and dice */

const KIND_LABEL: Record<Trial, string> = { coin: "Coin", die: "Die", "two-dice": "Two dice", spinner: "Spinner" };
const outcomeLabel = (k: Trial, o: number) => (k === "coin" ? (o === 1 ? "H" : "T") : String(o));

export function DiceWorkspace({ session }: { session: SimSession<ProbState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as ProbSetup;
  const ro = session.readOnly;
  const reduced = useReducedMotion();
  const last = s.runs[s.runs.length - 1];
  const lastIdx = s.runs.length - 1;
  // Recompute the exact sequence from the seed (outcomes decided first, then animated).
  const seq = useMemo(() => (last ? runTrials(last.kind, last.n, setup.seed + lastIdx * 7919).outcomes : null), [last, lastIdx, setup.seed]);
  const [shown, setShown] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (!seq) return;
    if (reduced) {
      setShown(seq.length);
      return;
    }
    const total = seq.length;
    const ms = total <= 20 ? total * 160 : 1500;
    const start = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      setShown(Math.max(1, Math.round(total * k)));
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [seq, reduced]);

  const kind = last?.kind ?? s.kind;
  const th = theory(kind);
  const counts = new Map<number, number>();
  if (seq) for (let i = 0; i < shown; i++) counts.set(seq[i]!, (counts.get(seq[i]!) ?? 0) + 1);
  const maxP = Math.max(...[...th.values()], ...[...counts.values()].map((c) => c / Math.max(1, shown)));
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
  const recent = seq ? Array.from(seq.slice(Math.max(0, shown - 12), shown)) : [];

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-h-0 flex-col gap-3">
        <Panel title={last ? `${KIND_LABEL[kind]} × ${last.n.toLocaleString()} (showing ${shown.toLocaleString()})` : "Run some trials"}>
          <div className="flex h-14 items-center gap-1.5 overflow-hidden" aria-live="polite">
            {recent.map((o, i) => (
              <motion.span key={`${shown}-${i}`} initial={reduced ? false : { rotateY: 180, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} transition={{ duration: 0.3 }} className={`grid h-11 w-11 shrink-0 place-items-center font-mono text-lg font-black ${kind === "coin" ? "rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffe8a1,#d4a017)] text-[#5c3d00]" : "rounded-lg bg-white text-[#1f2937]"}`}>
                {outcomeLabel(kind, o)}
              </motion.span>
            ))}
          </div>
          <div className="mt-3 flex h-48 items-end gap-1.5" role="img" aria-label="Histogram of relative frequency against theory">
            {[...th.keys()].map((k) => {
              const rel = (counts.get(k) ?? 0) / Math.max(1, shown);
              return (
                <div key={k} className="relative flex flex-1 flex-col items-center justify-end">
                  <motion.div className="w-full rounded-t bg-accent/70" animate={{ height: `${(rel / maxP) * 160}px` }} transition={{ duration: reduced ? 0 : 0.3 }} />
                  <div className="absolute w-full border-t-2 border-dashed border-[#ffd43b]" style={{ bottom: `${(th.get(k)! / maxP) * 160 + 18}px` }} />
                  <span className="mt-1 font-mono text-[11px] text-white/70">{outcomeLabel(kind, k)}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-white/45">Bars: what happened. Dashed lines: theory.</p>
        </Panel>
        {kind === "coin" && freqLine.length > 1 && (
          <Panel title="Relative frequency of heads as the flips add up">
            <LiveGraph series={[{ label: "heads ÷ flips", colour: "#7cf3ff", points: freqLine }, { label: "0.5", colour: "#ffd43b", points: [{ x: 1, y: 0.5 }, { x: freqLine[freqLine.length - 1]!.x, y: 0.5 }] }]} xLabel="flips" yLabel="frequency" height={130} />
          </Panel>
        )}
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Experiment">
          <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="What to throw">
            {(["coin", "die", "two-dice"] as Trial[]).map((k) => (
              <Btn key={k} onClick={() => session.dispatch("param.set", { key: "kind", value: k })} tone={s.kind === k ? "primary" : "secondary"} pressed={s.kind === k} disabled={ro}>
                {KIND_LABEL[k]}
              </Btn>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1" role="radiogroup" aria-label="Number of trials">
            {[10, 100, 1000, 10000].map((n) => (
              <Btn key={n} onClick={() => session.dispatch("param.set", { key: "trials", value: n })} tone={s.trials === n ? "primary" : "secondary"} pressed={s.trials === n} disabled={ro}>
                {n.toLocaleString()}
              </Btn>
            ))}
          </div>
          <Btn tone="primary" className="mt-2 w-full" onClick={() => session.dispatch("sim.start", {} as Record<string, never>)} disabled={ro}>
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
        <Panel title="Record">
          <ReadingInput label="Relative frequency of heads" onRecord={(v) => session.dispatch("measure.read", { instrument: "trials", reading: { key: "heads-freq", value: v, unit: "" } })} disabled={ro} />
          <div className="mt-2">
            <ReadingInput label="Most likely total of two dice" onRecord={(v) => session.dispatch("param.set", { key: "result:mode", value: v })} disabled={ro} />
          </div>
        </Panel>
      </div>
    </div>
  );
}
