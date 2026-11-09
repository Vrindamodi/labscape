import type { LabEvent, ObservationCue, Oklab } from "@labscape/contracts";
import { equilibrate, FLAME, lerpLab, MOLAR_GAS_ML, PRECIPITATES, solvePh, type Amounts, type Ion } from "./chem";
import { KINDS } from "./equipment";
import { reagent } from "./reagents";
import { clone, emptyLiquid, initialState, liquidOf, look, type Item, type LabState, type Liquid } from "./state";

/** A sentence for screen readers and the observation log, paired with each cue. */
export type Note = { text: string; tone: "info" | "success" | "warning" | "danger"; target?: string; key?: string };

export type StepOutput = { state: LabState; cues: ObservationCue[]; notes: Note[] };

const STEP_MS = 100;
const WATER_HEAT = 4.18; // J/(g K)

/* ================================================================== public API */

/** Pure: apply one LabEvent (advancing the clock to event.t first). Never mutates its input. */
export function applyEvent(prev: LabState, event: LabEvent): StepOutput {
  const out: StepOutput = { state: clone(prev), cues: [], notes: [] };
  advanceInPlace(out, Math.max(0, event.t - out.state.t));
  out.state.seq = event.seq;
  apply(out, event);
  return out;
}

/** Pure: let time pass with no user action (mixing, heating, reactions, settling). */
export function advance(prev: LabState, dtMs: number): StepOutput {
  const out: StepOutput = { state: clone(prev), cues: [], notes: [] };
  advanceInPlace(out, dtMs);
  return out;
}

/**
 * Lets time pass in fixed ticks up to `until`, calling `onTick` after each one, on a single working
 * copy. Same steps and results as calling advance() once per tick, without copying the whole bench
 * every tick (long waits replay many times faster, which matters for server scoring).
 */
export function advanceTicks(prev: LabState, tickMs: number, until: number, onTick: (out: StepOutput) => void): LabState {
  if (prev.t + tickMs > until) return prev;
  const out: StepOutput = { state: clone(prev), cues: [], notes: [] };
  while (out.state.t + tickMs <= until) {
    out.cues = [];
    out.notes = [];
    advanceInPlace(out, tickMs);
    onTick(out);
  }
  return out.state;
}

/** Replays a whole log from the bench setup. Used by the server to re-score and by "resume". */
export function replay(setup: LabState["setup"], events: LabEvent[]): StepOutput {
  let state = initialState(setup);
  const cues: ObservationCue[] = [];
  const notes: Note[] = [];
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    const r = applyEvent(state, e);
    state = r.state;
    cues.push(...r.cues);
    notes.push(...r.notes);
  }
  return { state, cues, notes };
}

/* ================================================================== events */

function apply(out: StepOutput, e: LabEvent) {
  const s = out.state;
  switch (e.type) {
    case "liquid.pour":
    case "liquid.drop": {
      const { from, to, volumeMl } = e.payload;
      transfer(out, from, to, volumeMl, e.type === "liquid.drop");
      break;
    }
    case "liquid.draw": {
      const { from, into, volumeMl } = e.payload;
      transfer(out, from, into, volumeMl, false);
      break;
    }
    case "solid.add": {
      const { from, to, massG } = e.payload;
      const target = s.items[to];
      const r = reagent(from);
      if (target?.liquid && r.oxide) {
        // A spatula of basic oxide powder: it sits as a black solid until the acid dissolves it.
        const before = look(target);
        target.liquid.solids.CuO = (target.liquid.solids.CuO ?? 0) + massG / r.oxide.molarMass;
        note(out, `A spatula of ${r.name.toLowerCase()} goes into the ${target.label.toLowerCase()}.`, "info", to);
        cue(out, { kind: "sound", target: to, soundId: "clink" });
        settle(out, target, before, "sigmoid");
        break;
      }
      if (!target?.liquid || !r.metal) break;
      const mol = massG / r.metal.molarMass;
      target.metals.push({ symbol: r.metal.symbol, mol, initialMol: mol, area: r.metal.area });
      note(out, `${r.name} added to the ${target.label.toLowerCase()}.`, "info", to);
      cue(out, { kind: "sound", target: to, soundId: "clink" });
      break;
    }
    case "mix.swirl":
      mix(out, e.payload.target, e.payload.durationMs, 600);
      break;
    case "mix.stir":
      mix(out, e.payload.target, e.payload.durationMs, e.payload.intensity === "vigorous" ? 330 : 1000);
      break;
    case "mix.shake": {
      const it = s.items[e.payload.target];
      mix(out, e.payload.target, e.payload.durationMs, 250);
      if (it && !it.stoppered && it.liquid && it.liquid.volumeMl > 1) spill(out, it, Math.min(it.liquid.volumeMl, 0.5), "bench");
      break;
    }
    case "heat.set": {
      const it = s.items[e.payload.target];
      if (it?.kind === "bunsen") {
        const was = it.gasOn;
        it.gasOn = e.payload.powerPct > 0;
        // Gas off: the burner is moved away, so lighting it again heats nothing until it is placed.
        if (!it.gasOn && it.heats) it.heats = null;
        if (it.gasOn && !was) {
          note(out, `Bunsen lit with the air hole ${it.airHoleOpen ? "open: a hot blue roaring flame" : "closed: a yellow, cooler, sooty flame"}.`, "info", it.id);
          cue(out, { kind: "flame", target: it.id, colour: it.airHoleOpen ? BLUE_FLAME : YELLOW_FLAME, intensity: it.airHoleOpen ? 1 : 0.6, durationMs: 0 });
        }
      }
      break;
    }
    case "cool.set": {
      const it = s.items[e.payload.target];
      if (it) it.inIceBath = e.payload.method === "ice_bath";
      break;
    }
    case "equipment.place": {
      const it = s.items[e.payload.equipmentId];
      if (!it) break;
      it.x = e.payload.x;
      it.z = e.payload.y;
      it.socket = e.payload.socket ?? null;
      if (it.kind === "thermometer" && !e.payload.socket?.startsWith("vessel:")) it.inVessel = null;
      break;
    }
    case "equipment.pickup":
      break;
    case "equipment.connect":
      connect(out, e.payload.from, e.payload.to, e.payload.port ?? "");
      break;
    case "param.set":
      param(out, e.payload.key, e.payload.value);
      break;
    case "sim.reset":
      out.state = { ...initialState(s.setup), t: s.t, seq: s.seq };
      break;
    default:
      break; // measure.read, hint.shown, step.completed, deviation, outcome: log-only
  }
}

