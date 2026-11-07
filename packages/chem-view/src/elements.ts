/**
 * Periodic-table model: the element shape the API serves, electron configurations (Madelung filling
 * with the real ground-state exceptions), Bohr shells, and the property scales the trend view uses.
 */

export type ExperimentLink = { slug: string; title: string; subject: string; playable: boolean };

export type Element = {
  z: number;
  symbol: string;
  name: string;
  mass: number;
  category: Category;
  state: "solid" | "liquid" | "gas";
  colour: string;
  electronegativity?: number | null;
  oxidationStates: number[];
  radioactive: boolean;
  synthetic: boolean;
  fact: string;
  period: number;
  group?: number | null;
  block: "s" | "p" | "d" | "f";
  /** Grid cell: rows 1-7 are periods, 9 and 10 the detached f-block; cols 1-18. */
  row: number;
  col: number;
  radiusPm?: number | null;
  ionisationKjMol?: number | null;
  electronAffinityKjMol?: number | null;
  meltingK?: number | null;
  boilingK?: number | null;
  density?: number | null;
  /** 0 = known since antiquity. */
  discovered?: number | null;
  experiments: ExperimentLink[];
};

export type Category =
  | "alkali"
  | "alkaline-earth"
  | "transition"
  | "post-transition"
  | "metalloid"
  | "nonmetal"
  | "halogen"
  | "noble"
  | "lanthanide"
  | "actinide";

export const CATEGORIES: Record<Category, { label: string; colour: string }> = {
  alkali: { label: "Alkali metals", colour: "#ff6b6b" },
  "alkaline-earth": { label: "Alkaline earth metals", colour: "#ffa94d" },
  transition: { label: "Transition metals", colour: "#4dabf7" },
  "post-transition": { label: "Post-transition metals", colour: "#74c0fc" },
  metalloid: { label: "Metalloids", colour: "#63e6be" },
  nonmetal: { label: "Reactive nonmetals", colour: "#a9e34b" },
  halogen: { label: "Halogens", colour: "#ffd43b" },
  noble: { label: "Noble gases", colour: "#da77f2" },
  lanthanide: { label: "Lanthanides", colour: "#f783ac" },
  actinide: { label: "Actinides", colour: "#e599f7" },
};

/* ------------------------------------------------------------------ electron configuration */

export type Subshell = { n: number; l: number; electrons: number };
const L = "spdf";
export const subshellName = (s: { n: number; l: number }) => `${s.n}${L[s.l]}`;
const capacity = (l: number) => 2 * (2 * l + 1);

/** Subshells in Madelung (n + l, then n) order, up to 7p. */
export const MADELUNG: { n: number; l: number }[] = (() => {
  const out: { n: number; l: number }[] = [];
  for (let n = 1; n <= 7; n++) for (let l = 0; l < Math.min(n, 4); l++) out.push({ n, l });
  out.sort((a, b) => a.n + a.l - (b.n + b.l) || a.n - b.n);
  return out.filter((s) => !(s.n === 7 && s.l > 1)); // 7d/7f/8s are never needed up to Z = 118
})();

/**
 * Measured ground states that break the Madelung rule, written as electrons moved between
 * subshells. Half-filled and filled d subshells (Cr, Cu, ...) and the 5d/6d occupancy of the early
 * f-block are the classic cases. Source: NIST atomic spectra database ground levels.
 */
export const EXCEPTIONS: Record<number, [string, number][]> = {
  24: [["4s", -1], ["3d", 1]], // Cr
  29: [["4s", -1], ["3d", 1]], // Cu
  41: [["5s", -1], ["4d", 1]], // Nb
  42: [["5s", -1], ["4d", 1]], // Mo
  44: [["5s", -1], ["4d", 1]], // Ru
  45: [["5s", -1], ["4d", 1]], // Rh
  46: [["5s", -2], ["4d", 2]], // Pd
  47: [["5s", -1], ["4d", 1]], // Ag
  57: [["4f", -1], ["5d", 1]], // La
  58: [["4f", -1], ["5d", 1]], // Ce
  64: [["4f", -1], ["5d", 1]], // Gd
  78: [["6s", -1], ["5d", 1]], // Pt
  79: [["6s", -1], ["5d", 1]], // Au
  89: [["5f", -1], ["6d", 1]], // Ac
  90: [["5f", -2], ["6d", 2]], // Th
  91: [["5f", -1], ["6d", 1]], // Pa
  92: [["5f", -1], ["6d", 1]], // U
  93: [["5f", -1], ["6d", 1]], // Np
  96: [["5f", -1], ["6d", 1]], // Cm
  103: [["6d", -1], ["7p", 1]], // Lr
};

