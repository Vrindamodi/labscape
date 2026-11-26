/** Shapes of GET /v1/playground/catalogue (owned by Part 4). */

export type Unit = "mL" | "g" | "drops";

export type ElementView = {
  z: number;
  symbol: string;
  category: string;
  state: "s" | "l" | "g";
  electronegativity: number | null;
  atomicMass: number;
  radioactive: boolean;
  superheavy: boolean;
};

export type ShelfItem = {
  id: string;
  name: string;
  formula: string;
  concentrationM: number | null;
  category: string;
  form: "solution" | "liquid" | "solid" | "gas";
  solidForm: string | null;
  colour: string;
  opacity: number;
  hazards: string[];
  limits: { min: number; max: number; unit: Unit };
  description: string;
  element: ElementView | null;
};

export type DiscoveryDef = { id: string; name: string; type: string; clue: string };

export type CatalogueResponse = {
  version: string;
  safetyEngineOnline: boolean;
  substances: ShelfItem[];
  discoveries: DiscoveryDef[];
  conditions: {
    minTemperatureC: number;
    maxTemperatureC: number;
    defaultTemperatureC: number;
    vesselCapacityMl: number;
  };
};

export type TrayItem = { key: string; item: ShelfItem; amount: number };

/**
 * One suggestion from POST /v1/playground/try-next: add a shelf item (`ref` is its catalogue id) or
 * use a bench tool. `teaser` hints at what to look for; `discoveryId` is the journal entry it unlocks.
 */
export type TryNextHint = {
  kind: "add" | "heat" | "spark";
  ref?: string;
  name: string;
  teaser: string;
  discoveryId?: string;
  type?: string;
};

/** How a substance is dispensed by hand. */
export type DispenseMode = "pour" | "dropper" | "spatula" | "gas";

export function dispenseMode(item: ShelfItem): DispenseMode {
  if (item.form === "gas") return "gas";
  if (item.form === "solid") return "spatula";
  if (item.limits.unit === "drops") return "dropper";
  return "pour";
}

export function liquidMl(t: TrayItem): number {
  if (t.item.form === "solid" || t.item.form === "gas") return 0;
  if (t.item.element) return 0; // bromine / mercury: tiny volumes
  return t.item.limits.unit === "drops" ? t.amount * 0.05 : t.amount;
}

export const CATEGORY_COLOURS: Record<string, string> = {
  alkali: "#ff6b6b",
  "alkaline-earth": "#ffa94d",
  transition: "#ffd43b",
  "post-transition": "#a9e34b",
  metalloid: "#38d9a9",
  nonmetal: "#4dabf7",
  halogen: "#9775fa",
  noble: "#f783ac",
  lanthanide: "#e599f7",
  actinide: "#ff8fab",
};

export const CATEGORY_LABELS: Record<string, string> = {
  alkali: "Alkali metals",
  "alkaline-earth": "Alkaline earth metals",
  transition: "Transition metals",
  "post-transition": "Post-transition metals",
  metalloid: "Metalloids",
  nonmetal: "Non-metals",
  halogen: "Halogens",
  noble: "Noble gases",
  lanthanide: "Lanthanides",
  actinide: "Actinides",
};

/** Grid position of an element in the standard 18-column table (rows 9-10 = f-block). */
export function tablePosition(z: number): { row: number; col: number } {
  if (z === 1) return { row: 1, col: 1 };
  if (z === 2) return { row: 1, col: 18 };
  if (z <= 4) return { row: 2, col: z - 2 };
  if (z <= 10) return { row: 2, col: z + 8 };
  if (z <= 12) return { row: 3, col: z - 10 };
  if (z <= 18) return { row: 3, col: z };
  if (z <= 36) return { row: 4, col: z - 18 };
  if (z <= 54) return { row: 5, col: z - 36 };
  if (z <= 56) return { row: 6, col: z - 54 };
  if (z <= 71) return { row: 9, col: z - 54 };
  if (z <= 86) return { row: 6, col: z - 68 };
  if (z <= 88) return { row: 7, col: z - 86 };
  if (z <= 103) return { row: 10, col: z - 86 };
  return { row: 7, col: z - 100 };
}