/** Moves liquid between items. "bench" (or a mis-aimed pour) is a spill. */
function transfer(out: StepOutput, fromId: string, toId: string, volumeMl: number, dropwise: boolean) {
  const s = out.state;
  const from = s.items[fromId];
  if (!from?.liquid) return;
  let vol = Math.max(0, Math.min(volumeMl, from.liquid.volumeMl));
  if (vol <= 0) return;

  // An air bubble left in the burette tip: the first 0.10 mL of reading never reaches the flask.
  let lost = 0;
  if (from.kind === "burette_50" && from.tipBubble) {
    lost = Math.min(0.1, vol);
    from.tipBubble = false;
    note(out, "The air bubble in the burette tip was pushed out — that volume never reached the flask.", "warning", fromId);
  }
  const portion = take(from.liquid, vol);
  vol -= lost;
  if (lost > 0) scale(portion, (portion.volumeMl - lost) / portion.volumeMl);

  const to = toId === "bench" ? undefined : s.items[toId];
  if (!to?.liquid) {
    spill(out, from, vol, toId);
    return;
  }
  if (to.kind === "burette_50") {
    to.tipBubble = true; // filling always traps air in the tip until it is run out
  }
  const capacity = KINDS[to.kind].capacityMl;
  const room = Math.max(0, capacity - to.liquid.volumeMl);
  if (portion.volumeMl > room) {
    const over = take(portion, portion.volumeMl - room);
    spill(out, to, over.volumeMl, "bench");
    note(out, `The ${to.label.toLowerCase()} overflowed.`, "warning", toId);
  }
  addInto(out, to, portion, dropwise);
}

/** Removes `ml` from a liquid as a proportional portion (dissolved and suspended). */
function take(l: Liquid, ml: number): Liquid {
  const f = l.volumeMl > 0 ? Math.min(1, ml / l.volumeMl) : 0;
  const portion = emptyLiquid(l.tempC);
  portion.volumeMl = l.volumeMl * f;
  // The plume is part of the liquid; a pour from a vessel carries both.
  if (l.plume) merge(l, 1);
  for (const k in l.ions) {
    const key = k as Ion;
    const amt = (l.ions[key] ?? 0) * f;
    portion.ions[key] = amt;
    l.ions[key] = (l.ions[key] ?? 0) - amt;
  }
  for (const k in l.solids) {
    const key = k as keyof Liquid["solids"];
    const amt = (l.solids[key] ?? 0) * f;
    portion.solids[key] = amt;
    l.solids[key] = (l.solids[key] ?? 0) - amt;
  }
  portion.concAcidMol = l.concAcidMol * f;
  l.concAcidMol -= portion.concAcidMol;
  l.volumeMl -= portion.volumeMl;
  portion.ph = l.ph;
  if (l.volumeMl < 1e-6) Object.assign(l, emptyLiquid(l.tempC));
  return portion;
}

function scale(l: Liquid, f: number) {
  l.volumeMl *= f;
  for (const k in l.ions) l.ions[k as Ion] = (l.ions[k as Ion] ?? 0) * f;
  l.concAcidMol *= f;
}

/** A new addition enters as an unmixed plume; heat effects happen on contact. */
function addInto(out: StepOutput, to: Item, add: Liquid, dropwise: boolean) {
  const l = to.liquid!;
  const before = look(to);
  const addMass = add.volumeMl * (add.concAcidMol > 0 ? 1.84 : 1);
  const bulkMass = l.volumeMl * (l.concAcidMol > 0 ? 1.84 : 1);

  // Temperature of the mixture by heat capacity.
  if (l.volumeMl + add.volumeMl > 0) {
    l.tempC = (l.tempC * bulkMass + add.tempC * addMass) / Math.max(bulkMass + addMass, 1e-6);
  }

  // Concentrated acid meets water. Water floats on the dense acid and boils on contact (spatter);
  // acid poured into water sinks and spreads its heat through the whole bulk.
  if (l.concAcidMol > 0 && add.concAcidMol === 0 && add.volumeMl > 0) {
    // Each mol of acid needs ~10 mol of water to dilute; a small splash of water dilutes only that much.
    const diluted = Math.min(l.concAcidMol, (add.volumeMl * 55.5) / 1000 / 10);
    const q = 74_000 * diluted;
    const localRise = q / Math.max(addMass * WATER_HEAT, 0.01);
    l.concAcidMol -= diluted;
    l.tempC += q / ((bulkMass + addMass) * WATER_HEAT);
    if (localRise > 60) {
      out.state.seen["acid-spatter"] = (out.state.seen["acid-spatter"] ?? 0) + 1;
      cue(out, { kind: "sound", target: to.id, soundId: "spatter" });
      cue(out, { kind: "smoke", target: to.id, colour: { L: 0.95, a: 0, b: 0 }, density: 0.6, durationMs: 1500 } as ObservationCue);
      note(out, "Water added to concentrated acid boils on the surface and spits hot acid. Always add acid to water, slowly.", "danger", to.id);
      spill(out, to, Math.min(0.3, l.volumeMl), "bench", true);
    }
  } else if (add.concAcidMol > 0) {
    const q = 74_000 * add.concAcidMol;
    const rise = q / ((bulkMass + addMass) * WATER_HEAT);
    l.tempC += rise;
    add.concAcidMol = l.volumeMl * 55.5 / 1000 > 10 * add.concAcidMol ? 0 : add.concAcidMol;
    if (rise > 2) cue(out, { kind: "temperature", target: to.id, deltaC: round(rise, 1), tauMs: 4000 });
  }

  // Neutralisation heat: strong acid meeting strong base releases 57 kJ per mol of water formed.
  const acidity = (x: Amounts) => -netCharge(x);
  const a1 = acidity(l.ions);
  const a2 = acidity(add.ions);
  const neutralised = a1 * a2 < 0 ? Math.min(Math.abs(a1), Math.abs(a2)) : 0;
  if (neutralised > 0) {
    const rise = (57_000 * neutralised) / ((bulkMass + addMass) * WATER_HEAT);
    l.tempC += rise;
    if (rise >= 0.5) cue(out, { kind: "temperature", target: to.id, deltaC: round(rise, 1), tauMs: 3000 });
  }

  // Enter as a plume (unmixed) for coloured local effects; precipitates form on contact.
  // All ions join the bulk at once (so precipitates form on contact); the plume is a visual copy of
  // the unmixed addition that drives the local colour and pH until the vessel is mixed.
  const plume = l.plume ?? { volumeMl: 0, ions: {}, ph: 7 };
  plume.volumeMl += add.volumeMl;
  for (const k in add.ions) {
    plume.ions[k as Ion] = (plume.ions[k as Ion] ?? 0) + (add.ions[k as Ion] ?? 0);
    l.ions[k as Ion] = (l.ions[k as Ion] ?? 0) + (add.ions[k as Ion] ?? 0);
  }
  for (const k in add.solids) {
    const key = k as keyof Liquid["solids"];
    l.solids[key] = (l.solids[key] ?? 0) + (add.solids[key] ?? 0);
  }
  l.concAcidMol += add.concAcidMol;
  l.volumeMl += add.volumeMl;
  l.plume = plume;
  // Local pH where the drop lands: the plume plus an equal volume of the bulk around it.
  plume.ph = localPh(l);
  settle(out, to, before, dropwise ? "flash-fade" : "sigmoid");
  cue(out, { kind: "sound", target: to.id, soundId: dropwise ? "plink" : "pour" });
}

