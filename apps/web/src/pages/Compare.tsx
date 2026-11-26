import { useLabSession, Workbench, type ExperimentContent } from "@labscape/lab-engine";
import { Plot, type Mapper, type View } from "@labscape/mathlab";
import { ParamSlider, sf } from "@labscape/physics";
import { Button, cx, ErrorState, Skeleton } from "@labscape/ui";
import { useQuery } from "@tanstack/react-query";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";

type Preset = { id: string; label: string; subject: "physics" | "maths" | "chemistry"; left: string; right: string };
const PRESETS: Preset[] = [
  { id: "circuits", label: "Series vs parallel", subject: "physics", left: "Series", right: "Parallel" },
  { id: "functions", label: "Linear vs quadratic", subject: "maths", left: "Linear", right: "Quadratic" },
  { id: "lenses", label: "Convex vs concave lens", subject: "physics", left: "Convex", right: "Concave" },
  { id: "reactions", label: "Reaction types", subject: "chemistry", left: "Displacement", right: "Precipitation" },
];
const TINT = { physics: "#2f80ff", maths: "#a78bfa", chemistry: "#22c55e" } as const;

/**
 * /compare: two set-ups side by side with linked controls and a table of what differs (build plan
 * 4.8). Every number comes from the same physics and maths the labs use, not from canned text.
 */
export default function Compare() {
  const [params, setParams] = useSearchParams();
  const preset = PRESETS.find((p) => p.id === params.get("preset")) ?? PRESETS[0]!;
  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <PageHeader eyebrow="Labs" title="Compare" sub="Change one thing and watch both sides respond. The table underneath spells out what is different and why." className="mb-2" />
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Comparisons">
        {PRESETS.map((p) => (
          <button key={p.id} role="tab" aria-selected={p.id === preset.id} onClick={() => setParams({ preset: p.id }, { replace: true })} className={cx("rounded-full px-4 py-2 text-sm font-medium transition", p.id === preset.id ? "bg-ink-strong text-on-ink" : "bg-card text-ink-muted ring-1 ring-inset ring-line hover:text-ink-strong")}>
            <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: TINT[p.subject] }} />
            {p.label}
          </button>
        ))}
      </div>
      {preset.id === "circuits" && <Circuits />}
      {preset.id === "functions" && <Functions />}
      {preset.id === "lenses" && <Lenses />}
      {preset.id === "reactions" && <Reactions />}
    </div>
  );
}

/* ------------------------------------------------------------------ layout */

