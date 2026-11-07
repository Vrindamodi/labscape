import { Btn, Panel, ParamSlider, ReadingInput, Readout, sf, type SimSession } from "@labscape/physics";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowUp, Check, RotateCcw, Scale } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { quadratic } from "../core/numeric";
import type { BalanceSetup, BalanceState, CircleState, QuadState, Side } from "../labs/maths";
import { Plot, useMorph, type View } from "./Plot";

/* ================================================================== quadratic explorer */

const QVIEW: View = { x0: -6, x1: 8, y0: -10, y1: 10 };

export function QuadraticWorkspace({ session }: { session: SimSession<QuadState> }) {
  const s = session.state;
  const ro = session.readOnly;
  const a = useMorph(s.a);
  const b = useMorph(s.b);
  const c = useMorph(s.c);
  const q = quadratic(a, b, c);
  const qTrue = quadratic(s.a, s.b, s.c);
  const reduced = useReducedMotion();
  const curves = useMemo(() => [{ f: (x: number) => a * x * x + b * x + c, colour: "#7cf3ff", width: 3 }], [a, b, c]);
  const set = (k: "a" | "b" | "c", v: number) => session.dispatch("param.set", { key: k, value: v });
  const roots = q.roots.kind === "two" ? [q.roots.r1, q.roots.r2] : q.roots.kind === "one" ? [q.roots.r] : [];
  const disc = qTrue.disc;

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="relative">
          <Plot
            curves={curves}
            view={QVIEW}
            height={380}
            ariaLabel={`y = ${s.a}x² + ${s.b}x + ${s.c}`}
            overlay={(m) => (
              <g>
                {q.vertex && (
                  <g>
                    <line x1={m.X(q.vertex.x)} y1={0} x2={m.X(q.vertex.x)} y2={m.h} stroke="rgba(255,212,59,.5)" strokeDasharray="6 5" />
                    <circle cx={m.X(q.vertex.x)} cy={m.Y(q.vertex.y)} r={6} fill="#ffd43b" />
                    <text x={m.X(q.vertex.x) + 10} y={m.Y(q.vertex.y) + (a > 0 ? 18 : -10)} fontSize={12} fontWeight={700} fill="#ffe066">
                      ({sf(q.vertex.x)}, {sf(q.vertex.y)})
                    </text>
                    {/* opening direction arrow, squashes as it flips */}
                    <motion.g animate={{ scaleY: a >= 0 ? 1 : -1 }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 18 }} style={{ originX: `${m.X(q.vertex.x) - 26}px`, originY: `${m.Y(q.vertex.y)}px` }}>
                      <path d={`M ${m.X(q.vertex.x) - 26} ${m.Y(q.vertex.y) + 6} l 0 -22 l -5 7 m 5 -7 l 5 7`} stroke="#ffd43b" strokeWidth={2} fill="none" />
                    </motion.g>
                  </g>
                )}
                <circle cx={m.X(0)} cy={m.Y(c)} r={4.5} fill="#b197fc" />
                <text x={m.X(0) + 8} y={m.Y(c) - 6} fontSize={11} fill="#d0bfff">
                  c = {sf(c)}
                </text>
                <AnimatePresence>
                  {roots.map((r, i) => (
                    <motion.g key={roots.length === 1 ? "one" : `r${i}`} initial={{ scale: 0 }} animate={{ scale: roots.length === 1 && !reduced ? [1.8, 1] : 1 }} exit={{ scale: 0 }} style={{ originX: `${m.X(r)}px`, originY: `${m.Y(0)}px` }}>
                      <circle cx={m.X(r)} cy={m.Y(0)} r={7} fill="#ff6b6b" stroke="#fff" strokeWidth={2} />
                    </motion.g>
                  ))}
                </AnimatePresence>
              </g>
            )}
          />
          {Math.abs(s.a) < 1e-9 && <span className="absolute left-3 top-3 rounded-full bg-amber-400/90 px-2.5 py-1 text-xs font-bold text-black">No longer quadratic: a = 0 gives a straight line</span>}
          <div className="absolute right-3 top-3 rounded-lg bg-black/40 px-3 py-1.5 font-mono text-sm font-semibold text-white">
            y = {s.a === 1 ? "" : s.a === -1 ? "−" : sf(s.a)}x² {s.b < 0 ? "−" : "+"} {sf(Math.abs(s.b))}x {s.c < 0 ? "−" : "+"} {sf(Math.abs(s.c))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Panel title="Discriminant b² − 4ac">
            <DiscGauge disc={disc} />
          </Panel>
          <Panel title="Roots in the complex plane">
            <ComplexInset roots={qTrue.roots} />
          </Panel>
        </div>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Coefficients">
          <div className="space-y-3">
            <ParamSlider label="a" value={s.a} min={-10} max={10} step={0.1} onCommit={(v) => set("a", v)} disabled={ro} sweep />
            <ParamSlider label="b" value={s.b} min={-10} max={10} step={0.1} onCommit={(v) => set("b", v)} disabled={ro} sweep />
            <ParamSlider label="c" value={s.c} min={-10} max={10} step={0.1} onCommit={(v) => set("c", v)} disabled={ro} sweep />
          </div>
        </Panel>
        <Panel title="Read the roots">
          <p className="mb-2 text-xs text-white/55">Where does the curve cross the x-axis?</p>
          <div className="space-y-2">
            <ReadingInput label="First root" onRecord={(v) => session.dispatch("param.set", { key: "result:root1", value: v })} disabled={ro} />
            <ReadingInput label="Second root" onRecord={(v) => session.dispatch("param.set", { key: "result:root2", value: v })} disabled={ro} />
          </div>
        </Panel>
        <div className="grid grid-cols-2 gap-2">
          <Readout label="Vertex x = −b/2a" value={qTrue.vertex ? sf(qTrue.vertex.x) : "–"} />
          <Readout label="Roots" value={qTrue.roots.kind === "two" ? "two" : qTrue.roots.kind === "one" ? "one" : qTrue.roots.kind === "complex" ? "complex pair" : "line"} />
        </div>
      </div>
    </div>
  );
}

