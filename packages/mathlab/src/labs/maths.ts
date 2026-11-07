import type { RuleHit, SimModel, SimNote } from "@labscape/physics/protocol";
import { fn1 } from "../core/expr";
import { integrate, quadratic, riemann, runTrials, slopeAt, type RiemannMethod, type Trial } from "../core/numeric";

const num = (v: unknown) => Number(v);
const resultKey = (k: string) => (k.startsWith("result:") ? k.slice(7) : null);

/* ================================================================== quadratic explorer */

export type QuadState = { a: number; b: number; c: number; seen: string[]; results: Record<string, number> };

/** Shapes the student has made, recorded the moment the coefficients produce them. */
function quadSeen(s: QuadState): string[] {
  const out = new Set(s.seen);
  const q = quadratic(s.a, s.b, s.c);
  const v = q.vertex;
  if (v && s.a > 0 && Math.abs(v.x - 2) <= 0.05 && Math.abs(v.y + 3) <= 0.05) out.add("vertex");
  if (Math.abs(s.a) > 1e-9 && q.roots.kind === "one") out.add("touch");
  if (q.roots.kind === "complex") out.add("complex");
  if (s.a < 0 && q.roots.kind === "two" && Math.abs(q.roots.r1 + 1) <= 0.05 && Math.abs(q.roots.r2 - 3) <= 0.05) out.add("flip");
  if (Math.abs(s.a) < 1e-9) out.add("linear");
  return [...out];
}

export const quadraticExplorer: SimModel<QuadState> = {
  slug: "quadratic-explorer",
  init: () => ({ a: 1, b: 0, c: 0, seen: [], results: {} }),
  apply: (s0, e) => {
    let s = s0;
    const hits: RuleHit[] = [];
    const notes: SimNote[] = [];
    if (e.type === "param.set") {
      const { key, value } = e.payload;
      if (key === "a" || key === "b" || key === "c") s = { ...s, [key]: Math.max(-10, Math.min(10, Math.round(num(value) * 100) / 100)) };
      const rk = resultKey(key);
      if (rk) {
        s = { ...s, results: { ...s.results, [rk]: num(value) } };
        if (rk === "root1" || rk === "root2") {
          const roots = [-1, 3]; // of 2x^2 - 4x - 6
          if (!roots.some((r) => Math.abs(num(value) - r) < 0.01)) hits.push({ code: "wrong-root", severity: "minor", message: "A root is where the curve crosses the x-axis (y = 0). Read the x-coordinates of the crossing points.", tag: "conceptual", dimension: "measurement" });
        }
      }
    }
    const before = s.seen;
    s = { ...s, seen: quadSeen(s) };
    if (s.seen.includes("linear") && !before.includes("linear")) notes.push({ text: "With a = 0 the x² term vanishes: this is a straight line, no longer a quadratic.", tone: "info" });
    if (s.seen.includes("touch") && !before.includes("touch")) notes.push({ text: "Discriminant zero: the two roots merged into one, where the curve just touches the axis.", tone: "success" });
    return { state: s, hits, notes };
  },
  steps: {
    vertex: (s) => s.seen.includes("vertex"),
    touch: (s) => s.seen.includes("touch"),
    complex: (s) => s.seen.includes("complex"),
    flip: (s) => s.seen.includes("flip"),
    roots: (s) => s.a === 2 && s.b === -4 && s.c === -6 && [s.results.root1, s.results.root2].filter((r) => r !== undefined).sort((x, y) => x! - y!).join() === "-1,3",
  },
  readouts: (s) => {
    const q = quadratic(s.a, s.b, s.c);
    return { disc: q.disc, vertexX: q.vertex?.x ?? null, vertexY: q.vertex?.y ?? null };
  },
};

/* ================================================================== balance-scale equations */

/** One side of the balance: x-bags and unit weights. */
export type Side = { x: number; k: number };
export type BalanceSetup = { equations: [Side, Side][] };
export type BalanceState = { eq: number; left: Side; right: Side; level: boolean; history: string[]; solved: number[]; collected: number[]; results: Record<string, number> };

