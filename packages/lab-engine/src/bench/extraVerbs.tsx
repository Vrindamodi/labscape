import type { LabEvent, LabEventType } from "@labscape/contracts";
import { Filter, Flame, Hand, Power, ScanLine, Waves, Wind } from "lucide-react";
import type { ReactNode } from "react";
import { KINDS } from "../engine/equipment";
import type { Item } from "../engine/state";

/**
 * Extra things a learner can do on the bench (Part 5: the rest of the library). Kept apart from
 * the Workbench so the core hand/pour code stays small: each verb says which items offer it, what
 * it can be used on, and which LabEvents it sends.
 */
export type ExtraVerbId = "heat" | "blow-out" | "litmus" | "power" | "bath" | "waft" | "filter";

export type ExtraVerb = { id: ExtraVerbId; label: string; icon: ReactNode; target: boolean; button?: string };

type Ev = { type: LabEventType; payload: Extract<LabEvent, { type: LabEventType }>["payload"] };

const heatable = (it: Item) => !!it.liquid && it.liquid.volumeMl > 0 && (KINDS[it.kind].fits.includes("tripod") || it.kind === "boiling_tube");

/** The extra verbs an item offers in the hand, given what else is on the bench. */
export function extraVerbsFor(it: Item, items: Item[]): ExtraVerb[] {
  const v: ExtraVerb[] = [];
  const has = (k: Item["kind"]) => items.some((i) => i.kind === k);
  if (it.kind === "bunsen" && it.gasOn && has("tripod")) v.push({ id: "heat", label: "Heat a vessel", icon: <Flame className="h-4 w-4" />, target: true });
  if (it.kind === "splint" && it.lit) v.push({ id: "blow-out", label: "Blow out", icon: <Wind className="h-4 w-4" />, target: false, button: "Blow it out (keep it glowing)" });
  if (it.kind === "litmus_paper") v.push({ id: "litmus", label: "Hold near", icon: <ScanLine className="h-4 w-4" />, target: true });
  if (it.electrodes) v.push({ id: "power", label: (it.volts ?? 0) > 0 ? "Power off" : "Power on", icon: <Power className="h-4 w-4" />, target: false, button: (it.volts ?? 0) > 0 ? "Switch the power pack off" : "Switch on: 6 V d.c." });
  if ((it.kind === "boiling_tube" || it.kind === "test_tube") && (it.liquid?.volumeMl ?? 0) > 0 && items.some((b) => b.id !== it.id && b.kind.startsWith("beaker") && (b.liquid?.tempC ?? 0) > 40)) {
    v.push({ id: "bath", label: "Into water bath", icon: <Waves className="h-4 w-4" />, target: true });
  }
  const l = it.liquid;
  const smelly = !!l && !!(l.ions.EtOH || l.ions.CH3COOH_T || l.ions.EtOAc || l.solids.S);
  if (l && l.volumeMl > 0 && smelly && it.kind !== "reagent_bottle" && it.kind !== "dropper_bottle" && it.kind !== "wash_bottle") {
    v.push({ id: "waft", label: "Waft to smell", icon: <Hand className="h-4 w-4" />, target: false, button: "Waft the vapour towards you" });
  }
  if (it.liquid && it.liquid.volumeMl > 0 && KINDS[it.kind].pours && it.kind !== "reagent_bottle" && has("funnel")) v.push({ id: "filter", label: "Filter into", icon: <Filter className="h-4 w-4" />, target: true });
  return v;
}

/** Can this item take the extra verb? */
export function extraAccepts(verb: string, held: Item, it: Item): boolean {
  switch (verb) {
    case "heat":
      return heatable(it) && it.kind !== "boiling_tube";
    case "litmus":
      return !!it.liquid && it.liquid.volumeMl > 0 && it.kind !== "reagent_bottle" && it.kind !== "dropper_bottle";
    case "bath":
      return it.kind.startsWith("beaker") && (it.liquid?.tempC ?? 0) > 40;
    case "filter":
      return !!it.liquid && it.id !== held.id && (it.kind === "evaporating_basin" || it.kind === "conical_flask_100" || it.kind.startsWith("beaker"));
    // Core verbs that Part 5 widens: a splint at the mouth of a cylinder or flask, a tube over an electrode.
    case "mouth":
      return !!it.liquid && it.kind !== "reagent_bottle" && it.kind !== "dropper_bottle" && it.kind !== "wash_bottle";
    case "collect":
      return !!it.electrodes && (it.liquid?.volumeMl ?? 0) > 0;
    default:
      return false;
  }
}

/** The events a verb sends (target verbs get the target id). */
export function extraEvents(verb: ExtraVerbId, it: Item, to?: string): Ev[] {
  switch (verb) {
    case "heat":
      return to ? [{ type: "equipment.connect", payload: { from: it.id, to, port: "under" } }] : [];
    case "blow-out":
      return [{ type: "param.set", payload: { key: `glow:${it.id}`, value: true } }];
    case "litmus":
      return to ? [{ type: "equipment.connect", payload: { from: it.id, to, port: "test" } }] : [];
    case "power":
      return [{ type: "param.set", payload: { key: `power:${it.id}`, value: (it.volts ?? 0) > 0 ? 0 : 6 } }];
    case "bath":
      return to ? [{ type: "equipment.connect", payload: { from: it.id, to, port: "bath" } }] : [];
    case "waft":
      return [{ type: "param.set", payload: { key: `waft:${it.id}`, value: true } }];
    case "filter":
      return to ? [{ type: "equipment.connect", payload: { from: it.id, to, port: "filter" } }] : [];
  }
}

export const EXTRA_VERB_IDS: readonly string[] = ["heat", "blow-out", "litmus", "power", "bath", "waft", "filter"];

/** Grams per "Tip in" for the new solids. */
export const EXTRA_MASS_G: Record<string, number> = { "zn-foil": 0.3, "iron-filings": 0.5, "cu-foil": 0.3, cuo: 0.4 };