function DiscGauge({ disc }: { disc: number }) {
  const v = Number.isFinite(disc) ? Math.max(-1, Math.min(1, Math.sign(disc) * Math.min(1, Math.abs(disc) / 40))) : 0;
  const reduced = useReducedMotion();
  return (
    <svg viewBox="0 0 200 110" className="w-full" role="meter" aria-label={`Discriminant ${sf(disc)}`} aria-valuenow={Number.isFinite(disc) ? disc : 0}>
      <path d="M 20 100 A 80 80 0 0 1 100 20" stroke="#ff8787" strokeWidth={10} fill="none" opacity={0.6} />
      <path d="M 100 20 A 80 80 0 0 1 180 100" stroke="#69db7c" strokeWidth={10} fill="none" opacity={0.6} />
      <line x1={100} y1={14} x2={100} y2={30} stroke="#ffd43b" strokeWidth={3} />
      <motion.line x1={100} y1={100} x2={100} y2={32} stroke="#fff" strokeWidth={3} strokeLinecap="round" animate={{ rotate: v * 90 }} style={{ originX: "100px", originY: "100px" }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 14 }} />
      <circle cx={100} cy={100} r={5} fill="#fff" />
      <text x={22} y={108} fontSize={9} fill="#ffa8a8">
        complex
      </text>
      <text x={178} y={108} fontSize={9} fill="#8ce99a" textAnchor="end">
        two real
      </text>
      <text x={100} y={74} fontSize={13} fontWeight={800} textAnchor="middle" fill="#fff">
        {Number.isFinite(disc) ? sf(disc) : "–"}
      </text>
    </svg>
  );
}

function ComplexInset({ roots }: { roots: ReturnType<typeof quadratic>["roots"] }) {
  const pts = roots.kind === "two" ? [{ re: roots.r1, im: 0 }, { re: roots.r2, im: 0 }] : roots.kind === "one" ? [{ re: roots.r, im: 0 }] : roots.kind === "complex" ? [{ re: roots.re, im: roots.im }, { re: roots.re, im: -roots.im }] : [];
  const k = 12;
  return (
    <svg viewBox="-100 -55 200 110" className="w-full" role="img" aria-label={roots.kind === "complex" ? `Complex roots ${sf(roots.re)} ± ${sf(roots.im)}i` : "Real roots on the real axis"}>
      <line x1={-95} y1={0} x2={95} y2={0} stroke="rgba(255,255,255,.4)" />
      <line x1={0} y1={-50} x2={0} y2={50} stroke="rgba(255,255,255,.4)" />
      <text x={92} y={-4} fontSize={8} fill="rgba(255,255,255,.5)" textAnchor="end">
        Re
      </text>
      <text x={4} y={-44} fontSize={8} fill="rgba(255,255,255,.5)">
        Im
      </text>
      {pts.map((p, i) => (
        <motion.circle key={i} r={4.5} fill={p.im ? "#b197fc" : "#ff6b6b"} initial={false} cx={Math.max(-90, Math.min(90, p.re * k))} cy={Math.max(-48, Math.min(48, -p.im * k))} animate={{ cx: Math.max(-90, Math.min(90, p.re * k)), cy: Math.max(-48, Math.min(48, -p.im * k)) }} transition={{ type: "spring", stiffness: 200, damping: 22 }} />
      ))}
      {roots.kind === "complex" && (
        <text x={0} y={52} fontSize={9} fill="#d0bfff" textAnchor="middle">
          {sf(roots.re)} ± {sf(roots.im)}i
        </text>
      )}
    </svg>
  );
}

