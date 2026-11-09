import type { RuleHit, SimModel, SimNote } from "../protocol/types";

/* ================================================================== Newton's second law */

/**
 * A trolley on a runway pulled by a hanging mass over a pulley. Two light gates time a card on
 * the trolley; the logger turns the card times into speeds and the speeds into an acceleration.
 * Slotted masses move between the trolley and the hanger, so the total accelerating mass stays
 * the same while the pulling force changes.
 */
export type NewtonSetup = {
  g: number;
  trolleyKg: number;
  hangerKg: number;
  slotKg: number;
  /** Slotted masses that start on the trolley. */
  slots: number;
  /** Spare masses in the box (adding these changes the total mass). */
  boxSlots: number;
  /** Rolling-friction coefficient of the trolley on the runway. */
  mu: number;
  cardM: number;
  startToGate1M: number;
  gateGapM: number;
};

export type NewtonRun = {
  /** Pulling force (weight of the hanger and its masses), N. */
  F: number;
  /** Total accelerating mass, kg. */
  M: number;
  /** True acceleration, m/s^2. */
  a: number;
  /** Card times through gate 1 and gate 2, s (as the logger shows them, to the ms). */
  t1: number;
  t2: number;
  /** Logger's acceleration from the rounded card times, m/s^2. */
  aLogger: number;
  compensated: boolean;
  massOk: boolean;
  t: number;
};

export type NewtonState = {
  tiltDeg: number;
  compensated: boolean;
  onTrolley: number;
  onHanger: number;
  inBox: number;
  runs: NewtonRun[];
  /** Valid measured points by force (key: F to 4 dp). */
  points: Record<string, { F: number; a: number }>;
  results: Record<string, number>;
};

/** Net slope term: positive means the runway alone would speed the trolley up. */
export function slopeResidual(tiltDeg: number, mu: number) {
  const th = (tiltDeg * Math.PI) / 180;
  return Math.sin(th) - mu * Math.cos(th);
}
const COMP_TOL = 0.0025;

export function newtonMasses(s: Pick<NewtonState, "onTrolley" | "onHanger">, setup: NewtonSetup) {
  const hang = setup.hangerKg + s.onHanger * setup.slotKg;
  const roll = setup.trolleyKg + s.onTrolley * setup.slotKg;
  return { hang, roll, total: hang + roll };
}

/** One run from rest: the light-gate card times and the logger's acceleration. */
export function newtonRun(s: Pick<NewtonState, "onTrolley" | "onHanger" | "tiltDeg">, setup: NewtonSetup) {
  const { hang, roll, total } = newtonMasses(s, setup);
  const F = hang * setup.g;
  const net = F + roll * setup.g * slopeResidual(s.tiltDeg, setup.mu);
  const a = Math.max(0, net / total);
  if (a <= 0) return { F, M: total, a: 0, t1: 0, t2: 0, aLogger: 0 };
  const v1 = Math.sqrt(2 * a * setup.startToGate1M);
  const v2 = Math.sqrt(2 * a * (setup.startToGate1M + setup.gateGapM));
  const t1 = Math.round((setup.cardM / v1) * 1000) / 1000;
  const t2 = Math.round((setup.cardM / v2) * 1000) / 1000;
  const u1 = setup.cardM / t1;
  const u2 = setup.cardM / t2;
  const aLogger = (u2 * u2 - u1 * u1) / (2 * setup.gateGapM);
  return { F, M: total, a, t1, t2, aLogger };
}

const fKey = (F: number) => F.toFixed(4);