/** pH in the zone where an addition lands, before it is mixed in. */
function localPh(l: Liquid): number {
  if (!l.plume) return l.ph;
  const bulkVol = Math.max(0, l.volumeMl - l.plume.volumeMl);
  // The contact zone is the addition plus a thin shell of surrounding liquid (30% of its volume).
  const share = bulkVol > 0 ? Math.min(1, (0.3 * l.plume.volumeMl) / bulkVol) : 0;
  const local: Amounts = {};
  // Surrounding liquid = bulk minus the plume's own ions, sampled at the plume's volume.
  for (const k in l.ions) local[k as Ion] = Math.max(0, (l.ions[k as Ion] ?? 0) - (l.plume.ions[k as Ion] ?? 0)) * share;
  for (const k in l.plume.ions) local[k as Ion] = (local[k as Ion] ?? 0) + (l.plume.ions[k as Ion] ?? 0);
  return solvePh(local, l.plume.volumeMl + bulkVol * share);
}

function netCharge(x: Amounts) {
  const z: Partial<Record<Ion, number>> = { "Na+": 1, "K+": 1, "Li+": 1, "Ca2+": 2, "Mg2+": 2, "Ba2+": 2, "Cu2+": 2, "Fe2+": 2, "Zn2+": 2, "Ag+": 1, "Pb2+": 2, "Cl-": -1, "SO4^2-": -2, "NO3-": -1, "I-": -1, "Br-": -1, "S2O3^2-": -2 };
  let c = 0;
  for (const k in x) c += (z[k as Ion] ?? 0) * (x[k as Ion] ?? 0);
  return c;
}

/** Mixing: the unmixed plume shrinks away (its ions are already in the bulk). */
function merge(l: Liquid, fraction: number) {
  if (!l.plume) return;
  const f = Math.min(1, Math.max(0, fraction));
  for (const k in l.plume.ions) l.plume.ions[k as Ion] = (l.plume.ions[k as Ion] ?? 0) * (1 - f);
  l.plume.volumeMl *= 1 - f;
  // Once the unmixed part is a tiny fraction of the vessel it is no longer visible.
  if (l.plume.volumeMl < Math.max(0.002, 0.001 * l.volumeMl) || f >= 0.999) l.plume = null;
  if (l.plume) l.plume.ph = localPh(l);
}

function mix(out: StepOutput, id: string, durationMs: number, tauMs: number) {
  const it = out.state.items[id];
  if (!it?.liquid) return;
  const before = look(it);
  merge(it.liquid, 1 - Math.exp(-durationMs / tauMs));
  settle(out, it, before, "sigmoid");
}

/** Emits colour / precipitate cues when the look of a vessel changed. */
function settle(out: StepOutput, it: Item, before: ReturnType<typeof look>, curve: "linear" | "sigmoid" | "flash-fade") {
  const l = it.liquid;
  if (!l) return;
  const prevSolids = clone(l.solids);
  l.ph = equilibrate(l.ions, l.solids, l.volumeMl).ph;
  const after = look(it);
  if (!before || !after) return;
  const shown = (x: NonNullable<typeof after>): Oklab => (x.plume ? lerpLab(x.colour, x.plume.colour, x.plume.strength) : x.colour);
  const c0 = shown(before);
  const c1 = shown(after);
  const dE = Math.hypot(c1.L - c0.L, c1.a - c0.a, c1.b - c0.b);
  if (dE > 0.015) {
    cue(out, { kind: "colour", target: it.id, from: c0, to: c1, startMs: 0, durationMs: curve === "flash-fade" ? 600 : 1200, curve });
  }
  for (const k of Object.keys(l.solids) as (keyof Liquid["solids"])[]) {
    const now = l.solids[k] ?? 0;
    const was = prevSolids[k] ?? 0;
    if (now - was > 1e-7) {
      out.state.seen[`precipitate:${k}`] = (out.state.seen[`precipitate:${k}`] ?? 0) + 1;
      cue(out, { kind: "precipitate", target: it.id, id: k, colour: after.sedimentColour ?? c1, turbidity: after.turbidity, settleMs: 9000 });
      if ((out.state.seen[`precipitate:${k}`] ?? 0) === 1 && !PRECIPITATES[k].kinetic) note(out, `A ${precipitateWords(k)} precipitate forms.`, "success", it.id, `ppt-${k}`);
    }
  }
}

function precipitateWords(k: string) {
  return { "Cu(OH)2": "pale blue copper(II) hydroxide", BaSO4: "white barium sulfate", "Mg(OH)2": "white magnesium hydroxide", "Fe(OH)2": "green iron(II) hydroxide", AgCl: "white silver chloride", PbI2: "bright yellow lead(II) iodide", CaSO4: "white calcium sulfate", "Zn(OH)2": "white zinc hydroxide", S: "pale yellow sulfur", CuO: "black copper(II) oxide", "CuSO4.5H2O": "blue copper(II) sulfate crystal" }[k] ?? k;
}

function spill(out: StepOutput, from: Item, volumeMl: number, onto: string, hazardOverride = false) {
  if (volumeMl <= 0) return;
  const r = from.reagentId ? reagent(from.reagentId) : null;
  const hazardous = hazardOverride || !!r?.corrosive || (from.liquid?.concAcidMol ?? 0) > 0;
  out.state.spills.push({ reagentHazard: hazardous, volumeMl: round(volumeMl, 3), at: out.state.t, onto });
  cue(out, { kind: "sound", target: from.id, soundId: "splash" });
  note(
    out,
    hazardous
      ? `Spill! ${round(volumeMl, 2)} mL of a corrosive liquid landed on the ${onto === "bench" ? "bench" : onto}. Clean it up with plenty of water and tell your teacher.`
      : `${round(volumeMl, 2)} mL spilled on the bench.`,
    hazardous ? "danger" : "warning",
    from.id,
  );
}

/* ================================================================== connections & params */

