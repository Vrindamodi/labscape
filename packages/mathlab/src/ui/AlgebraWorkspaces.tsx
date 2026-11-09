import { Btn, DragHandle, easeInOut, GhostHand, LabStyles, mix, Num, Panel, ParamSlider, paramOf, Pulse, ReadingInput, Readout, sf, Stage, submitted, Tag, useCommitLater, useDemoPreview, useEased, useFocusStep, useSvgDrag, V3, type Pt, type SimSession } from "@labscape/physics";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowUp, Check, RotateCcw, Scale } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { quadratic } from "../core/numeric";
import type { BalanceSetup, BalanceState, CircleState, QuadState, Side } from "../labs/maths";
import { Plot, useMorph, type Mapper, type View } from "./Plot";

/* ================================================================== quadratic explorer */

const QVIEW: View = { x0: -6, x1: 8, y0: -10, y1: 10 };
type Coef = { a: number; b: number; c: number };
const r2 = (v: number) => Math.max(-10, Math.min(10, Math.round(v * 100) / 100));
const s1 = (v: number) => Math.round(v * 10) / 10;
/** Drag snapping: tenths, with a detent on halves so whole and half values are easy to hit. */
const sd = (v: number) => {
  const h = Math.round(v * 2) / 2;
  return Math.abs(v - h) < 0.15 ? h : s1(v);
};

/**
 * Quadratic explorer: grab the curve itself. The vertex drags (b and c follow), each root drags
 * (the other stays put), the y-intercept sets c, the tangent handle at x = 0 sets b and the
 * shoulder handle one unit right of the vertex sets a. Every drag commits as the same a/b/c events
 * the sliders send.
 */