export const newtonsSecondLaw: SimModel<NewtonState> = {
  slug: "newtons-second-law",
  init: (c) => {
    const setup = c.setup as unknown as NewtonSetup;
    return { tiltDeg: 0, compensated: false, onTrolley: setup.slots, onHanger: 0, inBox: setup.boxSlots, runs: [], points: {}, results: {} };
  },
  apply: (s0, e, ctx) => {
    const setup = ctx.content.setup as unknown as NewtonSetup;
    let s = s0;
    const hits: RuleHit[] = [];
    const notes: SimNote[] = [];
    const initialTotal = setup.trolleyKg + setup.hangerKg + setup.slots * setup.slotKg;
    if (e.type === "param.set") {
      const { key, value } = e.payload;
      if (key === "tilt") {
        const tiltDeg = Math.max(0, Math.min(3, Math.round(Number(value) * 10) / 10));
        s = { ...s, tiltDeg, compensated: s.compensated && Math.abs(slopeResidual(tiltDeg, setup.mu)) <= COMP_TOL };
      }
      if (key === "nudge") {
        const r = slopeResidual(s.tiltDeg, setup.mu);
        if (r < -COMP_TOL) notes.push({ text: "The trolley slows down and stops: friction is still winning. Raise the runway a little.", tone: "info" });
        else if (r > COMP_TOL) notes.push({ text: "The trolley speeds up on its own: the runway is too steep. Lower it a little.", tone: "warning" });
        else {
          notes.push({ text: "The trolley rolls at a steady speed: the slope exactly cancels friction.", tone: "success" });
          s = { ...s, compensated: true };
        }
      }
      if (key === "move") {
        const v = String(value);
        if (v === "to-hanger" && s.onTrolley > 0) s = { ...s, onTrolley: s.onTrolley - 1, onHanger: s.onHanger + 1 };
        if (v === "to-trolley" && s.onHanger > 0) s = { ...s, onTrolley: s.onTrolley + 1, onHanger: s.onHanger - 1 };
        if (v === "box-to-hanger" && s.inBox > 0) s = { ...s, inBox: s.inBox - 1, onHanger: s.onHanger + 1 };
        if (v === "hanger-to-box" && s.onHanger > 0) s = { ...s, inBox: s.inBox + 1, onHanger: s.onHanger - 1 };
      }
      if (key.startsWith("result:")) {
        const v = Number(value);
        s = { ...s, results: { ...s.results, [key.slice(7)]: v } };
        if (key === "result:m" && Math.abs(v - initialTotal) / initialTotal > 0.05)
          hits.push({ code: "wrong-mass", severity: "major", message: "The gradient of a against F is 1/m, so m = 1 ÷ gradient. That m is everything being accelerated: trolley, slotted masses and hanger.", tag: "conceptual", dimension: "measurement" });
      }
    }
    if (e.type === "sim.start") {
      const r = newtonRun(s, setup);
      const massOk = Math.abs(r.M - initialTotal) < 1e-9;
      if (!s.compensated) hits.push({ code: "friction", severity: "minor", message: "The runway was not friction-compensated, so part of the pull went into beating friction and every acceleration came out too small. Tilt the runway until a nudged trolley rolls at a steady speed.", tag: "procedural", dimension: "technique" });
      if (!massOk) hits.push({ code: "mass-changed", severity: "major", message: "The total mass changed because a mass came from the box. To test a ∝ F, move masses from the trolley to the hanger so the total mass stays the same.", tag: "conceptual", dimension: "technique" });
      if (r.a <= 0) notes.push({ text: "The trolley does not move.", tone: "warning" });
      else notes.push({ text: `Through the gates: card times ${r.t1.toFixed(3)} s and ${r.t2.toFixed(3)} s.`, tone: "info" });
      s = { ...s, runs: [...s.runs, { ...r, compensated: s.compensated, massOk, t: e.t }] };
    }
    if (e.type === "measure.read" && e.payload.instrument === "light-gates") {
      const last = s.runs[s.runs.length - 1];
      const v = e.payload.reading.value;
      if (!last || last.a <= 0) hits.push({ code: "nothing-to-read", severity: "minor", message: "Release the trolley first, then read the logger.", tag: "procedural", dimension: "sequence" });
      else if (Math.abs(v - last.aLogger) > Math.max(0.01, last.aLogger * 0.02)) hits.push({ code: "gate-misread", severity: "minor", message: `The logger gives a = ${last.aLogger.toFixed(3)} m/s². a = (v₂² − v₁²) ÷ 2s, with each v = card length ÷ card time.`, tag: "procedural", dimension: "measurement" });
      else if (last.compensated && last.massOk) {
        s = { ...s, points: { ...s.points, [fKey(last.F)]: { F: last.F, a: v } } };
        notes.push({ text: `F = ${last.F.toFixed(3)} N, a = ${v.toFixed(3)} m/s²`, tone: "success" });
      }
    }
    return { state: s, hits, notes };
  },
  steps: {
    compensate: (s) => s.compensated,
    "first-run": (s) => Object.keys(s.points).length >= 1,
    "five-forces": (s) => Object.keys(s.points).length >= 5,
    result: (s, ctx) => {
      const setup = ctx.content.setup as unknown as NewtonSetup;
      const total = setup.trolleyKg + setup.hangerKg + setup.slots * setup.slotKg;
      return s.results.m !== undefined && Math.abs(s.results.m - total) / total <= 0.05;
    },
  },
  readouts: (s) => {
    const last = s.runs[s.runs.length - 1];
    return { a: last?.aLogger ?? null, F: last?.F ?? null, points: Object.keys(s.points).length, tilt: s.tiltDeg };
  },
};

/** Least-squares gradient through the origin of a against F. */
export function gradientThroughOrigin(points: { x: number; y: number }[]): number | null {
  if (points.length < 2) return null;
  const sxy = points.reduce((a, p) => a + p.x * p.y, 0);
  const sxx = points.reduce((a, p) => a + p.x * p.x, 0);
  return sxx > 0 ? sxy / sxx : null;
}
