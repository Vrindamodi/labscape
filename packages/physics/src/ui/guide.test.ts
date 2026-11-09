import type { LabEvent } from "@labscape/contracts";
import { describe, expect, it } from "vitest";
import { PHYSICS_CONTENT, PHYSICS_MODELS } from "../labs/index";
import { SimEvaluator } from "../protocol/evaluator";
import { firstSentence, goldenSteps } from "./guide";

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

  it("first sentence", () => {
    expect(firstSentence("Close the switch. Then read both meters.")).toBe("Close the switch.");
    expect(firstSentence("Drag the vertex")).toBe("Drag the vertex");
    expect(firstSentence("3x + 4 = 19. Take 4 off both pans. Then divide.")).toBe("3x + 4 = 19. Take 4 off both pans.");
    expect(firstSentence("Set g = 9.81 m/s² first. Then launch.")).toBe("Set g = 9.81 m/s² first.");
  });
});
