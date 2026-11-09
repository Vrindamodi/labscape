import { Btn, easeInOut, LabStyles, mix, Panel, ParamSlider, paramOf, Readout, useDemoPreview, useFocusStep, V3, type SimSession } from "@labscape/physics";
import { Check, RotateCcw, Target } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { BASE_FNS, sameGraph, transformed, type BaseFn, type TransformParams, type TransformSetup, type TransformState } from "../labs/transformations";
import { Handle, Plot, useMorph, type Curve, type View } from "./Plot";

const VIEW: View = { x0: -7, x1: 7, y0: -6, y1: 6 };
type Key = "a" | "b" | "c" | "d";
const snapHalf = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v * 2) / 2));

/** Signed number for an equation: "+ 3", "− 2". */
const signed = (v: number) => (v < 0 ? `− ${fmt(-v)}` : `+ ${fmt(v)}`);
const fmt = (v: number) => String(Number(v.toFixed(2)));

/** The equation as the learner has set it, simplified where a parameter does nothing. */
export function equationText(p: TransformParams): string {
  const inner = p.c === 0 ? "x" : `x ${signed(-p.c)}`;
  const arg = p.b === 1 ? inner : p.c === 0 ? `${fmt(p.b)}x` : `${fmt(p.b)}(${inner})`;
  const f = p.f === "x^2" ? `(${arg})²` : p.f === "x^3" ? `(${arg})³` : p.f === "abs" ? `|${arg}|` : `sin(${arg})`;
  const body = (p.f === "x^2" || p.f === "x^3") && arg === "x" ? (p.f === "x^2" ? "x²" : "x³") : f;
  const a = p.a === 1 ? "" : p.a === -1 ? "−" : `${fmt(p.a)}`;
  return `y = ${a}${body}${p.d === 0 ? "" : ` ${signed(p.d)}`}`;
}

/**
 * Graph transformations: y = a·f(b(x − c)) + d. Sliders for a, b, c and d (or drag the key point,
 * which sets c and d); the dashed target graph is what to match. "Check match" compares the two
 * graphs point by point, so any parameters that draw the same graph count.
 */
