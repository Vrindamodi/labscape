import { useReducedMotion } from "framer-motion";
import { Rocket, Wind } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PLANETS, simulateFlight, type Planet } from "../core/mechanics";
import type { ProjectileSetup, ProjectileState } from "../labs/mechanics";
import { DragHandle, easeInOut, GhostHand, LabStyles, mix, Num, paramOf, Stage, Tag, useCommitLater, useDemoPreview, useFocusStep, V3, type Pt } from "./interact";
import { Btn, LiveGraph, Panel, ParamSlider, ReadingInput, Readout, sf } from "./kit";
import { submitted } from "./guide";
import type { SimSession } from "./useSimSession";

const COLOURS = ["#39d6ff", "#ffc23d", "#ff8a96", "#a98bff", "#3de8a8", "#ffa94d"];
const GROUND: Record<Planet, [string, string]> = { earth: ["#1f5a3a", "#123722"], moon: ["#5c6270", "#3a3f4a"], mars: ["#8a4026", "#5a2716"], jupiter: ["#8a6a42", "#5c4428"] };

const W = 820;
const H = 400;
const L = 64;
const GROUND_Y = H - 46;
/** Aim handle distance from the pivot for a launch speed (px). */
const reach = (speed: number) => 46 + speed * 4.2;
const speedOf = (dist: number) => Math.max(5, Math.min(30, Math.round(((dist - 46) / 4.2) * 2) / 2));

/**
 * Projectile range. Grab the aim handle at the end of the power arrow: its direction is the launch
 * angle and its length the speed; a ghost arc previews the climb. Launch, then pull the tape out to
 * the landing mark. Flights animate on refs (no per-frame React renders).
 */
