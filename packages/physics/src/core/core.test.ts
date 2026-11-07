import { describe, expect, it } from "vitest";
import { colourBands, heatStep, hotResistance, METER, solve, type Component, type Wire } from "./circuit";
import { buoyancy, idealFlight, pendulumPeriod, simulateFlight, SINKERS, smallAnglePeriod } from "./mechanics";
import { cauchy, criticalAngleDeg, lensImage, slab, slabGeometry, snellDeg, trace } from "./optics";
import { rng } from "./runtime";

const close = (actual: number, expected: number, rel = 1e-3) => {
  if (expected === 0) expect(Math.abs(actual)).toBeLessThan(1e-6);
  else expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(rel);
};
const I = (r: ReturnType<typeof solve>, id: string) => r.components[id]!.current;
const V = (r: ReturnType<typeof solve>, id: string) => r.components[id]!.voltage;
const bat = (id: string, value: number, internal?: number): Component => ({ id, kind: "battery", value, ...(internal ? { internal } : {}) });
const res = (id: string, value: number): Component => ({ id, kind: "resistor", value });
/** A series loop from the source: source + (a) -> first.a, first.b -> next.a ... last.b -> source - (b). */
const loop = (src: string, ...ids: string[]): Wire[] => {
  const w: Wire[] = [[`${src}.a`, `${ids[0]}.a`]];
  for (let i = 0; i < ids.length - 1; i++) w.push([`${ids[i]}.b`, `${ids[i + 1]}.a`]);
  w.push([`${ids[ids.length - 1]}.b`, `${src}.b`]);
  return w;
};
const par = (x: string, y: string): Wire[] => [[`${x}.a`, `${y}.a`], [`${x}.b`, `${y}.b`]];

