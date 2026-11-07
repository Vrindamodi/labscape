import { describe, expect, it } from "vitest";
import { solve } from "../core/circuit";
import { CIRCUIT_EXAMPLES, terminalsOf, toComponents } from "./CircuitSandbox";

const run = (key: string) => {
  const b = CIRCUIT_EXAMPLES[key]!.build;
  return solve(toComponents(b.parts), b.wires);
};

describe("circuit sandbox examples", () => {
  it("Ohm's law set-up: meters read V = IR with the battery's internal resistance", () => {
    const r = run("ohm");
    const I = Math.abs(r.components.A1!.current);
    const V = Math.abs(r.components.V1!.voltage);
    expect(I).toBeCloseTo(3 / (10 + 0.2 + 0.01), 3);
    expect(V / I).toBeCloseTo(10, 1);
    expect(r.ammeterAcross).toEqual([]);
    expect(r.voltmeterInSeries).toEqual([]);
  });

  it("parallel bulbs each get more power than series bulbs", () => {
    const s = run("series"), p = run("parallel");
    expect(Math.abs(p.components.L1!.power)).toBeGreaterThan(3 * Math.abs(s.components.L1!.power));
  });

  it("an open switch stops the current; closing it lights the loop", () => {
    const b = structuredClone(CIRCUIT_EXAMPLES.loop!.build);
    b.parts = b.parts.map((p) => (p.kind === "switch" ? { ...p, closed: false } : p));
    expect(solve(toComponents(b.parts), b.wires).open).toBe(true);
    expect(Math.abs(run("loop").components.L1!.current)).toBeCloseTo(6 / (12 + 0.2 + 0.01 + 0.001), 2);
  });

  it("wiring the battery across itself is a short", () => {
    const r = solve(toComponents([{ id: "B1", kind: "battery", x: 0, y: 0, value: 6 }]), [["B1.a", "B1.b"]]);
    expect(r.shorted).toContain("B1");
  });

  it("a fuse below the loop current blows", () => {
    const b = structuredClone(CIRCUIT_EXAMPLES.loop!.build);
    b.parts.push({ id: "F1", kind: "fuse", x: 0, y: 0, value: 0.1 });
    b.wires = b.wires.filter(([a]) => a !== "S1.b").concat([["S1.b", "F1.a"], ["F1.b", "B1.b"]]);
    expect(solve(toComponents(b.parts), b.wires).blownFuses).toContain("F1");
  });

  it("rotating a part keeps its terminals HALF either side", () => {
    const h = terminalsOf({ id: "R1", kind: "resistor", x: 100, y: 100 });
    const v = terminalsOf({ id: "R1", kind: "resistor", x: 100, y: 100, vertical: true });
    expect(h["R1.a"]).toEqual({ x: 140, y: 100 });
    expect(v["R1.a"]).toEqual({ x: 100, y: 140 });
  });
});
