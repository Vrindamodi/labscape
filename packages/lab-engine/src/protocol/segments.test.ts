import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXPERIMENTS } from "./content";
import { buildSegmentTable, goldenSegments } from "./segments";

const FILE = fileURLToPath(new URL("./segments.generated.json", import.meta.url));

describe("golden segments", () => {
  const table = buildSegmentTable(Object.values(EXPERIMENTS));

  it("segments.generated.json is current (UPDATE_SEGMENTS=1 rewrites it)", () => {
    if (process.env.UPDATE_SEGMENTS) writeFileSync(FILE, JSON.stringify(table) + "\n");
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(table);
  });

  for (const c of Object.values(EXPERIMENTS)) {
    it(`${c.slug}: every required step has a golden segment`, () => {
      const seg = goldenSegments(c);
      for (const s of c.steps) {
        if (s.optional) continue;
        const g = seg[s.id]!;
        expect(g, s.id).toBeTruthy();
        expect(g.endT, s.id).toBeGreaterThan(0);
        // A step with an action of its own carries at least one recorded event (waits may not).
        if (s.action !== "timer.mark") expect(g.events.length, s.id).toBeGreaterThan(0);
      }
    });
  }
});
