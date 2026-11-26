/**
 * Circuit solver (build plan 3.2): modified nodal analysis with Gaussian elimination and partial
 * pivoting. Components join at terminals; wires merge terminals into nodes. Meters have real
 * resistances, so wiring an ammeter in parallel really is a near short and a voltmeter in series
 * really starves the circuit.
 */

export type ComponentKind = "cell" | "battery" | "resistor" | "rheostat" | "bulb" | "switch" | "ammeter" | "voltmeter" | "led" | "fuse" | "wire";

export type Component = {
  id: string;
  kind: ComponentKind;
  /** EMF (V) for sources, resistance (ohm) for resistors and bulbs, max resistance for rheostats, rating (A) for fuses. */
  value?: number;
  /** Internal resistance of a source, ohm. */
  internal?: number;
  /** Rheostat slider 0..1 (fraction of max resistance in circuit). */
  setting?: number;
  closed?: boolean;
  blown?: boolean;
  /** Diode-like parts (kind "led") only: forward voltage (V) and on-resistance (ohm). Unset means the LED values. */
  forwardV?: number;
  onOhm?: number;
};

/** Terminal names: "<id>.a" and "<id>.b". For sources a = positive, for LEDs a = anode. */
export type Wire = [string, string];

export const METER = { ammeterOhm: 0.01, voltmeterOhm: 10e6 } as const;
export const LED = { forwardV: 2.0, onOhm: 10 } as const;
const WIRE_OHM = 1e-3;
const CLOSED_SWITCH_OHM = 1e-3;
const FUSE_OHM = 0.05;
const GMIN = 1e-12;
/** A source delivering more than this through a tiny external resistance is shorted. */
const SHORT_OHM = 0.5;

export type ComponentResult = { id: string; current: number; voltage: number; power: number; on?: boolean };

export type CircuitResult = {
  nodeOf: Record<string, number>;
  voltages: number[];
  components: Record<string, ComponentResult>;
  /** Sources whose external path is a near short. */
  shorted: string[];
  /** Components carrying the short-circuit current. */
  shortPath: string[];
  blownFuses: string[];
  /** No current anywhere although there is a source and a load. */
  open: boolean;
  /** Terminals connected to nothing or only to a dead end. */
  floating: string[];
  /** Ammeters wired across a component (parallel) - the classic mistake. */
  ammeterAcross: string[];
  /** Voltmeters wired in series (they carry the circuit current). */
  voltmeterInSeries: string[];
  /** Parts whose two ends are joined by wires, so the current goes round them and they carry none. */
  bypassed: string[];
};

class DSU {
  p = new Map<string, string>();
  find(x: string): string {
    if (!this.p.has(x)) this.p.set(x, x);
    let r = x;
    while (this.p.get(r) !== r) r = this.p.get(r)!;
    let c = x;
    while (this.p.get(c) !== r) {
      const n = this.p.get(c)!;
      this.p.set(c, r);
      c = n;
    }
    return r;
  }
  union(a: string, b: string) {
    this.p.set(this.find(a), this.find(b));
  }
}

/** Solves Ax = b in place with partial pivoting. Returns null if singular. */
export function gaussSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    if (Math.abs(A[piv]![c]!) < 1e-18) return null;
    if (piv !== c) {
      [A[c], A[piv]] = [A[piv]!, A[c]!];
      [b[c], b[piv]] = [b[piv]!, b[c]!];
    }
    const rowC = A[c]!;
    for (let r = c + 1; r < n; r++) {
      const row = A[r]!;
      const f = row[c]! / rowC[c]!;
      if (f === 0) continue;
      for (let k = c; k < n; k++) row[k]! -= f * rowC[k]!;
      b[r]! -= f * b[c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    const row = A[r]!;
    for (let k = r + 1; k < n; k++) s -= row[k]! * x[k]!;
    x[r] = s / row[r]!;
  }
  return x;
}

export function resistanceOf(c: Component): number | null {
  switch (c.kind) {
    case "resistor":
    case "bulb":
      return c.value ?? 10;
    case "rheostat":
      return Math.max(0.5, (c.value ?? 50) * (c.setting ?? 1));
    case "ammeter":
      return METER.ammeterOhm;
    case "voltmeter":
      return METER.voltmeterOhm;
    case "wire":
      return WIRE_OHM;
    case "switch":
      return c.closed ? CLOSED_SWITCH_OHM : null;
    case "fuse":
      return c.blown ? null : FUSE_OHM;
    default:
      return null;
  }
}

