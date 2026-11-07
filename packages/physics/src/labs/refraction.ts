import { deg, rad } from "../core/runtime";
import { snellDeg, type Vec } from "../core/optics";
import type { RuleHit, SimModel, SimNote } from "../protocol/types";

/**
 * Refraction through a glass slab by the pin method (build plan 3.5): the real school practical.
 * Paper coordinates are millimetres, y downwards. The slab's top face is y = 0, its bottom face
 * y = thickness. P1 and P2 sit above the slab, P3 and P4 below it, lined up with the images.
 */
export type SlabSetup = { thicknessMm: number; widthMm: number; n: number };

export type PinSet = {
  pins: Partial<Record<"P1" | "P2" | "P3" | "P4", Vec>>;
  traced: boolean;
  angles: Partial<Record<"i" | "r" | "e", number>>;
  done: boolean;
};

export type SlabState = { sets: PinSet[]; results: Record<string, number> };

const emptySet = (): PinSet => ({ pins: {}, traced: false, angles: {}, done: false });

/** The ray defined by P1 -> P2, followed through the slab. Null until both pins are placed above it. */
export function slabRay(set: PinSet, setup: SlabSetup) {
  const { P1, P2 } = set.pins;
  if (!P1 || !P2 || P1.y >= 0 || P2.y >= 0) return null;
  const dx = P2.x - P1.x;
  const dy = P2.y - P1.y;
  if (dy <= 0) return null; // must head towards the slab
  const len = Math.hypot(dx, dy);
  const dir = { x: dx / len, y: dy / len };
  const entry = { x: P2.x + dir.x * (-P2.y / dir.y), y: 0 };
  const i = deg(Math.atan2(Math.abs(dir.x), dir.y));
  const r = snellDeg(i, 1, setup.n)!;
  const side = Math.sign(dir.x) || 1;
  const exit = { x: entry.x + side * setup.thicknessMm * Math.tan(rad(r)), y: setup.thicknessMm };
  const shift = (setup.thicknessMm * Math.sin(rad(i - r))) / Math.cos(rad(r));
  return { dir, entry, exit, i, r, e: i, shift, pinGap: len };
}

/** Perpendicular distance (mm) from p to the emergent ray. */
export function offEmergent(p: Vec, ray: NonNullable<ReturnType<typeof slabRay>>) {
  const w = { x: p.x - ray.exit.x, y: p.y - ray.exit.y };
  return Math.abs(w.x * ray.dir.y - w.y * ray.dir.x);
}

const ALIGN_MM = 0.8;

