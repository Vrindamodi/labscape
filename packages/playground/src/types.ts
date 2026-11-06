/** Shapes of GET /v1/playground/catalogue (owned by Part 4). */

export type Unit = "mL" | "g" | "drops";

export type ShelfItem = {
  id: string;
  name: string;
  formula: string;
  concentrationM: number | null;
  category: string;
  form: "solution" | "liquid" | "solid";
  solidForm: string | null;
  colour: string;
  opacity: number;
  hazards: string[];
  limits: { min: number; max: number; unit: Unit };
  description: string;
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

export function liquidMl(t: TrayItem): number {
  if (t.item.form === "solid") return 0;
  return t.item.limits.unit === "drops" ? t.amount * 0.05 : t.amount;
}
