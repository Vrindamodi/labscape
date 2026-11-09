/**
 * Solution chemistry for the bench. Pure functions only, no randomness, fixed iteration counts:
 * the same inputs give the same answer in the browser (V8) and on the server (GraalJS).
 *
 * A solution is stored as analytical amounts (mol) of ions and weak-system totals. H+ and OH-
 * are never stored: pH falls out of the charge balance, so "HCl" is simply Cl- and "NaOH" is
 * simply Na+. Neutralisation, buffering and dilution then need no special cases.
 */
import type { Oklab } from "@labscape/contracts";

export const KW = 1e-14;
export const ROOM_C = 22;
export const MOLAR_GAS_ML = 24_000; // at room temperature and pressure

/** Dissolved components. Strong ions carry a charge; weak systems are totals. */
export type Ion =
  | "Na+" | "K+" | "Li+" | "Ca2+" | "Mg2+" | "Ba2+" | "Cu2+" | "Fe2+" | "Zn2+" | "Ag+" | "Pb2+"
  | "Cl-" | "SO4^2-" | "NO3-" | "I-" | "Br-"
  | "CH3COOH_T" // acetic acid + acetate total
  | "NH3_T" // ammonia + ammonium total
  | "CO3_T" // carbonate system total
  | "phph" | "litmus" | "univ" | "mo" // indicators (tiny amounts)
  | "S2O3^2-" // thiosulfate
  | "H2O2" // hydrogen peroxide (neutral)
  | "soap" // washing-up liquid (neutral surfactant)
  | "EtOH" // ethanol (neutral)
  | "EtOAc"; // ethyl ethanoate, the ester (neutral)

export const CHARGE: Partial<Record<Ion, number>> = {
  "Na+": 1, "K+": 1, "Li+": 1, "Ca2+": 2, "Mg2+": 2, "Ba2+": 2, "Cu2+": 2, "Fe2+": 2, "Zn2+": 2, "Ag+": 1, "Pb2+": 2,
  "Cl-": -1, "SO4^2-": -2, "NO3-": -1, "I-": -1, "Br-": -1, "S2O3^2-": -2,
};

/**
 * Hydrated metal ions are weak acids: [M(H2O)6]2+ <-> [M(OH)(H2O)5]+ + H+. This is why copper(II)
 * sulfate solution is acidic (~pH 4) and does not precipitate its own hydroxide.
 */
const HYDROLYSIS_KA: Partial<Record<Ion, number>> = { "Cu2+": Math.pow(10, -7.5), "Zn2+": Math.pow(10, -9), "Fe2+": Math.pow(10, -9.5), "Pb2+": Math.pow(10, -7.7), "Mg2+": Math.pow(10, -11.4) };

const KA_ACETIC = 1.75e-5;
const KA_AMMONIUM = 5.6e-10;
const K1_CARBONIC = 4.45e-7;
const K2_CARBONIC = 4.69e-11;

export type Amounts = Partial<Record<Ion, number>>;

/** Insoluble products. Hydroxides couple to pH; salts do not. */
export type Precipitate = "Cu(OH)2" | "Fe(OH)2" | "Mg(OH)2" | "Zn(OH)2" | "BaSO4" | "AgCl" | "PbI2" | "CaSO4" | "S" | "CuO" | "CuSO4.5H2O";

/**
 * `kinetic` solids are not Ksp equilibria: the reducer makes and removes them over time (colloidal
 * sulfur, undissolved copper(II) oxide, copper sulfate crystals). `turbidityPerM` sets how cloudy
 * one mol/L of suspended solid looks (default 60).
 */
type PptDef = { cation: Ion; anion: Ion | "OH-"; nCat: number; nAn: number; ksp: number; colour: Oklab; name: string; kinetic?: true; turbidityPerM?: number };

