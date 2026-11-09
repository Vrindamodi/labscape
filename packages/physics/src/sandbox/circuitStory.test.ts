import { describe, expect, it } from "vitest";
import { solve } from "../core/circuit";
import { historyInit, historyPush, historyRedo, historyUndo } from "../ui/history";
import { bypassWire, CIRCUIT_EXAMPLES, settle, toComponents, wireFlows, type CircuitBuild } from "./CircuitSandbox";
import { explainCircuit, storyOf } from "./circuitStory";

describe("fuse in series (inspector bug)", () => {
  const withFuse = () => {
    const b = structuredClone(CIRCUIT_EXAMPLES.loop!.build);
    b.parts.push({ id: "F1", kind: "fuse", x: 360, y: 160, value: 1 });
    b.wires = b.wires.filter(([a]) => a !== "L1.b").concat([["L1.b", "F1.a"], ["F1.b", "S1.a"]]);
    return b;
  };

  it("a fuse in series carries exactly the ammeter's current", () => {
    const b = withFuse();
    const r = solve(toComponents(b.parts), b.wires);
    const ia = Math.abs(r.components.A1!.current);
    expect(ia).toBeGreaterThan(0.48);
    expect(Math.abs(r.components.F1!.current)).toBeCloseTo(ia, 9);
    expect(Math.abs(r.components.F1!.voltage)).toBeGreaterThan(0.01);
    expect(Math.abs(r.components.F1!.power)).toBeGreaterThan(0.005);
    expect(r.bypassed).toEqual([]);
  });

  it("a fuse whose ends are joined by a leftover wire is reported as bypassed, and removing that wire puts it back in series", () => {
    const b = withFuse();
    b.wires.push(["L1.b", "S1.a"]); // the original wire was never removed
    const r = solve(toComponents(b.parts), b.wires);
    expect(r.components.F1!.current).toBe(0);
    expect(r.bypassed).toEqual(["F1"]);
    const i = bypassWire(b, "F1");
    expect(b.wires[i]).toEqual(["L1.b", "S1.a"]);
    const fixed = { ...b, wires: b.wires.filter((_, j) => j !== i) };
    const r2 = solve(toComponents(fixed.parts), fixed.wires);
    expect(Math.abs(r2.components.F1!.current)).toBeCloseTo(Math.abs(r2.components.A1!.current), 9);
    expect(explainCircuit({ build: b, result: r }).lines.some((l) => l.text.includes("F1 carries no current"))).toBe(true);
  });
});

describe("circuit explanations", () => {
  const solved = (b: CircuitBuild) => settle(b);

  it("works Ohm's law with the real numbers and traces the current from + to -", () => {
    const e = explainCircuit(solved(CIRCUIT_EXAMPLES.loop!.build));
    expect(e.headline.tone).toBe("good");
    expect(e.lines.some((l) => /I = 6 ÷ 12\.2 = 0\.49 A/.test(l.text))).toBe(true);
    expect(e.lines.some((l) => l.text.includes("B1 (+) → A1 → L1 → S1 → back to B1 (−)"))).toBe(true);
  });

  it("names series and parallel", () => {
    expect(explainCircuit(solved(CIRCUIT_EXAMPLES.series!.build)).lines.some((l) => l.text.startsWith("Series:"))).toBe(true);
    expect(explainCircuit(solved(CIRCUIT_EXAMPLES.parallel!.build)).lines.some((l) => l.text.startsWith("Parallel:"))).toBe(true);
  });

  it("says where an open circuit is broken", () => {
    const b = structuredClone(CIRCUIT_EXAMPLES.loop!.build);
    b.parts = b.parts.map((p) => (p.kind === "switch" ? { ...p, closed: false } : p));
    const e = explainCircuit(solved(b));
    expect(e.headline.text).toMatch(/Broken/);
    expect(e.lines[0]!.text).toMatch(/Switch S1 is open/);
  });

  it("closing the switch on the fuse example melts the fuse and says why, with the numbers", () => {
    const before = solved(CIRCUIT_EXAMPLES.fuse!.build);
    const next = settle({ ...before.build, parts: before.build.parts.map((p) => (p.id === "S1" ? { ...p, closed: true } : p)) });
    expect(next.build.parts.find((p) => p.id === "F1")!.blown).toBe(true);
    const s = storyOf(before, next, { kind: "switch", id: "S1", closed: true })!;
    expect(s.title).toBe("Fuse F1 melted!");
    expect(s.body).toMatch(/^1\.4 A tried to flow, but F1 is rated 1 A/);
  });

  it("explains closing a switch and an LED turned the wrong way", () => {
    const open = structuredClone(CIRCUIT_EXAMPLES.loop!.build);
    open.parts = open.parts.map((p) => (p.kind === "switch" ? { ...p, closed: false } : p));
    const s = storyOf(solved(open), solved(CIRCUIT_EXAMPLES.loop!.build), { kind: "switch", id: "S1", closed: true })!;
    expect(s.title).toBe("S1 closed");
    expect(s.body).toMatch(/L1 lights up/);

    const led = solved(CIRCUIT_EXAMPLES.led!.build);
    expect(led.result.components.D1!.on).toBe(true);
    // Swap the legs: the wire from the resistor now meets the - leg.
    const back = settle({ ...led.build, wires: led.build.wires.map(([a, b]) => [a.replace(/^D1\.a$/, "D1.x").replace(/^D1\.b$/, "D1.a").replace(/^D1\.x$/, "D1.b"), b.replace(/^D1\.a$/, "D1.x").replace(/^D1\.b$/, "D1.a").replace(/^D1\.x$/, "D1.b")]) });
    expect(back.result.components.D1!.on).toBe(false);
    expect(storyOf(led, back, { kind: "rotate", id: "D1" })!.title).toBe("D1 is the wrong way round");
  });

  it("wire currents follow Kirchhoff: every wire in a series loop carries the loop current, out of + first", () => {
    const { build, result } = solved(CIRCUIT_EXAMPLES.loop!.build);
    const f = wireFlows(build.parts, build.wires, result);
    const I = Math.abs(result.components.A1!.current);
    f.forEach((x) => expect(Math.abs(x)).toBeCloseTo(I, 6));
    expect(f[0]).toBeGreaterThan(0); // B1.a -> A1.b: out of the + terminal
  });

  it("parallel branch wires carry their own branch current", () => {
    const { build, result } = solved(CIRCUIT_EXAMPLES.parallel!.build);
    const f = wireFlows(build.parts, build.wires, result).map(Math.abs);
    const total = Math.abs(result.components.B1!.current);
    expect(f[0]).toBeCloseTo(total, 6); // battery to the first junction
    expect(f[1]).toBeCloseTo(total / 2, 6); // across to the second bulb
  });
});

describe("undo history", () => {
  it("undoes and redoes, and folds a gesture into one step", () => {
    let h = historyInit(0);
    h = historyPush(h, 1, { now: 0 });
    h = historyPush(h, 2, { group: "drag", now: 100 });
    h = historyPush(h, 3, { group: "drag", now: 200 });
    h = historyPush(h, 4, { group: "drag", now: 300 });
    expect(h.past).toEqual([0, 1]);
    h = historyUndo(h);
    expect(h.present).toBe(1);
    h = historyUndo(h);
    expect(h.present).toBe(0);
    expect(historyUndo(h)).toBe(h);
    h = historyRedo(h);
    expect(h.present).toBe(1);
    h = historyPush(h, 9, { now: 400 });
    expect(h.future).toEqual([]);
    expect(historyPush(h, 10, { merge: true }).past).toEqual(h.past);
  });
});
