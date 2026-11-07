import { useReducedMotion } from "framer-motion";
import { Play, RotateCcw, Square, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { pendulumStep } from "../core/mechanics";
import { FixedClock, rad } from "../core/runtime";
import type { PendulumSetup, PendulumState } from "../labs/mechanics";
import { gFromPeriods } from "../labs/mechanics";
import { Btn, LiveGraph, Panel, ParamSlider, ReadingInput, Readout, sf } from "./kit";
import type { SimSession } from "./useSimSession";

/**
 * Simple pendulum: a real nonlinear swing (RK4 at 1/240 s), a metre rule with a lens at the bob so
 * the length is read to its centre, and a stopwatch the student starts and stops themselves.
 */
export function PendulumWorkspace({ session }: { session: SimSession<PendulumState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as PendulumSetup;
  const reduced = useReducedMotion();
  const ro = session.readOnly;
  const L = s.stringM + setup.bobRadiusM;

  // swing
  const [theta, setTheta] = useState(rad(s.amplitude));
  const sim = useRef<[number, number]>([rad(s.amplitude), 0]);
  const passes = useRef(0);
  const [passCount, setPassCount] = useState(0);
  useEffect(() => {
    sim.current = [rad(s.amplitude), 0];
    setTheta(s.released ? rad(s.amplitude) : rad(s.amplitude));
    passes.current = 0;
    setPassCount(0);
    if (!s.released) return;
    const clock = new FixedClock();
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      clock.advance((now - last) / 1000, (h) => {
        const prev = sim.current[0];
        sim.current = pendulumStep(sim.current, L, setup.g, h);
        if (prev > 0 && sim.current[0] <= 0) passes.current++; // one full oscillation per crossing in this direction
      });
      last = now;
      setTheta(sim.current[0]);
      setPassCount(passes.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [s.released, s.amplitude, L, setup.g]);

  // stopwatch (the student's own reaction time is part of the measurement)
  const [sw, setSw] = useState<{ running: boolean; start: number; elapsed: number; passesAtStart: number }>({ running: false, start: 0, elapsed: 0, passesAtStart: 0 });
  const [, tickSw] = useState(0);
  useEffect(() => {
    if (!sw.running) return;
    const id = window.setInterval(() => tickSw((x) => x + 1), 31);
    return () => window.clearInterval(id);
  }, [sw.running]);
  const elapsed = sw.running ? (performance.now() - sw.start) / 1000 : sw.elapsed;
  const [n, setN] = useState(20);

  const W = 360;
  const H = 440;
  const px = W / 2;
  const py = 30;
  const k = 260; // px per metre
  const bx = px + Math.sin(theta) * L * k;
  const by = py + Math.cos(theta) * L * k;
  const points = Object.entries(s.periods).map(([key, T]) => ({ L: Number(key) + setup.bobRadiusM, T }));
  const gEst = gFromPeriods(points);

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
      <div className="grid min-h-0 gap-3 md:grid-cols-[minmax(0,1fr)_200px]">
        <div className="relative min-h-[320px] overflow-hidden rounded-xl bg-[radial-gradient(500px_400px_at_50%_10%,#1d3263,#0a1226)] ring-1 ring-inset ring-white/10">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label={`Pendulum, length ${L.toFixed(3)} m, ${s.released ? "swinging" : "at rest"}`}>
            <rect x={px - 70} y={py - 12} width={140} height={12} fill="#495057" />
            {/* metre rule */}
            <g>
              <rect x={px + 60} y={py} width={26} height={1.5 * k} fill="#f1e3b5" />
              {Array.from({ length: 151 }, (_, i) => (
                <line key={i} x1={px + 60} y1={py + i * 0.01 * k} x2={px + 60 + (i % 10 === 0 ? 14 : i % 5 === 0 ? 10 : 6)} y2={py + i * 0.01 * k} stroke="#333" strokeWidth={i % 10 === 0 ? 1 : 0.5} />
              ))}
              {Array.from({ length: 16 }, (_, i) => (
                <text key={i} x={px + 84} y={py + i * 0.1 * k + 3} fontSize={7} textAnchor="end" fill="#333">
                  {i * 10}
                </text>
              ))}
            </g>
            {/* amplitude guide */}
            {!s.released && <path d={`M ${px} ${py} L ${px + Math.sin(rad(s.amplitude)) * 60} ${py + Math.cos(rad(s.amplitude)) * 60}`} stroke="rgba(255,255,255,.2)" strokeDasharray="3 3" />}
            <line x1={px} y1={py} x2={px} y2={py + L * k + 20} stroke="rgba(255,255,255,.12)" strokeDasharray="4 4" />
            <line x1={px} y1={py} x2={bx} y2={by} stroke="#e9ecef" strokeWidth={1.2} />
            <circle cx={bx} cy={by} r={setup.bobRadiusM * k} fill="#ced4da" stroke="#868e96" />
            <circle cx={px} cy={py} r={3} fill="#e9ecef" />
            {reduced && s.released && (
              <text x={px} y={H - 10} textAnchor="middle" fontSize={11} fill="rgba(255,255,255,.6)">
                (swinging; motion shown in real time)
              </text>
            )}
          </svg>
        </div>
        <Panel title="Ruler lens (at the bob)">
          <RulerLens stringM={s.stringM} bobR={setup.bobRadiusM} />
          <p className="mt-2 text-[11px] text-white/50">Measure from the pivot to the bob's centre.</p>
          <div className="mt-2">
            <ReadingInput label="Length L" unit="m" onRecord={(v) => session.dispatch("measure.read", { instrument: "metre-rule", reading: { key: "L", value: v, unit: "m" } })} disabled={ro} width="w-20" />
          </div>
        </Panel>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Set up">
          <div className="space-y-3">
            <ParamSlider label="String length" value={s.stringM} min={0.2} max={1.2} step={0.05} unit="m" onCommit={(v) => session.dispatch("param.set", { key: "length", value: v })} disabled={ro || s.released} />
            <ParamSlider label="Release angle" value={s.amplitude} min={2} max={45} step={1} unit="°" onCommit={(v) => session.dispatch("param.set", { key: "amplitude", value: v })} disabled={ro || s.released} />
            <div className="grid grid-cols-2 gap-2">
              <Btn tone="primary" onClick={() => session.dispatch("sim.start", {} as Record<string, never>)} disabled={ro || s.released}>
                <Play className="h-4 w-4" /> Release
              </Btn>
              <Btn onClick={() => session.dispatch("sim.reset", {} as Record<string, never>)} disabled={ro || !s.released}>
                <RotateCcw className="h-4 w-4" /> Stop the bob
              </Btn>
            </div>
          </div>
        </Panel>
        <Panel title="Stopwatch">
          <div className="flex items-center justify-between">
            <span className="font-mono text-3xl font-bold tabular-nums text-white" aria-live="off">
              {elapsed.toFixed(2)}
              <span className="text-base text-white/50"> s</span>
            </span>
            <span className="text-xs text-white/55">oscillations: {Math.max(0, passCount - sw.passesAtStart)}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {!sw.running ? (
              <Btn tone="primary" onClick={() => setSw({ running: true, start: performance.now(), elapsed: 0, passesAtStart: passCount })} disabled={ro || !s.released}>
                <Timer className="h-4 w-4" /> Start
              </Btn>
            ) : (
              <Btn tone="danger" onClick={() => setSw({ ...sw, running: false, elapsed: (performance.now() - sw.start) / 1000 })}>
                <Square className="h-4 w-4" /> Stop
              </Btn>
            )}
            <Btn onClick={() => setSw({ running: false, start: 0, elapsed: 0, passesAtStart: passCount })} disabled={sw.running}>
              Reset
            </Btn>
          </div>
          <div className="mt-3 flex items-end gap-2">
            <label className="text-[11px] font-semibold text-white/60">
              Oscillations timed
              <input type="number" min={1} max={50} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value)))} className="mt-0.5 block h-9 w-16 rounded-md bg-black/30 px-2 font-mono text-sm text-white ring-1 ring-inset ring-white/15" />
            </label>
            <Btn onClick={() => session.dispatch("measure.read", { instrument: "stopwatch", reading: { key: `t:${n}`, value: Number(sw.elapsed.toFixed(2)), unit: "s" } })} disabled={ro || sw.running || sw.elapsed === 0}>
              Record {sw.elapsed.toFixed(2)} s
            </Btn>
          </div>
        </Panel>
        <Panel title={`Results (${points.length} lengths)`}>
          {points.length > 0 && (
            <table className="mb-2 w-full text-xs">
              <thead className="text-white/45">
                <tr>
                  <th className="text-left">L / m</th>
                  <th className="text-right">T / s</th>
                  <th className="text-right">T² / s²</th>
                </tr>
              </thead>
              <tbody className="font-mono text-white/85">
                {points.map((p) => (
                  <tr key={p.L}>
                    <td>{p.L.toFixed(3)}</td>
                    <td className="text-right">{p.T.toFixed(3)}</td>
                    <td className="text-right">{(p.T * p.T).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <LiveGraph series={[{ label: "T² against L", colour: "#7cf3ff", mode: "scatter", points: points.map((p) => ({ x: p.L, y: p.T * p.T })) }]} xLabel="L / m" yLabel="T² / s²" height={140} fitOrigin />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Readout label="4π² ÷ gradient" value={gEst ? sf(gEst, 4) : "–"} unit="m/s²" />
          </div>
          <div className="mt-2">
            <ReadingInput label="Your value of g" unit="m/s²" onRecord={(v) => session.dispatch("param.set", { key: "result:g", value: v })} disabled={ro || points.length < 2} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** Magnified rule around the bob: mm ticks, the bob drawn to scale. */
function RulerLens({ stringM, bobR }: { stringM: number; bobR: number }) {
  const top = stringM - 0.03;
  const mm = 6; // px per mm
  const h = 0.08 * 1000 * mm;
  const y = (m: number) => (m - top) * 1000 * mm;
  return (
    <svg viewBox={`0 0 170 ${h}`} className="h-[260px] w-full rounded-lg bg-[#0e1529]" role="img" aria-label="Magnified ruler around the bob">
      <rect x={110} y={0} width={60} height={h} fill="#f1e3b5" />
      {Array.from({ length: 81 }, (_, i) => {
        const m = Math.round((top + i / 1000) * 1000) / 1000;
        const cm = Math.round(m * 1000) % 10 === 0;
        return (
          <g key={i}>
            <line x1={110} y1={y(m)} x2={110 + (cm ? 22 : Math.round(m * 1000) % 5 === 0 ? 15 : 9)} y2={y(m)} stroke="#222" strokeWidth={cm ? 1.2 : 0.6} />
            {cm && (
              <text x={166} y={y(m) + 4} fontSize={11} textAnchor="end" fill="#222" fontWeight={700}>
                {(m * 100).toFixed(0)}
              </text>
            )}
          </g>
        );
      })}
      <line x1={55} y1={0} x2={55} y2={y(stringM)} stroke="#e9ecef" />
      <circle cx={55} cy={y(stringM + bobR)} r={bobR * 1000 * mm} fill="#ced4da" stroke="#868e96" />
      <line x1={20} y1={y(stringM + bobR)} x2={110} y2={y(stringM + bobR)} stroke="#ff6b6b" strokeDasharray="3 3" />
      <text x={6} y={y(stringM + bobR) - 4} fontSize={9} fill="#ff8787">
        centre
      </text>
      <text x={110} y={h - 4} fontSize={9} fill="#555" dx={4}>
        cm
      </text>
    </svg>
  );
}
