import { buoyancy, idealFlight, pendulumPeriod, PLANETS, simulateFlight, SINKERS, type Planet } from "../core/mechanics";
import type { RuleHit, SimModel, SimNote } from "../protocol/types";

/* ================================================================== projectile motion */

export type ProjectileSetup = { targetM: number; targetTolM: number };
export type LaunchRecord = { speed: number; angle: number; planet: Planet; drag: boolean; range: number; maxHeight: number; time: number; t: number };
export type ProjectileState = { speed: number; angle: number; planet: Planet; drag: boolean; launches: LaunchRecord[]; measured: number[]; results: Record<string, number> };

export function flightOf(speed: number, angle: number, planet: Planet, drag: boolean) {
  const g = PLANETS[planet].g;
  if (!drag) {
    const a = idealFlight({ speed, angleDeg: angle, g });
    return { range: a.range, maxHeight: a.maxHeight, time: a.time };
  }
  const s = simulateFlight({ speed, angleDeg: angle, g, drag: true });
  return { range: s.range, maxHeight: s.maxHeight, time: s.time };
}

export const projectile: SimModel<ProjectileState> = {
  slug: "projectile-motion",
  init: () => ({ speed: 15, angle: 30, planet: "earth", drag: false, launches: [], measured: [], results: {} }),
  apply: (s0, e) => {
    let s = s0;
    const hits: RuleHit[] = [];
    const notes: SimNote[] = [];
    if (e.type === "param.set") {
      const { key, value } = e.payload;
      if (key === "speed") s = { ...s, speed: Math.max(1, Math.min(40, Number(value))) };
      if (key === "angle") s = { ...s, angle: Math.max(1, Math.min(89, Number(value))) };
      if (key === "planet" && typeof value === "string" && value in PLANETS) s = { ...s, planet: value as Planet };
      if (key === "drag") s = { ...s, drag: !!value };
      if (key.startsWith("result:")) s = { ...s, results: { ...s.results, [key.slice(7)]: Number(value) } };
    }
    if (e.type === "sim.start") {
      const f = flightOf(s.speed, s.angle, s.planet, s.drag);
      s = { ...s, launches: [...s.launches, { speed: s.speed, angle: s.angle, planet: s.planet, drag: s.drag, ...f, t: e.t }] };
      notes.push({ text: `Landed ${f.range.toFixed(2)} m away after ${f.time.toFixed(2)} s.`, tone: "info" });
    }
    if (e.type === "measure.read" && e.payload.instrument === "tape") {
      const last = s.launches[s.launches.length - 1];
      if (!last) hits.push({ code: "nothing-to-measure", severity: "minor", message: "Launch first, then measure where it landed.", tag: "procedural", dimension: "sequence" });
      else if (Math.abs(e.payload.reading.value - last.range) > Math.max(0.05, last.range * 0.005)) hits.push({ code: "tape-misread", severity: "minor", message: `The landing mark is at ${last.range.toFixed(2)} m. Read the tape from the launch point to the centre of the mark.`, tag: "procedural", dimension: "measurement" });
      else s = { ...s, measured: [...s.measured, s.launches.length - 1] };
    }
    return { state: s, hits, notes };
  },
  steps: {
    "first-launch": (s) => s.launches.some((l) => l.angle === 45 && l.planet === "earth" && !l.drag),
    measure: (s) => s.measured.length > 0,
    complementary: (s) => {
      const ideal = s.launches.filter((l) => !l.drag && l.planet === "earth" && Math.abs(l.angle - 45) > 2);
      return ideal.some((a) => ideal.some((b) => a !== b && Math.abs(a.angle + b.angle - 90) < 0.6 && Math.abs(a.speed - b.speed) < 1e-9));
    },
    target: (s, ctx) => {
      const t = ctx.content.setup as unknown as ProjectileSetup;
      return s.launches.some((l) => !l.drag && l.planet === "earth" && Math.abs(l.range - t.targetM) <= t.targetTolM);
    },
    air: (s) => s.launches.some((l) => l.drag && s.launches.some((m) => !m.drag && m.speed === l.speed && m.angle === l.angle && m.planet === l.planet)),
    moon: (s) => s.launches.some((l) => l.planet === "moon"),
  },
  readouts: (s) => {
    const last = s.launches[s.launches.length - 1];
    return { range: last?.range ?? null, maxHeight: last?.maxHeight ?? null, time: last?.time ?? null, launches: s.launches.length };
  },
};

