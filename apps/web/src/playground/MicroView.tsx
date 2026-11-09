import type { EquationTerm } from "@labscape/contracts";
import { useMotion } from "@labscape/motion";
import { motion } from "framer-motion";
import { useMemo } from "react";

/** CPK-style atom colours. */
const CPK: Record<string, string> = {
  H: "#f8fafc", O: "#ef4444", N: "#3b82f6", C: "#475569", Cl: "#22c55e", F: "#a3e635", Br: "#9f1239", I: "#7c3aed", S: "#facc15", P: "#f97316",
  Na: "#a855f7", K: "#8b5cf6", Li: "#c084fc", Mg: "#84cc16", Ca: "#94a3b8", Ba: "#16a34a", Fe: "#b45309", Cu: "#f59e0b", Zn: "#64748b", Ag: "#cbd5e1",
  Pb: "#57534e", Mn: "#9333ea", Al: "#d4d4d8", Sn: "#a1a1aa",
};
const colourOf = (el: string) => CPK[el] ?? "#f472b6";

/** Atoms in a formula, roughly (brackets and hydrates are flattened; at most 6 atoms drawn). */
export function atomsOf(formula: string): string[] {
  const clean = formula.replace(/[·.].*$/, "").replace(/\(([^)]+)\)(\d*)/g, (_, g: string, n: string) => g.repeat(Number(n || 1)));
  const out: string[] = [];
  for (const m of clean.matchAll(/([A-Z][a-z]?)(\d*)/g)) for (let i = 0; i < Math.min(4, Number(m[2] || 1)); i++) out.push(m[1]!);
  return out.slice(0, 6);
}

function Molecule({ term, x, y, r }: { term: EquationTerm; x: number; y: number; r: number }) {
  const atoms = atomsOf(term.formula);
  return (
    <g transform={`translate(${x} ${y})`}>
      {atoms.map((el, i) => {
        const a = (i / Math.max(1, atoms.length - 1)) * Math.PI * 2;
        const d = i === 0 ? 0 : r * 0.95;
        const ax = Math.cos(a) * d, ay = Math.sin(a) * d;
        const size = el === "H" ? r * 0.55 : r * 0.8;
        return (
          <g key={i}>
            {i > 0 && <line x1={0} y1={0} x2={ax} y2={ay} stroke="#cbd5e1" strokeOpacity=".5" strokeWidth={r * 0.18} />}
            <circle cx={ax} cy={ay} r={size} fill={`url(#atom-${el})`} />
            <text x={ax} y={ay + size * 0.32} textAnchor="middle" fontSize={size * 0.85} fontWeight={700} fill={el === "H" || el === "Ag" || el === "Al" ? "#0f172a" : "#fff"} fontFamily="Inter, sans-serif">
              {el}
            </text>
          </g>
        );
      })}
      {term.charge && (
        <text x={r * 1.6} y={-r * 1.1} fontSize={r * 0.9} fontWeight={700} fill="#39d6ff" fontFamily="Inter, sans-serif">
          {term.charge}
        </text>
      )}
    </g>
  );
}

/**
 * The reaction seen at the scale of particles (v3 "micro view"): the reactants drift together,
 * flash, and the products drift apart, on a loop. Drawn from the engine's structured equation.
 */
export function MicroView({ reactants, products, size = 360, label = true }: { reactants: EquationTerm[]; products: EquationTerm[]; size?: number; label?: boolean }) {
  const { reduced } = useMotion();
  const els = useMemo(() => [...new Set([...reactants, ...products].flatMap((t) => atomsOf(t.formula)))], [reactants, products]);
  const R = reactants.slice(0, 3), P = products.slice(0, 3);
  const c = 180, r = 13;
  const loop = { duration: 4.2, repeat: Infinity, ease: "easeInOut" as const, times: [0, 0.4, 0.5, 1] };
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 360 360" className="h-full w-full overflow-visible" role="img" aria-label={`Particles: ${R.map((t) => t.formula).join(" + ")} become ${P.map((t) => t.formula).join(" + ")}`}>
        <defs>
          <radialGradient id="mv-bg" cx="50%" cy="45%" r="60%">
            <stop offset="0" stopColor="#2850aa" stopOpacity=".9" />
            <stop offset="1" stopColor="#060e28" stopOpacity=".97" />
          </radialGradient>
          {els.map((el) => (
            <radialGradient key={el} id={`atom-${el}`} cx="35%" cy="30%" r="70%">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".95" />
              <stop offset=".25" stopColor={colourOf(el)} />
              <stop offset="1" stopColor={colourOf(el)} stopOpacity=".75" />
            </radialGradient>
          ))}
          <clipPath id="mv-clip">
            <circle cx={c} cy={c} r={176} />
          </clipPath>
        </defs>
        <circle cx={c} cy={c} r={178} fill="url(#mv-bg)" stroke="rgba(160,200,255,.55)" strokeWidth={2} />
        <g clipPath="url(#mv-clip)">
          {/* faint water/solvent molecules jiggling in the background */}
          {Array.from({ length: 14 }, (_, i) => (
            <motion.circle key={i} cx={30 + ((i * 97) % 300)} cy={30 + ((i * 61) % 300)} r={4} fill="#9fc4ff" fillOpacity={0.18} animate={reduced ? {} : { x: [0, 6, -4, 0], y: [0, -5, 4, 0] }} transition={{ duration: 3 + (i % 4), repeat: Infinity }} />
          ))}
          {R.map((t, i) => {
            const y0 = c + (i - (R.length - 1) / 2) * 70;
            return (
              <motion.g key={`r${i}`} animate={reduced ? {} : { x: [0, 70, 70, 70], y: [0, (c - y0) * 0.7, (c - y0) * 0.7, (c - y0) * 0.7], opacity: [1, 1, 0, 0] }} transition={loop}>
                <Molecule term={t} x={55} y={y0} r={r} />
              </motion.g>
            );
          })}
          <motion.circle cx={c} cy={c} r={30} fill="#fff" animate={reduced ? { opacity: 0 } : { opacity: [0, 0, 0.75, 0], scale: [0.5, 0.5, 1.6, 2] }} transition={loop} style={{ transformOrigin: `${c}px ${c}px` }} />
          {P.map((t, i) => {
            const y1 = c + (i - (P.length - 1) / 2) * 70;
            return (
              <motion.g key={`p${i}`} animate={reduced ? { opacity: 1 } : { x: [-70, -70, -70, 0], y: [(c - y1) * 0.7, (c - y1) * 0.7, (c - y1) * 0.7, 0], opacity: [0, 0, 1, 1] }} transition={loop}>
                <Molecule term={t} x={305} y={y1} r={r} />
              </motion.g>
            );
          })}
        </g>
      </svg>
      {label && <span className="absolute left-1/2 top-[-14px] -translate-x-1/2 rounded-[10px] bg-[rgba(14,26,56,.9)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#9fd8ff] ring-1 ring-[rgba(140,180,255,.25)]">Micro view · 100 000 000×</span>}
    </div>
  );
}
