/**
 * Equipment registry. Every vessel has a cross-section profile (radius against height, mm), a
 * capacity, a lip and a neck. The profile is what turns tilt into a realistic pour: a fuller bottle
 * reaches its lip at a smaller tilt, and past that the flow follows the weir law.
 */

export type EquipmentKind =
  | "beaker_100"
  | "beaker_250"
  | "conical_flask_100"
  | "test_tube"
  | "boiling_tube"
  | "measuring_cylinder_10"
  | "measuring_cylinder_50"
  | "burette_50"
  | "pipette_10"
  | "dropper"
  | "reagent_bottle"
  | "dropper_bottle"
  | "wash_bottle"
  | "white_tile"
  | "clamp_stand"
  | "test_tube_rack"
  | "bunsen"
  | "tripod"
  | "wire_loop"
  | "splint"
  | "thermometer"
  | "glass_rod"
  | "funnel"
  | "watch_glass"
  | "goggles"
  | "evaporating_basin"
  | "litmus_paper";

export type KindDef = {
  label: string;
  /** Liquid capacity in mL (0 for non-vessels). */
  capacityMl: number;
  /** [radiusMm, heightMm] from the base up; the last point is the lip. */
  profile: [number, number][];
  /** Radius of the opening liquid leaves through, mm. */
  neckMm: number;
  /** Graduations for reading: step and the mL at the top mark. */
  graduations?: { stepMl: number; maxMl: number; readTo: number; inverted?: boolean };
  /** Can it be tipped to pour? Burettes, pipettes and droppers dispense differently. */
  pours: boolean;
  /** Sockets this item snaps into. */
  fits: SocketKind[];
  /** Sockets it provides to others. */
  provides?: SocketKind[];
  /** Heat capacity of the empty item, J/K. */
  heatCapacityJK: number;
  /** Glassware vs tool. */
  category: "vessel" | "dispenser" | "tool" | "support" | "heat" | "safety";
  /** Heat loss to the room, W per K above room temperature (default 0.9). Wide, shallow dishes lose more. */
  lossWPerK?: number;
};

export type SocketKind = "bench" | "rack" | "clamp" | "tile" | "tripod" | "flame";

const P = (pts: [number, number][]) => pts;

