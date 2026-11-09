import { useReducedMotion } from "framer-motion";
import { RotateCcw, Timer } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { pendulumStep } from "../core/mechanics";
import { FixedClock, rad } from "../core/runtime";
import type { PendulumSetup, PendulumState } from "../labs/mechanics";
import { gFromPeriods } from "../labs/mechanics";
import { DragHandle, easeInOut, GhostHand, LabStyles, mix, paramOf, Stage, Tag, useCommitLater, useDemoPreview, useFocusStep, V3, type Pt } from "./interact";
import { Btn, LiveGraph, Panel, ReadingInput, Readout, sf } from "./kit";
import { submitted } from "./guide";
import type { SimSession } from "./useSimSession";

const W = 420;
const H = 470;
const PX = W / 2 - 30;
const PY = 44;
const K = 300; // px per metre

/**
 * Simple pendulum. Pull the bob out and let go to release it (the angle you let go at is the
 * amplitude); click it to catch it. Drag the clamp on the rule to change the length. The swing is a
 * real nonlinear RK4 integration drawn straight onto the SVG each frame.
 */
export function PendulumWorkspace({ session }: { session: SimSession<PendulumState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as PendulumSetup;
  const reduced = useReducedMotion();
  const ro = session.readOnly;
  const focus = useFocusStep(session);
  const demo = useDemoPreview(session);

  /* ---------------------------------------------------------------- local drags */
  const [pull, setPull] = useState<number | null>(null); // signed degrees while dragging the bob
  const [lenLocal, setLenLocal] = useState<number | null>(null);
  const [ampLocal, setAmpLocal] = useState<number | null>(null);
  const commitAmp = useCommitLater((a: number) => {
    if (a !== s.amplitude) session.dispatch("param.set", { key: "amplitude", value: a });
    setAmpLocal(null);
  }, 450);
  const commitLen = useCommitLater((l: number) => {
    if (Math.abs(l - s.stringM) > 1e-9) session.dispatch("param.set", { key: "length", value: l });
    setLenLocal(null);
  }, 450);

  // Demo: ease toward the next length / amplitude before it fires.
  const nLen = paramOf(demo.next, "length");
  const nAmp = paramOf(demo.next, "amplitude");
  const kk = easeInOut(Math.max(0, (demo.k - 0.35) / 0.65));
  const stringM = lenLocal ?? (typeof nLen === "number" ? mix(s.stringM, nLen, kk) : s.stringM);
  const amplitude = ampLocal ?? (pull !== null ? Math.abs(pull) : typeof nAmp === "number" ? mix(s.amplitude, nAmp, kk) : s.amplitude);
  const L = stringM + setup.bobRadiusM;
  const bobR = Math.max(7, setup.bobRadiusM * K);
  const restSide = pull !== null && pull < 0 ? -1 : 1;
  const restTheta = rad(amplitude) * restSide;

  /* ---------------------------------------------------------------- swing on refs */
  const string = useRef<SVGLineElement>(null);
  const bob = useRef<SVGGElement>(null);
  const flash = useRef<SVGPathElement>(null);
  const passText = useRef<SVGTextElement>(null);
  const passes = useRef(0);
  const passAtStart = useRef(0);
  const place = (th: number) => {
    const bx = PX + Math.sin(th) * L * K;
    const by = PY + Math.cos(th) * L * K;
    string.current?.setAttribute("x2", bx.toFixed(2));
    string.current?.setAttribute("y2", by.toFixed(2));
    bob.current?.setAttribute("transform", `translate(${bx.toFixed(2)} ${by.toFixed(2)})`);
  };
  useLayoutEffect(() => {
    passes.current = 0;
    if (!s.released) {
      place(restTheta);
      return;
    }
    let st: [number, number] = [rad(s.amplitude), 0];
    place(st[0]);
    const clock = new FixedClock();
    let last = performance.now();
    let raf = 0;
    let flashUntil = 0;
    const tick = (now: number) => {
      clock.advance(Math.min(0.1, (now - last) / 1000), (h) => {
        const prev = st[0];
        st = pendulumStep(st, L, setup.g, h);
        if (prev > 0 && st[0] <= 0) {
          passes.current++;
          flashUntil = now + 160;
        }
      });
      last = now;
      place(st[0]);
      flash.current?.setAttribute("opacity", now < flashUntil ? "1" : "0.25");
      if (passText.current) passText.current.textContent = String(passes.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [s.released, s.amplitude, L, setup.g]); // eslint-disable-line react-hooks/exhaustive-deps
  // at rest the bob follows drags and demo easing
  useLayoutEffect(() => {
    if (!s.released) place(restTheta);
  });

  /* ---------------------------------------------------------------- stopwatch (refs, not renders) */
  const [sw, setSw] = useState<{ running: boolean; start: number; elapsed: number }>({ running: false, start: 0, elapsed: 0 });
  const digits = useRef<HTMLSpanElement>(null);
  const oscOut = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!sw.running) {
      if (digits.current) digits.current.textContent = sw.elapsed.toFixed(2);
      return;
    }
    let raf = 0;
    const tick = () => {
      if (digits.current) digits.current.textContent = ((performance.now() - sw.start) / 1000).toFixed(2);
      if (oscOut.current) oscOut.current.textContent = String(Math.max(0, passes.current - passAtStart.current));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sw]);
  const [n, setN] = useState(20);
  const startStop = () => {
    if (sw.running) setSw({ running: false, start: 0, elapsed: (performance.now() - sw.start) / 1000 });
    else {
      passAtStart.current = passes.current;
      setSw({ running: true, start: performance.now(), elapsed: 0 });
    }
  };

  /* ---------------------------------------------------------------- actions */
  const release = () => !ro && !s.released && session.dispatch("sim.start", {} as Record<string, never>);
  const catchBob = () => !ro && s.released && session.dispatch("sim.reset", {} as Record<string, never>);
  const points = Object.entries(s.periods).map(([key, T]) => ({ L: Number(key) + setup.bobRadiusM, T }));
  const gEst = gFromPeriods(points);

  const restBob = { x: PX + Math.sin(restTheta) * L * K, y: PY + Math.cos(restTheta) * L * K };
  const ruleX = PX + 120;
  const clampY = PY + (stringM + setup.bobRadiusM) * K;

  /* ---------------------------------------------------------------- guidance + demo hand */
  const bobPulse = !ro && !s.released && pull === null && focus === "release";
  const lenPulse = !ro && !s.released && focus === "five-lengths";
  let hand: Pt | null = null;
  let pressing = false;
  let follow = false;
  if (demo.next && nAmp !== undefined) {
    hand = restBob;
    pressing = demo.k > 0.3;
    follow = demo.k > 0.35;
  } else if (demo.next && nLen !== undefined) {
    hand = { x: ruleX + 22, y: clampY };
    pressing = demo.k > 0.3;
    follow = demo.k > 0.35;
  } else if (demo.next?.type === "sim.start" || demo.next?.type === "sim.reset") {
    hand = demo.next.type === "sim.start" ? restBob : { x: PX, y: PY + L * K };
    pressing = demo.k > 0.7;
  } else if (demo.last && demo.since < 450 && (demo.last.type === "sim.start" || paramOf(demo.last, "amplitude") !== undefined)) hand = restBob;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_330px]">
      <LabStyles />
      <div className="grid min-h-0 gap-3 md:grid-cols-[minmax(0,1fr)_210px]">
        <Stage className="min-h-[340px]" label={s.released ? "Swinging · click the bob to catch it" : "Pull the bob out and let go"}>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full select-none" role="group" aria-label={`Pendulum, length ${L.toFixed(3)} m, ${s.released ? "swinging" : "at rest"}`}>
            <defs>
              <radialGradient id="pd-bob" cx="35%" cy="30%">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="0.45" stopColor="#c9d3e6" />
                <stop offset="1" stopColor="#5b6680" />
              </radialGradient>
              <linearGradient id="pd-rule" x1="0" x2="1">
                <stop offset="0" stopColor="#f6eccb" />
                <stop offset="1" stopColor="#e2d3a4" />
              </linearGradient>
            </defs>
            {/* stand and clamp */}
            <rect x={PX - 110} y={PY - 22} width={260} height={14} rx={5} fill="#2b3142" stroke="#5b6680" />
            <rect x={PX - 10} y={PY - 10} width={20} height={12} rx={2} fill="#8794ad" />
            {/* metre rule */}
            <g>
              <rect x={ruleX} y={PY} width={28} height={1.3 * K} rx={2} fill="url(#pd-rule)" />
              {Array.from({ length: 131 }, (_, i) => (
                <line key={i} x1={ruleX} y1={PY + i * 0.01 * K} x2={ruleX + (i % 10 === 0 ? 14 : i % 5 === 0 ? 10 : 6)} y2={PY + i * 0.01 * K} stroke="#3a2f12" strokeWidth={i % 10 === 0 ? 1 : 0.5} />
              ))}
              {Array.from({ length: 14 }, (_, i) => (
                <text key={i} x={ruleX + 26} y={PY + i * 0.1 * K + 3} fontSize={7.5} textAnchor="end" fill="#3a2f12" fontFamily="JetBrains Mono, monospace">
                  {i * 10}
                </text>
              ))}
            </g>
            {/* centre line and timing fiducial */}
            <line x1={PX} y1={PY} x2={PX} y2={PY + L * K + bobR + 26} stroke="rgba(160,190,255,.14)" strokeDasharray="4 5" />
            <path ref={flash} d={`M${PX - 7} ${PY + L * K + bobR + 30} l7 -9 l7 9 z`} fill={V3.mint} opacity={0.25} />
            {/* amplitude arc */}
            {(!s.released || pull !== null) && (
              <g pointerEvents="none">
                <path d={`M${PX} ${PY + 70} A70 70 0 0 ${restSide > 0 ? 0 : 1} ${PX + Math.sin(restTheta) * 70} ${PY + Math.cos(restTheta) * 70}`} fill="none" stroke={amplitude > 10 ? V3.amber : V3.mint} strokeWidth={2} />
                <text x={PX + restSide * 22} y={PY + 92} fontSize={12} fontWeight={800} textAnchor="middle" fill={amplitude > 10 ? V3.amber : V3.mint} fontFamily="JetBrains Mono, monospace">
                  {Math.round(amplitude)}°
                </text>
                {/* 10 degree guide */}
                {[1, -1].map((sd) => (
                  <line key={sd} x1={PX} y1={PY} x2={PX + Math.sin(rad(10)) * sd * L * K} y2={PY + Math.cos(rad(10)) * L * K} stroke="rgba(61,232,168,.18)" strokeDasharray="2 5" />
                ))}
              </g>
            )}
            <line ref={string} x1={PX} y1={PY} x2={s.released ? undefined : restBob.x} y2={s.released ? undefined : restBob.y} stroke="#e8f0ff" strokeWidth={1.3} />
            <circle cx={PX} cy={PY} r={3.5} fill="#e8f0ff" />
            <DragHandle
              label={s.released ? "Bob, swinging. Press Enter to catch it." : "Bob. Drag it sideways and let go to release, or use left and right arrows to set the angle and Enter to release."}
              valueText={`${Math.round(amplitude)} degrees`}
              value={amplitude}
              min={2}
              max={45}
              disabled={ro}
              ring={s.released ? undefined : { cx: restBob.x, cy: restBob.y, r: bobR + 4 }}
              pulse={bobPulse}
              onDrag={(p) => {
                if (s.released) return;
                const a = (Math.atan2(p.x - PX, p.y - PY) * 180) / Math.PI;
                const m = Math.max(2, Math.min(45, Math.round(Math.abs(a))));
                setPull(a < 0 ? -m : m);
              }}
              onDragEnd={(_p, moved) => {
                if (s.released || !moved || pull === null) return;
                const a = Math.abs(pull);
                if (a !== s.amplitude) session.dispatch("param.set", { key: "amplitude", value: a });
                session.dispatch("sim.start", {} as Record<string, never>);
                setPull(null);
              }}
              onActivate={() => (s.released ? catchBob() : release())}
              onKey={(key, shift) => {
                if (s.released) return false;
                const st = shift ? 5 : 1;
                const cur = ampLocal ?? s.amplitude;
                const next = key === "ArrowRight" || key === "ArrowUp" ? Math.min(45, cur + st) : key === "ArrowLeft" || key === "ArrowDown" ? Math.max(2, cur - st) : null;
                if (next === null) return false;
                setAmpLocal(next);
                commitAmp(next);
                return true;
              }}
            >
              <g ref={bob} transform={s.released ? undefined : `translate(${restBob.x} ${restBob.y})`}>
                <circle r={bobR + 14} fill="transparent" />
                <circle r={bobR} fill="url(#pd-bob)" stroke="#2b3142" strokeWidth={1.2} />
                <circle r={1.6} fill="#2b3142" />
              </g>
            </DragHandle>
            {bobPulse && <Tag x={restBob.x + 70} y={restBob.y} text="Pull to under 10°, let go" />}
            {/* length clamp on the rule */}
            {!s.released && (
              <DragHandle
                label="String length clamp. Drag up or down, or use the arrow keys."
                valueText={`string ${stringM.toFixed(2)} metres`}
                value={stringM}
                min={0.2}
                max={1.2}
                disabled={ro}
                ring={{ cx: ruleX + 44, cy: clampY, r: 9 }}
                pulse={lenPulse}
                onDrag={(p) => setLenLocal(Math.max(0.2, Math.min(1.2, Math.round(((p.y - PY) / K - setup.bobRadiusM) * 20) / 20)))}
                onDragEnd={() => {
                  if (lenLocal !== null && Math.abs(lenLocal - s.stringM) > 1e-9) session.dispatch("param.set", { key: "length", value: lenLocal });
                  setLenLocal(null);
                }}
                onKey={(key, shift) => {
                  const st = shift ? 0.1 : 0.05;
                  const cur = lenLocal ?? s.stringM;
                  const next = key === "ArrowDown" || key === "ArrowRight" ? Math.min(1.2, cur + st) : key === "ArrowUp" || key === "ArrowLeft" ? Math.max(0.2, cur - st) : null;
                  if (next === null) return false;
                  const v = Math.round(next * 20) / 20;
                  setLenLocal(v);
                  commitLen(v);
                  return true;
                }}
              >
                <rect x={ruleX + 30} y={clampY - 11} width={56} height={22} rx={8} fill="#0b1730" stroke={lenLocal !== null ? V3.cyan : "rgba(140,180,255,.5)"} />
                <path d={`M${ruleX + 30} ${clampY} l-6 -5 v10 z`} fill={lenLocal !== null ? V3.cyan : "rgba(140,180,255,.7)"} />
                <text x={ruleX + 58} y={clampY + 4} fontSize={10.5} fontWeight={700} textAnchor="middle" fill="#fff" fontFamily="JetBrains Mono, monospace">
                  ↕ {stringM.toFixed(2)}
                </text>
              </DragHandle>
            )}
            <text x={PX - 100} y={H - 14} fontSize={11} fill="rgba(200,215,245,.6)">
              oscillations: <tspan ref={passText} fontWeight={700} fill="#fff">0</tspan>
            </text>
            <GhostHand at={hand} pressing={pressing} follow={follow} />
          </svg>
          {reduced && s.released && <div className="pointer-events-none absolute bottom-3 right-3 text-[11px] text-white/60">Swinging in real time (needed for timing).</div>}
        </Stage>
        <Panel title="Ruler lens (at the bob)" glow={!ro && focus === "measure-L"}>
          <RulerLens stringM={stringM} bobR={setup.bobRadiusM} />
          <p className="mt-2 text-[11px] text-[#8fa6d1]">Measure from the pivot to the bob's centre.</p>
          <div className="mt-2">
            <ReadingInput label="Length L" unit="m" onRecord={(v) => session.dispatch("measure.read", { instrument: "metre-rule", reading: { key: "L", value: v, unit: "m" } })} value={submitted(session.events, "L", "metre-rule")} disabled={ro} width="w-20" />
          </div>
        </Panel>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Stopwatch" glow={!ro && focus === "time-20"}>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={startStop}
              disabled={ro || (!sw.running && !s.released)}
              aria-label={sw.running ? "Stop the stopwatch" : "Start the stopwatch"}
              className={`grid h-[74px] w-[74px] shrink-0 place-items-center rounded-full border-2 font-semibold transition active:scale-95 disabled:opacity-40 ${sw.running ? "border-[#ff8a96] bg-[radial-gradient(circle_at_35%_30%,#ff8a96,#c92a3e)] text-white shadow-[0_0_24px_-4px_rgba(255,91,107,.8)]" : "border-[#6aa8ff] bg-[radial-gradient(circle_at_35%_30%,#6aa8ff,#1d5fe0)] text-white shadow-[0_0_24px_-6px_rgba(61,139,255,.9)]"}`}
            >
              <span className="flex flex-col items-center text-[11px] uppercase tracking-wider">
                <Timer className="mb-0.5 h-5 w-5" />
                {sw.running ? "Stop" : "Start"}
              </span>
            </button>
            <div>
              <div className="font-mono text-[34px] font-bold leading-none tabular-nums text-white" aria-live="off">
                <span ref={digits}>{sw.elapsed.toFixed(2)}</span>
                <span className="text-base text-white/45"> s</span>
              </div>
              <div className="mt-1 text-xs text-[#8fa6d1]">
                counted: <span ref={oscOut}>0</span> oscillations
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-end gap-2">
            <label className="text-[11px] font-semibold text-[#c8d6f3]">
              Oscillations timed
              <input type="number" min={1} max={50} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value)))} className="mt-0.5 block h-10 w-16 rounded-[11px] border border-[rgba(140,180,255,.16)] bg-[#040a1c]/60 px-2 font-mono text-sm text-white" />
            </label>
            <Btn tone="primary" className="flex-1" onClick={() => session.dispatch("measure.read", { instrument: "stopwatch", reading: { key: `t:${n}`, value: Number(sw.elapsed.toFixed(2)), unit: "s" } })} disabled={ro || sw.running || sw.elapsed === 0}>
              Record {sw.elapsed.toFixed(2)} s
            </Btn>
            <Btn onClick={() => setSw({ running: false, start: 0, elapsed: 0 })} disabled={sw.running || sw.elapsed === 0} title="Reset the stopwatch">
              <RotateCcw className="h-4 w-4" />
            </Btn>
          </div>
          <p className="mt-2 text-[11px] text-[#8fa6d1]">Start and stop as the bob passes the green marker.</p>
        </Panel>
        <Panel title="Set up">
          <div className="grid grid-cols-2 gap-2">
            <Readout label="String" value={stringM.toFixed(2)} unit="m" />
            <Readout label="Release angle" value={String(Math.round(amplitude))} unit="°" tone={amplitude > 10 ? "warn" : "good"} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Btn tone="primary" onClick={release} disabled={ro || s.released}>
              Release
            </Btn>
            <Btn onClick={catchBob} disabled={ro || !s.released}>
              Catch the bob
            </Btn>
          </div>
        </Panel>
        <Panel title={`Results (${points.length} lengths)`} glow={!ro && focus === "result"}>
          {points.length > 0 && (
            <table className="mb-2 w-full text-xs">
              <thead className="text-[#8fa6d1]">
                <tr>
                  <th className="text-left font-semibold">L / m</th>
                  <th className="text-right font-semibold">T / s</th>
                  <th className="text-right font-semibold">T² / s²</th>
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
          <LiveGraph series={[{ label: "T² against L", colour: V3.cyan, mode: "scatter", points: points.map((p) => ({ x: p.L, y: p.T * p.T })) }]} xLabel="L / m" yLabel="T² / s²" height={140} fitOrigin />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Readout label="4π² ÷ gradient" value={gEst ? sf(gEst, 4) : "–"} unit="m/s²" />
          </div>
          <div className="mt-2">
            <ReadingInput label="Your value of g" unit="m/s²" onRecord={(v) => session.dispatch("param.set", { key: "result:g", value: v })} value={submitted(session.events, "result:g")} disabled={ro || points.length < 2} />
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
    <svg viewBox={`0 0 170 ${h}`} className="h-[250px] w-full rounded-[12px] bg-[#060d1f]" role="img" aria-label="Magnified ruler around the bob">
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
