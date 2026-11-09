import type { LabEvent } from "@labscape/contracts";
import { describe, expect, it } from "vitest";
import { PHYSICS_CONTENT, PHYSICS_MODELS } from "../labs/index";
import { SimEvaluator } from "../protocol/evaluator";
import { firstSentence, goldenSteps, submitted } from "./guide";

/** The value of the latest event in the log that fills the same box as `e`. */
function lastOf(log: LabEvent[], e: LabEvent): number | string {
  const same = log.filter((x) =>
    e.type === "param.set" ? x.type === "param.set" && x.payload.key === e.payload.key : e.type === "measure.read" && x.type === "measure.read" && x.payload.instrument === e.payload.instrument && x.payload.reading.key === e.payload.reading.key,
  );
  const last = same[same.length - 1]!;
  return last.type === "param.set" ? (last.payload.value as number | string) : last.type === "measure.read" ? last.payload.reading.value : "";
}

describe("Guide me: golden run split by step", () => {
  for (const slug of Object.keys(PHYSICS_CONTENT))
    it(`${slug}: "Do this step for me" completes every step in turn`, () => {
      const content = PHYSICS_CONTENT[slug]!;
      const model = PHYSICS_MODELS[slug]!;
      const groups = goldenSteps(content, model);
      const ev = new SimEvaluator(content, model);
      let seq = 0;
      let t = 0;
      // A beginner who presses "Do this step for me" on every step, a second apart.
      for (let cur = ev.current(); cur; cur = ev.current()) {
        const g = groups[cur.id];
        expect(g, `no golden actions for ${cur.id}`).toBeTruthy();
        for (const e of g!.events) {
          if (ev.done[cur.id] !== null) break;
          t += 600;
          ev.push({ ...e, seq: ++seq, t: Math.max(t, e.t), actor: "user" } as LabEvent);
        }
        expect(ev.done[cur.id], `${cur.id} not completed`).not.toBeNull();
      }
      expect(ev.report().completed).toBe(true);
      expect(ev.report().deviations).toEqual([]);
    });

  for (const slug of Object.keys(PHYSICS_CONTENT))
    it(`${slug}: answer boxes show what "Do this step for me" submitted`, () => {
      const content = PHYSICS_CONTENT[slug]!;
      const model = PHYSICS_MODELS[slug]!;
      const log: LabEvent[] = [];
      for (const g of Object.values(goldenSteps(content, model))) {
        log.push(...g.events);
        for (const e of g.events) {
          if (e.type === "param.set" && String(e.payload.key).startsWith("result:")) expect(submitted(log, e.payload.key)).toBe(lastOf(log, e));
          if (e.type === "measure.read") expect(submitted(log, e.payload.reading.key, e.payload.instrument)).toBe(lastOf(log, e));
        }
      }
      expect(log.some((e) => e.type === "measure.read" || (e.type === "param.set" && String(e.payload.key).startsWith("result:"))), "no answer box filled").toBe(true);
    });

  it("submitted: nothing yet, then the latest value", () => {
    const at = (seq: number, type: string, payload: unknown) => ({ id: `x${seq}`, attemptId: "x", seq, t: seq, actor: "user", type, payload }) as LabEvent;
    const log = [at(1, "param.set", { key: "result:R", value: 9 }), at(2, "measure.read", { instrument: "voltmeter", reading: { key: "V", value: 1.5, unit: "V" } }), at(3, "param.set", { key: "result:R", value: 10 })];
    expect(submitted([], "result:R")).toBeNull();
    expect(submitted(log, "result:R")).toBe(10);
    expect(submitted(log, "V", "voltmeter")).toBe(1.5);
    expect(submitted(log, "V", "ammeter")).toBeNull();
  });

  it("first sentence", () => {
    expect(firstSentence("Close the switch. Then read both meters.")).toBe("Close the switch.");
    expect(firstSentence("Drag the vertex")).toBe("Drag the vertex");
    expect(firstSentence("3x + 4 = 19. Take 4 off both pans. Then divide.")).toBe("3x + 4 = 19. Take 4 off both pans.");
    expect(firstSentence("Set g = 9.81 m/s² first. Then launch.")).toBe("Set g = 9.81 m/s² first.");
  });
});
