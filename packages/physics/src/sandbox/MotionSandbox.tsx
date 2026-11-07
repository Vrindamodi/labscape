import { Pause, Play, RotateCcw, Rocket } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { idealFlight, pendulumPeriod, pendulumStep, PLANETS, PROJECTILES, simulateFlight, smallAnglePeriod, type Planet, type ProjectileKind } from "../core/mechanics";
import { Btn, LiveGraph, Panel, ParamSlider, Readout, sf } from "../ui/kit";

export type ProjectileParams = { speed: number; angleDeg: number; heightM: number; planet: Planet; projectile: ProjectileKind; drag: boolean };
export type PendulumParams = { lengthM: number; amplitudeDeg: number; planet: Planet; damping: number };
export type MotionBuild = { tab: "projectile" | "pendulum"; projectile: ProjectileParams; pendulum: PendulumParams };

export const DEFAULT_MOTION: MotionBuild = {
  tab: "projectile",
  projectile: { speed: 20, angleDeg: 45, heightM: 0, planet: "earth", projectile: "ball", drag: false },
  pendulum: { lengthM: 1, amplitudeDeg: 20, planet: "earth", damping: 0 },
};

const TRAIL_COLOURS = ["#ffd43b", "#7cf3ff", "#f472b6", "#a78bfa", "#51cf66", "#ff922b"];

/**
 * Motion sandbox (build plan 4.9): projectile and pendulum with every parameter unlocked, other
 * planets and air resistance included. Uses the same integrators the experiments are scored with.
 */
export function MotionSandbox({ initial, onChange }: { initial?: MotionBuild | null; onChange?: (b: MotionBuild) => void }) {
  const [b, setB] = useState<MotionBuild>(() => ({ ...DEFAULT_MOTION, ...initial, projectile: { ...DEFAULT_MOTION.projectile, ...initial?.projectile }, pendulum: { ...DEFAULT_MOTION.pendulum, ...initial?.pendulum } }));
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => cb.current?.(b), [b]);
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5" role="tablist" aria-label="Motion">
        {(["projectile", "pendulum"] as const).map((t) => (
          <Btn key={t} tone={b.tab === t ? "primary" : "secondary"} pressed={b.tab === t} onClick={() => setB((x) => ({ ...x, tab: t }))}>
            {t === "projectile" ? "Projectile" : "Pendulum"}
          </Btn>
        ))}
      </div>
      {b.tab === "projectile" ? (
        <ProjectileLab p={b.projectile} set={(p) => setB((x) => ({ ...x, projectile: { ...x.projectile, ...p } }))} />
      ) : (
        <PendulumLab p={b.pendulum} set={(p) => setB((x) => ({ ...x, pendulum: { ...x.pendulum, ...p } }))} />
      )}
    </div>
  );
}

