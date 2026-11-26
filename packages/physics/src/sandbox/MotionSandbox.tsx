import { Pause, Play, RotateCcw, Rocket } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { idealFlight, pendulumPeriod, pendulumStep, PLANETS, PROJECTILES, simulateFlight, smallAnglePeriod, type Planet, type ProjectileKind } from "../core/mechanics";
import { GuideCard, Hint, Narration } from "../ui/explain";
import { Btn, LiveGraph, Panel, ParamSlider, Readout, sf, Vector } from "../ui/kit";
import { CollisionLab } from "./motion/CollisionLab";
import { RampLab } from "./motion/RampLab";
import { GRAV, gravityWords, PlanetPicker, VX, VY } from "./motion/shared";
import { SpringLab } from "./motion/SpringLab";
import { DEFAULT_COLLISION, DEFAULT_RAMP, DEFAULT_SPRING, type CollisionParams, type RampParams, type SpringParams } from "./motionScenes";

export { gravityWords };
export type { CollisionParams, RampParams, SpringParams };

export type ProjectileParams = { speed: number; angleDeg: number; heightM: number; planet: Planet; projectile: ProjectileKind; drag: boolean };
export type PendulumParams = { lengthM: number; amplitudeDeg: number; planet: Planet; damping: number };

/** The scenes, in tab order. The ids are what a saved build and a `?tab=` deep link use. */
export const MOTION_TABS = ["projectile", "pendulum", "collisions", "spring", "ramp"] as const;
export type MotionTab = (typeof MOTION_TABS)[number];
const TAB_LABELS: Record<MotionTab, string> = { projectile: "Projectile", pendulum: "Pendulum", collisions: "Collisions", spring: "Spring", ramp: "Ramp" };

export type MotionBuild = { tab: MotionTab; projectile: ProjectileParams; pendulum: PendulumParams; collisions: CollisionParams; spring: SpringParams; ramp: RampParams };

export const DEFAULT_MOTION: MotionBuild = {
  tab: "projectile",
  projectile: { speed: 20, angleDeg: 45, heightM: 0, planet: "earth", projectile: "ball", drag: false },
  pendulum: { lengthM: 1, amplitudeDeg: 20, planet: "earth", damping: 0 },
  collisions: DEFAULT_COLLISION,
  spring: DEFAULT_SPRING,
  ramp: DEFAULT_RAMP,
};

/**
 * Anything a build can be started from: a full save, an older save that only knows some of the
 * scenes, or just `{ tab }` from a deep link.
 */
export type MotionSnapshot = { tab?: string | null; projectile?: Partial<ProjectileParams> | null; pendulum?: Partial<PendulumParams> | null; collisions?: Partial<CollisionParams> | null; spring?: Partial<SpringParams> | null; ramp?: Partial<RampParams> | null };

/** One scene's saved settings over its defaults. A value of the wrong kind (or an unknown planet or ball) falls back to the default. */
function mergeScene<T extends Record<string, unknown>>(defaults: T, saved: unknown): T {
  const out: Record<string, unknown> = { ...defaults };
  if (!saved || typeof saved !== "object") return out as T;
  for (const key of Object.keys(defaults)) {
    const v = (saved as Record<string, unknown>)[key];
    if (typeof v !== typeof defaults[key] || (typeof v === "number" && !Number.isFinite(v))) continue;
    if (key === "planet" && !Object.hasOwn(PLANETS, v as string)) continue;
    if (key === "projectile" && !Object.hasOwn(PROJECTILES, v as string)) continue;
    out[key] = v;
  }
  return out as T;
}

/**
 * A complete build from whatever was saved: every scene gets its defaults with the saved settings
 * on top, so old saves (projectile and pendulum only) and bare `{ tab }` links both load. An
 * unknown tab opens the projectile.
 */
export function mergeMotionBuild(initial?: MotionSnapshot | null): MotionBuild {
  const tab = MOTION_TABS.find((t) => t === initial?.tab) ?? "projectile";
  return {
    tab,
    projectile: mergeScene(DEFAULT_MOTION.projectile, initial?.projectile),
    pendulum: mergeScene(DEFAULT_MOTION.pendulum, initial?.pendulum),
    collisions: mergeScene(DEFAULT_MOTION.collisions, initial?.collisions),
    spring: mergeScene(DEFAULT_MOTION.spring, initial?.spring),
    ramp: mergeScene(DEFAULT_MOTION.ramp, initial?.ramp),
  };
}