export function TransformWorkspace({ session }: { session: SimSession<TransformState> }) {
  const s = session.state;
  const setup = session.content.setup as unknown as TransformSetup;
  const ro = session.readOnly;
  const focus = useFocusStep(session);
  const demo = useDemoPreview(session, 1100);
  const [drag, setDrag] = useState<Partial<Record<Key, number>>>({});
  const morph = { a: useMorph(s.a), b: useMorph(s.b), c: useMorph(s.c), d: useMorph(s.d) };
  const kk = easeInOut(Math.max(0, (demo.k - 0.3) / 0.7));
  const val = (k: Key) => {
    if (drag[k] !== undefined) return drag[k]!;
    const n = paramOf(demo.next, k);
    if (typeof n === "number") return mix(s[k], n, kk);
    return session.mode === "demo" ? s[k] : morph[k];
  };
  const p: TransformParams = { f: s.f, a: val("a"), b: val("b"), c: val("c"), d: val("d") };
  const target = setup.targets.find((t) => !s.matched.includes(t.id)) ?? null;
  const matchedNow = target ? sameGraph(s, target) : false;

  const curves = useMemo(() => {
    const out: Curve[] = [{ f: BASE_FNS[p.f].f, colour: "rgba(160,190,255,.28)", width: 1.5 }];
    if (target) out.push({ f: transformed(target), colour: V3.amber, width: 2.5, dash: [8, 6] });
    out.push({ f: transformed(p), colour: V3.cyan, width: 3 });
    return out;
  }, [p.f, p.a, p.b, p.c, p.d, target]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: string, value: number | string | boolean) => !ro && session.dispatch("param.set", { key, value });
  const commit = (k: Key, v: number) => {
    if (v !== s[k]) set(k, v);
    setDrag((d) => {
      const n = { ...d };
      delete n[k];
      return n;
    });
  };
  const pending = useRef<{ c: number; d: number } | null>(null);

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-3 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_330px]">
      <LabStyles />
      <div className="flex min-h-0 flex-col gap-3">
        <div className="relative">
          <Plot
            curves={curves}
            view={VIEW}
            height={400}
            lockZoom
            ariaLabel={`${equationText(s)}${target ? `. Target: ${target.label}` : ""}`}
            overlay={(m) => (
              <g>
                {/* the key point: (0, 0) of the base graph lands on (c, d) */}
                <line x1={m.X(p.c)} y1={m.Y(0)} x2={m.X(p.c)} y2={m.Y(p.d)} stroke="rgba(57,214,255,.35)" strokeDasharray="4 4" pointerEvents="none" />
                <line x1={m.X(0)} y1={m.Y(p.d)} x2={m.X(p.c)} y2={m.Y(p.d)} stroke="rgba(57,214,255,.35)" strokeDasharray="4 4" pointerEvents="none" />
                {ro ? (
                  <circle cx={m.X(p.c)} cy={m.Y(p.d)} r={7} fill={V3.cyan} stroke="#0b1430" strokeWidth={3} />
                ) : (
                  <Handle
                    m={m}
                    x={p.c}
                    y={p.d}
                    colour={V3.cyan}
                    keyStep={0.5}
                    label={`Key point at (${fmt(p.c)}, ${fmt(p.d)}). Drag to set c and d.`}
                    onDrag={(x, y) => {
                      const n = { c: snapHalf(x, -6, 6), d: snapHalf(y, -6, 6) };
                      pending.current = n;
                      setDrag((dd) => ({ ...dd, ...n }));
                    }}
                    onDragEnd={() => {
                      const n = pending.current;
                      pending.current = null;
                      if (!n) return;
                      commit("c", n.c);
                      commit("d", n.d);
                    }}
                  />
                )}
                <text x={m.X(p.c) + 10} y={m.Y(p.d) - 10} fontSize={11} fontWeight={700} fill="#bfefff" pointerEvents="none">
                  ({fmt(p.c)}, {fmt(p.d)})
                </text>
              </g>
            )}
          />
          <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
            <span className="rounded-[10px] bg-[#060d1f]/80 px-2.5 py-1 font-mono text-sm font-bold text-[#7cf3ff]">{equationText({ ...s })}</span>
            {target && <span className="rounded-[10px] bg-[#060d1f]/80 px-2.5 py-1 font-mono text-sm font-bold text-[#ffc23d]">target: {target.label}</span>}
          </div>
        </div>
        <Panel title="Base graph f(x)">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Base function">
            {(Object.keys(BASE_FNS) as BaseFn[]).map((f) => (
              <Btn key={f} guideId={`param:f=${f}`} pressed={s.f === f} tone={s.f === f ? "primary" : "secondary"} onClick={() => set("f", f)} disabled={ro}>
                y = {BASE_FNS[f].label}
              </Btn>
            ))}
          </div>
        </Panel>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel title="y = a · f(b(x − c)) + d" glow={!ro && !!focus}>
          <div className="space-y-3">
            <ParamSlider guideId="param:a" label="a · vertical stretch (negative flips over the x-axis)" value={s.a} min={-4} max={4} step={0.25} onChange={(v) => setDrag((d) => ({ ...d, a: v }))} onCommit={(v) => commit("a", v)} disabled={ro} />
            <ParamSlider guideId="param:b" label="b · horizontal squash by 1/b" value={s.b} min={-4} max={4} step={0.25} onChange={(v) => setDrag((d) => ({ ...d, b: v }))} onCommit={(v) => commit("b", v)} disabled={ro} />
            <ParamSlider guideId="param:c" label="c · slide right by c" value={s.c} min={-6} max={6} step={0.5} onChange={(v) => setDrag((d) => ({ ...d, c: v }))} onCommit={(v) => commit("c", v)} disabled={ro} />
            <ParamSlider guideId="param:d" label="d · slide up by d" value={s.d} min={-6} max={6} step={0.5} onChange={(v) => setDrag((d) => ({ ...d, d: v }))} onCommit={(v) => commit("d", v)} disabled={ro} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Btn guideId="param:check" tone="primary" onClick={() => set("check", true)} disabled={ro || !target}>
              <Check className="h-4 w-4" /> Check match
            </Btn>
            <Btn guideId="param:reset" onClick={() => set("reset", true)} disabled={ro}>
              <RotateCcw className="h-4 w-4" /> Reset a, b, c, d
            </Btn>
          </div>
          <div className="mt-2">
            <Readout label="Your graph" value={matchedNow ? "on the target" : target ? "not matching yet" : "all matched"} tone={matchedNow || !target ? "good" : "default"} />
          </div>
        </Panel>
        <Panel title={`Targets (${s.matched.length}/${setup.targets.length})`}>
          <ol className="space-y-1.5">
            {setup.targets.map((t) => {
              const done = s.matched.includes(t.id);
              const now = target?.id === t.id;
              return (
                <li key={t.id} className={`flex items-center gap-2 rounded-[10px] px-2 py-1.5 font-mono text-[13px] ${now ? "bg-[rgba(255,194,61,.12)] text-[#ffd98a]" : done ? "text-[#3de8a8]" : "text-white/50"}`}>
                  {done ? <Check className="h-4 w-4" /> : <Target className="h-4 w-4" />}
                  {t.label}
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-[11px] text-[#8fa6d1]">Outside the function (a, d) acts on y as you would expect. Inside (b, c) acts on x, and feels backwards.</p>
        </Panel>
      </div>
    </div>
  );
}