/* ================================================================== simple pendulum */

export type PendulumSetup = { g: number; bobRadiusM: number };
export type PendulumState = {
  stringM: number;
  amplitude: number;
  released: boolean;
  /** Lengths the student measured, by string length. */
  measuredL: Record<string, number>;
  /** Valid timings: string length -> period. */
  periods: Record<string, number>;
  results: Record<string, number>;
};

const lkey = (m: number) => m.toFixed(3);

export const pendulum: SimModel<PendulumState> = {
  slug: "simple-pendulum",
  init: () => ({ stringM: 0.5, amplitude: 25, released: false, measuredL: {}, periods: {}, results: {} }),
  apply: (s0, e, ctx) => {
    const setup = ctx.content.setup as unknown as PendulumSetup;
    let s = s0;
    const hits: RuleHit[] = [];
    const notes: SimNote[] = [];
    const L = () => s.stringM + setup.bobRadiusM;
    if (e.type === "param.set") {
      const { key, value } = e.payload;
      if (key === "length") s = { ...s, stringM: Math.max(0.1, Math.min(1.5, Number(value))), released: false };
      if (key === "amplitude") s = { ...s, amplitude: Math.max(1, Math.min(60, Number(value))), released: false };
      if (key.startsWith("result:")) {
        s = { ...s, results: { ...s.results, [key.slice(7)]: Number(value) } };
        if (key === "result:g" && Math.abs(Number(value) - setup.g) / setup.g > 0.03) hits.push({ code: "wrong-g", severity: "major", message: "That value of g is more than 3 % out. Plot T² against L: the gradient is 4π²/g, so g = 4π² / gradient.", tag: "conceptual", dimension: "measurement" });
      }
    }
    if (e.type === "sim.start") {
      s = { ...s, released: true };
      if (s.amplitude > 10) hits.push({ code: "big-swing", severity: "minor", message: "Released from more than 10°. Above that the period grows with amplitude, so T = 2π√(L/g) no longer holds well.", tag: "procedural", dimension: "technique" });
    }
    if (e.type === "sim.reset") s = { ...s, released: false };
    if (e.type === "measure.read") {
      const { key, value } = e.payload.reading;
      if (e.payload.instrument === "metre-rule") {
        if (Math.abs(value - L()) <= 0.002) s = { ...s, measuredL: { ...s.measuredL, [lkey(s.stringM)]: value } };
        else if (Math.abs(value - s.stringM) <= 0.002) hits.push({ code: "length-to-top", severity: "minor", message: "That is the string only. The length of a pendulum runs from the pivot to the centre of the bob, so add the bob's radius.", tag: "conceptual", dimension: "measurement" });
        else hits.push({ code: "length-misread", severity: "minor", message: "That length does not match the rule. Read it at eye level.", tag: "procedural", dimension: "measurement" });
      }
      if (e.payload.instrument === "stopwatch" && key.startsWith("t:")) {
        const n = Number(key.slice(2));
        const truth = pendulumPeriod(L(), s.amplitude, setup.g);
        if (!s.released) hits.push({ code: "not-swinging", severity: "minor", message: "Release the bob before you start timing.", tag: "procedural", dimension: "sequence" });
        else {
          if (n < 10) hits.push({ code: "one-swing", severity: "minor", message: "Timing one or a few swings makes your reaction time a large part of the result. Time 20 oscillations and divide by 20.", tag: "procedural", dimension: "technique" });
          const T = value / n;
          if (Math.abs(T - truth) / truth > 0.02) hits.push({ code: "timing-off", severity: "minor", message: `That timing gives T = ${T.toFixed(3)} s, but this pendulum's period is ${truth.toFixed(3)} s. Start and stop the watch as the bob passes the centre.`, tag: "procedural", dimension: "measurement" });
          else if (n >= 20) {
            s = { ...s, periods: { ...s.periods, [lkey(s.stringM)]: T } };
            notes.push({ text: `T = ${T.toFixed(3)} s for L = ${L().toFixed(3)} m`, tone: "success" });
          }
        }
      }
    }
    return { state: s, hits, notes };
  },
  steps: {
    "measure-L": (s) => Object.keys(s.measuredL).length > 0,
    release: (s) => s.released && s.amplitude <= 10,
    "time-20": (s) => Object.keys(s.periods).length > 0,
    "five-lengths": (s) => Object.keys(s.periods).filter((k) => k in s.measuredL).length >= 5,
    result: (s, ctx) => s.results.g !== undefined && Math.abs(s.results.g - (ctx.content.setup as unknown as PendulumSetup).g) / 9.81 <= 0.03,
  },
  readouts: (s) => ({ lengths: Object.keys(s.periods).length, amplitude: s.amplitude, stringM: s.stringM }),
};