describe("circuit solver: 20 reference circuits within 0.1 %", () => {
  it("1. single resistor", () => close(I(solve([bat("B", 12), res("R", 6)], loop("B", "R")), "R"), 2));
  it("2. two in series", () => {
    const r = solve([bat("B", 6), res("R1", 2), res("R2", 4)], loop("B", "R1", "R2"));
    close(I(r, "R1"), 1);
    close(V(r, "R2"), 4);
  });
  it("3. two in parallel", () => {
    const r = solve([bat("B", 6), res("R1", 6), res("R2", 3)], [...par("R1", "R2"), ["B.a", "R1.a"], ["B.b", "R1.b"]]);
    close(I(r, "B"), 3);
    close(I(r, "R2"), 2);
  });
  it("4. voltage divider", () => close(V(solve([bat("B", 9), res("R1", 1000), res("R2", 2000)], loop("B", "R1", "R2")), "R2"), 6));
  it("5. series-parallel", () => {
    const r = solve([bat("B", 8), res("R1", 2), res("R2", 6), res("R3", 3)], [["B.a", "R1.a"], ["R1.b", "R2.a"], ...par("R2", "R3"), ["R2.b", "B.b"]]);
    close(I(r, "B"), 2);
    close(V(r, "R3"), 4);
  });
  it("6. internal resistance", () => {
    const r = solve([bat("B", 1.5, 0.5), res("R", 2.5)], loop("B", "R"));
    close(I(r, "R"), 0.5);
    close(V(r, "B"), 1.25);
  });
  it("7. cells in series", () => close(I(solve([bat("B1", 1.5), bat("B2", 1.5), res("R", 3)], [["B1.a", "B2.b"], ["B2.a", "R.a"], ["R.b", "B1.b"]]), "R"), 1));
  it("8. opposing cells", () => {
    const r = solve([bat("B1", 9), bat("B2", 3), res("R", 6)], [["B1.a", "R.a"], ["R.b", "B2.a"], ["B2.b", "B1.b"]]);
    close(I(r, "R"), 1);
  });
  it("9. balanced Wheatstone bridge", () => {
    const parts = [bat("B", 10), res("R1", 100), res("R2", 100), res("R3", 100), res("R4", 100), res("G", 50)];
    const r = solve(parts, [["B.a", "R1.a"], ["B.a", "R3.a"], ["R1.b", "R2.a"], ["R3.b", "R4.a"], ["R2.b", "B.b"], ["R4.b", "B.b"], ["G.a", "R1.b"], ["G.b", "R3.b"]]);
    close(I(r, "G"), 0);
  });
  it("10. unbalanced Wheatstone bridge", () => {
    const parts = [bat("B", 10), res("R1", 100), res("R2", 200), res("R3", 100), res("R4", 100), res("R5", 100)];
    const r = solve(parts, [["B.a", "R1.a"], ["B.a", "R3.a"], ["R1.b", "R2.a"], ["R3.b", "R4.a"], ["R2.b", "B.b"], ["R4.b", "B.b"], ["R5.a", "R1.b"], ["R5.b", "R3.b"]]);
    close(I(r, "R5"), (80 / 13 - 70 / 13) / 100); // node voltages A = 80/13 V, B = 70/13 V
  });
  it("11. ammeter in series reads the current (with its 0.01 ohm)", () => {
    const r = solve([bat("B", 6), { id: "A", kind: "ammeter" }, res("R", 10)], loop("B", "A", "R"));
    close(I(r, "A"), 6 / (10 + METER.ammeterOhm));
  });
  it("12. voltmeter across a resistor barely loads it", () => {
    const r = solve([bat("B", 6), res("R1", 1), res("R2", 10), { id: "V", kind: "voltmeter" }], [...loop("B", "R1", "R2"), ...par("R2", "V")]);
    const rp = (10 * 10e6) / (10 + 10e6);
    close(V(r, "V"), (6 * rp) / (1 + rp));
  });
  it("13. voltmeter in series starves the circuit and is flagged", () => {
    const r = solve([bat("B", 6), { id: "V", kind: "voltmeter" }, { id: "L", kind: "bulb", value: 10 }], loop("B", "V", "L"));
    expect(I(r, "L")).toBeLessThan(1e-6);
    close(V(r, "V"), 6, 1e-5);
    expect(r.voltmeterInSeries).toEqual(["V"]);
  });
  it("14. ammeter across a resistor is a near short and is flagged", () => {
    const r = solve([bat("B", 6, 0.5), res("R", 10), { id: "A", kind: "ammeter" }], [...loop("B", "R"), ...par("R", "A")]);
    expect(r.ammeterAcross).toEqual(["A"]);
    expect(r.shorted).toEqual(["B"]);
    close(I(r, "A"), 6 / (0.5 + 1 / (1 / 10 + 1 / METER.ammeterOhm)) * (10 / (10 + METER.ammeterOhm)));
  });
  it("15. LED with series resistor", () => {
    const r = solve([bat("B", 5), res("R", 220), { id: "D", kind: "led" }], loop("B", "R", "D"));
    close(I(r, "D"), 3 / 230);
    expect(r.components.D!.on).toBe(true);
  });
  it("16. reversed LED does not conduct", () => {
    const r = solve([bat("B", 5), res("R", 220), { id: "D", kind: "led" }], [["B.a", "R.a"], ["R.b", "D.b"], ["D.a", "B.b"]]);
    expect(Math.abs(I(r, "R"))).toBeLessThan(1e-6);
    expect(r.components.D!.on).toBe(false);
  });
  it("17. open switch: no current, circuit open", () => {
    const r = solve([bat("B", 6), { id: "S", kind: "switch", closed: false }, res("R", 10)], loop("B", "S", "R"));
    expect(Math.abs(I(r, "R"))).toBeLessThan(1e-9);
    expect(r.open).toBe(true);
  });
  it("18. closed switch", () => close(I(solve([bat("B", 6), { id: "S", kind: "switch", closed: true }, res("R", 10)], loop("B", "S", "R")), "R"), 0.6, 2e-4));
  it("19. rheostat at a quarter", () => close(I(solve([bat("B", 10), { id: "Rh", kind: "rheostat", value: 100, setting: 0.25 }, res("R", 25)], loop("B", "Rh", "R")), "R"), 0.2));
  it("20. fuse blows on overcurrent", () => {
    const r = solve([bat("B", 6), { id: "F", kind: "fuse", value: 1 }, res("R", 2)], loop("B", "F", "R"));
    expect(r.blownFuses).toEqual(["F"]);
    expect(Math.abs(I(r, "R"))).toBeLessThan(1e-9);
  });
  it("21. wire straight across a cell is a short", () => {
    const r = solve([bat("B", 1.5, 0.1), { id: "W", kind: "wire" }], loop("B", "W"));
    expect(r.shorted).toEqual(["B"]);
    expect(r.shortPath).toEqual(["W"]);
  });
  it("22. three in parallel", () => {
    const r = solve([bat("B", 6), res("R1", 3), res("R2", 6), res("R3", 2)], [...par("R1", "R2"), ...par("R1", "R3"), ["B.a", "R1.a"], ["B.b", "R1.b"]]);
    close(I(r, "B"), 6);
  });
  it("finds floating terminals", () => {
    const r = solve([bat("B", 6), res("R", 10), res("X", 10)], [...loop("B", "R"), ["X.a", "R.a"]]);
    expect(r.floating).toEqual(["X.b"]);
  });
});

