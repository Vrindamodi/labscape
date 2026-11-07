import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { niceStep, sample } from "../core/numeric";

export type View = { x0: number; x1: number; y0: number; y1: number };
export type Curve = { f: (x: number) => number; colour: string; width?: number; dash?: number[]; label?: string };
export type Mapper = { X: (x: number) => number; Y: (y: number) => number; invX: (px: number) => number; invY: (py: number) => number; view: View; w: number; h: number };

/**
 * Function plotter (build plan 3.8): adaptive sampling with discontinuity breaks, 1-2-5 gridlines
 * that relabel as you zoom, inertial panning, wheel and pinch zoom, keyboard pan/zoom. Curves are
 * drawn on canvas; interactive overlays (points, tangents, rectangles) go in an SVG on top that
 * shares the same mapping.
 */
export function Plot({ curves, view: controlled, onView, overlay, height = 360, ariaLabel, lockZoom }: { curves: Curve[]; view: View; onView?: (v: View) => void; overlay?: (m: Mapper) => ReactNode; height?: number; ariaLabel: string; lockZoom?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(600);
  const [view, setView] = useState(controlled);
  const reduced = useReducedMotion();
  useEffect(() => setView(controlled), [controlled]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const commit = useCallback(
    (v: View) => {
      setView(v);
      onView?.(v);
    },
    [onView],
  );

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const m: Mapper = useMemo(() => {
    const X = (x: number) => ((x - view.x0) / (view.x1 - view.x0)) * w;
    const Y = (y: number) => height - ((y - view.y0) / (view.y1 - view.y0)) * height;
    return { X, Y, invX: (px) => view.x0 + (px / w) * (view.x1 - view.x0), invY: (py) => view.y0 + ((height - py) / height) * (view.y1 - view.y0), view, w, h: height };
  }, [view, w, height]);

  // draw grid + curves
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = height * dpr;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, height);
    const sx = niceStep(view.x1 - view.x0, Math.max(4, Math.round(w / 80)));
    const sy = niceStep(view.y1 - view.y0, Math.max(4, Math.round(height / 60)));
    g.font = "11px Inter, sans-serif";
    // minor grid
    g.strokeStyle = "rgba(140,170,230,.08)";
    g.lineWidth = 1;
    for (let x = Math.ceil(view.x0 / (sx / 5)) * (sx / 5); x <= view.x1; x += sx / 5) {
      g.beginPath();
      g.moveTo(m.X(x), 0);
      g.lineTo(m.X(x), height);
      g.stroke();
    }
    for (let y = Math.ceil(view.y0 / (sy / 5)) * (sy / 5); y <= view.y1; y += sy / 5) {
      g.beginPath();
      g.moveTo(0, m.Y(y));
      g.lineTo(w, m.Y(y));
      g.stroke();
    }
    // major grid + labels
    g.strokeStyle = "rgba(140,170,230,.18)";
    const ax = Math.min(Math.max(m.Y(0), 12), height - 4);
    const ay = Math.min(Math.max(m.X(0), 4), w - 30);
    g.fillStyle = "rgba(220,230,255,.55)";
    for (let x = Math.ceil(view.x0 / sx) * sx; x <= view.x1; x += sx) {
      const v = Number(x.toPrecision(10));
      g.beginPath();
      g.moveTo(m.X(v), 0);
      g.lineTo(m.X(v), height);
      g.stroke();
      if (Math.abs(v) > sx * 1e-6) {
        g.textAlign = "center";
        g.fillText(String(Number(v.toPrecision(6))), m.X(v), ax + 14 > height ? ax - 6 : ax + 14);
      }
    }
    for (let y = Math.ceil(view.y0 / sy) * sy; y <= view.y1; y += sy) {
      const v = Number(y.toPrecision(10));
      g.beginPath();
      g.moveTo(0, m.Y(v));
      g.lineTo(w, m.Y(v));
      g.stroke();
      if (Math.abs(v) > sy * 1e-6) {
        g.textAlign = "left";
        g.fillText(String(Number(v.toPrecision(6))), ay + 5, m.Y(v) + 4);
      }
    }
    // axes
    g.strokeStyle = "rgba(220,230,255,.6)";
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(0, m.Y(0));
    g.lineTo(w, m.Y(0));
    g.moveTo(m.X(0), 0);
    g.lineTo(m.X(0), height);
    g.stroke();
    // curves
    const span = view.y1 - view.y0;
    for (const cv of curves) {
      g.strokeStyle = cv.colour;
      g.lineWidth = cv.width ?? 2.5;
      g.setLineDash(cv.dash ?? []);
      g.lineJoin = "round";
      const lines = sample(cv.f, view.x0, view.x1, span, { base: Math.max(200, Math.round(w / 2)) });
      for (const line of lines) {
        g.beginPath();
        line.forEach((p, i) => {
          // clamp far off-screen values so the canvas path stays sane
          const py = Math.max(-1e4, Math.min(1e4, m.Y(p.y)));
          if (i) g.lineTo(m.X(p.x), py);
          else g.moveTo(m.X(p.x), py);
        });
        g.stroke();
      }
    }
    g.setLineDash([]);
  }, [curves, view, w, height, m]);

  // pan and zoom
  const drag = useRef<{ x: number; y: number; v: View; t: number; vx: number; vy: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch0 = useRef<{ d: number; v: View } | null>(null);
  const inertia = useRef(0);

  const zoomAt = (px: number, py: number, f: number) => {
    if (lockZoom) return;
    const v = viewRef.current;
    const cx = m.invX(px);
    const cy = m.invY(py);
    commit({ x0: cx + (v.x0 - cx) * f, x1: cx + (v.x1 - cx) * f, y0: cy + (v.y0 - cy) * f, y1: cy + (v.y1 - cy) * f });
  };

  return (
    <div ref={wrap} className="relative w-full select-none overflow-hidden rounded-xl bg-[#0b1430] ring-1 ring-inset ring-white/10" style={{ height }}>
      <canvas ref={canvas} style={{ width: w, height }} className="absolute inset-0" />
      <svg
        className="absolute inset-0 touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent"
        width={w}
        height={height}
        tabIndex={0}
        role="img"
        aria-label={`${ariaLabel}. Drag to pan, scroll or pinch to zoom; arrow keys pan, + and - zoom.`}
        onWheel={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(e.deltaY * 0.0012));
        }}
        onKeyDown={(e) => {
          const v = viewRef.current;
          const dx = (v.x1 - v.x0) * 0.08;
          const dy = (v.y1 - v.y0) * 0.08;
          const map: Record<string, View> = {
            ArrowLeft: { ...v, x0: v.x0 - dx, x1: v.x1 - dx },
            ArrowRight: { ...v, x0: v.x0 + dx, x1: v.x1 + dx },
            ArrowUp: { ...v, y0: v.y0 + dy, y1: v.y1 + dy },
            ArrowDown: { ...v, y0: v.y0 - dy, y1: v.y1 - dy },
          };
          if (map[e.key] && e.target === e.currentTarget) {
            e.preventDefault();
            commit(map[e.key]!);
          }
          if (e.key === "+" || e.key === "=") zoomAt(w / 2, height / 2, 0.8);
          if (e.key === "-") zoomAt(w / 2, height / 2, 1.25);
        }}
        onPointerDown={(e) => {
          if ((e.target as Element).closest("[data-handle]")) return;
          cancelAnimationFrame(inertia.current);
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            pinch0.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), v: viewRef.current };
            drag.current = null;
          } else drag.current = { x: e.clientX, y: e.clientY, v: viewRef.current, t: performance.now(), vx: 0, vy: 0 };
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch0.current && pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
            const f = pinch0.current.d / Math.max(10, d);
            const v = pinch0.current.v;
            const cx = (v.x0 + v.x1) / 2;
            const cy = (v.y0 + v.y1) / 2;
            if (!lockZoom) commit({ x0: cx + (v.x0 - cx) * f, x1: cx + (v.x1 - cx) * f, y0: cy + (v.y0 - cy) * f, y1: cy + (v.y1 - cy) * f });
            return;
          }
          const d = drag.current;
          if (!d) return;
          const now = performance.now();
          const ux = ((e.clientX - d.x) / w) * (d.v.x1 - d.v.x0);
          const uy = ((e.clientY - d.y) / height) * (d.v.y1 - d.v.y0);
          d.vx = (e.movementX / Math.max(1, now - d.t)) * ((d.v.x1 - d.v.x0) / w);
          d.vy = (e.movementY / Math.max(1, now - d.t)) * ((d.v.y1 - d.v.y0) / height);
          d.t = now;
          commit({ x0: d.v.x0 - ux, x1: d.v.x1 - ux, y0: d.v.y0 + uy, y1: d.v.y1 + uy });
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinch0.current = null;
          const d = drag.current;
          drag.current = null;
          if (!d || reduced) return;
          // inertial glide
          let vx = d.vx * 16;
          let vy = d.vy * 16;
          const step = () => {
            if (Math.abs(vx) + Math.abs(vy) < 1e-4 * (viewRef.current.x1 - viewRef.current.x0)) return;
            const v = viewRef.current;
            commit({ x0: v.x0 - vx, x1: v.x1 - vx, y0: v.y0 + vy, y1: v.y1 + vy });
            vx *= 0.9;
            vy *= 0.9;
            inertia.current = requestAnimationFrame(step);
          };
          inertia.current = requestAnimationFrame(step);
        }}
      >
        {overlay?.(m)}
      </svg>
    </div>
  );
}

