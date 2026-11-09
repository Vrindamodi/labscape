import type { ExperimentContent } from "@labscape/lab-engine";

/**
 * Long protocols are shown as at most six stages with their steps inside ("Fill the burette" holds
 * fill, clear the bubble, read). Display only: scoring and the event log still work step by step.
 */
export type Stage = { title: string; steps: string[] };

const AUTHORED: Record<string, { title: string; steps: string[] }[]> = {
  "acid-base-titration": [
    { title: "Fill the burette", steps: ["fill-burette", "clear-bubble", "initial-reading"] },
    { title: "Measure the acid", steps: ["pipette-rough", "deliver-rough", "indicator-rough", "tile-rough"] },
    { title: "Rough titration", steps: ["rough-run", "rough-reading"] },
    { title: "Set up again", steps: ["pipette-accurate", "deliver-accurate", "indicator-accurate", "tile-accurate"] },
    { title: "Accurate titration", steps: ["accurate-run"] },
    { title: "Work it out", steps: ["final-reading"] },
  ],
  "flame-tests": [
    { title: "Get the burner ready", steps: ["goggles", "air-hole", "light"] },
    { title: "Clean the loop", steps: ["clean"] },
    { title: "Lithium and sodium", steps: ["lithium", "clean-2", "sodium"] },
    { title: "Potassium and calcium", steps: ["clean-3", "potassium", "clean-4", "calcium"] },
    { title: "Copper", steps: ["clean-5", "copper"] },
  ],
  "making-copper-sulfate": [
    { title: "Get ready", steps: ["goggles", "acid-in"] },
    { title: "Warm the acid", steps: ["light", "heat-acid", "warm", "off"] },
    { title: "Add copper oxide", steps: ["add-cuo"] },
    { title: "Filter", steps: ["filter"] },
    { title: "Evaporate", steps: ["relight", "heat-basin", "evaporate", "off-2"] },
    { title: "Crystallise", steps: ["crystals"] },
  ],
  "electrolysis-of-brine": [
    { title: "Set up the cell", steps: ["goggles", "brine-in", "indicator", "collect"] },
    { title: "Electrolyse", steps: ["power-on", "gas"] },
    { title: "Test for chlorine", steps: ["litmus", "power-off"] },
    { title: "Test for hydrogen", steps: ["light-burner", "light-splint", "pop"] },
  ],
  "disappearing-cross": [
    { title: "Flask A", steps: ["goggles", "thio-a", "acid-a", "swirl-a"] },
    { title: "Time flask A", steps: ["cross-a"] },
    { title: "Flask B (diluted)", steps: ["thio-b", "water-b", "acid-b", "swirl-b"] },
    { title: "Time flask B", steps: ["cross-b"] },
  ],
  "metal-displacement": [
    { title: "Get ready", steps: ["goggles"] },
    { title: "Fill the tubes", steps: ["fill-a", "fill-b", "fill-c", "fill-d"] },
    { title: "Add the metals", steps: ["mg-in", "zn-in", "fe-in", "cu-in"] },
    { title: "Compare", steps: ["watch"] },
  ],
  "ph-indicators": [
    { title: "Fill the tubes", steps: ["acid-in", "water-in", "base-in"] },
    { title: "Universal indicator", steps: ["ui-1", "ui-2", "ui-3"] },
    { title: "Litmus", steps: ["acid-t4", "litmus-acid", "base-t5", "litmus-base"] },
  ],
  "elephant-toothpaste": [
    { title: "Get ready", steps: ["goggles", "peroxide", "detergent"] },
    { title: "Glowing splint", steps: ["light-burner", "light-splint", "blow-out"] },
    { title: "The reaction", steps: ["catalyst", "foam"] },
    { title: "Test the gas", steps: ["relight"] },
  ],
  "hydrogen-pop-test": [
    { title: "Make the gas", steps: ["goggles", "acid-in", "mg-in", "collect"] },
    { title: "Pop test", steps: ["light-burner", "light-splint", "pop"] },
  ],
  "making-esters": [
    { title: "Mix", steps: ["goggles", "ethanol-in", "acid-in", "catalyst"] },
    { title: "Warm", steps: ["bath", "react"] },
    { title: "Smell", steps: ["waft"] },
  ],
};

/** The stages for an experiment: authored where it helps, else one stage per step (up to six), else even chunks. */
export function stagesFor(content: ExperimentContent): Stage[] {
  const ids = content.steps.map((s) => s.id);
  const authored = AUTHORED[content.slug];
  if (authored) {
    // Any step the authored grouping misses (content changed) joins the stage before it.
    const listed = new Set(authored.flatMap((g) => g.steps));
    const out = authored.map((g) => ({ title: g.title, steps: g.steps.filter((id) => ids.includes(id)) }));
    ids.forEach((id, i) => {
      if (listed.has(id)) return;
      const prev = ids.slice(0, i).reverse().find((x) => listed.has(x));
      const host = out.find((g) => prev && g.steps.includes(prev)) ?? out[out.length - 1]!;
      host.steps.push(id);
    });
    return out.filter((g) => g.steps.length);
  }
  if (content.steps.length <= 6) return content.steps.map((s) => ({ title: s.title, steps: [s.id] }));
  const per = Math.ceil(content.steps.length / 6);
  const out: Stage[] = [];
  for (let i = 0; i < content.steps.length; i += per) {
    const chunk = content.steps.slice(i, i + per);
    out.push({ title: chunk[0]!.title, steps: chunk.map((s) => s.id) });
  }
  return out;
}
