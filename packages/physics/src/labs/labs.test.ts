import type { LabEvent } from "@labscape/contracts";
import { describe, expect, it } from "vitest";
import { runSim, simGoldenEvents } from "../protocol/evaluator";
import { PHYSICS_CONTENT, PHYSICS_MODELS } from "./index";

const run = (slug: string, events: LabEvent[]) => runSim(PHYSICS_CONTENT[slug]!, PHYSICS_MODELS[slug]!, events);
const golden = (slug: string) => simGoldenEvents(PHYSICS_CONTENT[slug]!, "t", "user");
const codes = (slug: string, events: LabEvent[]) => run(slug, events).report.deviations.map((d) => d.code);
/** Edits a golden run: f gets a copy and returns the new event list (seq renumbered). */
const edit = (slug: string, f: (es: LabEvent[]) => LabEvent[]) => f(golden(slug).map((e) => JSON.parse(JSON.stringify(e)) as LabEvent)).map((e, i) => ({ ...e, seq: i + 1 }));
const ev = (t: number, type: LabEvent["type"], payload: Record<string, unknown>) => ({ id: `x${t}`, attemptId: "t", seq: 0, t, actor: "user", type, payload }) as LabEvent;
const seqd = (es: LabEvent[]) => es.map((e, i) => ({ ...e, seq: i + 1 }));

describe("physics golden runs", () => {
  for (const slug of Object.keys(PHYSICS_CONTENT))
    it(`${slug} scores 3 stars with no deviations`, () => {
      const r = run(slug, golden(slug)).report;
      expect(r.deviations).toEqual([]);
      expect(r.completed).toBe(true);
      expect(r.stars).toBe(3);
    });
});

describe("physics mistakes are caught", () => {
  it("Ohm's law: ammeter across the resistor", () => {
    // rheostat straight to the resistor, and the ammeter's two leads on the resistor's two ends
    const remap: Record<string, [string, string]> = { "Rh.b": ["Rh.b", "R.a"], "A.b": ["A.b", "R.b"] };
    const es = edit("ohms-law", (es) =>
      es.flatMap((e) => {
        if (e.type !== "equipment.connect" || !remap[e.payload.from]) return [e];
        const [from, to] = remap[e.payload.from]!;
        const moved = { ...e, payload: { from, to } } as LabEvent;
        return from === "A.b" ? [moved, { ...e, payload: { from: "A.a", to: "R.a" } } as LabEvent] : [moved];
      }),
    );
    expect(codes("ohms-law", es)).toContain("ammeter-parallel");
  });
  it("Ohm's law: voltmeter in series", () => {
    const wires: [string, string][] = [["B.a", "S.a"], ["S.b", "Rh.a"], ["Rh.b", "V.a"], ["V.b", "A.a"], ["A.b", "R.a"], ["R.b", "B.b"]];
    const es = seqd([...wires.map(([a, b], i) => ev(1000 + i * 100, "equipment.connect", { from: a, to: b })), ev(3000, "param.set", { key: "switch", value: true })]);
    expect(codes("ohms-law", es)).toContain("voltmeter-series");
  });
  it("Ohm's law: a dead short stops the run", () => {
    const es = seqd([ev(1000, "equipment.connect", { from: "B.a", to: "S.a" }), ev(1100, "equipment.connect", { from: "S.b", to: "B.b" }), ev(1200, "param.set", { key: "switch", value: true })]);
    const r = run("ohms-law", es).report;
    expect(r.stoppedForSafety).toBe(true);
    expect(r.score).toBeLessThanOrEqual(40);
  });
  it("Ohm's law: leaving the current on between readings", () => {
    const es = edit("ohms-law", (es) => {
      const offs = es.map((e, i) => (e.type === "param.set" && e.payload.key === "switch" && e.payload.value === false ? i : -1)).filter((i) => i >= 0);
      return es.filter((_, i) => i !== offs[0]);
    });
    expect(codes("ohms-law", es)).toContain("left-on");
  });
  it("Ohm's law: a gradient that is not R", () => {
    const es = edit("ohms-law", (es) => es.map((e) => (e.type === "param.set" && e.payload.key === "result:R" ? ({ ...e, payload: { key: "result:R", value: 12 } } as LabEvent) : e)));
    expect(codes("ohms-law", es)).toContain("wrong-R");
  });
  it("Series and parallel: a misread ammeter", () => {
    const es = edit("series-and-parallel", (es) => es.map((e) => (e.type === "measure.read" ? ({ ...e, payload: { ...e.payload, reading: { key: "I", value: 0.5, unit: "A" } } } as LabEvent) : e)));
    expect(codes("series-and-parallel", es)).toContain("misread");
  });
  it("Projectile: tape misread", () => {
    const es = edit("projectile-motion", (es) => es.map((e) => (e.type === "measure.read" ? ({ ...e, payload: { ...e.payload, reading: { key: "range", value: 38, unit: "m" } } } as LabEvent) : e)));
    expect(codes("projectile-motion", es)).toContain("tape-misread");
  });
  it("Glass slab: P3 out of line with the images", () => {
    const es = edit("refraction-snells-law", (es) => {
      const i = es.findIndex((e) => e.type === "equipment.place" && e.payload.equipmentId === "P3");
      const p = es[i]!.payload as { x: number };
      es[i] = { ...es[i]!, payload: { ...es[i]!.payload, x: p.x + 4 } } as LabEvent;
      return es;
    });
    expect(codes("refraction-snells-law", es)).toContain("misaligned");
  });
  it("Pendulum: big swing, timing one swing, length to the top of the bob", () => {
    const es = edit("simple-pendulum", (es) => {
      es[0] = { ...es[0]!, payload: { key: "amplitude", value: 30 } } as LabEvent;
      const lIdx = es.findIndex((e) => e.type === "measure.read" && (e.payload as { instrument: string }).instrument === "metre-rule");
      es.splice(lIdx, 0, { ...es[lIdx]!, payload: { instrument: "metre-rule", reading: { key: "L", value: 0.3, unit: "m" } } } as LabEvent);
      const tIdx = es.findIndex((e) => e.type === "measure.read" && (e.payload as { instrument: string }).instrument === "stopwatch");
      es.splice(tIdx, 0, { ...es[tIdx]!, payload: { instrument: "stopwatch", reading: { key: "t:1", value: 1.11, unit: "s" } } } as LabEvent);
      return es;
    });
    const c = codes("simple-pendulum", es);
    expect(c).toContain("big-swing");
    expect(c).toContain("one-swing");
    expect(c).toContain("length-to-top");
  });
  it("Archimedes: cylinder placed while still dripping, sinker touching the bottom", () => {
    const es = edit("archimedes-principle", (es) => {
      const out = es.filter((e) => !(e.type === "param.set" && e.payload.key === "wait-drip"));
      const i = out.findIndex((e) => e.type === "param.set" && e.payload.key === "immerse");
      out.splice(i + 1, 0, { ...out[i]!, payload: { key: "touching", value: true } } as LabEvent);
      return out;
    });
    const c = codes("archimedes-principle", es);
    expect(c).toContain("extra-water");
    expect(c).toContain("touching");
  });
});

