import type { LabEvent } from "@labscape/contracts";
import { describe, expect, it } from "vitest";
import { appearance, solvePh, type Amounts } from "./chem";
import { heightOf, onsetAngleDeg, pourRateMlPerS, volumeBelow } from "./equipment";
import { stateHash } from "./hash";
import { applyEvent, replay } from "./reducer";
import { initialState, look, type BenchSetup, type LabState } from "./state";

let seq = 0;
function ev<T extends LabEvent["type"]>(type: T, payload: Extract<LabEvent, { type: T }>["payload"], t = seq * 1000): LabEvent {
  seq += 1;
  return { id: `e${seq}`, attemptId: "a", seq, t, actor: "user", type, payload } as LabEvent;
}
function run(state: LabState, events: LabEvent[]) {
  let s = state;
  const notes: string[] = [];
  const cues: string[] = [];
  for (const e of events) {
    const r = applyEvent(s, e);
    s = r.state;
    notes.push(...r.notes.map((n) => n.text));
    cues.push(...r.cues.map((c) => c.kind));
  }
  return { s, notes, cues };
}

const TITRATION: BenchSetup = {
  items: [
    { id: "naoh", kind: "reagent_bottle", fill: { reagentId: "naoh-0.1", volumeMl: 200 } },
    { id: "hcl", kind: "reagent_bottle", fill: { reagentId: "hcl-0.1", volumeMl: 200 } },
    { id: "phph", kind: "dropper_bottle", fill: { reagentId: "phph", volumeMl: 20 } },
    { id: "burette-1", kind: "burette_50" },
    { id: "pipette-1", kind: "pipette_10" },
    { id: "flask-1", kind: "conical_flask_100" },
  ],
};

describe("chemistry", () => {
  it("gets strong acid, strong base and neutral pH right", () => {
    expect(solvePh({ "Cl-": 1e-4 }, 1)).toBeCloseTo(1, 2); // 0.1 M HCl
    expect(solvePh({ "Na+": 1e-4 }, 1)).toBeCloseTo(13, 2); // 0.1 M NaOH
    expect(solvePh({ "Na+": 1e-4, "Cl-": 1e-4 }, 2)).toBeCloseTo(7, 2);
    expect(solvePh({}, 50)).toBeCloseTo(7, 2);
  });

  it("buffers weak acid by the charge balance (0.1 M acetic acid ~ pH 2.88)", () => {
    expect(solvePh({ CH3COOH_T: 1e-4 } as Amounts, 1)).toBeCloseTo(2.88, 1);
  });

  it("colours phenolphthalein only above pH ~8.2", () => {
    const acid = appearance({ "Cl-": 1e-4, phph: 4e-7 }, {}, 50, 3);
    const base = appearance({ "Na+": 1e-3, phph: 4e-7 }, {}, 50, 12);
    expect(base.colour.a).toBeGreaterThan(acid.colour.a + 0.05);
  });
});

describe("pour physics", () => {
  it("integrates the profile to the right volume", () => {
    expect(volumeBelow("beaker_100", 68)).toBeGreaterThan(115);
    expect(heightOf("beaker_100", 50)).toBeGreaterThan(20);
  });

  it("a fuller vessel starts pouring at a smaller tilt", () => {
    expect(onsetAngleDeg("beaker_250", 220)).toBeLessThan(onsetAngleDeg("beaker_250", 60));
  });

  it("trickles just past onset and gushes when tipped hard", () => {
    const onset = onsetAngleDeg("beaker_250", 150);
    const trickle = pourRateMlPerS("beaker_250", 150, onset + 3);
    const gush = pourRateMlPerS("beaker_250", 150, 90);
    expect(trickle).toBeGreaterThan(0);
    expect(trickle).toBeLessThan(5);
    expect(gush).toBeGreaterThan(15);
    expect(pourRateMlPerS("beaker_250", 150, onset - 2)).toBe(0);
  });
});