/* ================================================================== balance */

const sideText = (s: Side) => {
  const xs = s.x === 0 ? "" : s.x === 1 ? "x" : s.x === -1 ? "−x" : `${sf(s.x)}x`;
  const ks = s.k === 0 ? "" : `${xs && s.k > 0 ? " + " : xs && s.k < 0 ? " − " : s.k < 0 ? "−" : ""}${sf(Math.abs(s.k))}`;
  return xs + ks || "0";
};

export function BalanceWorkspace({ session }: { session: SimSession<BalanceState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as BalanceSetup;
  const ro = session.readOnly;
  const reduced = useReducedMotion();
  const [op, setOp] = useState<"+" | "-" | "*" | "/">("-");
  const [arg, setArg] = useState("4");
  const [where, setWhere] = useState<"both" | "left" | "right">("both");
  const [orig] = [setup.equations[s.eq]!];
  const x = (orig[1].k - orig[0].k) / (orig[0].x - orig[1].x);
  const lv = s.left.x * x + s.left.k;
  const rv = s.right.x * x + s.right.k;
  const tilt = s.level ? 0 : Math.max(-14, Math.min(14, (rv - lv) * 1.5));
  const validArg = arg.trim() === "x" ? op === "+" || op === "-" : Number.isFinite(Number(arg)) && arg.trim() !== "";
  const apply = () => session.dispatch("param.set", { key: "op", value: `${where}:${op}${arg.trim()}` });
  const solvedHere = s.solved.includes(s.eq);
  const answered = s.eq === 0 ? s.results.x1 !== undefined : s.results.x2 !== undefined;

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="relative flex min-h-[320px] flex-col overflow-hidden rounded-xl bg-[radial-gradient(600px_400px_at_50%_20%,#1d3263,#0a1226)] ring-1 ring-inset ring-white/10">
        <div className="pt-4 text-center font-mono text-2xl font-bold text-white" aria-live="polite">
          {sideText(s.left)} <span className={s.level ? "text-emerald-300" : "text-red-300"}>{s.level ? "=" : "≠"}</span> {sideText(s.right)}
        </div>
        <svg viewBox="0 0 600 320" className="w-full flex-1" role="img" aria-label={s.level ? "The scale is level" : "The scale has tipped"}>
          <polygon points="300,120 270,300 330,300" fill="#495057" />
          <rect x={220} y={296} width={160} height={10} rx={3} fill="#343a40" />
          <motion.g animate={{ rotate: tilt }} style={{ originX: "300px", originY: "120px" }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 90, damping: 9 }}>
            <rect x={60} y={114} width={480} height={12} rx={6} fill="#adb5bd" />
            <Pan cx={110} side={s.left} tilt={tilt} />
            <Pan cx={490} side={s.right} tilt={tilt} />
          </motion.g>
          <circle cx={300} cy={120} r={8} fill="#ffd43b" />
        </svg>
        {!s.level && <div className="absolute inset-x-6 bottom-3 rounded-lg bg-red-500/85 px-3 py-2 text-center text-sm font-semibold text-white">Tipped! You changed only one side. Undo it.</div>}
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Do something to the scale">
          <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Operation">
            {(["+", "-", "*", "/"] as const).map((o) => (
              <Btn key={o} onClick={() => setOp(o)} tone={op === o ? "primary" : "secondary"} pressed={op === o} disabled={ro}>
                {o === "*" ? "×" : o === "/" ? "÷" : o === "-" ? "−" : "+"}
              </Btn>
            ))}
          </div>
          <div className="mt-2 flex items-end gap-2">
            <label className="text-[11px] font-semibold text-white/60">
              by (a number or x)
              <input value={arg} onChange={(e) => setArg(e.target.value)} className="mt-0.5 block h-9 w-20 rounded-md bg-black/30 px-2 font-mono text-sm text-white ring-1 ring-inset ring-white/15" disabled={ro} />
            </label>
            <div className="flex flex-1 gap-1" role="radiogroup" aria-label="Which side">
              {(["both", "left", "right"] as const).map((w) => (
                <button key={w} onClick={() => setWhere(w)} aria-checked={where === w} role="radio" disabled={ro} className={`h-9 flex-1 rounded-md text-xs font-semibold ring-1 ring-inset ${where === w ? "bg-white/15 text-white ring-white/30" : "text-white/55 ring-white/10"}`}>
                  {w}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Btn tone="primary" onClick={apply} disabled={ro || !validArg}>
              <Scale className="h-4 w-4" /> Apply
            </Btn>
            <Btn onClick={() => session.dispatch("param.set", { key: "undo", value: true })} disabled={ro || !s.history.length}>
              <RotateCcw className="h-4 w-4" /> Undo
            </Btn>
          </div>
          {s.history.length > 0 && <p className="mt-2 font-mono text-[11px] text-white/45">{s.history.map((h) => h.replace("both:", "both ").replace("*", "×").replace("/", "÷")).join("  →  ")}</p>}
        </Panel>
        <Panel title="Answer">
          <ReadingInput label="x =" onRecord={(v) => session.dispatch("param.set", { key: s.eq === 0 ? "result:x1" : "result:x2", value: v })} disabled={ro} />
          {s.eq === 0 && solvedHere && answered && (
            <Btn tone="primary" className="mt-2 w-full" onClick={() => session.dispatch("param.set", { key: "equation", value: 1 })} disabled={ro}>
              <Check className="h-4 w-4" /> Next equation
            </Btn>
          )}
        </Panel>
        <Panel title="Equations">
          {setup.equations.map(([l, r], i) => (
            <p key={i} className={`font-mono text-sm ${i === s.eq ? "text-white" : "text-white/40"}`}>
              {i + 1}. {sideText(l)} = {sideText(r)} {s.solved.includes(i) && <Check className="inline h-3.5 w-3.5 text-emerald-300" />}
            </p>
          ))}
        </Panel>
      </div>
    </div>
  );
}

/** One pan: x-bags and unit blocks, counter-rotated so it hangs level. */
function Pan({ cx, side, tilt }: { cx: number; side: Side; tilt: number }) {
  const bags = Math.abs(side.x);
  const units = Math.abs(side.k);
  const showUnits = Number.isInteger(units) && units <= 24;
  return (
    <g>
      <line x1={cx} y1={126} x2={cx - 60} y2={196} stroke="#adb5bd" />
      <line x1={cx} y1={126} x2={cx + 60} y2={196} stroke="#adb5bd" />
      <motion.g animate={{ rotate: -tilt }} style={{ originX: `${cx}px`, originY: "126px" }}>
        <path d={`M ${cx - 70} 196 q 70 26 140 0`} fill="#868e96" stroke="#495057" />
        {/* x bags */}
        {Array.from({ length: Math.ceil(bags) }, (_, i) => {
          const frac = i === Math.ceil(bags) - 1 && !Number.isInteger(bags) ? bags - Math.floor(bags) : 1;
          return (
            <g key={`b${i}`} transform={`translate(${cx - 60 + (i % 5) * 26} ${150 - Math.floor(i / 5) * 32})`} opacity={side.x < 0 ? 0.5 : 1}>
              <rect width={22} height={30 * frac} y={30 * (1 - frac)} rx={6} fill="#9775fa" stroke="#e5dbff" />
              <text x={11} y={20} fontSize={12} fontWeight={800} fill="#fff" textAnchor="middle">
                {frac === 1 ? "x" : sf(frac, 2)}
              </text>
            </g>
          );
        })}
        {/* unit blocks */}
        {showUnits ? (
          Array.from({ length: units }, (_, i) => <rect key={`u${i}`} x={cx + 6 + (i % 6) * 10} y={180 - Math.floor(i / 6) * 10} width={9} height={9} rx={1.5} fill={side.k < 0 ? "#ff8787" : "#ffd43b"} />)
        ) : units > 0 ? (
          <text x={cx + 32} y={182} fontSize={16} fontWeight={800} fill={side.k < 0 ? "#ff8787" : "#ffd43b"} textAnchor="middle">
            {side.k < 0 ? "−" : ""}
            {sf(units)}
          </text>
        ) : null}
      </motion.g>
    </g>
  );
}

/* ================================================================== unit circle */

const SPECIAL = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330, 360];
const radLabel = (d: number) => {
  const m = d % 360;
  const map: Record<number, string> = { 0: "0", 30: "π/6", 45: "π/4", 60: "π/3", 90: "π/2", 120: "2π/3", 135: "3π/4", 150: "5π/6", 180: "π", 210: "7π/6", 225: "5π/4", 240: "4π/3", 270: "3π/2", 300: "5π/3", 315: "7π/4", 330: "11π/6" };
  const base = map[Math.round(m)] ?? ((d * Math.PI) / 180).toFixed(3);
  return d >= 360 && Math.round(m) === 0 ? `${Math.round(d / 360) * 2}π` : base;
};

export function UnitCircleWorkspace({ session }: { session: SimSession<CircleState> }) {
  const s = session.state;
  const ro = session.readOnly;
  const [local, setLocal] = useState<number | null>(null);
  const deg = local ?? s.angle;
  // Keyboard steps build on the last committed angle, even before the next render.
  const latest = useRef(s.angle);
  useEffect(() => {
    latest.current = s.angle;
  }, [s.angle]);
  const r = (deg * Math.PI) / 180;
  const commit = (d: number) => {
    const snapped = SPECIAL.find((sp) => Math.abs(sp - (d % 360)) <= 2 && d < 360) ?? Math.round(d);
    setLocal(null);
    latest.current = snapped;
    session.dispatch("param.set", { key: "angle", value: snapped });
  };
  const R = 120;
  const cx = 150;
  const cy = 170;
  const px = cx + Math.cos(r) * R;
  const py = cy - Math.sin(r) * R;
  const gw = 360;
  const gx0 = 320;
  const toGx = (d: number) => gx0 + (d / Math.max(360, s.maxAngle, deg)) * gw;
  const wave = (f: (a: number) => number, upTo: number) => Array.from({ length: Math.max(2, Math.ceil(upTo)) + 1 }, (_, i) => Math.min(i, upTo)).map((d, i) => `${i ? "L" : "M"} ${toGx(d).toFixed(1)} ${(cy - f((d * Math.PI) / 180) * R).toFixed(1)}`).join(" ");
  const angleLabel = s.units === "rad" ? `${radLabel(deg)} rad` : `${Math.round(deg)}°`;

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="relative min-h-[320px] overflow-hidden rounded-xl bg-[#0b1430] ring-1 ring-inset ring-white/10">
        <svg
          viewBox="0 0 700 340"
          className="h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
          tabIndex={ro ? -1 : 0}
          role="slider"
          aria-label="Angle on the unit circle"
          aria-valuenow={Math.round(deg)}
          aria-valuetext={angleLabel}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 15 : 1;
            if (e.key === "ArrowRight" || e.key === "ArrowUp") commit(Math.min(720, latest.current + step));
            else if (e.key === "ArrowLeft" || e.key === "ArrowDown") commit(Math.max(0, latest.current - step));
            else return;
            e.preventDefault();
          }}
          onPointerMove={(e) => {
            if (ro || !(e.buttons & 1)) return;
            const b = e.currentTarget.getBoundingClientRect();
            const sx = ((e.clientX - b.left) / b.width) * 700;
            const sy = ((e.clientY - b.top) / b.height) * 340;
            if (sx > 300) return;
            let a = (Math.atan2(cy - sy, sx - cx) * 180) / Math.PI;
            if (a < 0) a += 360;
            const turns = Math.floor(s.angle / 360);
            setLocal(turns * 360 + a);
          }}
          onPointerUp={() => local !== null && commit(local)}
        >
          {/* grid in tenths */}
          {Array.from({ length: 21 }, (_, i) => (
            <g key={i}>
              <line x1={cx - R} y1={cy - R + i * (R / 10)} x2={toGx(Math.max(360, s.maxAngle))} y2={cy - R + i * (R / 10)} stroke={i === 10 ? "rgba(220,230,255,.5)" : "rgba(140,170,230,.1)"} />
              {i % 5 === 0 && (
                <text x={cx - R - 6} y={cy - R + i * (R / 10) + 4} fontSize={10} fill="rgba(220,230,255,.5)" textAnchor="end">
                  {(1 - i / 10).toFixed(1)}
                </text>
              )}
            </g>
          ))}
          {Array.from({ length: 21 }, (_, i) => (
            <line key={`v${i}`} x1={cx - R + i * (R / 10)} y1={cy - R} x2={cx - R + i * (R / 10)} y2={cy + R} stroke={i === 10 ? "rgba(220,230,255,.5)" : "rgba(140,170,230,.1)"} />
          ))}
          <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(220,230,255,.55)" strokeWidth={1.5} />
          <path d={`M ${cx + 22} ${cy} A 22 22 0 ${(deg % 360) > 180 ? 1 : 0} 0 ${cx + 22 * Math.cos(r)} ${cy - 22 * Math.sin(r)}`} fill="none" stroke="#ffd43b" />
          <line x1={cx} y1={cy} x2={px} y2={py} stroke="#fff" strokeWidth={2.5} />
          <line x1={px} y1={py} x2={px} y2={cy} stroke="#ff6b6b" strokeWidth={3} />
          <line x1={cx} y1={cy} x2={px} y2={cy} stroke="#4dabf7" strokeWidth={3} />
          <line x1={px} y1={py} x2={toGx(deg)} y2={py} stroke="rgba(255,107,107,.35)" strokeDasharray="4 4" />
          <circle cx={px} cy={py} r={8} fill="#ffd43b" stroke="#0b1430" strokeWidth={3} className={ro ? "" : "cursor-grab"} />
          {/* unrolling graphs */}
          <path d={wave(Math.sin, deg)} stroke="#ff6b6b" strokeWidth={2.5} fill="none" />
          <path d={wave(Math.cos, deg)} stroke="#4dabf7" strokeWidth={2.5} fill="none" />
          {[90, 180, 270, 360].map((d) => (
            <text key={d} x={toGx(d)} y={cy + R + 16} fontSize={10} fill="rgba(220,230,255,.5)" textAnchor="middle">
              {s.units === "rad" ? radLabel(d) : `${d}°`}
            </text>
          ))}
          <text x={cx} y={cy + R + 32} textAnchor="middle" fontSize={14} fontWeight={800} fill="#ffe066">
            θ = {angleLabel}
          </text>
          <text x={gx0} y={24} fontSize={11} fill="#ff8787" fontWeight={700}>
            sin θ (height)
          </text>
          <text x={gx0 + 110} y={24} fontSize={11} fill="#74c0fc" fontWeight={700}>
            cos θ (across)
          </text>
        </svg>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Angle">
          <ParamSlider label="θ" value={s.angle} min={0} max={720} step={1} unit="°" onCommit={(v) => session.dispatch("param.set", { key: "angle", value: v })} disabled={ro} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Btn onClick={() => session.dispatch("param.set", { key: "units", value: "deg" })} tone={s.units === "deg" ? "primary" : "secondary"} pressed={s.units === "deg"} disabled={ro}>
              Degrees
            </Btn>
            <Btn onClick={() => session.dispatch("param.set", { key: "units", value: "rad" })} tone={s.units === "rad" ? "primary" : "secondary"} pressed={s.units === "rad"} disabled={ro}>
              Radians
            </Btn>
          </div>
          <p className="mt-2 text-[11px] text-white/45">Drag the point, or use the arrow keys (Shift for 15°). It snaps to special angles.</p>
        </Panel>
        <Panel title="Read off the circle">
          <div className="space-y-2">
            <ReadingInput label="sin θ" onRecord={(v) => session.dispatch("measure.read", { instrument: "circle", reading: { key: "sin", value: v, unit: "" } })} disabled={ro} />
            <ReadingInput label="cos θ" onRecord={(v) => session.dispatch("measure.read", { instrument: "circle", reading: { key: "cos", value: v, unit: "" } })} disabled={ro} />
            <ReadingInput label="θ in radians" unit="rad" onRecord={(v) => session.dispatch("measure.read", { instrument: "circle", reading: { key: "rad", value: v, unit: "rad" } })} disabled={ro} />
          </div>
          <Btn className="mt-2 w-full" onClick={() => session.dispatch("timer.mark", { label: "sin-equals-cos" })} disabled={ro}>
            <ArrowUp className="h-3.5 w-3.5" />
            <ArrowDown className="-ml-1 h-3.5 w-3.5" /> Mark: sin θ = cos θ here
          </Btn>
        </Panel>
        <Readout label="Furthest turned" value={`${Math.round(s.maxAngle)}°`} />
      </div>
    </div>
  );
}


