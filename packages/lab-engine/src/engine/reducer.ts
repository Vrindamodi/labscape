import type { LabEvent, ObservationCue, Oklab } from "@labscape/contracts";
import { equilibrate, FLAME, lerpLab, MOLAR_GAS_ML, solvePh, type Amounts, type Ion } from "./chem";
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
  const z: Partial<Record<Ion, number>> = { "Na+": 1, "K+": 1, "Li+": 1, "Ca2+": 2, "Mg2+": 2, "Ba2+": 2, "Cu2+": 2, "Fe2+": 2, "Zn2+": 2, "Ag+": 1, "Pb2+": 2, "Cl-": -1, "SO4^2-": -2, "NO3-": -1, "I-": -1, "Br-": -1 };
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
  if (l.plume.volumeMl < 1e-4 || f >= 0.999) l.plume = null;
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
      if ((out.state.seen[`precipitate:${k}`] ?? 0) === 1) note(out, `A ${precipitateWords(k)} precipitate forms.`, "success", it.id, `ppt-${k}`);
    }
  }
}

function precipitateWords(k: string) {
  return { "Cu(OH)2": "pale blue copper(II) hydroxide", BaSO4: "white barium sulfate", "Mg(OH)2": "white magnesium hydroxide", "Fe(OH)2": "green iron(II) hydroxide", AgCl: "white silver chloride", PbI2: "bright yellow lead(II) iodide", CaSO4: "white calcium sulfate", "Zn(OH)2": "white zinc hydroxide" }[k] ?? k;
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
    default:
      break;
  }
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
      if (n <= 0) continue;
      m.mol -= n;
      l.ions["Mg2+"] = (l.ions["Mg2+"] ?? 0) + n;
      l.tempC += (467_000 * n) / Math.max(l.volumeMl * WATER_HEAT, 0.5);
      gas(out, it, "H2", n * MOLAR_GAS_ML, n / dt);
    } else if (m.symbol === "Fe") {
      // Fe + Cu2+ -> Fe2+ + Cu ; a slow, minutes-long coating.
      const cu = (l.ions["Cu2+"] ?? 0) / litres;
      const n = Math.min(m.mol, l.ions["Cu2+"] ?? 0, 2.5e-6 * surface * cu * arrhenius * dt * 60);
      if (n <= 0) continue;
      m.mol -= n;
      l.ions["Cu2+"] = (l.ions["Cu2+"] ?? 0) - n;
      l.ions["Fe2+"] = (l.ions["Fe2+"] ?? 0) + n;
      it.depositMol += n;
      if ((out.state.seen["deposit:Cu"] ?? 0) === 0 && it.depositMol > 2e-6) {
        out.state.seen["deposit:Cu"] = 1;
        cue(out, { kind: "deposit", target: `solid:${m.symbol}`, colour: { L: 0.6, a: 0.09, b: 0.09 }, durationMs: 60_000 });
        note(out, "A pinky-brown coat of copper starts to form on the nail.", "success", it.id, "deposit");
      }
    }
  }
  const before = look(it);
  l.ph = equilibrate(l.ions, l.solids, l.volumeMl).ph;
  const after = look(it);
  if (before && after && Math.hypot(after.colour.L - before.colour.L, after.colour.a - before.colour.a, after.colour.b - before.colour.b) > 0.01) {
    cue(out, { kind: "colour", target: it.id, from: before.colour, to: after.colour, startMs: 0, durationMs: 1000, curve: "linear" });
  }
}

/** Gas produced in a vessel: bubbles cue, routed to a collection tube if one is held over it. */
function gas(out: StepOutput, it: Item, gasName: string, ml: number, molPerS: number) {
  const s = out.state;
  const key = `gas:${gasName}:${it.id}`;
  const prevRate = s.seen[key] ?? 0;
  const ratePerS = molPerS * MOLAR_GAS_ML;
  // Emit a gas cue when bubbling starts or changes a lot.
  if (prevRate === 0 || Math.abs(ratePerS - prevRate) / Math.max(prevRate, 1e-6) > 0.5) {
    cue(out, { kind: "gas", target: it.id, ratePerS: round(ratePerS, 3), bubble: ratePerS > 1 ? "coarse" : ratePerS > 0.2 ? "medium" : "fine", gas: gasName, durationMs: 2000 });
    if (prevRate === 0) note(out, "Fizzing! Bubbles of gas stream off the metal.", "success", it.id, "fizz");
    s.seen[key] = ratePerS;
  }
  const dest = it.gasTo ? s.items[it.gasTo] : null;
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
  const loss = 0.9 * (l.tempC - s.roomC); // W, to the room
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
  if (Math.floor(t0 / 5) !== Math.floor(l.tempC / 5) && Math.abs(l.tempC - s.roomC) > 3) {
    cue(out, { kind: "temperature", target: it.id, deltaC: round(l.tempC - t0, 2), tauMs: 1000 });
  }
}

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
