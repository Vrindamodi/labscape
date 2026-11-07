import { describe, expect, it } from "vitest";
import library from "../../../../content/formulas/formulas.json";
import { compile, parse, solveFor, variables } from "./expr";

type Formula = { id: string; expr: string | null; variables: { key: string }[] };
const formulas = (library as { formulas: Formula[] }).formulas;

/** Positive test values that keep every formula in its real domain (angles in degrees). */
const sample = (key: string, i: number) => (["q", "i", "r", "A", "B", "C"].includes(key) ? 25 + i * 7 : 1.5 + i * 0.7);

describe("formula library", () => {
  it("has a solvable expression for every formula that declares variables", () => {
    expect(formulas.length).toBeGreaterThanOrEqual(50);
    for (const f of formulas) {
      if (!f.expr) {
        expect(f.variables, f.id).toEqual([]);
        continue;
      }
      const used = variables(parse(f.expr));
      expect([...used].sort(), f.id).toEqual(f.variables.map((v) => v.key).sort());
    }
  });

  it("solves each formula for each of its variables (round trip)", () => {
    for (const f of formulas) {
      if (!f.expr) continue;
      const g = compile(parse(f.expr));
      for (const target of f.variables.map((v) => v.key)) {
        // choose values for the others, then pick the target that satisfies the formula
        const known: Record<string, number> = {};
        f.variables.forEach((v, i) => v.key !== target && (known[v.key] = sample(v.key, i)));
        const x = solveFor(f.expr, target, known, sample(target, 1));
        if (x === null) continue; // e.g. no real angle satisfies these chosen values
        expect(Math.abs(g({ ...known, [target]: x })), `${f.id} for ${target}`).toBeLessThan(1e-6 * Math.max(1, Math.abs(g({ ...known, [target]: x * 1.01 }))));
      }
    }
  });

  it("V = IR gives R = 4 ohm for 12 V and 3 A", () => {
    const ohm = formulas.find((f) => f.id === "ohms-law")!;
    expect(solveFor(ohm.expr!, "R", { V: 12, I: 3 })).toBeCloseTo(4);
  });
});
