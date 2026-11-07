import { describe, expect, it } from "vitest";
import { compile, derivative, fn1, parse, ParseError, simplify, solveFor, toLatex, toText } from "./expr";
import { integrate, niceStep, quadratic, riemann, runTrials, sample, slopeAt, theory } from "./numeric";

describe("expression parser", () => {
  const ev = (s: string, x = 2) => fn1(s)(x);
  it("handles school notation and implicit multiplication", () => {
    expect(ev("2x^2 - 3x + 1")).toBe(3);
    expect(ev("3(x+1)")).toBe(9);
    expect(ev("x sin(0)")).toBe(0);
    expect(ev("2pi")).toBeCloseTo(2 * Math.PI);
    expect(ev("x^-1")).toBe(0.5);
    expect(ev("-x^2")).toBe(-4); // power binds tighter than minus
    expect(ev("2^3^2", 0)).toBe(512); // right associative
    expect(ev("sin^2 x + cos^2 x", 0.7)).toBeCloseTo(1);
    expect(ev("(-8)^(1/3)", 0)).toBeCloseTo(-2);
    expect(ev("1.5e2", 0)).toBe(150);
    expect(ev("x²", 3)).toBe(9);
  });
  it("reports where it fails", () => {
    expect(() => parse("2x + (3")).toThrow(ParseError);
    expect(() => parse("2 $ 3")).toThrow(/Unexpected/);
  });
  it("evaluates with several variables", () => {
    expect(compile(parse("a x^2 + b x + c"))({ a: 1, b: -3, c: 2, x: 1 })).toBe(0);
  });
});

describe("symbolic derivative", () => {
  const dAt = (s: string, x: number) => compile(derivative(parse(s)))({ x });
  it("matches numerical slopes", () => {
    for (const s of ["x^3 - 2x", "sin(x) x", "exp(2x)", "ln(x^2 + 1)", "sqrt(x)", "tan(x)", "1/x", "x^x", "atan(3x)", "cos(x)^2"]) {
      for (const x of [0.3, 1.1, 2.4]) expect(dAt(s, x)).toBeCloseTo(slopeAt(fn1(s), x), 5);
    }
  });
  it("simplifies to readable forms", () => {
    expect(toText(derivative(parse("x^3 - 2x")))).toBe("3x^2 - 2");
    expect(toText(derivative(parse("5x")))).toBe("5");
    expect(toText(simplify(parse("x*x")))).toBe("x^2");
    expect(toLatex(parse("(x+1)/(x-1)"))).toBe("\\frac{x + 1}{x - 1}");
  });
});

describe("solver", () => {
  it("solves a formula for any variable", () => {
    expect(solveFor("V - I*R", "R", { V: 12, I: 3 })).toBeCloseTo(4);
    expect(solveFor("V - I*R", "I", { V: 12, R: 4 })).toBeCloseTo(3);
    expect(solveFor("s - (u t + 0.5 a t^2)", "t", { s: 20, u: 0, a: 9.81 }, 1)).toBeCloseTo(Math.sqrt(40 / 9.81));
  });
});

describe("plot sampling", () => {
  /** A false vertical line is a drawn segment joining a huge positive to a huge negative value. */
  const falseVerticals = (lines: { x: number; y: number }[][], span: number) =>
    lines.flatMap((l) => l.slice(1).map((p, i) => [l[i]!, p] as const)).filter(([a, b]) => Math.sign(a.y) !== Math.sign(b.y) && Math.abs(b.y - a.y) > span).length;
  it("draws tan(x) without false vertical lines", () => {
    const lines = sample(Math.tan, -7, 7, 10);
    expect(falseVerticals(lines, 10)).toBe(0);
    expect(lines.length).toBeGreaterThanOrEqual(5); // split at -3pi/2, -pi/2, pi/2, 3pi/2
  });
  it("draws 1/x as two branches", () => {
    const lines = sample((x) => 1 / x, -5, 5, 10);
    expect(falseVerticals(lines, 10)).toBe(0);
    expect(lines.length).toBe(2);
  });
  it("keeps steep but continuous curves in one piece", () => {
    expect(sample((x) => x * x * x, -5, 5, 10).length).toBe(1);
    expect(sample(Math.atan, -5, 5, 4).length).toBe(1);
  });
  it("breaks where the function is undefined", () => {
    const lines = sample((x) => Math.sqrt(4 - x * x), -5, 5, 6);
    expect(lines.length).toBe(1);
    expect(Math.min(...lines[0]!.map((p) => p.x))).toBeGreaterThanOrEqual(-2.0001);
  });
  it("grid steps go 1-2-5", () => {
    expect(niceStep(10)).toBe(1);
    expect(niceStep(17)).toBe(2);
    expect(niceStep(40)).toBe(5);
    expect(niceStep(0.9)).toBeCloseTo(0.1);
  });
});

describe("quadratics", () => {
  it("finds two, one or complex roots", () => {
    expect(quadratic(1, -3, 2).roots).toEqual({ kind: "two", r1: 1, r2: 2 });
    expect(quadratic(1, -4, 4).roots).toEqual({ kind: "one", r: 2 });
    const c = quadratic(1, 2, 5);
    expect(c.roots).toEqual({ kind: "complex", re: -1, im: 2 });
    expect(c.vertex).toEqual({ x: -1, y: 4 });
    expect(quadratic(0, 2, -4).roots).toEqual({ kind: "linear", r: 2 });
  });
});

describe("Riemann sums", () => {
  const f = (x: number) => x * x;
  it("left under-estimates and right over-estimates an increasing function", () => {
    const exact = integrate(f, 0, 2);
    expect(exact).toBeCloseTo(8 / 3, 10);
    expect(riemann(f, 0, 2, 4, "left").sum).toBeCloseTo(1.75);
    expect(riemann(f, 0, 2, 4, "right").sum).toBeCloseTo(3.75);
    expect(riemann(f, 0, 2, 4, "midpoint").sum).toBeCloseTo(2.625);
  });
  it("error shrinks as n doubles", () => {
    const exact = 8 / 3;
    const errs = [4, 8, 16, 32].map((n) => Math.abs(riemann(f, 0, 2, n, "left").sum - exact));
    errs.slice(1).forEach((e, i) => expect(e).toBeLessThan(errs[i]!));
  });
});

describe("probability", () => {
  it("10,000 coin flips in under a second, same seed same results", () => {
    const t0 = performance.now();
    const a = runTrials("coin", 10_000, 7);
    expect(performance.now() - t0).toBeLessThan(1000);
    const b = runTrials("coin", 10_000, 7);
    expect(Array.from(a.outcomes)).toEqual(Array.from(b.outcomes));
    expect(Math.abs(a.counts.get(1)! / 10_000 - 0.5)).toBeLessThan(0.02);
  });
  it("two dice: 7 is the most likely sum, matching theory", () => {
    const r = runTrials("two-dice", 36_000, 3);
    const best = [...r.counts.entries()].sort((x, y) => y[1] - x[1])[0]![0];
    expect(best).toBe(7);
    expect([...theory("two-dice").values()].reduce((s, p) => s + p, 0)).toBeCloseTo(1);
  });
});