/** Applies "both:-4", "both:/3", "both:-x", "left:+2" ... to the balance. */
export function applyOp(side: Side, op: string): Side | null {
  const m = /^([+\-*/])(\d+(?:\.\d+)?|x)$/.exec(op);
  if (!m) return null;
  const [, sym, rawArg] = m;
  if (rawArg === "x") {
    if (sym === "+") return { x: side.x + 1, k: side.k };
    if (sym === "-") return { x: side.x - 1, k: side.k };
    return null;
  }
  const v = Number(rawArg);
  switch (sym) {
    case "+": return { x: side.x, k: side.k + v };
    case "-": return { x: side.x, k: side.k - v };
    case "*": return { x: side.x * v, k: side.k * v };
    case "/": return v === 0 ? null : { x: side.x / v, k: side.k / v };
  }
  return null;
}

const solution = ([l, r]: [Side, Side]) => (r.k - l.k) / (l.x - r.x);

export const balanceEquations: SimModel<BalanceState> = {
  slug: "balance-equations",
  init: (c) => {
    const [l, r] = (c.setup as unknown as BalanceSetup).equations[0]!;
    return { eq: 0, left: { ...l }, right: { ...r }, level: true, history: [], solved: [], collected: [], results: {} };
  },
  apply: (s0, e, ctx) => {
    const setup = ctx.content.setup as unknown as BalanceSetup;
    let s = s0;
    const hits: RuleHit[] = [];
    const notes: SimNote[] = [];
    if (e.type === "param.set" && e.payload.key === "op") {
      const [where, op] = String(e.payload.value).split(":") as [string, string];
      const L = where === "both" || where === "left" ? applyOp(s.left, op) : s.left;
      const R = where === "both" || where === "right" ? applyOp(s.right, op) : s.right;
      if (!L || !R) hits.push({ code: "bad-op", severity: "minor", message: "That operation is not allowed (you cannot divide by zero).", tag: "conceptual", dimension: "technique" });
      else if (where !== "both") {
        s = { ...s, left: L, right: R, level: false, history: [...s.history, `${where}:${op}`] };
        hits.push({ code: "one-side", severity: "major", message: "You changed only one side, so the scale tipped: the two sides are no longer equal. Whatever you do to one side, do to the other. Undo it.", tag: "conceptual", dimension: "technique" });
      } else {
        // dividing must leave whole x-bags to keep the picture honest, but any exact division is allowed
        s = { ...s, left: L, right: R, history: [...s.history, `both:${op}`] };
      }
    }
    if (e.type === "param.set" && e.payload.key === "undo" && s.history.length) {
      const [l, r] = setup.equations[s.eq]!;
      let left = { ...l };
      let right = { ...r };
      const history = s.history.slice(0, -1);
      for (const h of history) {
        const [w, op] = h.split(":") as [string, string];
        if (w === "both" || w === "left") left = applyOp(left, op)!;
        if (w === "both" || w === "right") right = applyOp(right, op)!;
      }
      const level = history.every((h) => h.startsWith("both:"));
      s = { ...s, left, right, history, level };
    }
    if (e.type === "param.set" && e.payload.key === "equation") {
      const i = Math.max(0, Math.min(setup.equations.length - 1, num(e.payload.value)));
      const [l, r] = setup.equations[i]!;
      s = { ...s, eq: i, left: { ...l }, right: { ...r }, history: [], level: true };
    }
    if (e.type === "param.set" && resultKey(e.payload.key)) {
      const v = num(e.payload.value);
      s = { ...s, results: { ...s.results, [resultKey(e.payload.key)!]: v } };
      const x = solution(setup.equations[s.eq]!);
      if (Math.abs(v - x) > 1e-9) hits.push({ code: "wrong-x", severity: "minor", message: "Check by substituting your answer back into both sides: they must come out equal.", tag: "conceptual", dimension: "measurement" });
      else notes.push({ text: `x = ${x}. Check: both sides equal ${s.left.x * x + s.left.k}.`, tone: "success" });
    }
    // progress markers for the current equation
    if (s.level) {
      const isolated = (a: Side, b: Side) => a.x !== 0 && a.k === 0 && b.x === 0;
      const done = (isolated(s.left, s.right) && Math.abs(s.left.x - 1) < 1e-9) || (isolated(s.right, s.left) && Math.abs(s.right.x - 1) < 1e-9);
      if (done && !s.solved.includes(s.eq)) s = { ...s, solved: [...s.solved, s.eq] };
      const collected = (s.left.x === 0) !== (s.right.x === 0);
      if (collected && !s.collected.includes(s.eq)) s = { ...s, collected: [...s.collected, s.eq] };
    }
    return { state: s, hits, notes };
  },
  steps: {
    "isolate-1": (s) => s.eq === 0 && s.level && ((s.left.x !== 0 && s.left.k === 0) || (s.right.x !== 0 && s.right.k === 0)),
    "solve-1": (s) => s.solved.includes(0),
    "answer-1": (s, ctx) => s.results.x1 !== undefined && Math.abs(s.results.x1 - solution((ctx.content.setup as unknown as BalanceSetup).equations[0]!)) < 1e-9,
    "collect-2": (s) => s.collected.includes(1),
    "solve-2": (s) => s.solved.includes(1),
    "answer-2": (s, ctx) => s.results.x2 !== undefined && Math.abs(s.results.x2 - solution((ctx.content.setup as unknown as BalanceSetup).equations[1]!)) < 1e-9,
  },
  readouts: (s) => ({ level: s.level, left: `${s.left.x}x + ${s.left.k}`, right: `${s.right.x}x + ${s.right.k}` }),
};