function Side({ title, tone, children }: { title: string; tone: string; children: ReactNode }) {
  return (
    <section data-surface="dark" className="min-w-0 rounded-card bg-[#0f1528] p-5 text-white">
      <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-medium text-white">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: tone }} />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Controls({ children }: { children: ReactNode }) {
  return (
    <div data-surface="dark" className="grid gap-4 rounded-card bg-[#0f1528] p-5 text-white sm:grid-cols-2 lg:grid-cols-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/55 sm:col-span-2 lg:col-span-3">Linked controls · both sides change together</p>
      {children}
    </div>
  );
}

type Row = { label: string; left: ReactNode; right: ReactNode; why?: string };
function DiffTable({ left, right, rows }: { left: string; right: string; rows: Row[] }) {
  return (
    <div className="overflow-x-auto rounded-card bg-card">
      <table className="w-full text-sm">
        <thead className="bg-surface-sunken/60 text-left text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-4 py-2.5"> </th>
            <th className="px-4 py-2.5">{left}</th>
            <th className="px-4 py-2.5">{right}</th>
            <th className="hidden px-4 py-2.5 md:table-cell">Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-line align-top">
              <th className="px-4 py-3 text-left font-medium text-ink-muted">{r.label}</th>
              <td className="px-4 py-3 font-mono text-ink-strong">{r.left}</td>
              <td className="px-4 py-3 font-mono text-ink-strong">{r.right}</td>
              <td className="hidden px-4 py-3 text-ink-muted md:table-cell">{r.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Tex = ({ tex }: { tex: string }) => <span dangerouslySetInnerHTML={{ __html: katex.renderToString(tex, { throwOnError: false }) }} />;

/* ------------------------------------------------------------------ series vs parallel */

/** Two identical ohmic bulbs on an ideal supply. */
export function circuitPair(V: number, R: number, broken: boolean) {
  const series = broken ? { I: 0, Vb: [0, 0], P: [0, 0], Rt: Infinity } : { I: V / (2 * R), Vb: [V / 2, V / 2], P: [V * V / (4 * R), V * V / (4 * R)], Rt: 2 * R };
  const parallel = { I: broken ? V / R : (2 * V) / R, Vb: [V, broken ? 0 : V], P: [V * V / R, broken ? 0 : V * V / R], Rt: broken ? R : R / 2 };
  return { series, parallel };
}

function Circuits() {
  const [V, setV] = useState(6);
  const [R, setR] = useState(12);
  const [broken, setBroken] = useState(false);
  const { series, parallel } = circuitPair(V, R, broken);
  const Pmax = (12 * 12) / 4;
  return (
    <div className="space-y-4">
      <Controls>
        <ParamSlider label="Supply voltage" value={V} min={1} max={12} step={0.5} unit="V" onChange={setV} onCommit={setV} />
        <ParamSlider label="Each bulb" value={R} min={4} max={40} step={1} unit="Ω" onChange={setR} onCommit={setR} />
        <label className="flex items-center gap-3 self-end text-sm text-white/80">
          <input type="checkbox" checked={broken} onChange={(e) => setBroken(e.target.checked)} className="h-4 w-4 accent-[#ff6b6b]" />
          Unscrew bulb B
        </label>
      </Controls>
      <div className="grid gap-4 md:grid-cols-2">
        <Side title="Series" tone="#2f80ff">
          <CircuitArt kind="series" V={V} glow={series.P.map((p) => p / Pmax)} broken={broken} I={series.I} />
        </Side>
        <Side title="Parallel" tone="#22d3ee">
          <CircuitArt kind="parallel" V={V} glow={parallel.P.map((p) => p / Pmax)} broken={broken} I={parallel.I} />
        </Side>
      </div>
      <DiffTable
        left="Series"
        right="Parallel"
        rows={[
          { label: "Total resistance", left: Number.isFinite(series.Rt) ? `${sf(series.Rt)} Ω` : "open circuit", right: `${sf(parallel.Rt)} Ω`, why: "In series resistances add; in parallel each extra path lowers the total." },
          { label: "Current from supply", left: `${sf(series.I)} A`, right: `${sf(parallel.I)} A`, why: "I = V / R_total, so the lower total resistance draws more current." },
          { label: "Voltage across bulb A", left: `${sf(series.Vb[0])} V`, right: `${sf(parallel.Vb[0])} V`, why: "Series bulbs share the supply voltage; parallel bulbs each get all of it." },
          { label: "Power in bulb A", left: `${sf(series.P[0])} W`, right: `${sf(parallel.P[0])} W`, why: "P = V²/R: twice the voltage gives four times the power, so parallel bulbs glow brighter." },
          { label: "If bulb B goes out", left: broken ? "A goes out too" : "A would go out", right: broken ? "A stays lit" : "A would stay lit", why: "Series has one path for the charge; parallel has a separate path through each bulb." },
        ]}
      />
    </div>
  );
}

function Bulb({ x, y, glow, broken, label }: { x: number; y: number; glow: number; broken?: boolean; label: string }) {
  const g = Math.max(0, Math.min(1, glow));
  return (
    <g transform={`translate(${x} ${y})`}>
      {g > 0.01 && <circle r={14 + 26 * g} fill="#ffd43b" opacity={0.12 + 0.35 * g} />}
      <circle r={13} fill={g > 0.01 ? `rgba(255,212,59,${0.3 + 0.7 * g})` : "#1b2236"} stroke="#c9d1e4" strokeWidth={2} />
      {broken ? <path d="M-6 -6 L6 6 M6 -6 L-6 6" stroke="#ff6b6b" strokeWidth={2.5} /> : <path d="M-7 -7 L7 7 M7 -7 L-7 7" stroke="#59607a" strokeWidth={1.5} />}
      <text y={32} textAnchor="middle" className="fill-white/60 text-[11px]">
        {label}
      </text>
    </g>
  );
}

function CircuitArt({ kind, V, glow, broken, I }: { kind: "series" | "parallel"; V: number; glow: number[]; broken: boolean; I: number }) {
  const wire = I > 0 ? "#7cf3ff" : "#4b5470";
  return (
    <svg viewBox="0 0 320 200" className="w-full" role="img" aria-label={`${kind} circuit, ${V} volts, supply current ${sf(I)} amps`}>
      {/* cell */}
      <g transform="translate(40 100)">
        <line x1={-8} y1={-16} x2={-8} y2={16} stroke="#e7ecf7" strokeWidth={3} />
        <line x1={4} y1={-9} x2={4} y2={9} stroke="#e7ecf7" strokeWidth={5} />
        <text x={-2} y={36} textAnchor="middle" className="fill-white/60 text-[11px]">{V} V</text>
      </g>
      {kind === "series" ? (
        <>
          <path d="M32 100 H20 V30 H300 V170 H20 V100 M44 100 H60" fill="none" stroke={wire} strokeWidth={2.5} />
          <Bulb x={120} y={30} glow={glow[0]!} label="A" />
          <Bulb x={220} y={30} glow={glow[1]!} broken={broken} label="B" />
        </>
      ) : (
        <>
          <path d="M32 100 H20 V30 H280 V170 H20 V100 M44 100 H60 M150 30 V170 M280 30 V170" fill="none" stroke={wire} strokeWidth={2.5} />
          <Bulb x={150} y={100} glow={glow[0]!} label="A" />
          <Bulb x={280} y={100} glow={glow[1]!} broken={broken} label="B" />
        </>
      )}
      <text x={300} y={194} textAnchor="end" className="fill-white/70 font-mono text-[12px]">
        I = {sf(I)} A
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ linear vs quadratic */

function Functions() {
  const [k, setK] = useState(1); // slope of the line, curvature of the parabola
  const [c, setC] = useState(0);
  const [x, setX] = useState(1.5);
  const [view, setView] = useState<View>({ x0: -5, x1: 5, y0: -4, y1: 8 });
  const lin = (t: number) => k * t + c;
  const quad = (t: number) => k * t * t + c;
  const fmtN = (n: number) => (Number.isFinite(n) ? sf(n) : "–");
  const quadRoots = k === 0 ? (c === 0 ? "every x" : "none") : -c / k < 0 ? "none (real)" : -c / k === 0 ? "x = 0" : `x = ±${fmtN(Math.sqrt(-c / k))}`;
  const probe = (f: (t: number) => number, colour: string) => (m: Mapper) => (
    <g>
      <line x1={m.X(x)} x2={m.X(x)} y1={m.Y(view.y0)} y2={m.Y(view.y1)} stroke="#ffffff22" strokeDasharray="4 4" />
      <circle cx={m.X(x)} cy={m.Y(f(x))} r={6} fill={colour} stroke="#0b0f1a" strokeWidth={2} />
    </g>
  );
  return (
    <div className="space-y-4">
      <Controls>
        <ParamSlider label="k (slope / curvature)" value={k} min={-3} max={3} step={0.25} onChange={setK} onCommit={setK} />
        <ParamSlider label="c (where it meets the y-axis)" value={c} min={-4} max={4} step={0.5} onChange={setC} onCommit={setC} />
        <ParamSlider label="Probe x" value={x} min={-4} max={4} step={0.1} onChange={setX} onCommit={setX} />
      </Controls>
      <div className="grid gap-4 md:grid-cols-2">
        <Side title="Linear" tone="#a78bfa">
          <p className="mb-2 text-white/80"><Tex tex={poly(k, "x", c)} /></p>
          <Plot curves={[{ f: lin, colour: "#a78bfa", width: 3 }]} view={view} onView={setView} height={280} ariaLabel="Graph of the linear function" overlay={probe(lin, "#a78bfa")} />
        </Side>
        <Side title="Quadratic" tone="#f472b6">
          <p className="mb-2 text-white/80"><Tex tex={poly(k, "x^2", c)} /></p>
          <Plot curves={[{ f: quad, colour: "#f472b6", width: 3 }]} view={view} onView={setView} height={280} ariaLabel="Graph of the quadratic function" overlay={probe(quad, "#f472b6")} />
        </Side>
      </div>
      <DiffTable
        left="Linear"
        right="Quadratic"
        rows={[
          { label: `y at x = ${sf(x)}`, left: fmtN(lin(x)), right: fmtN(quad(x)) },
          { label: "Gradient there", left: fmtN(k), right: fmtN(2 * k * x), why: "A line has the same gradient everywhere; a parabola's gradient 2kx changes with x." },
          { label: "Crosses the x-axis", left: k === 0 ? (c === 0 ? "every x" : "never") : `x = ${fmtN(-c / k)}`, right: quadRoots, why: "A line (k ≠ 0) crosses once; a parabola crosses twice, touches once or misses." },
          { label: "Turning point", left: "none", right: k === 0 ? "none" : `(0, ${fmtN(c)}) ${k > 0 ? "minimum" : "maximum"}`, why: "The sign of k decides whether the parabola opens up or down." },
          { label: "Doubling x", left: c === 0 ? "doubles y" : "does not double y", right: c === 0 ? "multiplies y by 4" : "does not scale simply", why: "y ∝ x for a line through the origin, y ∝ x² for the parabola." },
        ]}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ convex vs concave */

/** Thin lens, Cartesian sign convention (object on the left, u < 0). */
export function thinLens(d: number, f: number) {
  const u = -d;
  const inv = 1 / f + 1 / u;
  const v = Math.abs(inv) < 1e-9 ? Infinity : 1 / inv;
  const m = Number.isFinite(v) ? v / u : Infinity;
  return { v, m, real: Number.isFinite(v) && v > 0, upright: m > 0 };
}

function Lenses() {
  const [d, setD] = useState(30);
  const [F, setF] = useState(15);
  const convex = thinLens(d, F);
  const concave = thinLens(d, -F);
  const describe = (r: ReturnType<typeof thinLens>) => (!Number.isFinite(r.v) ? "at infinity" : `${r.real ? "real" : "virtual"}, ${r.upright ? "upright" : "inverted"}, ${Math.abs(r.m) > 1.001 ? "magnified" : Math.abs(r.m) < 0.999 ? "diminished" : "same size"}`);
  return (
    <div className="space-y-4">
      <Controls>
        <ParamSlider label="Object distance" value={d} min={4} max={60} step={1} unit="cm" onChange={setD} onCommit={setD} />
        <ParamSlider label="Focal length (size)" value={F} min={5} max={30} step={1} unit="cm" onChange={setF} onCommit={setF} />
      </Controls>
      <div className="grid gap-4 md:grid-cols-2">
        <Side title="Convex (converging)" tone="#2f80ff">
          <RayDiagram d={d} f={F} r={convex} />
        </Side>
        <Side title="Concave (diverging)" tone="#fb923c">
          <RayDiagram d={d} f={-F} r={concave} />
        </Side>
      </div>
      <DiffTable
        left="Convex"
        right="Concave"
        rows={[
          { label: "Focal length", left: `+${F} cm`, right: `−${F} cm`, why: "A converging lens has a real focus; a diverging lens's focus is virtual, on the object side." },
          { label: "Image distance v", left: Number.isFinite(convex.v) ? `${sf(convex.v)} cm` : "∞", right: `${sf(concave.v)} cm`, why: "From 1/v − 1/u = 1/f. A negative v means the image is on the same side as the object." },
          { label: "Magnification", left: Number.isFinite(convex.m) ? sf(convex.m) : "∞", right: sf(concave.m), why: "m = v/u; a negative m means the image is upside down." },
          { label: "Image", left: describe(convex), right: describe(concave), why: d < F ? "Inside the focal length a convex lens acts as a magnifying glass." : "A concave lens always gives a virtual, upright, smaller image." },
        ]}
      />
    </div>
  );
}

function RayDiagram({ d, f, r }: { d: number; f: number; r: ReturnType<typeof thinLens> }) {
  const W = 360, H = 200, cx0 = W / 2, cy = H / 2, s = 2.6, h = 26;
  const X = (x: number) => cx0 + x * s;
  const ox = X(-d), oy = cy - h;
  const finite = Number.isFinite(r.v) && Math.abs(r.v) < 400;
  const ix = finite ? X(r.v) : 0, iy = finite ? cy - h * r.m : 0;
  // Extend a ray from (x1,y1) through (x2,y2) to the frame edge.
  const ext = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1, dy = y2 - y1;
    const k = dx === 0 ? 1 : ((dx > 0 ? W : 0) - x1) / dx;
    return { x: x1 + dx * k, y: y1 + dy * k };
  };
  // Ray 1: parallel to the axis, then refracts through (or away from) the focus.
  const fx = X(f);
  const r1 = f > 0 ? ext(cx0, oy, fx, cy) : ext(cx0, oy, cx0 + (cx0 - fx), oy + (oy - cy));
  // Ray 2: through the centre, undeviated.
  const r2 = ext(ox, oy, cx0, cy);
  const convex = f > 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${convex ? "Convex" : "Concave"} lens ray diagram: image ${finite ? `${Math.abs(r.v).toFixed(1)} centimetres ${r.v > 0 ? "beyond" : "in front of"} the lens` : "at infinity"}`}>
      <line x1={0} y1={cy} x2={W} y2={cy} stroke="#ffffff30" />
      {[f, -f].map((x, i) => (
        <g key={i}>
          <circle cx={X(x)} cy={cy} r={3} fill="#ffd43b" />
          <text x={X(x)} y={cy + 16} textAnchor="middle" className="fill-white/50 text-[10px]">F</text>
        </g>
      ))}
      {convex ? <path d={`M${cx0} 20 Q${cx0 + 14} ${cy} ${cx0} ${H - 20} Q${cx0 - 14} ${cy} ${cx0} 20`} fill="#7cc4ff22" stroke="#7cc4ff" strokeWidth={1.5} /> : <path d={`M${cx0 - 9} 20 H${cx0 + 9} Q${cx0 + 1} ${cy} ${cx0 + 9} ${H - 20} H${cx0 - 9} Q${cx0 - 1} ${cy} ${cx0 - 9} 20`} fill="#fb923c22" stroke="#fb923c" strokeWidth={1.5} />}
      {/* object */}
      <line x1={ox} y1={cy} x2={ox} y2={oy} stroke="#e7ecf7" strokeWidth={3} markerEnd="url(#arrow)" />
      {/* rays */}
      <path d={`M${ox} ${oy} H${cx0} L${r1.x} ${r1.y}`} fill="none" stroke="#ffd43b" strokeWidth={1.6} />
      <path d={`M${ox} ${oy} L${r2.x} ${r2.y}`} fill="none" stroke="#7cf3ff" strokeWidth={1.6} />
      {finite && !r.real && (
        <>
          <line x1={cx0} y1={oy} x2={ix} y2={iy} stroke="#ffd43b" strokeDasharray="4 4" strokeWidth={1.2} />
          <line x1={ox} y1={oy} x2={ix} y2={iy} stroke="#7cf3ff" strokeDasharray="4 4" strokeWidth={1.2} />
        </>
      )}
      {finite && <line x1={ix} y1={cy} x2={ix} y2={iy} stroke={r.real ? "#f472b6" : "#f472b699"} strokeWidth={3} strokeDasharray={r.real ? undefined : "5 3"} />}
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10z" fill="#e7ecf7" />
        </marker>
      </defs>
    </svg>
  );
}

/* ------------------------------------------------------------------ reaction types */

const REACTIONS = [
  { slug: "iron-nail-copper-sulfate", label: "Displacement" },
  { slug: "precipitation-reactions", label: "Precipitation" },
  { slug: "acid-base-titration", label: "Neutralisation" },
  { slug: "hydrogen-pop-test", label: "Metal + acid" },
];

function Reactions() {
  const [left, setLeft] = useState(REACTIONS[0]!.slug);
  const [right, setRight] = useState(REACTIONS[1]!.slug);
  const [playing, setPlaying] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const a = useQuery({ queryKey: ["experiment-full", left], queryFn: () => api<{ content: ExperimentContent }>(`/v1/experiments/${left}`) });
  const b = useQuery({ queryKey: ["experiment-full", right], queryFn: () => api<{ content: ExperimentContent }>(`/v1/experiments/${right}`) });
  if (a.isError || b.isError) return <ErrorState title="Couldn't load those experiments" onRetry={() => void (a.refetch(), b.refetch())} />;
  const pick = (value: string, set: (s: string) => void, other: string) => (
    <select value={value} onChange={(e) => set(e.target.value)} className="h-10 rounded-full border border-line bg-surface px-4 text-sm text-ink-strong outline-none transition hover:border-line-strong focus:border-accent/70">
      {REACTIONS.filter((r) => r.slug !== other).map((r) => (
        <option key={r.slug} value={r.slug}>
          {r.label}
        </option>
      ))}
    </select>
  );
  const ca = a.data?.content, cb = b.data?.content;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-card bg-card p-4">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">Linked playback</span>
        {pick(left, setLeft, right)}
        <span className="text-ink-muted">vs</span>
        {pick(right, setRight, left)}
        <span className="flex-1" />
        <Button size="sm" variant="secondary" icon={playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause both" : "Play both"}
        </Button>
        <Button size="sm" variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setEpoch((e) => e + 1)}>
          Restart both
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[ca, cb].map((c, i) => (
          <Side key={i} title={REACTIONS.find((r) => r.slug === (i ? right : left))!.label} tone={i ? "#f59e0b" : "#22c55e"}>
            {c ? <DemoPane key={`${c.slug}-${epoch}`} content={c} playing={playing} /> : <Skeleton className="h-[300px] rounded-xl" />}
          </Side>
        ))}
      </div>
      {ca && cb && (
        <DiffTable
          left={REACTIONS.find((r) => r.slug === left)!.label}
          right={REACTIONS.find((r) => r.slug === right)!.label}
          rows={[
            { label: "Equation", left: <Tex tex={ca.observations.equationLatex ?? ""} />, right: <Tex tex={cb.observations.equationLatex ?? ""} /> },
            { label: "What you see", left: <span className="font-sans text-ink">{ca.observations.whatHappened}</span>, right: <span className="font-sans text-ink">{cb.observations.whatHappened}</span> },
            { label: "Why", left: <span className="font-sans text-ink-muted">{firstSentence(ca.observations.why)}</span>, right: <span className="font-sans text-ink-muted">{firstSentence(cb.observations.why)}</span> },
          ]}
        />
      )}
    </div>
  );
}

const firstSentence = (s: string | undefined) => (s ?? "").split(/(?<=\.)\s/)[0];

function DemoPane({ content, playing }: { content: ExperimentContent; playing: boolean }) {
  const session = useLabSession(content, { mode: "demo" });
  const { setPaused } = session;
  useEffect(() => setPaused(!playing), [playing, setPaused]);
  const caption = useMemo(() => [...content.golden.captions].reverse().find((c) => c.t <= session.t), [content, session.t]);
  return (
    <div className="relative h-[320px] overflow-hidden rounded-xl">
      <Workbench session={session} readOnly />
      {caption && <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-lg bg-black/70 px-3 py-2 text-center text-sm text-white">{caption.text}</div>}
    </div>
  );
}

/** "y = 2x - 3", "y = -x^2", "y = 4": no 1x, no + 0, no + -3. */
export function poly(k: number, term: string, c: number) {
  const lead = k === 0 ? "" : k === 1 ? term : k === -1 ? `-${term}` : `${k}${term}`;
  if (!lead) return `y = ${c}`;
  return c === 0 ? `y = ${lead}` : `y = ${lead} ${c > 0 ? "+" : "-"} ${Math.abs(c)}`;
}
