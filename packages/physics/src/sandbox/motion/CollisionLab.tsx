import { useReducedMotion } from "framer-motion";
import { Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { GuideCard, Hint, Narration } from "../../ui/explain";
import { Btn, Panel, ParamSlider, Readout, sf, Vector } from "../../ui/kit";
import { collisionAt, collisionNarration, collisionOutcome, kineticEnergy, momentum, TRACK, velocityWords, type CollisionParams } from "../motionScenes";

const CART_A = "#5b9dff", CART_B = "#f472b6";
const TRACK_Y = 196, PX_PER_M = 33;
const X = (m: number) => 30 + m * PX_PER_M;
/** Velocity arrows: 16 px per m/s, so the fastest starting speed draws 80 px. */
const ARROW = 16;
const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);

function Cart({ x, mass, v, colour, name, arrowY, side }: { x: number; mass: number; v: number; colour: string; name: string; arrowY: number; side: "start" | "end" }) {
  const h = 24 + mass * 5;
  const top = TRACK_Y - 8 - h;
  const cx = X(x);
  const w = TRACK.cartM * PX_PER_M;
  // Labels lean away from the other cart so they stay readable when the two are touching.
  const lx = cx + (side === "end" ? 10 : -10);
  return (
    <g>
      <line x1={cx} y1={top} x2={cx} y2={arrowY} stroke={colour} strokeOpacity={0.25} strokeDasharray="2 4" />
      <rect x={cx - w / 2} y={top} width={w} height={h} rx={4} fill={colour} stroke="#0b1020" strokeWidth={1.5} />
      <circle cx={cx - 9} cy={TRACK_Y - 5} r={5} fill="#c9d1e4" stroke="#0b1020" />
      <circle cx={cx + 9} cy={TRACK_Y - 5} r={5} fill="#c9d1e4" stroke="#0b1020" />
      <text x={cx} y={top + h / 2 + 5} textAnchor="middle" fontSize={14} fontWeight={800} fill="#0b1020">
        {name}
      </text>
      <text x={lx} y={TRACK_Y + 17} textAnchor={side} fontSize={12} className="fill-white/60">
        {mass} kg
      </text>
      <Vector x={cx} y={arrowY} dx={v * ARROW} dy={0} colour={colour} />
      <text x={lx} y={arrowY - 9} textAnchor={side} fontSize={12} fontWeight={700} fill={colour}>
        {Math.abs(v) < 0.005 ? "at rest" : `${v < 0 ? "← " : ""}${sf(Math.abs(v))} m/s${v > 0 ? " →" : ""}`}
      </text>
    </g>
  );
}

/**
 * Two carts on a straight track: set their masses, velocities and bounciness, press Go, and compare
 * the total momentum (always the same) with the total movement energy (only kept by a perfect bounce).
 */
