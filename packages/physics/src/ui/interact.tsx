import type { LabEvent } from "@labscape/contracts";
import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import type { SimSession } from "./useSimSession";

/**
 * Direct-manipulation toolkit shared by the physics and maths benches: SVG drag handles with
 * keyboard parity, pulsing "do this next" affordances, an eased number readout that updates the DOM
 * without re-rendering React, and the demo "ghost hand" that previews each golden event.
 */

/* ------------------------------------------------------------------ design tokens (lab v3) */

export const V3 = {
  blue: "#3d8bff",
  cyan: "#39d6ff",
  amber: "#ffc23d",
  mint: "#3de8a8",
  red: "#ff5b6b",
  violet: "#a98bff",
  ink: "#e8f0ff",
  muted: "#8fa6d1",
  navy: "#0b1730",
  deep: "#060d1f",
} as const;

/** Styled range input (also used outside the benches, so each slider ships it). */
export const RANGE_CSS = `
.ls-range{-webkit-appearance:none;appearance:none;height:22px;background:transparent;width:100%;cursor:pointer}
.ls-range:disabled{opacity:.4;cursor:not-allowed}
.ls-range::-webkit-slider-runnable-track{height:6px;border-radius:6px;background:linear-gradient(90deg,#3d8bff var(--p,50%),rgba(255,255,255,.1) var(--p,50%))}
.ls-range::-moz-range-track{height:6px;border-radius:6px;background:rgba(255,255,255,.1)}
.ls-range::-moz-range-progress{height:6px;border-radius:6px;background:#3d8bff}
.ls-range::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;margin-top:-6px;border-radius:50%;background:#fff;border:3px solid #3d8bff;box-shadow:0 2px 10px -2px rgba(61,139,255,.9)}
.ls-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid #3d8bff}
.ls-range:focus-visible{outline:2px solid #39d6ff;outline-offset:2px;border-radius:6px}
`;

const CSS = `
.ls-h{font-family:Sora,"Space Grotesk",system-ui,sans-serif}
.ls-kicker{font:600 11px/1.2 Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8fa6d1}
.ls-glass{background:linear-gradient(180deg,rgba(14,26,56,.72),rgba(8,16,38,.78));border:1px solid rgba(140,180,255,.16);box-shadow:inset 0 1px 0 rgba(200,220,255,.10),0 24px 60px -24px rgba(0,0,0,.8);-webkit-backdrop-filter:blur(20px) saturate(1.3);backdrop-filter:blur(20px) saturate(1.3)}
.ls-stage{position:relative;overflow:hidden;border-radius:18px;background:radial-gradient(900px 520px at 50% -10%,rgba(61,139,255,.22),transparent 60%),radial-gradient(600px 400px at 100% 110%,rgba(57,214,255,.10),transparent 60%),#0b1730;box-shadow:inset 0 1px 0 rgba(200,220,255,.10),inset 0 0 0 1px rgba(140,180,255,.16),0 30px 80px -40px rgba(0,0,0,.9)}
.ls-handle{cursor:grab;outline:none;touch-action:none}
.ls-handle:active{cursor:grabbing}
.ls-handle[aria-disabled=true]{cursor:default}
.ls-handle .ls-focus{opacity:0;transition:opacity .15s}
.ls-handle:focus-visible .ls-focus{opacity:1}
.ls-handle:hover .ls-hover{opacity:1}
.ls-hover{opacity:0;transition:opacity .15s}
.ls-pulse{transform-box:fill-box;transform-origin:center;animation:ls-pulse 1.8s cubic-bezier(.2,.6,.3,1) infinite}
.ls-pulse.d2{animation-delay:.9s}
.ls-breathe{animation:ls-breathe 2.4s ease-in-out infinite}
.ls-snap{transform-box:fill-box;transform-origin:center;animation:ls-snap .35s cubic-bezier(.2,1.6,.4,1)}
.ls-shake{animation:ls-shake .32s ease-in-out}
.ls-hand{transition:transform .38s cubic-bezier(.2,.8,.2,1),opacity .25s}
.ls-hand.ls-follow{transition:opacity .25s}
.ls-flow{animation:ls-flow 1s linear infinite}
.ls-chip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border-radius:10px;font:600 12px Inter,system-ui,sans-serif;color:#a9bde4;background:rgba(120,160,255,.08);border:1px solid rgba(140,180,255,.14);transition:background .15s,color .15s,border-color .15s}
.ls-chip:hover:not(:disabled){color:#fff;background:rgba(120,160,255,.14)}
.ls-chip[aria-checked=true],.ls-chip[aria-pressed=true]{color:#fff;background:rgba(61,139,255,.25);border-color:rgba(110,170,255,.55)}
.ls-chip:disabled{opacity:.45;cursor:not-allowed}
@keyframes ls-pulse{0%{transform:scale(.7);opacity:.95}100%{transform:scale(2.1);opacity:0}}
@keyframes ls-breathe{0%,100%{opacity:.55}50%{opacity:1}}
@keyframes ls-snap{0%{transform:scale(.6)}100%{transform:scale(1)}}
@keyframes ls-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}
@keyframes ls-flow{to{stroke-dashoffset:-28}}
@media (prefers-reduced-motion: reduce){.ls-pulse,.ls-breathe,.ls-snap,.ls-shake,.ls-flow{animation:none!important}.ls-pulse{opacity:.6;transform:scale(1.35)}.ls-hand{transition:none}}
`;

