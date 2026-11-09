import type { Node } from "../core/expr";

/**
 * Plain-words descriptions for the graphing sandbox (ages 12-16): what shape each function is,
 * where its key points are, and what dragging each slider does to it. Works numerically from the
 * compiled function, so it does not care how the student typed it.
 */

type Fn = (x: number) => number;
export type Shape = { kind: "constant" | "line" | "parabola" | "cubic" | "wave" | "exponential" | "curve"; text: string[] };

const n = (x: number, k = 3) => {
  if (!Number.isFinite(x)) return "–";
  const v = Number(x.toPrecision(k));
  return String(Math.abs(v) < 1e-9 ? 0 : v).replace("-", "−");
};

function uses(node: Node, test: (n: Node) => boolean): boolean {
  if (test(node)) return true;
  if (node.k === "neg" || node.k === "fn") return uses(node.a, test);
  if (node.k === "bin") return uses(node.a, test) || uses(node.b, test);
  return false;
}
const hasX = (node: Node) => uses(node, (q) => q.k === "var" && q.name === "x");

/** Polynomial degree (0-3) from finite differences at x = -2..3, or null if not a low polynomial. */
export function polyDegree(f: Fn): 0 | 1 | 2 | 3 | null {
  let ys = [-2, -1, 0, 1, 2, 3, 4].map(f);
  if (!ys.every(Number.isFinite)) return null;
  const tol = 1e-7 * Math.max(1, ...ys.map(Math.abs));
  for (let d = 0; d <= 3; d++) {
    if (ys.every((y) => Math.abs(y - ys[0]!) <= tol)) return d as 0 | 1 | 2 | 3;
    ys = ys.slice(1).map((y, i) => y - ys[i]!);
  }
  return null;
}

/** Quadratic coefficients A x^2 + B x + C read off f(-1), f(0), f(1). */
export const quadCoeffs = (f: Fn) => {
  const y0 = f(0), y1 = f(1), ym = f(-1);
  return { A: (y1 + ym - 2 * y0) / 2, B: (y1 - ym) / 2, C: y0 };
};

export function describe(f: Fn, node: Node): Shape {
  const c = f(0);
  const yInt = Number.isFinite(c) ? `It crosses the y-axis at y = ${n(c)} (put x = 0 in).` : "It never crosses the y-axis (x = 0 is not allowed here).";
  if (!hasX(node)) return { kind: "constant", text: [`A flat, horizontal line at y = ${n(c)}: there is no x in it, so y is the same everywhere.`] };
  const deg = polyDegree(f);
  if (deg === 0) return { kind: "constant", text: [`A flat, horizontal line at y = ${n(c)}: the x parts cancel out.`] };
  if (deg === 1) {
    const m = f(1) - c;
    if (Math.abs(m) < 1e-12) return { kind: "constant", text: [`A flat, horizontal line at y = ${n(c)}: the gradient is 0.`] };
    return {
      kind: "line",
      text: [
        `A straight line with gradient (slope) ${n(m)}: for every 1 step to the right it goes ${m > 0 ? "up" : "down"} ${n(Math.abs(m))}. ${m > 0 ? "It slopes uphill." : "It slopes downhill."}`,
        `${yInt} That number is called the y-intercept (c in y = mx + c).`,
        `It crosses the x-axis at x = ${n(-c / m)}, where y = 0.`,
      ],
    };
  }
  if (deg === 2) {
    const { A, B, C } = quadCoeffs(f);
    const vx = -B / (2 * A), vy = f(vx);
    const disc = B * B - 4 * A * C;
    const roots = Math.abs(disc) < 1e-9 * Math.max(1, B * B) ? `It just touches the x-axis at x = ${n(vx)} (the two roots are the same).` : disc > 0 ? `It crosses the x-axis twice, at x = ${n((-B - Math.sqrt(disc)) / (2 * A))} and x = ${n((-B + Math.sqrt(disc)) / (2 * A))}. These are the roots, where y = 0.` : `It never reaches the x-axis, so it has no real roots.`;
    return {
      kind: "parabola",
      text: [
        `A parabola that opens ${A > 0 ? "upward, like a U" : "downward, like an upside-down U"}, because the number in front of x² is ${A > 0 ? "positive" : "negative"} (${n(A)}).${Math.abs(A) > 1.05 ? " Bigger than 1, so it is narrower than y = x²." : Math.abs(A) < 0.95 ? " Smaller than 1, so it is wider than y = x²." : ""}`,
        `Its turning point (vertex) is at (${n(vx)}, ${n(vy)}): the ${A > 0 ? "lowest" : "highest"} point. The curve is a mirror image either side of x = ${n(vx)}.`,
        roots,
        yInt,
      ],
    };
  }
  if (deg === 3) return { kind: "cubic", text: ["A cubic (x³) curve: an S-shape that keeps going up on one side and down on the other.", yInt] };
  if (uses(node, (q) => q.k === "fn" && (q.name === "sin" || q.name === "cos"))) {
    const ys = Array.from({ length: 801 }, (_, i) => f(-20 + i * 0.05)).filter(Number.isFinite);
    const hi = Math.max(...ys), lo = Math.min(...ys);
    return { kind: "wave", text: [`A wave that repeats over and over. It goes up and down between y = ${n(lo)} and y = ${n(hi)}, so its height from the middle (amplitude) is ${n((hi - lo) / 2)}.`, yInt] };
  }
  if (uses(node, (q) => (q.k === "fn" && q.name === "exp") || (q.k === "bin" && q.op === "^" && hasX(q.b)))) {
    const grow = Math.abs(f(2)) > Math.abs(f(1));
    return { kind: "exponential", text: [grow ? "An exponential curve: it grows faster and faster as x increases (each step multiplies it)." : "An exponential decay: it shrinks towards 0 as x increases, but never quite reaches it.", yInt] };
  }
  return { kind: "curve", text: ["A curve. Drag the Trace x slider along it to see how y changes.", yInt] };
}