describe("titration", () => {
  it("reaches the phenolphthalein end point at 10.00 mL of 0.100 M NaOH", () => {
    seq = 0;
    const base = run(initialState(TITRATION), [
      ev("liquid.pour", { from: "naoh", to: "burette-1", volumeMl: 50, tiltDegMax: 70, meanRateMlPerS: 5, peakRateMlPerS: 8, durationMs: 10000 }),
      ev("param.set", { key: "clear-bubble:burette-1", value: true }),
      ev("liquid.draw", { from: "hcl", into: "pipette-1", volumeMl: 10 }),
      ev("liquid.drop", { from: "pipette-1", to: "flask-1", drops: 1, volumeMl: 10 }),
      ev("liquid.drop", { from: "phph", to: "flask-1", drops: 3, volumeMl: 0.15 }),
      ev("liquid.drop", { from: "burette-1", to: "flask-1", drops: 180, volumeMl: 9.9 }),
      ev("mix.swirl", { target: "flask-1", durationMs: 3000 }),
    ]);
    const before = look(base.s.items["flask-1"]!)!;
    expect(before.ph).toBeLessThan(5);
    const after = run(base.s, [ev("liquid.drop", { from: "burette-1", to: "flask-1", drops: 3, volumeMl: 0.15 }), ev("mix.swirl", { target: "flask-1", durationMs: 3000 })]);
    const end = look(after.s.items["flask-1"]!)!;
    expect(end.ph).toBeGreaterThan(9.5);
    expect(end.colour.a).toBeGreaterThan(before.colour.a + 0.03); // faint pink
  });

  it("flashes pink where a drop lands before swirling", () => {
    seq = 0;
    const r = run(initialState(TITRATION), [
      ev("liquid.draw", { from: "hcl", into: "pipette-1", volumeMl: 10 }),
      ev("liquid.drop", { from: "pipette-1", to: "flask-1", drops: 1, volumeMl: 10 }),
      ev("liquid.drop", { from: "phph", to: "flask-1", drops: 3, volumeMl: 0.15 }),
      ev("mix.swirl", { target: "flask-1", durationMs: 3000 }),
      ev("liquid.pour", { from: "naoh", to: "flask-1", volumeMl: 2, tiltDegMax: 60, meanRateMlPerS: 2, peakRateMlPerS: 3, durationMs: 1000 }),
    ]);
    const l = look(r.s.items["flask-1"]!)!;
    expect(l.ph).toBeLessThan(3);
    expect(l.plume).not.toBeNull();
    expect(l.plume!.colour.a).toBeGreaterThan(0.08);
  });

  it("an air bubble left in the burette tip makes the titre 0.10 mL too big", () => {
    seq = 0;
    const r = run(initialState(TITRATION), [
      ev("liquid.pour", { from: "naoh", to: "burette-1", volumeMl: 50, tiltDegMax: 70, meanRateMlPerS: 5, peakRateMlPerS: 8, durationMs: 10000 }),
      ev("liquid.drop", { from: "burette-1", to: "flask-1", drops: 20, volumeMl: 1 }),
    ]);
    expect(r.s.items["flask-1"]!.liquid!.volumeMl).toBeCloseTo(0.9, 3);
    expect(r.notes.join(" ")).toMatch(/air bubble/);
  });
});

