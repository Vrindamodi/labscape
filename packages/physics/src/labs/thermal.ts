import type { RuleHit, SimModel, SimNote } from "../protocol/types";

/* ================================================================== specific heat capacity */

/**
 * A 1 kg aluminium block with an immersion heater and a thermometer in two holes. The heater's
 * power is V x I; the block warms at (P - heat lost) / (m c) and loses heat to the room in
 * proportion to how far above room temperature it is. Insulation cuts that loss. The thermometer
 * lags behind the block, much less with a drop of oil in its hole. Time runs in simulated seconds:
 * the learner waits a minute at a time.
 */
export type HeatSetup = {
  massKg: number;
  /** True specific heat capacity of aluminium, J/(kg °C). */
  c: number;
  volts: number;
  amps: number;
  roomC: number;
  /** Heat-loss coefficient, W/°C. */
  kInsulated: number;
  kBare: number;
  /** Thermometer time constant, s. */
  tauOil: number;
  tauDry: number;
  /** Longest heating time the learner can run, s. */
  maxS: number;
};

export type HeatState = {
  /** Simulated time, s. */
  t: number;
  blockC: number;
  thermoC: number;
  heaterIn: boolean;
  thermoIn: boolean;
  oil: boolean;
  insulated: boolean;
  heaterOn: boolean;
  /** Seconds the heater has been on (inside the block). */
  onS: number;
  /** When the heater was first switched on, s. */
  onAt: number | null;
  readings: { t: number; T: number }[];
  meters: { V?: number; I?: number };
  results: Record<string, number>;
  burnt: boolean;
};

/** One-second steps: block heats and loses heat; thermometer follows with a lag. */
export function heatAdvance(s: HeatState, setup: HeatSetup, seconds: number): HeatState {
  let { blockC, thermoC, onS } = s;
  const k = s.insulated ? setup.kInsulated : setup.kBare;
  const tau = s.oil ? setup.tauOil : setup.tauDry;
  const n = Math.max(0, Math.round(seconds));
  const lag = 1 - Math.exp(-1 / tau);
  for (let i = 0; i < n; i++) {
    const p = s.heaterOn && s.heaterIn ? setup.volts * setup.amps : 0;
    blockC += (p - k * (blockC - setup.roomC)) / (setup.massKg * setup.c);
    thermoC += s.thermoIn ? (blockC - thermoC) * lag : (setup.roomC - thermoC) * lag;
    if (s.heaterOn && s.heaterIn) onS += 1;
  }
  return { ...s, t: s.t + n, blockC, thermoC, onS };
}

/** What the digital thermometer shows (0.1 °C). */
export const thermoShown = (s: HeatState) => Math.round(s.thermoC * 10) / 10;

