import type { Oklab } from "@labscape/contracts";
import { appearance, equilibrate, ROOM_C, type Amounts, type Appearance, type Precipitate } from "./chem";
import { KINDS, type EquipmentKind } from "./equipment";
import { reagent } from "./reagents";

/** A liquid body. `plume` is a recent addition that has not mixed in yet (local concentration). */
export type Liquid = {
  volumeMl: number;
  ions: Amounts;
  solids: Partial<Record<Precipitate, number>>;
  /** Undiluted concentrated sulfuric acid in the vessel, mol. */
  concAcidMol: number;
  tempC: number;
  ph: number;
  plume: { volumeMl: number; ions: Amounts; ph: number } | null;
};

export type MetalPiece = { symbol: "Mg" | "Fe" | "Zn" | "Cu"; mol: number; initialMol: number; area: number };

export type Item = {
  id: string;
  kind: EquipmentKind;
  label: string;
  /** Bench position in mm (x right, z towards the viewer). */
  x: number;
  z: number;
  /** "<socketKind>:<providerId>" when snapped, e.g. "clamp:stand-1", "tile:tile-1". */
  socket: string | null;
  liquid: Liquid | null;
  /** For bottles: which stock it holds (refills are not allowed mid-run). */
  reagentId?: string;
  metals: MetalPiece[];
  /** Copper deposited on a metal, mol. */
  depositMol: number;
  stoppered: boolean;
  /** Heat sources. */
  gasOn?: boolean;
  airHoleOpen?: boolean;
  heats?: string | null; // bunsen -> vessel it is under
  inIceBath?: boolean;
  /** Burette. */
  stopcock?: number;
  tipBubble?: boolean;
  /** Thermometer: which vessel it sits in and what it reads (first-order lag). */
  inVessel?: string | null;
  readingC?: number;
  /** Wire loop: ions on the wire and seconds left in the flame. */
  coating?: Amounts;
  inFlameMs?: number;
  /** Gas held in a tube (mL at room conditions). */
  gasMl?: Record<string, number>;
  /** Where this vessel's gas goes (an inverted collection tube). */
  gasTo?: string | null;
  /** Splint state. */
  lit?: boolean;
  glowing?: boolean;
  /** Corrosive splashes on this item, mL. */
  spilledMl?: number;
  /* Part 5 (all optional, only set by the reactions that use them, so older runs hash the same). */
  /** Gas is streaming out of the liquid right now (catalysis, electrolysis): drives the bubbles. */
  bubbling?: boolean;
  /** Foam standing on and above the liquid, mL (detergent traps the gas). */
  foamMl?: number;
  /** A pair of inert carbon electrodes dips into this vessel. */
  electrodes?: boolean;
  /** Power-pack voltage across the electrodes (0 = off). */
  volts?: number;
  /** The water bath (a vessel of hot water) this tube stands in. */
  inBath?: string | null;
  /** Which metal is coating the solid in this vessel after a displacement. */
  depositOf?: "Cu" | "Zn" | "Fe" | "Mg";
  /** Litmus paper colour state. */
  litmus?: "blue" | "red" | "bleached";
};

export type BenchSetup = {
  items: Array<Partial<Item> & { id: string; kind: EquipmentKind; fill?: { reagentId: string; volumeMl: number; tempC?: number } }>;
};

export type LabState = {
  /** Simulation clock, ms since the attempt started. */
  t: number;
  items: Record<string, Item>;
  spills: { reagentHazard: boolean; volumeMl: number; at: number; onto: string }[];
  roomC: number;
  setup: BenchSetup;
  /** Monotonic event counter applied so far. */
  seq: number;
  /** Discovered phenomena (for observations and the evaluator). */
  seen: Record<string, number>;
};

export function emptyLiquid(tempC = ROOM_C): Liquid {
  return { volumeMl: 0, ions: {}, solids: {}, concAcidMol: 0, tempC, ph: 7, plume: null };
}