/* ================================================================== unit circle */

export type CircleState = { angle: number; units: "deg" | "rad"; maxAngle: number; reads: Record<string, number>; marks: string[] };

export const unitCircle: SimModel<CircleState> = {
  slug: "unit-circle-trig",
  init: () => ({ angle: 0, units: "deg", maxAngle: 0, reads: {}, marks: [] }),
  apply: (s0, e) => {
    let s = s0;
    const hits: RuleHit[] = [];
    if (e.type === "param.set") {
      const { key, value } = e.payload;
      if (key === "angle") {
        const a = num(value);
        s = { ...s, angle: a, maxAngle: Math.max(s.maxAngle, a) };
      }
      if (key === "units") s = { ...s, units: value === "rad" ? "rad" : "deg" };
    }
    if (e.type === "measure.read") {
      const { key, value } = e.payload.reading;
      const r = (s.angle * Math.PI) / 180;
      const truth: Record<string, number> = { sin: Math.sin(r), cos: Math.cos(r), tan: Math.tan(r), rad: r };
      const t = truth[key];
      if (t === undefined) return { state: s, hits };
      if (Math.abs(value - t) <= 0.01) {
        const tag = key === "sin" && Math.abs(s.angle - 30) < 0.5 ? "sin30" : key === "cos" && s.angle > 90 && s.angle < 180 ? "cosII" : key === "rad" && Math.abs(s.angle - 60) < 0.5 && s.units === "rad" ? "rad60" : key;
        s = { ...s, reads: { ...s.reads, [tag]: value } };
      } else if (Math.abs(value + t) <= 0.01) hits.push({ code: "sign", severity: "minor", message: `Right size, wrong sign. In this quadrant ${key} is ${t < 0 ? "negative" : "positive"}: look at which side of the axis the point is on.`, tag: "conceptual", dimension: "measurement" });
      else hits.push({ code: "misread", severity: "minor", message: `${key} of this angle is ${t.toFixed(3)}. For sin read the height of the point; for cos, how far across it is.`, tag: "conceptual", dimension: "measurement" });
    }
    if (e.type === "timer.mark" && e.payload.label === "sin-equals-cos") {
      const r = (s.angle * Math.PI) / 180;
      if (Math.abs(Math.sin(r) - Math.cos(r)) < 0.02) s = { ...s, marks: [...s.marks, "equal"] };
      else hits.push({ code: "not-equal", severity: "minor", message: "At that angle the sine and cosine bars are different heights. Look for where they match.", tag: "conceptual", dimension: "measurement" });
    }
    return { state: s, hits };
  },
  steps: {
    thirty: (s) => s.reads.sin30 !== undefined,
    quadrant: (s) => s.reads.cosII !== undefined,
    equal: (s) => s.marks.includes("equal"),
    radians: (s) => s.reads.rad60 !== undefined,
    period: (s) => s.maxAngle >= 360,
  },
  readouts: (s) => ({ angle: s.angle }),
};

/* ================================================================== tangent and derivative */

export type TangentSetup = { f: string; fprime: string };
export type TangentState = { x: number; h: number; limitRun: boolean; reads: Record<string, number>; results: Record<string, string | number> };

/** Two expressions agree if they match at a spread of sample points. */
export function sameFunction(a: string, b: string): boolean {
  try {
    const fa = fn1(a);
    const fb = fn1(b);
    return [-2.3, -1.1, -0.4, 0.3, 0.9, 1.7, 2.6].every((x) => {
      const ya = fa(x);
      const yb = fb(x);
      return Number.isFinite(ya) && Math.abs(ya - yb) <= 1e-6 * Math.max(1, Math.abs(yb));
    });
  } catch {
    return false;
  }
}

