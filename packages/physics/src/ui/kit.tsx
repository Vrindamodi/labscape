import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { Download, Pause, Play } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Num, RANGE_CSS } from "./interact";

/* ------------------------------------------------------------------ layout bits */

/** A v3 glass panel: navy gradient, hairline border, inner highlight. `glow` rings it when it holds the next step. */
export function Panel({ title, children, className = "", right, glow }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode; glow?: boolean }) {
  return (
    <section
      data-guide={glow ? "panel" : undefined}
      className={`relative rounded-[16px] border p-3.5 transition-[border-color,box-shadow] duration-300 ${glow ? "border-[rgba(57,214,255,.55)] shadow-[inset_0_1px_0_rgba(200,220,255,.10),0_0_0_3px_rgba(57,214,255,.12),0_24px_60px_-24px_rgba(0,0,0,.8)]" : "border-[rgba(140,180,255,.16)] shadow-[inset_0_1px_0_rgba(200,220,255,.10),0_24px_60px_-24px_rgba(0,0,0,.8)]"} bg-[linear-gradient(180deg,rgba(14,26,56,.72),rgba(8,16,38,.78))] backdrop-blur-xl ${className}`}
    >
      {(title || right) && (
        <div className="mb-2.5 flex items-center justify-between gap-2">
          {title && (
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8fa6d1]">
              {glow && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#39d6ff] motion-reduce:animate-none" aria-hidden />}
              {title}
            </h3>
          )}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Label over a mono value. Plain numbers (or numeric strings) ease to each new value. */
export function Readout({ label, value, unit, tone = "default" }: { label: string; value: ReactNode; unit?: string; tone?: "default" | "good" | "warn" | "bad" }) {
  const c = tone === "good" ? "text-[#3de8a8]" : tone === "warn" ? "text-[#ffc23d]" : tone === "bad" ? "text-[#ff8a96]" : "text-white";
  const str = typeof value === "number" ? String(value) : typeof value === "string" ? value : null;
  const animate = str !== null && NUMERIC.test(str);
  const digits = animate ? (str!.split(".")[1]?.length ?? 0) : 0;
  return (
    <div className="min-w-0 rounded-[12px] bg-[#040a1c]/55 px-2.5 py-1.5 ring-1 ring-inset ring-[rgba(140,180,255,.10)]">
      <div className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8fa6d1]">{label}</div>
      <div className={`font-mono text-[15px] font-bold tabular-nums leading-6 ${c}`}>
        {animate ? <Num value={Number(str)} digits={digits} /> : value}
        {unit && <span className="ml-1 text-xs font-medium text-white/45">{unit}</span>}
      </div>
    </div>
  );
}

export function Btn({ children, onClick, disabled, tone = "secondary", className = "", title, pressed, guideId }: { children: ReactNode; onClick?: () => void; disabled?: boolean; tone?: "primary" | "secondary" | "danger" | "ghost"; className?: string; title?: string; pressed?: boolean; /** What it sets, for Guide me (param:key or param:key=value). */ guideId?: string }) {
  const t =
    tone === "primary"
      ? "text-white border border-[#6aa8ff] bg-[linear-gradient(180deg,#3d8bff,#1d5fe0)] shadow-[0_8px_24px_-8px_rgba(61,139,255,.9),inset_0_1px_0_rgba(255,255,255,.35)] hover:brightness-110"
      : tone === "danger"
        ? "text-white border border-[#ff8a96] bg-[linear-gradient(180deg,#ff5b6b,#d93348)] shadow-[0_8px_24px_-10px_rgba(255,91,107,.9),inset_0_1px_0_rgba(255,255,255,.3)] hover:brightness-110"
        : tone === "ghost"
          ? "text-[#a9bde4] hover:bg-white/[0.06] hover:text-white"
          : "text-[#dbe7ff] border border-[rgba(140,180,255,.16)] bg-[rgba(120,160,255,.10)] hover:bg-[rgba(120,160,255,.17)]";
  return (
    <button type="button" data-guide-id={guideId} title={title} aria-pressed={pressed} onClick={onClick} disabled={disabled} className={`inline-flex h-10 items-center justify-center gap-2 rounded-[12px] px-3.5 text-sm font-semibold transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#39d6ff] ${t} ${className}`}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ inputs */

/**
 * A slider that shows every change at once but logs one event per settled value (200 ms after the
 * last move, or on release), so a drag is one LabEvent, not hundreds. Arrow keys step; Shift steps x10.
 * `sweep` adds a play button that swings the value back and forth (maths parameters).
 */
export function ParamSlider({ label, value, min, max, step, unit, onChange, onCommit, disabled, sweep, format, guideId }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange?: (v: number) => void; onCommit: (v: number) => void; disabled?: boolean; sweep?: boolean; format?: (v: number) => string; /** The param key it sets, so Guide me can point at it (param:key). */ guideId?: string }) {
  const id = useId();
  const [local, setLocal] = useState(value);
  const [sweeping, setSweeping] = useState(false);
  const timer = useRef<number | null>(null);
  const dir = useRef(1);
  useEffect(() => setLocal(value), [value]);
  const commitSoon = (v: number) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onCommit(v), 200);
  };
  const set = (raw: number) => {
    const v = Math.max(min, Math.min(max, Math.round(raw / step) * step));
    const clean = Number(v.toFixed(6));
    setLocal(clean);
    onChange?.(clean);
    commitSoon(clean);
  };
  useEffect(() => {
    if (!sweeping) return;
    let raf = 0;
    let last = performance.now();
    let v = local;
    const tick = (now: number) => {
      v += dir.current * ((max - min) / 4) * ((now - last) / 1000);
      last = now;
      if (v > max || v < min) {
        dir.current *= -1;
        v = Math.max(min, Math.min(max, v));
      }
      set(v);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sweeping]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = format ? format(local) : `${Number(local.toFixed(4))}`;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-semibold text-[#c8d6f3]">
          {label}
        </label>
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[13px] font-bold text-white tabular-nums">
            {shown}
            {unit && <span className="ml-0.5 text-white/50">{unit}</span>}
          </span>
          {sweep && (
            <button type="button" onClick={() => setSweeping((s) => !s)} disabled={disabled} className="grid h-6 w-6 place-items-center rounded-full text-[#8cbcff] ring-1 ring-inset ring-accent/40 hover:bg-accent/10" aria-label={sweeping ? `Stop sweeping ${label}` : `Sweep ${label}`} aria-pressed={sweeping}>
              {sweeping ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </button>
          )}
        </span>
      </div>
      <input
        id={id}
        type="range"
        data-guide-id={guideId}
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value))}
        onKeyDown={(e) => {
          if (!e.shiftKey) return;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            set(local + step * 10);
          }
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            set(local - step * 10);
          }
        }}
        className="ls-range"
        style={{ ["--p" as string]: `${((local - min) / (max - min || 1)) * 100}%` }}
      />
      <style>{RANGE_CSS}</style>
    </div>
  );
}

