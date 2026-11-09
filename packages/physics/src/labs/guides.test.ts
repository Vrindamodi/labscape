import type { LabEvent } from "@labscape/contracts";
import { describe, expect, it } from "vitest";
import { effectiveEvents, lastUndoable, runSim, simGoldenEvents, UNDO_KEY } from "../protocol/evaluator";
import { PHYSICS_GUIDES } from "./guides";
import { PHYSICS_CONTENT, PHYSICS_MODELS } from "./index";

const ev = (seq: number, t: number, type: LabEvent["type"], payload: Record<string, unknown>, actor: LabEvent["actor"] = "user") => ({ id: `x${seq}`, attemptId: "t", seq, t, actor, type, payload }) as LabEvent;

describe("undo in Try", () => {
  it("an undo marker removes the event it names, and itself, from the replay", () => {
    const es = [ev(1, 100, "param.set", { key: "amplitude", value: 30 }), ev(2, 200, "sim.start", {}), ev(3, 300, "param.set", { key: UNDO_KEY, value: 2 })];
    expect(effectiveEvents(es).map((e) => e.seq)).toEqual([1]);
    expect(lastUndoable(es)!.seq).toBe(1);
    // hints are not student actions
    expect(lastUndoable([ev(1, 1, "hint.shown", { hintId: "h", rung: 1 })])).toBeNull();
  });

  it("undoing a big-angle release takes its mistake back with it", () => {
    const content = PHYSICS_CONTENT["simple-pendulum"]!, model = PHYSICS_MODELS["simple-pendulum"]!;
    const wrong = [ev(1, 100, "param.set", { key: "amplitude", value: 30 }), ev(2, 200, "sim.start", {})];
    expect(runSim(content, model, wrong).report.deviations.map((d) => d.code)).toEqual(["big-swing"]);
    const undone = [...wrong, ev(3, 300, "param.set", { key: UNDO_KEY, value: 2 }), ev(4, 400, "param.set", { key: UNDO_KEY, value: 1 })];
    const r = runSim(content, model, undone);
    expect(r.report.deviations).toEqual([]);
    expect(r.state.amplitude).toBe(25);
    expect(r.state.released).toBe(false);
  });

  it("golden runs are unchanged", () => {
    for (const slug of Object.keys(PHYSICS_CONTENT)) expect(runSim(PHYSICS_CONTENT[slug]!, PHYSICS_MODELS[slug]!, simGoldenEvents(PHYSICS_CONTENT[slug]!, "t", "user")).report.stars).toBe(3);
  });
});

describe("beginner guides", () => {
  for (const [slug, content] of Object.entries(PHYSICS_CONTENT))
    it(`${slug}: one explanation per demo caption, and questions only for real steps`, () => {
      const g = PHYSICS_GUIDES[slug]!;
      expect(g).toBeDefined();
      expect(g.beats).toHaveLength(content.golden.captions.length);
      for (const step of Object.keys(g.explore)) expect(content.steps.map((s) => s.id)).toContain(step);
    });
});
