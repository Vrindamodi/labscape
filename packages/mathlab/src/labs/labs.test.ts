import type { LabEvent } from "@labscape/contracts";
import { runSim, simGoldenEvents } from "@labscape/physics/protocol";
import { describe, expect, it } from "vitest";
import { applyOp, sameFunction } from "./maths";
import { sameGraph } from "./transformations";
import { MATHS_CONTENT, MATHS_MODELS } from "./index";

const run = (slug: string, events: LabEvent[]) => runSim(MATHS_CONTENT[slug]!, MATHS_MODELS[slug]!, events);
const golden = (slug: string) => simGoldenEvents(MATHS_CONTENT[slug]!, "t", "user");
const codes = (slug: string, events: LabEvent[]) => run(slug, events).report.deviations.map((d) => d.code);
const swap = (slug: string, match: (e: LabEvent) => boolean, payload: Record<string, unknown>) => golden(slug).map((e) => (match(e) ? ({ ...e, payload } as LabEvent) : e));
const readKey = (e: LabEvent) => (e.type === "measure.read" ? e.payload.reading.key : null);

describe("maths golden runs", () => {
  for (const slug of Object.keys(MATHS_CONTENT))
    it(`${slug} scores 3 stars with no deviations`, () => {
      const r = run(slug, golden(slug)).report;
      expect(r.deviations).toEqual([]);
      expect(r.stars).toBe(3);
    });
});

describe("maths mistakes are caught", () => {
  it("balance: changing one side tips the scale", () => {
    expect(codes("balance-equations", swap("balance-equations", (e) => e.type === "param.set" && e.payload.value === "both:-4", { key: "op", value: "left:-4" }))).toContain("one-side");
  });
  it("quadratic: a wrong root", () => {
    expect(codes("quadratic-explorer", swap("quadratic-explorer", (e) => e.type === "param.set" && e.payload.key === "result:root1", { key: "result:root1", value: 1 }))).toContain("wrong-root");
  });
  it("unit circle: right size, wrong sign", () => {
    expect(codes("unit-circle-trig", swap("unit-circle-trig", (e) => readKey(e) === "cos", { instrument: "circle", reading: { key: "cos", value: 0.5, unit: "" } }))).toContain("sign");
  });
  it("tangent: reading a secant as the tangent", () => {
    const es = golden("derivative-as-slope").filter((e) => e.type !== "sim.start");
    expect(codes("derivative-as-slope", es)).toContain("secant-not-tangent");
  });
  it("derivative answers are checked by value, not by spelling", () => {
    expect(sameFunction("3x^2 - 3", "3(x^2 - 1)")).toBe(true);
    expect(sameFunction("3x^2", "3x^2 - 3")).toBe(false);
    expect(sameFunction("3x^2 +", "3x^2")).toBe(false);
  });
  it("Riemann: a misread sum", () => {
    const es = swap("riemann-sums", (e) => e.type === "measure.read" && e.payload.reading.value === 1.75, { instrument: "sums", reading: { key: "sum", value: 2, unit: "" } });
    expect(codes("riemann-sums", es)).toContain("sum-misread");
  });
  it("dice: the wrong most likely total", () => {
    expect(codes("dice-probability", swap("dice-probability", (e) => e.type === "param.set" && e.payload.key === "result:mode", { key: "result:mode", value: 12 }))).toContain("wrong-mode");
  });
  it("transformations: shifting the wrong way inside the bracket", () => {
    const es = swap("graph-transformations", (e) => e.type === "param.set" && e.payload.key === "c" && e.payload.value === 2, { key: "c", value: -2 });
    const r = run("graph-transformations", es).report;
    expect(r.deviations.map((d) => d.code)).toContain("no-match");
    expect(r.deviations[0]!.message).toMatch(/backwards/);
    expect(r.completed).toBe(false);
  });
  it("transformations: equivalent parameters draw the same graph", () => {
    expect(sameGraph({ f: "x^2", a: -0.25, b: 2, c: -1, d: 4 }, { f: "x^2", a: -1, b: 1, c: -1, d: 4 })).toBe(true);
    expect(sameGraph({ f: "abs", a: 1, b: -1, c: 0, d: 0 }, { f: "abs", a: -1, b: 1, c: 0, d: 0 })).toBe(false);
  });
  it("balance operations", () => {
    expect(applyOp({ x: 3, k: 4 }, "-4")).toEqual({ x: 3, k: 0 });
    expect(applyOp({ x: 3, k: 15 }, "/3")).toEqual({ x: 1, k: 5 });
    expect(applyOp({ x: 1, k: 0 }, "/0")).toBeNull();
  });
});
