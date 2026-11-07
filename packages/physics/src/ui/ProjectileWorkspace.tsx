import { useReducedMotion } from "framer-motion";
import { Rocket, Ruler, Wind } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PLANETS, simulateFlight, type Planet } from "../core/mechanics";
import type { ProjectileSetup, ProjectileState } from "../labs/mechanics";
import { Btn, LiveGraph, Panel, ParamSlider, ReadingInput, Readout, sf, Vector } from "./kit";
import type { SimSession } from "./useSimSession";

const COLOURS = ["#7cf3ff", "#ffd43b", "#ff8787", "#b197fc", "#69db7c", "#ffa94d"];

/**
 * Projectile range: launcher, trajectory with fading trail dots every 0.1 s, velocity and
 * acceleration vectors, apex label, landing mark and a tape that unrolls to the range.
 */
export function ProjectileWorkspace({ session }: { session: SimSession<ProjectileState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as ProjectileSetup;
  const reduced = useReducedMotion();
  const ro = session.readOnly;
  const launches = s.launches;
  const last = launches[launches.length - 1];
  const g = PLANETS[s.planet].g;

  // the flight being animated: replays whenever a new launch appears
  const flight = useMemo(() => (last ? simulateFlight({ speed: last.speed, angleDeg: last.angle, g: PLANETS[last.planet].g, drag: last.drag }) : null), [last]);
  const [tt, setTt] = useState(0);
  const [tape, setTape] = useState(false);
  useEffect(() => {
    if (!flight) return;
    setTape(false);
    if (reduced) {
      setTt(flight.time);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(flight.time, ((now - start) / 1000) * Math.max(1, flight.time / 2.5));
      setTt(t);
      if (t < flight.time) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flight, reduced]);

  // world -> screen: fit the furthest landing (and the target) with headroom
  const maxX = Math.max(setup.targetM * 1.25, ...launches.map((l) => l.range), 10);
  const maxY = Math.max(maxX * 0.45, ...launches.map((l) => l.maxHeight * 1.15));
  const W = 820;
  const H = 400;
  const L = 50;
  const ground = H - 40;
  const k = Math.min((W - L - 30) / maxX, (ground - 30) / maxY);
  const X = (x: number) => L + x * k;
  const Y = (y: number) => ground - y * k;

  const at = flight?.points.reduce((best, p) => (p.t <= tt ? p : best), flight.points[0]!);
  const landed = !!flight && tt >= flight.time - 1e-6;
  const pathOf = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? "L" : "M"} ${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(" ");
  const ghosts = useMemo(() => launches.slice(0, -1).map((l) => simulateFlight({ speed: l.speed, angleDeg: l.angle, g: PLANETS[l.planet].g, drag: l.drag })), [launches]);
  const apex = flight?.points.reduce((a, p) => (p.y > a.y ? p : a), flight.points[0]!);
  const graphPts = flight ? flight.points.filter((p) => p.t <= tt) : [];

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="relative min-h-[300px] flex-1 overflow-hidden rounded-xl bg-[linear-gradient(180deg,#0f2147,#1a3466_70%,#24406e)] ring-1 ring-inset ring-white/10">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label={last ? `Last launch: ${sf(last.range)} m range, ${sf(last.maxHeight)} m high, ${sf(last.time)} s` : "Launch area"}>
            <rect x={0} y={ground} width={W} height={H - ground} fill={s.planet === "moon" ? "#5c5f66" : s.planet === "mars" ? "#7a3b22" : s.planet === "jupiter" ? "#7a5a3a" : "#2b5b2e"} />
            {/* distance marks every 5 or 10 m */}
            {Array.from({ length: Math.floor(maxX / (maxX > 60 ? 10 : 5)) + 1 }, (_, i) => i * (maxX > 60 ? 10 : 5)).map((m) => (
              <g key={m}>
                <line x1={X(m)} y1={ground} x2={X(m)} y2={ground + 6} stroke="rgba(255,255,255,.5)" />
                <text x={X(m)} y={ground + 18} fontSize={10} fill="rgba(255,255,255,.55)" textAnchor="middle">
                  {m}
                </text>
              </g>
            ))}
            {/* target */}
            <g>
              <rect x={X(setup.targetM - setup.targetTolM)} y={ground - 4} width={setup.targetTolM * 2 * k} height={8} fill="#ff6b6b" opacity={0.85} />
              <line x1={X(setup.targetM)} y1={ground - 30} x2={X(setup.targetM)} y2={ground} stroke="#ff6b6b" strokeWidth={2} />
              <text x={X(setup.targetM)} y={ground - 34} fontSize={11} fill="#ffa8a8" textAnchor="middle" fontWeight={700}>
                target {setup.targetM} m
              </text>
            </g>
            {/* ghosts of earlier runs at 40 % */}
            {ghosts.map((gh, i) => (
              <path key={i} d={pathOf(gh.points)} stroke={COLOURS[i % COLOURS.length]} strokeOpacity={0.4} strokeWidth={1.5} fill="none" strokeDasharray={launches[i]!.drag ? "5 4" : undefined} />
            ))}
            {/* current flight: trail dots every 0.1 s */}
            {flight &&
              flight.points
                .filter((p) => p.t <= tt)
                .filter((_, i, arr) => i === arr.length - 1 || Math.floor(arr[i]!.t * 10) !== Math.floor((arr[i + 1]?.t ?? 0) * 10))
                .map((p, i, arr) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={2.2} fill="#fff" opacity={0.25 + (0.75 * (i + 1)) / arr.length} />)}
            {flight && apex && tt >= apex.t && (
              <g>
                <line x1={X(apex.x)} y1={Y(apex.y)} x2={X(apex.x)} y2={ground} stroke="rgba(255,255,255,.25)" strokeDasharray="3 4" />
                <text x={X(apex.x)} y={Y(apex.y) - 12} fontSize={11} fill="#ffe066" textAnchor="middle" fontWeight={700}>
                  max height {sf(apex.y)} m
                </text>
              </g>
            )}
            {at && !landed && (
              <g>
                <circle cx={X(at.x)} cy={Y(at.y)} r={7} fill="#ffe066" stroke="#fff" />
                <Vector x={X(at.x)} y={Y(at.y)} dx={at.vx * 2.2} dy={-at.vy * 2.2} colour="#7cf3ff" label="v" />
                <Vector x={X(at.x)} y={Y(at.y)} dx={0} dy={Math.min(60, g * 2.5)} colour="#ff8787" label="g" />
              </g>
            )}
            {landed && last && (
              <g>
                <ellipse cx={X(last.range)} cy={ground} rx={10} ry={3} fill="#e9ecef" opacity={0.8} />
                {tape && (
                  <g>
                    <line x1={X(0)} y1={ground + 26} x2={X(last.range)} y2={ground + 26} stroke="#ffd43b" strokeWidth={6} />
                    <text x={X(last.range / 2)} y={ground + 30} fontSize={11} fontWeight={800} textAnchor="middle" fill="#1f2937">
                      {last.range.toFixed(2)} m
                    </text>
                  </g>
                )}
              </g>
            )}
            {/* launcher */}
            <g transform={`translate(${X(0)} ${ground}) rotate(${-s.angle})`}>
              <rect x={-6} y={-7} width={40} height={14} rx={4} fill="#adb5bd" stroke="#495057" />
            </g>
            <circle cx={X(0)} cy={ground} r={10} fill="#495057" />
          </svg>
          <div className="absolute right-3 top-3 rounded-lg bg-black/30 px-2.5 py-1 text-xs text-white/70">
            {PLANETS[s.planet].label} · g = {g} m/s²{s.drag ? " · air resistance on" : ""}
          </div>
        </div>
        <Panel title="Live graphs">
          <LiveGraph
            series={[
              { label: "height y (m)", colour: "#ffd43b", points: graphPts.map((p) => ({ x: p.t, y: p.y })) },
              { label: "vertical velocity vy (m/s)", colour: "#7cf3ff", points: graphPts.map((p) => ({ x: p.t, y: p.vy })) },
            ]}
            xLabel="t / s"
            yLabel="y, vy"
            height={130}
            yMin={Math.min(0, ...graphPts.map((p) => p.vy))}
          />
        </Panel>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Launch">
          <div className="space-y-3">
            <ParamSlider label="Launch speed" value={s.speed} min={5} max={30} step={0.5} unit="m/s" onCommit={(v) => session.dispatch("param.set", { key: "speed", value: v })} disabled={ro} />
            <ParamSlider label="Angle" value={s.angle} min={5} max={85} step={0.1} unit="°" onCommit={(v) => session.dispatch("param.set", { key: "angle", value: v })} disabled={ro} />
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Planet">
              {(Object.keys(PLANETS) as Planet[]).map((p) => (
                <button key={p} role="radio" aria-checked={s.planet === p} disabled={ro} onClick={() => session.dispatch("param.set", { key: "planet", value: p })} className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${s.planet === p ? "bg-accent text-white ring-accent" : "text-white/60 ring-white/15"}`}>
                  {PLANETS[p].label}
                </button>
              ))}
            </div>
            <Btn onClick={() => session.dispatch("param.set", { key: "drag", value: !s.drag })} disabled={ro} pressed={s.drag} className="w-full">
              <Wind className="h-4 w-4" /> Air resistance: {s.drag ? "on" : "off"}
            </Btn>
            <Btn tone="primary" onClick={() => session.dispatch("sim.start", {} as Record<string, never>)} disabled={ro} className="w-full">
              <Rocket className="h-4 w-4" /> Launch
            </Btn>
          </div>
        </Panel>
        <Panel title="Measure">
          <Btn onClick={() => setTape(true)} disabled={!landed} className="mb-2 w-full">
            <Ruler className="h-4 w-4" /> Unroll the tape
          </Btn>
          <ReadingInput label="Range from the tape" unit="m" onRecord={(v) => session.dispatch("measure.read", { instrument: "tape", reading: { key: "range", value: v, unit: "m" } })} disabled={ro || !landed} />
        </Panel>
        <Panel title="Launches">
          {launches.length === 0 ? (
            <p className="text-xs text-white/50">No launches yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-white/45">
                <tr>
                  <th className="text-left">#</th>
                  <th className="text-right">v</th>
                  <th className="text-right">θ</th>
                  <th className="text-right">range</th>
                  <th className="text-right">height</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {launches.map((l, i) => (
                  <tr key={i} style={{ color: i === launches.length - 1 ? "#fff" : COLOURS[i % COLOURS.length] }}>
                    <td>
                      {i + 1}
                      {l.drag ? "ᵃ" : ""}
                      {l.planet !== "earth" ? ` ${PLANETS[l.planet].label[0]}` : ""}
                    </td>
                    <td className="text-right">{l.speed}</td>
                    <td className="text-right">{l.angle}°</td>
                    <td className="text-right">{landedOrDash(l, i === launches.length - 1 && !landed)}</td>
                    <td className="text-right">{sf(l.maxHeight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <Readout label="Range" value={landed && last ? sf(last.range, 4) : "–"} unit="m" />
            <Readout label="Height" value={last ? sf(last.maxHeight) : "–"} unit="m" />
            <Readout label="Time" value={last ? sf(last.time) : "–"} unit="s" />
          </div>
        </Panel>
      </div>
    </div>
  );
}

const landedOrDash = (l: { range: number }, flying: boolean) => (flying ? "…" : sf(l.range, 4));