export function QuadraticWorkspace({ session }: { session: SimSession<QuadState> }) {
  const s = session.state;
  const ro = session.readOnly;
  const reduced = useReducedMotion();
  const focus = useFocusStep(session);
  const demo = useDemoPreview(session, 1100);
  const [drag, setDrag] = useState<(Coef & { what: string }) | null>(null);
  const am = useMorph(s.a);
  const bm = useMorph(s.b);
  const cm = useMorph(s.c);
  const kk = easeInOut(Math.max(0, (demo.k - 0.3) / 0.7));
  const live = (key: "a" | "b" | "c", morphed: number) => {
    const n = paramOf(demo.next, key);
    if (typeof n === "number") return mix(s[key], n, kk);
    return session.mode === "demo" ? s[key] : morphed;
  };
  const a = drag?.a ?? live("a", am);
  const b = drag?.b ?? live("b", bm);
  const c = drag?.c ?? live("c", cm);
  const q = quadratic(a, b, c);
  const qTrue = quadratic(s.a, s.b, s.c);
  const curves = useMemo(() => [{ f: (x: number) => a * x * x + b * x + c, colour: V3.cyan, width: 3 }], [a, b, c]);
  const roots = q.roots.kind === "two" ? [q.roots.r1, q.roots.r2].sort((x, y) => x - y) : q.roots.kind === "one" ? [q.roots.r] : [];
  const disc = qTrue.disc;

  const commit = (n: Coef) => {
    const t = { a: r2(n.a), b: r2(n.b), c: r2(n.c) };
    (["a", "b", "c"] as const).forEach((k) => t[k] !== s[k] && session.dispatch("param.set", { key: k, value: t[k] }));
    setDrag(null);
  };
  const commitLater = useCommitLater(commit, 450);
  const set = (k: "a" | "b" | "c", v: number) => session.dispatch("param.set", { key: k, value: v });
  const base = (): Coef => drag ?? { a: s.a, b: s.b, c: s.c };
  const anchor = useRef<{ h: number; k: number }>({ h: 0, k: 0 });
  const fromVertex = (A: number, h: number, k: number): Coef => ({ a: A, b: r2(-2 * A * h), c: r2(A * h * h + k) });

  // guidance
  const vPulse = !ro && !drag && (focus === "vertex" || focus === "touch" || focus === "complex");
  const aPulse = !ro && !drag && focus === "flip" && s.a > 0;
  const rPulse = !ro && !drag && focus === "flip" && s.a < 0;
  const tip = focus === "vertex" ? "Drag the vertex to (2, −3)" : focus === "touch" ? "Drag the vertex onto the x-axis" : focus === "complex" ? "Lift the vertex clear of the axis" : focus === "flip" ? (s.a > 0 ? "Drag a below zero to flip it" : "Drag the roots to −1 and 3") : null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_320px]">
      <LabStyles />
      <div className="flex min-h-0 flex-col gap-3">
        <div className="relative">
          <Plot
            curves={curves}
            view={QVIEW}
            height={380}
            ariaLabel={`y = ${s.a}x² + ${s.b}x + ${s.c}`}
            overlay={(m) => {
              const hand = demoHand(m, demo, s, { a, b, c });
              return (
                <g>
                  {q.vertex && <line x1={m.X(q.vertex.x)} y1={0} x2={m.X(q.vertex.x)} y2={m.h} stroke="rgba(255,194,61,.45)" strokeDasharray="6 5" pointerEvents="none" />}
                  {/* tangent at x = 0 (slope b) */}
                  <line x1={m.X(-1.4)} y1={m.Y(c - 1.4 * b)} x2={m.X(1.4)} y2={m.Y(c + 1.4 * b)} stroke={V3.mint} strokeOpacity={drag?.what === "b" ? 0.9 : 0.35} strokeDasharray="5 5" strokeWidth={1.5} pointerEvents="none" />
                  {/* roots */}
                  <AnimatePresence>
                    {roots.map((r, i) => (
                      <motion.g key={roots.length === 1 ? "one" : `r${i}`} initial={{ scale: 0 }} animate={{ scale: roots.length === 1 && !reduced ? [1.8, 1] : 1 }} exit={{ scale: 0 }} style={{ originX: `${m.X(r)}px`, originY: `${m.Y(0)}px` }}>
                        <DragHandle
                          label={`Root at x = ${sf(r)}. Drag along the axis; the other root stays put.`}
                          valueText={`x = ${sf(r)}`}
                          value={r}
                          disabled={ro || Math.abs(a) < 1e-9}
                          ring={{ cx: m.X(r), cy: m.Y(0), r: 8 }}
                          pulse={rPulse}
                          onDrag={(p) => {
                            const other = roots.length === 2 ? roots[1 - i]! : r;
                            const nr = sd(m.invX(p.x));
                            const A = base().a;
                            setDrag({ a: A, b: r2(-A * (nr + other)), c: r2(A * nr * other), what: "root" });
                          }}
                          onDragEnd={(_p, moved) => moved && drag && commit(drag)}
                          onKey={(key, shift) => {
                            const st = shift ? 1 : 0.1;
                            const d = key === "ArrowRight" ? st : key === "ArrowLeft" ? -st : 0;
                            if (!d) return false;
                            const other = roots.length === 2 ? roots[1 - i]! : r;
                            const nr = s1(r + d);
                            const A = base().a;
                            const n = { a: A, b: r2(-A * (nr + other)), c: r2(A * nr * other), what: "root" };
                            setDrag(n);
                            commitLater(n);
                            return true;
                          }}
                        >
                          <circle cx={m.X(r)} cy={m.Y(0)} r={16} fill="transparent" />
                          <circle cx={m.X(r)} cy={m.Y(0)} r={7.5} fill="#ff6b6b" stroke="#fff" strokeWidth={2} />
                        </DragHandle>
                      </motion.g>
                    ))}
                  </AnimatePresence>
                  {/* y-intercept: c */}
                  <DragHandle
                    label={`y-intercept c = ${sf(c)}. Drag up or down.`}
                    valueText={`c = ${sf(c)}`}
                    value={c}
                    min={-10}
                    max={10}
                    disabled={ro}
                    ring={{ cx: m.X(0), cy: m.Y(c), r: 6 }}
                    onDrag={(p) => setDrag({ ...base(), c: r2(sd(m.invY(p.y))), what: "c" })}
                    onDragEnd={(_p, moved) => moved && drag && commit(drag)}
                    onKey={(key, shift) => {
                      const d = key === "ArrowUp" ? 1 : key === "ArrowDown" ? -1 : 0;
                      if (!d) return false;
                      const n = { ...base(), c: r2(base().c + d * (shift ? 1 : 0.1)), what: "c" };
                      setDrag(n);
                      commitLater(n);
                      return true;
                    }}
                  >
                    <circle cx={m.X(0)} cy={m.Y(c)} r={14} fill="transparent" />
                    <circle cx={m.X(0)} cy={m.Y(c)} r={6} fill={V3.violet} stroke="#0b1430" strokeWidth={2.5} />
                  </DragHandle>
                  <text x={m.X(0) + 10} y={m.Y(c) - 8} fontSize={11} fontWeight={700} fill="#d0bfff" pointerEvents="none">
                    c = {sf(c)}
                  </text>
                  {/* tangent handle: b */}
                  <DragHandle
                    label={`Slope at the y-axis, b = ${sf(b)}. Drag up or down.`}
                    valueText={`b = ${sf(b)}`}
                    value={b}
                    min={-10}
                    max={10}
                    disabled={ro}
                    ring={{ cx: m.X(1), cy: m.Y(c + b), r: 5 }}
                    onDrag={(p) => {
                      const cur = base();
                      setDrag({ ...cur, b: r2(sd(m.invY(p.y) - cur.c)), what: "b" });
                    }}
                    onDragEnd={(_p, moved) => moved && drag && commit(drag)}
                    onKey={(key, shift) => {
                      const d = key === "ArrowUp" ? 1 : key === "ArrowDown" ? -1 : 0;
                      if (!d) return false;
                      const n = { ...base(), b: r2(base().b + d * (shift ? 1 : 0.1)), what: "b" };
                      setDrag(n);
                      commitLater(n);
                      return true;
                    }}
                  >
                    <circle cx={m.X(1)} cy={m.Y(c + b)} r={13} fill="transparent" />
                    <rect x={m.X(1) - 5} y={m.Y(c + b) - 5} width={10} height={10} rx={2} fill={V3.mint} stroke="#0b1430" strokeWidth={2} transform={`rotate(45 ${m.X(1)} ${m.Y(c + b)})`} />
                  </DragHandle>
                  {/* shoulder handle: a */}
                  {q.vertex && (
                    <DragHandle
                      label={`Steepness a = ${sf(a)}. Drag up or down; the vertex stays put.`}
                      valueText={`a = ${sf(a)}`}
                      value={a}
                      min={-10}
                      max={10}
                      disabled={ro}
                      ring={{ cx: m.X(q.vertex.x + 1), cy: m.Y(q.vertex.y + a), r: 6 }}
                      pulse={aPulse}
                      onDragStart={() => q.vertex && (anchor.current = { h: q.vertex.x, k: q.vertex.y })}
                      onDrag={(p) => {
                        const A = Math.max(-10, Math.min(10, sd(m.invY(p.y) - anchor.current.k)));
                        setDrag({ ...fromVertex(A, anchor.current.h, anchor.current.k), what: "a" });
                      }}
                      onDragEnd={(_p, moved) => moved && drag && commit(drag)}
                      onKey={(key, shift) => {
                        const d = key === "ArrowUp" ? 1 : key === "ArrowDown" ? -1 : 0;
                        if (!d || !q.vertex) return false;
                        const A = Math.max(-10, Math.min(10, s1(base().a + d * (shift ? 1 : 0.1))));
                        if (Math.abs(A) < 1e-9) return true;
                        const n = { ...fromVertex(A, q.vertex.x, q.vertex.y), what: "a" };
                        setDrag(n);
                        commitLater(n);
                        return true;
                      }}
                    >
                      <circle cx={m.X(q.vertex.x + 1)} cy={m.Y(q.vertex.y + a)} r={14} fill="transparent" />
                      <circle cx={m.X(q.vertex.x + 1)} cy={m.Y(q.vertex.y + a)} r={6} fill="#0b1430" stroke={V3.cyan} strokeWidth={3} />
                      <text x={m.X(q.vertex.x + 1) + 9} y={m.Y(q.vertex.y + a) + 4} fontSize={11} fontWeight={800} fill={V3.cyan}>
                        a
                      </text>
                    </DragHandle>
                  )}
                  {/* vertex */}
                  {q.vertex && (
                    <DragHandle
                      label={`Vertex at (${sf(q.vertex.x)}, ${sf(q.vertex.y)}). Drag it, or use the arrow keys.`}
                      valueText={`(${sf(q.vertex.x)}, ${sf(q.vertex.y)})`}
                      disabled={ro}
                      ring={{ cx: m.X(q.vertex.x), cy: m.Y(q.vertex.y), r: 9 }}
                      pulse={vPulse}
                      onDrag={(p) => setDrag({ ...fromVertex(base().a, sd(m.invX(p.x)), sd(m.invY(p.y))), what: "vertex" })}
                      onDragEnd={(_p, moved) => moved && drag && commit(drag)}
                      onKey={(key, shift) => {
                        const st = shift ? 1 : 0.1;
                        const v = q.vertex!;
                        const d: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] };
                        if (!d[key]) return false;
                        const n = { ...fromVertex(base().a, s1(v.x + d[key]![0]), s1(v.y + d[key]![1])), what: "vertex" };
                        setDrag(n);
                        commitLater(n);
                        return true;
                      }}
                    >
                      <circle cx={m.X(q.vertex.x)} cy={m.Y(q.vertex.y)} r={18} fill="transparent" />
                      <circle cx={m.X(q.vertex.x)} cy={m.Y(q.vertex.y)} r={drag?.what === "vertex" ? 10 : 8} fill={V3.amber} stroke="#0b1430" strokeWidth={3} style={{ transition: "r .15s" }} />
                    </DragHandle>
                  )}
                  {q.vertex && (
                    <text x={m.X(q.vertex.x) + 14} y={m.Y(q.vertex.y) + (a > 0 ? 22 : -14)} fontSize={12} fontWeight={700} fill="#ffe08a" pointerEvents="none" fontFamily="JetBrains Mono, monospace">
                      ({sf(q.vertex.x)}, {sf(q.vertex.y)})
                    </text>
                  )}
                  {tip && q.vertex && <Tag x={Math.min(m.w - 120, Math.max(120, m.X(q.vertex.x)))} y={Math.max(24, Math.min(m.h - 24, m.Y(q.vertex.y) + (a > 0 ? 50 : -50)))} text={tip} />}
                  <GhostHand at={hand.at} pressing={hand.pressing} follow={hand.follow} />
                </g>
              );
            }}
          />
          {Math.abs(s.a) < 1e-9 && <span className="absolute left-3 top-3 rounded-full bg-[#ffc23d] px-2.5 py-1 text-xs font-bold text-black">No longer quadratic: a = 0 gives a straight line</span>}
          <div className="pointer-events-none absolute right-3 top-3 rounded-[12px] bg-[#060d1f]/80 px-3 py-1.5 font-mono text-[15px] font-bold text-white ring-1 ring-inset ring-[rgba(140,180,255,.2)]">
            y = <span style={{ color: V3.cyan }}>{sf(a)}</span>x² {b < 0 ? "−" : "+"} <span style={{ color: V3.mint }}>{sf(Math.abs(b))}</span>x {c < 0 ? "−" : "+"} <span style={{ color: V3.violet }}>{sf(Math.abs(c))}</span>
          </div>
          <div className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-[#8fa6d1]">Drag the vertex, roots, intercept (c), tangent (b) or shoulder (a). Drag empty space to pan.</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Panel title="Discriminant b² − 4ac">
            <DiscGauge disc={b * b - 4 * a * c} />
          </Panel>
          <Panel title="Roots in the complex plane">
            <ComplexInset roots={q.roots} />
          </Panel>
        </div>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Coefficients">
          <div className="space-y-3">
            <ParamSlider guideId="param:a" label="a" value={s.a} min={-10} max={10} step={0.1} onCommit={(v) => set("a", v)} disabled={ro} sweep />
            <ParamSlider guideId="param:b" label="b" value={s.b} min={-10} max={10} step={0.1} onCommit={(v) => set("b", v)} disabled={ro} sweep />
            <ParamSlider guideId="param:c" label="c" value={s.c} min={-10} max={10} step={0.1} onCommit={(v) => set("c", v)} disabled={ro} sweep />
          </div>
        </Panel>
        <Panel title="Read the roots" glow={!ro && focus === "roots"}>
          <p className="mb-2 text-xs text-[#8fa6d1]">Where does the curve cross the x-axis?</p>
          <div className="space-y-2">
            <ReadingInput label="First root" onRecord={(v) => session.dispatch("param.set", { key: "result:root1", value: v })} value={submitted(session.events, "result:root1")} disabled={ro} />
            <ReadingInput label="Second root" onRecord={(v) => session.dispatch("param.set", { key: "result:root2", value: v })} value={submitted(session.events, "result:root2")} disabled={ro} />
          </div>
        </Panel>
        <div className="grid grid-cols-2 gap-2">
          <Readout label="Vertex x = −b/2a" value={qTrue.vertex ? sf(qTrue.vertex.x) : "–"} />
          <Readout label="Roots" value={qTrue.roots.kind === "two" ? "two" : qTrue.roots.kind === "one" ? "one" : qTrue.roots.kind === "complex" ? "complex pair" : "line"} />
        </div>
        <Readout label="Discriminant" value={Number.isFinite(disc) ? sf(disc) : "–"} tone={disc > 0 ? "good" : disc < 0 ? "bad" : "warn"} />
      </div>
    </div>
  );
}

