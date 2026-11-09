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
  /** Basic oxide powder (copper(II) oxide): dissolves in acid over time. */
  oxide?: { molarMass: number };
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
    // Part 5: the rest of the library.
    { id: "zn-foil", name: "Zinc foil strip", formula: "Zn", metal: { symbol: "Zn", molarMass: 65.38, area: 0.6 }, densityGPerMl: 7.14, hazards: [], hex: "#a9b1bb" },
    { id: "iron-filings", name: "Iron filings", formula: "Fe", metal: { symbol: "Fe", molarMass: 55.85, area: 1 }, densityGPerMl: 7.87, hazards: [], hex: "#6f7680" },
    { id: "cu-foil", name: "Copper foil strip", formula: "Cu", metal: { symbol: "Cu", molarMass: 63.55, area: 0.6 }, densityGPerMl: 8.96, hazards: [], hex: "#c27a4a" },
    { id: "cuo", name: "Copper(II) oxide powder", formula: "CuO", oxide: { molarMass: 79.55 }, densityGPerMl: 6.3, hazards: ["harmful", "environment"], hex: "#1b1b1d" },
    sol("znso4-0.5", "Zinc sulfate 0.50 M", "ZnSO₄", { "Zn2+": 0.5, "SO4^2-": 0.5 }, "#eef6ff", ["irritant"]),
    sol("feso4-0.5", "Iron(II) sulfate 0.50 M", "FeSO₄", { "Fe2+": 0.5, "SO4^2-": 0.5 }, "#dcefd2", ["harmful"]),
    sol("mgso4-0.5", "Magnesium sulfate 0.50 M", "MgSO₄", { "Mg2+": 0.5, "SO4^2-": 0.5 }, "#eef6ff"),
    sol("h2o2-6", "Hydrogen peroxide 6% (20 vol)", "H₂O₂", { H2O2: 1.76 }, "#eef6ff", ["irritant", "oxidiser"]),
    sol("ki-1", "Potassium iodide solution 1.0 M", "KI", { "K+": 1, "I-": 1 }, "#f2f4ff"),
    sol("detergent", "Washing-up liquid", "detergent", { soap: 0.2 }, "#9fe3a8"),
    sol("thio-0.15", "Sodium thiosulfate 0.15 M", "Na₂S₂O₃", { "Na+": 0.3, "S2O3^2-": 0.15 }, "#eef6ff"),
    sol("h2so4-1", "Dilute sulfuric acid 1.0 M", "H₂SO₄", { "SO4^2-": 1 }, "#eef6ff", ["irritant"]),
    sol("ethanol", "Ethanol", "C₂H₅OH", { EtOH: 17.1 }, "#f6f8ff", ["flammable"], { densityGPerMl: 0.79, odour: "sharp, like surgical spirit" }),
    sol("ethanoic-glacial", "Glacial ethanoic acid", "CH₃COOH", { CH3COOH_T: 17.4 }, "#f6f8ff", ["corrosive", "flammable"], { corrosive: true, densityGPerMl: 1.05, odour: "strong vinegar" }),
    sol("brine", "Sodium chloride solution (brine) 3 M", "NaCl", { "Na+": 3, "Cl-": 3 }, "#eef6ff"),
  ] satisfies Reagent[]).map((r) => [r.id, r]),
);

export function reagent(id: string): Reagent {
  const r = REAGENTS[id];
  if (!r) throw new Error(`Unknown reagent ${id}`);
  return r;
}