export const PRECIPITATES: Record<Precipitate, PptDef> = {
  "Cu(OH)2": { cation: "Cu2+", anion: "OH-", nCat: 1, nAn: 2, ksp: 2.2e-20, colour: { L: 0.74, a: -0.06, b: -0.09 }, name: "copper(II) hydroxide" },
  "Fe(OH)2": { cation: "Fe2+", anion: "OH-", nCat: 1, nAn: 2, ksp: 8e-16, colour: { L: 0.62, a: -0.07, b: 0.05 }, name: "iron(II) hydroxide" },
  "Mg(OH)2": { cation: "Mg2+", anion: "OH-", nCat: 1, nAn: 2, ksp: 5.6e-12, colour: { L: 0.96, a: 0, b: 0 }, name: "magnesium hydroxide" },
  "Zn(OH)2": { cation: "Zn2+", anion: "OH-", nCat: 1, nAn: 2, ksp: 3e-17, colour: { L: 0.97, a: 0, b: 0 }, name: "zinc hydroxide" },
  BaSO4: { cation: "Ba2+", anion: "SO4^2-", nCat: 1, nAn: 1, ksp: 1.1e-10, colour: { L: 0.98, a: 0, b: 0 }, name: "barium sulfate" },
  AgCl: { cation: "Ag+", anion: "Cl-", nCat: 1, nAn: 1, ksp: 1.8e-10, colour: { L: 0.97, a: 0, b: 0.01 }, name: "silver chloride" },
  PbI2: { cation: "Pb2+", anion: "I-", nCat: 1, nAn: 2, ksp: 9.8e-9, colour: { L: 0.86, a: 0.01, b: 0.17 }, name: "lead(II) iodide" },
  CaSO4: { cation: "Ca2+", anion: "SO4^2-", nCat: 1, nAn: 1, ksp: 4.9e-5, colour: { L: 0.98, a: 0, b: 0 }, name: "calcium sulfate" },
  S: { cation: "S2O3^2-", anion: "Cl-", nCat: 1, nAn: 0, ksp: 0, colour: { L: 0.93, a: -0.01, b: 0.09 }, name: "sulfur", kinetic: true, turbidityPerM: 210 },
  CuO: { cation: "Cu2+", anion: "OH-", nCat: 1, nAn: 0, ksp: 0, colour: { L: 0.22, a: 0, b: 0 }, name: "copper(II) oxide", kinetic: true, turbidityPerM: 12 },
  "CuSO4.5H2O": { cation: "Cu2+", anion: "SO4^2-", nCat: 1, nAn: 1, ksp: 0, colour: { L: 0.6, a: -0.07, b: -0.17 }, name: "hydrated copper(II) sulfate", kinetic: true, turbidityPerM: 8 },
};

/** Charge-balance residual at a given [H+] (mol/L). Increasing in h. */
function residual(h: number, c: Amounts, litres: number): number {
  let pos = h;
  let neg = KW / h;
  for (const k in c) {
    const ion = k as Ion;
    const z = CHARGE[ion];
    const conc = (c[ion] ?? 0) / litres;
    if (z === undefined || conc === 0) continue;
    if (z > 0) {
      const ka = HYDROLYSIS_KA[ion];
      // A hydrolysed ion carries one less positive charge.
      pos += ka ? conc * (z - ka / (ka + h)) : z * conc;
    } else neg += -z * conc;
  }
  const acetic = (c.CH3COOH_T ?? 0) / litres;
  if (acetic) neg += (acetic * KA_ACETIC) / (KA_ACETIC + h);
  const ammonia = (c.NH3_T ?? 0) / litres;
  if (ammonia) pos += (ammonia * h) / (h + KA_AMMONIUM);
  const carb = (c.CO3_T ?? 0) / litres;
  if (carb) {
    const d = h * h + K1_CARBONIC * h + K1_CARBONIC * K2_CARBONIC;
    neg += (carb * K1_CARBONIC * h) / d + (2 * carb * K1_CARBONIC * K2_CARBONIC) / d;
  }
  return pos - neg;
}

/**
 * pH from the charge balance by bisection on log10[H+] in [-15, 1]. 64 fixed iterations give
 * far better than 0.001 pH resolution. Returns 7 for an empty vessel.
 */
export function solvePh(c: Amounts, volumeMl: number): number {
  if (volumeMl <= 1e-6) return 7;
  const litres = volumeMl / 1000;
  let lo = -15;
  let hi = 1;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (residual(Math.pow(10, mid), c, litres) > 0) hi = mid;
    else lo = mid;
  }
  return -((lo + hi) / 2);
}

/**
 * Brings every precipitate to equilibrium with the solution: forms solid when the ion product
 * exceeds Ksp and redissolves it when below (e.g. Cu(OH)2 in acid). For each salt it bisects on the
 * amount of solid, re-solving the pH at every trial for hydroxides, so the answer is exact even at
 * the equivalence point. Fixed iteration counts keep it deterministic.
 */
