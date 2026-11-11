import { useReducedMotion } from "framer-motion";
import { Droplets, Hourglass } from "lucide-react";
import { useEffect, useState } from "react";
import { buoyancy, SINKERS } from "../core/mechanics";
import type { ArchimedesSetup, ArchimedesState } from "../labs/mechanics";
import { DragHandle, easeInOut, GhostHand, LabStyles, mix, paramOf, PulseRect, Stage, Tag, useCommitLater, useDemoPreview, useFocusStep, V3, type Pt } from "./interact";
import { Btn, Panel, ReadingInput } from "./kit";
import { submitted } from "./guide";
import type { SimSession } from "./useSimSession";

const W = 560;
const H = 420;
const CAN_X = 236;
const CAN_TOP = 196;
const CAN_FLOOR = 348;
const BENCH = 372;
const SPOUT = { x: CAN_X + 96, y: CAN_TOP + 34 };
const CYL_SLOT = { x: CAN_X + 112, y: BENCH };
const CYL_HOME = { x: 500, y: BENCH };
const JUG_HOME = { x: 112, y: BENCH };
const SINK_H = 46;
const BAL_BOTTOM = 112;

/**
 * Archimedes' principle. Pour the jug into the overflow can, wait for the last drip, slide the
 * measuring cylinder under the spout, then lower the sinker into the water by dragging it. Readings
 * come off the spring balance and cylinder through magnifying lenses.
 */