/** Animates a number toward its target over ~200 ms so curves morph instead of jumping. */
export function useMorph(target: number, ms = 200): number {
  const reduced = useReducedMotion();
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduced) {
      setV(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const x = a + (target - a) * e;
      from.current = x;
      setV(x);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return v;
}

/** A draggable point on the overlay; also moves with arrow keys (step in x). */
export function Handle({ m, x, y, onDrag, onDragEnd, colour = "#ffd43b", label, keyStep = 0.1, r = 8 }: { m: Mapper; x: number; y: number; onDrag: (x: number, y: number) => void; onDragEnd?: () => void; colour?: string; label: string; keyStep?: number; r?: number }) {
  const dragging = useRef(false);
  return (
    <g
      data-handle
      tabIndex={0}
      role="slider"
      aria-label={label}
      aria-valuenow={Number(x.toFixed(3))}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        dragging.current = true;
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const svg = (e.currentTarget as SVGGElement).ownerSVGElement!.getBoundingClientRect();
        onDrag(m.invX(e.clientX - svg.left), m.invY(e.clientY - svg.top));
      }}
      onPointerUp={() => {
        dragging.current = false;
        onDragEnd?.();
      }}
      onKeyDown={(e) => {
        const s = e.shiftKey ? keyStep * 10 : keyStep;
        if (e.key === "ArrowRight") onDrag(x + s, y);
        else if (e.key === "ArrowLeft") onDrag(x - s, y);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyUp={(e) => (e.key === "ArrowRight" || e.key === "ArrowLeft") && onDragEnd?.()}
      className="cursor-grab outline-none [&:focus>circle]:stroke-[#7cf3ff]"
    >
      <circle cx={m.X(x)} cy={m.Y(y)} r={r + 6} fill="transparent" />
      <circle cx={m.X(x)} cy={m.Y(y)} r={r} fill={colour} stroke="#0b1430" strokeWidth={3} />
    </g>
  );
}