function connect(out: StepOutput, fromId: string, toId: string, port: string) {
  const s = out.state;
  const from = s.items[fromId];
  const to = s.items[toId];
  if (!from) return;
  switch (port) {
    case "under": // bunsen under a tripod-borne vessel
      if (from.kind === "bunsen") from.heats = to ? toId : null;
      break;
    case "in": // thermometer into a vessel
      if (from.kind === "thermometer") from.inVessel = to ? toId : null;
      break;
    case "collect": // inverted tube over a reaction tube
      from.gasTo = to ? toId : null;
      if (to) note(out, `An inverted ${to.label.toLowerCase()} is held over the mouth to collect gas.`, "info", toId);
      break;
    case "dip": {
      if (from.kind !== "wire_loop" || !to?.liquid) break;
      // The loop picks up a film of about 0.01 mL.
      const l = to.liquid;
      const f = l.volumeMl > 0 ? 0.01 / l.volumeMl : 0;
      from.coating = from.coating ?? {};
      for (const k in l.ions) {
        const key = k as Ion;
        if (FLAME[key] || key === "Cl-") from.coating[key] = (from.coating[key] ?? 0) + (l.ions[key] ?? 0) * f;
      }
      break;
    }
    case "flame": {
      const bunsen = to;
      if (from.kind === "wire_loop" && bunsen?.kind === "bunsen" && bunsen.gasOn) {
        from.inFlameMs = 4000;
        flameColour(out, from, bunsen);
      } else if (from.kind === "splint" && bunsen?.kind === "bunsen" && bunsen.gasOn) {
        from.lit = true;
        if (from.glowing) from.glowing = false;
        note(out, "The splint catches light.", "info", fromId);
      }
      break;
    }
    case "mouth": {
      if (from.kind !== "splint" || !to) break;
      const h2 = to.gasMl?.["H2"] ?? 0;
      if (from.lit && h2 >= 1) {
        to.gasMl = { ...to.gasMl, H2: 0 };
        s.seen["pop-test"] = (s.seen["pop-test"] ?? 0) + 1;
        cue(out, { kind: "sound", target: toId, soundId: "squeaky-pop" });
        cue(out, { kind: "light", target: toId, colour: { L: 0.9, a: 0.02, b: 0.12 }, intensity: 0.8, durationMs: 200 });
        note(out, "Squeaky pop! The gas burns with a pop: it is hydrogen.", "success", toId, "pop");
        from.lit = false;
      } else if (from.lit) {
        note(out, "The splint keeps burning quietly: not enough hydrogen collected yet.", "info", toId);
      } else if (from.glowing && (to.gasMl?.["O2"] ?? 0) >= 3) {
        // Oxygen test: a glowing splint bursts back into flame.
        from.glowing = false;
        from.lit = true;
        s.seen["relight"] = (s.seen["relight"] ?? 0) + 1;
        cue(out, { kind: "light", target: toId, colour: { L: 0.88, a: 0.06, b: 0.16 }, intensity: 1, durationMs: 400 });
        cue(out, { kind: "sound", target: toId, soundId: "burner-soft" });
        note(out, "The glowing splint bursts back into flame: the gas is oxygen.", "success", toId, "relight");
      } else if (from.glowing) {
        note(out, "The splint just keeps glowing: there is not enough oxygen here.", "info", toId);
      }
      break;
    }
    case "filter": {
      // Pour through filter paper in a funnel: the liquid passes, every solid stays on the paper.
      const src = from.liquid;
      if (!src || !to?.liquid || src.volumeMl <= 0) break;
      const portion = take(src, src.volumeMl * 0.96); // a little stays wetting the paper
      const residue = Object.keys(portion.solids).length > 0;
      portion.solids = {};
      if (residue) {
        s.seen[`residue:${fromId}`] = 1;
        note(out, "The filter paper holds back the solid; a clear filtrate drips through.", "success", toId, "filtrate");
      }
      cue(out, { kind: "sound", target: toId, soundId: "pour" });
      addInto(out, to, portion, false);
      break;
    }
    case "bath": {
      // A tube stood in a beaker of hot water: it warms gently, with no flame anywhere near.
      from.inBath = to?.liquid ? toId : null;
      if (to?.liquid) note(out, `The ${from.label.toLowerCase()} stands in the hot water bath (${round(to.liquid.tempC, 0)} °C).`, "info", fromId);
      break;
    }
    case "test": {
      // Damp litmus paper held in a gas or dipped in a liquid.
      if (from.kind !== "litmus_paper" || !to) break;
      const cl2 = s.seen[`cl2-ml:${toId}`] ?? 0;
      if (to.electrodes && (to.volts ?? 0) > 0 && cl2 > 0.5) {
        from.litmus = "bleached";
        s.seen["bleach:Cl2"] = (s.seen["bleach:Cl2"] ?? 0) + 1;
        cue(out, { kind: "colour", target: fromId, from: { L: 0.5, a: -0.02, b: -0.14 }, to: { L: 0.97, a: 0, b: 0 }, startMs: 0, durationMs: 1800, curve: "sigmoid" });
        note(out, "The damp litmus paper turns red, then bleaches white: the gas at the anode is chlorine.", "success", toId, "bleach");
      } else if (to.liquid && to.liquid.volumeMl > 0) {
        const ph = to.liquid.ph;
        from.litmus = ph < 5 ? "red" : from.litmus === "bleached" ? "bleached" : "blue";
        note(out, ph < 5 ? "The litmus paper turns red: acidic." : "The litmus paper stays blue.", "info", toId);
      }
      break;
    }
    default:
      break;
  }
}

function param(out: StepOutput, key: string, value: number | string | boolean) {
  const [name, id] = key.split(":");
  const it = id ? out.state.items[id] : undefined;
  if (!it) return;
  switch (name) {
    case "stopcock":
      it.stopcock = Math.max(0, Math.min(1, Number(value)));
      break;
    case "airhole": {
      it.airHoleOpen = Boolean(value);
      if (it.gasOn) {
        cue(out, { kind: "flame", target: it.id, colour: it.airHoleOpen ? BLUE_FLAME : YELLOW_FLAME, intensity: it.airHoleOpen ? 1 : 0.6, durationMs: 0 });
        cue(out, { kind: "sound", target: it.id, soundId: it.airHoleOpen ? "burner-roar" : "burner-soft" });
      }
      break;
    }
    case "stopper":
      it.stoppered = Boolean(value);
      break;
    case "light": // splint lit from a match / burner
      it.lit = Boolean(value);
      break;
    case "clear-bubble":
      if (it.kind === "burette_50") it.tipBubble = false;
      break;
    case "glow": // blow out a lit splint: it keeps glowing red at the tip
      if (it.kind === "splint" && it.lit) {
        it.lit = false;
        it.glowing = true;
        note(out, "You blow the flame out. The tip of the splint glows red.", "info", it.id);
      }
      break;
    case "power": {
      if (!it.electrodes) break;
      const v = Math.max(0, Math.min(12, Number(value)));
      it.volts = v;
      if (!v) it.bubbling = false;
      note(out, v ? `Power pack on: ${v} V d.c. across the carbon electrodes.` : "Power pack off.", "info", it.id);
      cue(out, { kind: "sound", target: it.id, soundId: "clink" });
      break;
    }
    case "waft":
      waft(out, it);
      break;
    default:
      break;
  }
}