describe("other MVP chemistry", () => {
  it("precipitates pale blue Cu(OH)2 and white BaSO4", () => {
    seq = 0;
    const r = run(
      initialState({
        items: [
          { id: "cu", kind: "dropper_bottle", fill: { reagentId: "cuso4-0.5", volumeMl: 20 } },
          { id: "oh", kind: "dropper_bottle", fill: { reagentId: "naoh-1", volumeMl: 20 } },
          { id: "ba", kind: "dropper_bottle", fill: { reagentId: "bacl2-0.1", volumeMl: 20 } },
          { id: "so4", kind: "dropper_bottle", fill: { reagentId: "na2so4-0.1", volumeMl: 20 } },
          { id: "t1", kind: "test_tube" },
          { id: "t2", kind: "test_tube" },
        ],
      }),
      [
        ev("liquid.drop", { from: "cu", to: "t1", drops: 40, volumeMl: 2 }),
        ev("liquid.drop", { from: "oh", to: "t1", drops: 20, volumeMl: 1 }),
        ev("liquid.drop", { from: "ba", to: "t2", drops: 40, volumeMl: 2 }),
        ev("liquid.drop", { from: "so4", to: "t2", drops: 40, volumeMl: 2 }),
      ],
    );
    expect(r.s.items.t1!.liquid!.solids["Cu(OH)2"]).toBeGreaterThan(4e-4);
    expect(r.s.items.t2!.liquid!.solids.BaSO4).toBeGreaterThan(1.9e-4);
    expect(r.cues).toContain("precipitate");
  });

  it("magnesium fizzes, the collected gas gives a squeaky pop", () => {
    seq = 0;
    const r = run(
      initialState({
        items: [
          { id: "acid", kind: "reagent_bottle", fill: { reagentId: "hcl-1", volumeMl: 100 } },
          { id: "t1", kind: "test_tube" },
          { id: "t2", kind: "test_tube" },
          { id: "splint", kind: "splint" },
        ],
      }),
      [
        ev("liquid.pour", { from: "acid", to: "t1", volumeMl: 5, tiltDegMax: 60, meanRateMlPerS: 2, peakRateMlPerS: 3, durationMs: 2500 }),
        ev("equipment.connect", { from: "t1", to: "t2", port: "collect" }),
        ev("solid.add", { from: "mg-ribbon", to: "t1", massG: 0.05 }),
        ev("param.set", { key: "light:splint", value: true }, 60_000),
        ev("equipment.connect", { from: "splint", to: "t2", port: "mouth" }, 61_000),
      ],
    );
    expect(r.cues).toContain("gas");
    expect(r.notes.join(" ")).toMatch(/Squeaky pop/);
    expect(r.s.items.t1!.liquid!.tempC).toBeGreaterThan(25);
  });

  it("an iron nail coats with copper and the blue fades", () => {
    seq = 0;
    const s0 = initialState({ items: [{ id: "cu", kind: "reagent_bottle", fill: { reagentId: "cuso4-0.5", volumeMl: 100 } }, { id: "t1", kind: "boiling_tube" }] });
    const r = run(s0, [
      ev("liquid.pour", { from: "cu", to: "t1", volumeMl: 20, tiltDegMax: 60, meanRateMlPerS: 4, peakRateMlPerS: 6, durationMs: 5000 }),
      ev("solid.add", { from: "iron-nail", to: "t1", massG: 3 }),
    ]);
    const blue0 = look(r.s.items.t1!)!.colour.b;
    const later = run(r.s, [ev("timer.mark", { label: "ten minutes" }, 600_000)]);
    expect(later.notes.join(" ")).toMatch(/copper/);
    expect(look(later.s.items.t1!)!.colour.b).toBeGreaterThan(blue0); // less blue
  });

  it("flame tests show each metal's colour, and a dirty loop shows sodium yellow", () => {
    seq = 0;
    const s0 = initialState({
      items: [
        { id: "li", kind: "test_tube", fill: { reagentId: "licl", volumeMl: 5 } },
        { id: "loop", kind: "wire_loop", coating: {} },
        { id: "b", kind: "bunsen" },
      ],
    });
    const r = run(s0, [
      ev("param.set", { key: "airhole:b", value: true }),
      ev("heat.set", { target: "b", powerPct: 100 }),
      ev("equipment.connect", { from: "loop", to: "li", port: "dip" }),
      ev("equipment.connect", { from: "loop", to: "b", port: "flame" }),
    ]);
    expect(r.notes.join(" ")).toMatch(/crimson/);
    seq = 0;
    const dirty = run(initialState({ items: [{ id: "loop", kind: "wire_loop" }, { id: "b", kind: "bunsen" }] }), [
      ev("heat.set", { target: "b", powerPct: 100 }),
      ev("equipment.connect", { from: "loop", to: "b", port: "flame" }),
    ]);
    expect(dirty.notes.join(" ")).toMatch(/yellow/);
  });

  it("water into concentrated acid spatters; acid into water just warms", () => {
    seq = 0;
    const setup: BenchSetup = {
      items: [
        { id: "acid", kind: "reagent_bottle", fill: { reagentId: "h2so4-conc", volumeMl: 50 } },
        { id: "water", kind: "wash_bottle", fill: { reagentId: "water", volumeMl: 200 } },
        { id: "b1", kind: "beaker_100" },
        { id: "b2", kind: "beaker_100" },
      ],
    };
    const wrong = run(initialState(setup), [
      ev("liquid.pour", { from: "acid", to: "b1", volumeMl: 5, tiltDegMax: 50, meanRateMlPerS: 1, peakRateMlPerS: 2, durationMs: 5000 }),
      ev("liquid.drop", { from: "water", to: "b1", drops: 20, volumeMl: 1 }),
    ]);
    expect(wrong.notes.join(" ")).toMatch(/spits hot acid/);
    seq = 0;
    const right = run(initialState(setup), [
      ev("liquid.drop", { from: "water", to: "b2", drops: 1000, volumeMl: 50 }),
      ev("liquid.pour", { from: "acid", to: "b2", volumeMl: 2, tiltDegMax: 40, meanRateMlPerS: 0.4, peakRateMlPerS: 0.6, durationMs: 5000 }),
    ]);
    expect(right.notes.join(" ")).not.toMatch(/spits/);
    expect(right.s.items.b2!.liquid!.tempC).toBeGreaterThan(30);
  });
});

describe("determinism", () => {
  it("replaying the same log gives the same state hash", () => {
    seq = 0;
    const events = [
      ev("liquid.pour", { from: "naoh", to: "burette-1", volumeMl: 50, tiltDegMax: 70, meanRateMlPerS: 5, peakRateMlPerS: 8, durationMs: 10000 }),
      ev("liquid.draw", { from: "hcl", into: "pipette-1", volumeMl: 10 }),
      ev("liquid.drop", { from: "pipette-1", to: "flask-1", drops: 1, volumeMl: 10 }),
      ev("liquid.drop", { from: "phph", to: "flask-1", drops: 3, volumeMl: 0.15 }),
      ev("liquid.drop", { from: "burette-1", to: "flask-1", drops: 100, volumeMl: 5 }),
    ];
    const a = replay(TITRATION, events);
    const b = replay(TITRATION, [...events].reverse());
    expect(stateHash(a.state)).toBe(stateHash(b.state));
    expect(stateHash(a.state)).toMatch(/^[0-9a-f]{14}$/);
  });
});

describe("hydrolysis", () => {
  it("copper(II) sulfate solution is acidic and clear, not a hydroxide sludge", () => {
    const ions = { "Cu2+": 0.5e-3, "SO4^2-": 0.5e-3 };
    expect(solvePh(ions, 1)).toBeGreaterThan(3.3);
    expect(solvePh(ions, 1)).toBeLessThan(4.6);
  });
});