export function equilibrate(dissolved: Amounts, solids: Partial<Record<Precipitate, number>>, volumeMl: number) {
  if (volumeMl <= 1e-6) return { ph: solvePh(dissolved, volumeMl) };
  const litres = volumeMl / 1000;
  const active = (Object.keys(PRECIPITATES) as Precipitate[]).filter((k) => {
    const d = PRECIPITATES[k];
    if (d.kinetic) return false;
    return (solids[k] ?? 0) > 0 || ((dissolved[d.cation] ?? 0) > 0 && (d.anion === "OH-" || (dissolved[d.anion as Ion] ?? 0) > 0));
  });
  if (!active.length) return { ph: solvePh(dissolved, volumeMl) };
  let basePh = solvePh(dissolved, volumeMl);
  let changed = false;
  for (let pass = 0; pass < (active.length > 1 ? 3 : 1); pass++) {
    for (const key of active) {
      const d = PRECIPITATES[key];
      const solid = solids[key] ?? 0;
      const totCat = (dissolved[d.cation] ?? 0) + solid * d.nCat;
      const totAn = d.anion === "OH-" ? 0 : (dissolved[d.anion as Ion] ?? 0) + solid * d.nAn;
      const trial: Amounts = { ...dissolved };
      const ionProduct = (x: number, knownPh?: number) => {
        trial[d.cation] = Math.max(0, totCat - x * d.nCat);
        let an: number;
        if (d.anion === "OH-") {
          an = KW / Math.pow(10, -(knownPh ?? solvePh(trial, volumeMl)));
        } else {
          trial[d.anion as Ion] = Math.max(0, totAn - x * d.nAn);
          an = (trial[d.anion as Ion] ?? 0) / litres;
        }
        return Math.pow((trial[d.cation] ?? 0) / litres, d.nCat) * Math.pow(an, d.nAn);
      };
      let x = 0;
      // With no solid present, x = 0 is the current solution, whose pH is already known.
      if (ionProduct(0, solid === 0 ? basePh : undefined) > d.ksp) {
        if (d.anion === "OH-") {
          // Hydroxide: at a given [H+] the dissolved metal is capped by Ksp, so one bisection on pH
          // (charge balance with the capped metal, still increasing in h) finds the equilibrium
          // directly instead of re-solving the pH for every trial amount of solid.
          const capped = (h: number) => Math.min(totCat, Math.pow(d.ksp / Math.pow(KW / h, d.nAn), 1 / d.nCat) * litres);
          let lo = -15;
          let hi = 1;
          for (let i = 0; i < 64; i++) {
            const mid = (lo + hi) / 2;
            const h = Math.pow(10, mid);
            trial[d.cation] = capped(h);
            if (residual(h, trial, litres) > 0) hi = mid;
            else lo = mid;
          }
          x = Math.max(0, (totCat - capped(Math.pow(10, (lo + hi) / 2))) / d.nCat);
        } else {
          let lo = 0;
          let hi = Math.min(totCat / d.nCat, totAn / d.nAn);
          for (let i = 0; i < 48; i++) {
            const mid = (lo + hi) / 2;
            if (ionProduct(mid) > d.ksp) lo = mid;
            else hi = mid;
          }
          x = (lo + hi) / 2;
        }
      }
      dissolved[d.cation] = Math.max(0, totCat - x * d.nCat);
      if (d.anion !== "OH-") dissolved[d.anion as Ion] = Math.max(0, totAn - x * d.nAn);
      if (x > 1e-12) solids[key] = x;
      else delete solids[key];
      if (x > 1e-12 || solid > 0) {
        changed = true;
        basePh = solvePh(dissolved, volumeMl);
      }
    }
    if (!changed) break;
  }
  return { ph: basePh };
}

/* ------------------------------------------------------------------ colour */

const O = (L: number, a: number, b: number): Oklab => ({ L, a, b });
export const WATER = O(0.97, -0.005, -0.01);