/** Waft the vapour towards your nose with your hand: never sniff straight from the tube. */
function waft(out: StepOutput, it: Item) {
  const l = it.liquid;
  if (!l || l.volumeMl <= 0) {
    note(out, "There is nothing in it to smell.", "info", it.id);
    return;
  }
  const litres = l.volumeMl / 1000;
  const ester = (l.ions.EtOAc ?? 0) / litres;
  let smell: string;
  if (ester >= 0.3) {
    smell = "a sweet, fruity smell, like pear drops or nail-varnish remover: an ester has formed";
    out.state.seen["smell:ester"] = (out.state.seen["smell:ester"] ?? 0) + 1;
  } else if ((l.ions.CH3COOH_T ?? 0) > 0) smell = "a sharp smell of vinegar (ethanoic acid)";
  else if ((l.ions.EtOH ?? 0) > 0) smell = "the sharp smell of ethanol";
  else if ((l.solids.S ?? 0) > 0) smell = "a sharp, choking smell of sulfur dioxide";
  else smell = "no strong smell";
  out.state.seen["wafted"] = (out.state.seen["wafted"] ?? 0) + 1;
  cue(out, { kind: "odour", target: it.id, description: smell });
  note(out, `You waft the vapour towards you: ${smell}.`, ester >= 0.3 ? "success" : "info", it.id, ester >= 0.3 ? "ester-smell" : undefined);
}

const BLUE_FLAME: Oklab = { L: 0.62, a: -0.02, b: -0.2 };
const YELLOW_FLAME: Oklab = { L: 0.85, a: 0.05, b: 0.17 };

function flameColour(out: StepOutput, loop: Item, bunsen: Item) {
  const coating = loop.coating ?? {};
  let best: { ion: Ion; amt: number } | null = null;
  for (const k in coating) {
    const ion = k as Ion;
    if (!FLAME[ion]) continue;
    // Sodium's yellow line is so bright it masks others even as a trace.
    const amt = (coating[ion] ?? 0) * (ion === "Na+" ? 6 : 1);
    if (!best || amt > best.amt) best = { ion, amt };
  }
  if (!best || best.amt < 1e-8) {
    note(out, "The wire glows but adds no colour to the flame: the loop is clean.", "success", loop.id, "loop-clean");
    out.state.seen["loop-clean"] = (out.state.seen["loop-clean"] ?? 0) + 1;
    return;
  }
  const f = FLAME[best.ion]!;
  out.state.seen[`flame:${best.ion}`] = (out.state.seen[`flame:${best.ion}`] ?? 0) + 1;
  cue(out, { kind: "flame", target: bunsen.id, colour: f.c, intensity: bunsen.airHoleOpen ? 1 : 0.5, durationMs: 2500 });
  note(out, `The flame turns ${f.name}.`, "success", bunsen.id, `flame-${best.ion}`);
}

/* ================================================================== time */

function advanceInPlace(out: StepOutput, dtMs: number) {
  let left = dtMs;
  while (left > 0) {
    const dt = Math.min(STEP_MS, left);
    tick(out, dt);
    left -= dt;
    out.state.t += dt;
  }
}

function tick(out: StepOutput, dtMs: number) {
  const s = out.state;
  const dt = dtMs / 1000;
  for (const id of Object.keys(s.items).sort()) {
    const it = s.items[id]!;
    const l = it.liquid;
    if (l) {
      // Passive diffusion: coloured additions spread on their own in ~30 s.
      if (l.plume) {
        const before = look(it);
        merge(l, 1 - Math.exp(-dtMs / 9000));
        if (!l.plume) settle(out, it, before, "sigmoid");
      }
      // Metals dissolving.
      if (it.metals.length && l.volumeMl > 0) reactMetals(out, it, dt);
      // Heat in from a burner, out to the room.
      heat(out, it, dt);
      // Part 5 reactions: each only runs when its own substances are present.
      if (l.volumeMl > 0) react5(out, it, dt);
    }
    if (it.kind === "thermometer") {
      const v = it.inVessel ? s.items[it.inVessel]?.liquid : null;
      const target = v && v.volumeMl > 0 ? v.tempC : s.roomC;
      it.readingC = (it.readingC ?? s.roomC) + (target - (it.readingC ?? s.roomC)) * (1 - Math.exp(-dt / 8));
    }
    if (it.kind === "wire_loop" && (it.inFlameMs ?? 0) > 0) {
      it.inFlameMs = Math.max(0, (it.inFlameMs ?? 0) - dtMs);
      // Heating burns the salt film off; acid-washed loops (chloride present) clean faster.
      const burn = 1 - Math.exp(-dt / ((it.coating?.["Cl-"] ?? 0) > 0 ? 0.6 : 1.4));
      for (const k in it.coating ?? {}) it.coating![k as Ion] = (it.coating![k as Ion] ?? 0) * (1 - burn);
    }
  }
}

function reactMetals(out: StepOutput, it: Item, dt: number) {
  const l = it.liquid!;
  const litres = l.volumeMl / 1000;
  const h = Math.pow(10, -l.ph);
  const arrhenius = Math.exp(-6000 * (1 / (l.tempC + 273.15) - 1 / 295.15));
  for (const m of it.metals) {
    if (m.mol <= 1e-9) continue;
    const surface = m.area * Math.pow(m.mol / m.initialMol, 2 / 3);
    if (m.symbol === "Mg") {
      // Mg + 2H+ -> Mg2+ + H2 ; tuned: 0.05 g ribbon in 1 M HCl fizzes away in about 40 s.
      const rate = Math.min(m.mol / dt, 6e-5 * surface * h * arrhenius * Math.max(m.initialMol / 2e-3, 0.4));
      const n = Math.min(m.mol, rate * dt);
      if (n > 0) {
        m.mol -= n;
        l.ions["Mg2+"] = (l.ions["Mg2+"] ?? 0) + n;
        l.tempC += (467_000 * n) / Math.max(l.volumeMl * WATER_HEAT, 0.5);
        gas(out, it, "H2", n * MOLAR_GAS_ML, n / dt);
      }
    } else if (m.symbol === "Fe") {
      // Fe + Cu2+ -> Fe2+ + Cu ; a slow, minutes-long coating.
      const cu = (l.ions["Cu2+"] ?? 0) / litres;
      const n = Math.min(m.mol, l.ions["Cu2+"] ?? 0, 2.5e-6 * surface * cu * arrhenius * dt * 60);
      if (n > 0) {
        m.mol -= n;
        l.ions["Cu2+"] = (l.ions["Cu2+"] ?? 0) - n;
        l.ions["Fe2+"] = (l.ions["Fe2+"] ?? 0) + n;
        it.depositMol += n;
        if ((out.state.seen["deposit:Cu"] ?? 0) === 0 && it.depositMol > 1e-4) {
          out.state.seen["deposit:Cu"] = 1;
          cue(out, { kind: "deposit", target: `solid:${m.symbol}`, colour: { L: 0.6, a: 0.09, b: 0.09 }, durationMs: 60_000 });
          note(out, "A pinky-brown coat of copper starts to form on the iron.", "success", it.id, "deposit");
        }
      }
    }
    displace(out, it, m, surface, arrhenius, dt);
  }
  const before = look(it);
  l.ph = equilibrate(l.ions, l.solids, l.volumeMl).ph;
  const after = look(it);
  if (before && after && Math.hypot(after.colour.L - before.colour.L, after.colour.a - before.colour.a, after.colour.b - before.colour.b) > 0.01) {
    cue(out, { kind: "colour", target: it.id, from: before.colour, to: after.colour, startMs: 0, durationMs: 1000, curve: "linear" });
  }
}

