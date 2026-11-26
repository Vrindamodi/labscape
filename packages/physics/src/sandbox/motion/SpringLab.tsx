import { useReducedMotion } from "framer-motion";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PLANETS } from "../../core/mechanics";
import { GuideCard, Hint, Narration } from "../../ui/explain";
import { clampN, snapTo, useSvgDrag } from "../../ui/interact";
import { Btn, LiveGraph, Panel, ParamSlider, Readout, sf, Vector } from "../../ui/kit";
import { lengthWords, SPRING_MAX_PULL_M, springDampedPeriod, springEnergy, springNarration, springPeriod, springRestStretch, springStep, type SpringParams } from "../motionScenes";
import { EnergyMini, GRAV, gravityWords, PlanetPicker, VX } from "./shared";

const SPRING_PULL = "#51cf66";
/** Picture layout (SVG units): the spring hangs from TOP on the centre line, and nothing goes below FLOOR. */
const CX = 300, TOP = 40, FLOOR = 372, BLOCK_W = 72, BLOCK_H = 40;
/** Length of the spring with nothing hanging on it (m). */
const NATURAL_M = 0.4;
/** Seconds of history the graph keeps. */
const WINDOW_S = 10;

type Sim = { y: [number, number]; t: number; lastCross: number | null; trace: { x: number; y: number }[]; periods: number[] };
const fresh = (pull: number): Sim => ({ y: [pull, 0], t: 0, lastCross: null, trace: [], periods: [] });
const viewOf = (s: Sim) => ({ y: s.y[0], v: s.y[1], t: s.t, trace: s.trace, periods: s.periods });

/** A zigzag from y0 down to y1 that stretches and squashes with the spring. */
function coil(y0: number, y1: number): string {
  const lead = Math.min(8, (y1 - y0) / 4), turns = 16, span = y1 - y0 - 2 * lead;
  let d = `M${CX} ${y0} L${CX} ${(y0 + lead).toFixed(1)}`;
  for (let i = 0; i < turns; i++) d += ` L${CX + (i % 2 ? 13 : -13)} ${(y0 + lead + ((i + 0.5) * span) / turns).toFixed(1)}`;
  return `${d} L${CX} ${(y1 - lead).toFixed(1)} L${CX} ${y1.toFixed(1)}`;
}

/**
 * A mass bouncing on a spring. Pull it down (drag the mass, or use the slider) and let go: the
 * period depends on the mass and the spring, not on how far you pulled or which planet you are on.
 */
