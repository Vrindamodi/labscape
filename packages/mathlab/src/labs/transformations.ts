import type { RuleHit, SimModel, SimNote } from "@labscape/physics/protocol";

/* ================================================================== graph transformations */

/** Base functions the learner can transform. */
export type BaseFn = "x^2" | "abs" | "sin" | "x^3";
export const BASE_FNS: Record<BaseFn, { label: string; f: (x: number) => number }> = {
  "x^2": { label: "x²", f: (x) => x * x },
  abs: { label: "|x|", f: (x) => Math.abs(x) },
  sin: { label: "sin x", f: (x) => Math.sin(x) },
  "x^3": { label: "x³", f: (x) => x * x * x },
};

export type TransformParams = { f: BaseFn; a: number; b: number; c: number; d: number };
export type TransformTarget = TransformParams & { id: string; label: string };
export type TransformSetup = { targets: TransformTarget[] };
export type TransformState = TransformParams & { matched: string[]; checks: number };

export const IDENTITY: Omit<TransformParams, "f"> = { a: 1, b: 1, c: 0, d: 0 };

/** y = a f(b(x - c)) + d */
export function transformed(p: TransformParams): (x: number) => number {
  const base = BASE_FNS[p.f].f;
  return (x) => p.a * base(p.b * (x - p.c)) + p.d;
}

/** Same graph? Compared point by point, so equivalent parameter sets (e.g. a·b² for x²) also match. */
export function sameGraph(p: TransformParams, q: TransformParams): boolean {
  const f = transformed(p);
  const g = transformed(q);
  for (let i = 0; i <= 64; i++) {
    const x = -6 + (12 * i) / 64;
    if (Math.abs(f(x) - g(x)) > 1e-6) return false;
  }
  return true;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v * 100) / 100));

/** A targeted explanation of what is wrong, comparing one parameter at a time. */
export function mismatchAdvice(s: TransformParams, t: TransformParams): string {
  if (s.f !== t.f) return `Start from the right base graph: the target is built from y = ${BASE_FNS[t.f].label}.`;
  if (sameGraph({ ...s, c: -s.c }, t) && s.c !== 0) return "Your graph is shifted the wrong way. Inside the bracket it feels backwards: y = f(x − 2) moves the graph 2 to the RIGHT.";
  if (sameGraph({ ...s, d: t.d }, t)) return "The shape and sideways position are right. Now move it up or down with d (outside the function).";
  if (sameGraph({ ...s, c: t.c }, t)) return "The shape is right but it is in the wrong place sideways. Change c.";
  if (sameGraph({ ...s, a: -s.a }, t)) return "Upside down! A negative a reflects the graph in the x-axis.";
  if (sameGraph({ ...s, b: t.b }, t)) return "Check the horizontal stretch: b squashes the graph towards the y-axis by a factor of 1/b.";
  if (sameGraph({ ...s, a: t.a }, t)) return "Check the vertical stretch: a multiplies every y-value.";
  return "Not a match yet. Change one parameter at a time and watch which way the graph moves.";
}

export const graphTransformations: SimModel<TransformState> = {
  slug: "graph-transformations",
  init: () => ({ f: "x^2", ...IDENTITY, matched: [], checks: 0 }),
  apply: (s0, e, ctx) => {
    const setup = ctx.content.setup as unknown as TransformSetup;
    let s = s0;
    const hits: RuleHit[] = [];
    const notes: SimNote[] = [];
    if (e.type === "param.set") {
      const { key, value } = e.payload;
      if (key === "f" && typeof value === "string" && value in BASE_FNS) s = { ...s, f: value as BaseFn };
      if (key === "a" || key === "b") s = { ...s, [key]: clamp(Number(value), -4, 4) };
      if (key === "c" || key === "d") s = { ...s, [key]: clamp(Number(value), -6, 6) };
      if (key === "reset") s = { ...s, ...IDENTITY };
      if (key === "check") {
        const target = setup.targets.find((t) => !s.matched.includes(t.id));
        if (target) {
          s = { ...s, checks: s.checks + 1 };
          if (sameGraph(s, target)) {
            s = { ...s, matched: [...s.matched, target.id] };
            notes.push({ text: `Match! ${target.label}`, tone: "success" });
          } else {
            hits.push({ stepId: target.id, code: "no-match", severity: "minor", message: mismatchAdvice(s, target), tag: "conceptual", dimension: "technique" });
          }
        }
      }
    }
    return { state: s, hits, notes };
  },
  steps: {
    up: (s) => s.matched.includes("up"),
    right: (s) => s.matched.includes("right"),
    flip: (s) => s.matched.includes("flip"),
    squash: (s) => s.matched.includes("squash"),
    combo: (s) => s.matched.includes("combo"),
  },
  readouts: (s) => ({ f: s.f, a: s.a, b: s.b, c: s.c, d: s.d, matched: s.matched.length }),
};