/** Where the demo hand sits on the quadratic plot for the upcoming coefficient change. */
function demoHand(m: Mapper, demo: ReturnType<typeof useDemoPreview>, s: QuadState, now: Coef): { at: Pt | null; pressing: boolean; follow: boolean } {
  const key = demo.next?.type === "param.set" ? (demo.next.payload as { key: string }).key : null;
  if (key !== "a" && key !== "b" && key !== "c") return { at: null, pressing: false, follow: false };
  const press = demo.k > 0.25;
  const follow = demo.k > 0.3;
  if (key === "c") return { at: { x: m.X(0), y: m.Y(now.c) }, pressing: press, follow };
  if (key === "b") return { at: { x: m.X(1), y: m.Y(now.c + now.b) }, pressing: press, follow };
  const v = quadratic(now.a, now.b, now.c).vertex ?? quadratic(s.a, s.b, s.c).vertex;
  return { at: v ? { x: m.X(v.x + 1), y: m.Y(v.y + now.a) } : null, pressing: press, follow };
}

function DiscGauge({ disc }: { disc: number }) {
  const v = Number.isFinite(disc) ? Math.max(-1, Math.min(1, Math.sign(disc) * Math.min(1, Math.abs(disc) / 40))) : 0;
  return (
    <svg viewBox="0 0 200 110" className="mx-auto block max-h-[130px] w-full" role="meter" aria-label={`Discriminant ${sf(disc)}`} aria-valuenow={Number.isFinite(disc) ? disc : 0}>
      <path d="M 20 100 A 80 80 0 0 1 100 20" stroke="#ff8a96" strokeWidth={10} fill="none" opacity={0.55} strokeLinecap="round" />
      <path d="M 100 20 A 80 80 0 0 1 180 100" stroke={V3.mint} strokeWidth={10} fill="none" opacity={0.55} strokeLinecap="round" />
      <line x1={100} y1={12} x2={100} y2={30} stroke={V3.amber} strokeWidth={3} />
      <g style={{ transform: `rotate(${v * 90}deg)`, transformOrigin: "100px 100px" }}>
        <line x1={100} y1={100} x2={100} y2={32} stroke="#fff" strokeWidth={3} strokeLinecap="round" />
      </g>
      <circle cx={100} cy={100} r={5} fill="#fff" />
      <text x={22} y={108} fontSize={9} fill="#ffa8b1">
        complex
      </text>
      <text x={178} y={108} fontSize={9} fill="#8cf0c9" textAnchor="end">
        two real
      </text>
      <text x={100} y={76} fontSize={14} fontWeight={800} textAnchor="middle" fill="#fff" fontFamily="JetBrains Mono, monospace">
        {Number.isFinite(disc) ? sf(disc) : "–"}
      </text>
    </svg>
  );
}