const TRAIL_COLOURS = ["#ffd43b", "#7cf3ff", "#f472b6", "#a78bfa", "#51cf66", "#ff922b"];

/**
 * Motion sandbox (build plan 4.9): projectile, pendulum, collisions, a mass on a spring and a block
 * on a ramp, with every parameter unlocked and other planets included. The projectile and pendulum
 * use the same integrators the experiments are scored with; every scene says in plain words what
 * is happening as it happens.
 */
export function MotionSandbox({ initial, onChange }: { initial?: MotionSnapshot | null; onChange?: (b: MotionBuild) => void }) {
  const [b, setB] = useState<MotionBuild>(() => mergeMotionBuild(initial));
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => cb.current?.(b), [b]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Motion">
        {MOTION_TABS.map((t) => (
          <Btn key={t} tone={b.tab === t ? "primary" : "secondary"} pressed={b.tab === t} onClick={() => setB((x) => ({ ...x, tab: t }))}>
            {TAB_LABELS[t]}
          </Btn>
        ))}
      </div>
      {b.tab === "projectile" && <ProjectileLab p={b.projectile} set={(p) => setB((x) => ({ ...x, projectile: { ...x.projectile, ...p } }))} />}
      {b.tab === "pendulum" && <PendulumLab p={b.pendulum} set={(p) => setB((x) => ({ ...x, pendulum: { ...x.pendulum, ...p } }))} />}
      {b.tab === "collisions" && <CollisionLab p={b.collisions} set={(p) => setB((x) => ({ ...x, collisions: { ...x.collisions, ...p } }))} />}
      {b.tab === "spring" && <SpringLab p={b.spring} set={(p) => setB((x) => ({ ...x, spring: { ...x.spring, ...p } }))} />}
      {b.tab === "ramp" && <RampLab p={b.ramp} set={(p) => setB((x) => ({ ...x, ramp: { ...x.ramp, ...p } }))} />}
    </div>
  );
}

/* ------------------------------------------------------------------ projectile */

type Shot = { id: number; colour: string; label: string; points: { t: number; x: number; y: number; vx: number; vy: number }[]; range: number; time: number; maxHeight: number };

/** What the ball is doing at this moment of its flight, in words. */
export function flightNarration(pt: { vx: number; vy: number; y: number }, g: number, landed: boolean, shot: { range: number; time: number; maxHeight: number }): string {
  if (landed) return `Landed ${sf(shot.range)} m away after ${sf(shot.time)} s. Its highest point was ${sf(shot.maxHeight)} m.`;
  const speed = Math.hypot(pt.vx, pt.vy);
  if (Math.abs(pt.vy) < Math.max(0.6, speed * 0.05)) return `Highest point: the upward speed has fallen to 0, so only the sideways speed (${sf(Math.abs(pt.vx), 2)} m/s) is left. From here gravity pulls it back down.`;
  if (pt.vy > 0) return `Going up: gravity slows the upward speed by ${sf(g, 3)} m/s every second (now ${sf(pt.vy, 2)} m/s up). The sideways speed stays at ${sf(pt.vx, 2)} m/s.`;
  return `Coming down: gravity speeds it up by ${sf(g, 3)} m/s every second (now ${sf(-pt.vy, 2)} m/s down). The sideways speed is still ${sf(pt.vx, 2)} m/s.`;
}