function PlanetPicker({ value, onChange }: { value: Planet; onChange: (p: Planet) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Gravity">
      {(Object.keys(PLANETS) as Planet[]).map((k) => (
        <Btn key={k} tone={value === k ? "primary" : "ghost"} pressed={value === k} onClick={() => onChange(k)}>
          {PLANETS[k].label} <span className="text-white/50">{PLANETS[k].g}</span>
        </Btn>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ projectile */

type Shot = { id: number; colour: string; label: string; points: { t: number; x: number; y: number }[]; range: number; time: number; maxHeight: number };

function ProjectileLab({ p, set }: { p: ProjectileParams; set: (p: Partial<ProjectileParams>) => void }) {
  const g = PLANETS[p.planet].g;
  const [shots, setShots] = useState<Shot[]>([]);
  const [flying, setFlying] = useState<{ id: number; t: number } | null>(null);
  const seq = useRef(0);
  const ideal = useMemo(() => idealFlight({ speed: p.speed, angleDeg: p.angleDeg, g, heightM: p.heightM }), [p, g]);
  const preview = useMemo(() => simulateFlight({ speed: p.speed, angleDeg: p.angleDeg, g, heightM: p.heightM, drag: p.drag, projectile: p.projectile }), [p, g]);

  const launch = () => {
    const id = ++seq.current;
    const colour = TRAIL_COLOURS[(id - 1) % TRAIL_COLOURS.length]!;
    const label = `${p.speed} m/s @ ${p.angleDeg}°${p.drag ? " + air" : ""}${p.planet !== "earth" ? ` · ${PLANETS[p.planet].label}` : ""}`;
    setShots((s) => [...s.slice(-5), { id, colour, label, points: preview.points, range: preview.range, time: preview.time, maxHeight: preview.maxHeight }]);
    setFlying({ id, t: 0 });
  };
  // Animate the newest shot in real time (sped up for long flights).
  useEffect(() => {
    if (!flying) return;
    const shot = shots.find((s) => s.id === flying.id);
    if (!shot) return;
    const speedUp = Math.max(1, shot.time / 4);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) / 1000) * speedUp;
      if (t >= shot.time) return setFlying(null);
      setFlying({ id: shot.id, t });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flying?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = [...shots.map((s) => s.points), preview.points];
  const xMax = Math.max(10, ...all.flat().map((q) => q.x)) * 1.08;
  const yMax = Math.max(5, ...all.flat().map((q) => q.y)) * 1.15;
  const scale = Math.min(880 / xMax, 340 / yMax);
  const X = (x: number) => 50 + x * scale;
  const Y = (y: number) => 380 - y * scale;
  const path = (pts: { x: number; y: number }[], upto = Infinity) => pts.filter((_, i) => i === 0 || (pts[i] as { t?: number }).t! <= upto).map((q, i) => `${i ? "L" : "M"}${X(q.x).toFixed(1)} ${Y(q.y).toFixed(1)}`).join(" ");
  const live = flying ? shots.find((s) => s.id === flying.id) : null;
  const ball = live ? live.points.find((q) => q.t >= flying!.t) ?? live.points[live.points.length - 1] : null;
  const raw = xMax / 7, mag = Math.pow(10, Math.floor(Math.log10(raw))), unit = raw / mag;
  const step = (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * mag;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-2">
        <div className="overflow-hidden rounded-xl bg-gradient-to-b from-[#0b1734] to-[#0a1020] ring-1 ring-inset ring-white/[0.08]">
          <svg viewBox="0 0 960 420" className="block w-full" role="img" aria-label={`Projectile paths. Current settings land at ${sf(preview.range)} metres after ${sf(preview.time)} seconds.`}>
            <line x1={0} y1={380} x2={960} y2={380} stroke="#3b4a6b" strokeWidth={2} />
            {Array.from({ length: Math.floor(xMax / step) + 1 }, (_, i) => i * step).map((x) => (
              <g key={x}>
                <line x1={X(x)} x2={X(x)} y1={380} y2={386} stroke="#ffffff40" />
                <text x={X(x)} y={402} textAnchor="middle" className="fill-white/40 text-[11px]">
                  {sf(x)} m
                </text>
              </g>
            ))}
            {p.heightM > 0 && <rect x={X(0) - 18} y={Y(p.heightM)} width={18} height={380 - Y(p.heightM)} fill="#26324f" />}
            <path d={path(preview.points)} fill="none" stroke="#ffffff55" strokeDasharray="5 6" strokeWidth={1.5} />
            {shots.map((s) => (
              <path key={s.id} d={live?.id === s.id ? path(s.points, flying!.t) : path(s.points)} fill="none" stroke={s.colour} strokeWidth={2.5} />
            ))}
            {ball && <circle cx={X(ball.x)} cy={Y(ball.y)} r={7} fill="#fff" stroke={live!.colour} strokeWidth={3} />}
            <g transform={`translate(${X(0)} ${Y(p.heightM)}) rotate(${-p.angleDeg})`}>
              <rect x={-4} y={-6} width={36} height={12} rx={3} fill="#8aa0c8" />
            </g>
          </svg>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn tone="primary" onClick={launch}>
            <Rocket className="mr-1 inline h-4 w-4" /> Launch
          </Btn>
          <Btn tone="ghost" onClick={() => setShots([])} disabled={!shots.length}>
            Clear trails
          </Btn>
          <ul className="flex flex-wrap gap-2 text-xs">
            {shots.map((s) => (
              <li key={s.id} className="flex items-center gap-1 rounded-full bg-white/[0.05] px-2 py-0.5 text-white/70">
                <span className="h-2 w-2 rounded-full" style={{ background: s.colour }} />
                {s.label}: {sf(s.range)} m
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="space-y-3">
        <Panel title="Launch">
          <div className="space-y-3">
            <ParamSlider label="Speed" value={p.speed} min={1} max={60} step={1} unit="m/s" onChange={(v) => set({ speed: v })} onCommit={(v) => set({ speed: v })} />
            <ParamSlider label="Angle" value={p.angleDeg} min={0} max={90} step={1} unit="°" onChange={(v) => set({ angleDeg: v })} onCommit={(v) => set({ angleDeg: v })} />
            <ParamSlider label="Launch height" value={p.heightM} min={0} max={50} step={1} unit="m" onChange={(v) => set({ heightM: v })} onCommit={(v) => set({ heightM: v })} />
            <PlanetPicker value={p.planet} onChange={(planet) => set({ planet })} />
            <div className="flex flex-wrap gap-1">
              {(Object.keys(PROJECTILES) as ProjectileKind[]).map((k) => (
                <Btn key={k} tone={p.projectile === k ? "primary" : "ghost"} pressed={p.projectile === k} onClick={() => set({ projectile: k })}>
                  {PROJECTILES[k].label}
                </Btn>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-white/80">
              <input type="checkbox" checked={p.drag} onChange={(e) => set({ drag: e.target.checked })} className="h-4 w-4 accent-[#2f80ff]" />
              Air resistance
            </label>
          </div>
        </Panel>
        <Panel title="Prediction">
          <div className="grid grid-cols-3 gap-2">
            <Readout label="Range" value={sf(preview.range)} unit="m" />
            <Readout label="Flight time" value={sf(preview.time)} unit="s" />
            <Readout label="Max height" value={sf(preview.maxHeight)} unit="m" />
          </div>
          {p.drag && <p className="mt-2 text-xs text-white/55">Without air the range would be {sf(ideal.range)} m: drag costs {sf(Math.max(0, 100 * (1 - preview.range / ideal.range)), 2)}%.</p>}
        </Panel>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pendulum */

function PendulumLab({ p, set }: { p: PendulumParams; set: (p: Partial<PendulumParams>) => void }) {
  const g = PLANETS[p.planet].g;
  const [running, setRunning] = useState(true);
  const [view, setView] = useState({ theta: (p.amplitudeDeg * Math.PI) / 180, t: 0, trace: [] as { x: number; y: number }[], periods: [] as number[] });
  const st = useRef({ y: [(p.amplitudeDeg * Math.PI) / 180, 0] as [number, number], t: 0, lastCross: null as number | null, trace: [] as { x: number; y: number }[], periods: [] as number[] });
  const reset = () => {
    st.current = { y: [(p.amplitudeDeg * Math.PI) / 180, 0], t: 0, lastCross: null, trace: [], periods: [] };
    setView({ theta: st.current.y[0], t: 0, trace: [], periods: [] });
  };
  // Restart whenever the set-up changes.
  useEffect(reset, [p.lengthM, p.amplitudeDeg, p.planet]);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = st.current;
      const sub = 8;
      for (let i = 0; i < sub; i++) {
        const prev = s.y[0];
        s.y = pendulumStep(s.y, p.lengthM, g, dt / sub, p.damping);
        s.t += dt / sub;
        // Downward zero crossings (one per period, same direction).
        if (prev > 0 && s.y[0] <= 0) {
          if (s.lastCross !== null) s.periods = [...s.periods.slice(-4), s.t - s.lastCross];
          s.lastCross = s.t;
        }
      }
      s.trace = [...s.trace.filter((q) => q.x > s.t - 12), { x: s.t, y: (s.y[0] * 180) / Math.PI }];
      setView({ theta: s.y[0], t: s.t, trace: s.trace, periods: s.periods });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, p.lengthM, p.damping, g]);

  const L = 40 + 260 * Math.min(1, p.lengthM / 5);
  const bx = 300 + L * Math.sin(view.theta), by = 40 + L * Math.cos(view.theta);
  const measured = view.periods.length ? view.periods.reduce((a, b) => a + b, 0) / view.periods.length : null;
  const exact = pendulumPeriod(p.lengthM, p.amplitudeDeg, g);
  const small = smallAnglePeriod(p.lengthM, g);
  const traceMin = Math.max(0, view.t - 12);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-2">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-xl bg-[#0a1020] ring-1 ring-inset ring-white/[0.08]">
            <svg viewBox="0 0 600 380" className="block w-full" role="img" aria-label={`Pendulum ${p.lengthM} metres long swinging, now at ${sf((view.theta * 180) / Math.PI, 2)} degrees`}>
              <rect x={220} y={30} width={160} height={10} rx={3} fill="#3b4a6b" />
              <path d={`M300 40 L${300 + L * Math.sin((p.amplitudeDeg * Math.PI) / 180)} ${40 + L * Math.cos((p.amplitudeDeg * Math.PI) / 180)}`} stroke="#ffffff18" strokeDasharray="4 4" />
              <line x1={300} y1={40} x2={bx} y2={by} stroke="#c9d1e4" strokeWidth={2} />
              <circle cx={bx} cy={by} r={16} fill="#ffd43b" stroke="#7a5200" strokeWidth={2} />
            </svg>
          </div>
          <div className="rounded-xl bg-[#0a1020] p-2 ring-1 ring-inset ring-white/[0.08]">
            <LiveGraph series={[{ label: "angle", colour: "#ffd43b", points: view.trace }]} xLabel="time (s)" yLabel="angle (°)" height={220} xMin={traceMin} yMin={-Math.max(5, p.amplitudeDeg)} ariaLabel="Angle against time" />
          </div>
        </div>
        <div className="flex gap-2">
          <Btn tone="primary" onClick={() => setRunning((r) => !r)}>
            {running ? <Pause className="mr-1 inline h-4 w-4" /> : <Play className="mr-1 inline h-4 w-4" />}
            {running ? "Pause" : "Swing"}
          </Btn>
          <Btn tone="ghost" onClick={reset}>
            <RotateCcw className="mr-1 inline h-4 w-4" /> Release again
          </Btn>
        </div>
      </div>
      <div className="space-y-3">
        <Panel title="Pendulum">
          <div className="space-y-3">
            <ParamSlider label="Length" value={p.lengthM} min={0.1} max={5} step={0.1} unit="m" onChange={(v) => set({ lengthM: v })} onCommit={(v) => set({ lengthM: v })} />
            <ParamSlider label="Release angle" value={p.amplitudeDeg} min={1} max={170} step={1} unit="°" onChange={(v) => set({ amplitudeDeg: v })} onCommit={(v) => set({ amplitudeDeg: v })} />
            <ParamSlider label="Damping" value={p.damping} min={0} max={0.5} step={0.01} onChange={(v) => set({ damping: v })} onCommit={(v) => set({ damping: v })} />
            <PlanetPicker value={p.planet} onChange={(planet) => set({ planet })} />
          </div>
        </Panel>
        <Panel title="Period">
          <div className="grid grid-cols-3 gap-2">
            <Readout label="Measured" value={measured ? sf(measured) : "…"} unit="s" />
            <Readout label="Exact" value={sf(exact)} unit="s" />
            <Readout label="2π√(L/g)" value={sf(small)} unit="s" tone={Math.abs(exact - small) / exact > 0.02 ? "warn" : "default"} />
          </div>
          <p className="mt-2 text-xs text-white/55">{Math.abs(exact - small) / exact > 0.02 ? `At ${p.amplitudeDeg}° the small-angle formula is ${sf((100 * (exact - small)) / exact, 2)}% too short: big swings take longer.` : "At this angle the small-angle formula is within 2% of the truth."}</p>
        </Panel>
      </div>
    </div>
  );
}