/** g from a least-squares fit of T^2 = (4 pi^2 / g) L through the origin. */
export function gFromPeriods(points: { L: number; T: number }[]): number | null {
  if (points.length < 2) return null;
  const sxy = points.reduce((a, p) => a + p.L * p.T * p.T, 0);
  const sxx = points.reduce((a, p) => a + p.L * p.L, 0);
  return (4 * Math.PI * Math.PI) / (sxy / sxx);
}

/* ================================================================== Archimedes */

export type ArchimedesSetup = { sinker: string; g: number; dripMl: number };
export type ArchimedesState = {
  canFull: boolean;
  dripStopped: boolean;
  cylinderPlaced: boolean;
  /** Water collected that did not come from the sinker. */
  extraMl: number;
  immersed: number;
  touching: boolean;
  readings: Record<string, number>;
  results: Record<string, number>;
};

export const archimedes: SimModel<ArchimedesState> = {
  slug: "archimedes-principle",
  init: () => ({ canFull: false, dripStopped: false, cylinderPlaced: false, extraMl: 0, immersed: 0, touching: false, readings: {}, results: {} }),
  apply: (s0, e, ctx) => {
    const setup = ctx.content.setup as unknown as ArchimedesSetup;
    const sinker = SINKERS.find((x) => x.id === setup.sinker) ?? SINKERS[0]!;
    let s = s0;
    const hits: RuleHit[] = [];
    const notes: SimNote[] = [];
    const truth = () => buoyancy(sinker, s.immersed, setup.g);
    const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
    if (e.type === "param.set") {
      const { key, value } = e.payload;
      if (key === "fill-can") s = { ...s, canFull: true, dripStopped: false };
      if (key === "wait-drip") s = { ...s, dripStopped: s.canFull };
      if (key === "cylinder") {
        s = { ...s, cylinderPlaced: !!value };
        if (value && s.canFull && !s.dripStopped) {
          s = { ...s, extraMl: setup.dripMl };
          hits.push({ code: "extra-water", severity: "minor", message: "The can was still dripping when you put the cylinder under the spout, so it caught water the sinker never displaced. Wait for the last drip first.", tag: "procedural", dimension: "measurement" });
        }
        if (value && !s.canFull) hits.push({ code: "can-not-full", severity: "major", message: "The overflow can was not filled to the spout first, so the first water the sinker displaces stays in the can.", tag: "procedural", dimension: "sequence" });
      }
      if (key === "immerse") {
        const f = Math.max(0, Math.min(1, Number(value)));
        if (f > 0 && !s.cylinderPlaced) hits.push({ code: "no-cylinder", severity: "major", message: "The sinker went in before the measuring cylinder was under the spout, so the displaced water was lost.", tag: "procedural", dimension: "sequence" });
        s = { ...s, immersed: f };
      }
      if (key === "touching") {
        s = { ...s, touching: !!value };
      }
      if (key.startsWith("result:")) s = { ...s, results: { ...s.results, [key.slice(7)]: Number(value) } };
    }
    if (e.type === "measure.read") {
      const { key, value } = e.payload.reading;
      if (key === "air") {
        if (s.immersed > 0) hits.push({ code: "air-wet", severity: "minor", message: "Weigh it in air before it goes in the water.", tag: "procedural", dimension: "sequence" });
        if (near(value, truth().weightN, 0.02)) s = { ...s, readings: { ...s.readings, air: value } };
        else hits.push({ code: "balance-misread", severity: "minor", message: `The spring balance reads ${truth().weightN.toFixed(2)} N.`, tag: "procedural", dimension: "measurement" });
      }
      if (key === "water") {
        if (s.touching) hits.push({ code: "touching", severity: "major", message: "The sinker was resting on the bottom of the can, which holds some of its weight. The reading is too low. Lift it until it hangs freely.", tag: "procedural", dimension: "technique" });
        if (s.immersed < 1) hits.push({ code: "partial", severity: "major", message: "The sinker was only partly under water, so the upthrust was smaller. Lower it until it is completely covered.", tag: "procedural", dimension: "technique" });
        const shown = truth().readingN - (s.touching ? truth().readingN * 0.5 : 0);
        if (!near(value, shown, 0.02)) hits.push({ code: "balance-misread", severity: "minor", message: `The spring balance reads ${shown.toFixed(2)} N.`, tag: "procedural", dimension: "measurement" });
        else if (!s.touching && s.immersed >= 1) s = { ...s, readings: { ...s.readings, water: value } };
      }
      if (key === "volume") {
        const shown = truth().displacedMl * (s.cylinderPlaced ? 1 : 0) + s.extraMl;
        if (!near(value, shown, 1)) hits.push({ code: "cylinder-misread", severity: "minor", message: `The cylinder holds ${shown.toFixed(0)} mL. Read the bottom of the meniscus.`, tag: "procedural", dimension: "measurement" });
        else s = { ...s, readings: { ...s.readings, volume: value } };
      }
    }
    if (e.type === "param.set" && e.payload.key === "result:upthrust") {
      const ok = s.readings.air !== undefined && s.readings.water !== undefined && near(Number(e.payload.value), s.readings.air - s.readings.water, 0.03);
      if (!ok) hits.push({ code: "wrong-upthrust", severity: "major", message: "Upthrust = weight in air − weight in water.", tag: "conceptual", dimension: "measurement" });
      else notes.push({ text: "Upthrust found.", tone: "success" });
    }
    if (e.type === "param.set" && e.payload.key === "result:displaced") {
      const expect = ((s.readings.volume ?? 0) / 1000) * setup.g; // 1 mL of water has a mass of 1 g
      if (!near(Number(e.payload.value), expect, 0.03)) hits.push({ code: "wrong-displaced", severity: "major", message: "Weight of water = mass × g, and 1 mL of water has a mass of 1 g (0.001 kg).", tag: "conceptual", dimension: "measurement" });
    }
    return { state: s, hits, notes };
  },
  steps: {
    "weigh-air": (s) => s.readings.air !== undefined,
    "fill-can": (s) => s.canFull && s.dripStopped,
    cylinder: (s) => s.cylinderPlaced,
    immerse: (s) => s.immersed >= 1 && !s.touching,
    "weigh-water": (s) => s.readings.water !== undefined,
    volume: (s) => s.readings.volume !== undefined,
    compare: (s, ctx) => {
      const g = (ctx.content.setup as unknown as ArchimedesSetup).g;
      return s.readings.air !== undefined && s.readings.water !== undefined && s.results.upthrust !== undefined && s.results.displaced !== undefined && Math.abs(s.results.upthrust - (s.readings.air - s.readings.water)) <= 0.03 && Math.abs(s.results.displaced - ((s.readings.volume ?? 0) / 1000) * g) <= 0.03;
    },
  },
  readouts: (s) => ({ immersed: s.immersed, cylinder: s.cylinderPlaced }),
};