export function ProjectileWorkspace({ session }: { session: SimSession<ProjectileState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as ProjectileSetup;
  const reduced = useReducedMotion();
  const ro = session.readOnly;
  const focus = useFocusStep(session);
  const demo = useDemoPreview(session);
  const launches = s.launches;
  const last = launches[launches.length - 1];
  const g = PLANETS[s.planet].g;

  /* ---------------------------------------------------------------- aim (local while dragging) */
  const [aim, setAim] = useState<{ speed: number; angle: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const commit = (a: { speed: number; angle: number }) => {
    if (a.speed !== s.speed) session.dispatch("param.set", { key: "speed", value: a.speed });
    if (a.angle !== s.angle) session.dispatch("param.set", { key: "angle", value: a.angle });
    setAim(null);
  };
  const commitLater = useCommitLater(commit, 450);

  // Demo: glide toward the next speed / angle before it lands, so the barrel swings instead of jumping.
  const nextSpeed = paramOf(demo.next, "speed");
  const nextAngle = paramOf(demo.next, "angle");
  const kk = easeInOut(Math.max(0, (demo.k - 0.35) / 0.65));
  const speed = aim?.speed ?? (typeof nextSpeed === "number" ? mix(s.speed, nextSpeed, kk) : s.speed);
  const angle = aim?.angle ?? (typeof nextAngle === "number" ? mix(s.angle, nextAngle, kk) : s.angle);

  /* ---------------------------------------------------------------- world -> screen */
  const maxX = Math.max(setup.targetM * 1.3, ...launches.map((l) => l.range), 10);
  const maxY = Math.max(maxX * 0.42, ...launches.map((l) => l.maxHeight * 1.15));
  const k = Math.min((W - L - 30) / maxX, (GROUND_Y - 34) / maxY);
  const X = (x: number) => L + x * k;
  const Y = (y: number) => GROUND_Y - y * k;
  const pivot = { x: X(0), y: GROUND_Y - 6 };
  const rad = (angle * Math.PI) / 180;
  const handle = { x: pivot.x + Math.cos(rad) * reach(speed), y: pivot.y - Math.sin(rad) * reach(speed) };

  const pathOf = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join("");
  const ghosts = useMemo(() => launches.slice(0, -1).map((l) => simulateFlight({ speed: l.speed, angleDeg: l.angle, g: PLANETS[l.planet].g, drag: l.drag })), [launches]);
  const flight = useMemo(() => (last ? simulateFlight({ speed: last.speed, angleDeg: last.angle, g: PLANETS[last.planet].g, drag: last.drag }) : null), [last]);
  // predicted climb (to the apex only, so the target still has to be found)
  const preview = useMemo(() => {
    const f = simulateFlight({ speed, angleDeg: angle, g, drag: s.drag });
    const apex = f.points.reduce((a, p) => (p.y > a.y ? p : a), f.points[0]!);
    return f.points.filter((p) => p.t <= apex.t * 1.08);
  }, [speed, angle, g, s.drag]);

  /* ---------------------------------------------------------------- flight animation on refs */
  const ball = useRef<SVGGElement>(null);
  const vline = useRef<SVGLineElement>(null);
  const trail = useRef<SVGPathElement>(null);
  const [phase, setPhase] = useState<"idle" | "flying" | "landed">(last ? "landed" : "idle");
  const [apexShown, setApexShown] = useState(!!last);
  const [graphT, setGraphT] = useState(last ? Infinity : 0);
  const [recoil, setRecoil] = useState(0);
  const seenLaunches = useRef(launches.length);
  useLayoutEffect(() => {
    if (!flight || !last) {
      // Undo can take the launches back to none: the next launch must still fly.
      seenLaunches.current = launches.length;
      setPhase("idle");
      return;
    }
    const fresh = launches.length > seenLaunches.current;
    seenLaunches.current = launches.length;
    const apex = flight.points.reduce((a, p) => (p.y > a.y ? p : a), flight.points[0]!);
    const place = (t: number) => {
      let i = 0;
      while (i < flight.points.length - 1 && flight.points[i + 1]!.t <= t) i++;
      const p = flight.points[i]!;
      ball.current?.setAttribute("transform", `translate(${X(p.x)} ${Y(p.y)})`);
      vline.current?.setAttribute("x2", String(p.vx * 2.2));
      vline.current?.setAttribute("y2", String(-p.vy * 2.2));
      trail.current?.setAttribute("d", pathOf(flight.points.slice(0, i + 1)));
      return p;
    };
    if (!fresh || reduced) {
      place(flight.time);
      setPhase("landed");
      setApexShown(true);
      setGraphT(Infinity);
      return;
    }
    setPhase("flying");
    setApexShown(false);
    setRecoil((r) => r + 1);
    const t0 = performance.now();
    const rate = Math.max(1, flight.time / 2.6);
    let raf = 0;
    let lastGraph = 0;
    const tick = (now: number) => {
      const t = Math.min(flight.time, ((now - t0) / 1000) * rate);
      place(t);
      if (t >= apex.t) setApexShown(true);
      if (now - lastGraph > 120) {
        lastGraph = now;
        setGraphT(t);
      }
      if (t < flight.time) raf = requestAnimationFrame(tick);
      else {
        setGraphT(Infinity);
        setPhase("landed");
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flight]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the view rescales (a longer launch), re-place the resting ball and trail.
  useLayoutEffect(() => {
    if (phase !== "landed" || !flight) return;
    const p = flight.points[flight.points.length - 1]!;
    ball.current?.setAttribute("transform", `translate(${X(p.x)} ${Y(p.y)})`);
    trail.current?.setAttribute("d", pathOf(flight.points));
  }, [k, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const landed = phase === "landed" && !!last;
  const apex = flight?.points.reduce((a, p) => (p.y > a.y ? p : a), flight.points[0]!);
  const graphPts = flight ? flight.points.filter((p) => p.t <= graphT) : [];
  const hit = landed && last && !last.drag && last.planet === "earth" && Math.abs(last.range - setup.targetM) <= setup.targetTolM;

  /* ---------------------------------------------------------------- tape */
  const [tape, setTape] = useState<number | null>(null);
  useEffect(() => setTape(null), [launches.length]);
  const tapeEnd = tape ?? 0;
  const snapTape = (m: number) => (last && Math.abs(m - last.range) < 0.35 * Math.max(1, maxX / 40) ? Number(last.range.toFixed(2)) : Math.max(0, Math.round(m * 100) / 100));
  const tapeOnMark = !!last && tape !== null && Math.abs(tape - last.range) < 0.006;

  const launch = () => {
    if (ro) return;
    if (aim) commit(aim);
    session.dispatch("sim.start", {} as Record<string, never>);
  };

  /* ---------------------------------------------------------------- guidance + demo hand */
  const aimPulse = !ro && !dragging && phase !== "flying" && (focus === "first-launch" ? !(s.angle === 45 && s.planet === "earth" && !s.drag) : focus === "complementary" || focus === "target");
  const launchPulse = !ro && focus === "first-launch" && s.angle === 45 && s.planet === "earth" && !s.drag && phase !== "flying";
  const tapePulse = !ro && focus === "measure" && landed && !tapeOnMark;
  const launchBtn = { x: 58, y: 30 };
  let hand: Pt | null = null;
  let pressing = false;
  let follow = false;
  if (demo.next && (nextSpeed !== undefined || nextAngle !== undefined)) {
    hand = handle;
    pressing = demo.k > 0.3;
    follow = demo.k > 0.35;
  } else if (demo.next?.type === "sim.start") {
    hand = launchBtn;
    pressing = demo.k > 0.8;
  } else if (demo.next?.type === "measure.read" && last) {
    hand = { x: X(mix(0, last.range, easeInOut(Math.max(0, (demo.k - 0.2) / 0.8)))), y: GROUND_Y + 22 };
    pressing = demo.k > 0.2;
    follow = demo.k > 0.2;
  } else if (demo.last && demo.since < 500 && (paramOf(demo.last, "speed") !== undefined || paramOf(demo.last, "angle") !== undefined)) hand = handle;
  const demoTape = session.mode === "demo" && demo.next?.type === "measure.read" && last ? mix(0, last.range, easeInOut(Math.max(0, (demo.k - 0.2) / 0.8))) : null;
  const shownTape = demoTape ?? tapeEnd;

  const onAimKey = (key: string, shift: boolean) => {
    const base = aim ?? { speed: s.speed, angle: s.angle };
    let next = base;
    if (key === "ArrowLeft") next = { ...base, angle: Math.min(85, Number((base.angle + (shift ? 0.1 : 1)).toFixed(1))) };
    else if (key === "ArrowRight") next = { ...base, angle: Math.max(5, Number((base.angle - (shift ? 0.1 : 1)).toFixed(1))) };
    else if (key === "ArrowUp") next = { ...base, speed: Math.min(30, base.speed + 0.5) };
    else if (key === "ArrowDown") next = { ...base, speed: Math.max(5, base.speed - 0.5) };
    else return false;
    setAim(next);
    commitLater(next);
    return true;
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_320px]">
      <LabStyles />
      <div className="flex min-h-0 flex-col gap-3">
        <Stage className="min-h-[300px] flex-1">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full select-none" role="group" aria-label={last ? `Launch range. Last launch ${sf(last.range)} m, ${sf(last.maxHeight)} m high, ${sf(last.time)} s.` : "Launch range"}>
            <defs>
              <linearGradient id="pj-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#0b1730" />
                <stop offset="1" stopColor="#173263" />
              </linearGradient>
              <linearGradient id="pj-ground" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={GROUND[s.planet][0]} />
                <stop offset="1" stopColor={GROUND[s.planet][1]} />
              </linearGradient>
              <linearGradient id="pj-power" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor={V3.blue} stopOpacity={0.2} />
                <stop offset="1" stopColor={speed > 24 ? V3.amber : V3.cyan} />
              </linearGradient>
              <radialGradient id="pj-ball">
                <stop offset="0" stopColor="#fff7d6" />
                <stop offset="1" stopColor="#ffc23d" />
              </radialGradient>
            </defs>
            <rect width={W} height={GROUND_Y} fill="url(#pj-sky)" />
            {s.planet !== "earth" && Array.from({ length: 40 }, (_, i) => <circle key={i} cx={(i * 197) % W} cy={(i * 83) % (GROUND_Y - 40)} r={i % 5 ? 0.8 : 1.4} fill="#fff" opacity={0.35} />)}
            <rect x={0} y={GROUND_Y} width={W} height={H - GROUND_Y} fill="url(#pj-ground)" />
            <line x1={0} y1={GROUND_Y} x2={W} y2={GROUND_Y} stroke="rgba(255,255,255,.18)" />
            {/* distance marks */}
            {Array.from({ length: Math.floor(maxX / (maxX > 60 ? 10 : 5)) + 1 }, (_, i) => i * (maxX > 60 ? 10 : 5)).map((m) => (
              <g key={m}>
                <line x1={X(m)} y1={GROUND_Y} x2={X(m)} y2={GROUND_Y + 6} stroke="rgba(255,255,255,.45)" />
                <text x={X(m)} y={GROUND_Y + 40} fontSize={10} fill="rgba(220,232,255,.5)" textAnchor="middle" fontFamily="JetBrains Mono, monospace">
                  {m}
                </text>
              </g>
            ))}
            {/* target */}
            <g>
              <rect x={X(setup.targetM - setup.targetTolM)} y={GROUND_Y - 3} width={setup.targetTolM * 2 * k} height={6} rx={3} fill={hit ? V3.mint : V3.red} opacity={0.9} className={hit ? "ls-breathe" : ""} />
              <line x1={X(setup.targetM)} y1={GROUND_Y - 34} x2={X(setup.targetM)} y2={GROUND_Y} stroke={hit ? V3.mint : V3.red} strokeWidth={2} />
              <path d={`M${X(setup.targetM)} ${GROUND_Y - 34} l16 5 l-16 5 z`} fill={hit ? V3.mint : V3.red} />
              <text x={X(setup.targetM)} y={GROUND_Y - 40} fontSize={11} fill={hit ? V3.mint : "#ffa8b1"} textAnchor="middle" fontWeight={700}>
                {hit ? "Hit!" : `target ${setup.targetM} m`}
              </text>
            </g>
            {/* earlier runs */}
            {ghosts.map((gh, i) => (
              <path key={i} d={pathOf(gh.points)} stroke={COLOURS[i % COLOURS.length]} strokeOpacity={0.38} strokeWidth={1.5} fill="none" strokeDasharray={launches[i]!.drag ? "5 4" : undefined} />
            ))}
            {/* predicted climb */}
            {phase !== "flying" && (dragging || aim || demo.next || launches.length === 0) && (
              <path d={pathOf(preview)} stroke={V3.cyan} strokeWidth={2.5} strokeLinecap="round" strokeDasharray="0.1 9" fill="none" opacity={0.85} />
            )}
            {/* current flight */}
            {flight && (
              <>
                <path ref={trail} stroke="#fff" strokeOpacity={0.8} strokeWidth={3} strokeLinecap="round" strokeDasharray="0.1 8" fill="none" />
                {apex && apexShown && (
                  <g>
                    <line x1={X(apex.x)} y1={Y(apex.y)} x2={X(apex.x)} y2={GROUND_Y} stroke="rgba(255,255,255,.22)" strokeDasharray="3 4" />
                    <text x={X(apex.x)} y={Y(apex.y) - 14} fontSize={11} fill={V3.amber} textAnchor="middle" fontWeight={700}>
                      max height {sf(apex.y)} m
                    </text>
                  </g>
                )}
                <g ref={ball}>
                  {phase === "flying" && (
                    <>
                      <line ref={vline} x1={0} y1={0} stroke={V3.cyan} strokeWidth={2.5} strokeLinecap="round" />
                      <line x1={0} y1={0} x2={0} y2={Math.min(56, g * 2.4)} stroke="#ff8a96" strokeWidth={2.5} strokeLinecap="round" />
                      <path d={`M-4 ${Math.min(56, g * 2.4) - 6} l4 7 l4 -7`} stroke="#ff8a96" strokeWidth={2.5} fill="none" />
                    </>
                  )}
                  <circle r={7} fill="url(#pj-ball)" stroke="#fff" strokeWidth={1.5} />
                </g>
              </>
            )}
            {landed && last && (
              <g key={launches.length}>
                <ellipse className="ls-snap" cx={X(last.range)} cy={GROUND_Y} rx={14} ry={4} fill="#e9ecef" opacity={0.55} />
                <line x1={X(last.range)} y1={GROUND_Y - 8} x2={X(last.range)} y2={GROUND_Y + 8} stroke="#fff" strokeWidth={1.5} />
              </g>
            )}
            {/* tape: drag its hook out to the landing mark */}
            {landed && last && (
              <g>
                <rect x={pivot.x - 2} y={GROUND_Y + 14} width={Math.max(0, X(shownTape) - X(0)) + 2} height={12} fill={V3.amber} />
                {Array.from({ length: Math.floor(shownTape) + 1 }, (_, m) => (
                  <line key={m} x1={X(m)} y1={GROUND_Y + 14} x2={X(m)} y2={GROUND_Y + (m % 5 === 0 ? 24 : 19)} stroke="#4a3500" strokeWidth={m % 5 === 0 ? 1.2 : 0.6} />
                ))}
                <rect x={pivot.x - 14} y={GROUND_Y + 10} width={16} height={20} rx={5} fill="#2b3142" stroke="#8fa6d1" />
                <DragHandle
                  label="Tape measure hook"
                  valueText={`${shownTape.toFixed(2)} metres`}
                  value={shownTape}
                  min={0}
                  max={maxX}
                  disabled={ro}
                  ring={{ cx: X(shownTape), cy: GROUND_Y + 20, r: 10 }}
                  pulse={tapePulse}
                  onDrag={(p) => setTape(snapTape((p.x - L) / k))}
                  onKey={(key, shift) => {
                    const st = shift ? 1 : 0.01;
                    if (key === "ArrowRight") setTape(snapTape(tapeEnd + st));
                    else if (key === "ArrowLeft") setTape(Math.max(0, Math.round((tapeEnd - st) * 100) / 100));
                    else if (key === "End") setTape(Number(last.range.toFixed(2)));
                    else return false;
                    return true;
                  }}
                >
                  <circle cx={X(shownTape)} cy={GROUND_Y + 20} r={16} fill="transparent" />
                  <rect x={X(shownTape) - 3} y={GROUND_Y + 8} width={6} height={24} rx={2} fill={tapeOnMark ? V3.mint : "#fff"} stroke="#4a3500" />
                </DragHandle>
                {shownTape > 0.05 && (
                  <g pointerEvents="none">
                    <rect x={X(shownTape) - 30} y={GROUND_Y - 30} width={60} height={20} rx={7} fill="#060d1f" fillOpacity={0.85} stroke={tapeOnMark ? V3.mint : "rgba(140,180,255,.3)"} />
                    <text x={X(shownTape)} y={GROUND_Y - 16} fontSize={11} textAnchor="middle" fontWeight={700} fill={tapeOnMark ? V3.mint : "#fff"} fontFamily="JetBrains Mono, monospace">
                      {shownTape.toFixed(2)} m
                    </text>
                  </g>
                )}
              </g>
            )}

            {/* launcher */}
            <g style={{ transform: `translate(${pivot.x}px, ${pivot.y}px) rotate(${-angle}deg)` }}>
              <g key={recoil} style={!reduced && recoil ? { animation: "ls-recoil .35s ease-out" } : undefined}>
                <rect x={-8} y={-8} width={50} height={16} rx={5} fill="#b8c2d6" stroke="#4a5568" />
                <rect x={30} y={-9} width={14} height={18} rx={3} fill="#8794ad" stroke="#4a5568" />
              </g>
            </g>
            <path d={`M${pivot.x - 22} ${GROUND_Y} a22 22 0 0 1 44 0 z`} fill="#2b3142" stroke="#5b6680" />
            <circle cx={pivot.x} cy={pivot.y} r={5} fill="#dbe7ff" />

            {/* power arrow + aim handle */}
            {phase !== "flying" && (
              <g pointerEvents="none">
                <path d={`M${pivot.x + 30} ${pivot.y} A30 30 0 0 0 ${pivot.x + 30 * Math.cos(rad)} ${pivot.y - 30 * Math.sin(rad)}`} fill="none" stroke={V3.amber} strokeWidth={1.5} />
                <text x={pivot.x + 40} y={pivot.y - 8} fontSize={11} fill={V3.amber} fontWeight={700} fontFamily="JetBrains Mono, monospace">
                  {angle.toFixed(1)}°
                </text>
                <line x1={pivot.x + Math.cos(rad) * 50} y1={pivot.y - Math.sin(rad) * 50} x2={handle.x} y2={handle.y} stroke="url(#pj-power)" strokeWidth={6} strokeLinecap="round" opacity={dragging || aim ? 1 : 0.75} />
              </g>
            )}
            {phase !== "flying" && (
              <DragHandle
                label="Aim: drag to set the launch angle and speed"
                valueText={`${angle.toFixed(1)} degrees at ${speed.toFixed(1)} metres per second. Left and right change the angle, up and down the speed, Enter launches.`}
                value={angle}
                min={5}
                max={85}
                disabled={ro}
                ring={{ cx: handle.x, cy: handle.y, r: 13 }}
                pulse={aimPulse}
                onDragStart={() => setDragging(true)}
                onDrag={(p) => {
                  const dx = p.x - pivot.x;
                  const dy = pivot.y - p.y;
                  const a = Math.max(5, Math.min(85, Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 2) / 2));
                  setAim({ angle: a, speed: speedOf(Math.hypot(dx, dy)) });
                }}
                onDragEnd={() => {
                  setDragging(false);
                  if (aim) commit(aim);
                }}
                onKey={onAimKey}
                onActivate={launch}
              >
                <circle cx={handle.x} cy={handle.y} r={22} fill="transparent" />
                <circle cx={handle.x} cy={handle.y} r={dragging ? 13 : 11} fill="#0b1730" stroke={dragging ? V3.cyan : "#fff"} strokeWidth={3} style={{ transition: "r .15s" }} />
                <circle cx={handle.x} cy={handle.y} r={4} fill={dragging ? V3.cyan : V3.amber} />
              </DragHandle>
            )}
            {phase !== "flying" && (dragging || aim) && (
              <g pointerEvents="none">
                <rect x={handle.x + 16} y={handle.y - 30} width={92} height={22} rx={8} fill="#060d1f" fillOpacity={0.85} stroke="rgba(57,214,255,.5)" />
                <text x={handle.x + 62} y={handle.y - 15} fontSize={11} fontWeight={700} textAnchor="middle" fill="#fff" fontFamily="JetBrains Mono, monospace">
                  {speed.toFixed(1)} m/s
                </text>
              </g>
            )}
            {aimPulse && !aim && <Tag x={handle.x + 10} y={handle.y - 34} text={focus === "first-launch" ? "Drag to aim at 45°" : "Drag to aim"} />}
            {/* launch pad button */}
            {phase !== "flying" && !ro && (
              <DragHandle label="Launch" role="button" onActivate={launch} ring={{ cx: launchBtn.x, cy: launchBtn.y, r: 14 }} pulse={launchPulse}>
                <rect x={launchBtn.x - 34} y={launchBtn.y - 13} width={68} height={26} rx={9} fill="url(#pj-power)" stroke="#6aa8ff" />
                <text x={launchBtn.x} y={launchBtn.y + 4} fontSize={12} fontWeight={800} fill="#fff" textAnchor="middle">
                  LAUNCH
                </text>
              </DragHandle>
            )}
            <GhostHand at={hand} pressing={pressing} follow={follow} />
          </svg>
          <style>{"@keyframes ls-recoil{0%{transform:translateX(0)}30%{transform:translateX(-9px)}100%{transform:translateX(0)}}"}</style>
          <div className="pointer-events-none absolute right-3 top-3 rounded-[10px] bg-[#060d1f]/70 px-2.5 py-1 text-xs font-semibold text-[#c8d6f3] ring-1 ring-inset ring-[rgba(140,180,255,.16)]">
            {PLANETS[s.planet].label} · g = {g} m/s²{s.drag ? " · air resistance" : ""}
          </div>
        </Stage>
        <Panel title="Live graphs">
          <LiveGraph
            series={[
              { label: "height y (m)", colour: V3.amber, points: graphPts.map((p) => ({ x: p.t, y: p.y })) },
              { label: "vertical velocity vy (m/s)", colour: V3.cyan, points: graphPts.map((p) => ({ x: p.t, y: p.vy })) },
            ]}
            xLabel="t / s"
            yLabel="y, vy"
            height={120}
            yMin={Math.min(0, ...graphPts.map((p) => p.vy))}
          />
        </Panel>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Launch" glow={!ro && (focus === "air" || focus === "moon" || launchPulse)}>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-[12px] bg-[#040a1c]/55 px-3 py-2 ring-1 ring-inset ring-[rgba(140,180,255,.10)]">
              <div className="ls-kicker">Speed</div>
              <div className="font-mono text-xl font-bold text-white">
                <Num value={speed} digits={1} />
                <span className="ml-1 text-xs text-white/45">m/s</span>
              </div>
            </div>
            <div className="rounded-[12px] bg-[#040a1c]/55 px-3 py-2 ring-1 ring-inset ring-[rgba(140,180,255,.10)]">
              <div className="ls-kicker">Angle</div>
              <div className="font-mono text-xl font-bold text-[#ffc23d]">
                <Num value={angle} digits={1} />
                <span className="ml-1 text-xs text-white/45">°</span>
              </div>
            </div>
          </div>
          <div className="space-y-2.5">
            <ParamSlider guideId="param:speed" label="Fine-tune speed" value={s.speed} min={5} max={30} step={0.5} unit="m/s" onCommit={(v) => session.dispatch("param.set", { key: "speed", value: v })} disabled={ro} />
            <ParamSlider guideId="param:angle" label="Fine-tune angle" value={s.angle} min={5} max={85} step={0.1} unit="°" onCommit={(v) => session.dispatch("param.set", { key: "angle", value: v })} disabled={ro} />
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Planet">
              {(Object.keys(PLANETS) as Planet[]).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={s.planet === p} disabled={ro} onClick={() => session.dispatch("param.set", { key: "planet", value: p })} className="ls-chip">
                  {PLANETS[p].label}
                </button>
              ))}
            </div>
            <button type="button" aria-pressed={s.drag} disabled={ro} onClick={() => session.dispatch("param.set", { key: "drag", value: !s.drag })} className="ls-chip w-full justify-center">
              <Wind className="h-4 w-4" /> Air resistance {s.drag ? "on" : "off"}
            </button>
            <Btn tone="primary" onClick={launch} disabled={ro || phase === "flying"} className="w-full">
              <Rocket className="h-4 w-4" /> Launch
            </Btn>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-[#8fa6d1]">Drag the aim handle on the range, or focus it and use the arrow keys (Enter launches).</p>
        </Panel>
        <Panel title="Measure" glow={tapePulse}>
          <p className="mb-2 text-[11px] text-[#8fa6d1]">{landed ? "Pull the tape hook out to the landing mark and read it." : "Launch first."}</p>
          <ReadingInput label="Range from the tape" unit="m" onRecord={(v) => session.dispatch("measure.read", { instrument: "tape", reading: { key: "range", value: v, unit: "m" } })} value={submitted(session.events, "range", "tape")} disabled={ro || !landed} />
        </Panel>
        <Panel title="Launches">
          {launches.length === 0 ? (
            <p className="text-xs text-[#8fa6d1]">No launches yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[#8fa6d1]">
                <tr>
                  <th className="text-left font-semibold">#</th>
                  <th className="text-right font-semibold">v</th>
                  <th className="text-right font-semibold">θ</th>
                  <th className="text-right font-semibold">range</th>
                  <th className="text-right font-semibold">height</th>
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
                    <td className="text-right">{i === launches.length - 1 && !landed ? "…" : sf(l.range, 4)}</td>
                    <td className="text-right">{sf(l.maxHeight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <Readout label="Height" value={last ? sf(last.maxHeight) : "–"} unit="m" />
            <Readout label="Time" value={last ? sf(last.time) : "–"} unit="s" />
            <Readout label="Launches" value={launches.length} />
          </div>
        </Panel>
      </div>
    </div>
  );
}
