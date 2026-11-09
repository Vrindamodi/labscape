import type { LabEvent } from "@labscape/contracts";
import { describe, expect, it } from "vitest";
import { EXPERIMENTS } from "./content";
import { goldenEvents, recordGolden, runSession } from "./session";

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

describe("cross-engine fixture", () => {
  it("writes V8 golden-run hashes for the server (GraalJS) to match", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const out: Record<string, { hash: string; score: number }> = {};
    for (const [slug, content] of Object.entries(EXPERIMENTS)) {
      const r = runSession(content, goldenEvents(content.golden), { tailMs: 1000 });
      out[slug] = { hash: r.hash, score: r.report.score };
    }
    // Part 3: physics and maths run through the same server bundle.
    const { PHYSICS_CONTENT, PHYSICS_MODELS } = await import("@labscape/physics/labs");
    const { MATHS_CONTENT, MATHS_MODELS } = await import("@labscape/mathlab/labs");
    const { runSim, simGoldenEvents, simHash } = await import("@labscape/physics/protocol");
    for (const [contents, models] of [[PHYSICS_CONTENT, PHYSICS_MODELS], [MATHS_CONTENT, MATHS_MODELS]] as const) {
      for (const [slug, content] of Object.entries(contents)) {
        const r = runSim(content, models[slug]!, simGoldenEvents(content));
        out[slug] = { hash: simHash(r.state), score: r.report.score };
      }
    }
    const file = path.resolve(process.cwd(), "../../apps/api/src/test/resources/engine-golden-hashes.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
    expect(Object.keys(out).length).toBe(28); // 13 chemistry + 8 physics + 7 maths
  }, 60_000);
});

describe("Part 5 chemistry", () => {
  const ev = (content: string, fn: (e: LabEvent[]) => LabEvent[]) => edit(goldenEvents(EXPERIMENTS[content]!.golden), fn);

  it("elephant toothpaste: no catalyst, no foam and no oxygen to relight the splint", () => {
    const c = EXPERIMENTS["elephant-toothpaste"]!;
    const r = runSession(c, ev("elephant-toothpaste", (es) => es.filter((e) => (e.payload as { from?: string }).from !== "ki")), { tailMs: 5000 });
    expect(r.state.seen["foam:cyl"]).toBeUndefined();
    expect(r.state.seen["relight"]).toBeUndefined();
    expect(r.report.completed).toBe(false);
  });

  it("metal displacement: copper cannot displace magnesium", () => {
    const c = EXPERIMENTS["metal-displacement"]!;
    const r = runSession(c, goldenEvents(c.golden), { tailMs: 1000 });
    expect(r.state.items["t4"]!.depositMol).toBe(0);
    expect(r.state.items["t1"]!.depositOf).toBe("Zn");
    expect(r.state.items["t2"]!.depositOf).toBe("Fe");
    expect(r.state.items["t1"]!.liquid!.tempC).toBeGreaterThan(23);
  });

  it("disappearing cross: half the concentration takes about twice as long", () => {
    const c = EXPERIMENTS["disappearing-cross"]!;
    const r = runSession(c, goldenEvents(c.golden), { tailMs: 1000 });
    const a = r.state.seen["cross-gone:fA"]!;
    const b = r.state.seen["cross-gone:fB"]!;
    expect(a).toBeGreaterThan(15);
    expect(a).toBeLessThan(35);
    expect(b / a).toBeGreaterThan(1.7);
    expect(b / a).toBeLessThan(2.3);
  });

  it("disappearing cross: warm thiosulfate clouds faster", () => {
    const c = EXPERIMENTS["disappearing-cross"]!;
    const warm = { ...c, bench: { items: c.bench.items.map((i) => (i.id === "thio" ? { ...i, fill: { reagentId: "thio-0.15", volumeMl: 200, tempC: 40 } } : i)) } };
    const r = runSession(warm, goldenEvents(c.golden), { tailMs: 1000 });
    expect(r.state.seen["cross-gone:fA"]!).toBeLessThan(15);
  });

  it("making copper sulfate: boiling the acid stops the run", () => {
    const c = EXPERIMENTS["making-copper-sulfate"]!;
    const r = runSession(c, ev("making-copper-sulfate", (es) => es.filter((e) => !(e.type === "heat.set" && (e.payload as { powerPct: number }).powerPct === 0))), { tailMs: 1000 });
    expect(r.report.stoppedForSafety).toBe(true);
    expect(r.report.deviations.some((d) => d.code === "boiling-acid")).toBe(true);
  });

  it("making copper sulfate: crystals only appear once the solution cools", () => {
    const c = EXPERIMENTS["making-copper-sulfate"]!;
    const r = runSession(c, goldenEvents(c.golden), { tailMs: 1000 });
    expect(r.state.items["basin"]!.liquid!.solids["CuSO4.5H2O"]).toBeGreaterThan(1e-3);
    expect(r.state.items["basin"]!.liquid!.tempC).toBeLessThan(50);
  });

  it("making esters: lighting the Bunsen near ethanol is a safety stop", () => {
    const c = EXPERIMENTS["making-esters"]!;
    const r = runSession(c, ev("making-esters", (es) => [...es.slice(0, 3), { ...es[0]!, type: "heat.set", t: 9000, payload: { target: "bunsen", powerPct: 100 } } as LabEvent, ...es.slice(3)]), { tailMs: 1000 });
    expect(r.report.stoppedForSafety).toBe(true);
  });

  it("making esters: without the catalyst there is no fruity smell", () => {
    const c = EXPERIMENTS["making-esters"]!;
    const r = runSession(c, ev("making-esters", (es) => es.filter((e) => (e.payload as { from?: string }).from !== "conc")), { tailMs: 1000 });
    expect(r.state.seen["smell:ester"]).toBeUndefined();
  });

  it("electrolysis: hydrogen at the cathode, chlorine bleaches, the solution turns alkaline", () => {
    const c = EXPERIMENTS["electrolysis-of-brine"]!;
    const r = runSession(c, goldenEvents(c.golden), { tailMs: 1000 });
    expect(r.state.seen["pop-test"]).toBe(1);
    expect(r.state.items["litmus"]!.litmus).toBe("bleached");
    expect(r.state.items["cell"]!.liquid!.ph).toBeGreaterThan(10);
  });
});

describe("golden-run recorder", () => {
  it("round-trips every golden run with the same score", () => {
    for (const c of Object.values(EXPERIMENTS)) {
      const evs = goldenEvents(c.golden, "rec", "user").map((e) => ({ ...e, t: e.t + 5000 }));
      const { golden, report } = recordGolden(c, evs);
      expect(report.stars, c.slug).toBe(3);
      expect(golden.events).toHaveLength(c.golden.events.length);
      expect(golden.events[0]!.t).toBe(1000);
      expect(golden.captions.length, c.slug).toBe(c.steps.length);
    }
  }, 60_000);
});
