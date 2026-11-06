import type { Amounts } from "./chem";

/** Stock solutions and solids on the shelf. Compositions are per mL (mol/mL) or per g. */
export type Reagent = {
  id: string;
  name: string;
  formula: string;
  /** mol per mL of solution for each dissolved component. */
  perMl?: Amounts;
  /** Concentrated sulfuric acid: mol of undiluted acid per mL (drives the dilution hazard). */
  concAcidPerMl?: number;
  /** Solid metal: molar mass, g/mol. */
  metal?: { symbol: "Mg" | "Fe" | "Zn" | "Cu"; molarMass: number; /** surface area factor */ area: number };
  densityGPerMl: number;
  hazards: ("corrosive" | "irritant" | "toxic" | "flammable" | "oxidiser" | "harmful" | "environment")[];
  corrosive?: boolean;
  odour?: string;
  /** Display colour of the stock, hex. */
  hex: string;
};

const sol = (id: string, name: string, formula: string, perL: Amounts, hex: string, hazards: Reagent["hazards"] = [], extra: Partial<Reagent> = {}): Reagent => {
  const perMl: Amounts = {};
  for (const k in perL) perMl[k as keyof Amounts] = (perL[k as keyof Amounts] ?? 0) / 1000;
  return { id, name, formula, perMl, densityGPerMl: 1, hazards, hex, ...extra };
};

/** Indicator stock: a tiny analytical amount that colours strongly. */
const IND = 2e-3; // mol/L, typical 0.1-1 % indicator solutions

export const REAGENTS: Record<string, Reagent> = Object.fromEntries(
  ([
    sol("water", "Distilled water", "H₂O", {}, "#cfe6ff"),
    sol("hcl-0.1", "Hydrochloric acid 0.100 M", "HCl", { "Cl-": 0.1 }, "#e8f3ff", ["irritant"]),
    sol("hcl-1", "Hydrochloric acid 1.0 M", "HCl", { "Cl-": 1 }, "#e8f3ff", ["corrosive"], { corrosive: true, odour: "sharp, choking" }),
    sol("hcl-2", "Hydrochloric acid 2.0 M", "HCl", { "Cl-": 2 }, "#e8f3ff", ["corrosive"], { corrosive: true, odour: "sharp, choking" }),
    sol("naoh-0.1", "Sodium hydroxide 0.100 M", "NaOH", { "Na+": 0.1 }, "#eef6ff", ["irritant"]),
    sol("naoh-1", "Sodium hydroxide 1.0 M", "NaOH", { "Na+": 1 }, "#eef6ff", ["corrosive"], { corrosive: true }),
    sol("phph", "Phenolphthalein", "C₂₀H₁₄O₄", { phph: IND }, "#ffffff", ["flammable"]),
    sol("univ", "Universal indicator", "UI", { univ: IND }, "#3fae5a", ["flammable"]),
    sol("litmus", "Litmus solution", "litmus", { litmus: IND }, "#7b4fb5"),
    sol("cuso4-0.5", "Copper(II) sulfate 0.50 M", "CuSO₄", { "Cu2+": 0.5, "SO4^2-": 0.5 }, "#2f86ff", ["harmful", "environment"]),
    sol("bacl2-0.1", "Barium chloride 0.10 M", "BaCl₂", { "Ba2+": 0.1, "Cl-": 0.2 }, "#eef6ff", ["toxic"]),
    sol("na2so4-0.1", "Sodium sulfate 0.10 M", "Na₂SO₄", { "Na+": 0.2, "SO4^2-": 0.1 }, "#eef6ff"),
    sol("licl", "Lithium chloride solution", "LiCl", { "Li+": 0.5, "Cl-": 0.5 }, "#eef6ff", ["harmful"]),
    sol("nacl", "Sodium chloride solution", "NaCl", { "Na+": 0.5, "Cl-": 0.5 }, "#eef6ff"),
    sol("kcl", "Potassium chloride solution", "KCl", { "K+": 0.5, "Cl-": 0.5 }, "#eef6ff"),
    sol("cacl2", "Calcium chloride solution", "CaCl₂", { "Ca2+": 0.5, "Cl-": 1 }, "#eef6ff", ["irritant"]),
    sol("cucl2", "Copper(II) chloride solution", "CuCl₂", { "Cu2+": 0.5, "Cl-": 1 }, "#39a0d8", ["harmful"]),
    sol("h2so4-conc", "Concentrated sulfuric acid", "H₂SO₄", { "SO4^2-": 18 }, "#f3f1ea", ["corrosive"], { corrosive: true, concAcidPerMl: 0.018, densityGPerMl: 1.84 }),
    { id: "mg-ribbon", name: "Magnesium ribbon", formula: "Mg", metal: { symbol: "Mg", molarMass: 24.31, area: 1 }, densityGPerMl: 1.74, hazards: ["flammable"], hex: "#c9ccd2" },
    { id: "iron-nail", name: "Iron nail (cleaned)", formula: "Fe", metal: { symbol: "Fe", molarMass: 55.85, area: 0.12 }, densityGPerMl: 7.87, hazards: [], hex: "#8a8f99" },
  ] satisfies Reagent[]).map((r) => [r.id, r]),
);

export function reagent(id: string): Reagent {
  const r = REAGENTS[id];
  if (!r) throw new Error(`Unknown reagent ${id}`);
  return r;
}