const isSource = (c: Component) => c.kind === "cell" || c.kind === "battery";

/** Solves a circuit. Fuses that blow are re-solved open, so the result is the settled state. */
export function solve(componentsIn: Component[], wires: Wire[]): CircuitResult & { fuseTrip: Record<string, number> } {
  let components = componentsIn.map((c) => ({ ...c }));
  const blown = componentsIn.filter((c) => c.kind === "fuse" && c.blown).map((c) => c.id);
  /** The current that melted each fuse blown in this solve, A. */
  const fuseTrip: Record<string, number> = {};
  for (let pass = 0; pass < 4; pass++) {
    const r = solveOnce(components, wires);
    const newlyBlown = components.filter((c) => c.kind === "fuse" && !c.blown && Math.abs(r.components[c.id]?.current ?? 0) > (c.value ?? 3));
    if (!newlyBlown.length) return { ...r, blownFuses: blown, fuseTrip };
    newlyBlown.forEach((c) => {
      blown.push(c.id);
      fuseTrip[c.id] = Math.abs(r.components[c.id]!.current);
    });
    components = components.map((c) => (newlyBlown.some((b) => b.id === c.id) ? { ...c, blown: true } : c));
  }
  return { ...solveOnce(components, wires), blownFuses: blown, fuseTrip };
}

