import { motion, useReducedMotion } from "framer-motion";
import { Droplets, Hourglass } from "lucide-react";
import { useEffect, useState } from "react";
import { buoyancy, SINKERS } from "../core/mechanics";
import type { ArchimedesSetup, ArchimedesState } from "../labs/mechanics";
import { Btn, Panel, ParamSlider, ReadingInput } from "./kit";
import type { SimSession } from "./useSimSession";

/**
 * Archimedes' principle: spring balance, overflow can and measuring cylinder. The balance and
 * cylinder are read off their scales through lenses; the can drips for a while after filling.
 */
export function ArchimedesWorkspace({ session }: { session: SimSession<ArchimedesState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as ArchimedesSetup;
  const sinker = SINKERS.find((x) => x.id === setup.sinker) ?? SINKERS[0]!;
  const reduced = useReducedMotion();
  const ro = session.readOnly;
  const b = buoyancy(sinker, s.immersed, setup.g);
  const shownN = s.touching ? b.readingN * 0.5 : b.readingN;
  const cylMl = (s.cylinderPlaced ? b.displacedMl : 0) + s.extraMl;

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

  const W = 560;
  const H = 420;
  const canX = 210;
  const canTop = 220;
  const waterY = canTop + 22;
  const lower = s.immersed; // 0..1 (+ touching)
  const sinkerTop = 120 + lower * 150 + (s.touching ? 18 : 0);
  const sinkerH = 46;

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
      <div className="relative min-h-[320px] overflow-hidden rounded-xl bg-[radial-gradient(600px_400px_at_40%_20%,#1d3263,#0a1226)] ring-1 ring-inset ring-white/10">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label={`Spring balance over an overflow can. Sinker ${Math.round(lower * 100)} % under water${s.touching ? ", touching the bottom" : ""}.`}>
          {/* stand and balance */}
          <rect x={60} y={30} width={10} height={360} fill="#495057" />
          <rect x={60} y={30} width={canX - 30} height={8} fill="#495057" />
          <g transform={`translate(${canX - 12} ${38 + lower * 150 + (s.touching ? 18 : 0)})`}>
            <rect x={-10} y={0} width={44} height={70} rx={6} fill="#dee2e6" stroke="#868e96" />
            <rect x={-2} y={8} width={28} height={50} fill="#fff" />
            {Array.from({ length: 11 }, (_, i) => (
              <line key={i} x1={-2} y1={8 + i * 5} x2={8} y2={8 + i * 5} stroke="#333" strokeWidth={0.6} />
            ))}
            <motion.rect x={-4} width={36} height={2} fill="#e03131" animate={{ y: 8 + Math.min(50, (shownN / 2) * 50) }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 10 }} />
            <line x1={12} y1={70} x2={12} y2={82} stroke="#adb5bd" strokeWidth={1.5} />
          </g>
          <line x1={canX} y1={sinkerTop - 30} x2={canX} y2={sinkerTop} stroke="#adb5bd" strokeWidth={1.2} />
          {/* overflow can */}
          <rect x={canX - 60} y={canTop} width={120} height={150} fill="rgba(200,220,255,.08)" stroke="#adb5bd" strokeWidth={2} />
          <path d={`M ${canX + 60} ${canTop + 20} l 34 10 l 0 6 l -34 -8 Z`} fill="#adb5bd" />
          {s.canFull ? <rect x={canX - 58} y={waterY} width={116} height={canTop + 150 - waterY - 2} fill="rgba(77,171,247,.45)" /> : <rect x={canX - 58} y={canTop + 70} width={116} height={78} fill="rgba(77,171,247,.45)" />}
          {/* sinker */}
          <rect x={canX - 16} y={sinkerTop} width={32} height={sinkerH} rx={4} fill={sinker.id === "brass" ? "#c9a227" : sinker.id === "aluminium" ? "#ced4da" : "#868e96"} stroke="#495057" />
          {/* drip or overflow stream into the cylinder */}
          {(dripping || (lower > 0 && lower < 1 && s.canFull)) && !reduced && (
            <motion.circle cx={canX + 94} cy={canTop + 36} r={3} fill="#74c0fc" animate={{ cy: [canTop + 36, canTop + 120] }} transition={{ repeat: Infinity, duration: 0.6, ease: "easeIn" }} />
          )}
          {/* measuring cylinder */}
          {s.cylinderPlaced ? (
            <g>
              <rect x={canX + 80} y={canTop + 60} width={30} height={110} fill="rgba(255,255,255,.06)" stroke="#dee2e6" />
              <rect x={canX + 81} y={canTop + 170 - (cylMl / 50) * 108} width={28} height={(cylMl / 50) * 108} fill="rgba(77,171,247,.55)" />
              {Array.from({ length: 11 }, (_, i) => (
                <line key={i} x1={canX + 80} y1={canTop + 170 - i * 10.8} x2={canX + 88} y2={canTop + 170 - i * 10.8} stroke="#dee2e6" strokeWidth={0.7} />
              ))}
            </g>
          ) : (
            <text x={canX + 95} y={canTop + 170} fontSize={10} fill="rgba(255,255,255,.4)" textAnchor="middle">
              (tray)
            </text>
          )}
          <rect x={20} y={372} width={W - 40} height={8} fill="#343a40" />
        </svg>
        {dripping && <div className="absolute left-3 top-3 rounded-lg bg-sky-500/80 px-2.5 py-1 text-xs font-semibold text-white">The can is still dripping…</div>}
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Spring balance (lens)">
          <ScaleLens value={shownN} min={0} max={2.5} minor={0.02} major={0.1} unit="N" />
          <div className="mt-2">
            <ReadingInput label={s.immersed > 0 ? "Reading in water" : "Reading in air"} unit="N" onRecord={(v) => session.dispatch("measure.read", { instrument: "balance", reading: { key: s.immersed > 0 ? "water" : "air", value: v, unit: "N" } })} disabled={ro} />
          </div>
        </Panel>
        <Panel title="Can and cylinder">
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => session.dispatch("param.set", { key: "fill-can", value: true })} disabled={ro || s.canFull}>
              <Droplets className="h-4 w-4" /> Fill the can
            </Btn>
            <Btn onClick={() => session.dispatch("param.set", { key: "wait-drip", value: true })} disabled={ro || !s.canFull || s.dripStopped}>
              <Hourglass className="h-4 w-4" /> Wait for the last drip
            </Btn>
          </div>
          <Btn onClick={() => session.dispatch("param.set", { key: "cylinder", value: !s.cylinderPlaced })} disabled={ro} className="mt-2 w-full" pressed={s.cylinderPlaced}>
            {s.cylinderPlaced ? "Remove the cylinder" : "Put the cylinder under the spout"}
          </Btn>
          <div className="mt-3">
            <ParamSlider label="Lower the sinker" value={s.immersed + (s.touching ? 0.1 : 0)} min={0} max={1.1} step={0.05} format={(v) => (v > 1 ? "touching the bottom" : `${Math.round(v * 100)} % under`)} onCommit={(v) => {
              const touching = v > 1.0001;
              session.dispatch("param.set", { key: "immerse", value: Math.min(1, v) });
              if (touching !== s.touching) session.dispatch("param.set", { key: "touching", value: touching });
            }} disabled={ro} />
          </div>
        </Panel>
        <Panel title="Measuring cylinder (lens)">
          {s.cylinderPlaced ? <ScaleLens value={cylMl} min={0} max={50} minor={1} major={5} unit="mL" vertical /> : <p className="text-xs text-white/50">Place the cylinder first.</p>}
          <div className="mt-2">
            <ReadingInput label="Volume of water" unit="mL" onRecord={(v) => session.dispatch("measure.read", { instrument: "cylinder", reading: { key: "volume", value: v, unit: "mL" } })} disabled={ro || !s.cylinderPlaced} />
          </div>
        </Panel>
        <Panel title="Compare">
          <div className="space-y-2">
            <ReadingInput label="Upthrust (air − water)" unit="N" onRecord={(v) => session.dispatch("param.set", { key: "result:upthrust", value: v })} disabled={ro} />
            <ReadingInput label="Weight of water displaced" unit="N" onRecord={(v) => session.dispatch("param.set", { key: "result:displaced", value: v })} disabled={ro} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** A magnified slice of a scale centred on the value, so readings to the minor division are possible. */
export function ScaleLens({ value, min, max, minor, major, unit, vertical }: { value: number; min: number; max: number; minor: number; major: number; unit: string; vertical?: boolean }) {
  const span = major * 3;
  const lo = Math.max(min, Math.min(max - span, value - span / 2));
  const W = 300;
  const H = 70;
  const X = (v: number) => ((v - lo) / span) * (W - 20) + 10;
  const ticks = [];
  for (let v = Math.ceil(lo / minor) * minor; v <= lo + span + 1e-9; v += minor) ticks.push(Number(v.toFixed(6)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-[#f6f1e1]" role="img" aria-label={`${unit} scale, magnified`}>
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
      <text x={W - 6} y={H - 6} textAnchor="end" fontSize={10} fill="#555">
        {unit}
      </text>
    </svg>
  );
}
