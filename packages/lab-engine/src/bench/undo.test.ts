import type { LabEvent } from "@labscape/contracts";
import { describe, expect, it } from "vitest";
import { EXPERIMENTS } from "../protocol/content";
import { runSession } from "../protocol/session";
import { undoPoint } from "./useLabSession";

let seq = 0;
const ev = (t: number, type: LabEvent["type"], payload: Record<string, unknown>, actor: LabEvent["actor"] = "user") => ({ id: `e${++seq}`, attemptId: "a", seq, t, actor, type, payload }) as LabEvent;
const pour = (t: number, from: string, to: string, volumeMl: number) => ev(t, "liquid.pour", { from, to, volumeMl, tiltDegMax: 40, meanRateMlPerS: 1, peakRateMlPerS: 1, durationMs: 400 });

describe("undo", () => {
  it("has nothing to undo on an empty log or one with only hints", () => {
    seq = 0;
    expect(undoPoint([])).toBeNull();
    expect(undoPoint([ev(100, "hint.shown", { hintId: "h", rung: 1, stepId: "s" })])).toBeNull();
  });

  it("undoes a whole pour (many chunks) with the stirring done during it, in one go", () => {
    seq = 0;
    const log = [
      ev(1000, "equipment.place", { equipmentId: "goggles", x: 0, y: 0, socket: "worn" }),
      pour(5000, "water", "beaker", 20),
      pour(5400, "water", "beaker", 20),
      pour(5800, "water", "beaker", 10),
      pour(20000, "cyl", "beaker", 1),
      ev(20300, "mix.stir", { target: "beaker", intensity: "gentle", durationMs: 800 }),
      pour(20400, "cyl", "beaker", 1),
      ev(21100, "mix.stir", { target: "beaker", intensity: "gentle", durationMs: 800 }),
      pour(21200, "cyl", "beaker", 1),
    ];
    // Back to just after the water pour.
    expect(undoPoint(log)).toBe(4);
    // Then the water pour, as one action.
    expect(undoPoint(log.slice(0, 4))).toBe(1);
    expect(undoPoint(log.slice(0, 1))).toBe(0);
  });

  it("a pause splits the same action into separate undos", () => {
    seq = 0;
    const log = [ev(1000, "liquid.drop", { from: "univ", to: "t1", drops: 1, volumeMl: 0.05 }), ev(6000, "liquid.drop", { from: "univ", to: "t1", drops: 1, volumeMl: 0.05 })];
    expect(undoPoint(log)).toBe(1);
  });

  it("a stirring run on its own is one undo, and trailing hints go with it", () => {
    seq = 0;
    const log = [
      pour(1000, "water", "beaker", 50),
      ev(3000, "mix.stir", { target: "beaker", intensity: "gentle", durationMs: 800 }),
      ev(3800, "mix.stir", { target: "beaker", intensity: "gentle", durationMs: 800 }),
      ev(4000, "hint.shown", { hintId: "h", rung: 1, stepId: "s" }),
    ];
    expect(undoPoint(log)).toBe(1);
  });

  it("undoing the wrong-order pour lifts the safety stop on replay", () => {
    seq = 0;
    const dil = EXPERIMENTS["diluting-acid-safely"]!;
    const log = [
      ev(1000, "equipment.place", { equipmentId: "goggles", x: 0, y: 0, socket: "worn" }),
      pour(3000, "acid", "cyl", 5),
      pour(9000, "cyl", "beaker", 5),
      pour(15000, "water", "beaker", 2),
      pour(15400, "water", "beaker", 2),
    ];
    const bad = runSession(dil, log, { tailMs: 2000 });
    expect(bad.report.stoppedForSafety).toBe(true);
    const keep = undoPoint(log)!;
    const fixed = runSession(
      dil,
      log.filter((e) => e.seq <= keep),
      { tailMs: 2000 },
    );
    expect(fixed.report.stoppedForSafety).toBe(false);
  });
});