export const refraction: SimModel<SlabState> = {
  slug: "refraction-snells-law",
  init: () => ({ sets: [emptySet()], results: {} }),
  apply: (s0, e, ctx) => {
    const setup = ctx.content.setup as unknown as SlabSetup;
    const hits: RuleHit[] = [];
    const notes: SimNote[] = [];
    let sets = s0.sets.map((x) => ({ ...x, pins: { ...x.pins }, angles: { ...x.angles } }));
    let cur = sets[sets.length - 1]!;
    if (cur.done) {
      cur = emptySet();
      sets = [...sets, cur];
    }
    const ray = () => slabRay(cur, setup);
    let results = s0.results;

    if (e.type === "equipment.place") {
      const id = e.payload.equipmentId as "P1" | "P2" | "P3" | "P4";
      if (cur.traced) hits.push({ code: "pins-after-trace", severity: "minor", message: "Start a new sheet before placing more pins.", tag: "procedural", dimension: "sequence" });
      else {
        cur.pins[id] = { x: e.payload.x, y: e.payload.y };
        if ((id === "P3" || id === "P4") && !ray()) hits.push({ code: "p3-before-p1p2", severity: "order", message: "Place P1 and P2 on the incident ray first.", tag: "procedural", dimension: "sequence" });
        if (id === "P2" && ray() && ray()!.pinGap < 30) hits.push({ code: "pins-close", severity: "minor", message: "P1 and P2 are very close together, so a small error in either swings the line a lot. Space pins at least 3 cm apart.", tag: "procedural", dimension: "technique" });
        if (id === "P2" && ray() && (ray()!.i < 15 || ray()!.i > 75)) hits.push({ code: "angle-extreme", severity: "minor", message: "Pick an angle of incidence between about 20° and 70°. Near 0° the bending is too small to measure; near 90° the ray barely enters.", tag: "procedural", dimension: "technique" });
      }
    }
    if (e.type === "param.set" && e.payload.key === "trace") {
      const r = ray();
      const { P3, P4 } = cur.pins;
      if (!r || !P3 || !P4) hits.push({ code: "trace-early", severity: "order", message: "Place all four pins before removing the slab and tracing.", tag: "procedural", dimension: "sequence" });
      else {
        if (offEmergent(P3, r) > ALIGN_MM || offEmergent(P4, r) > ALIGN_MM) hits.push({ code: "misaligned", severity: "major", message: "P3 and P4 are not in line with the images of P1 and P2, so the emergent ray you trace is wrong. Look through the slab at the feet of the pins and line all four up.", tag: "procedural", dimension: "technique" });
        cur.traced = true;
        notes.push({ text: "Slab outline and rays traced. Draw the normals and measure i, r and e.", tone: "info" });
      }
    }
    if (e.type === "param.set" && e.payload.key === "new-sheet" && !cur.done) {
      sets = [...sets.slice(0, -1), emptySet()];
      cur = sets[sets.length - 1]!;
    }
    if (e.type === "measure.read" && e.payload.instrument === "protractor") {
      const k = e.payload.reading.key as "i" | "r" | "e";
      const r = ray();
      if (!cur.traced || !r) hits.push({ code: "measure-early", severity: "order", message: "Trace the rays and draw the normals first.", tag: "procedural", dimension: "sequence" });
      else {
        const truth = r[k];
        if (Math.abs(e.payload.reading.value - truth) > 1) hits.push({ code: "angle-misread", severity: "minor", message: `Measure from the normal, not the surface. ${k} is ${truth.toFixed(0)}° here.`, tag: "procedural", dimension: "measurement" });
        else cur.angles[k] = e.payload.reading.value;
      }
    }
    // a set is complete when traced from aligned pins and all three angles are measured
    {
      const r = ray();
      const { P3, P4 } = cur.pins;
      if (!cur.done && cur.traced && r && P3 && P4 && offEmergent(P3, r) <= ALIGN_MM && offEmergent(P4, r) <= ALIGN_MM && cur.angles.i !== undefined && cur.angles.r !== undefined && cur.angles.e !== undefined) {
        const others = sets.filter((x) => x !== cur && x.done).map((x) => slabRay(x, setup)!.i);
        if (others.some((i) => Math.abs(i - r.i) < 10)) hits.push({ code: "same-angle", severity: "minor", message: "Use a clearly different angle of incidence (at least 10° apart) for each sheet.", tag: "procedural", dimension: "technique" });
        else {
          cur.done = true;
          notes.push({ text: `Sheet ${sets.filter((x) => x.done).length}: i = ${cur.angles.i}°, r = ${cur.angles.r}°, e = ${cur.angles.e}°. sin i / sin r = ${(Math.sin(rad(cur.angles.i!)) / Math.sin(rad(cur.angles.r!))).toFixed(2)}`, tone: "success" });
        }
      }
    }
    if (e.type === "param.set" && typeof e.payload.key === "string" && e.payload.key.startsWith("result:")) {
      results = { ...results, [e.payload.key.slice(7)]: Number(e.payload.value) };
      if (e.payload.key === "result:n" && Math.abs(Number(e.payload.value) - setup.n) > 0.05) hits.push({ code: "wrong-n", severity: "major", message: "n = sin i / sin r. Work it out for each sheet and take the mean.", tag: "conceptual", dimension: "measurement" });
    }
    return { state: { sets, results }, hits, notes };
  },
  steps: {
    "set-1": (s) => s.sets.filter((x) => x.done).length >= 1,
    "set-2": (s) => s.sets.filter((x) => x.done).length >= 2,
    "set-3": (s) => s.sets.filter((x) => x.done).length >= 3,
    result: (s, ctx) => s.results.n !== undefined && Math.abs(s.results.n - (ctx.content.setup as unknown as SlabSetup).n) <= 0.05,
  },
  readouts: (s) => ({ sheets: s.sets.filter((x) => x.done).length }),
};
