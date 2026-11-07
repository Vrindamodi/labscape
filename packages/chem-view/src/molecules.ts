/**
 * Molecule templates and reaction scenes for the molecular view. A scene lists reactant and product
 * species; atoms are matched element by element in listing order, so each atom visibly travels from
 * where it starts to where it ends (a proton hopping from H3O+ to OH-, for example). Coordinates in
 * angstroms.
 */

export type AtomSym = "H" | "O" | "Cl" | "Na" | "Cu" | "S" | "Mg" | "Fe";

export const ATOM_STYLE: Record<AtomSym, { colour: string; r: number; name: string }> = {
  H: { colour: "#f1f5ff", r: 0.25, name: "Hydrogen" },
  O: { colour: "#ff4d4f", r: 0.42, name: "Oxygen" },
  Cl: { colour: "#40c057", r: 0.55, name: "Chlorine" },
  Na: { colour: "#9775fa", r: 0.6, name: "Sodium" },
  Cu: { colour: "#d9822b", r: 0.55, name: "Copper" },
  S: { colour: "#fcc419", r: 0.5, name: "Sulfur" },
  Mg: { colour: "#94d82d", r: 0.62, name: "Magnesium" },
  Fe: { colour: "#e8590c", r: 0.58, name: "Iron" },
};

export type Molecule = { label: string; atoms: [AtomSym, number, number, number][]; bonds: [number, number][] };

const t = 1.49 / Math.sqrt(3); // S-O in a tetrahedron
const SO4_ATOMS: Molecule["atoms"] = [["S", 0, 0, 0], ["O", t, t, t], ["O", -t, -t, t], ["O", -t, t, -t], ["O", t, -t, -t]];
const SO4_BONDS: Molecule["bonds"] = [[0, 1], [0, 2], [0, 3], [0, 4]];

export const MOLECULES = {
  H2O: { label: "H₂O", atoms: [["O", 0, 0, 0], ["H", 0.76, 0.59, 0], ["H", -0.76, 0.59, 0]], bonds: [[0, 1], [0, 2]] },
  H3O: { label: "H₃O⁺", atoms: [["O", 0, 0, 0], ["H", 0.94, 0.32, 0], ["H", -0.47, 0.32, 0.81], ["H", -0.47, 0.32, -0.81]], bonds: [[0, 1], [0, 2], [0, 3]] },
  OH: { label: "OH⁻", atoms: [["O", 0, 0, 0], ["H", 0.97, 0, 0]], bonds: [[0, 1]] },
  Na: { label: "Na⁺", atoms: [["Na", 0, 0, 0]], bonds: [] },
  Cl: { label: "Cl⁻", atoms: [["Cl", 0, 0, 0]], bonds: [] },
  HCl: { label: "HCl", atoms: [["H", -0.64, 0, 0], ["Cl", 0.64, 0, 0]], bonds: [[0, 1]] },
  H2: { label: "H₂", atoms: [["H", -0.37, 0, 0], ["H", 0.37, 0, 0]], bonds: [[0, 1]] },
  Mg: { label: "Mg", atoms: [["Mg", 0, 0, 0]], bonds: [] },
  Mg2: { label: "Mg²⁺", atoms: [["Mg", 0, 0, 0]], bonds: [] },
  Cu2: { label: "Cu²⁺", atoms: [["Cu", 0, 0, 0]], bonds: [] },
  Cu: { label: "Cu (solid)", atoms: [["Cu", 0, 0, 0]], bonds: [] },
  Fe: { label: "Fe (nail)", atoms: [["Fe", 0, 0, 0]], bonds: [] },
  Fe2: { label: "Fe²⁺", atoms: [["Fe", 0, 0, 0]], bonds: [] },
  SO4: { label: "SO₄²⁻", atoms: SO4_ATOMS, bonds: SO4_BONDS },
  CuOH2: { label: "Cu(OH)₂ (solid)", atoms: [["Cu", 0, 0, 0], ["O", 1.95, 0, 0], ["H", 2.45, 0.8, 0], ["O", -1.95, 0, 0], ["H", -2.45, 0.8, 0]], bonds: [[0, 1], [1, 2], [0, 3], [3, 4]] },
  H2SO4: { label: "H₂SO₄", atoms: [...SO4_ATOMS, ["H", t + 0.62, t + 0.55, t], ["H", -t - 0.62, -t - 0.55, t]], bonds: [...SO4_BONDS, [1, 5], [2, 6]] },
  HSO4: { label: "HSO₄⁻", atoms: [...SO4_ATOMS, ["H", t + 0.62, t + 0.55, t]], bonds: [...SO4_BONDS, [1, 5]] },
} satisfies Record<string, Molecule>;

export type MoleculeId = keyof typeof MOLECULES;

export type ReactionScene = {
  kind: "reaction";
  title: string;
  /** Ionic equation shown under the scene. */
  equation: string;
  reactants: MoleculeId[];
  products: MoleculeId[];
  /** Ions that take no part, faded in both frames. */
  spectators?: MoleculeId[];
  /** Electrons that move during the reaction (redox): from reactant atom index to product atom index, global numbering. */
  electrons?: { from: number; to: number[] };
  /** Plain-language narration keyed to the timeline (0..1). */
  captions: [number, string][];
  exothermic?: boolean;
};