/** Pure Madelung filling, in filling order. */
export function madelungFill(z: number): Subshell[] {
  const out: Subshell[] = [];
  let left = z;
  for (const s of MADELUNG) {
    if (left <= 0) break;
    const e = Math.min(capacity(s.l), left);
    out.push({ ...s, electrons: e });
    left -= e;
  }
  return out;
}

export type Configuration = {
  /** Ground state in filling order, with the exception applied. */
  filling: Subshell[];
  /** Ground state ordered by n then l (how it is usually written). */
  ordered: Subshell[];
  /** Madelung prediction, when it differs. */
  predicted: Subshell[] | null;
  /** Which subshells the exception moved electrons between. */
  moved: [string, number][];
  core: string | null;
  /** Subshells outside the noble-gas core, written order. */
  valence: Subshell[];
  shells: number[];
  isPredicted: boolean;
};

const NOBLE = [2, 10, 18, 36, 54, 86];
const NOBLE_SYMBOL: Record<number, string> = { 2: "He", 10: "Ne", 18: "Ar", 36: "Kr", 54: "Xe", 86: "Rn" };

export function configuration(z: number): Configuration {
  const predicted = madelungFill(z);
  const moves = EXCEPTIONS[z] ?? [];
  let filling = predicted.map((s) => ({ ...s }));
  for (const [name, d] of moves) {
    const found = filling.find((s) => subshellName(s) === name);
    if (found) found.electrons += d;
    else {
      const n = Number(name[0]);
      const l = L.indexOf(name[1]!);
      filling.push({ n, l, electrons: d });
    }
  }
  filling = filling.filter((s) => s.electrons > 0);
  filling.sort((a, b) => MADELUNG.findIndex((m) => m.n === a.n && m.l === a.l) - MADELUNG.findIndex((m) => m.n === b.n && m.l === b.l));
  const ordered = [...filling].sort((a, b) => a.n - b.n || a.l - b.l);

  const coreZ = [...NOBLE].reverse().find((n) => n < z) ?? null;
  const coreSet = coreZ ? new Set(madelungFill(coreZ).map(subshellName)) : new Set<string>();
  const coreCounts = coreZ ? Object.fromEntries(madelungFill(coreZ).map((s) => [subshellName(s), s.electrons])) : {};
  const valence = ordered.filter((s) => !coreSet.has(subshellName(s)) || s.electrons !== coreCounts[subshellName(s)]);

  const shells: number[] = [];
  for (const s of filling) shells[s.n - 1] = (shells[s.n - 1] ?? 0) + s.electrons;
  for (let i = 0; i < shells.length; i++) shells[i] ??= 0;

  return {
    filling,
    ordered,
    predicted: moves.length ? predicted : null,
    moved: moves,
    core: coreZ ? NOBLE_SYMBOL[coreZ]! : null,
    valence,
    shells,
    // Beyond Z = 104 nobody has measured a ground state: these are predictions.
    isPredicted: z > 104,
  };
}

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
export const sup = (n: number) => String(n).split("").map((d) => SUP[Number(d)]).join("");

/** "[Ar] 3d⁵ 4s¹" */
export function configText(c: Configuration, full = false): string {
  const parts = (full ? c.ordered : c.valence).map((s) => `${subshellName(s)}${sup(s.electrons)}`);
  return full || !c.core ? parts.join(" ") : `[${c.core}] ${parts.join(" ")}`;
}

/** Orbital boxes for one subshell with Hund's rule: singles first, then pairs. */
export function orbitalBoxes(l: number, electrons: number): Array<0 | 1 | 2> {
  const boxes = 2 * l + 1;
  return Array.from({ length: boxes }, (_, i) => (electrons >= boxes + i + 1 ? 2 : electrons > i ? 1 : 0));
}

/* ------------------------------------------------------------------ trends */

export type TrendKey = "electronegativity" | "radiusPm" | "ionisationKjMol" | "electronAffinityKjMol" | "meltingK" | "density" | "mass" | "discovered";