/** Indicator colour at a pH, from published transition ranges. */
export function indicatorColour(ind: "phph" | "litmus" | "univ" | "mo", ph: number): { c: Oklab; strength: number } {
  switch (ind) {
    case "phph": {
      // colourless below ~8.2, pink above ~10
      const t = clamp01((ph - 8.2) / 1.8);
      return { c: O(0.7, 0.2, -0.04), strength: t };
    }
    case "mo": {
      const t = clamp01((ph - 3.1) / 1.3);
      return { c: lerpLab(O(0.6, 0.18, 0.08), O(0.85, 0.02, 0.16), t), strength: 1 };
    }
    case "litmus": {
      const t = clamp01((ph - 4.5) / 3.8);
      return { c: lerpLab(O(0.55, 0.17, 0.05), O(0.48, -0.02, -0.14), t), strength: 1 };
    }
    case "univ": {
      // red 1-3, orange 4, yellow 5-6, green 7, blue 8-10, indigo/violet 11-14
      const stops: [number, Oklab][] = [
        [1, O(0.55, 0.19, 0.09)],
        [3, O(0.66, 0.13, 0.13)],
        [4, O(0.75, 0.07, 0.15)],
        [5.5, O(0.88, -0.02, 0.17)],
        [7, O(0.7, -0.15, 0.1)],
        [8.5, O(0.6, -0.1, -0.06)],
        [10, O(0.5, -0.03, -0.15)],
        [12, O(0.42, 0.06, -0.16)],
        [14, O(0.38, 0.1, -0.12)],
      ];
      let c = stops[0]![1];
      for (let i = 1; i < stops.length; i++) {
        const [p0, c0] = stops[i - 1]!;
        const [p1, c1] = stops[i]!;
        if (ph <= p1) {
          c = lerpLab(c0, c1, clamp01((ph - p0) / (p1 - p0)));
          break;
        }
        c = c1;
      }
      return { c, strength: 1 };
    }
  }
}

/** Ion colours (molar strength used as Beer-Lambert absorbance per mol/L). */
const ION_COLOUR: Partial<Record<Ion, { c: Oklab; k: number }>> = {
  "Cu2+": { c: O(0.62, -0.06, -0.14), k: 6 },
  "Fe2+": { c: O(0.86, -0.07, 0.06), k: 2 },
};

export type Appearance = { colour: Oklab; opacity: number; turbidity: number; sedimentColour: Oklab | null };

/**
 * What the liquid looks like: water tinted by coloured ions (absorbance grows with concentration
 * and path length) and indicators, clouded by suspended precipitate.
 */
export function appearance(dissolved: Amounts, solids: Partial<Record<Precipitate, number>>, volumeMl: number, ph: number, pathCm = 4): Appearance {
  if (volumeMl <= 1e-6) return { colour: WATER, opacity: 0, turbidity: 0, sedimentColour: null };
  const litres = volumeMl / 1000;
  let colour = WATER;
  let absorb = 0;
  for (const k of Object.keys(ION_COLOUR) as Ion[]) {
    const def = ION_COLOUR[k]!;
    const conc = (dissolved[k] ?? 0) / litres;
    if (conc <= 0) continue;
    const a = 1 - Math.exp(-def.k * conc * pathCm);
    colour = lerpLab(colour, def.c, a);
    absorb = Math.max(absorb, a);
  }
  for (const ind of ["univ", "litmus", "mo", "phph"] as const) {
    const amount = dissolved[ind] ?? 0;
    if (amount <= 0) continue;
    const { c, strength } = indicatorColour(ind, ph);
    // Indicator intensity saturates quickly: a few drops colour a whole flask.
    const dose = 1 - Math.exp(-(amount / litres) * 3.8e4 * pathCm);
    colour = lerpLab(colour, c, dose * strength);
    absorb = Math.max(absorb, dose * strength);
  }
  let turbidity = 0;
  let sediment: Oklab | null = null;
  let sedMol = 0;
  for (const k of Object.keys(solids) as Precipitate[]) {
    const mol = solids[k] ?? 0;
    if (mol <= 0) continue;
    turbidity = Math.min(1, turbidity + (mol / litres) * (PRECIPITATES[k].turbidityPerM ?? 60));
    if (mol > sedMol) {
      sedMol = mol;
      sediment = PRECIPITATES[k].colour;
    }
  }
  if (sediment) colour = lerpLab(colour, sediment, turbidity * 0.85);
  return { colour, opacity: 0.18 + 0.75 * Math.max(absorb, turbidity), turbidity, sedimentColour: sediment };
}

export function lerpLab(a: Oklab, b: Oklab, t: number): Oklab {
  return { L: a.L + (b.L - a.L) * t, a: a.a + (b.a - a.a) * t, b: a.b + (b.b - a.b) * t };
}

export function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Flame emission colours for the flame test (characteristic lines). */
export const FLAME: Partial<Record<Ion, { c: Oklab; name: string }>> = {
  "Li+": { c: O(0.6, 0.22, 0.06), name: "crimson red" },
  "Na+": { c: O(0.82, 0.04, 0.17), name: "intense yellow-orange" },
  "K+": { c: O(0.68, 0.1, -0.12), name: "lilac" },
  "Ca2+": { c: O(0.7, 0.14, 0.12), name: "orange-red (brick red)" },
  "Cu2+": { c: O(0.78, -0.16, 0.03), name: "blue-green" },
  "Ba2+": { c: O(0.85, -0.12, 0.14), name: "apple green" },
};