export type EmissionScene = {
  kind: "emission";
  title: string;
  metals: { symbol: string; name: string; colour: string; nm: number; shells: number[] }[];
  captions: [number, string][];
};

export type Scene = ReactionScene | EmissionScene;

const NEUTRALISATION: ReactionScene = {
  kind: "reaction",
  title: "Neutralisation at the molecular level",
  equation: "H₃O⁺ + OH⁻ → 2 H₂O",
  reactants: ["H3O", "OH", "Na", "Cl"],
  products: ["H2O", "H2O", "Na", "Cl"],
  spectators: ["Na", "Cl"],
  captions: [
    [0, "In the acid, H⁺ ions ride on water molecules as hydronium, H₃O⁺. The alkali brings hydroxide, OH⁻."],
    [0.25, "A hydronium ion bumps into a hydroxide ion and hands over one proton."],
    [0.6, "The O–H bond breaks on one side and a new O–H bond forms on the other: two water molecules."],
    [0.85, "Na⁺ and Cl⁻ never changed. They are spectator ions, left behind as dissolved salt."],
  ],
  exothermic: true,
};

export const SCENES: Record<string, Scene> = {
  "acid-base-titration": NEUTRALISATION,
  "ph-indicators": { ...NEUTRALISATION, title: "What pH really measures", captions: [[0, "pH counts H₃O⁺ ions. Acids have many, alkalis few, because OH⁻ mops them up."], ...NEUTRALISATION.captions.slice(1)] },
  "precipitation-reactions": {
    kind: "reaction",
    title: "A precipitate forms",
    equation: "Cu²⁺ + 2 OH⁻ → Cu(OH)₂(s)",
    reactants: ["Cu2", "OH", "OH", "Na", "Na", "SO4"],
    products: ["CuOH2", "Na", "Na", "SO4"],
    spectators: ["Na", "SO4"],
    captions: [
      [0, "Copper(II) ions and hydroxide ions move freely in solution."],
      [0.3, "Each Cu²⁺ attracts two OH⁻ ions strongly."],
      [0.6, "Together they make copper(II) hydroxide, which cannot dissolve. Billions of these clump into the pale blue solid you saw."],
      [0.85, "Na⁺ and SO₄²⁻ stay dissolved: spectators."],
    ],
  },
  "hydrogen-pop-test": {
    kind: "reaction",
    title: "Magnesium meets acid",
    equation: "Mg + 2 H⁺ → Mg²⁺ + H₂",
    reactants: ["Mg", "HCl", "HCl"],
    products: ["Mg2", "Cl", "Cl", "H2"],
    electrons: { from: 0, to: [1, 3] },
    captions: [
      [0, "A magnesium atom sits on the ribbon's surface, next to hydrogen chloride from the acid."],
      [0.25, "Magnesium gives away its two outer electrons."],
      [0.55, "Two H⁺ ions take one electron each and pair up into an H₂ molecule: the bubbles."],
      [0.85, "Magnesium is left as Mg²⁺ in solution, next to the chloride ions."],
    ],
  },
  "iron-nail-copper-sulfate": {
    kind: "reaction",
    title: "Displacement: iron pushes out copper",
    equation: "Fe + Cu²⁺ → Fe²⁺ + Cu",
    reactants: ["Fe", "Cu2", "SO4"],
    products: ["Fe2", "Cu", "SO4"],
    spectators: ["SO4"],
    electrons: { from: 0, to: [1, 1] },
    captions: [
      [0, "An iron atom on the nail is next to a blue copper(II) ion."],
      [0.25, "Iron is more reactive: it loses two electrons more easily than copper does."],
      [0.5, "The two electrons move across to the copper ion."],
      [0.75, "Copper becomes solid metal on the nail; iron dissolves as pale green Fe²⁺. The blue fades as Cu²⁺ is used up."],
    ],
  },
  "diluting-acid-safely": {
    kind: "reaction",
    title: "Why diluting acid gets hot",
    equation: "H₂SO₄ + H₂O → H₃O⁺ + HSO₄⁻",
    reactants: ["H2SO4", "H2O"],
    products: ["HSO4", "H3O"],
    captions: [
      [0, "A sulfuric acid molecule meets a water molecule."],
      [0.3, "The acid hands a proton to the water."],
      [0.6, "Forming hydronium releases a lot of energy as heat: about 95 kJ for every mole of acid."],
      [0.85, "Add acid to lots of water so the heat spreads out. Water added to acid can boil on the spot and spit."],
    ],
    exothermic: true,
  },
  "flame-tests": {
    kind: "emission",
    title: "Where flame colours come from",
    metals: [
      { symbol: "Li", name: "Lithium", colour: "#ff2a4f", nm: 671, shells: [2, 1] },
      { symbol: "Na", name: "Sodium", colour: "#ffb300", nm: 589, shells: [2, 8, 1] },
      { symbol: "K", name: "Potassium", colour: "#c77dff", nm: 766, shells: [2, 8, 8, 1] },
      { symbol: "Ca", name: "Calcium", colour: "#ff6a2a", nm: 622, shells: [2, 8, 8, 2] },
      { symbol: "Cu", name: "Copper", colour: "#2ee6a0", nm: 515, shells: [2, 8, 18, 1] },
    ],
    captions: [
      [0, "Heat from the flame gives the outer electron extra energy."],
      [0.3, "The electron jumps to a higher energy level: the atom is 'excited'."],
      [0.6, "It falls straight back and releases that energy as light of one exact colour."],
      [0.85, "Each element has its own energy gaps, so its own colour. That is how a flame test identifies metals."],
    ],
  },
};