function solveOnce(components: Component[], wires: Wire[]): CircuitResult {
  const dsu = new DSU();
  for (const c of components) {
    dsu.find(`${c.id}.a`);
    dsu.find(`${c.id}.b`);
  }
  for (const [a, b] of wires) dsu.union(a, b);

  // Ground: the negative terminal of the first source (or any terminal).
  const src = components.find(isSource);
  const groundRoot = dsu.find(src ? `${src.id}.b` : `${components[0]?.id ?? "x"}.b`);
  const roots = new Map<string, number>();
  roots.set(groundRoot, 0);
  const nodeOf: Record<string, number> = {};
  for (const c of components)
    for (const t of ["a", "b"]) {
      const r = dsu.find(`${c.id}.${t}`);
      if (!roots.has(r)) roots.set(r, roots.size);
      nodeOf[`${c.id}.${t}`] = roots.get(r)!;
    }
  const N = roots.size - 1; // non-ground nodes

  // LEDs are piecewise linear: iterate on/off states until consistent.
  const ledOn: Record<string, boolean> = {};
  components.filter((c) => c.kind === "led").forEach((c) => (ledOn[c.id] = true));
  let voltages: number[] = new Array(N + 1).fill(0);
  let srcCurrents: Record<string, number> = {};

  for (let iter = 0; iter < 12; iter++) {
    const vsrc = components.filter((c) => isSource(c) && !(c.internal && c.internal > 0));
    const M = N + vsrc.length;
    const A = Array.from({ length: M }, () => new Array<number>(M).fill(0));
    const z = new Array<number>(M).fill(0);
    const idx = (n: number) => n - 1; // node n>0 -> row
    const stampG = (n1: number, n2: number, g: number) => {
      if (n1) A[idx(n1)]![idx(n1)]! += g;
      if (n2) A[idx(n2)]![idx(n2)]! += g;
      if (n1 && n2) {
        A[idx(n1)]![idx(n2)]! -= g;
        A[idx(n2)]![idx(n1)]! -= g;
      }
    };
    // current source pushing i from n1 to n2 through the external circuit (enters n2's KCL as +i... defined: flows out of n1 into the element, i.e. injects into n2)
    const stampI = (from: number, to: number, i: number) => {
      if (from) z[idx(from)]! -= i;
      if (to) z[idx(to)]! += i;
    };
    for (let n = 1; n <= N; n++) A[idx(n)]![idx(n)]! += GMIN;
    for (const c of components) {
      const na = nodeOf[`${c.id}.a`]!;
      const nb = nodeOf[`${c.id}.b`]!;
      if (isSource(c)) {
        if (c.internal && c.internal > 0) {
          // Norton: current E/r injected into + terminal, conductance 1/r across.
          const g = 1 / c.internal;
          stampG(na, nb, g);
          stampI(nb, na, (c.value ?? 1.5) * g);
        }
        continue;
      }
      if (c.kind === "led") {
        if (ledOn[c.id]) {
          const g = 1 / (c.onOhm ?? LED.onOhm);
          stampG(na, nb, g);
          // i = g (Va - Vb - Vf): the -g Vf part is a source pushing current from b to a
          stampI(na, nb, -(c.forwardV ?? LED.forwardV) * g);
        } else stampG(na, nb, 1e-9);
        continue;
      }
      const R = resistanceOf(c);
      if (R !== null) stampG(na, nb, 1 / R);
    }
    vsrc.forEach((c, k) => {
      const row = N + k;
      const na = nodeOf[`${c.id}.a`]!;
      const nb = nodeOf[`${c.id}.b`]!;
      if (na) {
        A[idx(na)]![row]! += 1;
        A[row]![idx(na)]! += 1;
      }
      if (nb) {
        A[idx(nb)]![row]! -= 1;
        A[row]![idx(nb)]! -= 1;
      }
      z[row] = c.value ?? 1.5;
    });
    const x = gaussSolve(A, z) ?? new Array<number>(M).fill(0);
    voltages = [0, ...x.slice(0, N)];
    srcCurrents = {};
    // MNA source variable is the current flowing from + through the source to - inside it; external current out of + is its negative.
    vsrc.forEach((c, k) => (srcCurrents[c.id] = -x[N + k]!));

    let changed = false;
    for (const c of components.filter((c) => c.kind === "led")) {
      const v = voltages[nodeOf[`${c.id}.a`]!]! - voltages[nodeOf[`${c.id}.b`]!]!;
      const vf = c.forwardV ?? LED.forwardV;
      const shouldBeOn = ledOn[c.id] ? v >= vf - 1e-9 : v > vf;
      if (shouldBeOn !== ledOn[c.id]) {
        ledOn[c.id] = shouldBeOn;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const results: Record<string, ComponentResult> = {};
  for (const c of components) {
    const va = voltages[nodeOf[`${c.id}.a`]!]!;
    const vb = voltages[nodeOf[`${c.id}.b`]!]!;
    const v = va - vb;
    let i = 0;
    if (isSource(c)) {
      if (c.internal && c.internal > 0) i = ((c.value ?? 1.5) - v) / c.internal;
      else i = srcCurrents[c.id] ?? 0;
    } else if (c.kind === "led") i = ledOn[c.id] ? Math.max(0, (v - (c.forwardV ?? LED.forwardV)) / (c.onOhm ?? LED.onOhm)) : 0;
    else {
      const R = resistanceOf(c);
      i = R === null ? 0 : v / R;
    }
    results[c.id] = { id: c.id, current: i, voltage: v, power: isSource(c) ? i * v : i * v, ...(c.kind === "led" ? { on: ledOn[c.id]! } : {}) };
  }

  // Short circuit: a source whose external load (V/I) is tiny.
  const shorted: string[] = [];
  for (const c of components.filter(isSource)) {
    const r = results[c.id]!;
    const ext = Math.abs(r.current) > 1e-9 ? Math.abs(r.voltage / r.current) : Infinity;
    const emf = c.value ?? 1.5;
    if (Math.abs(r.current) > emf / SHORT_OHM || ext < SHORT_OHM * 0.2) shorted.push(c.id);
  }
  const shortPath = shorted.length ? components.filter((c) => !isSource(c) && Math.abs(results[c.id]!.current) > ((components.find(isSource)?.value ?? 1.5) / SHORT_OHM) * 0.5).map((c) => c.id) : [];

  // Floating terminals: their node is not connected to anything else.
  const count = new Map<number, number>();
  Object.values(nodeOf).forEach((n) => count.set(n, (count.get(n) ?? 0) + 1));
  const floating = Object.entries(nodeOf)
    .filter(([, n]) => count.get(n) === 1)
    .map(([t]) => t);

  const anyCurrent = components.filter(isSource).some((c) => Math.abs(results[c.id]!.current) > 1e-6);
  const loads = components.some((c) => !isSource(c) && c.kind !== "wire");

  // Topology mistakes, judged by what the meter actually does.
  const ammeterAcross = components
    .filter((c) => c.kind === "ammeter")
    .filter((c) => {
      // In parallel with something: another non-wire component shares both its nodes.
      const na = nodeOf[`${c.id}.a`];
      const nb = nodeOf[`${c.id}.b`];
      return components.some((o) => o.id !== c.id && o.kind !== "wire" && o.kind !== "voltmeter" && ((nodeOf[`${o.id}.a`] === na && nodeOf[`${o.id}.b`] === nb) || (nodeOf[`${o.id}.a`] === nb && nodeOf[`${o.id}.b`] === na)));
    })
    .map((c) => c.id);
  const voltmeterInSeries = components
    .filter((c) => c.kind === "voltmeter")
    .filter((c) => {
      const na = nodeOf[`${c.id}.a`];
      const nb = nodeOf[`${c.id}.b`];
      const parallel = components.some((o) => o.id !== c.id && o.kind !== "wire" && ((nodeOf[`${o.id}.a`] === na && nodeOf[`${o.id}.b`] === nb) || (nodeOf[`${o.id}.a`] === nb && nodeOf[`${o.id}.b`] === na)));
      // Connected at both ends, not across anything, and other components hang off its nodes: it is in series.
      return !parallel && (count.get(na!) ?? 0) > 1 && (count.get(nb!) ?? 0) > 1;
    })
    .map((c) => c.id);

  // Bypassed: both terminals sit on one node (wires run round the part), so it can carry nothing.
  const bypassed = components.filter((c) => !isSource(c) && c.kind !== "wire" && nodeOf[`${c.id}.a`] === nodeOf[`${c.id}.b`]).map((c) => c.id);

  return { nodeOf, voltages, components: results, shorted, shortPath, blownFuses: [], open: loads && !anyCurrent && !shorted.length, floating, ammeterAcross, voltmeterInSeries, bypassed };
}

/* ------------------------------------------------------------------ resistor helpers */

export const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
const BAND = ["black", "brown", "red", "orange", "yellow", "green", "blue", "violet", "grey", "white"] as const;
export const BAND_HEX: Record<string, string> = { black: "#1b1b1b", brown: "#7b4a22", red: "#e03131", orange: "#f76707", yellow: "#fcc419", green: "#2f9e44", blue: "#1971c2", violet: "#7048e8", grey: "#868e96", white: "#f8f9fa", gold: "#d4a017" };

/** Nearest E12 value. */
export function nearestE12(ohm: number): number {
  const dec = Math.pow(10, Math.floor(Math.log10(ohm)));
  let best = E12[0]! * dec;
  for (const m of [...E12.map((e) => e * dec), 10 * dec]) if (Math.abs(m - ohm) < Math.abs(best - ohm)) best = m;
  return Number(best.toPrecision(2));
}

/** Four-band colour code (two digits, multiplier, 5 % gold tolerance). */
export function colourBands(ohm: number): string[] {
  const v = nearestE12(ohm);
  const exp = Math.floor(Math.log10(v)) - 1;
  const digits = Math.round(v / Math.pow(10, exp));
  return [BAND[Math.floor(digits / 10)]!, BAND[digits % 10]!, exp >= 0 ? BAND[exp]! : "gold", "gold"];
}

/* ------------------------------------------------------------------ resistor heating */

/**
 * A resistor warms while current flows (I^2 R) and cools toward room temperature, with a thermal
 * time constant. Its resistance follows R = R0 (1 + alpha (T - T0)). This is why the Ohm's law
 * procedure switches off between readings.
 */
export const HEAT = { alpha: 0.004, thermalOhmKPerW: 60, tauS: 25, roomC: 20 } as const;

export function heatStep(tempC: number, powerW: number, dtS: number): number {
  const target = HEAT.roomC + powerW * HEAT.thermalOhmKPerW;
  return target + (tempC - target) * Math.exp(-dtS / HEAT.tauS);
}

export const hotResistance = (r0: number, tempC: number) => r0 * (1 + HEAT.alpha * (tempC - HEAT.roomC));