export const KINDS: Record<EquipmentKind, KindDef> = {
  beaker_100: { label: "Beaker (100 mL)", capacityMl: 100, profile: P([[24, 0], [24, 68], [26, 70]]), neckMm: 24, graduations: { stepMl: 25, maxMl: 100, readTo: 5 }, pours: true, fits: ["bench", "tile", "tripod"], heatCapacityJK: 45, category: "vessel" },
  beaker_250: { label: "Beaker (250 mL)", capacityMl: 250, profile: P([[34, 0], [34, 86], [36, 88]]), neckMm: 34, graduations: { stepMl: 50, maxMl: 250, readTo: 10 }, pours: true, fits: ["bench", "tile", "tripod"], heatCapacityJK: 80, category: "vessel" },
  conical_flask_100: { label: "Conical flask (100 mL)", capacityMl: 100, profile: P([[32, 0], [30, 10], [20, 45], [11, 70], [11, 88], [12, 90]]), neckMm: 11, graduations: { stepMl: 25, maxMl: 100, readTo: 25 }, pours: true, fits: ["bench", "tile", "tripod", "clamp"], heatCapacityJK: 60, category: "vessel" },
  test_tube: { label: "Test tube", capacityMl: 15, profile: P([[2, 0], [7, 4], [7, 100], [8, 102]]), neckMm: 7, pours: true, fits: ["bench", "rack", "clamp"], heatCapacityJK: 12, category: "vessel" },
  boiling_tube: { label: "Boiling tube", capacityMl: 40, profile: P([[3, 0], [11, 6], [11, 145], [12, 147]]), neckMm: 11, pours: true, fits: ["bench", "rack", "clamp"], heatCapacityJK: 22, category: "vessel" },
  measuring_cylinder_10: { label: "Measuring cylinder (10 mL)", capacityMl: 12, profile: P([[6.5, 0], [6.5, 90], [8, 92]]), neckMm: 7, graduations: { stepMl: 0.2, maxMl: 10, readTo: 0.1 }, pours: true, fits: ["bench"], heatCapacityJK: 20, category: "vessel" },
  measuring_cylinder_50: { label: "Measuring cylinder (50 mL)", capacityMl: 55, profile: P([[12, 0], [12, 122], [14, 124]]), neckMm: 13, graduations: { stepMl: 1, maxMl: 50, readTo: 0.5 }, pours: true, fits: ["bench"], heatCapacityJK: 40, category: "vessel" },
  burette_50: { label: "Burette (50 mL)", capacityMl: 52, profile: P([[5.6, 0], [5.6, 560], [6, 565]]), neckMm: 1, graduations: { stepMl: 0.1, maxMl: 50, readTo: 0.05, inverted: true }, pours: false, fits: ["clamp"], heatCapacityJK: 60, category: "dispenser" },
  pipette_10: { label: "Volumetric pipette (10 mL)", capacityMl: 10, profile: P([[3, 0], [3, 120], [3, 200]]), neckMm: 1, graduations: { stepMl: 10, maxMl: 10, readTo: 0.05 }, pours: false, fits: ["bench"], heatCapacityJK: 10, category: "dispenser" },
  dropper: { label: "Dropper", capacityMl: 2, profile: P([[3, 0], [3, 60]]), neckMm: 0.6, pours: false, fits: ["bench"], heatCapacityJK: 3, category: "dispenser" },
  reagent_bottle: { label: "Reagent bottle", capacityMl: 250, profile: P([[32, 0], [32, 90], [14, 105], [12, 118], [12, 125]]), neckMm: 11, pours: true, fits: ["bench"], heatCapacityJK: 150, category: "vessel" },
  dropper_bottle: { label: "Dropper bottle", capacityMl: 30, profile: P([[16, 0], [16, 55], [8, 65]]), neckMm: 0.6, pours: false, fits: ["bench"], heatCapacityJK: 30, category: "dispenser" },
  wash_bottle: { label: "Wash bottle (distilled water)", capacityMl: 250, profile: P([[30, 0], [30, 120]]), neckMm: 1.5, pours: false, fits: ["bench"], heatCapacityJK: 50, category: "dispenser" },
  white_tile: { label: "White tile", capacityMl: 0, profile: [], neckMm: 0, pours: false, fits: ["bench"], provides: ["tile"], heatCapacityJK: 200, category: "support" },
  clamp_stand: { label: "Clamp stand", capacityMl: 0, profile: [], neckMm: 0, pours: false, fits: ["bench"], provides: ["clamp"], heatCapacityJK: 900, category: "support" },
  test_tube_rack: { label: "Test-tube rack", capacityMl: 0, profile: [], neckMm: 0, pours: false, fits: ["bench"], provides: ["rack"], heatCapacityJK: 300, category: "support" },
  bunsen: { label: "Bunsen burner", capacityMl: 0, profile: [], neckMm: 0, pours: false, fits: ["bench"], provides: ["flame"], heatCapacityJK: 400, category: "heat" },
  tripod: { label: "Tripod and gauze", capacityMl: 0, profile: [], neckMm: 0, pours: false, fits: ["bench"], provides: ["tripod"], heatCapacityJK: 500, category: "support" },
  wire_loop: { label: "Nichrome wire loop", capacityMl: 0, profile: [], neckMm: 0, pours: false, fits: ["bench"], heatCapacityJK: 1, category: "tool" },
  splint: { label: "Wooden splint", capacityMl: 0, profile: [], neckMm: 0, pours: false, fits: ["bench"], heatCapacityJK: 2, category: "tool" },
  thermometer: { label: "Thermometer", capacityMl: 0, profile: [], neckMm: 0, pours: false, fits: ["bench"], heatCapacityJK: 5, category: "tool" },
  glass_rod: { label: "Glass rod", capacityMl: 0, profile: [], neckMm: 0, pours: false, fits: ["bench"], heatCapacityJK: 4, category: "tool" },
  funnel: { label: "Filter funnel", capacityMl: 0, profile: [], neckMm: 0, pours: false, fits: ["bench"], heatCapacityJK: 20, category: "tool" },
  watch_glass: { label: "Watch glass", capacityMl: 0, profile: [], neckMm: 0, pours: false, fits: ["bench"], heatCapacityJK: 15, category: "tool" },
  goggles: { label: "Safety goggles", capacityMl: 0, profile: [], neckMm: 0, pours: false, fits: ["bench"], heatCapacityJK: 0, category: "safety" },
  evaporating_basin: { label: "Evaporating basin", capacityMl: 60, profile: P([[14, 0], [30, 8], [38, 18], [41, 26], [43, 28]]), neckMm: 40, pours: true, fits: ["bench", "tripod"], heatCapacityJK: 60, category: "vessel", lossWPerK: 1.4 },
  litmus_paper: { label: "Damp blue litmus paper", capacityMl: 0, profile: [], neckMm: 0, pours: false, fits: ["bench"], heatCapacityJK: 0, category: "tool" },
};