/* ------------------------------------------------------------------ layout and atom mapping */

export type PlacedAtom = { sym: AtomSym; start: [number, number, number]; end: [number, number, number]; spectator: boolean };
export type SceneBond = { a: number; b: number; kind: "kept" | "broken" | "formed" };
export type Label = { text: string; at: [number, number, number]; phase: "start" | "end"; spectator: boolean };

function layout(ids: MoleculeId[], spectators: Set<MoleculeId>, y: number) {
  const gap = 1.1;
  const widths = ids.map((id) => {
    const xs = MOLECULES[id].atoms.map((a) => a[1]);
    return { min: Math.min(...xs) - 0.7, max: Math.max(...xs) + 0.7 };
  });
  const total = widths.reduce((s, w) => s + (w.max - w.min), 0) + gap * (ids.length - 1);
  let x = -total / 2;
  const atoms: { sym: AtomSym; pos: [number, number, number]; mol: number }[] = [];
  const labels: { text: string; at: [number, number, number]; spectator: boolean }[] = [];
  ids.forEach((id, m) => {
    const w = widths[m]!;
    const ox = x - w.min;
    const spect = spectators.has(id);
    const dz = spect ? -1.6 : 0; // spectators sit further back
    MOLECULES[id].atoms.forEach(([sym, ax, ay, az]) => atoms.push({ sym, pos: [ox + ax, y + ay, az + dz], mol: m }));
    labels.push({ text: MOLECULES[id].label, at: [ox + (w.min + w.max) / 2, y - 1.25, dz], spectator: spect });
    x += w.max - w.min + gap;
  });
  return { atoms, labels };
}

export function buildScene(s: ReactionScene) {
  const spect = new Set(s.spectators ?? []);
  const R = layout(s.reactants, spect, 0);
  const P = layout(s.products, spect, 0);
  // Map atoms element by element, in listing order.
  const used = new Set<number>();
  const map: number[] = R.atoms.map((ra) => {
    const j = P.atoms.findIndex((pa, k) => !used.has(k) && pa.sym === ra.sym);
    if (j < 0) throw new Error(`Scene "${s.title}" does not conserve ${ra.sym}`);
    used.add(j);
    return j;
  });
  if (used.size !== P.atoms.length) throw new Error(`Scene "${s.title}" has extra product atoms`);

  const atoms: PlacedAtom[] = R.atoms.map((ra, i) => {
    const pa = P.atoms[map[i]!]!;
    return { sym: ra.sym, start: ra.pos, end: pa.pos, spectator: spect.has(s.reactants[ra.mol]!) };
  });

  const offset = (ids: MoleculeId[]) => {
    const o: number[] = [];
    let n = 0;
    ids.forEach((id) => {
      o.push(n);
      n += MOLECULES[id].atoms.length;
    });
    return o;
  };
  const rOff = offset(s.reactants);
  const pOff = offset(s.products);
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const before = new Set<string>();
  s.reactants.forEach((id, m) => MOLECULES[id].bonds.forEach(([a, b]) => before.add(key(rOff[m]! + a, rOff[m]! + b))));
  const inv: number[] = [];
  map.forEach((p, r) => (inv[p] = r));
  const after = new Set<string>();
  s.products.forEach((id, m) => MOLECULES[id].bonds.forEach(([a, b]) => after.add(key(inv[pOff[m]! + a]!, inv[pOff[m]! + b]!))));

  const bonds: SceneBond[] = [];
  for (const k of new Set([...before, ...after])) {
    const [a, b] = k.split("-").map(Number) as [number, number];
    bonds.push({ a, b, kind: before.has(k) && after.has(k) ? "kept" : before.has(k) ? "broken" : "formed" });
  }

  const labels: Label[] = [...R.labels.map((l) => ({ ...l, phase: "start" as const })), ...P.labels.map((l) => ({ ...l, phase: "end" as const }))];

  const count = (list: { sym: AtomSym }[]) => list.reduce<Record<string, number>>((m, a) => ({ ...m, [a.sym]: (m[a.sym] ?? 0) + 1 }), {});
  return { atoms, bonds, labels, counts: { before: count(R.atoms), after: count(P.atoms) } };
}