describe("new physics benches catch mistakes", () => {
  it("Newton's second law: no friction compensation, masses from the box, a wrong mass", () => {
    const es = edit("newtons-second-law", (es) => {
      const out = es.filter((e) => !(e.type === "param.set" && e.payload.key === "nudge"));
      const i = out.findIndex((e) => e.type === "param.set" && e.payload.value === "to-hanger");
      out[i] = { ...out[i]!, payload: { key: "move", value: "box-to-hanger" } } as LabEvent;
      return out.map((e) => (e.type === "param.set" && e.payload.key === "result:m" ? ({ ...e, payload: { key: "result:m", value: 1.6 } } as LabEvent) : e));
    });
    const c = codes("newtons-second-law", es);
    expect(c).toContain("friction");
    expect(c).toContain("mass-changed");
    expect(c).toContain("wrong-mass");
  });
  it("Specific heat: heating without insulation or a start temperature, and a wrong c", () => {
    const isThermo = (e: LabEvent) => e.type === "measure.read" && e.payload.instrument === "thermometer";
    const es = edit("specific-heat-capacity", (es) => {
      const first = es.findIndex(isThermo);
      return es
        .filter((e, i) => i !== first && !(e.type === "param.set" && e.payload.key === "insulate"))
        .map((e) => (e.type === "param.set" && e.payload.key === "result:c" ? ({ ...e, payload: { key: "result:c", value: 4200 } } as LabEvent) : e));
    });
    const c = codes("specific-heat-capacity", es);
    expect(c).toContain("no-insulation");
    expect(c).toContain("no-start-temp");
    expect(c).toContain("wrong-c");
  });
  it("Specific heat: switching the heater on outside the block stops the run", () => {
    const es = edit("specific-heat-capacity", (es) => es.filter((e) => !(e.type === "param.set" && e.payload.key === "heater-in")));
    expect(run("specific-heat-capacity", es).report.stoppedForSafety).toBe(true);
  });
});
