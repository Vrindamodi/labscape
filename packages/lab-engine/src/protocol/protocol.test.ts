import type { LabEvent } from "@labscape/contracts";
import { describe, expect, it } from "vitest";
import { EXPERIMENTS } from "./content";
import { goldenEvents, runSession } from "./session";

const titration = EXPERIMENTS["acid-base-titration"]!;

function edit(events: LabEvent[], fn: (e: LabEvent[]) => LabEvent[]) {
  return fn(events.map((e) => ({ ...e }))).map((e, i) => ({ ...e, seq: i + 1 }));
}

describe("acid-base titration protocol", () => {
  it("the golden run completes every step with three stars", () => {
    const r = runSession(titration, goldenEvents(titration.golden), { tailMs: 2000 });
    const notDone = r.report.steps.filter((s) => !s.done).map((s) => s.id);
    expect(notDone).toEqual([]);
    expect(r.report.deviations.map((d) => `${d.stepId}:${d.code}`)).toEqual([]);
    expect(r.report.completed).toBe(true);
    expect(r.report.score).toBeGreaterThanOrEqual(95);
    expect(r.report.stars).toBe(3);
  });

  it("pouring straight in near the end point is flagged and overshoots", () => {
    const events = edit(goldenEvents(titration.golden), (es) => {
      const i = es.findIndex((e) => e.type === "liquid.drop" && (e.payload as { volumeMl: number }).volumeMl === 9.0);
      // Replace the careful approach with one big 11 mL pour.
      es[i] = { ...es[i]!, type: "liquid.pour", payload: { from: "burette-1", to: "flask-2", volumeMl: 11, tiltDegMax: 0, meanRateMlPerS: 2, peakRateMlPerS: 2, durationMs: 5500 } } as LabEvent;
      return es.filter((e, j) => !(j > i && j < i + 12 && e.type !== "mix.swirl" && (e.payload as { to?: string }).to === "flask-2"));
    });
    const r = runSession(titration, events, { tailMs: 31000 });
    const codes = r.report.deviations.map((d) => d.code);
    expect(codes).toContain("not-dropwise");
    expect(codes).toContain("overshoot");
    expect(r.report.score).toBeLessThan(90);
  });

  it("a fast pour into the burette is a rate deviation", () => {
    const events = edit(goldenEvents(titration.golden), (es) => {
      es[0] = { ...es[0]!, payload: { ...(es[0]!.payload as object), peakRateMlPerS: 14 } } as LabEvent;
      return es;
    });
    const r = runSession(titration, events, { tailMs: 2000 });
    expect(r.report.deviations.find((d) => d.code === "rate")?.severity).toBe("major");
  });

  it("skipping the indicator before titrating is an order error", () => {
    const events = edit(goldenEvents(titration.golden), (es) => es.filter((e) => !(e.type === "liquid.drop" && (e.payload as { from: string; to: string }).from === "phph" && (e.payload as { to: string }).to === "flask-1")));
    const r = runSession(titration, events, { tailMs: 2000 });
    expect(r.report.deviations.some((d) => d.code === "order" && d.stepId === "rough-run")).toBe(true);
  });

  it("server replay of the same log gives the same hash and score", () => {
    const a = runSession(titration, goldenEvents(titration.golden), { tailMs: 2000 });
    const b = runSession(titration, goldenEvents(titration.golden), { tailMs: 2000 });
    expect(b.hash).toBe(a.hash);
    expect(b.report.score).toBe(a.report.score);
  });
});

describe("every MVP experiment", () => {
  for (const [slug, content] of Object.entries(EXPERIMENTS)) {
    it(`${slug}: the golden run completes with three stars and no deviations`, () => {
      const r = runSession(content, goldenEvents(content.golden), { tailMs: 2000 });
      expect(r.report.steps.filter((s) => !s.done).map((s) => s.id)).toEqual([]);
      expect(r.report.deviations.map((d) => `${d.stepId}:${d.code}`)).toEqual([]);
      expect(r.report.stars).toBe(3);
    });
  }

  it("water into concentrated acid stops the run with a safety card", () => {
    const content = EXPERIMENTS["diluting-acid-safely"]!;
    const events = goldenEvents(content.golden).filter((e) => !(e.type === "liquid.pour" && (e.payload as { from: string }).from === "water"));
    // Acid first, then water on top of it.
    events.push({ id: "x", attemptId: "golden", seq: 99, t: 30000, actor: "user", type: "liquid.pour", payload: { from: "water", to: "beaker", volumeMl: 3, tiltDegMax: 50, meanRateMlPerS: 2, peakRateMlPerS: 3, durationMs: 1500 } } as LabEvent);
    const r = runSession(content, events, { tailMs: 1000 });
    expect(r.report.stoppedForSafety).toBe(true);
    expect(r.feedback.some((f) => f.kind === "safety-stop")).toBe(true);
    expect(r.report.score).toBeLessThanOrEqual(40);
  });
});