/**
 * Shows what was submitted last, so an answer recorded by "Do this step for me", an undo, or a
 * reopened attempt fills the box. The typing state follows it whenever the submitted value changes.
 */
export function useSubmittedText(value: number | string | null): [string, Dispatch<SetStateAction<string>>] {
  const text = value === null ? "" : String(value);
  const [v, setV] = useState(text);
  const [seen, setSeen] = useState(text);
  if (seen !== text) {
    setSeen(text);
    setV(text);
  }
  return [v, setV];
}

/**
 * Type what you read off an instrument and record it. Enter records. `value` is the answer already
 * submitted for this box (see `submitted`): the box shows it, and focusing selects it so typing
 * replaces it.
 */
export function ReadingInput({ label, unit, onRecord, value = null, disabled, step = "any", placeholder, width = "w-24" }: { label: string; unit?: string; onRecord: (v: number) => void; value?: number | string | null; disabled?: boolean; step?: string; placeholder?: string; width?: string }) {
  const id = useId();
  const [v, setV] = useSubmittedText(value);
  const ok = v.trim() !== "" && Number.isFinite(Number(v));
  const record = () => {
    if (!ok) return;
    onRecord(Number(v));
  };
  return (
    <div className="flex items-end gap-2">
      <div>
        <label htmlFor={id} className="block text-[11px] font-semibold text-white/60">
          {label}
        </label>
        <div className="mt-0.5 flex items-center gap-1">
          <input
            id={id}
            inputMode="decimal"
            step={step}
            value={v}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => setV(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => e.key === "Enter" && record()}
            className={`${width} h-10 rounded-[11px] border border-[rgba(140,180,255,.16)] bg-[#040a1c]/60 px-2.5 font-mono text-sm text-white placeholder:text-white/25 focus:border-[#3d8bff] focus:outline-none focus:ring-2 focus:ring-[#3d8bff]/30 disabled:opacity-40`}
          />
          {unit && <span className="text-xs text-white/50">{unit}</span>}
        </div>
      </div>
      <Btn onClick={record} disabled={disabled || !ok}>
        Record
      </Btn>
    </div>
  );
}

