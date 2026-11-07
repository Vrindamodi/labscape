// One-off: fills the null measured values in the golden runs from the models, then deletes itself from use.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { it } from "vitest";
import type { LabEvent } from "@labscape/contracts";
import { circuitNow, fitR, gFromPeriods, meterValue, PHYSICS_CONTENT, PHYSICS_MODELS, type CircuitState, type ProjectileState, type PendulumState, type ArchimedesState } from "@labscape/physics/labs";
import { buoyancy, pendulumPeriod, SINKERS } from "@labscape/physics/core";
import { SimEvaluator, simGoldenEvents, type SimContent } from "@labscape/physics/protocol";
import { MATHS_CONTENT, MATHS_MODELS, type ProbState } from "./labs";

const r2 = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

function truth(slug: string, st: unknown, e: LabEvent, c: SimContent): number | null {
  const p = e.payload as Record<string, unknown>;
  if (slug === "ohms-law") {
    const s = st as CircuitState;
    if (e.type === "measure.read") return meterValue(circuitNow(s, "R"), p.instrument === "ammeter" ? "A" : "V", p.instrument as "ammeter" | "voltmeter");
    if (p.key === "result:R") return r2(fitR(s.readings)!);
  }
  if (slug === "series-and-parallel" && e.type === "measure.read") return meterValue(circuitNow(st as CircuitState), "A", "ammeter");
  if (slug === "projectile-motion" && e.type === "measure.read") {
    const s = st as ProjectileState;
    return r2(s.launches[s.launches.length - 1]!.range);
  }
  if (slug === "simple-pendulum") {
    const s = st as PendulumState;
    const setup = c.setup as { g: number; bobRadiusM: number };
    const L = s.stringM + setup.bobRadiusM;
    if (e.type === "measure.read" && p.instrument === "metre-rule") return r2(L, 3);
    if (e.type === "measure.read") return r2(20 * pendulumPeriod(L, s.amplitude, setup.g));
    if (p.key === "result:g") return r2(gFromPeriods(Object.entries(s.periods).map(([k, T]) => ({ L: Number(k) + setup.bobRadiusM, T })))!);
  }
  if (slug === "archimedes-principle") {
    const s = st as ArchimedesState;
    const setup = c.setup as { sinker: string; g: number };
    const b = buoyancy(SINKERS.find((x) => x.id === setup.sinker)!, s.immersed, setup.g);
    const key = e.type === "measure.read" ? (p.reading as { key: string }).key : p.key;
    if (key === "air") return r2(b.weightN);
    if (key === "water") return r2(b.readingN);
    if (key === "volume") return r2(b.displacedMl, 0);
    if (key === "result:upthrust") return r2(s.readings.air! - s.readings.water!);
    if (key === "result:displaced") return r2((s.readings.volume! / 1000) * setup.g);
  }
  if (slug === "dice-probability") {
    const s = st as ProbState;
    const last = [...s.runs].reverse().find((r) => r.kind === "coin")!;
    return r2((last.counts[1] ?? 0) / last.n, 3);
  }
  return null;
}

it("fills golden runs", () => {
  const all = [...Object.values(PHYSICS_CONTENT).map((c) => [c, PHYSICS_MODELS[c.slug]] as const), ...Object.values(MATHS_CONTENT).map((c) => [c, MATHS_MODELS[c.slug]] as const)];
  for (const [c, model] of all) {
    const ev = new SimEvaluator(c, model!);
    const events = simGoldenEvents(c);
    events.forEach((e, i) => {
      const p = e.payload as Record<string, unknown>;
      const isNull = e.type === "measure.read" ? (p.reading as { value: unknown }).value === null : p.value === null;
      if (isNull) {
        const v = truth(c.slug, ev.state, e, c);
        if (v === null) throw new Error(`No truth for ${c.slug} event ${i}`);
        if (e.type === "measure.read") (p.reading as { value: number }).value = v;
        else p.value = v;
        if (e.type === "measure.read") ((c.golden.events[i]!.payload as { reading: { value: number } }).reading.value = v);
        else (c.golden.events[i]!.payload as { value: number }).value = v;
      }
      ev.push(e);
    });
    const rep = ev.report();
    console.log(c.slug, rep.score, rep.stars, rep.deviations.map((d) => d.code).join(","), rep.steps.filter((s) => !s.done).map((s) => s.id).join(","));
    writeFileSync(resolve(__dirname, `../../../content/experiments/${c.slug}.json`), JSON.stringify(c, null, 2) + "\n");
  }
});