function ProjectileLab({ p, set }: { p: ProjectileParams; set: (p: Partial<ProjectileParams>) => void }) {
  const g = PLANETS[p.planet].g;
  const [shots, setShots] = useState<Shot[]>([]);
  const [flying, setFlying] = useState<{ id: number; t: number } | null>(null);
  const [landedId, setLandedId] = useState<number | null>(null);
  const seq = useRef(0);
  const ideal = useMemo(() => idealFlight({ speed: p.speed, angleDeg: p.angleDeg, g, heightM: p.heightM }), [p, g]);
  const preview = useMemo(() => simulateFlight({ speed: p.speed, angleDeg: p.angleDeg, g, heightM: p.heightM, drag: p.drag, projectile: p.projectile }), [p, g]);
  const earth = useMemo(() => (p.planet === "earth" ? null : simulateFlight({ speed: p.speed, angleDeg: p.angleDeg, g: PLANETS.earth.g, heightM: p.heightM, drag: p.drag, projectile: p.projectile })), [p]);

  const launch = () => {
    const id = ++seq.current;
    const colour = TRAIL_COLOURS[(id - 1) % TRAIL_COLOURS.length]!;
    const label = `${p.speed} m/s @ ${p.angleDeg}°${p.drag ? " + air" : ""}${p.planet !== "earth" ? ` · ${PLANETS[p.planet].label}` : ""}`;
    setShots((s) => [...s.slice(-5), { id, colour, label, points: preview.points, range: preview.range, time: preview.time, maxHeight: preview.maxHeight }]);
    setFlying({ id, t: 0 });
    setLandedId(null);
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
      if (t >= shot.time) {
        setLandedId(shot.id);
        return setFlying(null);
      }
      setFlying({ id: shot.id, t });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flying?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = [...shots.map((s) => s.points), preview.points];
  const xMax = Math.max(10, ...all.flat().map((q) => q.x)) * 1.08;
  const yMax = Math.max(5, ...all.flat().map((q) => q.y)) * 1.15;
  const scale = Math.min(880 / xMax, 330 / yMax);
  const X = (x: number) => 50 + x * scale;
  const Y = (y: number) => 380 - y * scale;
  const path = (pts: { x: number; y: number }[], upto = Infinity) => pts.filter((_, i) => i === 0 || (pts[i] as { t?: number }).t! <= upto).map((q, i) => `${i ? "L" : "M"}${X(q.x).toFixed(1)} ${Y(q.y).toFixed(1)}`).join(" ");
  const live = flying ? shots.find((s) => s.id === flying.id) : null;
  const ball = live ? live.points.find((q) => q.t >= flying!.t) ?? live.points[live.points.length - 1] : null;
  const landed = landedId !== null ? shots.find((s) => s.id === landedId) ?? null : null;
  const raw = xMax / 7, mag = Math.pow(10, Math.floor(Math.log10(raw))), unit = raw / mag;
  const step = (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * mag;
  // Arrows: 2.2 px per m/s, so a 20 m/s launch draws about 44 px.
  const K = 2.2;
  const vx0 = p.speed * Math.cos((p.angleDeg * Math.PI) / 180), vy0 = p.speed * Math.sin((p.angleDeg * Math.PI) / 180);
  const at = ball ?? { x: 0, y: p.heightM, vx: vx0, vy: vy0 };

  const narration = ball && live ? flightNarration(ball, g, false, live) : landed ? flightNarration({ vx: 0, vy: 0, y: 0 }, g, true, landed) : `Ready. ${p.speed} m/s at ${p.angleDeg}° splits into ${sf(vx0, 2)} m/s sideways (blue arrow) and ${sf(vy0, 2)} m/s upwards (pink arrow). The dashed line is where it will go. Press Launch.`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
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
            <text x={950} y={416} textAnchor="end" className="fill-white/45 text-[11px]">
              distance along the ground →
            </text>
            <text x={10} y={22} className="fill-white/45 text-[11px]">
              ↑ height
            </text>
            {p.heightM > 0 && <rect x={X(0) - 18} y={Y(p.heightM)} width={18} height={380 - Y(p.heightM)} fill="#26324f" />}
            <path d={path(preview.points)} fill="none" stroke="#ffffff55" strokeDasharray="5 6" strokeWidth={1.5} />
            {shots.map((s) => (
              <path key={s.id} d={live?.id === s.id ? path(s.points, flying!.t) : path(s.points)} fill="none" stroke={s.colour} strokeWidth={2.5} />
            ))}
            {/* top of the predicted arc */}
            {!ball && preview.maxHeight > 0.5 && (() => {
              const top = preview.points.reduce((m, q) => (q.y > m.y ? q : m), preview.points[0]!);
              return (
                <g>
                  <line x1={X(top.x)} x2={X(top.x)} y1={Y(top.y)} y2={380} stroke="#ffffff22" strokeDasharray="3 4" />
                  <text x={X(top.x)} y={Y(top.y) - 10} textAnchor="middle" className="fill-white/50 text-[11px]">
                    highest: {sf(top.y, 2)} m
                  </text>
                </g>
              );
            })()}
            <g transform={`translate(${X(0)} ${Y(p.heightM)}) rotate(${-p.angleDeg})`}>
              <rect x={-4} y={-6} width={36} height={12} rx={3} fill="#8aa0c8" />
            </g>
            {/* velocity split into sideways and up/down parts, and gravity */}
            <g pointerEvents="none">
              <Vector x={X(at.x)} y={Y(at.y)} dx={at.vx * K} dy={0} colour={VX} label="vx" />
              <Vector x={X(at.x)} y={Y(at.y)} dx={0} dy={-at.vy * K} colour={VY} label="vy" />
              <Vector x={X(at.x) + 16} y={Y(at.y) + 10} dx={0} dy={Math.min(60, 10 + g * 2.2)} colour={GRAV} label="g" width={2} />
            </g>
            {ball && <circle cx={X(ball.x)} cy={Y(ball.y)} r={7} fill="#fff" stroke={live!.colour} strokeWidth={3} />}
          </svg>
        </div>
        <Narration tone={landed && !ball ? "good" : "info"}>{narration}</Narration>
        <div className="flex flex-wrap items-center gap-2">
          <Btn tone="primary" onClick={launch}>
            <Rocket className="mr-1 inline h-4 w-4" /> Launch
          </Btn>
          <Btn tone="ghost" onClick={() => (setShots([]), setLandedId(null))} disabled={!shots.length}>
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
        <GuideCard
          id="motion-projectile"
          items={[
            { term: "The picture", text: "A side view. The ground is the bottom line; distance along the ground is marked in metres. The launcher is on the left." },
            { term: "Dashed line", text: "Where the ball will go with the settings you have now. Coloured lines are the shots you already launched, so you can compare." },
            { term: "Arrows", text: <><span style={{ color: VX }}>Blue (vx)</span> is the sideways speed: with no air it never changes. <span style={{ color: VY }}>Pink (vy)</span> is the up or down speed: gravity shrinks it on the way up and grows it on the way down. <span style={{ color: GRAV }}>Yellow (g)</span> is gravity, always pulling straight down.</> },
            { term: "Why it curves", text: "It moves sideways at a steady speed while gravity changes its up/down speed. Steady sideways + speeding-up downwards = a curve called a parabola." },
            { term: "Try this", text: "Launch at 30°, then at 60°. Same speed, same landing spot! Angles that add up to 90° go the same distance, and 45° goes furthest." },
          ]}
        />
      </div>
      <div className="min-w-0 space-y-3">
        <Panel title="Launch">
          <div className="space-y-3">
            <div className="space-y-1">
              <ParamSlider label="Speed" value={p.speed} min={1} max={60} step={1} unit="m/s" onChange={(v) => set({ speed: v })} onCommit={(v) => set({ speed: v })} />
              <Hint>How fast it leaves the launcher. Twice the speed goes about four times as far.</Hint>
            </div>
            <div className="space-y-1">
              <ParamSlider label="Angle" value={p.angleDeg} min={0} max={90} step={1} unit="°" onChange={(v) => set({ angleDeg: v })} onCommit={(v) => set({ angleDeg: v })} />
              <Hint>Steeper = higher but shorter time going sideways. 45° gives the longest throw on flat ground (with no air).</Hint>
            </div>
            <div className="space-y-1">
              <ParamSlider label="Launch height" value={p.heightM} min={0} max={50} step={1} unit="m" onChange={(v) => set({ heightM: v })} onCommit={(v) => set({ heightM: v })} />
              <Hint>Launching from a cliff gives it more time to fall, so it lands further away.</Hint>
            </div>
            <div className="space-y-1">
              <PlanetPicker value={p.planet} onChange={(planet) => set({ planet })} />
              <Hint>
                {gravityWords(p.planet)}
                {!earth ? " Try the Moon: the same throw goes about 6× further." : earth.range < 0.01 ? "" : g < PLANETS.earth.g ? ` Weaker gravity takes longer to stop it rising, so it flies ${sf(preview.range / earth.range, 2)}× as far as on Earth.` : ` Stronger gravity pulls it down sooner, so it only flies ${sf(preview.range / earth.range, 2)}× as far as on Earth.`}
              </Hint>
            </div>
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
            <Hint>{p.drag ? "Air pushes against the ball and slows it down, so it lands shorter and comes down more steeply. Light things like a shuttlecock feel it most." : "Off: no air, so only gravity acts. Switch it on to see how much air matters for each object."}</Hint>
          </div>
        </Panel>
        <Panel title="Prediction">
          <div className="grid grid-cols-3 gap-2">
            <Readout label="Range" value={sf(preview.range)} unit="m" />
            <Readout label="Flight time" value={sf(preview.time)} unit="s" />
            <Readout label="Max height" value={sf(preview.maxHeight)} unit="m" />
          </div>
          <Hint>Range = how far along the ground it lands. Flight time = how long it is in the air. Max height = the top of the curve.</Hint>
          {p.drag && ideal.range > 0.01 && <p className="mt-2 text-xs text-white/55">Without air the range would be {sf(ideal.range)} m: drag costs {sf(Math.max(0, 100 * (1 - preview.range / ideal.range)), 2)}%.</p>}
        </Panel>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pendulum */

/** What the bob is doing right now, in words. */
export function swingNarration(theta: number, omega: number, amplitude: number): string {
  const frac = amplitude > 1e-6 ? Math.abs(theta) / amplitude : 0;
  if (amplitude < 0.005) return "The swing has died away: damping has taken all of its energy.";
  if (frac > 0.9 && Math.abs(omega) < 0.35 * Math.sqrt(Math.max(1e-6, amplitude))) return `End of the swing: the bob stops for an instant and turns back. Its energy is all stored as height (potential energy), so the kinetic energy bar is almost empty.`;
  if (frac < 0.15) return "Passing the lowest point: this is where it moves fastest. Its stored height energy has turned into movement (kinetic energy).";
  return Math.sign(theta) !== Math.sign(omega) ? "Swinging down: it is speeding up as height energy turns into movement energy." : "Swinging up: it is slowing down as movement energy turns back into height energy.";
}

function PendulumLab({ p, set }: { p: PendulumParams; set: (p: Partial<PendulumParams>) => void }) {
  const g = PLANETS[p.planet].g;
  const [running, setRunning] = useState(true);
  const [view, setView] = useState({ theta: (p.amplitudeDeg * Math.PI) / 180, omega: 0, t: 0, trace: [] as { x: number; y: number }[], periods: [] as number[], peak: (p.amplitudeDeg * Math.PI) / 180 });
  const st = useRef({ y: [(p.amplitudeDeg * Math.PI) / 180, 0] as [number, number], t: 0, lastCross: null as number | null, trace: [] as { x: number; y: number }[], periods: [] as number[], peak: (p.amplitudeDeg * Math.PI) / 180 });
  const reset = () => {
    const a = (p.amplitudeDeg * Math.PI) / 180;
    st.current = { y: [a, 0], t: 0, lastCross: null, trace: [], periods: [], peak: a };
    setView({ theta: a, omega: 0, t: 0, trace: [], periods: [], peak: a });
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
        const prev = s.y;
        s.y = pendulumStep(s.y, p.lengthM, g, dt / sub, p.damping);
        s.t += dt / sub;
        // Turning points: the latest swing size (damping shrinks it).
        if (prev[1] * s.y[1] < 0) s.peak = Math.abs(s.y[0]);
        // Downward zero crossings (one per period, same direction).
        if (prev[0] > 0 && s.y[0] <= 0) {
          if (s.lastCross !== null) s.periods = [...s.periods.slice(-4), s.t - s.lastCross];
          s.lastCross = s.t;
        }
      }
      s.trace = [...s.trace.filter((q) => q.x > s.t - 12), { x: s.t, y: (s.y[0] * 180) / Math.PI }];
      setView({ theta: s.y[0], omega: s.y[1], t: s.t, trace: s.trace, periods: s.periods, peak: s.peak });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, p.lengthM, p.damping, g]);

  // A swing past 90° rises above the pivot and reaches a full string-length sideways, so the string
  // is drawn shorter and the pivot lower when needed: the bob stays in the picture at any release angle.
  const a0 = (p.amplitudeDeg * Math.PI) / 180;
  const rise = Math.max(0, -Math.cos(a0)), reach = a0 > Math.PI / 2 ? 1 : Math.sin(a0);
  const L = Math.min(40 + 260 * Math.min(1, p.lengthM / 5), 316 / (1 + rise), 280 / reach);
  const py = 40 + L * rise;
  const bx = 300 + L * Math.sin(view.theta), by = py + L * Math.cos(view.theta);
  const measured = view.periods.length ? view.periods.reduce((a, b) => a + b, 0) / view.periods.length : null;
  const exact = pendulumPeriod(p.lengthM, p.amplitudeDeg, g);
  const small = smallAnglePeriod(p.lengthM, g);
  // The graph keeps the last 12 s. LiveGraph always draws from x = 0, so the trace is shifted to start there.
  const traceMin = Math.max(0, view.t - 12);
  // Energy per kg: height energy g L (1 - cos) and movement energy (L omega)^2 / 2.
  const pe = g * p.lengthM * (1 - Math.cos(view.theta));
  const ke = 0.5 * (p.lengthM * view.omega) ** 2;
  const eMax = Math.max(1e-9, g * p.lengthM * (1 - Math.cos((p.amplitudeDeg * Math.PI) / 180)));
  const speed = Math.abs(p.lengthM * view.omega);
  // Tangential velocity arrow (px): perpendicular to the string.
  const vScale = 18;
  const vdx = Math.cos(view.theta) * view.omega * p.lengthM * vScale, vdy = -Math.sin(view.theta) * view.omega * p.lengthM * vScale;
  const firstPeriodIn = Math.max(0, exact * 1.25 - view.t);
  const big = Math.abs(exact - small) / exact > 0.02;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-2">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="relative overflow-hidden rounded-xl bg-[#0a1020] ring-1 ring-inset ring-white/[0.08]">
            <svg viewBox="0 0 600 380" className="block w-full" role="img" aria-label={`Pendulum ${p.lengthM} metres long swinging, now at ${sf((view.theta * 180) / Math.PI, 2)} degrees`}>
              <rect x={220} y={py - 10} width={160} height={10} rx={3} fill="#3b4a6b" />
              <line x1={300} y1={py} x2={300} y2={py + L + 24} stroke="#ffffff14" strokeDasharray="3 5" />
              <path d={`M300 ${py} L${300 + L * Math.sin(a0)} ${py + L * Math.cos(a0)}`} stroke="#ffffff18" strokeDasharray="4 4" />
              <line x1={300} y1={py} x2={bx} y2={by} stroke="#c9d1e4" strokeWidth={2} />
              <circle cx={bx} cy={by} r={16} fill="#ffd43b" stroke="#7a5200" strokeWidth={2} />
              <g pointerEvents="none">
                <Vector x={bx} y={by} dx={vdx} dy={vdy} colour={VX} label="v" />
                <Vector x={bx + 22} y={by} dx={0} dy={Math.min(46, 12 + g * 1.6)} colour={GRAV} label="g" width={2} />
              </g>
            </svg>
            <div className="absolute bottom-2 left-2 w-[118px] rounded-lg bg-black/40 p-1.5" aria-label={`Energy: kinetic ${Math.round((100 * ke) / eMax)} percent, potential ${Math.round((100 * pe) / eMax)} percent of the starting energy`}>
              {[
                { label: "Movement (KE)", v: ke, c: "#7cf3ff" },
                { label: "Height (PE)", v: pe, c: "#ffd43b" },
              ].map((bar) => (
                <div key={bar.label} className="mb-0.5">
                  <div className="text-[9.5px] font-semibold text-white/65">{bar.label}</div>
                  <div className="h-1.5 overflow-hidden rounded bg-white/10">
                    <div className="h-full rounded" style={{ width: `${Math.min(100, (100 * bar.v) / eMax)}%`, background: bar.c }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl bg-[#0a1020] p-2 ring-1 ring-inset ring-white/[0.08]">
            <LiveGraph series={[{ label: "angle", colour: "#ffd43b", points: traceMin > 0 ? view.trace.map((q) => ({ x: q.x - traceMin, y: q.y })) : view.trace }]} xLabel={traceMin > 0 ? "last 12 s" : "time (s)"} yLabel="angle (°)" height={220} yMin={-Math.max(5, p.amplitudeDeg)} ariaLabel="Angle against time" />
            <Hint>Up = swung to the right, down = to the left, the middle = hanging straight down. One full wave (peak to peak) is one period.</Hint>
          </div>
        </div>
        <Narration>
          {swingNarration(view.theta, view.omega, view.peak)} Speed now: {sf(speed, 2)} m/s.
        </Narration>
        <div className="flex gap-2">
          <Btn tone="primary" onClick={() => setRunning((r) => !r)}>
            {running ? <Pause className="mr-1 inline h-4 w-4" /> : <Play className="mr-1 inline h-4 w-4" />}
            {running ? "Pause" : "Swing"}
          </Btn>
          <Btn tone="ghost" onClick={reset}>
            <RotateCcw className="mr-1 inline h-4 w-4" /> Release again
          </Btn>
        </div>
        <GuideCard
          id="motion-pendulum"
          items={[
            { term: "The picture", text: "A weight (the bob) on a string, hanging from a pivot. Pull it to one side, let go, and gravity swings it back and forth." },
            { term: "Arrows", text: <><span style={{ color: VX }}>Blue (v)</span> is the bob's velocity: longest at the bottom, zero at the ends. <span style={{ color: GRAV }}>Yellow (g)</span> is gravity pulling down.</> },
            { term: "Energy bars", text: "Energy keeps swapping between height (potential energy, PE) and movement (kinetic energy, KE). At the ends it is all PE; at the bottom it is all KE. The total stays the same unless there is damping." },
            { term: "The graph", text: "Angle (how far from straight down) on the up-down axis, time on the across axis. The wave shape repeats once per period." },
            { term: "Period", text: "The time for one full swing, there and back. It depends on the length and on gravity, but hardly at all on the weight of the bob." },
          ]}
        />
      </div>
      <div className="min-w-0 space-y-3">
        <Panel title="Pendulum">
          <div className="space-y-3">
            <div className="space-y-1">
              <ParamSlider label="Length" value={p.lengthM} min={0.1} max={5} step={0.1} unit="m" onChange={(v) => set({ lengthM: v })} onCommit={(v) => set({ lengthM: v })} />
              <Hint>Longer string = slower swing. Four times the length doubles the period.</Hint>
            </div>
            <div className="space-y-1">
              <ParamSlider label="Release angle" value={p.amplitudeDeg} min={1} max={170} step={1} unit="°" onChange={(v) => set({ amplitudeDeg: v })} onCommit={(v) => set({ amplitudeDeg: v })} />
              <Hint>How far you pull it back before letting go. Small angles (under 10°) all take the same time; big ones take a bit longer.</Hint>
            </div>
            <div className="space-y-1">
              <ParamSlider label="Damping" value={p.damping} min={0} max={0.5} step={0.01} onChange={(v) => set({ damping: v })} onCommit={(v) => set({ damping: v })} />
              <Hint>{p.damping > 0 ? "Damping is friction and air resistance. Each swing loses some energy, so the swings get smaller and smaller (watch the energy bars shrink)." : "Damping is friction and air resistance. At 0 the pendulum is perfect and swings forever. Turn it up to see the swings die away."}</Hint>
            </div>
            <div className="space-y-1">
              <PlanetPicker value={p.planet} onChange={(planet) => set({ planet })} />
              <Hint>
                {gravityWords(p.planet)} {p.planet === "earth" ? "Weaker gravity pulls the bob back more gently, so on the Moon it swings about 2.5× slower." : `Gravity is what pulls the bob back, so here the period is ${sf(small / smallAnglePeriod(p.lengthM, PLANETS.earth.g), 2)}× the Earth period.`}
              </Hint>
            </div>
          </div>
        </Panel>
        <Panel title="Period">
          <div className="grid grid-cols-3 gap-2">
            <Readout label="Measured" value={measured ? sf(measured) : "…"} unit="s" />
            <Readout label="Exact" value={sf(exact)} unit="s" />
            <Readout label="2π√(L/g)" value={sf(small)} unit="s" tone={big ? "warn" : "default"} />
          </div>
          <div className="mt-2 space-y-1.5 text-xs text-white/60">
            <p>
              <b className="text-white/80">Measured</b> is timed from the swinging bob:{" "}
              {measured ? `the average of its last ${view.periods.length} full swing${view.periods.length > 1 ? "s" : ""}.` : running ? `it needs one full swing, there and back, before it can show a time (about ${sf(firstPeriodIn, 2)} s to go).` : "press Swing: it needs one full swing to time."}
            </p>
            <p>
              <b className="text-white/80">Exact</b> is the true period worked out by computer. <b className="text-white/80">2π√(L/g)</b> is the school formula, which assumes small swings.
            </p>
            <p className={big ? "text-[#fcd27b]" : ""}>{big ? `At ${p.amplitudeDeg}° the formula is ${sf((100 * (exact - small)) / exact, 2)}% too short: a big swing travels further and moves slowly near the top for longer, so it takes more time. Keep the angle under 10° and the formula works.` : "At this angle the formula is within 2% of the truth, because the swing is small."}</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
