import { describe, expect, it } from "vitest";
import { MATHS_GUIDES } from "./guides";
import { MATHS_CONTENT } from "./index";

describe("maths beginner guides", () => {
  for (const [slug, content] of Object.entries(MATHS_CONTENT))
    it(`${slug}: one explanation per demo caption, and questions only for real steps`, () => {
      const g = MATHS_GUIDES[slug]!;
      expect(g).toBeDefined();
      expect(g.beats).toHaveLength(content.golden.captions.length);
      for (const step of Object.keys(g.explore)) expect(content.steps.map((s) => s.id)).toContain(step);
    });
});
