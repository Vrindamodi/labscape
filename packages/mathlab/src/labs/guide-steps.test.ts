import type { LabEvent } from "@labscape/contracts";
import { describe, expect, it } from "vitest";
import { MATHS_CONTENT, MATHS_MODELS } from "./index";
import { goldenSteps, SimEvaluator } from "@labscape/physics";

describe("Guide me: golden run split by step", () => {
  for (const slug of Object.keys(MATHS_CONTENT))
    it(`${slug}: "Do this step for me" completes every step in turn`, () => {
      const content = MATHS_CONTENT[slug]!;
      const model = MATHS_MODELS[slug]!;
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

});