export function ArchimedesWorkspace({ session }: { session: SimSession<ArchimedesState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as ArchimedesSetup;
  const sinker = SINKERS.find((x) => x.id === setup.sinker) ?? SINKERS[0]!;
  const reduced = useReducedMotion();
  const ro = session.readOnly;
  const focus = useFocusStep(session);
  const demo = useDemoPreview(session, 1300);

  // the can keeps dripping for a few seconds after it is filled (until the student waits it out)
  const [dripping, setDripping] = useState(false);
  useEffect(() => {
    if (!s.canFull || s.dripStopped) {
      setDripping(false);
      return;
    }
    setDripping(true);
    const id = window.setTimeout(() => setDripping(false), 6000);
    return () => window.clearTimeout(id);
  }, [s.canFull, s.dripStopped]);

  /* ---------------------------------------------------------------- sinker depth (drag) */
  const surface = s.canFull ? CAN_TOP + 22 : CAN_TOP + 70;
  const ybOf = (f: number, touching: boolean) => (touching ? CAN_FLOOR - 2 : f >= 1 ? Math.min(CAN_FLOOR - 24, surface + SINK_H + 26) : surface - 54 + f * (SINK_H + 54));
  const fOf = (yb: number) => Math.max(0, Math.min(1, (yb - surface) / SINK_H));
  const [depth, setDepth] = useState<number | null>(null); // sinker bottom y while dragging
  const nImm = paramOf(demo.next, "immerse");
  const kk = easeInOut(Math.max(0, (demo.k - 0.3) / 0.7));
  const restYb = ybOf(s.immersed, s.touching);
  const yb = depth ?? (typeof nImm === "number" ? mix(restYb, ybOf(nImm, false), kk) : restYb);
  const liveF = depth !== null ? fOf(depth) : typeof nImm === "number" ? fOf(yb) : s.immersed;
  const liveTouch = depth !== null ? depth >= CAN_FLOOR - 4 : s.touching;
  const commitDepth = (y: number) => {
    const f = Math.round(fOf(y) * 20) / 20;
    const touching = y >= CAN_FLOOR - 4;
    const val = touching ? 1 : f;
    if (val !== s.immersed) session.dispatch("param.set", { key: "immerse", value: val });
    if (touching !== s.touching) session.dispatch("param.set", { key: "touching", value: touching });
    setDepth(null);
  };
  const commitLater = useCommitLater(commitDepth, 450);

  const b = buoyancy(sinker, liveF, setup.g);
  const shownN = liveTouch ? b.readingN * 0.5 : b.readingN;
  const cylMl = (s.cylinderPlaced ? b.displacedMl : 0) + s.extraMl;

  /* ---------------------------------------------------------------- jug and cylinder drags */
  const [jug, setJug] = useState<Pt | null>(null);
  const [cyl, setCyl] = useState<Pt | null>(null);
  const overCan = (p: Pt) => Math.abs(p.x - CAN_X) < 90 && p.y < CAN_TOP + 40;
  const overSlot = (p: Pt) => Math.hypot(p.x - CYL_SLOT.x, p.y - CYL_SLOT.y) < 70;
  const fill = () => !ro && !s.canFull && session.dispatch("param.set", { key: "fill-can", value: true });
  const toggleCyl = (on: boolean) => !ro && on !== s.cylinderPlaced && session.dispatch("param.set", { key: "cylinder", value: on });

  /* ---------------------------------------------------------------- demo glides */
  const nFill = demo.next?.type === "param.set" && (demo.next.payload as { key: string }).key === "fill-can";
  const nWait = demo.next?.type === "param.set" && (demo.next.payload as { key: string }).key === "wait-drip";
  const nCyl = paramOf(demo.next, "cylinder");
  const jugAt = jug ?? (nFill ? { x: mix(JUG_HOME.x, CAN_X - 40, kk), y: mix(JUG_HOME.y, CAN_TOP - 10, kk) } : JUG_HOME);
  const cylBase = s.cylinderPlaced ? CYL_SLOT : CYL_HOME;
  const cylAt = cyl ?? (nCyl !== undefined ? { x: mix(cylBase.x, nCyl ? CYL_SLOT.x : CYL_HOME.x, kk), y: BENCH } : cylBase);
  const waitPill = { x: SPOUT.x + 40, y: SPOUT.y - 36 };

  let hand: Pt | null = null;
  let pressing = false;
  let follow = false;
  if (nFill) {
    hand = { x: jugAt.x + 10, y: jugAt.y - 40 };
    pressing = demo.k > 0.25;
    follow = demo.k > 0.3;
  } else if (nWait) {
    hand = waitPill;
    pressing = demo.k > 0.7;
  } else if (nCyl !== undefined) {
    hand = { x: cylAt.x, y: cylAt.y - 70 };
    pressing = demo.k > 0.25;
    follow = demo.k > 0.3;
  } else if (nImm !== undefined) {
    hand = { x: CAN_X + 6, y: yb - SINK_H / 2 };
    pressing = demo.k > 0.25;
    follow = demo.k > 0.3;
  }

  /* ---------------------------------------------------------------- guidance */
  const g = !ro ? focus : null;
  const jugPulse = g === "fill-can" && !s.canFull;
  const waitPulse = g === "fill-can" && s.canFull && !s.dripStopped;
  const cylPulse = g === "cylinder" && !s.cylinderPlaced;
  const sinkPulse = g === "immerse" && depth === null;
  const flowing = s.canFull && s.cylinderPlaced && depth !== null && liveF > s.immersed + 0.01;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_330px]">
      <LabStyles />
      <Stage className="min-h-[340px]" label={dripping ? "The can is still dripping…" : undefined}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full select-none" role="group" aria-label={`Spring balance over an overflow can. Sinker ${Math.round(liveF * 100)} % under water${liveTouch ? ", touching the bottom" : ""}.`}>
          <defs>
            <linearGradient id="ar-water" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(96,180,255,.65)" />
              <stop offset="1" stopColor="rgba(40,110,220,.75)" />
            </linearGradient>
            <linearGradient id="ar-glass" x1="0" x2="1">
              <stop offset="0" stopColor="rgba(220,235,255,.16)" />
              <stop offset="0.15" stopColor="rgba(220,235,255,.04)" />
              <stop offset="0.85" stopColor="rgba(220,235,255,.04)" />
              <stop offset="1" stopColor="rgba(220,235,255,.18)" />
            </linearGradient>
            <linearGradient id="ar-metal" x1="0" x2="1">
              <stop offset="0" stopColor={sinker.id === "brass" ? "#8a6a14" : "#7a828f"} />
              <stop offset="0.45" stopColor={sinker.id === "brass" ? "#f2cf63" : "#e3e8ef"} />
              <stop offset="1" stopColor={sinker.id === "brass" ? "#9c7a1c" : "#8d95a3"} />
            </linearGradient>
          </defs>
          {/* bench and stand */}
          <rect x={14} y={BENCH} width={W - 28} height={12} rx={4} fill="#2b3142" />
          <rect x={56} y={22} width={10} height={BENCH - 22} rx={3} fill="#5b6680" />
          <rect x={56} y={26} width={CAN_X - 44} height={8} rx={3} fill="#5b6680" />
          {/* spring balance */}
          <g>
            <line x1={CAN_X} y1={34} x2={CAN_X} y2={44} stroke="#9fb0cc" strokeWidth={2} />
            <rect x={CAN_X - 18} y={44} width={36} height={BAL_BOTTOM - 52} rx={8} fill="#dbe2ee" stroke="#5b6680" />
            <rect x={CAN_X - 9} y={52} width={18} height={44} fill="#fff" />
            {Array.from({ length: 11 }, (_, i) => (
              <line key={i} x1={CAN_X - 9} y1={52 + i * 4.4} x2={CAN_X - 2} y2={52 + i * 4.4} stroke="#333" strokeWidth={i % 5 === 0 ? 0.9 : 0.5} />
            ))}
            <rect x={CAN_X - 12} y={52 + Math.min(44, (shownN / 2.5) * 44) - 1} width={24} height={2.4} fill="#d93348" style={{ transition: reduced ? "none" : "y .35s cubic-bezier(.3,1.5,.5,1)" }} />
            <line x1={CAN_X} y1={BAL_BOTTOM - 8} x2={CAN_X} y2={BAL_BOTTOM} stroke="#9fb0cc" strokeWidth={1.5} />
          </g>
          {/* thread */}
          <line x1={CAN_X} y1={BAL_BOTTOM} x2={CAN_X} y2={yb - SINK_H} stroke="#dbe2ee" strokeWidth={1.2} />
          {/* overflow can (water behind the sinker, glass in front) */}
          <rect x={CAN_X - 62} y={surface + (s.canFull ? 0 : -liveF * 6)} width={124} height={CAN_FLOOR - surface - (s.canFull ? 0 : -liveF * 6)} fill="url(#ar-water)" />
          <path d={`M${CAN_X - 62} ${surface + (s.canFull ? 0 : -liveF * 6)} h124`} stroke="rgba(200,230,255,.8)" strokeWidth={1.5} />
          {/* sinker */}
          <DragHandle
            label={`Sinker on its thread. Drag it down into the water, or use the up and down arrow keys. ${Math.round(liveF * 100)} percent under water${liveTouch ? ", resting on the bottom" : ""}.`}
            valueText={liveTouch ? "touching the bottom" : `${Math.round(liveF * 100)} percent under`}
            value={liveF}
            min={0}
            max={1}
            disabled={ro}
            ring={{ cx: CAN_X, cy: yb - SINK_H / 2, r: 24 }}
            pulse={sinkPulse}
            onDrag={(p) => setDepth(Math.max(surface - 54, Math.min(CAN_FLOOR - 2, p.y + SINK_H / 2)))}
            onDragEnd={(_p, moved) => moved && depth !== null && commitDepth(depth)}
            onKey={(key, shift) => {
              const cur = depth ?? yb;
              const st = shift ? 20 : SINK_H * 0.25;
              const next = key === "ArrowDown" ? Math.min(CAN_FLOOR - 2, cur + st) : key === "ArrowUp" ? Math.max(surface - 54, cur - st) : null;
              if (next === null) return false;
              setDepth(next);
              commitLater(next);
              return true;
            }}
          >
            <rect x={CAN_X - 30} y={yb - SINK_H - 10} width={60} height={SINK_H + 20} fill="transparent" />
            <rect x={CAN_X - 16} y={yb - SINK_H} width={32} height={SINK_H} rx={5} fill="url(#ar-metal)" stroke="#3a4152" />
            <ellipse cx={CAN_X} cy={yb - SINK_H} rx={16} ry={3} fill="rgba(255,255,255,.35)" />
          </DragHandle>
          <rect x={CAN_X - 64} y={CAN_TOP} width={128} height={CAN_FLOOR - CAN_TOP + 2} rx={4} fill="url(#ar-glass)" stroke="#9fb0cc" strokeWidth={2} pointerEvents="none" />
          <path d={`M ${CAN_X + 64} ${CAN_TOP + 20} l 34 12 l 0 6 l -34 -10 Z`} fill="#9fb0cc" pointerEvents="none" />
          {/* drip or stream into the cylinder */}
          {(dripping || flowing) && !reduced && (
            <line x1={SPOUT.x} y1={SPOUT.y + 2} x2={SPOUT.x} y2={BENCH - 20} stroke="#74c0fc" strokeWidth={flowing ? 3 : 2.5} strokeDasharray={flowing ? "10 6" : "3 26"} strokeLinecap="round" className="ls-flow" style={{ animationDuration: flowing ? ".35s" : ".9s", animationDirection: "reverse" }} />
          )}
          {/* the wait-for-the-drip pill */}
          {s.canFull && !s.dripStopped && (
            <DragHandle role="button" label="Wait for the last drip" disabled={ro} onActivate={() => session.dispatch("param.set", { key: "wait-drip", value: true })} ring={{ cx: waitPill.x, cy: waitPill.y, r: 12 }} pulse={waitPulse}>
              <rect x={waitPill.x - 52} y={waitPill.y - 13} width={104} height={26} rx={13} fill="#060d1f" stroke={V3.cyan} strokeOpacity={0.6} />
              <Hourglass x={waitPill.x - 44} y={waitPill.y - 6} width={12} height={12} color={V3.cyan} strokeWidth={2.5} aria-hidden />
              <text x={waitPill.x + 7} y={waitPill.y + 4} fontSize={11} fontWeight={700} textAnchor="middle" fill={V3.cyan}>
                wait for drip
              </text>
            </DragHandle>
          )}
          {/* drop zones */}
          {(cyl || cylPulse) && <PulseRect x={CYL_SLOT.x - 26} y={BENCH - 124} w={52} h={124} colour={cyl && overSlot(cyl) ? V3.mint : V3.cyan} />}
          {(jug || jugPulse) && <PulseRect x={CAN_X - 70} y={CAN_TOP - 70} w={140} h={66} colour={jug && overCan(jug) ? V3.mint : V3.cyan} />}
          {/* measuring cylinder */}
          <DragHandle
            role="button"
            label={s.cylinderPlaced ? "Measuring cylinder, under the spout. Drag it away or press Enter to remove it." : "Measuring cylinder. Drag it under the spout, or press Enter."}
            disabled={ro}
            ring={{ cx: cylAt.x, cy: cylAt.y - 56, r: 18 }}
            pulse={cylPulse && !cyl}
            onDrag={(p) => setCyl({ x: Math.max(40, Math.min(W - 30, p.x)), y: BENCH })}
            onDragEnd={(_p, moved) => {
              if (moved && cyl) toggleCyl(overSlot(cyl));
              setCyl(null);
            }}
            onActivate={() => toggleCyl(!s.cylinderPlaced)}
          >
            <Cylinder x={cylAt.x} ml={s.cylinderPlaced && !cyl ? cylMl : 0} />
          </DragHandle>
          {/* jug */}
          {!s.canFull && (
            <DragHandle
              role="button"
              label="Jug of water. Drag it over the overflow can to fill it to the spout, or press Enter."
              disabled={ro}
              ring={{ cx: jugAt.x, cy: jugAt.y - 30, r: 22 }}
              pulse={jugPulse && !jug}
              onDrag={(p) => setJug({ x: p.x, y: Math.min(BENCH, p.y + 30) })}
              onDragEnd={(_p, moved) => {
                if (moved && jug && overCan(jug)) fill();
                setJug(null);
              }}
              onActivate={fill}
            >
              <g transform={`translate(${jugAt.x} ${jugAt.y}) rotate(${jug && overCan(jug) ? 35 : nFill ? kk * 35 : 0})`}>
                <rect x={-22} y={-58} width={44} height={58} rx={6} fill="url(#ar-glass)" stroke="#9fb0cc" strokeWidth={1.6} />
                <rect x={-20} y={-40} width={40} height={38} rx={4} fill="url(#ar-water)" />
                <path d="M22 -50 q14 4 0 26" fill="none" stroke="#9fb0cc" strokeWidth={3} />
                <path d="M-22 -58 l-8 -6" stroke="#9fb0cc" strokeWidth={2} />
              </g>
            </DragHandle>
          )}
          {jugPulse && !jug && <Tag x={JUG_HOME.x + 20} y={BENCH - 82} text="Pour into the can" />}
          {cylPulse && !cyl && <Tag x={CYL_HOME.x - 30} y={BENCH - 140} text="Slide under the spout" />}
          {sinkPulse && <Tag x={CAN_X - 70} y={yb - SINK_H - 16} text="Drag down into the water" anchor="end" />}
          <GhostHand at={hand} pressing={pressing} follow={follow} />
        </svg>
      </Stage>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Spring balance (lens)" glow={!ro && (focus === "weigh-air" || focus === "weigh-water")}>
          <ScaleLens value={shownN} min={0} max={2.5} minor={0.02} major={0.1} unit="N" />
          <div className="mt-2">
            <ReadingInput label={s.immersed > 0 ? "Reading in water" : "Reading in air"} unit="N" onRecord={(v) => session.dispatch("measure.read", { instrument: "balance", reading: { key: s.immersed > 0 ? "water" : "air", value: v, unit: "N" } })} value={submitted(session.events, s.immersed > 0 ? "water" : "air", "balance")} disabled={ro} />
          </div>
        </Panel>
        <Panel title="Can and cylinder" glow={jugPulse || waitPulse || cylPulse}>
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={fill} disabled={ro || s.canFull}>
              <Droplets className="h-4 w-4" /> Fill the can
            </Btn>
            <Btn onClick={() => session.dispatch("param.set", { key: "wait-drip", value: true })} disabled={ro || !s.canFull || s.dripStopped}>
              <Hourglass className="h-4 w-4" /> Wait
            </Btn>
          </div>
          <Btn onClick={() => toggleCyl(!s.cylinderPlaced)} disabled={ro} className="mt-2 w-full" pressed={s.cylinderPlaced}>
            {s.cylinderPlaced ? "Remove the cylinder" : "Put the cylinder under the spout"}
          </Btn>
          <p className="mt-2 text-[11px] text-[#8fa6d1]">Drag the jug, cylinder and sinker on the bench, or use these buttons and the arrow keys.</p>
        </Panel>
        <Panel title="Measuring cylinder (lens)" glow={!ro && focus === "volume"}>
          {s.cylinderPlaced ? <ScaleLens value={cylMl} min={0} max={50} minor={1} major={5} unit="mL" vertical /> : <p className="text-xs text-[#8fa6d1]">Place the cylinder first.</p>}
          <div className="mt-2">
            <ReadingInput label="Volume of water" unit="mL" onRecord={(v) => session.dispatch("measure.read", { instrument: "cylinder", reading: { key: "volume", value: v, unit: "mL" } })} value={submitted(session.events, "volume", "cylinder")} disabled={ro || !s.cylinderPlaced} />
          </div>
        </Panel>
        <Panel title="Compare" glow={!ro && focus === "compare"}>
          <div className="space-y-2">
            <ReadingInput label="Upthrust (air − water)" unit="N" onRecord={(v) => session.dispatch("param.set", { key: "result:upthrust", value: v })} value={submitted(session.events, "result:upthrust")} disabled={ro} />
            <ReadingInput label="Weight of water displaced" unit="N" onRecord={(v) => session.dispatch("param.set", { key: "result:displaced", value: v })} value={submitted(session.events, "result:displaced")} disabled={ro} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** A 50 mL measuring cylinder standing on the bench at x. */
function Cylinder({ x, ml }: { x: number; ml: number }) {
  const top = BENCH - 116;
  const h = 108;
  return (
    <g>
      <rect x={x - 24} y={top - 6} width={48} height={124} fill="transparent" />
      <rect x={x - 20} y={BENCH - 5} width={40} height={5} rx={2} fill="#9fb0cc" />
      <rect x={x - 14} y={top} width={28} height={h + 4} rx={3} fill="url(#ar-glass)" stroke="#dbe2ee" />
      <rect x={x - 13} y={top + 2 + h - (ml / 50) * h} width={26} height={(ml / 50) * h} fill="url(#ar-water)" style={{ transition: "y .3s, height .3s" }} />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={i} x1={x - 14} y1={top + 2 + h - i * (h / 10)} x2={x - (i % 5 === 0 ? 4 : 8)} y2={top + 2 + h - i * (h / 10)} stroke="#dbe2ee" strokeWidth={0.7} />
      ))}
    </g>
  );
}