export const TRENDS: Record<TrendKey, { label: string; unit: string; short: string; log?: boolean; explain: string; ramp: [string, string, string] }> = {
  electronegativity: { label: "Electronegativity", unit: "Pauling", short: "EN", explain: "How strongly an atom pulls shared electrons. Rises across a period (more protons, same shielding) and falls down a group (outer electrons further away). Fluorine is the maximum.", ramp: ["#173a73", "#2f80ff", "#ffe066"] },
  radiusPm: { label: "Atomic radius", unit: "pm", short: "r", explain: "Shrinks across a period as the growing nuclear charge pulls the same shell in tighter; grows down a group as new shells are added. Caesium is among the largest.", ramp: ["#1b2a4a", "#22b8cf", "#b2f2bb"] },
  ionisationKjMol: { label: "First ionisation energy", unit: "kJ/mol", short: "IE₁", explain: "The energy to remove the outermost electron. High for noble gases, low for alkali metals. Dips at boron and oxygen show subshell structure.", ramp: ["#2b1a4a", "#9775fa", "#ffd8a8"] },
  electronAffinityKjMol: { label: "Electron affinity", unit: "kJ/mol", short: "EA", explain: "Energy released when an atom gains an electron. Halogens release the most; noble gases and filled subshells release none.", ramp: ["#1a2e2a", "#20c997", "#fff3bf"] },
  meltingK: { label: "Melting point", unit: "K", short: "m.p.", explain: "Peaks in the middle of the d-block (tungsten) and at carbon, where many strong bonds must break. Lowest for the noble gases.", ramp: ["#102a52", "#ff922b", "#fff5f5"] },
  density: { label: "Density", unit: "g/cm³", short: "ρ", log: true, explain: "Climbs towards osmium and iridium, the densest elements. Gases are thousands of times less dense than metals, so this scale is logarithmic.", ramp: ["#1c1b3a", "#e64980", "#ffe3e3"] },
  mass: { label: "Atomic mass", unit: "u", short: "Ar", explain: "Rises steadily with atomic number, because heavier nuclei carry more protons and neutrons.", ramp: ["#14243f", "#4dabf7", "#e7f5ff"] },
  discovered: { label: "Year discovered", unit: "", short: "year", explain: "Metals like copper and gold were known in antiquity. Most gases were isolated in the 1700s and 1800s; everything past uranium was made in labs.", ramp: ["#3b1f0f", "#f08c00", "#fff9db"] },
};

export function trendValue(e: Element, key: TrendKey): number | null {
  const v = key === "discovered" ? (e.discovered === 0 ? 1600 : e.discovered) : (e[key] as number | null | undefined);
  return v === null || v === undefined ? null : v;
}

export function trendRange(elements: Element[], key: TrendKey): [number, number] {
  const vals = elements.map((e) => trendValue(e, key)).filter((v): v is number => v !== null && v > 0);
  return [Math.min(...vals), Math.max(...vals)];
}

/** 0..1 position of a value on the scale (log scale where the trend asks for it). */
export function trendT(value: number, [lo, hi]: [number, number], log = false): number {
  if (log) return Math.max(0, Math.min(1, (Math.log(Math.max(value, lo)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))));
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rampColour(ramp: [string, string, string], t: number): string {
  const [a, b] = t < 0.5 ? [hex(ramp[0]), hex(ramp[1])] : [hex(ramp[1]), hex(ramp[2])];
  const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const m = a.map((x, i) => Math.round(x + (b[i]! - x) * k));
  return `#${m.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** State of matter at a temperature (K), at 1 atm, from the melting and boiling points. */
export function phaseAt(e: Element, kelvin: number): "solid" | "liquid" | "gas" | "unknown" {
  if (e.meltingK == null && e.boilingK == null) return e.z > 100 ? "unknown" : e.state;
  if (e.z === 2) return kelvin < (e.boilingK ?? 4.22) ? "liquid" : "gas"; // helium never freezes at 1 atm
  // Sublimers (arsenic): the listed melting point needs high pressure; at 1 atm the solid turns straight to gas.
  if (e.meltingK != null && e.boilingK != null && e.meltingK > e.boilingK) return kelvin < e.boilingK ? "solid" : "gas";
  if (e.meltingK != null && kelvin < e.meltingK) return "solid";
  if (e.boilingK != null && kelvin >= e.boilingK) return "gas";
  return "liquid";
}
