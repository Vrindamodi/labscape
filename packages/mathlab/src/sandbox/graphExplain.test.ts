import { describe as suite, expect, it } from "vitest";
import { compile, parse, typoHints } from "../core/expr";
import { describe, paramEffect, polyDegree } from "./graphExplain";

suite("typo guard", () => {
    it("catches m*x + chh and suggests the letter already in use", () => {
      const [h, ...rest] = typoHints("m*x + chh", ["a", "b", "c"]);
      expect(rest).toEqual([]);
      expect(h!.word).toBe("chh");
      expect(h!.parts).toEqual(["c", "h", "h"]);
      expect(h!.suggestion).toBe("c");
      expect(h!.fixed).toBe("m*x + c");
      expect(h!.explicit).toBe("m*x + c*h*h");
      // writing it out silences the hint
      expect(typoHints(h!.explicit)).toEqual([]);
    });

    it("suggests a function for a misspelt one", () => {
      expect(typoHints("sqr(x)")[0]!.suggestion).toBe("sqrt");
      expect(typoHints("sni(x)")[0]!.fixed).toBe("sin(x)");
    });

    it("leaves ordinary notation alone", () => {
      for (const ok of ["m*x + c", "mx + c", "2x^2 - 3x + 1", "sin(x)", "xsin x", "sinx", "2pi x", "theta", "1e5 x", "kx", "a*x^2 + b*x + c", "exp(-x)"]) expect(typoHints(ok)).toEqual([]);
    });
});


const fn = (src: string, scope: Record<string, number> = {}) => {
  const node = parse(src);
  const f = compile(node);
  return { node, f: (x: number) => f({ ...scope, x }) };
};

suite("graph explanations", () => {
  it("reads a straight line in words", () => {
    const { node, f } = fn("m*x + c", { m: 2, c: -1 });
    const d = describe(f, node);
    expect(d.kind).toBe("line");
    expect(d.text[0]).toMatch(/gradient \(slope\) 2: for every 1 step to the right it goes up 2/);
    expect(d.text[1]).toMatch(/y = −1/);
  });

  it("finds a parabola's vertex and roots", () => {
    const { node, f } = fn("x^2 - 4x + 3");
    expect(polyDegree(f)).toBe(2);
    const d = describe(f, node);
    expect(d.kind).toBe("parabola");
    expect(d.text[0]).toMatch(/opens upward/);
    expect(d.text[1]).toMatch(/\(2, −1\)/);
    expect(d.text[2]).toMatch(/x = 1 and x = 3/);
  });

  it("says what a slider does", () => {
    const scope = { a: 1, b: 0, c: -2 };
    const { node } = fn("a*x^2 + b*x + c", scope);
    const at = (p: string) => (v: number) => (x: number) => compile(node)({ ...scope, [p]: v, x });
    expect(paramEffect("b", 0, at("b"), node)).toBe("Increasing b moves the vertex left and down.");
    expect(paramEffect("c", -2, at("c"), node)).toBe("Increasing c moves the vertex up.");
    expect(paramEffect("a", 1, at("a"), node)).toMatch(/narrower/);
    const line = fn("m*x + c", { m: 1, c: 0 });
    const lat = (p: string) => (v: number) => (x: number) => compile(line.node)({ m: 1, c: 0, [p]: v, x });
    expect(paramEffect("m", 1, lat("m"), line.node)).toBe("Increasing m makes the line steeper.");
    expect(paramEffect("c", 0, lat("c"), line.node)).toBe("Increasing c moves where it crosses the y-axis up.");
  });
});
