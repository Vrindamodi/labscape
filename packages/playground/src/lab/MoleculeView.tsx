import type { EquationTerm } from "@labscape/contracts";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Formula } from "../components/bits";

/** CPK-style atom colours. */
const ATOM_COLOURS: Record<string, string> = {
  H: "#f1f5f9",
  C: "#334155",
  N: "#3b82f6",
  O: "#ef4444",
  F: "#a3e635",
  Cl: "#22c55e",
  Br: "#b45309",
  I: "#7c3aed",
  S: "#facc15",
  P: "#f97316",
  Na: "#a855f7",
  K: "#c084fc",
  Li: "#d946ef",
  Mg: "#16a34a",
  Ca: "#65a30d",
  Fe: "#ea580c",
  Cu: "#c2410c",
  Zn: "#64748b",
  Ag: "#cbd5e1",
  Al: "#94a3b8",
  Ba: "#14b8a6",
  Pb: "#475569",
  Mn: "#be185d",
  Si: "#d4a373",
};

function atomColour(el: string) {
  return ATOM_COLOURS[el] ?? "#f472b6";
}

function atomRadius(el: string) {
  return el === "H" ? 6 : el.length === 1 ? 9 : 10.5;
}

/** "Ca(OH)2" -> {Ca:1, O:2, H:2}; handles brackets, hydrates and ignores charges. */
export function parseFormula(formula: string): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (el: string, n: number) => (out[el] = (out[el] ?? 0) + n);
  const parts = formula.split("·");
  for (const part of parts) {
    const m = part.match(/^(\d+)(.*)$/);
    const mult = m && m[1] ? parseInt(m[1], 10) : 1;
    const body = (m && m[2] !== undefined ? m[2] : part).replace(/\^.*$/, "").replace(/[+-]$/, "");
    const stack: Record<string, number>[] = [{}];
    let i = 0;
    while (i < body.length) {
      const ch = body.charAt(i);
      if (ch === "(" || ch === "[") {
        stack.push({});
        i++;
      } else if (ch === ")" || ch === "]") {
        i++;
        let num = "";
        while (i < body.length && /\d/.test(body.charAt(i))) num += body.charAt(i++);
        const group = stack.pop() ?? {};
        const k = num ? parseInt(num, 10) : 1;
        const top = stack[stack.length - 1] ?? {};
        for (const [el, n] of Object.entries(group)) top[el] = (top[el] ?? 0) + n * k;
      } else if (/[A-Z]/.test(ch)) {
        let el = ch;
        i++;
        while (i < body.length && /[a-z]/.test(body.charAt(i))) el += body.charAt(i++);
        let num = "";
        while (i < body.length && /\d/.test(body.charAt(i))) num += body.charAt(i++);
        const top = stack[stack.length - 1] ?? {};
        top[el] = (top[el] ?? 0) + (num ? parseInt(num, 10) : 1);
      } else {
        i++;
      }
    }
    for (const [el, n] of Object.entries(stack[0] ?? {})) add(el, n * mult);
  }
  return out;
}

type Placed = { el: string; x: number; y: number };
type Cluster = { formula: string; charge?: string; x: number; y: number; atoms: Placed[] };

const W = 320;
const H = 150;

function layoutSide(terms: EquationTerm[], x0: number, x1: number): Cluster[] {
  const instances: { term: EquationTerm }[] = [];
  for (const t of terms) for (let i = 0; i < Math.min(3, t.coef); i++) instances.push({ term: t });
  const n = instances.length;
  return instances.map(({ term }, idx) => {
    const cols = Math.min(n, 3);
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const rows = Math.ceil(n / cols);
    const cx = x0 + ((col + 0.5) / cols) * (x1 - x0);
    const cy = 22 + ((row + 0.5) / rows) * (H - 44);
    const counts = parseFormula(term.formula);
    const atoms: Placed[] = [];
    const list: string[] = [];
    for (const [el, c] of Object.entries(counts))
      for (let k = 0; k < Math.min(c, 8); k++) list.push(el);
    const ring = list.length <= 1 ? 0 : Math.min(26, 7 + list.length * 2.6);
    // heaviest atom in the middle, the rest around it
    const sorted = [...list].sort((a, b) => (a === "H" ? 1 : 0) - (b === "H" ? 1 : 0));
    sorted.forEach((el, k) => {
      if (k === 0 && sorted.length > 2) atoms.push({ el, x: cx, y: cy });
      else {
        const m = sorted.length > 2 ? sorted.length - 1 : sorted.length;
        const j = sorted.length > 2 ? k - 1 : k;
        const a = (j / m) * Math.PI * 2 - Math.PI / 2;
        atoms.push({ el, x: cx + Math.cos(a) * ring, y: cy + Math.sin(a) * ring * 0.8 });
      }
    });
    const cluster: Cluster = { formula: term.formula, x: cx, y: cy, atoms };
    if (term.charge) cluster.charge = term.charge;
    return cluster;
  });
}