export function SpringLab({ p, set }: { p: SpringParams; set: (p: Partial<SpringParams>) => void }) {
  const reduced = useReducedMotion();
  const g = PLANETS[p.planet].g;
  const [running, setRunning] = useState(!reduced);
  const [dragging, setDragging] = useState(false);
  const st = useRef<Sim>(fresh(p.amplitudeM));
  const [view, setView] = useState(() => viewOf(st.current));
  const restart = (pull = p.amplitudeM) => {
    st.current = fresh(pull);
    setView(viewOf(st.current));
  };
  // Let go again from the chosen pull whenever the set-up changes.
  useEffect(restart, [p.massKg, p.k, p.amplitudeM, p.planet]);
  useEffect(() => {
    if (!running || dragging) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = st.current;
      const sub = 4, h = dt / sub;
      for (let i = 0; i < sub; i++) {
        const prev = s.y;
        s.y = springStep(s.y, p.massKg, p.k, p.damping, h);
        // Upward passes through the rest position (one per bounce), timed to within the step.
        if (prev[0] > 0 && s.y[0] <= 0) {
          const cross = s.t + (h * prev[0]) / (prev[0] - s.y[0]);
          if (s.lastCross !== null) s.periods = [...s.periods.slice(-4), cross - s.lastCross];
          s.lastCross = cross;
        }
        s.t += h;
      }
      // The graph shows height above the rest position, so up on the graph is up in the picture.
      s.trace = [...s.trace.filter((q) => q.x > s.t - WINDOW_S), { x: s.t, y: -s.y[0] * 100 }];
      setView(viewOf(s));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, dragging, p.massKg, p.k, p.damping]);

  // Zoom so the natural length, the stretch from the weight and the biggest pull all fit.
  const stretch = springRestStretch(p.massKg, p.k, g);
  const scale = Math.min(300, (FLOOR - TOP - BLOCK_H - 8) / (NATURAL_M + stretch + SPRING_MAX_PULL_M));
  const naturalY = TOP + NATURAL_M * scale;
  const restY = naturalY + stretch * scale;
  const blockY = restY + view.y * scale;
  const midY = blockY + BLOCK_H / 2;
  const tickM = [0.05, 0.1, 0.2, 0.5, 1, 2, 5].find((s) => s * scale >= 30) ?? 5;

  // Drag the mass to choose the pull; letting go releases it.
  const grab = useRef(0);
  const down = useSvgDrag({
    onStart: (pt) => {
      grab.current = pt.y - blockY;
      setDragging(true);
    },
    onMove: (pt) => {
      st.current = fresh(clampN((pt.y - grab.current - restY) / scale, 0, SPRING_MAX_PULL_M));
      setView(viewOf(st.current));
    },
    onEnd: (_pt, moved) => {
      setDragging(false);
      if (!moved) return;
      const pull = Math.max(0.01, snapTo(st.current.y[0], 0.01));
      set({ amplitudeM: pull });
      restart(pull);
      setRunning(true);
    },
  });

  const pull = dragging ? view.y : p.amplitudeM;
  const pullCm = Math.max(1, pull * 100);
  const energy = springEnergy(p.massKg, p.k, view.y, view.v);
  const eMax = Math.max(1e-9, 0.5 * p.k * pull * pull);
  const measured = view.periods.length ? view.periods.reduce((a, b) => a + b, 0) / view.periods.length : null;
  const formula = springPeriod(p.massKg, p.k);
  const damped = springDampedPeriod(p.massKg, p.k, p.damping);
  const t0 = Math.max(0, view.t - WINDOW_S);
  // Force arrows share one scale: the weight is always 34 px, and the spring's pull equals it at rest.
  const springPx = clampN((34 * (stretch + view.y)) / stretch, -110, 110);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-2">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="relative overflow-hidden rounded-xl bg-[#0a1020] ring-1 ring-inset ring-white/[0.08]">
            <svg viewBox="0 0 600 380" className="block w-full" role="img" aria-label={`A ${p.massKg} kilogram mass on a spring, now ${lengthWords(Math.abs(view.y))} ${view.y >= 0 ? "below" : "above"} its rest position`}>
              <rect x={CX - 80} y={TOP - 10} width={160} height={10} rx={3} fill="#3b4a6b" />
              {/* ruler: distance below the support */}
              <line x1={120} y1={TOP} x2={120} y2={FLOOR} stroke="#ffffff30" />
              {Array.from({ length: Math.floor((FLOOR - TOP) / (tickM * scale)) + 1 }, (_, i) => i * tickM).map((m) => (
                <g key={m}>
                  <line x1={112} x2={120} y1={TOP + m * scale} y2={TOP + m * scale} stroke="#ffffff40" />
                  <text x={106} y={TOP + m * scale + 4} textAnchor="end" fontSize={11} className="fill-white/40">
                    {lengthWords(m)}
                  </text>
                </g>
              ))}
              <line x1={CX - 70} x2={CX + 150} y1={naturalY} y2={naturalY} stroke="#ffffff22" strokeDasharray="3 5" />
              <text x={CX + 154} y={naturalY - 5} fontSize={11} className="fill-white/40">
                end of the bare spring
              </text>
              <line x1={CX - 70} x2={CX + 150} y1={restY} y2={restY} stroke="#ffd43b66" strokeDasharray="5 5" />
              <text x={CX + 154} y={restY + 14} fontSize={11} fill="#ffd43b" fillOpacity={0.8}>
                rest position
              </text>
              <path d={coil(TOP, blockY)} fill="none" stroke="#c9d1e4" strokeWidth={2} strokeLinejoin="round" />
              <g pointerEvents="none">
                <Vector x={CX - 58} y={midY} dx={0} dy={clampN(view.v * 45, -90, 90)} colour={VX} label="v" />
                <Vector x={CX + 58} y={midY} dx={0} dy={-springPx} colour={SPRING_PULL} label="spring" width={2} />
                <Vector x={CX + 58} y={midY} dx={0} dy={34} colour={GRAV} label="weight" width={2} />
              </g>
              <g onPointerDown={down} style={{ touchAction: "none", cursor: dragging ? "grabbing" : "grab" }}>
                <rect x={CX - 70} y={blockY - 16} width={140} height={BLOCK_H + 32} fill="transparent" />
                <rect x={CX - BLOCK_W / 2} y={blockY} width={BLOCK_W} height={BLOCK_H} rx={6} fill="#ffd43b" stroke={dragging ? "#fff" : "#7a5200"} strokeWidth={2} />
                <text x={CX} y={midY + 5} textAnchor="middle" fontSize={14} fontWeight={800} fill="#3d2a00">
                  {p.massKg} kg
                </text>
              </g>
            </svg>
            <EnergyMini
              max={eMax}
              bars={[
                { label: "Movement (KE)", value: energy.ke, colour: "#7cf3ff" },
                { label: "Stored (PE)", value: energy.pe, colour: "#ffd43b" },
              ]}
            />
          </div>
          <div className="rounded-xl bg-[#0a1020] p-2 ring-1 ring-inset ring-white/[0.08]">
            <LiveGraph
              series={[
                { label: "height above rest", colour: "#ffd43b", points: t0 > 0 ? view.trace.map((q) => ({ x: q.x - t0, y: q.y })) : view.trace },
                { label: "your pull", colour: "#ffffff55", points: [{ x: 0, y: pullCm }, { x: WINDOW_S, y: pullCm }] },
              ]}
              xLabel={t0 > 0 ? `last ${WINDOW_S} s` : "time (s)"}
              yLabel="height (cm)"
              height={220}
              xMin={WINDOW_S}
              yMin={-pullCm}
              ariaLabel="Height above the rest position against time"
            />
            <Hint>Up = above the rest position, down = below it. It starts at the bottom because you pulled it down. One full wave is one period; with damping the waves stop reaching the pale line.</Hint>
          </div>
        </div>
        {scale < 150 && <Hint>This spring is so soft that the weight alone stretches it {lengthWords(stretch)}, so the picture has zoomed out to fit and the bounce looks small.</Hint>}
        <Narration>
          {springNarration(view.y, view.v, p, dragging)}
          {!dragging && ` Speed now: ${sf(Math.abs(view.v), 2)} m/s.`}
        </Narration>
        <div className="flex flex-wrap items-center gap-2">
          <Btn tone="primary" onClick={() => setRunning((r) => !r)}>
            {running ? <Pause className="mr-1 inline h-4 w-4" /> : <Play className="mr-1 inline h-4 w-4" />}
            {running ? "Pause" : "Bounce"}
          </Btn>
          <Btn tone="ghost" onClick={() => restart()}>
            <RotateCcw className="mr-1 inline h-4 w-4" /> Release again
          </Btn>
          {reduced && !running && <span className="text-xs text-white/50">Reduced motion is on: press Bounce when you want to watch it move.</span>}
        </div>
        <GuideCard
          id="motion-spring"
          items={[
            { term: "The picture", text: "A mass hanging from a spring. Left alone it sits at the yellow dashed line, its rest position, where the spring's upward pull exactly balances its weight. Drag the mass down and let go." },
            { term: "Arrows", text: <><span style={{ color: SPRING_PULL }}>Green</span> is the spring pulling up: the more it is stretched, the harder it pulls. <span style={{ color: GRAV }}>Yellow</span> is the weight, which never changes. Below the rest position green wins, above it yellow wins, so the mass is always pushed back towards the middle. <span style={{ color: VX }}>Blue (v)</span> is its velocity.</> },
            { term: "Energy bars", text: "Energy swaps between movement (kinetic energy, KE) and stored energy (potential energy, PE: the spring's stretch and the height, counted together). At the top and bottom it is all stored; passing the rest position it is all movement." },
            { term: "The graph", text: "Height above the rest position on the up-down axis, time along the bottom. The wave repeats once per period." },
            { term: "Period", text: "The time for one full bounce, down and back up. A heavier mass makes it longer, a stiffer spring makes it shorter. How far you pull, and which planet you are on, make no difference." },
            { term: "Try this", text: "Time a bounce with a small pull, then with a big one: same period. Then jump to the Moon: the mass hangs higher, but the period still has not changed." },
          ]}
        />
      </div>
      <div className="min-w-0 space-y-3">
        <Panel title="Spring">
          <div className="space-y-3">
            <div className="space-y-1">
              <ParamSlider label="Mass" value={p.massKg} min={0.1} max={2} step={0.1} unit="kg" onChange={(v) => set({ massKg: v })} onCommit={(v) => set({ massKg: v })} />
              <Hint>A heavier mass is harder to speed up and turn round, so it bounces more slowly. Four times the mass doubles the period.</Hint>
            </div>
            <div className="space-y-1">
              <ParamSlider label="Spring constant k" value={p.k} min={5} max={100} step={1} unit="N/m" onChange={(v) => set({ k: v })} onCommit={(v) => set({ k: v })} />
              <Hint>How stiff the spring is: the newtons needed to stretch it by one metre. A stiffer spring pulls back harder, so the bounce is quicker. Four times the stiffness halves the period.</Hint>
            </div>
            <div className="space-y-1">
              <ParamSlider label="Pull down" value={p.amplitudeM} min={0.01} max={SPRING_MAX_PULL_M} step={0.01} unit="cm" format={(v) => `${Math.round(v * 100)}`} onChange={(v) => set({ amplitudeM: v })} onCommit={(v) => set({ amplitudeM: v })} />
              <Hint>How far below the rest position you let it go (you can also drag the mass itself). A bigger pull makes a bigger, faster bounce, but each bounce takes just as long.</Hint>
            </div>
            <div className="space-y-1">
              <ParamSlider label="Damping" value={p.damping} min={0} max={2} step={0.05} unit="kg/s" onChange={(v) => set({ damping: v })} onCommit={(v) => set({ damping: v })} />
              <Hint>{p.damping > 0 ? "Damping is friction and air resistance. Each bounce loses some energy, so the bounces shrink (watch the energy bars)." : "Damping is friction and air resistance. At 0 the spring is perfect and bounces forever. Turn it up to see the bounces die away."}</Hint>
            </div>
            <div className="space-y-1">
              <PlanetPicker value={p.planet} onChange={(planet) => set({ planet })} />
              <Hint>
                {gravityWords(p.planet)} Gravity decides where the mass hangs: here its weight stretches the spring by {lengthWords(stretch)}
                {p.planet !== "earth" && ` (on Earth it would be ${lengthWords(springRestStretch(p.massKg, p.k, PLANETS.earth.g))})`}. But gravity pulls equally hard at every point of the bounce, so it cannot hurry the bounce or slow it down: the period is the same on every planet.
              </Hint>
            </div>
          </div>
        </Panel>
        <Panel title="Period">
          <div className="grid grid-cols-3 gap-2">
            <Readout label="Measured" value={measured ? sf(measured) : "…"} unit="s" />
            <Readout label="2π√(m/k)" value={sf(formula)} unit="s" />
            <Readout label="Stretch" value={sf(stretch < 1 ? stretch * 100 : stretch)} unit={stretch < 1 ? "cm" : "m"} />
          </div>
          <div className="mt-2 space-y-1.5 text-xs text-white/60">
            <p>
              <b className="text-white/80">Measured</b> is timed from the bouncing mass:{" "}
              {measured ? `the average of its last ${view.periods.length} full bounce${view.periods.length > 1 ? "s" : ""}.` : damped === null ? "there is nothing to time, because it is not bouncing." : running ? "it needs one full bounce, down and back up, before it can show a time." : "press Bounce: it needs one full bounce to time."}
            </p>
            <p>
              <b className="text-white/80">2π√(m/k)</b> is the formula. Only the mass and the spring constant are in it: no gravity and no pull distance. <b className="text-white/80">Stretch</b> is how far the weight stretches the spring at rest (weight ÷ k): the one thing gravity does change.
            </p>
            {p.damping > 0 && <p className="text-[#fcd27b]">{damped === null ? "With this much damping it creeps back without bouncing, so there is no period." : `Damping makes each bounce very slightly slower: with this much, the exact period is ${sf(damped, 4)} s.`}</p>}
          </div>
        </Panel>
      </div>
    </div>
  );
}