describe("resistor helpers", () => {
  it("colour bands follow the E12 code", () => {
    expect(colourBands(4700)).toEqual(["yellow", "violet", "red", "gold"]);
    expect(colourBands(10)).toEqual(["brown", "black", "black", "gold"]);
    expect(colourBands(2.2)).toEqual(["red", "red", "gold", "gold"]);
  });
  it("a resistor left on warms and its resistance creeps up", () => {
    let t = 20;
    for (let s = 0; s < 60; s++) t = heatStep(t, 0.9, 1);
    expect(t).toBeGreaterThan(55);
    expect(hotResistance(10, t)).toBeGreaterThan(11.3);
  });
});

describe("mechanics", () => {
  it("RK4 projectile matches the analytic range, height and time within 0.5 % (drag off)", () => {
    for (const [speed, angle, g] of [[20, 45, 9.81], [15, 30, 1.62], [30, 70, 24.79], [12, 10, 3.71]] as const) {
      const a = idealFlight({ speed, angleDeg: angle, g });
      const s = simulateFlight({ speed, angleDeg: angle, g });
      expect(Math.abs(s.range - a.range) / a.range).toBeLessThan(0.005);
      expect(Math.abs(s.maxHeight - a.maxHeight) / a.maxHeight).toBeLessThan(0.005);
      expect(Math.abs(s.time - a.time) / a.time).toBeLessThan(0.005);
    }
  });
  it("complementary angles give the same ideal range; drag shortens it", () => {
    close(idealFlight({ speed: 20, angleDeg: 30, g: 9.81 }).range, idealFlight({ speed: 20, angleDeg: 60, g: 9.81 }).range, 1e-9);
    expect(simulateFlight({ speed: 20, angleDeg: 45, g: 9.81, drag: true }).range).toBeLessThan(idealFlight({ speed: 20, angleDeg: 45, g: 9.81 }).range * 0.9);
  });
  it("pendulum period: small-angle limit and the large-angle correction", () => {
    close(pendulumPeriod(1, 0.5), smallAnglePeriod(1), 1e-5);
    close(pendulumPeriod(1, 60) / smallAnglePeriod(1), 1.07318, 1e-4); // known ratio at 60 degrees
  });
  it("Archimedes: loss of weight equals weight of water displaced", () => {
    const b = buoyancy(SINKERS[0]!, 1);
    close(b.weightN - b.readingN, b.displacedWeightN, 1e-12);
    close(b.displacedMl, 20);
  });
});

describe("optics", () => {
  it("total internal reflection starts at 41.8 degrees for n = 1.5", () => {
    expect(criticalAngleDeg(1.5)!.toFixed(1)).toBe("41.8");
    expect(snellDeg(41.7, 1.5, 1)).not.toBeNull();
    expect(snellDeg(41.9, 1.5, 1)).toBeNull();
  });
  it("a ray through a slab emerges parallel, shifted sideways", () => {
    const g = slabGeometry(40, 50, 1.5);
    const sh = slab("s", 0, 0, 400, 50);
    // ray coming down-right at 40 degrees to the normal (normal is vertical)
    const d = { x: Math.sin((40 * Math.PI) / 180), y: Math.cos((40 * Math.PI) / 180) };
    const { hits, segments } = trace({ x: 100 - 100 * d.x / d.y, y: -100 }, d, [sh]);
    const ref = hits.filter((h) => h.kind === "refract");
    close(ref[0]!.outDeg!, g.r, 1e-6);
    close(ref[1]!.outDeg!, 40, 1e-6);
    const last = segments.find((s) => s.a.y >= 50 - 1e-6 && s.intensity > 0.5)!;
    const dir = { x: last.b.x - last.a.x, y: last.b.y - last.a.y };
    close(Math.atan2(dir.x, dir.y) * (180 / Math.PI), 40, 1e-6);
  });
  it("glass to air past the critical angle reflects totally", () => {
    const sh = slab("s", 0, 0, 400, 50);
    const a = (50 * Math.PI) / 180;
    const { hits } = trace({ x: 50, y: 10 }, { x: Math.sin(a), y: Math.cos(a) }, [sh]);
    expect(hits[0]!.kind).toBe("tir");
  });
  it("Cauchy dispersion: violet bends more than red", () => {
    expect(cauchy(400)).toBeGreaterThan(cauchy(700));
  });
  it("lens formula in the Cartesian convention", () => {
    const im = lensImage(-30, 10);
    close(im.v, 15);
    close(im.m, -0.5);
    expect(im.real).toBe(true);
    expect(lensImage(-5, 10).real).toBe(false);
  });
});

describe("determinism", () => {
  it("the same seed gives the same sequence", () => {
    const a = rng(42);
    const b = rng(42);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });
});