export const specificHeat: SimModel<HeatState> = {
  slug: "specific-heat-capacity",
  init: (c) => {
    const setup = c.setup as unknown as HeatSetup;
    return { t: 0, blockC: setup.roomC, thermoC: setup.roomC, heaterIn: false, thermoIn: false, oil: false, insulated: false, heaterOn: false, onS: 0, onAt: null, readings: [], meters: {}, results: {}, burnt: false };
  },
  apply: (s0, e, ctx) => {
    const setup = ctx.content.setup as unknown as HeatSetup;
    let s = s0;
    const hits: RuleHit[] = [];
    const notes: SimNote[] = [];
    if (e.type === "param.set") {
      const { key, value } = e.payload;
      const on = !!value;
      if (key === "heater-in") s = { ...s, heaterIn: on };
      if (key === "thermo-in") s = { ...s, thermoIn: on };
      if (key === "oil") s = { ...s, oil: on };
      if (key === "insulate") {
        if (s.heaterOn && on !== s.insulated) notes.push({ text: "Changing the insulation halfway through changes the heat loss partway through the run.", tone: "warning" });
        s = { ...s, insulated: on };
      }
      if (key === "heater" && on !== s.heaterOn) {
        if (on) {
          if (!s.heaterIn) s = { ...s, burnt: true };
          if (!s.readings.some((r) => r.t === s.t)) hits.push({ code: "no-start-temp", severity: "minor", message: "Read the starting temperature before you switch the heater on: you need it to find the temperature rise.", tag: "procedural", dimension: "sequence" });
          if (!s.insulated) hits.push({ code: "no-insulation", severity: "minor", message: "Without insulation the block loses a lot of heat to the room, so it warms less and your value of c comes out too high.", tag: "procedural", dimension: "technique" });
          if (!s.oil || !s.thermoIn) hits.push({ code: "no-oil", severity: "minor", message: "Put the thermometer in its hole with a drop of oil. Air is a poor conductor, so a dry thermometer lags behind the block.", tag: "procedural", dimension: "measurement" });
          s = { ...s, heaterOn: true, onAt: s.onAt ?? s.t };
          notes.push({ text: `Heater on: ${setup.volts.toFixed(1)} V × ${setup.amps.toFixed(2)} A = ${(setup.volts * setup.amps).toFixed(1)} W.`, tone: "info" });
        } else {
          s = { ...s, heaterOn: false };
          notes.push({ text: `Heater off after ${s.onS} s. The block stays hot for a long time: do not touch it.`, tone: "warning" });
        }
      }
      if (key === "wait") {
        const secs = Math.max(0, Math.min(600, Number(value)));
        s = heatAdvance(s, setup, secs);
      }
      if (key.startsWith("result:")) {
        const v = Number(value);
        s = { ...s, results: { ...s.results, [key.slice(7)]: v } };
        if (key === "result:E") {
          const E = setup.volts * setup.amps * s.onS;
          if (Math.abs(v - E) / Math.max(E, 1) > 0.02) hits.push({ code: "wrong-energy", severity: "major", message: "Energy = V × I × t, with t in seconds (10 minutes = 600 s).", tag: "conceptual", dimension: "measurement" });
        }
        if (key === "result:c") {
          const expect = cFromReadings(s, setup);
          if (expect === null || Math.abs(v - expect) / expect > 0.05) hits.push({ code: "wrong-c", severity: "major", message: "c = E ÷ (m × Δθ). Δθ is your final temperature minus your starting temperature, and m = 1.0 kg.", tag: "conceptual", dimension: "measurement" });
        }
      }
    }
    if (e.type === "measure.read") {
      const { key, value } = e.payload.reading;
      if (e.payload.instrument === "thermometer" && key === "T") {
        const shown = thermoShown(s);
        if (!s.thermoIn) hits.push({ code: "thermo-out", severity: "minor", message: "The thermometer is not in the block, so it reads the room.", tag: "procedural", dimension: "measurement" });
        else if (Math.abs(value - shown) > 0.15) hits.push({ code: "thermo-misread", severity: "minor", message: `The thermometer shows ${shown.toFixed(1)} °C.`, tag: "procedural", dimension: "measurement" });
        else {
          s = { ...s, readings: [...s.readings.filter((r) => r.t !== s.t), { t: s.t, T: value }] };
          notes.push({ text: `${(s.t / 60).toFixed(0)} min: ${value.toFixed(1)} °C`, tone: "success" });
        }
      }
      if ((e.payload.instrument === "voltmeter" || e.payload.instrument === "ammeter") && !(s.heaterOn && s.heaterIn)) {
        hits.push({ code: "meter-off", severity: "minor", message: "Switch the heater on first: with no current flowing both meters read zero.", tag: "procedural", dimension: "sequence" });
      } else if (e.payload.instrument === "voltmeter" && key === "V") {
        if (Math.abs(value - setup.volts) > 0.05) hits.push({ code: "meter-misread", severity: "minor", message: `The voltmeter reads ${setup.volts.toFixed(1)} V.`, tag: "procedural", dimension: "measurement" });
        else s = { ...s, meters: { ...s.meters, V: value } };
      } else if (e.payload.instrument === "ammeter" && key === "I") {
        if (Math.abs(value - setup.amps) > 0.01) hits.push({ code: "meter-misread", severity: "minor", message: `The ammeter reads ${setup.amps.toFixed(2)} A.`, tag: "procedural", dimension: "measurement" });
        else s = { ...s, meters: { ...s.meters, I: value } };
      }
    }
    return { state: s, hits, notes };
  },
  steps: {
    setup: (s) => s.heaterIn && s.thermoIn && s.oil && s.insulated,
    start: (s) => s.heaterOn && s.onAt !== null && s.readings.some((r) => r.t === s.onAt),
    meters: (s) => s.meters.V !== undefined && s.meters.I !== undefined,
    readings: (s) => s.onAt !== null && minuteReadings(s).length >= 10,
    off: (s) => !s.heaterOn && s.onS >= 600,
    energy: (s, ctx) => {
      const setup = ctx.content.setup as unknown as HeatSetup;
      const E = setup.volts * setup.amps * s.onS;
      return s.results.E !== undefined && Math.abs(s.results.E - E) / Math.max(E, 1) <= 0.02;
    },
    result: (s, ctx) => {
      const expect = cFromReadings(s, ctx.content.setup as unknown as HeatSetup);
      return s.results.c !== undefined && expect !== null && Math.abs(s.results.c - expect) / expect <= 0.05;
    },
  },
  safety: (s) => (s.burnt ? { code: "heater-in-air", title: "Heater switched on outside the block", message: "An immersion heater switched on in air has nothing to pass its heat to: it gets hot enough to burn skin and the bench, and can crack. Always put it in the block first, and switch off before taking it out." } : null),
  readouts: (s) => ({ t: s.t, thermo: thermoShown(s), onS: s.onS, readings: s.readings.length }),
};

/** Readings taken at whole minutes after switch-on (not counting the start). */
export function minuteReadings(s: HeatState) {
  if (s.onAt === null) return [];
  return s.readings.filter((r) => r.t > s.onAt! && (r.t - s.onAt!) % 60 === 0 && r.t - s.onAt! <= 600);
}

/** c from the learner's own readings: E = VIt over the heating time, Δθ = last minus first. */
export function cFromReadings(s: HeatState, setup: HeatSetup): number | null {
  if (s.onAt === null) return null;
  const start = s.readings.find((r) => r.t === s.onAt);
  const mins = minuteReadings(s);
  const end = mins.reduce<{ t: number; T: number } | null>((a, r) => (!a || r.t > a.t ? r : a), null);
  if (!start || !end || end.T <= start.T) return null;
  const E = setup.volts * setup.amps * (end.t - s.onAt);
  return E / (setup.massKg * (end.T - start.T));
}