/** Gas produced in a vessel: bubbles cue, routed to a collection tube if one is held over it. */
function gas(out: StepOutput, it: Item, gasName: string, ml: number, molPerS: number, opts: GasOpts = {}) {
  const s = out.state;
  const key = `gas:${gasName}:${it.id}`;
  const prevRate = s.seen[key] ?? 0;
  const ratePerS = molPerS * MOLAR_GAS_ML;
  // Emit a gas cue when bubbling starts or changes a lot.
  if (prevRate === 0 || Math.abs(ratePerS - prevRate) / Math.max(prevRate, 1e-6) > 0.5) {
    cue(out, { kind: "gas", target: it.id, ratePerS: round(ratePerS, 3), bubble: ratePerS > 1 ? "coarse" : ratePerS > 0.2 ? "medium" : "fine", gas: gasName, durationMs: 2000, ...(opts.extra ?? {}) });
    if (prevRate === 0) note(out, opts.text ?? "Fizzing! Bubbles of gas stream off the metal.", "success", it.id, opts.key ?? "fizz");
    s.seen[key] = ratePerS;
  }
  const dest = it.gasTo && opts.collect !== false ? s.items[it.gasTo] : null;
  const holder = dest ?? it;
  holder.gasMl = holder.gasMl ?? {};
  // Only gas captured by an inverted tube stays; an open tube loses most of it.
  holder.gasMl[gasName] = (holder.gasMl[gasName] ?? 0) + ml * (dest ? 0.9 : 0.05);
}

function heat(out: StepOutput, it: Item, dt: number) {
  const s = out.state;
  const l = it.liquid!;
  if (l.volumeMl <= 0) return;
  let power = 0;
  for (const b of Object.values(s.items)) {
    if (b.kind === "bunsen" && b.gasOn && b.heats === it.id) power += b.airHoleOpen ? 320 : 140;
  }
  const mass = l.volumeMl + KINDS[it.kind].heatCapacityJK / WATER_HEAT;
  const loss = (KINDS[it.kind].lossWPerK ?? 0.9) * (l.tempC - s.roomC); // W, to the room
  const ice = it.inIceBath ? 6 * (l.tempC - 0) : 0;
  let dT = ((power - loss - ice) * dt) / (mass * WATER_HEAT);
  const t0 = l.tempC;
  if (l.tempC + dT >= 100 && power > 0) {
    // Boiling: extra heat evaporates water instead of raising the temperature.
    const excess = (l.tempC + dT - 100) * mass * WATER_HEAT;
    l.volumeMl = Math.max(0, l.volumeMl - excess / 2260);
    dT = 100 - l.tempC;
    if ((s.seen[`boil:${it.id}`] ?? 0) === 0) {
      s.seen[`boil:${it.id}`] = 1;
      cue(out, { kind: "gas", target: it.id, ratePerS: 1, bubble: "coarse", gas: "steam", durationMs: 0 });
      note(out, "The water is boiling.", "info", it.id);
    }
  }
  l.tempC += dT;
  if (power > 0 && l.volumeMl < 4 && (l.ions["Cu2+"] ?? 0) > 0 && !s.seen[`boil-dry:${it.id}`]) {
    // Heating a salt solution almost to dryness: it spits and the crystals lose their water.
    s.seen[`boil-dry:${it.id}`] = 1;
    cue(out, { kind: "sound", target: it.id, soundId: "spatter" });
    note(out, "The last of the solution spits hot crystals out of the basin and the blue solid turns white. Never heat it to dryness.", "danger", it.id);
  }
  if (Math.floor(t0 / 5) !== Math.floor(l.tempC / 5) && Math.abs(l.tempC - s.roomC) > 3) {
    cue(out, { kind: "temperature", target: it.id, deltaC: round(l.tempC - t0, 2), tauMs: 1000 });
  }
}

/* ================================================================== Part 5 reactions */

type GasOpts = { text?: string; key?: string; collect?: boolean; extra?: Partial<Extract<ObservationCue, { kind: "gas" }>> };

const FARADAY = 96_485;
/** Standard electrode potentials (V): the reactivity series in numbers. */
const E0: Record<MetalSym, number> = { Mg: -2.37, Zn: -0.76, Fe: -0.44, Cu: 0.34 };
type MetalSym = "Mg" | "Zn" | "Fe" | "Cu";
const ION_OF: Record<MetalSym, Ion> = { Mg: "Mg2+", Zn: "Zn2+", Fe: "Fe2+", Cu: "Cu2+" };
const DEPOSIT_COLOUR: Record<MetalSym, Oklab> = { Cu: { L: 0.6, a: 0.09, b: 0.09 }, Zn: { L: 0.55, a: 0, b: 0 }, Fe: { L: 0.35, a: 0, b: 0.01 }, Mg: { L: 0.8, a: 0, b: 0 } };
const DEPOSIT_WORDS: Record<MetalSym, string> = { Cu: "pinky-brown copper", Zn: "dark grey zinc", Fe: "black iron", Mg: "grey magnesium" };

/**
 * Displacement: a more reactive metal pushes a less reactive one out of its salt solution
 * (M + X2+ -> M2+ + X). The energy released follows the gap in the reactivity series.
 * Iron in copper(II) ions keeps its own tuned branch above, so older runs are unchanged.
 */
function displace(out: StepOutput, it: Item, m: Item["metals"][number], surface: number, arrhenius: number, dt: number) {
  const l = it.liquid!;
  if (m.mol <= 1e-9) return;
  const litres = l.volumeMl / 1000;
  for (const x of ["Zn", "Fe", "Cu"] as const) {
    if (E0[x] <= E0[m.symbol] || (m.symbol === "Fe" && x === "Cu")) continue;
    const ion = ION_OF[x];
    const have = l.ions[ion] ?? 0;
    if (have <= 1e-9) continue;
    // Bigger gap in the series, faster reaction (Mg strips copper out in seconds; zinc and iron(II) is slow).
    const gap = E0[x] - E0[m.symbol];
    const n = Math.min(m.mol, have, 1.4e-5 * surface * (have / litres) * arrhenius * Math.min(3, 0.6 + gap) * dt);
    if (n <= 0) continue;
    m.mol -= n;
    l.ions[ion] = have - n;
    l.ions[ION_OF[m.symbol]] = (l.ions[ION_OF[m.symbol]] ?? 0) + n;
    it.depositMol += n;
    it.depositOf = x;
    l.tempC += (2 * FARADAY * gap * n) / Math.max(l.volumeMl * WATER_HEAT + KINDS[it.kind].heatCapacityJK, 1);
    const key = `deposit:${x}:${it.id}`;
    if (!out.state.seen[key] && it.depositMol > 1e-4) {
      out.state.seen[key] = 1;
      cue(out, { kind: "deposit", target: `solid:${m.symbol}`, colour: DEPOSIT_COLOUR[x], durationMs: 30_000 });
      note(out, `A ${DEPOSIT_WORDS[x]} coating forms on the ${m.symbol === "Mg" ? "magnesium" : m.symbol === "Zn" ? "zinc" : "iron"}: ${m.symbol} is more reactive than ${x}.`, "success", it.id, key);
    }
  }
}