function ComplexInset({ roots }: { roots: ReturnType<typeof quadratic>["roots"] }) {
  const pts = roots.kind === "two" ? [{ re: roots.r1, im: 0 }, { re: roots.r2, im: 0 }] : roots.kind === "one" ? [{ re: roots.r, im: 0 }] : roots.kind === "complex" ? [{ re: roots.re, im: roots.im }, { re: roots.re, im: -roots.im }] : [];
  const k = 12;
  return (
    <svg viewBox="-100 -55 200 110" className="mx-auto block max-h-[130px] w-full" role="img" aria-label={roots.kind === "complex" ? `Complex roots ${sf(roots.re)} ± ${sf(roots.im)}i` : "Real roots on the real axis"}>
      <line x1={-95} y1={0} x2={95} y2={0} stroke="rgba(255,255,255,.4)" />
      <line x1={0} y1={-50} x2={0} y2={50} stroke="rgba(255,255,255,.4)" />
      <text x={92} y={-4} fontSize={8} fill="rgba(255,255,255,.5)" textAnchor="end">
        Re
      </text>
      <text x={4} y={-44} fontSize={8} fill="rgba(255,255,255,.5)">
        Im
      </text>
      {pts.map((p, i) => (
        <circle key={i} r={4.5} fill={p.im ? V3.violet : "#ff6b6b"} cx={Math.max(-90, Math.min(90, p.re * k))} cy={Math.max(-48, Math.min(48, -p.im * k))} />
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

const PIV = { x: 300, y: 104 };
const ARM = 190;
const HANG = 74;
type Item = { side: "left" | "right"; kind: "x" | "k"; i: number };
const bagPos = (px: number, py: number, i: number) => ({ x: px - 66 + (i % 4) * 25, y: py - 34 - Math.floor(i / 4) * 32 });
const unitPos = (px: number, py: number, i: number) => ({ x: px + 8 + (i % 6) * 10.5, y: py - 12 - Math.floor(i / 6) * 10.5 });

/**
 * Balance-scale equations. Lift a weight or an x-bag off a pan and drop it in the tray: its twin on
 * the other pan comes off too (the scale stays level). Drag a +1 or x from the supply onto a pan to
 * add to both sides, or a ÷ token onto the beam to share both sides into equal groups. The panel
 * still allows one-sided moves, so the scale can be seen to tip.
 */
export function BalanceWorkspace({ session }: { session: SimSession<BalanceState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as BalanceSetup;
  const ro = session.readOnly;
  const focus = useFocusStep(session);
  const demo = useDemoPreview(session, 1200);
  const [op, setOp] = useState<"+" | "-" | "*" | "/">("-");
  const [arg, setArg] = useState("4");
  const [where, setWhere] = useState<"both" | "left" | "right">("both");
  const orig = setup.equations[s.eq]!;
  const x = (orig[1].k - orig[0].k) / (orig[0].x - orig[1].x);
  const lv = s.left.x * x + s.left.k;
  const rv = s.right.x * x + s.right.k;
  const tilt = useEased(s.level ? 0 : Math.max(-14, Math.min(14, (rv - lv) * 1.5)), 700);
  const validArg = arg.trim() === "x" ? op === "+" || op === "-" : Number.isFinite(Number(arg)) && arg.trim() !== "";
  const apply = (value: string) => !ro && session.dispatch("param.set", { key: "op", value });
  const solvedHere = s.solved.includes(s.eq);
  const answered = s.eq === 0 ? s.results.x1 !== undefined : s.results.x2 !== undefined;

  // pans hang straight down from the beam ends
  const t = (tilt * Math.PI) / 180;
  const ends = { left: { x: PIV.x - ARM * Math.cos(t), y: PIV.y - ARM * Math.sin(t) + HANG + 18 }, right: { x: PIV.x + ARM * Math.cos(t), y: PIV.y + ARM * Math.sin(t) + HANG + 18 } };

  /* drag state */
  const [held, setHeld] = useState<{ item: Item | { supply: "k" | "x" } | { div: number }; p: Pt } | null>(null);
  const [bad, setBad] = useState(0);
  const onPan = (p: Pt, side: "left" | "right") => Math.abs(p.x - ends[side].x) < 90 && p.y > ends[side].y - 110 && p.y < ends[side].y + 30;
  const onBeam = (p: Pt) => Math.abs(p.x - PIV.x) < 230 && Math.abs(p.y - PIV.y) < 60;
  const signOf = (side: Side, kind: "x" | "k") => ((kind === "x" ? side.x : side.k) < 0 ? -1 : 1);
  const drop = (p: Pt) => {
    if (!held) return;
    const h = held.item;
    if ("div" in h) {
      if (onBeam(p)) apply(`both:/${h.div}`);
    } else if ("supply" in h) {
      if (onPan(p, "left") || onPan(p, "right")) apply(`both:+${h.supply === "x" ? "x" : 1}`);
    } else {
      const other = h.side === "left" ? "right" : "left";
      if (onPan(p, other)) setBad((b) => b + 1);
      else if (!onPan(p, h.side)) {
        const sg = signOf(h.side === "left" ? s.left : s.right, h.kind);
        apply(`both:${sg > 0 ? "-" : "+"}${h.kind === "x" ? "x" : 1}`);
      }
    }
    setHeld(null);
  };

  /* demo: which items are about to come off, and the hand */
  const nextOp = paramOf(demo.next, "op");
  const nOp = typeof nextOp === "string" && nextOp.startsWith("both:") ? nextOp.slice(5) : null;
  const kk = easeInOut(Math.max(0, (demo.k - 0.3) / 0.7));
  let lifting: { kind: "x" | "k"; n: number; k: number } | null = null;
  let hand: Pt | null = null;
  let pressing = false;
  let follow = false;
  const bin = { x: PIV.x, y: 384 };
  if (nOp) {
    const m = /^([+\-*/])(\d+(?:\.\d+)?|x)$/.exec(nOp);
    if (m && m[1] === "-") {
      const kind = m[2] === "x" ? "x" : "k";
      const n = kind === "x" ? 1 : Number(m[2]);
      lifting = { kind, n, k: kk };
      const L = s.left;
      const count = Math.abs(kind === "x" ? L.x : L.k);
      const start = kind === "x" ? bagPos(ends.left.x, ends.left.y, Math.max(0, Math.ceil(count) - 1)) : unitPos(ends.left.x, ends.left.y, Math.max(0, count - 1));
      hand = { x: mix(start.x + 6, bin.x, kk), y: mix(start.y, bin.y - 20, kk) };
      pressing = demo.k > 0.25;
      follow = demo.k > 0.3;
    } else if (m && m[1] === "/") {
      const chip = divChip(Number(m[2]));
      hand = { x: mix(chip.x, PIV.x, kk), y: mix(chip.y, PIV.y + 14, kk) };
      pressing = demo.k > 0.25;
      follow = demo.k > 0.3;
    } else if (m && m[1] === "+") {
      const sp = m[2] === "x" ? SUPPLY.x : SUPPLY.k;
      hand = { x: mix(sp.x, ends.left.x, kk), y: mix(sp.y, ends.left.y - 30, kk) };
      pressing = demo.k > 0.25;
      follow = demo.k > 0.3;
    }
  }
  const heldItem = held && "side" in held.item ? held.item : null;
  const g = !ro ? focus : null;
  const lead = g === "isolate-1" || g === "collect-2" || g === "solve-1" || g === "solve-2";
  const tipText = g === "isolate-1" ? "Take the loose weights off: they come off both pans" : g === "collect-2" ? "Take an x-bag off both pans" : g === "solve-1" || g === "solve-2" ? "Drag a ÷ token onto the beam" : null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_320px]">
      <LabStyles />
      <Stage className={`flex min-h-[340px] flex-col ${bad ? "ls-shake" : ""}`} key={`stage-${bad}`}>
        <div className="ls-h pt-4 text-center text-[26px] font-bold text-white" aria-live="polite">
          {sideText(s.left)} <span className={s.level ? "text-[#3de8a8]" : "text-[#ff8a96]"}>{s.level ? "=" : "≠"}</span> {sideText(s.right)}
        </div>
        <svg viewBox="0 0 600 420" className="w-full flex-1 select-none" role="group" aria-label={s.level ? "The scale is level" : "The scale has tipped"}>
          <defs>
            <linearGradient id="bl-beam" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#dbe2ee" />
              <stop offset="1" stopColor="#8794ad" />
            </linearGradient>
            <linearGradient id="bl-bag" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#b69cff" />
              <stop offset="1" stopColor="#7048e8" />
            </linearGradient>
          </defs>
          {/* stand */}
          <polygon points={`${PIV.x},${PIV.y} ${PIV.x - 30},330 ${PIV.x + 30},330`} fill="#2b3142" stroke="#5b6680" />
          <rect x={PIV.x - 80} y={326} width={160} height={10} rx={4} fill="#1b2236" />
          {/* drop zones */}
          {held && "div" in held.item && <rect x={PIV.x - 230} y={PIV.y - 40} width={460} height={80} rx={16} fill={onBeam(held.p) ? "rgba(61,232,168,.12)" : "rgba(57,214,255,.06)"} stroke={onBeam(held.p) ? V3.mint : V3.cyan} strokeDasharray="6 5" className="ls-breathe" />}
          {held && "supply" in held.item && (["left", "right"] as const).map((sd) => <rect key={sd} x={ends[sd].x - 90} y={ends[sd].y - 110} width={180} height={140} rx={16} fill={onPan(held.p, sd) ? "rgba(61,232,168,.12)" : "rgba(57,214,255,.06)"} stroke={onPan(held.p, sd) ? V3.mint : V3.cyan} strokeDasharray="6 5" />)}
          {/* beam */}
          <g transform={`rotate(${tilt} ${PIV.x} ${PIV.y})`}>
            <rect x={PIV.x - ARM - 12} y={PIV.y - 6} width={(ARM + 12) * 2} height={12} rx={6} fill="url(#bl-beam)" />
            <rect x={PIV.x - 3} y={PIV.y - 34} width={6} height={30} rx={3} fill={s.level ? V3.mint : V3.red} />
          </g>
          <circle cx={PIV.x} cy={PIV.y} r={8} fill={V3.amber} />
          {(["left", "right"] as const).map((sd) => (
            <PanView
              key={sd}
              side={sd}
              at={ends[sd]}
              val={sd === "left" ? s.left : s.right}
              ro={ro}
              held={held}
              heldItem={heldItem}
              lifting={lifting}
              pulse={lead && (g === "collect-2" ? "x" : g === "isolate-1" ? "k" : null)}
              onPick={(item, p) => setHeld({ item, p })}
              onMove={(p) => setHeld((h) => (h ? { ...h, p } : h))}
              onDrop={drop}
              onKeyOp={(v) => apply(v)}
            />
          ))}
          {/* tray / bin */}
          <rect x={bin.x - 110} y={bin.y - 18} width={220} height={30} rx={10} fill={heldItem && !onPan(held!.p, "left") && !onPan(held!.p, "right") ? "rgba(255,194,61,.16)" : "rgba(4,10,28,.6)"} stroke={heldItem ? V3.amber : "rgba(140,180,255,.2)"} strokeDasharray={heldItem ? "6 5" : undefined} />
          <text x={bin.x} y={bin.y + 2} textAnchor="middle" fontSize={11} fontWeight={700} fill={heldItem ? V3.amber : "#8fa6d1"}>
            {heldItem ? "drop here: off both pans" : "tray"}
          </text>
          {/* supply */}
          <SupplyItem kind="k" ro={ro} held={held} onPick={(p) => setHeld({ item: { supply: "k" }, p })} onMove={(p) => setHeld((h) => (h ? { ...h, p } : h))} onDrop={drop} onKey={() => apply("both:+1")} />
          <SupplyItem kind="x" ro={ro} held={held} onPick={(p) => setHeld({ item: { supply: "x" }, p })} onMove={(p) => setHeld((h) => (h ? { ...h, p } : h))} onDrop={drop} onKey={() => apply("both:+x")} />
          {/* divide tokens */}
          {[2, 3, 4, 5].map((n) => (
            <DivChip key={n} n={n} ro={ro} held={held} pulse={lead && (g === "solve-1" || g === "solve-2")} onPick={(p) => setHeld({ item: { div: n }, p })} onMove={(p) => setHeld((h) => (h ? { ...h, p } : h))} onDrop={drop} onKey={() => apply(`both:/${n}`)} />
          ))}
          {/* the thing being carried */}
          {held && (
            <g pointerEvents="none" transform={`translate(${held.p.x} ${held.p.y})`}>
              {"div" in held.item ? (
                <g>
                  <rect x={-22} y={-14} width={44} height={28} rx={9} fill="#0b1730" stroke={V3.amber} strokeWidth={2} />
                  <text y={5} textAnchor="middle" fontSize={14} fontWeight={800} fill={V3.amber}>
                    ÷{held.item.div}
                  </text>
                </g>
              ) : ("supply" in held.item ? held.item.supply : held.item.kind) === "x" ? (
                <BagShape x={-11} y={-15} />
              ) : (
                <rect x={-6} y={-6} width={12} height={12} rx={2} fill={V3.amber} stroke="#fff" />
              )}
            </g>
          )}
          {tipText && !held && <Tag x={PIV.x} y={34} text={tipText} />}
          <GhostHand at={hand} pressing={pressing} follow={follow} />
        </svg>
        {!s.level && <div className="absolute inset-x-6 bottom-3 rounded-[12px] border border-[#ff8a96] bg-[#c92a3e]/85 px-3 py-2 text-center text-sm font-semibold text-white">Tipped! You changed only one side. Undo it.</div>}
      </Stage>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Do something to the scale">
          <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Operation">
            {(["+", "-", "*", "/"] as const).map((o) => (
              <button key={o} type="button" role="radio" aria-checked={op === o} onClick={() => setOp(o)} disabled={ro} className="ls-chip h-10 justify-center text-base">
                {o === "*" ? "×" : o === "/" ? "÷" : o === "-" ? "−" : "+"}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-end gap-2">
            <label className="text-[11px] font-semibold text-[#c8d6f3]">
              by (a number or x)
              <input value={arg} onChange={(e) => setArg(e.target.value)} className="mt-0.5 block h-10 w-20 rounded-[11px] border border-[rgba(140,180,255,.16)] bg-[#040a1c]/60 px-2 font-mono text-sm text-white" disabled={ro} />
            </label>
            <div className="flex flex-1 gap-1" role="radiogroup" aria-label="Which side">
              {(["both", "left", "right"] as const).map((w) => (
                <button key={w} type="button" onClick={() => setWhere(w)} aria-checked={where === w} role="radio" disabled={ro} className="ls-chip h-10 flex-1 justify-center">
                  {w}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Btn tone="primary" onClick={() => apply(`${where}:${op}${arg.trim()}`)} disabled={ro || !validArg}>
              <Scale className="h-4 w-4" /> Apply
            </Btn>
            <Btn onClick={() => session.dispatch("param.set", { key: "undo", value: true })} disabled={ro || !s.history.length}>
              <RotateCcw className="h-4 w-4" /> Undo
            </Btn>
          </div>
          {s.history.length > 0 && <p className="mt-2 font-mono text-[11px] text-[#8fa6d1]">{s.history.map((h) => h.replace("both:", "both ").replace("*", "×").replace("/", "÷")).join("  →  ")}</p>}
        </Panel>
        <Panel title="Answer" glow={!ro && (focus === "answer-1" || focus === "answer-2")}>
          <ReadingInput label="x =" onRecord={(v) => session.dispatch("param.set", { key: s.eq === 0 ? "result:x1" : "result:x2", value: v })} value={submitted(session.events, s.eq === 0 ? "result:x1" : "result:x2")} disabled={ro} />
          {s.eq === 0 && solvedHere && answered && (
            <Btn tone="primary" className="mt-2 w-full" onClick={() => session.dispatch("param.set", { key: "equation", value: 1 })} disabled={ro}>
              <Check className="h-4 w-4" /> Next equation
            </Btn>
          )}
        </Panel>
        <Panel title="Equations">
          {setup.equations.map(([l, r], i) => (
            <p key={i} className={`font-mono text-sm ${i === s.eq ? "text-white" : "text-white/40"}`}>
              {i + 1}. {sideText(l)} = {sideText(r)} {s.solved.includes(i) && <Check className="inline h-3.5 w-3.5 text-[#3de8a8]" />}
            </p>
          ))}
        </Panel>
      </div>
    </div>
  );
}

const SUPPLY = { k: { x: 60, y: 384 }, x: { x: 100, y: 384 } };
const divChip = (n: number) => ({ x: 430 + (n - 2) * 40, y: 384 });

function BagShape({ x, y, frac = 1, faded }: { x: number; y: number; frac?: number; faded?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`} opacity={faded ? 0.5 : 1}>
      <path d={`M3 ${30 * (1 - frac) + 4} q8 -6 16 0 l3 ${26 * frac - 2} q-11 4 -22 0 z`} fill="url(#bl-bag)" stroke="#e5dbff" strokeWidth={1.2} />
      <text x={11} y={22} fontSize={12} fontWeight={800} fill="#fff" textAnchor="middle">
        {frac === 1 ? "x" : sf(frac, 2)}
      </text>
    </g>
  );
}

function PanView({ side, at, val, ro, held, heldItem, lifting, pulse, onPick, onMove, onDrop, onKeyOp }: { side: "left" | "right"; at: Pt; val: Side; ro: boolean; held: { p: Pt } | null; heldItem: Item | null; lifting: { kind: "x" | "k"; n: number; k: number } | null; pulse: "x" | "k" | null | false; onPick: (item: Item, p: Pt) => void; onMove: (p: Pt) => void; onDrop: (p: Pt) => void; onKeyOp: (v: string) => void }) {
  const bags = Math.abs(val.x);
  const units = Math.abs(val.k);
  const showUnits = Number.isInteger(units) && units <= 24;
  const nb = Math.ceil(bags);
  // the twin of the held item on this pan lifts with it
  const twin = (kind: "x" | "k", i: number, count: number) => heldItem && heldItem.side !== side && heldItem.kind === kind && i === count - 1;
  const liftOf = (kind: "x" | "k", i: number, count: number) => (lifting && lifting.kind === kind && i >= count - lifting.n ? lifting.k : 0);
  return (
    <g>
      <line x1={at.x} y1={at.y - HANG - 18} x2={at.x - 70} y2={at.y} stroke="#8794ad" />
      <line x1={at.x} y1={at.y - HANG - 18} x2={at.x + 70} y2={at.y} stroke="#8794ad" />
      <DragHandle
        role="button"
        label={`${side} pan: ${sideText(val)}. Press Delete to take one unit weight off both sides, X to take an x-bag off both sides, plus to add one to both.`}
        disabled={ro}
        onKey={(key) => {
          if (key === "Delete" || key === "Backspace" || key === "-") onKeyOp(`both:${val.k < 0 ? "+" : "-"}1`);
          else if (key === "x" || key === "X") onKeyOp(`both:${val.x < 0 ? "+" : "-"}x`);
          else if (key === "+" || key === "=") onKeyOp("both:+1");
          else return false;
          return true;
        }}
        ring={{ cx: at.x, cy: at.y - 20, r: 60 }}
      >
        <path d={`M ${at.x - 78} ${at.y} q 78 30 156 0 z`} fill="#5b6680" stroke="#2b3142" />
      </DragHandle>
      {Array.from({ length: nb }, (_, i) => {
        const frac = i === nb - 1 && !Number.isInteger(bags) ? bags - Math.floor(bags) : 1;
        const p = bagPos(at.x, at.y, i);
        const isHeld = heldItem?.side === side && heldItem.kind === "x" && i === nb - 1 && held;
        const tw = twin("x", i, nb);
        const lf = liftOf("x", i, nb);
        if (isHeld) return <BagShape key={`b${i}`} x={p.x} y={p.y} frac={frac} faded />;
        return (
          <PickItem key={`b${i}`} disabled={ro || i !== nb - 1 || frac !== 1} item={{ side, kind: "x", i }} onPick={onPick} onMove={onMove} onDrop={onDrop} pulse={pulse === "x" && i === nb - 1} at={{ x: p.x + 11, y: p.y + 15 }}>
            <g transform={`translate(0 ${-(tw ? 10 : 0) - lf * 30})`} opacity={1 - lf} className={tw ? "ls-breathe" : ""}>
              {tw && <rect x={p.x - 3} y={p.y - 2} width={28} height={36} rx={8} fill="none" stroke={V3.amber} strokeDasharray="3 3" />}
              <BagShape x={p.x} y={p.y} frac={frac} faded={val.x < 0} />
            </g>
          </PickItem>
        );
      })}
      {showUnits
        ? Array.from({ length: units }, (_, i) => {
            const p = unitPos(at.x, at.y, i);
            const isHeld = heldItem?.side === side && heldItem.kind === "k" && i === units - 1 && held;
            const tw = twin("k", i, units);
            const lf = liftOf("k", i, units);
            const fill = val.k < 0 ? "#ff8a96" : V3.amber;
            if (isHeld) return <rect key={`u${i}`} x={p.x} y={p.y} width={9.5} height={9.5} rx={1.5} fill={fill} opacity={0.3} />;
            return (
              <PickItem key={`u${i}`} disabled={ro || i !== units - 1} item={{ side, kind: "k", i }} onPick={onPick} onMove={onMove} onDrop={onDrop} pulse={pulse === "k" && i === units - 1} at={{ x: p.x + 5, y: p.y + 5 }}>
                <g transform={`translate(0 ${-(tw ? 8 : 0) - lf * 30})`} opacity={1 - lf}>
                  <rect x={p.x} y={p.y} width={9.5} height={9.5} rx={1.5} fill={fill} stroke={tw ? "#fff" : "rgba(0,0,0,.25)"} strokeWidth={tw ? 1.5 : 0.6} />
                </g>
              </PickItem>
            );
          })
        : units > 0 && (
            <text x={at.x + 34} y={at.y - 10} fontSize={16} fontWeight={800} fill={val.k < 0 ? "#ff8a96" : V3.amber} textAnchor="middle">
              {val.k < 0 ? "−" : ""}
              {sf(units)}
            </text>
          )}
    </g>
  );
}

function PickItem({ children, disabled, item, onPick, onMove, onDrop, pulse, at }: { children: React.ReactNode; disabled: boolean; item: Item; onPick: (item: Item, p: Pt) => void; onMove: (p: Pt) => void; onDrop: (p: Pt) => void; pulse: boolean; at: Pt }) {
  const down = useSvgDrag({ disabled, slop: 2, onStart: (p) => onPick(item, p), onMove: (p) => onMove(p), onEnd: (p) => onDrop(p) });
  return (
    <g onPointerDown={down} className={disabled ? "" : "ls-handle"}>
      {pulse && !disabled && <Pulse cx={at.x} cy={at.y} r={10} colour={V3.cyan} />}
      {children}
    </g>
  );
}

function SupplyItem({ kind, ro, held, onPick, onMove, onDrop, onKey }: { kind: "k" | "x"; ro: boolean; held: unknown; onPick: (p: Pt) => void; onMove: (p: Pt) => void; onDrop: (p: Pt) => void; onKey: () => void }) {
  const at = SUPPLY[kind];
  const down = useSvgDrag({ disabled: ro, slop: 2, onStart: (p) => onPick(p), onMove: (p) => onMove(p), onEnd: (p) => onDrop(p) });
  return (
    <g className="ls-handle" tabIndex={ro ? -1 : 0} role="button" aria-label={kind === "x" ? "Supply of x-bags. Drag one onto a pan, or press Enter, to add x to both sides." : "Supply of unit weights. Drag one onto a pan, or press Enter, to add 1 to both sides."} onPointerDown={down} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onKey())} opacity={held ? 0.6 : 1}>
      <rect x={at.x - 18} y={at.y - 20} width={36} height={34} rx={9} fill="rgba(4,10,28,.6)" stroke="rgba(140,180,255,.25)" />
      {kind === "x" ? <BagShape x={at.x - 11} y={at.y - 19} /> : <rect x={at.x - 6} y={at.y - 9} width={12} height={12} rx={2} fill={V3.amber} />}
      <text x={at.x} y={at.y + 26} fontSize={9} textAnchor="middle" fill="#8fa6d1">
        +{kind === "x" ? "x" : "1"}
      </text>
      <circle className="ls-focus" cx={at.x} cy={at.y - 3} r={22} fill="none" stroke={V3.cyan} strokeWidth={2} strokeDasharray="4 3" />
    </g>
  );
}

function DivChip({ n, ro, held, pulse, onPick, onMove, onDrop, onKey }: { n: number; ro: boolean; held: unknown; pulse: boolean; onPick: (p: Pt) => void; onMove: (p: Pt) => void; onDrop: (p: Pt) => void; onKey: () => void }) {
  const at = divChip(n);
  const down = useSvgDrag({ disabled: ro, slop: 2, onStart: (p) => onPick(p), onMove: (p) => onMove(p), onEnd: (p) => onDrop(p) });
  return (
    <g className="ls-handle" tabIndex={ro ? -1 : 0} role="button" aria-label={`Divide both sides by ${n}. Drag onto the beam, or press Enter.`} onPointerDown={down} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onKey())} opacity={held ? 0.6 : 1}>
      {pulse && <Pulse cx={at.x} cy={at.y - 2} r={16} colour={V3.amber} />}
      <rect x={at.x - 17} y={at.y - 16} width={34} height={28} rx={9} fill="#0b1730" stroke={V3.amber} strokeOpacity={0.7} />
      <text x={at.x} y={at.y + 3} textAnchor="middle" fontSize={13} fontWeight={800} fill={V3.amber}>
        ÷{n}
      </text>
      <circle className="ls-focus" cx={at.x} cy={at.y - 2} r={21} fill="none" stroke={V3.cyan} strokeWidth={2} strokeDasharray="4 3" />
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
const snapAngle = (d: number) => {
  const m = ((d % 360) + 360) % 360;
  const sp = SPECIAL.find((x) => Math.abs(x - m) <= 2);
  return sp === undefined ? Math.round(d) : d - m + sp;
};

/**
 * Unit circle. Grab the point and wind it round (past 360° too); it clicks onto the special angles.
 * The sine (height) and cosine (across) bars and their graphs unroll as you go.
 */
export function UnitCircleWorkspace({ session }: { session: SimSession<CircleState> }) {
  const s = session.state;
  const ro = session.readOnly;
  const focus = useFocusStep(session);
  const demo = useDemoPreview(session, 1100);
  const [local, setLocal] = useState<number | null>(null);
  const prev = useRef(s.angle);
  const commit = (d: number) => {
    const v = Math.max(0, Math.min(720, snapAngle(d)));
    setLocal(null);
    if (v !== s.angle) session.dispatch("param.set", { key: "angle", value: v });
  };
  const commitLater = useCommitLater(commit, 400);
  const nA = paramOf(demo.next, "angle");
  const kk = easeInOut(Math.max(0, (demo.k - 0.3) / 0.7));
  const deg = local ?? (typeof nA === "number" ? mix(s.angle, nA, kk) : s.angle);
  const snapped = local !== null ? snapAngle(local) : deg;
  const shown = local !== null ? Math.max(0, Math.min(720, snapped)) : deg;
  const isSpecial = SPECIAL.includes(((Math.round(shown) % 360) + 360) % 360) && Math.abs(shown - Math.round(shown)) < 1e-6;
  const r = (shown * Math.PI) / 180;
  const R = 120;
  const cx = 150;
  const cy = 170;
  const px = cx + Math.cos(r) * R;
  const py = cy - Math.sin(r) * R;
  const gw = 360;
  const gx0 = 320;
  const span = Math.max(360, s.maxAngle, shown);
  const toGx = (d: number) => gx0 + (d / span) * gw;
  const wave = (f: (a: number) => number, upTo: number) => Array.from({ length: Math.max(2, Math.ceil(upTo)) + 1 }, (_, i) => Math.min(i, upTo)).map((d, i) => `${i ? "L" : "M"} ${toGx(d).toFixed(1)} ${(cy - f((d * Math.PI) / 180) * R).toFixed(1)}`).join(" ");
  const angleLabel = s.units === "rad" ? `${radLabel(Math.round(shown))} rad` : `${Math.round(shown)}°`;
  const tip = focus === "thirty" ? "Drag the point to 30°" : focus === "quadrant" ? "Drag into the second quadrant (90°–180°)" : focus === "equal" ? "Find where the two bars match" : focus === "period" ? "Keep winding past 360°" : null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_300px]">
      <LabStyles />
      <Stage className="min-h-[340px]">
        <svg viewBox="0 0 700 340" className="h-full w-full select-none" role="group" aria-label={`Unit circle at ${angleLabel}`}>
          {Array.from({ length: 21 }, (_, i) => (
            <g key={i}>
              <line x1={cx - R} y1={cy - R + i * (R / 10)} x2={toGx(span)} y2={cy - R + i * (R / 10)} stroke={i === 10 ? "rgba(220,232,255,.5)" : "rgba(140,170,230,.09)"} />
              {i % 5 === 0 && (
                <text x={cx - R - 6} y={cy - R + i * (R / 10) + 4} fontSize={10} fill="rgba(220,232,255,.5)" textAnchor="end" fontFamily="JetBrains Mono, monospace">
                  {(1 - i / 10).toFixed(1)}
                </text>
              )}
            </g>
          ))}
          {Array.from({ length: 21 }, (_, i) => (
            <line key={`v${i}`} x1={cx - R + i * (R / 10)} y1={cy - R} x2={cx - R + i * (R / 10)} y2={cy + R} stroke={i === 10 ? "rgba(220,232,255,.5)" : "rgba(140,170,230,.09)"} />
          ))}
          <circle cx={cx} cy={cy} r={R} fill="rgba(61,139,255,.05)" stroke="rgba(220,232,255,.55)" strokeWidth={1.5} />
          {/* special-angle ticks */}
          {SPECIAL.slice(0, -1).map((d) => {
            const a = (d * Math.PI) / 180;
            const on = isSpecial && ((Math.round(shown) % 360) + 360) % 360 === d;
            return <line key={d} x1={cx + Math.cos(a) * (R - 6)} y1={cy - Math.sin(a) * (R - 6)} x2={cx + Math.cos(a) * (R + 6)} y2={cy - Math.sin(a) * (R + 6)} stroke={on ? V3.amber : "rgba(220,232,255,.35)"} strokeWidth={on ? 3 : 1.2} />;
          })}
          <path d={`M ${cx + 24} ${cy} A 24 24 0 ${(((shown % 360) + 360) % 360) > 180 ? 1 : 0} 0 ${cx + 24 * Math.cos(r)} ${cy - 24 * Math.sin(r)}`} fill="none" stroke={V3.amber} strokeWidth={2} />
          <line x1={cx} y1={cy} x2={px} y2={py} stroke="#fff" strokeWidth={2.5} />
          <line x1={px} y1={py} x2={px} y2={cy} stroke="#ff6b6b" strokeWidth={4} strokeLinecap="round" />
          <line x1={cx} y1={cy} x2={px} y2={cy} stroke="#4dabf7" strokeWidth={4} strokeLinecap="round" />
          <line x1={px} y1={py} x2={toGx(shown)} y2={py} stroke="rgba(255,107,107,.35)" strokeDasharray="4 4" />
          <path d={wave(Math.sin, shown)} stroke="#ff6b6b" strokeWidth={2.5} fill="none" />
          <path d={wave(Math.cos, shown)} stroke="#4dabf7" strokeWidth={2.5} fill="none" />
          {[90, 180, 270, 360, ...(span > 360 ? [540, 720].filter((d) => d <= span) : [])].map((d) => (
            <text key={d} x={toGx(d)} y={cy + R + 16} fontSize={10} fill="rgba(220,232,255,.5)" textAnchor="middle" fontFamily="JetBrains Mono, monospace">
              {s.units === "rad" ? radLabel(d) : `${d}°`}
            </text>
          ))}
          <text x={cx} y={cy + R + 34} textAnchor="middle" fontSize={15} fontWeight={800} fill={isSpecial ? V3.amber : "#ffe08a"} fontFamily="JetBrains Mono, monospace">
            θ = {angleLabel}
          </text>
          <text x={gx0} y={24} fontSize={11} fill="#ff8a96" fontWeight={700}>
            sin θ (height)
          </text>
          <text x={gx0 + 110} y={24} fontSize={11} fill="#74c0fc" fontWeight={700}>
            cos θ (across)
          </text>
          <DragHandle
            label="Point on the unit circle. Drag it round, or use the arrow keys (Shift for 15°). It snaps to special angles."
            valueText={angleLabel}
            value={Math.round(shown)}
            min={0}
            max={720}
            disabled={ro}
            ring={{ cx: px, cy: py, r: 10 }}
            pulse={!ro && local === null && tip !== null}
            onDragStart={() => (prev.current = s.angle)}
            onDrag={(p) => {
              let a = (Math.atan2(cy - p.y, p.x - cx) * 180) / Math.PI;
              if (a < 0) a += 360;
              const base = prev.current;
              let delta = a - (((base % 360) + 360) % 360);
              if (delta > 180) delta -= 360;
              if (delta < -180) delta += 360;
              const next = Math.max(0, Math.min(720, base + delta));
              prev.current = next;
              setLocal(next);
            }}
            onDragEnd={(_p, moved) => moved && local !== null && commit(local)}
            onKey={(key, shift) => {
              const st = shift ? 15 : 1;
              const cur = local ?? s.angle;
              const next = key === "ArrowRight" || key === "ArrowUp" ? Math.min(720, cur + st) : key === "ArrowLeft" || key === "ArrowDown" ? Math.max(0, cur - st) : null;
              if (next === null) return false;
              setLocal(next);
              commitLater(next);
              return true;
            }}
          >
            <circle cx={px} cy={py} r={20} fill="transparent" />
            {isSpecial && <circle className="ls-snap" key={Math.round(shown)} cx={px} cy={py} r={14} fill="rgba(255,194,61,.2)" />}
            <circle cx={px} cy={py} r={local !== null ? 10 : 8.5} fill={V3.amber} stroke="#0b1430" strokeWidth={3} />
          </DragHandle>
          {tip && local === null && <Tag x={Math.max(110, Math.min(250, px))} y={py < cy ? py - 28 : py + 30} text={tip} />}
          <GhostHand at={typeof nA === "number" ? { x: px, y: py } : null} pressing={demo.k > 0.25} follow={demo.k > 0.3} />
        </svg>
      </Stage>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="Angle" glow={!ro && focus === "radians"}>
          <div className="mb-2 rounded-[12px] bg-[#040a1c]/55 px-3 py-2 ring-1 ring-inset ring-[rgba(140,180,255,.10)]">
            <div className="ls-kicker">θ</div>
            <div className="font-mono text-2xl font-bold text-[#ffc23d]">{s.units === "rad" ? `${radLabel(Math.round(shown))}` : <Num value={shown} digits={0} />}</div>
          </div>
          <ParamSlider guideId="param:angle" label="θ" value={s.angle} min={0} max={720} step={1} unit="°" onCommit={(v) => session.dispatch("param.set", { key: "angle", value: v })} disabled={ro} />
          <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Units">
            {(["deg", "rad"] as const).map((u) => (
              <button key={u} type="button" role="radio" aria-checked={s.units === u} className="ls-chip h-10 justify-center" onClick={() => session.dispatch("param.set", { key: "units", value: u })} disabled={ro}>
                {u === "deg" ? "Degrees" : "Radians"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[#8fa6d1]">Drag the point, or focus it and use the arrow keys (Shift for 15°).</p>
        </Panel>
        <Panel title="Read off the circle" glow={!ro && (focus === "thirty" || focus === "quadrant" || focus === "radians")}>
          <div className="space-y-2">
            <ReadingInput label="sin θ" onRecord={(v) => session.dispatch("measure.read", { instrument: "circle", reading: { key: "sin", value: v, unit: "" } })} value={submitted(session.events, "sin", "circle")} disabled={ro} />
            <ReadingInput label="cos θ" onRecord={(v) => session.dispatch("measure.read", { instrument: "circle", reading: { key: "cos", value: v, unit: "" } })} value={submitted(session.events, "cos", "circle")} disabled={ro} />
            <ReadingInput label="θ in radians" unit="rad" onRecord={(v) => session.dispatch("measure.read", { instrument: "circle", reading: { key: "rad", value: v, unit: "rad" } })} value={submitted(session.events, "rad", "circle")} disabled={ro} />
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
