/**
 * Numerical maths for the plotter and visualisers (build plan 3.8, 3.9): adaptive sampling that
 * breaks lines at discontinuities, quadratic roots (with the complex pair), Riemann sums, grid
 * steps in 1-2-5, and seeded probability.
 */
import { rng } from "@labscape/physics/core";

export type Pt = { x: number; y: number };

/**
 * Samples f on [x0, x1] for a view of height `span` (y units). Splits more where the curve bends,
 * and returns separate polylines wherever it jumps (tan x, 1/x) or is undefined (sqrt of negatives),
 * so the plot never draws a false vertical line.
 */
export function sample(f: (x: number) => number, x0: number, x1: number, span: number, opts: { base?: number; maxDepth?: number } = {}): Pt[][] {
  const base = opts.base ?? 320;
  const maxDepth = opts.maxDepth ?? 7;
  const lines: Pt[][] = [];
  let line: Pt[] = [];
  const flush = () => {
    if (line.length > 1) lines.push(line);
    line = [];
  };
  const ok = (y: number) => Number.isFinite(y);
  const jump = span * 0.5;

  // A gap between a and b is a discontinuity if bisecting keeps finding a big jump in an ever smaller interval.
  const isBreak = (a: Pt, b: Pt): boolean => {
    let [l, r] = [a, b];
    for (let i = 0; i < 40; i++) {
      const mx = (l.x + r.x) / 2;
      const m = { x: mx, y: f(mx) };
      if (!ok(m.y)) return true;
      const dl = Math.abs(m.y - l.y);
      const dr = Math.abs(r.y - m.y);
      if (Math.max(dl, dr) < jump * 0.25) return false; // the jump shrank: it is a steep but continuous curve
      [l, r] = dl > dr ? [l, m] : [m, r];
    }
    return true;
  };

  const refine = (a: Pt, b: Pt, depth: number) => {
    const mx = (a.x + b.x) / 2;
    const m = { x: mx, y: f(mx) };
    if (depth < maxDepth && ok(a.y) && ok(b.y) && ok(m.y)) {
      // deviation of the midpoint from the chord, relative to the view
      const dev = Math.abs(m.y - (a.y + b.y) / 2);
      if (dev > span * 0.002 || Math.abs(b.y - a.y) > jump * 0.5) {
        refine(a, m, depth + 1);
        refine(m, b, depth + 1);
        return;
      }
    }
    push(b, a);
  };

  const push = (p: Pt, prev: Pt | null) => {
    if (!ok(p.y)) {
      flush();
      return;
    }
    if (prev && ok(prev.y) && Math.abs(p.y - prev.y) > jump && isBreak(prev, p)) flush();
    line.push(p);
  };

  const n = base;
  let prev: Pt = { x: x0, y: f(x0) };
  push(prev, null);
  for (let i = 1; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const p = { x, y: f(x) };
    if (ok(prev.y) && ok(p.y)) refine(prev, p, 0);
    else push(p, prev);
    prev = p;
  }
  flush();
  return lines;
}

/** Gridline step in a 1-2-5 sequence so about `target` lines fill the span. */
export function niceStep(span: number, target = 8): number {
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/* ------------------------------------------------------------------ quadratics */

export type Roots = { kind: "two"; r1: number; r2: number } | { kind: "one"; r: number } | { kind: "complex"; re: number; im: number } | { kind: "linear"; r: number | null };

export function quadratic(a: number, b: number, c: number) {
  if (Math.abs(a) < 1e-12) return { disc: NaN, roots: { kind: "linear", r: Math.abs(b) < 1e-12 ? null : -c / b } as Roots, vertex: null };
  const disc = b * b - 4 * a * c;
  const vx = -b / (2 * a);
  const vertex = { x: vx, y: a * vx * vx + b * vx + c };
  const eps = 1e-9 * Math.max(1, b * b, Math.abs(4 * a * c));
  let roots: Roots;
  if (Math.abs(disc) <= eps) roots = { kind: "one", r: vx };
  else if (disc > 0) {
    // numerically stable form
    const q = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(disc));
    const r1 = q / a;
    const r2 = c / q;
    roots = { kind: "two", r1: Math.min(r1, r2), r2: Math.max(r1, r2) };
  } else roots = { kind: "complex", re: vx, im: Math.sqrt(-disc) / (2 * Math.abs(a)) };
  return { disc, roots, vertex };
}

/* ------------------------------------------------------------------ calculus */

export type RiemannMethod = "left" | "right" | "midpoint" | "trapezoid";

export function riemann(f: (x: number) => number, a: number, b: number, n: number, method: RiemannMethod) {
  const h = (b - a) / n;
  let s = 0;
  const rects: { x0: number; x1: number; h: number; h2?: number }[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = a + i * h;
    const x1 = x0 + h;
    if (method === "trapezoid") {
      const y0 = f(x0);
      const y1 = f(x1);
      s += ((y0 + y1) / 2) * h;
      rects.push({ x0, x1, h: y0, h2: y1 });
    } else {
      const x = method === "left" ? x0 : method === "right" ? x1 : (x0 + x1) / 2;
      const y = f(x);
      s += y * h;
      rects.push({ x0, x1, h: y });
    }
  }
  return { sum: s, rects };
}

/** Composite Simpson's rule with many panels: the "exact" area for comparisons. */
export function integrate(f: (x: number) => number, a: number, b: number, n = 2000): number {
  const m = n % 2 ? n + 1 : n;
  const h = (b - a) / m;
  let s = f(a) + f(b);
  for (let i = 1; i < m; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

/** Central-difference slope (used to check a student's reading of a tangent). */
export const slopeAt = (f: (x: number) => number, x: number, h = 1e-5) => (f(x + h) - f(x - h)) / (2 * h);

/* ------------------------------------------------------------------ probability */


export type Trial = "coin" | "die" | "two-dice" | "spinner";

/** Runs n trials with a seeded generator; outcomes are decided before any animation. */
export function runTrials(kind: Trial, n: number, seed: number) {
  const r = rng(seed);
  const outcomes = new Int8Array(n);
  const counts = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const o = kind === "coin" ? r.int(2) : kind === "die" ? 1 + r.int(6) : kind === "two-dice" ? 2 + r.int(6) + r.int(6) : r.int(4);
    outcomes[i] = o;
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  return { outcomes, counts };
}

/** Theoretical probabilities for each outcome. */
export function theory(kind: Trial): Map<number, number> {
  if (kind === "coin") return new Map([[0, 0.5], [1, 0.5]]);
  if (kind === "die") return new Map([1, 2, 3, 4, 5, 6].map((k) => [k, 1 / 6]));
  if (kind === "spinner") return new Map([0, 1, 2, 3].map((k) => [k, 0.25]));
  return new Map(Array.from({ length: 11 }, (_, i) => [i + 2, (6 - Math.abs(i + 2 - 7)) / 36]));
}