/* ------------------------------------------------------------------ meters */

/**
 * Analogue meter: the needle swings with a damped overshoot (build plan 3.12), the digital line
 * underneath ticks to the value. Reduced motion jumps straight there.
 */
export function AnalogMeter({ label, value, max, unit, size = 150, colour = "#2f80ff" }: { label: string; value: number; max: number; unit: string; size?: number; colour?: string }) {
  const reduced = useReducedMotion();
  const frac = useMotionValue(0);
  useEffect(() => {
    const target = Math.max(0, Math.min(1.08, Math.abs(value) / max));
    if (reduced) frac.set(target);
    else {
      const c = animate(frac, target, { type: "spring", stiffness: 140, damping: 9, mass: 0.6 });
      return () => c.stop();
    }
  }, [value, max, reduced, frac]);
  const angle = useTransform(frac, (f) => -60 + f * 120);
  const w = size;
  const h = size * 0.68;
  const cx = w / 2;
  const cy = h * 0.92;
  const r = w * 0.42;
  const ticks = useMemo(() => Array.from({ length: 11 }, (_, i) => i), []);
  return (
    <div className="inline-flex flex-col items-center rounded-xl bg-[#f3efe4] px-2 pb-1.5 pt-1 shadow-inner ring-1 ring-black/20" role="meter" aria-label={label} aria-valuenow={Number(value.toFixed(3))} aria-valuemin={0} aria-valuemax={max}>
      <svg width={w} height={h} aria-hidden>
        {ticks.map((i) => {
          const a = ((-60 + i * 12) * Math.PI) / 180;
          const r1 = r * (i % 5 === 0 ? 0.82 : 0.9);
          return <line key={i} x1={cx + r1 * Math.sin(a)} y1={cy - r1 * Math.cos(a)} x2={cx + r * Math.sin(a)} y2={cy - r * Math.cos(a)} stroke="#2b2b2b" strokeWidth={i % 5 === 0 ? 1.6 : 0.8} />;
        })}
        {[0, 0.5, 1].map((f) => {
          const a = ((-60 + f * 120) * Math.PI) / 180;
          return (
            <text key={f} x={cx + r * 0.66 * Math.sin(a)} y={cy - r * 0.66 * Math.cos(a) + 4} textAnchor="middle" fontSize={10} fill="#333" fontWeight={700}>
              {Number((max * f).toPrecision(3))}
            </text>
          );
        })}
        <text x={cx} y={cy - r * 0.32} textAnchor="middle" fontSize={13} fontWeight={800} fill="#1f2937">
          {unit}
        </text>
        <motion.g style={{ rotate: angle, originX: `${cx}px`, originY: `${cy}px` }}>
          <line x1={cx} y1={cy} x2={cx} y2={cy - r * 0.98} stroke={colour} strokeWidth={2} strokeLinecap="round" />
        </motion.g>
        <circle cx={cx} cy={cy} r={4} fill="#1f2937" />
      </svg>
      <div className="font-mono text-[11px] font-bold text-[#1f2937]">{label}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ graphs */

export type Series = { label: string; colour: string; points: { x: number; y: number }[]; mode?: "line" | "scatter" };

function niceTicks(lo: number, hi: number, target = 5) {
  const span = hi - lo || 1;
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(10)));
  return out;
}

