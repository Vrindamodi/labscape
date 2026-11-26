import { useReducedMotion } from "framer-motion";
import { Play, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { PLANETS } from "../../core/mechanics";
import { rad } from "../../core/runtime";
import { GuideCard, Hint, Narration } from "../../ui/explain";
import { Btn, Panel, ParamSlider, Readout, sf, Vector } from "../../ui/kit";
import { RAMP_LENGTH_M, rampForces, rampNarration, rampSlide, rampThresholdDeg, type RampParams } from "../motionScenes";
import { GRAV, gravityWords, PlanetPicker, VX, VY } from "./shared";

const NORMAL = "#51cf66", FRICTION = "#ff922b", SPEED = "#ffffff";
/** Picture layout (SVG units): the ramp's foot, and the block drawn on it. */
const FOOT = { x: 650, y: 340 }, BLOCK_W = 56, BLOCK_H = 34;

/**
 * A block on a ramp: the weight splits into a pull along the slope and a push into it, and friction
 * decides whether the block holds or slides. Once it slides, the mass cancels out of the acceleration.
 */
export function RampLab({ p, set }: { p: RampParams; set: (p: Partial<RampParams>) => void }) {
  const reduced = useReducedMotion();
  const g = PLANETS[p.planet].g;
  const f = rampForces(p.massKg, p.angleDeg, p.mu, g);
  const tBottom = f.slides ? Math.sqrt((2 * RAMP_LENGTH_M) / f.accel) : 0;
  const [run, setRun] = useState<{ id: number; done: boolean } | null>(null);
  const [t, setT] = useState(0);
  const reset = () => {
    setRun(null);
    setT(0);
  };
  // Back to the top whenever the set-up changes.
  useEffect(reset, [p.angleDeg, p.mu, p.massKg, p.planet]);
  // A slow slide (only just steeper than friction can hold) is fast-forwarded so it takes about 6 s.
  const rate = Math.max(1, tBottom / 6);
  const release = () => {
    const jump = !f.slides || !!reduced;
    setT(jump ? tBottom : 0);
    setRun((r) => ({ id: (r?.id ?? 0) + 1, done: jump }));
  };
  const running = !!run && !run.done;
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let sim = 0;
    const tick = (now: number) => {
      sim += Math.min(0.05, (now - last) / 1000) * rate;
      last = now;
      if (sim >= tBottom) {
        setT(tBottom);
        return setRun((r) => r && { ...r, done: true });
      }
      setT(sim);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, run?.id, tBottom, rate]);

  const now = rampSlide(f.accel, t);
  const stage = !run ? "held" : !f.slides ? "stuck" : now.done ? "bottom" : "sliding";

  // Geometry. The slope is always 5 m long; steep ramps are drawn smaller so the top stays in view.
  const th = rad(p.angleDeg);
  const slopePx = Math.min(560, 230 / Math.max(Math.sin(th), 1e-6));
  const down = { x: Math.cos(th), y: Math.sin(th) }; // unit vector down the slope (screen y points down)
  const out = { x: Math.sin(th), y: -Math.cos(th) }; // unit vector straight out of the surface
  const top = { x: FOOT.x - slopePx * down.x, y: FOOT.y - slopePx * down.y };
  const along = BLOCK_W / 2 + (now.s / RAMP_LENGTH_M) * (slopePx - BLOCK_W);
  const base = { x: top.x + down.x * along, y: top.y + down.y * along };
  const c = { x: base.x + (out.x * BLOCK_H) / 2, y: base.y + (out.y * BLOCK_H) / 2 };
  // One scale for every force arrow, so they can be compared; a heavier block draws a longer weight arrow.
  const weightPx = 60 + 50 * Math.min(1, Math.log10(1 + f.weight) / Math.log10(250));
  const k = weightPx / f.weight;
  const tipAlong = { x: c.x + down.x * f.along * k, y: c.y + down.y * f.along * k };
  const tipInto = { x: c.x - out.x * f.into * k, y: c.y - out.y * f.into * k };
  const forces = [
    { key: "W", colour: GRAV, name: "Weight", how: "mass × g, straight down", value: f.weight },
    { key: "W∥", colour: VX, name: "Part of the weight along the slope", how: "weight × sin θ", value: f.along },
    { key: "W⊥", colour: VY, name: "Part of the weight into the slope", how: "weight × cos θ", value: f.into },
    { key: "N", colour: NORMAL, name: "Normal force", how: "the surface pushing back", value: f.normal },
    { key: "f", colour: FRICTION, name: "Friction", how: f.slides ? "μ × normal force, its most" : `matches the pull; could reach ${sf(f.maxFriction)} N`, value: f.friction },
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-2">
        <div className="overflow-hidden rounded-xl bg-gradient-to-b from-[#0b1734] to-[#0a1020] ring-1 ring-inset ring-white/[0.08]">
          <svg viewBox="0 0 720 460" className="block w-full" role="img" aria-label={`A ${p.massKg} kilogram block on a ramp tilted at ${p.angleDeg} degrees. ${f.slides ? `It slides, speeding up by ${sf(f.accel)} metres per second every second.` : "Friction holds it still."}`}>
            <line x1={0} y1={FOOT.y} x2={720} y2={FOOT.y} stroke="#3b4a6b" strokeWidth={2} />
            <polygon points={`${top.x},${top.y} ${FOOT.x},${FOOT.y} ${top.x},${FOOT.y}`} fill="#26324f" stroke="#3b4a6b" strokeWidth={2} strokeLinejoin="round" />
            {p.angleDeg > 0 && (
              <g>
                <path d={`M${FOOT.x - 46} ${FOOT.y} A46 46 0 0 1 ${FOOT.x - 46 * down.x} ${FOOT.y - 46 * down.y}`} fill="none" stroke="#ffffff70" />
                <text x={FOOT.x + 8} y={FOOT.y - 7} fontSize={12} className="fill-white/70">
                  {p.angleDeg}°
                </text>
              </g>
            )}
            <text x={708} y={22} textAnchor="end" fontSize={12} className="fill-white/55">
              {p.mu > 0 ? `friction can hold it up to ${sf(rampThresholdDeg(p.mu))}°` : "no friction: it slides at any tilt"}
            </text>
            <text x={708} y={40} textAnchor="end" fontSize={12} fontWeight={700} fill={f.slides ? FRICTION : NORMAL}>
              {f.slides ? "too steep to hold: it slides" : "friction holds it"}
            </text>
            {running && rate > 1.05 && (
              <text x={708} y={58} textAnchor="end" fontSize={11} className="fill-white/55">
                fast-forward ×{sf(rate, 2)}
              </text>
            )}
            <rect x={-BLOCK_W / 2} y={-BLOCK_H} width={BLOCK_W} height={BLOCK_H} rx={5} fill="#8aa0c8" stroke="#0b1020" strokeWidth={1.5} transform={`translate(${base.x} ${base.y}) rotate(${p.angleDeg})`} />
            <g pointerEvents="none">
              {/* the weight and the box that splits it into its two parts */}
              <path d={`M${tipAlong.x} ${tipAlong.y} L${c.x} ${c.y + weightPx} L${tipInto.x} ${tipInto.y}`} fill="none" stroke="#ffffff30" strokeDasharray="3 4" />
              <Vector x={c.x} y={c.y} dx={0} dy={weightPx} colour={GRAV} label="W" />
              <Vector x={c.x} y={c.y} dx={tipAlong.x - c.x} dy={tipAlong.y - c.y} colour={VX} label="W∥" width={2} />
              <Vector x={c.x} y={c.y} dx={tipInto.x - c.x} dy={tipInto.y - c.y} colour={VY} label="W⊥" width={2} />
              <Vector x={c.x} y={c.y} dx={out.x * f.normal * k} dy={out.y * f.normal * k} colour={NORMAL} label="N" />
              <Vector x={base.x} y={base.y} dx={-down.x * f.friction * k} dy={-down.y * f.friction * k} colour={FRICTION} label="f" />
              <Vector x={c.x + out.x * 28 + down.x * 28} y={c.y + out.y * 28 + down.y * 28} dx={down.x * now.v * 7} dy={down.y * now.v * 7} colour={SPEED} label="v" width={2} />
            </g>
          </svg>
        </div>
        <Narration tone={stage === "bottom" ? "good" : stage === "stuck" ? "warn" : "info"}>{rampNarration(stage, p, g, now)}</Narration>
        <div className="flex flex-wrap items-center gap-2">
          <Btn tone="primary" onClick={release}>
            <Play className="mr-1 inline h-4 w-4" /> {run ? "Release again" : "Release"}
          </Btn>
          <Btn tone="ghost" onClick={reset} disabled={!run}>
            <RotateCcw className="mr-1 inline h-4 w-4" /> Reset
          </Btn>
          {reduced && <span className="text-xs text-white/50">Reduced motion is on, so Release jumps straight to the bottom.</span>}
        </div>
        <ul className="grid gap-x-4 gap-y-1 text-xs text-white/70 sm:grid-cols-2" aria-label="Forces on the block">
          {forces.map((x) => (
            <li key={x.key} className="flex items-baseline gap-1.5">
              <span className="w-7 shrink-0 font-bold" style={{ color: x.colour }}>
                {x.key}
              </span>
              <span className="min-w-0">
                {x.name}: <b className="font-mono text-white">{sf(x.value)} N</b> <span className="text-white/45">({x.how})</span>
              </span>
            </li>
          ))}
        </ul>
        <GuideCard
          id="motion-ramp"
          items={[
            { term: "The picture", text: "A side view of a block at the top of a ramp 5 m long. Every arrow is a force on the block, drawn to the same scale, so a longer arrow is a bigger force. The list under the picture gives each one in newtons." },
            { term: "Weight, split in two", text: <><span style={{ color: GRAV }}>W</span> is the weight, straight down. It helps to split it into two parts: <span style={{ color: VX }}>W∥</span> pulls the block along the slope, and <span style={{ color: VY }}>W⊥</span> presses it into the surface. Tilt the ramp and watch the weight move from one part to the other.</> },
            { term: "The surface pushes back", text: <><span style={{ color: NORMAL }}>N</span>, the normal force, is the ramp pushing straight out against W⊥: they always match. <span style={{ color: FRICTION }}>f</span> is friction, along the slope, against the slide. Friction only pushes as hard as it needs to, up to a limit of μ × N.</> },
            { term: "Hold or slide?", text: "If W∥ is less than friction's limit, friction matches it and the block stays. Past that it slides. The tipping point is when tan θ = μ, and mass is not in that rule either." },
            { term: "Why mass does not matter", text: "Double the mass and every arrow doubles: the pull along the slope and the friction too, so the force left over doubles. But a block twice as heavy needs twice the force to speed up just as fast. The two cancel: a = g × (sin θ − μ × cos θ), with no mass in it." },
            { term: "Try this", text: "Set friction to 0.5 and raise the angle one degree at a time: it lets go just past 26.6°. Then time a slide, change the mass, and time it again." },
          ]}
        />
      </div>
      <div className="min-w-0 space-y-3">
        <Panel title="Ramp">
          <div className="space-y-3">
            <div className="space-y-1">
              <ParamSlider label="Angle θ" value={p.angleDeg} min={0} max={60} step={1} unit="°" onChange={(v) => set({ angleDeg: v })} onCommit={(v) => set({ angleDeg: v })} />
              <Hint>Steeper = more of the weight pulls along the slope and less of it presses into the surface.</Hint>
            </div>
            <div className="space-y-1">
              <ParamSlider label="Friction μ" value={p.mu} min={0} max={1} step={0.01} onChange={(v) => set({ mu: v })} onCommit={(v) => set({ mu: v })} />
              <Hint>{p.mu <= 0 ? "0 is perfectly slippery, like wet ice: nothing holds the block back." : `How grippy the surface is. Friction can be at most μ × the normal force: here ${sf(f.maxFriction)} N. Ice is about 0.05, wood on wood about 0.4, rubber close to 1.`}</Hint>
            </div>
            <div className="space-y-1">
              <ParamSlider label="Mass" value={p.massKg} min={0.5} max={10} step={0.5} unit="kg" onChange={(v) => set({ massKg: v })} onCommit={(v) => set({ massKg: v })} />
              <Hint>A heavier block makes every force bigger by the same factor, so neither the angle where it slips nor its acceleration changes. Watch the arrows grow together.</Hint>
            </div>
            <div className="space-y-1">
              <PlanetPicker value={p.planet} onChange={(planet) => set({ planet })} />
              <Hint>{gravityWords(p.planet)} Stronger gravity pulls harder down the slope but also presses the block harder onto it, so the angle where it slips is the same on every planet. Once it slides, though, it speeds up faster where gravity is stronger.</Hint>
            </div>
          </div>
        </Panel>
        <Panel title="Slide">
          <div className="grid grid-cols-3 gap-2">
            <Readout label="Acceleration" value={sf(f.accel)} unit="m/s²" tone={f.slides ? "default" : "warn"} />
            <Readout label="Speed" value={sf(now.v)} unit="m/s" />
            <Readout label="Time" value={sf(now.t)} unit="s" />
          </div>
          <div className="mt-2 space-y-1.5 text-xs text-white/60">
            <p>
              <b className="text-white/80">Acceleration</b> = g × (sin θ − μ × cos θ) = {sf(g)} × ({sf(Math.sin(th))} − {p.mu} × {sf(Math.cos(th))}){f.slides ? ` = ${sf(f.accel)} m/s².` : ", which is not above 0, so friction holds it: 0 m/s²."} There is no mass in it.
            </p>
            <p>{f.slides ? `From rest it will cover the ${RAMP_LENGTH_M} m slope in ${sf(tBottom)} s and reach the bottom at ${sf(f.accel * tBottom)} m/s.` : `It will not move until tan θ is bigger than μ: tan ${p.angleDeg}° = ${sf(Math.tan(th))}, and μ = ${p.mu}.`}</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