/* ------------------------------------------------------------------ profile geometry */

const STEPS = 200;

function radiusAt(profile: [number, number][], h: number): number {
  if (!profile.length) return 0;
  for (let i = 1; i < profile.length; i++) {
    const [r0, h0] = profile[i - 1]!;
    const [r1, h1] = profile[i]!;
    if (h <= h1) return h1 === h0 ? r1 : r0 + ((r1 - r0) * (h - h0)) / (h1 - h0);
  }
  return profile[profile.length - 1]![0];
}

export function lipHeightMm(kind: EquipmentKind): number {
  const p = KINDS[kind].profile;
  return p.length ? p[p.length - 1]![1] : 0;
}

/** Volume in mL held up to height h (mm), by integrating π r(h)² dh. */
export function volumeBelow(kind: EquipmentKind, hMm: number): number {
  const p = KINDS[kind].profile;
  const top = Math.min(hMm, lipHeightMm(kind));
  if (top <= 0 || !p.length) return 0;
  const dh = top / STEPS;
  let v = 0;
  for (let i = 0; i < STEPS; i++) {
    const r = radiusAt(p, (i + 0.5) * dh);
    v += Math.PI * r * r * dh;
  }
  return v / 1000; // mm³ -> mL
}

/** Liquid height (mm) for a volume, by bisection on volumeBelow. */
export function heightOf(kind: EquipmentKind, volumeMl: number): number {
  const lip = lipHeightMm(kind);
  if (volumeMl <= 0 || lip <= 0) return 0;
  let lo = 0;
  let hi = lip;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (volumeBelow(kind, mid) < volumeMl) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Mean radius of the liquid column, used for the tilted-surface approximation. */
function meanRadius(kind: EquipmentKind, h: number) {
  if (h <= 0) return radiusAt(KINDS[kind].profile, 0);
  return Math.sqrt(volumeBelow(kind, h) * 1000 / (Math.PI * h));
}

/**
 * Tilt (degrees) at which the level surface first reaches the lip. A full vessel pours almost at
 * once; a nearly empty one has to be tipped far. Uses the radius at the lip for the lever arm.
 */
export function onsetAngleDeg(kind: EquipmentKind, volumeMl: number): number {
  const lip = lipHeightMm(kind);
  const h = heightOf(kind, volumeMl);
  const r = Math.max(meanRadius(kind, h), KINDS[kind].neckMm, 1);
  const freeboard = lip - h;
  if (freeboard <= 0) return 0;
  return (Math.atan2(freeboard, r) * 180) / Math.PI;
}

/**
 * Weir-law pour rate (mL/s) at a tilt. Head above the lip grows with the tilt past onset; flow
 * grows with head^1.5 and is capped by what the neck can pass.
 */
export function pourRateMlPerS(kind: EquipmentKind, volumeMl: number, tiltDeg: number): number {
  const def = KINDS[kind];
  if (!def.pours || volumeMl <= 0.005) return 0;
  const onset = onsetAngleDeg(kind, volumeMl);
  if (tiltDeg <= onset) return 0;
  const lip = lipHeightMm(kind);
  const h = heightOf(kind, volumeMl);
  const r = Math.max(meanRadius(kind, h), def.neckMm, 1);
  const tilt = (Math.min(tiltDeg, 135) * Math.PI) / 180;
  // Height of the liquid surface above the lip edge, measured along the vessel axis.
  const head = Math.max(0, r * Math.tan(Math.min(tilt, 1.45)) - (lip - h)) * Math.cos(Math.min(tilt, 1.45));
  const weirWidth = def.neckMm * 1.2; // the stream spreads over part of the rim
  const raw = 0.0083 * weirWidth * Math.pow(head, 1.5); // tuned: trickle ~1-2 mL/s just past onset, gush ~50 mL/s
  const neckCap = Math.PI * def.neckMm * def.neckMm * 0.09; // mL/s through the opening
  return Math.min(raw, neckCap, volumeMl * 4);
}

/** Burette flow at a stopcock opening 0..1: slow drip to a steady stream (~0.05 to 2 mL/s). */
export function buretteRateMlPerS(opening: number, tipBubble: boolean): number {
  if (opening <= 0) return 0;
  const o = Math.min(1, opening);
  return (0.05 + 1.95 * o * o) * (tipBubble ? 0.85 : 1);
}

export const DROP_ML = 0.05;