export const tangentDerivative: SimModel<TangentState> = {
  slug: "derivative-as-slope",
  init: () => ({ x: 0, h: 1, limitRun: false, reads: {}, results: {} }),
  apply: (s0, e, ctx) => {
    const setup = ctx.content.setup as unknown as TangentSetup;
    const f = fn1(setup.f);
    let s = s0;
    const hits: RuleHit[] = [];
    if (e.type === "param.set") {
      const { key, value } = e.payload;
      if (key === "x") s = { ...s, x: num(value) };
      if (key === "h") s = { ...s, h: Math.max(1e-4, num(value)), limitRun: false };
      if (key === "result:fprime") {
        s = { ...s, results: { ...s.results, fprime: String(value) } };
        if (!sameFunction(String(value), setup.fprime)) hits.push({ code: "wrong-derivative", severity: "major", message: "That derivative does not match the slope readings. Differentiate term by term: d/dx xⁿ = n xⁿ⁻¹.", tag: "conceptual", dimension: "measurement" });
      }
    }
    if (e.type === "sim.start") s = { ...s, h: 1e-4, limitRun: true };
    if (e.type === "measure.read") {
      const { key, value } = e.payload.reading;
      const tangent = slopeAt(f, s.x);
      if (key === "slope") {
        if (s.h > 0.05) hits.push({ code: "secant-not-tangent", severity: "minor", message: "With h this large you read the slope of a secant, not the tangent. Shrink h (press Limit) first.", tag: "conceptual", dimension: "technique" });
        else if (Math.abs(value - tangent) <= 0.1) s = { ...s, reads: { ...s.reads, [`slope@${s.x.toFixed(2)}`]: value } };
        else hits.push({ code: "slope-misread", severity: "minor", message: `The tangent's slope here is ${tangent.toFixed(2)}.`, tag: "procedural", dimension: "measurement" });
      }
      if (key === "flat-x") {
        if (Math.abs(slopeAt(f, value)) < 0.1 && Math.abs(value - s.x) < 0.05) s = { ...s, reads: { ...s.reads, flat: value } };
        else hits.push({ code: "not-flat", severity: "minor", message: "At that x the tangent is not horizontal. Move the point until the slope reads 0.", tag: "conceptual", dimension: "measurement" });
      }
    }
    return { state: s, hits };
  },
  steps: {
    "slope-at-2": (s) => s.reads["slope@2.00"] !== undefined,
    limit: (s) => s.limitRun,
    flat: (s) => s.reads.flat !== undefined,
    derivative: (s, ctx) => typeof s.results.fprime === "string" && sameFunction(s.results.fprime, (ctx.content.setup as unknown as TangentSetup).fprime),
  },
  readouts: (s) => ({ x: s.x, h: s.h }),
};

/* ================================================================== Riemann sums */

export type RiemannSetup = { f: string; a: number; b: number };
export type RiemannState = { method: RiemannMethod; n: number; reads: { method: RiemannMethod; n: number; sum: number }[]; results: Record<string, number> };

export const riemannSums: SimModel<RiemannState> = {
  slug: "riemann-sums",
  init: () => ({ method: "left", n: 2, reads: [], results: {} }),
  apply: (s0, e, ctx) => {
    const setup = ctx.content.setup as unknown as RiemannSetup;
    const f = fn1(setup.f);
    let s = s0;
    const hits: RuleHit[] = [];
    if (e.type === "param.set") {
      const { key, value } = e.payload;
      if (key === "method" && ["left", "right", "midpoint", "trapezoid"].includes(String(value))) s = { ...s, method: value as RiemannMethod };
      if (key === "n") s = { ...s, n: Math.max(1, Math.min(1024, Math.round(num(value)))) };
      if (key === "result:area") {
        s = { ...s, results: { ...s.results, area: num(value) } };
        if (Math.abs(num(value) - integrate(f, setup.a, setup.b)) > 0.005) hits.push({ code: "wrong-area", severity: "major", message: "The exact area is the value the sums close in on as n grows.", tag: "conceptual", dimension: "measurement" });
      }
    }
    if (e.type === "measure.read" && e.payload.reading.key === "sum") {
      const truth = riemann(f, setup.a, setup.b, s.n, s.method).sum;
      if (Math.abs(e.payload.reading.value - truth) > 0.001 + Math.abs(truth) * 1e-4) hits.push({ code: "sum-misread", severity: "minor", message: `The sum for these rectangles is ${truth.toFixed(4)}.`, tag: "procedural", dimension: "measurement" });
      else s = { ...s, reads: [...s.reads, { method: s.method, n: s.n, sum: e.payload.reading.value }] };
    }
    return { state: s, hits };
  },
  steps: {
    "left-4": (s) => s.reads.some((r) => r.method === "left" && r.n === 4),
    "right-4": (s) => s.reads.some((r) => r.method === "right" && r.n === 4),
    converge: (s, ctx) => {
      const setup = ctx.content.setup as unknown as RiemannSetup;
      const exact = integrate(fn1(setup.f), setup.a, setup.b);
      return s.reads.some((r) => Math.abs(r.sum - exact) < 0.01);
    },
    area: (s, ctx) => {
      const setup = ctx.content.setup as unknown as RiemannSetup;
      return s.results.area !== undefined && Math.abs(s.results.area - integrate(fn1(setup.f), setup.a, setup.b)) <= 0.005;
    },
  },
  readouts: (s) => ({ method: s.method, n: s.n }),
};

