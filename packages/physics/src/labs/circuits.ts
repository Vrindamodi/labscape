import type { LabEvent } from "@labscape/contracts";
import { heatStep, hotResistance, HEAT, solve, type CircuitResult, type Component, type Wire } from "../core/circuit";
import type { RuleHit, SimModel, SimNote } from "../protocol/types";

/** What the circuit labs share: parts on the board, wires between terminals, switch and rheostat. */
export type CircuitSetup = { parts: Component[]; unknownId?: string };

export type CircuitState = {
  parts: Component[];
  wires: Wire[];
  /** Bulbs unscrewed from their holders. */
  removed: string[];
  tempC: number;
  lastT: number;
  /** Seconds the switch has been closed, in total. */
  onS: number;
  readings: { V: number | null; I: number | null; rheo: number; t: number; config: string }[];
  /** A reading pair being assembled (voltmeter and ammeter read separately). */
  pending: { V: number | null; I: number | null };
  /** The switch was opened since the last complete reading. */
  offSinceReading: boolean;
  results: Record<string, number | string>;
  /** Configurations seen with the switch closed: "series" / "parallel". */
  seen: string[];
  /** Ammeter readings by configuration. */
  ammeter: Record<string, number>;
  litWhileOneRemoved: boolean;
};

export const switchOf = (s: CircuitState) => s.parts.find((p) => p.kind === "switch");
export const isClosed = (s: CircuitState) => !!switchOf(s)?.closed;

/** The circuit as it is now: resistor warmed by its history, unscrewed bulbs left out. */
export function circuitNow(s: CircuitState, unknownId?: string): CircuitResult {
  const parts = s.parts.filter((p) => !s.removed.includes(p.id)).map((p) => (p.id === unknownId ? { ...p, value: hotResistance(p.value ?? 10, s.tempC) } : p));
  // An unscrewed bulb leaves its holder: the wires joined at its terminals stay joined to each other.
  return solve(parts, s.wires);
}

/** Same circuit with the switch forced closed: is it wired right before the student closes it? */
export function circuitIfClosed(s: CircuitState, unknownId?: string): CircuitResult {
  return circuitNow({ ...s, parts: s.parts.map((p) => (p.kind === "switch" ? { ...p, closed: true } : p)) }, unknownId);
}

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function wire(s: CircuitState, e: Extract<LabEvent, { type: "equipment.connect" }>): CircuitState {
  const { from, to, port } = e.payload;
  if (port === "remove") return { ...s, wires: s.wires.filter(([a, b]) => key(a, b) !== key(from, to)) };
  if (from === to || s.wires.some(([a, b]) => key(a, b) === key(from, to))) return s;
  return { ...s, wires: [...s.wires, [from, to]] };
}

/** Advances resistor heating to time t (ms) using the current that flowed since the last event. */
function warm(s: CircuitState, t: number, unknownId?: string): CircuitState {
  const dt = Math.max(0, (t - s.lastT) / 1000);
  if (!unknownId || dt === 0) return { ...s, lastT: t, onS: s.onS + (isClosed(s) ? dt : 0) };
  const p = isClosed(s) ? Math.abs(circuitNow(s, unknownId).components[unknownId]?.power ?? 0) : 0;
  // integrate in 1 s slices so the power tracks the warming resistance
  let temp = s.tempC;
  for (let left = dt; left > 0; left -= 1) temp = heatStep(temp, p, Math.min(1, left));
  return { ...s, tempC: temp, lastT: t, onS: s.onS + (isClosed(s) ? dt : 0) };
}

/** True value a meter shows, rounded to its resolution. */
export function meterValue(r: CircuitResult, id: string, kind: "ammeter" | "voltmeter"): number {
  const c = r.components[id];
  if (!c) return 0;
  const raw = kind === "ammeter" ? Math.abs(c.current) : Math.abs(c.voltage);
  return kind === "ammeter" ? Math.round(raw * 1000) / 1000 : Math.round(raw * 100) / 100;
}

