import { useReducedMotion } from "framer-motion";
import { ArrowLeftRight, Hand, Play } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gradientThroughOrigin, newtonMasses, newtonRun, slopeResidual, type NewtonSetup, type NewtonState } from "../labs/dynamics";
import { GhostHand, LabStyles, paramOf, Stage, Tag, useDemoPreview, useFocusStep, V3, type Pt } from "./interact";
import { Btn, LiveGraph, Panel, ParamSlider, ReadingInput, Readout, sf } from "./kit";
import { submitted } from "./guide";
import type { SimSession } from "./useSimSession";

const W = 640;
const H = 320;
const X0 = 60; // start line (trolley front), px
const K = 480; // px per metre of runway
const TRACK_Y = 190;
const PULLEY = { x: X0 + 0.95 * K, y: TRACK_Y - 8 };
const RUN_M = 0.85; // distance travelled before the hanger reaches the floor
const TROLLEY_W = 76;
const TILT_VIS = 4; // the drawn tilt is exaggerated so a 0.7° slope is visible

/**
 * Newton's second law. A trolley on a runway is pulled by a hanger over a pulley. Tilt the runway
 * and nudge the trolley to cancel friction; move 20 g masses between trolley and hanger; release;
 * the logger reads the card times at two light gates and works out the acceleration.
 */