/** The new reactions. Each needs its own substances, so experiments without them are untouched. */
function react5(out: StepOutput, it: Item, dt: number) {
  const s = out.state;
  const l = it.liquid!;
  const litres = l.volumeMl / 1000;
  const arr = (ea = 6000) => Math.exp(-ea * (1 / (l.tempC + 273.15) - 1 / 295.15));
  const i = l.ions;
  const supersaturated = (l.solids["CuSO4.5H2O"] ?? 0) > 0 || Math.min(i["Cu2+"] ?? 0, i["SO4^2-"] ?? 0) / litres > 1.25;
  // Cheap early exit: most vessels in most experiments have none of these.
  if (!i.H2O2 && !it.foamMl && !it.bubbling && !i["S2O3^2-"] && !l.solids.CuO && !supersaturated && !i.EtOH && !it.inBath && !it.electrodes) return;
  let changed = false;
  const before = look(it);

  // --- Catalytic decomposition of hydrogen peroxide: 2H2O2 -> 2H2O + O2, iodide catalyst.
  const h2o2 = l.ions.H2O2 ?? 0;
  const iodide = l.ions["I-"] ?? 0;
  if (h2o2 > 1e-7 && iodide > 0) {
    const n = Math.min(h2o2, 1.2 * (h2o2 / litres) * (iodide / litres) * arr(5000) * litres * dt);
    l.ions.H2O2 = h2o2 - n;
    l.tempC += (98_000 * n) / Math.max(l.volumeMl * WATER_HEAT + KINDS[it.kind].heatCapacityJK, 1);
    const o2Ml = (n / 2) * MOLAR_GAS_ML;
    gas(out, it, "O2", o2Ml, n / 2 / dt, { text: "The catalyst goes in and oxygen pours out of the peroxide.", key: "o2" });
    const soapy = (l.ions.soap ?? 0) > 0;
    it.foamMl = (it.foamMl ?? 0) + o2Ml * (soapy ? 0.4 : 0.01);
    it.bubbling = n / dt > 1e-5;
    if (soapy && (it.foamMl ?? 0) > 60 && !s.seen[`foam:${it.id}`]) {
      s.seen[`foam:${it.id}`] = 1;
      cue(out, { kind: "smoke", target: it.id, colour: { L: 0.97, a: 0, b: 0.03 }, density: 1, durationMs: 6000, label: "foam" });
      cue(out, { kind: "sound", target: it.id, soundId: "fizz" });
      note(out, "A huge column of warm foam surges up out of the cylinder! The detergent traps the oxygen in bubbles.", "success", it.id, "foam");
    }
  } else if (it.bubbling && h2o2 <= 1e-7 && (it.volts ?? 0) === 0) {
    it.bubbling = false;
  }
  if ((it.foamMl ?? 0) > 0) {
    it.foamMl = (it.foamMl ?? 0) * Math.exp(-dt / 120);
    if ((it.foamMl ?? 0) < 0.5) it.foamMl = 0;
  }

  // --- Thiosulfate and acid: S2O3^2- + 2H+ -> S + SO2 + H2O. The sulfur clouds the flask.
  const thio = l.ions["S2O3^2-"] ?? 0;
  if (thio > 1e-7 && l.ph < 5) {
    const h = Math.pow(10, -l.ph);
    const n = Math.min(thio, 1.1e-3 * (thio / litres) * (h / (h + 0.02)) * arr(6000) * litres * dt);
    if (n > 0) {
      const startKey = `thio-start:${it.id}`;
      if (!s.seen[startKey]) {
        s.seen[startKey] = s.t + 1;
        cue(out, { kind: "odour", target: it.id, description: "sharp, choking sulfur dioxide" });
        note(out, "The acid is in: start the clock! A faint sharp smell of sulfur dioxide - keep the room ventilated.", "info", it.id, "thio-start");
      }
      l.ions["S2O3^2-"] = thio - n;
      l.solids.S = (l.solids.S ?? 0) + n;
      changed = true;
      const conc = (l.solids.S ?? 0) / litres;
      const goneKey = `cross-gone:${it.id}`;
      if (conc >= 0.003 && !s.seen[goneKey]) {
        const secs = Math.max(1, Math.round((s.t + 1 - (s.seen[startKey] ?? s.t)) / 1000));
        s.seen[goneKey] = secs;
        cue(out, { kind: "precipitate", target: it.id, id: "S", colour: PRECIPITATES.S.colour, turbidity: 0.65, settleMs: 0 });
        note(out, `The cross has disappeared: ${secs} s after the acid went in. Rate is about 1/${secs} = ${(1000 / secs).toFixed(1)} × 10⁻³ s⁻¹.`, "success", it.id, goneKey);
      }
    }
  }

  // --- Copper(II) oxide dissolving in acid: CuO + 2H+ -> Cu2+ + H2O. Faster when warm.
  const cuo = l.solids.CuO ?? 0;
  if (cuo > 1e-9) {
    const h = Math.pow(10, -l.ph);
    const n = Math.min(cuo, 0.2 * cuo * Math.min(h, 2) * arr(6000) * dt);
    if (n > 1e-12) {
      l.solids.CuO = cuo - n;
      l.ions["Cu2+"] = (l.ions["Cu2+"] ?? 0) + n;
      changed = true;
    }
    const excessKey = `excess:CuO:${it.id}`;
    if ((l.solids.CuO ?? 0) > 4e-4 && l.ph > 2 && !s.seen[excessKey]) {
      s.seen[excessKey] = 1;
      note(out, "Black powder stays at the bottom however long you stir: the acid is used up and the copper(II) oxide is in excess.", "success", it.id, excessKey);
    }
  }

  // --- Copper(II) sulfate crystallising: solubility falls steeply as the solution cools.
  const cu = l.ions["Cu2+"] ?? 0;
  const so4 = l.ions["SO4^2-"] ?? 0;
  const crystals = l.solids["CuSO4.5H2O"] ?? 0;
  if (cu > 0 && so4 > 0 && (crystals > 0 || Math.min(cu, so4) / litres > 1.25)) {
    const sat = 1.3 * Math.exp(0.0165 * (l.tempC - 20)); // mol/L: 1.3 at 20 °C, 2.5 at 60 °C, 4.8 at 100 °C
    const dissolved = Math.min(cu, so4);
    const excess = dissolved - sat * litres;
    const f = 1 - Math.exp(-dt / 6);
    let n = 0;
    if (excess > 0) n = excess * f;
    else if (crystals > 0) n = -Math.min(crystals, -excess * f);
    if (Math.abs(n) > 1e-12) {
      l.ions["Cu2+"] = cu - n;
      l.ions["SO4^2-"] = so4 - n;
      l.solids["CuSO4.5H2O"] = Math.max(0, crystals + n);
      if ((l.solids["CuSO4.5H2O"] ?? 0) <= 1e-12) delete l.solids["CuSO4.5H2O"];
      changed = true;
    }
    const grown = l.solids["CuSO4.5H2O"] ?? 0;
    if (grown > 2e-4 && !s.seen[`crystal-point:${it.id}`]) {
      s.seen[`crystal-point:${it.id}`] = 1;
      note(out, "Tiny crystals appear at the edge: the solution is saturated (the point of crystallisation).", "info", it.id, "crystal-point");
    }
    if (grown > 1e-3 && l.tempC < 50 && !s.seen[`crystals:${it.id}`]) {
      s.seen[`crystals:${it.id}`] = 1;
      cue(out, { kind: "precipitate", target: it.id, id: "CuSO4.5H2O", colour: PRECIPITATES["CuSO4.5H2O"].colour, turbidity: 0.2, settleMs: 4000 });
      note(out, "Bright blue crystals of hydrated copper(II) sulfate grow as the solution cools.", "success", it.id, "crystals");
    }
  }

  // --- Esterification: ethanol + ethanoic acid <=> ethyl ethanoate + water (acid catalyst, K about 4).
  const etoh = l.ions.EtOH ?? 0;
  const acid = l.ions.CH3COOH_T ?? 0;
  if (etoh > 1e-7 && acid > 1e-7) {
    const cat = Math.min(1, (so4 / litres) / 0.2);
    if (cat > 0) {
      const E = etoh / litres;
      const A = acid / litres;
      const X = (l.ions.EtOAc ?? 0) / litres;
      const rateM = 2.6e-5 * cat * arr(6000) * (E * A - (X * X) / 4);
      const n = Math.max(-(l.ions.EtOAc ?? 0), Math.min(etoh, acid, rateM * litres * dt));
      l.ions.EtOH = etoh - n;
      l.ions.CH3COOH_T = acid - n;
      l.ions.EtOAc = (l.ions.EtOAc ?? 0) + n;
      if ((l.ions.EtOAc ?? 0) / litres >= 0.3 && !s.seen[`ester:${it.id}`]) {
        s.seen[`ester:${it.id}`] = 1;
        cue(out, { kind: "odour", target: it.id, description: "sweet and fruity, like pear drops" });
        note(out, "A thin oily layer forms on top and a sweet fruity smell drifts up: ethyl ethanoate, an ester.", "success", it.id, "ester");
      }
      changed = true;
    }
  }

  // --- Water bath: the tube warms towards the bath's temperature.
  if (it.inBath) {
    const bath = s.items[it.inBath]?.liquid;
    if (bath && bath.volumeMl > 0) l.tempC += (bath.tempC - l.tempC) * (1 - Math.exp(-dt / 15));
  }

  // --- Electrolysis of brine with inert electrodes: 2Cl- -> Cl2 + 2e- (anode), 2H2O + 2e- -> H2 + 2OH- (cathode).
  if (it.electrodes && (it.volts ?? 0) > 0) {
    let ionic = 0;
    for (const k in l.ions) ionic += Math.abs(CHARGE_OF[k as Ion] ?? 0) * (l.ions[k as Ion] ?? 0);
    ionic /= Math.max(litres, 1e-6);
    const amps = Math.max(0, (it.volts ?? 0) - 2.2) / (3 + 6 / Math.max(ionic, 0.05));
    const n = (amps / (2 * FARADAY)) * dt; // mol of each gas
    if (n > 0) {
      const cl = l.ions["Cl-"] ?? 0;
      const nCl = Math.min(n, cl / 2);
      l.ions["Cl-"] = cl - 2 * nCl; // the OH- left behind shows up in the charge balance: the solution turns alkaline
      it.bubbling = true;
      gas(out, it, "H2", n * MOLAR_GAS_ML, n / dt, { text: "Bubbles stream off both electrodes: hydrogen at the negative cathode, chlorine at the positive anode.", key: "electrolysis" });
      if (nCl > 0) {
        s.seen[`cl2-ml:${it.id}`] = (s.seen[`cl2-ml:${it.id}`] ?? 0) + nCl * MOLAR_GAS_ML;
        gas(out, it, "Cl2", nCl * MOLAR_GAS_ML, nCl / dt, { collect: false, text: "A pale green gas with a swimming-pool smell comes off the anode: chlorine.", key: "cl2", extra: { colour: { L: 0.9, a: -0.05, b: 0.12 }, smell: "swimming pools (bleach)", hazard: "toxic", warning: "Chlorine is toxic: low voltage, short runs, a ventilated room and never sniff it." } });
      }
      changed = true;
      if (l.ph > 10 && !s.seen[`alkaline:${it.id}`]) {
        s.seen[`alkaline:${it.id}`] = 1;
        note(out, "The indicator turns purple: hydroxide ions left behind at the cathode make the solution alkaline (sodium hydroxide).", "success", it.id, "alkaline");
      }
    }
  }

  // --- A lit Bunsen anywhere near ethanol is a fire risk.
  if (etoh > 0 && !s.seen["flame-near-ethanol"]) {
    for (const b of Object.values(s.items)) {
      if (b.kind === "bunsen" && b.gasOn) {
        s.seen["flame-near-ethanol"] = 1;
        note(out, "A naked flame near ethanol! Ethanol vapour catches fire very easily. Turn the gas off: use a hot water bath instead.", "danger", b.id);
        break;
      }
    }
  }

  if (changed) {
    l.ph = equilibrate(l.ions, l.solids, l.volumeMl).ph;
    const after = look(it);
    if (before && after && Math.hypot(after.colour.L - before.colour.L, after.colour.a - before.colour.a, after.colour.b - before.colour.b) > 0.02) {
      cue(out, { kind: "colour", target: it.id, from: before.colour, to: after.colour, startMs: 0, durationMs: 1000, curve: "linear" });
    }
  }
}

const CHARGE_OF: Partial<Record<Ion, number>> = { "Na+": 1, "K+": 1, "Li+": 1, "Ca2+": 2, "Mg2+": 2, "Ba2+": 2, "Cu2+": 2, "Fe2+": 2, "Zn2+": 2, "Ag+": 1, "Pb2+": 2, "Cl-": -1, "SO4^2-": -2, "NO3-": -1, "I-": -1, "Br-": -1, "S2O3^2-": -2 };

/* ================================================================== helpers */

function cue(out: StepOutput, c: ObservationCue) {
  out.cues.push(c);
}

function note(out: StepOutput, text: string, tone: Note["tone"], target?: string, key?: string) {
  out.notes.push({ text, tone, ...(target ? { target } : {}), ...(key ? { key } : {}) });
}

export function round(x: number, dp: number) {
  const f = Math.pow(10, dp);
  return Math.round(x * f) / f;
}

export { liquidOf };