/** A magnified slice of a scale centred on the value, so readings to the minor division are possible. */
export function ScaleLens({ value, min, max, minor, major, unit, vertical }: { value: number; min: number; max: number; minor: number; major: number; unit: string; vertical?: boolean }) {
  const span = major * 3;
  const lo = Math.max(min, Math.min(max - span, value - span / 2));
  const W2 = 300;
  const H2 = 70;
  const X = (v: number) => ((v - lo) / span) * (W2 - 20) + 10;
  const ticks = [];
  for (let v = Math.ceil(lo / minor) * minor; v <= lo + span + 1e-9; v += minor) ticks.push(Number(v.toFixed(6)));
  return (
    <svg viewBox={`0 0 ${W2} ${H2}`} className="w-full rounded-[12px] bg-[#f6f1e1]" role="img" aria-label={`${unit} scale, magnified`}>
      {ticks.map((v) => {
        const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
        const isHalf = !isMajor && Math.abs((v * 2) / major - Math.round((v * 2) / major)) < 1e-6;
        return (
          <g key={v}>
            <line x1={X(v)} y1={vertical ? 40 : 6} x2={X(v)} y2={vertical ? 40 - (isMajor ? 26 : isHalf ? 18 : 11) : 6 + (isMajor ? 26 : isHalf ? 18 : 11)} stroke="#222" strokeWidth={isMajor ? 1.4 : 0.7} />
            {isMajor && (
              <text x={X(v)} y={vertical ? 56 : 48} textAnchor="middle" fontSize={11} fontWeight={700} fill="#222">
                {Number(v.toFixed(3))}
              </text>
            )}
          </g>
        );
      })}
      {vertical ? <rect x={10} y={41} width={Math.max(0, X(value) - 10)} height={5} fill="#4dabf7" /> : <polygon points={`${X(value)},4 ${X(value) - 5},-4 ${X(value) + 5},-4`} transform="translate(0 4)" fill="#e03131" />}
      {!vertical && <line x1={X(value)} y1={4} x2={X(value)} y2={40} stroke="#e03131" strokeWidth={1.6} />}
      <text x={W2 - 6} y={H2 - 6} textAnchor="end" fontSize={10} fill="#555">
        {unit}
      </text>
    </svg>
  );
}