export function liquidOf(reagentId: string, volumeMl: number, tempC = ROOM_C): Liquid {
  const r = reagent(reagentId);
  const ions: Amounts = {};
  for (const k in r.perMl ?? {}) ions[k as keyof Amounts] = (r.perMl?.[k as keyof Amounts] ?? 0) * volumeMl;
  const liquid: Liquid = { volumeMl, ions, solids: {}, concAcidMol: (r.concAcidPerMl ?? 0) * volumeMl, tempC, ph: 7, plume: null };
  liquid.ph = equilibrate(liquid.ions, liquid.solids, volumeMl).ph;
  return liquid;
}

export function initialState(setup: BenchSetup): LabState {
  const items: Record<string, Item> = {};
  for (const s of setup.items) {
    const def = KINDS[s.kind];
    const item: Item = {
      id: s.id,
      kind: s.kind,
      label: s.label ?? def.label,
      x: s.x ?? 0,
      z: s.z ?? 0,
      socket: s.socket ?? null,
      liquid: def.capacityMl > 0 ? (s.fill ? liquidOf(s.fill.reagentId, s.fill.volumeMl, s.fill.tempC ?? ROOM_C) : emptyLiquid()) : null,
      metals: [],
      depositMol: 0,
      stoppered: false,
      ...(s.reagentId ? { reagentId: s.reagentId } : s.fill ? { reagentId: s.fill.reagentId } : {}),
    };
    if (s.kind === "burette_50") {
      item.stopcock = 0;
      item.tipBubble = false;
    }
    if (s.kind === "bunsen") {
      item.gasOn = false;
      item.airHoleOpen = false;
      item.heats = null;
    }
    if (s.kind === "thermometer") {
      item.inVessel = null;
      item.readingC = ROOM_C;
    }
    if (s.kind === "wire_loop") {
      item.coating = s.coating ?? { "Na+": 2e-7 }; // a new loop is never perfectly clean
      item.inFlameMs = 0;
    }
    if (s.kind === "splint") {
      item.lit = false;
      item.glowing = false;
    }
    if (s.kind === "test_tube" || s.kind === "boiling_tube") {
      item.gasMl = {};
      item.gasTo = null;
    }
    if (s.electrodes) {
      item.electrodes = true;
      item.volts = 0;
      item.gasMl = item.gasMl ?? {};
      item.gasTo = item.gasTo ?? null;
    }
    if (s.kind === "litmus_paper") item.litmus = "blue";
    items[s.id] = item;
  }
  return { t: 0, items, spills: [], roomC: ROOM_C, setup, seq: 0, seen: {} };
}

/** What the renderer and observation panel need for one vessel. */
export function look(item: Item): (Appearance & { volumeMl: number; tempC: number; ph: number; plume: { colour: Oklab; strength: number } | null }) | null {
  const l = item.liquid;
  if (!l) return null;
  const a = appearance(l.ions, l.solids, l.volumeMl, l.ph);
  let plume: { colour: Oklab; strength: number } | null = null;
  if (l.plume && l.plume.volumeMl > 0.001) {
    // The plume is seen against the surrounding liquid, so it carries the bulk's indicator too.
    const local: Amounts = { ...l.plume.ions };
    for (const ind of ["phph", "univ", "litmus", "mo"] as const) local[ind] = (l.ions[ind] ?? 0) * (l.plume.volumeMl / Math.max(l.volumeMl, 1e-6));
    const p = appearance(local, {}, Math.max(l.plume.volumeMl, 0.05), l.plume.ph, 1.2);
    plume = { colour: p.colour, strength: Math.min(1, (l.plume.volumeMl / Math.max(l.volumeMl, 1)) * 8 + 0.15) };
  }
  return { ...a, volumeMl: l.volumeMl, tempC: l.tempC, ph: l.ph, plume };
}

export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}