/**
 * Up to three series on a canvas, redrawn on change. Axes ease when they rescale; a best-fit line
 * through the origin can be drawn for scatter data; CSV export of everything plotted.
 */
export function LiveGraph({ series, xLabel, yLabel, height = 180, fitOrigin, playheadX, xMin, yMin = 0, ariaLabel }: { series: Series[]; xLabel: string; yLabel: string; height?: number; fitOrigin?: boolean; playheadX?: number | null; xMin?: number; yMin?: number; ariaLabel?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const axes = useRef({ xMax: 1, yMax: 1, yLo: yMin });
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(160, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = series.flatMap((s) => s.points);
  // With nothing plotted yet, show a calm 0..1 frame instead of 1e-9 tick noise.
  const targetX = pts.length ? Math.max(1e-9, ...pts.map((p) => p.x), xMin ?? 0) * 1.08 : Math.max(1, xMin ?? 0);
  const targetY = pts.length ? Math.max(1e-9, ...pts.map((p) => p.y)) * 1.12 : 1;
  const targetLo = Math.min(yMin, ...pts.map((p) => p.y));
  const fit = useMemo(() => {
    if (!fitOrigin) return null;
    const p = series.flatMap((s) => (s.mode === "scatter" ? s.points : []));
    if (p.length < 2) return null;
    const sxy = p.reduce((a, q) => a + q.x * q.y, 0);
    const sxx = p.reduce((a, q) => a + q.x * q.x, 0);
    return sxx ? sxy / sxx : null;
  }, [series, fitOrigin]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const a = axes.current;
      // ease toward the new ranges (300 ms-ish)
      a.xMax += (targetX - a.xMax) * 0.25;
      a.yMax += (targetY - a.yMax) * 0.25;
      a.yLo += (targetLo - a.yLo) * 0.25;
      const c = ref.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      c.width = width * dpr;
      c.height = height * dpr;
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      const L = 42;
      const B = 26;
      const W = width - L - 10;
      const H = height - B - 10;
      const X = (x: number) => L + (x / a.xMax) * W;
      const Y = (y: number) => 10 + H - ((y - a.yLo) / (a.yMax - a.yLo || 1)) * H;
      g.font = "10px Inter, sans-serif";
      g.fillStyle = "rgba(255,255,255,.45)";
      g.strokeStyle = "rgba(255,255,255,.07)";
      for (const t of niceTicks(0, a.xMax)) {
        g.beginPath();
        g.moveTo(X(t), 10);
        g.lineTo(X(t), 10 + H);
        g.stroke();
        g.textAlign = "center";
        g.fillText(String(t), X(t), height - 12);
      }
      for (const t of niceTicks(a.yLo, a.yMax)) {
        g.beginPath();
        g.moveTo(L, Y(t));
        g.lineTo(L + W, Y(t));
        g.stroke();
        g.textAlign = "right";
        g.fillText(String(t), L - 5, Y(t) + 3);
      }
      g.strokeStyle = "rgba(255,255,255,.35)";
      g.beginPath();
      g.moveTo(L, 10);
      g.lineTo(L, 10 + H);
      g.lineTo(L + W, 10 + H);
      g.stroke();
      g.fillStyle = "rgba(255,255,255,.6)";
      g.textAlign = "right";
      g.fillText(xLabel, L + W, height - 1);
      g.save();
      g.translate(10, 12);
      g.textAlign = "left";
      g.fillText(yLabel, 0, 0);
      g.restore();
      if (fit !== null) {
        g.strokeStyle = "rgba(255,214,102,.85)";
        g.setLineDash([5, 4]);
        g.beginPath();
        g.moveTo(X(0), Y(0));
        g.lineTo(X(a.xMax), Y(fit * a.xMax));
        g.stroke();
        g.setLineDash([]);
      }
      for (const s of series) {
        g.strokeStyle = s.colour;
        g.fillStyle = s.colour;
        g.lineWidth = 2;
        if (s.mode === "scatter") {
          for (const p of s.points) {
            g.beginPath();
            g.arc(X(p.x), Y(p.y), 4, 0, Math.PI * 2);
            g.fill();
          }
        } else {
          g.beginPath();
          s.points.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
          g.stroke();
        }
      }
      if (playheadX != null) {
        g.strokeStyle = "rgba(124,243,255,.6)";
        g.beginPath();
        g.moveTo(X(playheadX), 10);
        g.lineTo(X(playheadX), 10 + H);
        g.stroke();
      }
      if (Math.abs(a.xMax - targetX) / targetX > 0.002 || Math.abs(a.yMax - targetY) / targetY > 0.002) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [series, width, height, targetX, targetY, targetLo, fit, playheadX, xLabel, yLabel]);

  const csv = () => {
    const rows = ["series,x,y", ...series.flatMap((s) => s.points.map((p) => `${s.label},${p.x},${p.y}`))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows], { type: "text/csv" }));
    a.download = `${yLabel}-vs-${xLabel}.csv`.replace(/[^\w.-]+/g, "_");
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div ref={wrap} className="relative">
      <canvas ref={ref} style={{ width, height }} role="img" aria-label={ariaLabel ?? `${yLabel} against ${xLabel}: ${pts.length} points`} />
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-white/60">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: s.colour }} />
            {s.label}
          </span>
        ))}
        {fit !== null && <span className="text-[#ffd666]">best fit: gradient {fit.toPrecision(4)}</span>}
        {pts.length > 0 && (
          <button type="button" onClick={csv} className="ml-auto flex items-center gap-1 text-white/50 hover:text-white" aria-label="Download the data as CSV">
            <Download className="h-3 w-3" /> CSV
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ vectors and energy */

/** An arrow from (x, y) with components (dx, dy) in SVG units; label optional. */
export function Vector({ x, y, dx, dy, colour = "#7cf3ff", label, width = 2.5 }: { x: number; y: number; dx: number; dy: number; colour?: string; label?: string; width?: number }) {
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(9, len * 0.4);
  const ex = x + dx;
  const ey = y + dy;
  return (
    <g>
      <line x1={x} y1={y} x2={ex - ux * head * 0.8} y2={ey - uy * head * 0.8} stroke={colour} strokeWidth={width} strokeLinecap="round" />
      <polygon points={`${ex},${ey} ${ex - ux * head - uy * head * 0.5},${ey - uy * head + ux * head * 0.5} ${ex - ux * head + uy * head * 0.5},${ey - uy * head - ux * head * 0.5}`} fill={colour} />
      {label && (
        <text x={ex + ux * 8} y={ey + uy * 8 + 4} fill={colour} fontSize={11} fontWeight={700} textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
}

export function EnergyBars({ bars, max }: { bars: { label: string; value: number; colour: string }[]; max: number }) {
  return (
    <div className="flex h-28 items-end gap-2" role="img" aria-label={bars.map((b) => `${b.label} ${b.value.toFixed(1)} J`).join(", ")}>
      {bars.map((b) => (
        <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
          <div className="relative w-full flex-1 overflow-hidden rounded-t bg-white/[0.05]">
            <motion.div className="absolute inset-x-0 bottom-0 rounded-t" style={{ background: b.colour }} animate={{ height: `${Math.min(100, (b.value / (max || 1)) * 100)}%` }} transition={{ type: "spring", stiffness: 200, damping: 26 }} />
          </div>
          <span className="text-[10px] font-semibold text-white/60">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Formats a number to n significant figures without trailing noise. */
export const sf = (x: number | null | undefined, n = 3) => (x == null || !Number.isFinite(x) ? "–" : Math.abs(x) < 1e-9 ? "0" : String(Number(x.toPrecision(n))));