/** Shared event handling; each lab adds its own checks on top. */
export function circuitApply(s0: CircuitState, e: LabEvent, unknownId?: string): { state: CircuitState; notes: SimNote[]; hits: RuleHit[] } {
  let s = warm(s0, e.t, unknownId);
  const notes: SimNote[] = [];
  const hits: RuleHit[] = [];
  if (e.type === "equipment.connect") s = wire(s, e);
  if (e.type === "param.set") {
    const { key: k, value } = e.payload;
    if (k === "switch") {
      const closing = !!value && !isClosed(s);
      s = { ...s, parts: s.parts.map((p) => (p.kind === "switch" ? { ...p, closed: !!value } : p)) };
      if (!value) s = { ...s, offSinceReading: true };
      if (closing) {
        const r = circuitNow(s, unknownId);
        if (r.ammeterAcross.length) hits.push({ code: "ammeter-parallel", severity: "major", message: "The ammeter was wired across a component. An ammeter has almost no resistance, so in parallel it is a near short circuit. It always goes in series.", tag: "conceptual", dimension: "equipment" });
        if (r.voltmeterInSeries.length) hits.push({ code: "voltmeter-series", severity: "major", message: "The voltmeter was in series. Its huge resistance blocks the current, so nothing works. A voltmeter always goes across (in parallel with) the component.", tag: "conceptual", dimension: "equipment" });
        if (r.shorted.length) notes.push({ text: "Short circuit! The wires are getting hot. Open the switch now.", tone: "danger" });
        else if (r.open) notes.push({ text: "Nothing happens: the circuit is not a complete loop.", tone: "warning" });
      }
    }
    if (k === "rheostat") s = { ...s, parts: s.parts.map((p) => (p.kind === "rheostat" ? { ...p, setting: Math.max(0, Math.min(1, Number(value))) } : p)) };
    if (k.startsWith("bulb:")) {
      const id = k.slice(5);
      s = { ...s, removed: value === "out" ? [...new Set([...s.removed, id])] : s.removed.filter((x) => x !== id) };
    }
    if (k.startsWith("result:")) s = { ...s, results: { ...s.results, [k.slice(7)]: typeof value === "boolean" ? String(value) : value } };
  }
  if (unknownId && s.tempC > 35 && s0.tempC <= 35) {
    notes.push({ text: "The resistor is getting warm, and its resistance is creeping up.", tone: "warning" });
    hits.push({ code: "resistor-hot", severity: "minor", message: "Current was left flowing so long that the resistor heated up and its resistance rose, which skews your readings. Switch off between readings.", tag: "procedural", dimension: "technique" });
  }
  return { state: s, notes, hits };
}

export function initCircuit(setup: CircuitSetup): CircuitState {
  return { parts: setup.parts.map((p) => ({ ...p })), wires: [], removed: [], tempC: HEAT.roomC, lastT: 0, onS: 0, readings: [], pending: { V: null, I: null }, offSinceReading: true, results: {}, seen: [], ammeter: {}, litWhileOneRemoved: false };
}

/* ================================================================== Ohm's law */

const R_ID = "R";

/** Correct Ohm's-law wiring: ammeter carries the resistor current, voltmeter reads across it. */
export function ohmsWiringOk(s: CircuitState): boolean {
  const r = circuitIfClosed(s, R_ID);
  const res = r.components[R_ID];
  const am = r.components.A;
  const vm = r.components.V;
  if (!res || !am || !vm || r.shorted.length || r.ammeterAcross.length || r.voltmeterInSeries.length) return false;
  const rheo = s.parts.find((p) => p.kind === "rheostat");
  return Math.abs(res.current) > 1e-3 && Math.abs(Math.abs(am.current) - Math.abs(res.current)) < 1e-6 && Math.abs(Math.abs(vm.voltage) - Math.abs(res.voltage)) < 1e-4 && (!rheo || Math.abs(r.components[rheo.id]?.current ?? 0) > 1e-3);
}