export function MoleculeView({
  reactants,
  products,
  title,
}: {
  reactants: EquationTerm[];
  products: EquationTerm[];
  title: string;
}) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<0 | 1>(0);
  const [cycle, setCycle] = useState(0);

  const plan = useMemo(() => {
    const left = layoutSide(reactants, 8, W / 2 - 22);
    const right = layoutSide(products, W / 2 + 22, W - 8);
    const pool = new Map<string, Placed[]>();
    for (const c of left) for (const a of c.atoms) pool.set(a.el, [...(pool.get(a.el) ?? []), a]);
    const moves: { el: string; from: Placed; to: Placed }[] = [];
    let balanced = true;
    for (const c of right) {
      for (const a of c.atoms) {
        const list = pool.get(a.el);
        const from = list?.shift();
        if (!from) {
          balanced = false;
          continue;
        }
        moves.push({ el: a.el, from, to: a });
      }
    }
    for (const rest of pool.values()) if (rest.length) balanced = false;
    return { left, right, moves, balanced };
  }, [reactants, products]);

  useEffect(() => {
    setPhase(0);
    const a = window.setTimeout(() => setPhase(1), reduced ? 300 : 1100);
    return () => window.clearTimeout(a);
  }, [cycle, reduced, plan]);

  return (
    <div className="lab-molecule">
      <div className="flex items-center justify-between">
        <span className="lab-eyebrow">Watch the atoms</span>
        <button className="lab-mini lab-mini-ghost" onClick={() => setCycle((c) => c + 1)}>
          ↻ Replay
        </button>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H + 22}`}
        className="mt-1 w-full"
        role="img"
        aria-label={`Atoms rearranging: ${title}`}
      >
        <defs>
          <radialGradient id="atom-shine" cx="0.35" cy="0.3" r="0.7">
            <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <text x={W / 2} y={H / 2 + 6} textAnchor="middle" fontSize={22} fill="#94a3b8">
          →
        </text>
        {/* cluster halos + labels */}
        {plan.left.map((c, i) => (
          <motion.g key={`l${i}`} animate={{ opacity: phase === 0 || !plan.balanced ? 1 : 0.25 }}>
            <text
              x={c.x}
              y={H + 16}
              textAnchor="middle"
              fontSize={11}
              fill="#475569"
              fontFamily="JetBrains Mono, monospace"
            >
              {c.formula}
            </text>
          </motion.g>
        ))}
        {plan.right.map((c, i) => (
          <motion.g
            key={`r${i}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: phase === 1 ? 1 : 0.15 }}
            transition={{ delay: phase ? 0.9 : 0 }}
          >
            <circle
              cx={c.x}
              cy={c.y}
              r={30}
              fill="rgba(56,189,248,0.10)"
              stroke="rgba(56,189,248,0.35)"
              strokeDasharray="3 3"
            />
            <text
              x={c.x}
              y={H + 16}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill="#0f766e"
              fontFamily="JetBrains Mono, monospace"
            >
              {c.formula}
              {c.charge ? c.charge : ""}
            </text>
          </motion.g>
        ))}
        {plan.balanced
          ? plan.moves.map((m, i) => (
              <motion.g
                key={`${cycle}-${i}`}
                initial={{ x: m.from.x, y: m.from.y }}
                animate={phase === 1 ? { x: m.to.x, y: m.to.y } : { x: m.from.x, y: m.from.y }}
                transition={{
                  duration: reduced ? 0.2 : 1.1,
                  delay: reduced ? 0 : i * 0.05,
                  ease: [0.6, 0, 0.2, 1],
                }}
              >
                <circle
                  r={atomRadius(m.el)}
                  fill={atomColour(m.el)}
                  stroke="rgba(15,23,42,0.35)"
                  strokeWidth={0.8}
                />
                <circle r={atomRadius(m.el)} fill="url(#atom-shine)" />
                <text
                  y={3.5}
                  textAnchor="middle"
                  fontSize={m.el.length > 1 ? 7.5 : 9}
                  fontWeight={700}
                  fill={m.el === "H" ? "#334155" : "#fff"}
                >
                  {m.el}
                </text>
              </motion.g>
            ))
          : [...plan.left, ...plan.right].map((c, i) => (
              <motion.g
                key={`${cycle}-s${i}`}
                initial={{ opacity: 0 }}
                animate={{
                  opacity: i < plan.left.length ? (phase === 0 ? 1 : 0.3) : phase === 1 ? 1 : 0.2,
                }}
                transition={{ duration: 0.8 }}
              >
                {c.atoms.map((a, k) => (
                  <g key={k} transform={`translate(${a.x},${a.y})`}>
                    <circle
                      r={atomRadius(a.el)}
                      fill={atomColour(a.el)}
                      stroke="rgba(15,23,42,0.35)"
                      strokeWidth={0.8}
                    />
                    <text
                      y={3.5}
                      textAnchor="middle"
                      fontSize={8}
                      fontWeight={700}
                      fill={a.el === "H" ? "#334155" : "#fff"}
                    >
                      {a.el}
                    </text>
                  </g>
                ))}
              </motion.g>
            ))}
      </svg>
      <p className="text-[11.5px] leading-snug text-slate-500">
        Atoms are never created or destroyed - they just swap partners.{" "}
        {reactants.map((t) => t.coef + " " + t.formula).join(" + ")} →{" "}
        <Formula value={products.map((t) => t.coef + " " + t.formula).join(" + ")} />
      </p>
    </div>
  );
}