export function TrolleyWorkspace({ session }: { session: SimSession<NewtonState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as NewtonSetup;
  const ro = session.readOnly;
  const reduced = useReducedMotion();
  const focus = useFocusStep(session);
  const demo = useDemoPreview(session, 1100);
  const masses = newtonMasses(s, setup);
  const preview = newtonRun(s, setup);
  const last = s.runs[s.runs.length - 1] ?? null;
  const residual = slopeResidual(s.tiltDeg, setup.mu);

  /* ---------------------------------------------------------------- run animation (refs, no re-render) */
  const trolley = useRef<SVGGElement>(null);
  const hanger = useRef<SVGGElement>(null);
  const string = useRef<SVGPathElement>(null);
  const gate1 = useRef<SVGCircleElement>(null);
  const gate2 = useRef<SVGCircleElement>(null);
  const place = (d: number) => {
    const x = X0 + d * K;
    trolley.current?.setAttribute("transform", `translate(${x.toFixed(1)} 0)`);
    const hy = TRACK_Y + 20 + d * K * 0.12;
    hanger.current?.setAttribute("transform", `translate(0 ${hy.toFixed(1)})`);
    string.current?.setAttribute("d", `M${x.toFixed(1)} ${TRACK_Y - 18} L${PULLEY.x} ${PULLEY.y - 10} M${PULLEY.x + 10} ${PULLEY.y} L${PULLEY.x + 10} ${hy.toFixed(1)}`);
    gate1.current?.setAttribute("fill", Math.abs(x - (X0 + setup.startToGate1M * K)) < TROLLEY_W / 2 + 4 ? V3.red : "#4b5671");
    gate2.current?.setAttribute("fill", Math.abs(x - (X0 + (setup.startToGate1M + setup.gateGapM) * K)) < TROLLEY_W / 2 + 4 ? V3.red : "#4b5671");
  };
  const runCount = useRef(s.runs.length);
  const [nudge, setNudge] = useState(0);
  useLayoutEffect(() => {
    const fresh = s.runs.length > runCount.current;
    runCount.current = s.runs.length;
    if (!fresh || !last || last.a <= 0 || reduced) {
      place(fresh && last && last.a > 0 ? RUN_M : 0);
      return;
    }
    const dur = Math.sqrt((2 * RUN_M) / last.a);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(dur, (now - t0) / 1000);
      place(0.5 * last.a * t * t);
      if (t < dur) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [s.runs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // a nudge: slows, rolls steadily or speeds up depending on the slope
  useEffect(() => {
    if (!nudge || reduced) return;
    const t0 = performance.now();
    let raf = 0;
    const a = setup.g * residual * 0.6; // the trolley alone on the slope
    const tick = (now: number) => {
      const t = Math.min(2, (now - t0) / 1000);
      const v0 = 0.12;
      const tStop = a < 0 ? Math.min(t, v0 / -a) : t;
      place(Math.max(0, Math.min(0.5, v0 * tStop + 0.5 * a * tStop * tStop)));
      if (t < 2) raf = requestAnimationFrame(tick);
      else place(0);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [nudge]); // eslint-disable-line react-hooks/exhaustive-deps
  // moving masses or tilting puts the trolley back on the start line
  useLayoutEffect(() => {
    place(0);
  }, [s.onHanger, s.onTrolley, s.tiltDeg]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const e = session.events[session.events.length - 1];
    if (e && paramOf(e, "nudge") !== undefined) setNudge((n) => n + 1);
  }, [session.events.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------------------------------------------- actions */
  const dispatchParam = (key: string, value: number | string | boolean) => !ro && session.dispatch("param.set", { key, value });
  const release = () => !ro && session.dispatch("sim.start", {} as Record<string, never>);
  const points = Object.values(s.points).sort((a, b) => a.F - b.F);
  const grad = gradientThroughOrigin(points.map((p) => ({ x: p.F, y: p.a })));
  const u1 = last && last.t1 ? setup.cardM / last.t1 : null;
  const u2 = last && last.t2 ? setup.cardM / last.t2 : null;

  /* ---------------------------------------------------------------- demo hand */
  let hand: Pt | null = null;
  if (demo.next?.type === "sim.start") hand = { x: X0 + 10, y: TRACK_Y - 40 };
  else if (paramOf(demo.next, "move") !== undefined) hand = { x: X0 + 30, y: TRACK_Y - 46 };
  else if (paramOf(demo.next, "nudge") !== undefined) hand = { x: X0 - 26, y: TRACK_Y - 26 };

  const tiltVis = s.tiltDeg * TILT_VIS;
  const g1x = X0 + setup.startToGate1M * K;
  const g2x = X0 + (setup.startToGate1M + setup.gateGapM) * K;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_340px]">
      <LabStyles />
      <div className="flex min-h-0 flex-col gap-3">
        <Stage className="min-h-[300px]" label={s.compensated ? "Friction compensated" : "Tilt the runway until a nudge rolls steadily"}>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full select-none" role="img" aria-label={`Trolley runway tilted ${s.tiltDeg.toFixed(1)} degrees, ${s.onTrolley} masses on the trolley, ${s.onHanger} on the hanger. Pulling force ${masses.hang * setup.g} newtons.`}>
            {/* floor and bench */}
            <rect x={0} y={TRACK_Y + 26} width={PULLEY.x + 30} height={14} fill="#2b3142" />
            <rect x={0} y={H - 18} width={W} height={18} fill="#1b2232" />
            <g transform={`rotate(${tiltVis} ${PULLEY.x} ${TRACK_Y})`}>
              {/* runway */}
              <rect x={X0 - 40} y={TRACK_Y} width={PULLEY.x - X0 + 40} height={10} rx={2} fill="#8794ad" />
              <line x1={X0} y1={TRACK_Y - 30} x2={X0} y2={TRACK_Y} stroke={V3.mint} strokeDasharray="3 3" />
              <text x={X0} y={TRACK_Y + 24} fontSize={10} textAnchor="middle" fill={V3.mint}>start</text>
              {/* light gates */}
              {[g1x, g2x].map((x, i) => (
                <g key={x}>
                  <rect x={x - 6} y={TRACK_Y - 64} width={12} height={64} rx={2} fill="none" stroke="#9aa3b2" strokeWidth={2} />
                  <circle ref={i === 0 ? gate1 : gate2} cx={x} cy={TRACK_Y - 58} r={4} fill="#4b5671" />
                  <line x1={x} y1={TRACK_Y - 54} x2={x} y2={TRACK_Y} stroke="rgba(255,91,107,.35)" strokeDasharray="2 3" />
                  <text x={x} y={TRACK_Y - 70} fontSize={10} textAnchor="middle" fill={V3.muted}>gate {i + 1}</text>
                </g>
              ))}
              {/* trolley */}
              <g ref={trolley} transform={`translate(${X0} 0)`}>
                <rect x={-TROLLEY_W} y={TRACK_Y - 26} width={TROLLEY_W} height={18} rx={4} fill={V3.blue} />
                <rect x={-TROLLEY_W / 2 - 2} y={TRACK_Y - 50} width={4} height={24} fill="#ffd166" />
                {Array.from({ length: s.onTrolley }, (_, i) => (
                  <rect key={i} x={-TROLLEY_W + 6 + i * 13} y={TRACK_Y - 36} width={10} height={10} rx={2} fill="#c9ccd2" stroke="#5b6680" />
                ))}
                {[-TROLLEY_W + 12, -12].map((x) => (
                  <circle key={x} cx={x} cy={TRACK_Y - 5} r={5} fill="#1f2937" stroke="#9aa3b2" />
                ))}
              </g>
              {/* pulley */}
              <circle cx={PULLEY.x} cy={PULLEY.y} r={10} fill="#5b6680" stroke="#c9ccd2" strokeWidth={2} />
            </g>
            <path ref={string} d="" stroke="#e8f0ff" strokeWidth={1.2} fill="none" />
            {/* hanger */}
            <g ref={hanger} transform={`translate(0 ${TRACK_Y + 20})`}>
              <rect x={PULLEY.x + 4} y={0} width={12} height={6} fill="#c9ccd2" />
              {Array.from({ length: s.onHanger }, (_, i) => (
                <rect key={i} x={PULLEY.x - 2} y={6 + i * 7} width={24} height={6} rx={2} fill="#c9ccd2" stroke="#5b6680" />
              ))}
              <rect x={PULLEY.x - 4} y={6 + s.onHanger * 7} width={28} height={4} fill="#8794ad" />
            </g>
            {/* spare masses */}
            <g>
              <rect x={20} y={H - 54} width={80} height={34} rx={4} fill="#3a2f12" stroke="#7a6230" />
              {Array.from({ length: s.inBox }, (_, i) => (
                <rect key={i} x={28 + i * 22} y={H - 46} width={16} height={8} rx={2} fill="#c9ccd2" />
              ))}
              <text x={60} y={H - 24} fontSize={9} textAnchor="middle" fill="#e2d3a4">spare box</text>
            </g>
            {focus === "compensate" && !ro && <Tag x={X0 + 40} y={TRACK_Y - 96} text="Tilt, then nudge" />}
            <GhostHand at={hand} pressing={demo.k > 0.7} />
          </svg>
        </Stage>
        <div className="grid gap-3 md:grid-cols-2">
          <Panel title="Runway" glow={!ro && focus === "compensate"}>
            <ParamSlider guideId="param:tilt" label="Tilt" value={s.tiltDeg} min={0} max={2} step={0.1} unit="°" disabled={ro} onCommit={(v) => dispatchParam("tilt", v)} format={(v) => v.toFixed(1)} />
            <div className="mt-2 flex items-center gap-2">
              <Btn onClick={() => dispatchParam("nudge", true)} disabled={ro}>
                <Hand className="h-4 w-4" /> Nudge
              </Btn>
              <Readout label="Friction" value={s.compensated ? "cancelled" : "not yet"} tone={s.compensated ? "good" : "warn"} />
            </div>
            <p className="mt-2 text-[11px] text-[#8fa6d1]">A gentle push should make the trolley roll at a steady speed on its own.</p>
          </Panel>
          <Panel title="Masses (20 g each)" glow={!ro && (focus === "five-forces" || focus === "first-run")}>
            <div className="grid grid-cols-3 gap-2">
              <Readout label="On trolley" value={String(s.onTrolley)} />
              <Readout label="On hanger" value={String(s.onHanger)} />
              <Readout label="Total mass" value={masses.total.toFixed(2)} unit="kg" tone={Math.abs(masses.total - (setup.trolleyKg + setup.hangerKg + setup.slots * setup.slotKg)) < 1e-9 ? "good" : "warn"} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Btn onClick={() => dispatchParam("move", "to-hanger")} disabled={ro || s.onTrolley === 0}>
                Trolley <ArrowLeftRight className="h-3.5 w-3.5" /> hanger
              </Btn>
              <Btn onClick={() => dispatchParam("move", "to-trolley")} disabled={ro || s.onHanger === 0}>
                Back to trolley
              </Btn>
              <Btn tone="ghost" onClick={() => dispatchParam("move", "box-to-hanger")} disabled={ro || s.inBox === 0}>
                Box → hanger
              </Btn>
              <Btn tone="ghost" onClick={() => dispatchParam("move", "hanger-to-box")} disabled={ro || s.onHanger === 0}>
                Hanger → box
              </Btn>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Readout label="Pulling force F" value={sf(preview.F, 3)} unit="N" />
              <Btn tone="primary" className="flex-1" onClick={release} disabled={ro}>
                <Play className="h-4 w-4" /> Release
              </Btn>
            </div>
          </Panel>
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Light-gate logger" glow={!ro && (focus === "first-run" || focus === "five-forces") && !!last}>
          {last && last.a > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Readout label="Card time, gate 1" value={last.t1.toFixed(3)} unit="s" />
                <Readout label="Card time, gate 2" value={last.t2.toFixed(3)} unit="s" />
                <Readout label="v₁ = card ÷ t" value={u1 ? u1.toFixed(3) : "–"} unit="m/s" />
                <Readout label="v₂ = card ÷ t" value={u2 ? u2.toFixed(3) : "–"} unit="m/s" />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Readout label="a = (v₂² − v₁²) ÷ 2s" value={last.aLogger.toFixed(3)} unit="m/s²" tone="good" />
                <Readout label="Gate gap s" value={setup.gateGapM.toFixed(2)} unit="m" />
              </div>
            </>
          ) : (
            <p className="text-sm text-[#8fa6d1]">Release the trolley to time the 10 cm card through both gates.</p>
          )}
          <div className="mt-2">
            <ReadingInput label="Acceleration a" unit="m/s²" disabled={ro || !last} onRecord={(v) => session.dispatch("measure.read", { instrument: "light-gates", reading: { key: "a", value: v, unit: "m/s²" } })} value={submitted(session.events, "a", "light-gates")} />
          </div>
        </Panel>
        <Panel title={`a against F (${points.length} forces)`} glow={!ro && focus === "result"}>
          {points.length > 0 && (
            <table className="mb-2 w-full text-xs">
              <thead className="text-[#8fa6d1]">
                <tr>
                  <th className="text-left font-semibold">F / N</th>
                  <th className="text-right font-semibold">a / m s⁻²</th>
                </tr>
              </thead>
              <tbody className="font-mono text-white/85">
                {points.map((p) => (
                  <tr key={p.F}>
                    <td>{p.F.toFixed(3)}</td>
                    <td className="text-right">{p.a.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <LiveGraph series={[{ label: "a against F", colour: V3.cyan, mode: "scatter", points: points.map((p) => ({ x: p.F, y: p.a })) }]} xLabel="F / N" yLabel="a / m s⁻²" height={140} fitOrigin />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Readout label="Gradient (1/m)" value={grad ? sf(grad, 3) : "–"} unit="kg⁻¹" />
            <Readout label="1 ÷ gradient" value={grad ? sf(1 / grad, 3) : "–"} unit="kg" />
          </div>
          <div className="mt-2">
            <ReadingInput label="Mass being accelerated, m" unit="kg" disabled={ro || points.length < 2} onRecord={(v) => session.dispatch("param.set", { key: "result:m", value: v })} value={submitted(session.events, "result:m")} />
          </div>
          <p className="mt-2 text-[11px] text-[#8fa6d1]">Keep your feet clear: catch the trolley before the end and do not let masses drop on the floor.</p>
        </Panel>
      </div>
    </div>
  );
}