/** Best-fit gradient of V against I through the origin. */
export function fitR(readings: { V: number | null; I: number | null }[]): number | null {
  const pts = readings.filter((r) => r.V !== null && r.I !== null && r.I > 0);
  if (pts.length < 2) return null;
  const sxy = pts.reduce((a, p) => a + p.V! * p.I!, 0);
  const sxx = pts.reduce((a, p) => a + p.I! * p.I!, 0);
  return sxy / sxx;
}

export const ohmsLaw: SimModel<CircuitState> = {
  slug: "ohms-law",
  init: (c) => initCircuit(c.setup as unknown as CircuitSetup),
  apply: (s0, e) => {
    const out = circuitApply(s0, e, R_ID);
    let s = out.state;
    if (e.type === "param.set" && e.payload.key === "switch" && e.payload.value && !ohmsWiringOk(s0) && !out.hits.length && !circuitNow(s, R_ID).shorted.length)
      out.hits.push({ code: "closed-too-early", severity: "order", message: "The switch was closed before the circuit was wired correctly. Build it with the switch open and check it first.", tag: "procedural", dimension: "sequence" });
    if (e.type === "measure.read") {
      const inst = e.payload.instrument as "ammeter" | "voltmeter";
      const r = circuitNow(s, R_ID);
      const truth = meterValue(r, inst === "ammeter" ? "A" : "V", inst);
      const read = e.payload.reading.value;
      if (!isClosed(s)) out.hits.push({ code: "read-while-off", severity: "minor", message: "That reading was taken with the switch open, so no current was flowing.", tag: "procedural", dimension: "measurement" });
      if (Math.abs(read - truth) > (inst === "ammeter" ? 0.002 : 0.02) + Math.abs(truth) * 0.01) out.hits.push({ code: "misread", severity: "minor", message: `That reading does not match the meter (it shows ${truth}). Read the scale again at eye level.`, tag: "procedural", dimension: "measurement" });
      const pending = { ...s.pending, [inst === "ammeter" ? "I" : "V"]: read };
      s = { ...s, pending };
      if (pending.V !== null && pending.I !== null) {
        if (!s.offSinceReading && s.readings.length) out.hits.push({ code: "left-on", severity: "minor", message: "The current stayed on between readings. Open the switch between readings so the resistor stays at room temperature.", tag: "procedural", dimension: "technique" });
        const rheo = s.parts.find((p) => p.kind === "rheostat")?.setting ?? 1;
        s = { ...s, readings: [...s.readings, { V: pending.V, I: pending.I, rheo, t: e.t, config: "ohm" }], pending: { V: null, I: null }, offSinceReading: false };
        out.notes.push({ text: `Reading ${s.readings.length}: ${pending.V} V, ${pending.I} A`, tone: "success" });
      }
    }
    if (e.type === "param.set" && e.payload.key === "result:R") {
      const truth = (s.parts.find((p) => p.id === R_ID)?.value ?? 10);
      if (Math.abs(Number(e.payload.value) - truth) / truth > 0.05) out.hits.push({ code: "wrong-R", severity: "major", message: "That resistance is more than 5 % from the gradient of your V-I graph. R = V / I: take the slope of the best-fit line.", tag: "conceptual", dimension: "measurement" });
    }
    return { ...out, state: s };
  },
  steps: {
    build: (s) => ohmsWiringOk(s) && !isClosed(s),
    close: (s) => ohmsWiringOk(s) && isClosed(s),
    readings: (s) => {
      const distinct = s.readings.filter((r, i, a) => a.findIndex((o) => Math.abs((o.I ?? 0) - (r.I ?? 0)) <= 0.05 * Math.max(r.I ?? 0, 1e-3)) === i);
      return distinct.length >= 5;
    },
    "switch-off": (s) => !isClosed(s),
    result: (s) => typeof s.results.R === "number" && Math.abs((s.results.R as number) - (s.parts.find((p) => p.id === R_ID)?.value ?? 10)) / 10 <= 0.05,
  },
  safety: (s) => (isClosed(s) && circuitNow(s, R_ID).shorted.length ? { code: "short-circuit", title: "Short circuit", message: "The battery was connected straight across with almost no resistance. In a real lab the wires get hot enough to burn. Always check the circuit with the switch open." } : null),
  readouts: (s) => {
    const r = circuitNow(s, R_ID);
    return { V: meterValue(r, "V", "voltmeter"), I: meterValue(r, "A", "ammeter"), tempC: Math.round(s.tempC * 10) / 10, Rfit: fitR(s.readings), readings: s.readings.length };
  },
};