export function CollisionLab({ p, set }: { p: CollisionParams; set: (p: Partial<CollisionParams>) => void }) {
  const reduced = useReducedMotion();
  const o = useMemo(() => collisionOutcome(p), [p]);
  const [run, setRun] = useState<{ id: number; done: boolean } | null>(null);
  const [t, setT] = useState(0);
  const reset = () => {
    setRun(null);
    setT(0);
  };
  // Back to the start line whenever the set-up changes.
  useEffect(reset, [p.m1, p.m2, p.u1, p.u2, p.restitution]);
  // Long approaches are fast-forwarded up to the moment the carts touch; from there it is real time.
  const rate = o.tHit !== null ? Math.max(1, o.tHit / 3) : 1;
  const go = () => {
    setT(reduced ? o.tEnd : 0);
    setRun((r) => ({ id: (r?.id ?? 0) + 1, done: !!reduced }));
  };
  const running = !!run && !run.done;
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let sim = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      sim = o.tHit !== null && sim < o.tHit ? Math.min(o.tHit, sim + dt * rate) : sim + dt;
      if (sim >= o.tEnd) {
        setT(o.tEnd);
        return setRun((r) => r && { ...r, done: true });
      }
      setT(sim);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, run?.id, o, rate]);

  const now = collisionAt(p, o, t);
  const pNow = momentum(p.m1, now.v1, p.m2, now.v2), keNow = kineticEnergy(p.m1, now.v1, p.m2, now.v2);
  const stage = !run ? "ready" : now.hit ? "after" : run.done ? "missed" : "approach";
  const lostPct = o.keBefore > 0 ? (100 * o.keLost) / o.keBefore : 0;
  const e = p.restitution;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-2">
        <div className="overflow-hidden rounded-xl bg-gradient-to-b from-[#0b1734] to-[#0a1020] ring-1 ring-inset ring-white/[0.08]">
          <svg viewBox="0 0 720 250" className="block w-full" role="img" aria-label={`Two carts on a straight track. Cart A, ${p.m1} kilograms, is ${velocityWords(now.v1)}. Cart B, ${p.m2} kilograms, is ${velocityWords(now.v2)}.`}>
            <line x1={X(0)} y1={TRACK_Y} x2={X(TRACK.lengthM)} y2={TRACK_Y} stroke="#3b4a6b" strokeWidth={3} strokeLinecap="round" />
            {[0, 5, 10, 15, 20].map((m) => (
              <g key={m}>
                <line x1={X(m)} x2={X(m)} y1={TRACK_Y + 2} y2={TRACK_Y + 8} stroke="#ffffff40" />
                <text x={X(m)} y={TRACK_Y + 38} textAnchor="middle" fontSize={11} className="fill-white/40">
                  {m} m
                </text>
              </g>
            ))}
            <text x={12} y={20} fontSize={11} className="fill-white/45">
              arrows show velocity: longer = faster
            </text>
            {running && !now.hit && rate > 1.05 && (
              <text x={708} y={20} textAnchor="end" fontSize={11} className="fill-white/55">
                fast-forward ×{sf(rate, 2)} until they meet
              </text>
            )}
            {now.hit && o.xHit !== null && (
              <g>
                <line x1={X(o.xHit)} x2={X(o.xHit)} y1={52} y2={TRACK_Y} stroke="#ffffff30" strokeDasharray="3 4" />
                <text x={X(o.xHit)} y={44} textAnchor="middle" fontSize={11} className="fill-white/55">
                  they met here
                </text>
              </g>
            )}
            <Cart x={now.x1} mass={p.m1} v={now.v1} colour={CART_A} name="A" arrowY={124} side="end" />
            <Cart x={now.x2} mass={p.m2} v={now.v2} colour={CART_B} name="B" arrowY={90} side="start" />
          </svg>
        </div>
        <Narration tone={stage === "after" ? "good" : o.kind !== "hit" ? "warn" : "info"}>{collisionNarration(stage, p, o)}</Narration>
        <div className="flex flex-wrap items-center gap-2">
          <Btn tone="primary" onClick={go} disabled={o.kind === "still"}>
            <Play className="mr-1 inline h-4 w-4" /> {run ? "Go again" : "Go"}
          </Btn>
          <Btn tone="ghost" onClick={reset} disabled={!run}>
            <RotateCcw className="mr-1 inline h-4 w-4" /> Reset
          </Btn>
          {reduced && <span className="text-xs text-white/50">Reduced motion is on, so Go jumps straight to the result.</span>}
        </div>
        <GuideCard
          id="motion-collisions"
          items={[
            { term: "The picture", text: "A side view of two carts on a straight, friction-free track. A starts on the left, B on the right. The taller the cart, the heavier it is." },
            { term: "Arrows", text: <>Each arrow is a cart&apos;s velocity: it points the way the cart is going, and a longer arrow means faster. <span style={{ color: CART_A }}>Blue is A</span>, <span style={{ color: CART_B }}>pink is B</span>.</> },
            { term: "Momentum", text: "Mass × velocity: how hard a moving thing is to stop. Moving right counts as +, moving left as −. During the collision A pushes on B exactly as hard as B pushes back on A, so whatever momentum one cart loses the other gains. The total never changes." },
            { term: "Movement energy", text: "Kinetic energy, ½ × mass × speed². Unlike momentum it can leak away: a collision that is not perfectly bouncy turns some of it into heat, sound and dents." },
            { term: "Try this", text: "Equal masses, bounciness 1, B at rest: A stops dead and B leaves with A's speed. Now set bounciness to 0: they share the speed, the momentum is the same, and half the energy is gone." },
            { term: "And this", text: "Make A much heavier than B and send them at each other. Which one turns round? Then swap the masses." },
          ]}
        />
      </div>
      <div className="min-w-0 space-y-3">
        <Panel title="Carts">
          <div className="space-y-3">
            <div className="space-y-1">
              <ParamSlider label="Mass of A" value={p.m1} min={0.5} max={5} step={0.5} unit="kg" onChange={(v) => set({ m1: v })} onCommit={(v) => set({ m1: v })} />
              <ParamSlider label="Velocity of A" value={p.u1} min={-5} max={5} step={0.5} unit="m/s" format={signed} onChange={(v) => set({ u1: v })} onCommit={(v) => set({ u1: v })} />
              <Hint>+ means moving right, − means moving left, 0 is standing still.</Hint>
            </div>
            <div className="space-y-1">
              <ParamSlider label="Mass of B" value={p.m2} min={0.5} max={5} step={0.5} unit="kg" onChange={(v) => set({ m2: v })} onCommit={(v) => set({ m2: v })} />
              <ParamSlider label="Velocity of B" value={p.u2} min={-5} max={5} step={0.5} unit="m/s" format={signed} onChange={(v) => set({ u2: v })} onCommit={(v) => set({ u2: v })} />
              <Hint>To make them collide, A must be catching B up: A&apos;s velocity has to be bigger than B&apos;s.</Hint>
            </div>
            <div className="space-y-1">
              <ParamSlider label="Bounciness" value={e} min={0} max={1} step={0.05} onChange={(v) => set({ restitution: v })} onCommit={(v) => set({ restitution: v })} />
              <Hint>{e <= 0 ? "0: no bounce at all. The carts stick together, like two lumps of clay." : e >= 1 ? "1: a perfect bounce. They part as fast as they came together and no movement energy is lost." : `They part at ${sf(e * 100, 2)}% of the speed they came together at, like real balls. 0 sticks, 1 is a perfect bounce.`}</Hint>
            </div>
          </div>
        </Panel>
        <Panel title="Momentum and energy">
          <div className="grid grid-cols-2 gap-2">
            <Readout label="Momentum: start" value={sf(o.pBefore)} unit="kg·m/s" />
            <Readout label="Momentum: now" value={sf(pNow)} unit="kg·m/s" tone={now.hit ? "good" : "default"} />
            <Readout label="Energy: start" value={sf(o.keBefore)} unit="J" />
            <Readout label="Energy: now" value={sf(keNow)} unit="J" tone={now.hit ? (lostPct > 0.5 ? "warn" : "good") : "default"} />
            <Readout label="A now" value={sf(now.v1)} unit="m/s" />
            <Readout label="B now" value={sf(now.v2)} unit="m/s" />
          </div>
          <div className="mt-2 space-y-1.5 text-xs text-white/60">
            <p>
              <b className="text-white/80">Momentum</b> is added up over both carts (right is +, left is −). {now.hit ? "It is exactly what it was before the collision, as it always is." : "Watch it through the collision: it will not change."}
            </p>
            <p className={now.hit && lostPct > 0.5 ? "text-[#fcd27b]" : ""}>
              <b className="text-white/80">Energy</b> here is movement (kinetic) energy.{" "}
              {!now.hit ? "It only survives a perfectly bouncy collision." : lostPct > 0.5 ? `${sf(o.keLost)} J (${sf(lostPct, 2)}%) is missing: it became heat, sound and squashing of the carts. Energy is never destroyed, it just stopped being movement.` : "None was lost, because this bounce was perfect."}
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