/* ================================================================== coins and dice */

export type ProbSetup = { seed: number };
export type Run = { kind: Trial; n: number; counts: Record<number, number> };
export type ProbState = { kind: Trial; trials: number; runs: Run[]; reads: Record<string, number>; results: Record<string, number> };

export const coinsDice: SimModel<ProbState> = {
  slug: "dice-probability",
  init: () => ({ kind: "coin", trials: 10, runs: [], reads: {}, results: {} }),
  apply: (s0, e, ctx) => {
    const setup = ctx.content.setup as unknown as ProbSetup;
    let s = s0;
    const hits: RuleHit[] = [];
    const notes: SimNote[] = [];
    if (e.type === "param.set") {
      const { key, value } = e.payload;
      if (key === "kind" && ["coin", "die", "two-dice", "spinner"].includes(String(value))) s = { ...s, kind: value as Trial };
      if (key === "trials") s = { ...s, trials: Math.max(1, Math.min(10_000, Math.round(num(value)))) };
      if (key === "result:mode") {
        s = { ...s, results: { ...s.results, mode: num(value) } };
        if (num(value) !== 7) hits.push({ code: "wrong-mode", severity: "minor", message: "Count the ways: 7 can be made 6 ways (1+6, 2+5 ...), more than any other total.", tag: "conceptual", dimension: "measurement" });
      }
    }
    if (e.type === "sim.start") {
      // Outcomes come from the seeded generator; the animation only shows them.
      const r = runTrials(s.kind, s.trials, setup.seed + s.runs.length * 7919);
      const counts: Record<number, number> = {};
      r.counts.forEach((v, k) => (counts[k] = v));
      s = { ...s, runs: [...s.runs, { kind: s.kind, n: s.trials, counts }] };
      if (s.kind === "coin") notes.push({ text: `${counts[1] ?? 0} heads out of ${s.trials} (${(((counts[1] ?? 0) / s.trials) * 100).toFixed(1)} %)`, tone: "info" });
    }
    if (e.type === "measure.read" && e.payload.reading.key === "heads-freq") {
      const last = [...s.runs].reverse().find((r) => r.kind === "coin");
      const truth = last ? (last.counts[1] ?? 0) / last.n : NaN;
      if (!last || Math.abs(e.payload.reading.value - truth) > 0.005) hits.push({ code: "freq-misread", severity: "minor", message: `Relative frequency = number of heads ÷ number of flips = ${Number.isFinite(truth) ? truth.toFixed(3) : "?"}.`, tag: "conceptual", dimension: "measurement" });
      else s = { ...s, reads: { ...s.reads, [`heads@${last.n}`]: e.payload.reading.value } };
    }
    return { state: s, hits, notes };
  },
  steps: {
    "ten-flips": (s) => s.runs.some((r) => r.kind === "coin" && r.n <= 20),
    thousand: (s) => Object.keys(s.reads).some((k) => k.startsWith("heads@") && Number(k.slice(6)) >= 1000),
    "dice-sum": (s) => s.runs.some((r) => r.kind === "two-dice" && r.n >= 1000),
    mode: (s) => s.results.mode === 7,
  },
  readouts: (s) => ({ runs: s.runs.length }),
};