/* ================================================================== series and parallel */

/** "series" | "parallel" | null for the two bulbs, judged electrically with the switch closed. */
export function bulbConfig(s: CircuitState): "series" | "parallel" | null {
  const r = circuitIfClosed({ ...s, removed: [] });
  const l1 = r.components.L1;
  const l2 = r.components.L2;
  const am = r.components.A;
  if (!l1 || !l2 || !am || r.shorted.length || r.ammeterAcross.length) return null;
  const i1 = Math.abs(l1.current);
  const i2 = Math.abs(l2.current);
  if (i1 < 1e-3 || i2 < 1e-3) return null;
  const supply = Math.abs(r.components.B?.voltage ?? 0);
  const ia = Math.abs(am.current);
  if (Math.abs(i1 - i2) / i1 < 0.01 && Math.abs(ia - i1) / i1 < 0.01 && Math.abs(l1.voltage) < supply * 0.75) return "series";
  if (Math.abs(Math.abs(l1.voltage) - Math.abs(l2.voltage)) < 1e-3 && Math.abs(ia - (i1 + i2)) / (i1 + i2) < 0.01) return "parallel";
  return null;
}

export const bulbLit = (r: CircuitResult, id: string) => Math.abs(r.components[id]?.current ?? 0) > 0.02;

export const seriesParallel: SimModel<CircuitState> = {
  slug: "series-and-parallel",
  init: (c) => initCircuit(c.setup as unknown as CircuitSetup),
  apply: (s0, e) => {
    const out = circuitApply(s0, e);
    let s = out.state;
    const cfg = bulbConfig(s);
    if (isClosed(s) && cfg && !s.removed.length && !s.seen.includes(cfg)) s = { ...s, seen: [...s.seen, cfg] };
    if (e.type === "measure.read" && e.payload.instrument === "ammeter") {
      const truth = meterValue(circuitNow(s), "A", "ammeter");
      if (!isClosed(s)) out.hits.push({ code: "read-while-off", severity: "minor", message: "The switch was open, so there was no current to read.", tag: "procedural", dimension: "measurement" });
      else if (Math.abs(e.payload.reading.value - truth) > 0.002 + truth * 0.01) out.hits.push({ code: "misread", severity: "minor", message: `The ammeter shows ${truth} A. Read it again.`, tag: "procedural", dimension: "measurement" });
      else if (cfg && !s.removed.length) s = { ...s, ammeter: { ...s.ammeter, [cfg]: e.payload.reading.value } };
    }
    if (isClosed(s) && cfg === "parallel" && s.removed.length === 1) {
      const r = circuitNow(s);
      const other = s.removed[0] === "L1" ? "L2" : "L1";
      if (bulbLit(r, other)) s = { ...s, litWhileOneRemoved: true };
    }
    return { ...out, state: s };
  },
  steps: {
    series: (s) => s.seen.includes("series"),
    "series-read": (s) => s.ammeter.series !== undefined,
    parallel: (s) => s.seen.includes("parallel"),
    "parallel-read": (s) => s.ammeter.parallel !== undefined,
    unscrew: (s) => s.litWhileOneRemoved,
  },
  safety: (s) => (isClosed(s) && circuitNow(s).shorted.length ? { code: "short-circuit", title: "Short circuit", message: "A wire or the ammeter went straight across the battery. The current would be huge and the wires would get hot. Open the switch and rewire." } : null),
  readouts: (s) => {
    const r = circuitNow(s);
    return { I: meterValue(r, "A", "ammeter"), config: bulbConfig(s), L1: bulbLit(r, "L1"), L2: bulbLit(r, "L2"), P1: Math.abs(r.components.L1?.power ?? 0), P2: Math.abs(r.components.L2?.power ?? 0) };
  },
};