let fontsInjected = false;

/** Keyframes, glass and handle styles for the benches, plus the v3 heading font. Render once per bench. */
export function LabStyles() {
  useEffect(() => {
    if (fontsInjected || typeof document === "undefined") return;
    fontsInjected = true;
    if (document.querySelector("link[data-ls-sora]")) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&display=swap";
    l.setAttribute("data-ls-sora", "");
    document.head.appendChild(l);
  }, []);
  return <style>{CSS}</style>;
}

/** The dark navy stage the apparatus sits on. */
export function Stage({ children, className = "", label }: { children: ReactNode; className?: string; label?: ReactNode }) {
  return (
    <div className={`ls-stage ${className}`}>
      {children}
      {label && <div className="pointer-events-none absolute left-3 top-3 rounded-[10px] bg-[#060d1f]/70 px-2.5 py-1 text-xs font-semibold text-[#dbe7ff] ring-1 ring-inset ring-[rgba(140,180,255,.16)] backdrop-blur">{label}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ geometry */

export type Pt = { x: number; y: number };

/** Client pixels -> the SVG's user units (handles viewBox scaling and letterboxing). */
export function toSvgPoint(svg: SVGSVGElement, clientX: number, clientY: number): Pt {
  const m = svg.getScreenCTM();
  if (!m) return { x: clientX, y: clientY };
  const p = svg.createSVGPoint();
  p.x = clientX;
  p.y = clientY;
  const q = p.matrixTransform(m.inverse());
  return { x: q.x, y: q.y };
}

export const clampN = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const snapTo = (x: number, step: number) => Number((Math.round(x / step) * step).toFixed(6));
export const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
export const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
export const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/* ------------------------------------------------------------------ drag */

type DragOpts = {
  disabled?: boolean | undefined;
  onStart?: ((p: Pt, e: RPointerEvent<Element>) => void) | undefined;
  onMove: (p: Pt, start: Pt, e: PointerEvent) => void;
  onEnd?: ((p: Pt, moved: boolean, e: PointerEvent) => void) | undefined;
  /** Pixels of travel before it counts as a drag rather than a click. */
  slop?: number | undefined;
};

/**
 * Pointer drag in SVG user units, with pointer capture so the drag survives leaving the element.
 * Window listeners are used so a handle can unmount mid-drag without leaking.
 */
export function useSvgDrag(opts: DragOpts) {
  const ref = useRef(opts);
  ref.current = opts;
  return useCallback((e: RPointerEvent<Element>) => {
    const o = ref.current;
    if (o.disabled || e.button !== 0) return;
    const el = e.currentTarget as SVGGraphicsElement;
    const svg = el instanceof SVGSVGElement ? el : el.ownerSVGElement;
    if (!svg) return;
    e.preventDefault();
    e.stopPropagation();
    const start = toSvgPoint(svg, e.clientX, e.clientY);
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    o.onStart?.(start, e);
    const id = e.pointerId;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > (ref.current.slop ?? 3)) moved = true;
      if (moved) ref.current.onMove(toSvgPoint(svg, ev.clientX, ev.clientY), start, ev);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      ref.current.onEnd?.(toSvgPoint(svg, ev.clientX, ev.clientY), moved, ev);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, []);
}

/** Debounced commit so holding an arrow key logs one event, not twenty. */
export function useCommitLater<T>(commit: (v: T) => void, ms = 350) {
  const fn = useRef(commit);
  fn.current = commit;
  const t = useRef<number | null>(null);
  const last = useRef<T | null>(null);
  useEffect(
    () => () => {
      if (t.current !== null) {
        window.clearTimeout(t.current);
        if (last.current !== null) fn.current(last.current);
      }
    },
    [],
  );
  return useCallback(
    (v: T) => {
      last.current = v;
      if (t.current !== null) window.clearTimeout(t.current);
      t.current = window.setTimeout(() => {
        t.current = null;
        last.current = null;
        fn.current(v);
      }, ms);
    },
    [ms],
  );
}

/**
 * A focusable, draggable SVG group. Pointer drags call onDrag in SVG units; arrow keys call onKey
 * (return true when handled); Enter / Space call onActivate. Shows a focus ring when keyboard
 * focused and an optional "do this next" pulse.
 */
export function DragHandle({
  children,
  label,
  valueText,
  value,
  min,
  max,
  disabled,
  onDragStart,
  onDrag,
  onDragEnd,
  onKey,
  onActivate,
  ring,
  pulse,
  role = "slider",
  checked,
  className = "",
}: {
  children: ReactNode;
  label: string;
  valueText?: string | undefined;
  value?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
  disabled?: boolean | undefined;
  onDragStart?: ((p: Pt) => void) | undefined;
  onDrag?: ((p: Pt, start: Pt) => void) | undefined;
  onDragEnd?: ((p: Pt, moved: boolean) => void) | undefined;
  onKey?: ((key: string, shift: boolean) => boolean) | undefined;
  onActivate?: (() => void) | undefined;
  ring?: { cx: number; cy: number; r: number } | undefined;
  pulse?: boolean | undefined;
  role?: "slider" | "button" | "switch" | undefined;
  checked?: boolean | undefined;
  className?: string | undefined;
}) {
  const down = useSvgDrag({
    disabled,
    onStart: (p) => onDragStart?.(p),
    onMove: (p, s) => onDrag?.(p, s),
    onEnd: (p, moved) => {
      onDragEnd?.(p, moved);
      if (!moved) onActivate?.();
    },
  });
  const key = (e: KeyboardEvent<SVGGElement>) => {
    if (disabled) return;
    if ((e.key === "Enter" || e.key === " ") && onActivate) {
      e.preventDefault();
      onActivate();
      return;
    }
    if (onKey?.(e.key, e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  return (
    <g
      className={`ls-handle ${className}`}
      tabIndex={disabled ? -1 : 0}
      role={role}
      aria-label={label}
      aria-valuetext={role === "slider" ? valueText : undefined}
      aria-valuenow={role === "slider" && value !== undefined ? Number(value.toFixed(3)) : undefined}
      aria-valuemin={role === "slider" ? min : undefined}
      aria-valuemax={role === "slider" ? max : undefined}
      aria-checked={role === "switch" ? !!checked : undefined}
      aria-disabled={disabled || undefined}
      onPointerDown={down}
      onKeyDown={key}
    >
      {ring && pulse && !disabled && <Pulse cx={ring.cx} cy={ring.cy} r={ring.r} />}
      {children}
      {ring && <circle className="ls-focus" cx={ring.cx} cy={ring.cy} r={ring.r + 5} fill="none" stroke={V3.cyan} strokeWidth={2} strokeDasharray="4 3" pointerEvents="none" />}
    </g>
  );
}

/* ------------------------------------------------------------------ affordances */

/** Two expanding rings: "the thing to touch next". */
export function Pulse({ cx, cy, r, colour = V3.cyan }: { cx: number; cy: number; r: number; colour?: string }) {
  return (
    <g pointerEvents="none" aria-hidden data-guide="target">
      <circle className="ls-pulse" cx={cx} cy={cy} r={r} fill="none" stroke={colour} strokeWidth={2} />
      <circle className="ls-pulse d2" cx={cx} cy={cy} r={r} fill="none" stroke={colour} strokeWidth={2} />
    </g>
  );
}

/** A pulsing outline around a rectangular target. */
export function PulseRect({ x, y, w, h, rx = 10, colour = V3.cyan }: { x: number; y: number; w: number; h: number; rx?: number; colour?: string }) {
  return (
    <g pointerEvents="none" aria-hidden data-guide="target">
      <rect className="ls-breathe" x={x} y={y} width={w} height={h} rx={rx} fill={`${colour}14`} stroke={colour} strokeWidth={2} strokeDasharray="6 5" />
    </g>
  );
}

/** Small floating instruction tag in SVG space. */
export function Tag({ x, y, text, colour = V3.cyan, anchor = "middle" }: { x: number; y: number; text: string; colour?: string; anchor?: "start" | "middle" | "end" }) {
  const w = text.length * 6.4 + 18;
  const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  return (
    <g pointerEvents="none" aria-hidden className="ls-breathe">
      <rect x={x0} y={y - 12} width={w} height={22} rx={11} fill="#060d1f" fillOpacity={0.82} stroke={colour} strokeOpacity={0.6} />
      <text x={x0 + w / 2} y={y + 3.5} textAnchor="middle" fontSize={11} fontWeight={700} fill={colour} fontFamily="Inter, system-ui, sans-serif">
        {text}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ numbers */

/**
 * A number that eases to its new value (about 350 ms) by writing the DOM directly, so a changing
 * readout never re-renders its parent per frame. Reduced motion jumps.
 */
export function Num({ value, digits = 2, className = "", format, svg }: { value: number | null | undefined; digits?: number; className?: string; format?: ((v: number) => string) | undefined; svg?: boolean }) {
  const el = useRef<HTMLSpanElement & SVGTSpanElement>(null);
  const shown = useRef<number | null>(value ?? null);
  const target = useRef<number | null | undefined>(value);
  const running = useRef(false);
  const raf = useRef(0);
  const reduced = useReducedMotion();
  const fmt = useCallback((v: number) => (format ? format(v) : v.toFixed(digits)), [format, digits]);
  // The running follower reads these refs, not its first render's closure: when the precision
  // changes mid-ease (0 -> 0.491 A is "0" then "0.491"), a stale toFixed(0) would leave "0" on screen.
  const fmtRef = useRef(fmt);
  fmtRef.current = fmt;
  const digitsRef = useRef(digits);
  digitsRef.current = digits;
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    if (value == null || !Number.isFinite(value)) {
      node.textContent = "–";
      shown.current = null;
      return;
    }
    target.current = value;
    const from = shown.current;
    if (reduced || from === null || from === value) {
      node.textContent = fmt(value);
      shown.current = value;
      return;
    }
    if (running.current) return; // the follower below picks up the new target
    // Exponential follower (time constant ~90 ms): smooth even when the target moves every frame.
    running.current = true;
    let last = performance.now();
    const tick = (now: number) => {
      const t = target.current;
      const cur = shown.current;
      const n = el.current;
      if (t == null || cur == null || !n) {
        running.current = false;
        return;
      }
      const k = 1 - Math.exp(-(now - last) / 90);
      last = now;
      let v = cur + (t - cur) * k;
      if (Math.abs(t - v) <= Math.abs(t) * 1e-4 + Math.pow(10, -digitsRef.current - 1)) v = t;
      shown.current = v;
      n.textContent = fmtRef.current(v);
      if (v !== t) raf.current = requestAnimationFrame(tick);
      else running.current = false;
    };
    raf.current = requestAnimationFrame(tick);
  }, [value, reduced, fmt, digits]);
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      running.current = false;
    },
    [],
  );
  // React renders the first text only; later updates are written straight to the DOM.
  const [initial] = useState(() => (value == null || !Number.isFinite(value) ? "–" : fmt(value)));
  if (svg) return <tspan ref={el}>{initial}</tspan>;
  return (
    <span ref={el} className={`tabular-nums ${className}`}>
      {initial}
    </span>
  );
}

/** Eases a value toward its target in React state (for SVG geometry that must morph, e.g. demo jumps). */
export function useEased(target: number, ms = 450): number {
  const reduced = useReducedMotion();
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (reduced || ms <= 0) {
      cur.current = target;
      setV(target);
      return;
    }
    const from = cur.current;
    if (from === target) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const x = from + (target - from) * easeInOut(k);
      cur.current = x;
      setV(x);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return v;
}

/* ------------------------------------------------------------------ try / demo helpers */

/** The current step id when the learner is driving (Try), else null: used to light up targets. */
export function useFocusStep<S>(session: SimSession<S>): string | null {
  return session.mode === "try" && !session.stopped ? session.currentStepId : null;
}

export type DemoPreview = {
  /** The next golden event, while it is within the lead window. */
  next: LabEvent | null;
  /** 0 when the event enters the window, 1 at the moment it fires. */
  k: number;
  /** The event that fired most recently and how long ago (ms). */
  last: LabEvent | null;
  since: number;
};

/** Demo only: what the golden run is about to do, so the bench can animate toward it. */
export function useDemoPreview<S>(session: SimSession<S>, lead = 1100): DemoPreview {
  if (session.mode !== "demo") return { next: null, k: 0, last: null, since: Infinity };
  const t = session.demo.t;
  const up = session.demo.upcoming;
  const last = session.events[session.events.length - 1] ?? null;
  const next = up && up.t - t <= lead ? up : null;
  const k = next ? clampN(1 - (next.t - t) / lead, 0, 1) : 0;
  return { next, k, last, since: last ? t - last.t : Infinity };
}

/** Payload helper: the value of a param.set event for one key, else undefined. */
export function paramOf(e: LabEvent | null | undefined, key: string): unknown {
  if (!e || e.type !== "param.set") return undefined;
  const p = e.payload as { key: string; value: unknown };
  return p.key === key ? p.value : undefined;
}

/**
 * The demo cursor: a soft hand-pointer that glides between targets and dips when it "presses".
 * `follow` turns off the glide transition while it is being driven frame by frame.
 */
export function GhostHand({ at, pressing, follow, label }: { at: Pt | null; pressing?: boolean; follow?: boolean; label?: string }) {
  const last = useRef<Pt>({ x: 0, y: 0 });
  if (at) last.current = at;
  const p = last.current;
  return (
    <g className={`ls-hand ${follow ? "ls-follow" : ""}`} style={{ transform: `translate(${p.x}px, ${p.y}px)`, opacity: at ? 1 : 0 }} pointerEvents="none" aria-hidden>
      <circle r={pressing ? 16 : 0} fill={V3.cyan} fillOpacity={0.18} stroke={V3.cyan} strokeOpacity={0.6} style={{ transition: "r .2s" }} />
      <g transform={`translate(-6 -2) scale(${pressing ? 0.92 : 1})`}>
        <path d="M6 2 C6 0.3 8.6 0.3 8.6 2 L8.6 11 L10 11 C10 9.6 12.4 9.6 12.4 11 L12.4 12 C12.4 10.7 14.8 10.7 14.8 12 L14.8 13 C14.8 11.8 17.2 11.8 17.2 13 L17.2 19 C17.2 23 15 26 11 26 L9.5 26 C7 26 5.6 24.6 4.4 22.8 L1.2 17.6 C0.4 16.3 2 14.9 3.3 15.9 L6 18 Z" fill="#fff" stroke="#0b1730" strokeWidth={1.4} strokeLinejoin="round" filter="drop-shadow(0 4px 6px rgba(0,0,0,.55))" />
      </g>
      {label && (
        <text x={18} y={36} fontSize={11} fontWeight={700} fill="#dbe7ff" fontFamily="Inter, system-ui, sans-serif" stroke="#060d1f" strokeWidth={3} paintOrder="stroke">
          {label}
        </text>
      )}
    </g>
  );
}
