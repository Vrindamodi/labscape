import { describe, expect, it } from "vitest";
import { compile, derivative, parse, variables } from "../core/expr";
import { GRAPH_IDEAS, rootsIn } from "./GraphSandbox";

describe("graphing sandbox root finder", () => {
  it("finds both roots of x^2 - 2", () => {
    const r = rootsIn((x) => x * x - 2, -5, 5);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(-Math.SQRT2, 6);
    expect(r[1]).toBeCloseTo(Math.SQRT2, 6);
  });

  it("snaps a root at the origin to exactly 0", () => {
    expect(rootsIn((x) => x * (x - 3), -1, 5)).toEqual([0, expect.closeTo(3, 6)]);
  });

  it("does not report the poles of tan x as roots", () => {
    const r = rootsIn(Math.tan, -4, 4);
    expect(r.map((x) => Math.round(x * 1000) / 1000)).toEqual([-3.142, 0, 3.142]);
  });

  it("returns nothing for a curve that never crosses", () => {
    expect(rootsIn((x) => x * x + 1, -10, 10)).toEqual([]);
  });
});

describe("graphing sandbox ideas", () => {
  it("every idea parses, has a value for each of its sliders and draws something on its own view", () => {
    expect(new Set(GRAPH_IDEAS.map((g) => g.id)).size).toBe(GRAPH_IDEAS.length);
    for (const g of GRAPH_IDEAS) {
      const view = g.build.view!;
      for (const fn of g.build.fns) {
        const node = parse(fn.src);
        const letters = [...variables(node)].filter((v) => !["x", "pi", "e", "tau", "theta"].includes(v));
        for (const v of letters) expect(g.build.params[v], `${g.id}: slider ${v}`).toBeTypeOf("number");
        const f = compile(node);
        let onScreen = 0;
        for (let i = 0; i <= 200; i++) {
          const x = view.x0 + ((view.x1 - view.x0) * i) / 200;
          const y = f({ ...g.build.params, x });
          if (Number.isFinite(y) && y >= view.y0 && y <= view.y1) onScreen++;
        }
        expect(onScreen, `${g.id}: ${fn.src}`).toBeGreaterThan(20);
      }
    }
  });

  it("the slope curve of a parabola is the straight line 2ax + b", () => {
    const slope = compile(derivative(parse("a*x^2 + b*x + c")));
    for (const x of [-3, 0, 1.5]) expect(slope({ a: 2, b: -1, c: 7, x })).toBeCloseTo(4 * x - 1, 9);
  });
});