/** The shape's key numbers, for comparing before and after a slider moves. */
function features(f: Fn, node: Node) {
  const deg = hasX(node) ? polyDegree(f) : 0;
  const y0 = f(0);
  if (deg === 0 || deg === 1) return { kind: "line" as const, m: f(1) - y0, c: y0 };
  if (deg === 2) {
    const { A, B } = quadCoeffs(f);
    const vx = -B / (2 * A);
    return { kind: "parabola" as const, A, vx, vy: f(vx), c: y0 };
  }
  const ys = Array.from({ length: 401 }, (_, i) => f(-10 + i * 0.05));
  const fin = ys.filter(Number.isFinite);
  let crossings = 0;
  const mid = fin.length ? (Math.max(...fin) + Math.min(...fin)) / 2 : 0;
  for (let i = 1; i < ys.length; i++) if (Number.isFinite(ys[i]!) && Number.isFinite(ys[i - 1]!) && (ys[i]! - mid) * (ys[i - 1]! - mid) < 0) crossings++;
  return { kind: "other" as const, amp: fin.length ? (Math.max(...fin) - Math.min(...fin)) / 2 : 0, mid, crossings, c: y0 };
}

/**
 * What increasing `param` does to this curve, as a sentence: "Increasing b moves the vertex left
 * and down." `at(v)` builds the function with the parameter set to v.
 */
export function paramEffect(param: string, value: number, at: (v: number) => Fn, node: Node): string {
  const h = 0.05 * Math.max(1, Math.abs(value));
  const a = features(at(value), node), b = features(at(value + h), node);
  const tiny = (d: number, ref = 1) => Math.abs(d) < 1e-6 * Math.max(1, Math.abs(ref));
  const bits: string[] = [];
  if (a.kind === "line" && b.kind === "line") {
    if (!tiny(b.m - a.m, a.m)) {
      if (Math.sign(a.m) !== Math.sign(b.m) && a.m !== 0) bits.push(`tips the line the other way (the gradient passes 0)`);
      else bits.push(Math.abs(b.m) > Math.abs(a.m) ? `makes the line steeper${b.m < 0 ? " downhill" : ""}` : "makes the line flatter");
    }
    if (!tiny(b.c - a.c, a.c)) bits.push(`moves where it crosses the y-axis ${b.c > a.c ? "up" : "down"}`);
  } else if (a.kind === "parabola" && b.kind === "parabola") {
    if (!tiny(b.A - a.A, a.A)) bits.push(Math.sign(a.A) !== Math.sign(b.A) ? "flips the U over (as the x² number passes 0)" : Math.abs(b.A) > Math.abs(a.A) ? "makes the U narrower" : "makes the U wider");
    const dx = b.vx - a.vx, dy = b.vy - a.vy;
    const lr = tiny(dx, a.vx) ? "" : dx > 0 ? "right" : "left";
    const ud = tiny(dy, a.vy) ? "" : dy > 0 ? "up" : "down";
    if (lr || ud) bits.push(`moves the vertex ${[lr, ud].filter(Boolean).join(" and ")}`);
  } else if (a.kind === "other" && b.kind === "other") {
    if (!tiny(b.amp - a.amp, a.amp)) bits.push(b.amp > a.amp ? "makes the curve taller" : "makes the curve shorter");
    if (b.crossings !== a.crossings) bits.push(b.crossings > a.crossings ? "squeezes the waves closer together" : "stretches the waves further apart");
    if (!tiny(b.mid - a.mid, a.mid)) bits.push(`moves it ${b.mid > a.mid ? "up" : "down"}`);
    if (!bits.length && !tiny(b.c - a.c, a.c)) bits.push(`moves where it crosses the y-axis ${b.c > a.c ? "up" : "down"}`);
  } else bits.push("changes the type of curve");
  if (!bits.length) return `Changing ${param} makes no difference here.`;
  return `Increasing ${param} ${bits.join(" and ")}.`;
}
