import type { ReactNode } from "react";

/**
 * Flat 2.5D icons for the emergency tool tray, drawn on a 48x48 grid. Rendered as a nested <svg>, so they work
 * in HTML (the tray, the drag ghost) and inside the scene SVG (debrief stills mark where a tool was used).
 */
export function ToolIcon({ id, size = 40, x, y, title }: { id: string; size?: number; x?: number; y?: number; title?: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} x={x} y={y} aria-hidden={title ? undefined : true} role={title ? "img" : undefined} aria-label={title}>
      <ellipse cx={24} cy={43} rx={15} ry={3} fill="#000" opacity={0.25} />
      {ICONS[id] ?? <Fallback id={id} />}
    </svg>
  );
}

function Fallback({ id }: { id: string }) {
  return (
    <g>
      <circle cx={24} cy={23} r={15} fill="#495057" />
      <text x={24} y={29} textAnchor="middle" fontSize={16} fontWeight={800} fill="#fff">
        {id.slice(0, 1).toUpperCase()}
      </text>
    </g>
  );
}

const SKIN = "#e0a87c";

const ICONS: Record<string, ReactNode> = {
  point: (
    <g>
      <path d="M4 24 C 12 12, 36 12, 44 24 C 36 36, 12 36, 4 24 Z" fill="#f8f9fa" />
      <circle cx={24} cy={24} r={8} fill="#228be6" />
      <circle cx={24} cy={24} r={4} fill="#0b1324" />
      <circle cx={21.5} cy={21.5} r={1.8} fill="#fff" />
    </g>
  ),
  hands: (
    <g>
      <rect x={13} y={20} width={22} height={20} rx={8} fill={SKIN} />
      {[14, 19.5, 25, 30.5].map((fx, i) => (
        <rect key={fx} x={fx} y={i === 0 || i === 3 ? 10 : 6} width={5} height={18} rx={2.5} fill={SKIN} stroke="#b97a52" strokeWidth={0.6} />
      ))}
      <rect x={4} y={22} width={14} height={6} rx={3} fill={SKIN} transform="rotate(-35 11 25)" stroke="#b97a52" strokeWidth={0.6} />
    </g>
  ),
  "wet-towel": (
    <g>
      <path d="M8 16 h32 v20 a4 4 0 0 1 -4 4 h-24 a4 4 0 0 1 -4 -4 z" fill="#3b5bdb" />
      <path d="M8 16 h32 v6 h-32 z" fill="#5c7cfa" />
      <path d="M8 30 h32" stroke="#91a7ff" strokeWidth={2} />
      <path d="M17 41 q2 4 0 6 q-2 -2 0 -6 z M30 41 q2 4 0 6 q-2 -2 0 -6 z" fill="#74c0fc" />
      <path d="M22 8 q3 5 0 8 q-3 -3 0 -8 z" fill="#74c0fc" />
    </g>
  ),
  towel: (
    <g>
      <path d="M8 16 h32 v20 a4 4 0 0 1 -4 4 h-24 a4 4 0 0 1 -4 -4 z" fill="#e8c07d" />
      <path d="M8 16 h32 v6 h-32 z" fill="#f2d49b" />
      <path d="M8 30 h32" stroke="#c4964a" strokeWidth={2} />
    </g>
  ),
  "fire-blanket": (
    <g>
      <rect x={10} y={6} width={28} height={34} rx={4} fill="#e03131" />
      <rect x={14} y={12} width={20} height={14} rx={2} fill="#fff" />
      <path d="M24 14 c4 4 4 8 0 10 c-4 -2 -4 -6 0 -10 z" fill="#e03131" />
      <rect x={13} y={36} width={6} height={8} rx={2} fill="#212529" />
      <rect x={29} y={36} width={6} height={8} rx={2} fill="#212529" />
    </g>
  ),
  "water-bucket": (
    <g>
      <path d="M10 16 h28 l-4 24 h-20 z" fill="#adb5bd" />
      <ellipse cx={24} cy={16} rx={14} ry={4} fill="#4dabf7" />
      <path d="M10 16 C 10 2, 38 2, 38 16" stroke="#868e96" strokeWidth={2} fill="none" />
      <path d="M12 26 h24" stroke="#868e96" strokeWidth={1.5} />
    </g>
  ),
  newspaper: (
    <g>
      <rect x={8} y={8} width={32} height={32} rx={2} fill="#e9ecef" transform="rotate(-8 24 24)" />
      <g transform="rotate(-8 24 24)" stroke="#868e96" strokeWidth={2}>
        <path d="M12 14 h24" strokeWidth={4} stroke="#495057" />
        <path d="M12 22 h11 M12 27 h11 M12 32 h11 M26 22 h10 M26 27 h10 M26 32 h10" />
      </g>
    </g>
  ),
  matchbox: (
    <g>
      <rect x={6} y={20} width={30} height={18} rx={2} fill="#f59f00" />
      <rect x={6} y={20} width={30} height={5} fill="#7a4a00" />
      <rect x={20} y={8} width={3} height={26} fill="#f1d3a3" transform="rotate(30 21 21)" />
      <circle cx={28} cy={10} r={3.4} fill="#c92a2a" />
    </g>
  ),
  phone: (
    <g>
      <rect x={14} y={4} width={20} height={38} rx={4} fill="#212529" />
      <rect x={16} y={9} width={16} height={26} rx={1.5} fill="#2b8a3e" />
      <text x={24} y={26} textAnchor="middle" fontSize={8} fontWeight={800} fill="#fff">
        112
      </text>
      <circle cx={24} cy={38.5} r={1.6} fill="#868e96" />
    </g>
  ),
  "wooden-stick": (
    <g>
      <rect x={22} y={0} width={5} height={36} rx={2} fill="#a9713f" transform="rotate(28 24 20)" />
      <path d="M26 34 l14 -4 l2 10 l-14 4 z" fill="#d9a441" />
      <path d="M30 36 l2 8 M34 35 l2 8 M38 34 l2 7" stroke="#a9713f" strokeWidth={1} />
    </g>
  ),
  co2: (
    <g>
      <rect x={16} y={12} width={16} height={30} rx={6} fill="#e03131" />
      <rect x={16} y={18} width={16} height={6} fill="#212529" />
      <rect x={21} y={6} width={6} height={7} fill="#495057" />
      <path d="M27 8 h8 l6 6" stroke="#212529" strokeWidth={2.5} fill="none" />
      <path d="M38 12 l6 -2 l-1 8 z" fill="#212529" />
      <text x={24} y={34} textAnchor="middle" fontSize={6} fontWeight={800} fill="#fff">
        CO2
      </text>
    </g>
  ),
  powder: (
    <g>
      <rect x={16} y={12} width={16} height={30} rx={6} fill="#e03131" />
      <rect x={16} y={18} width={16} height={6} fill="#1c7ed6" />
      <rect x={21} y={6} width={6} height={7} fill="#495057" />
      <path d="M27 9 C 40 8, 42 20, 36 28" stroke="#212529" strokeWidth={2.5} fill="none" />
      <text x={24} y={34} textAnchor="middle" fontSize={6} fontWeight={800} fill="#fff">
        ABC
      </text>
    </g>
  ),
  ppe: (
    <g>
      <path d="M4 16 h40 v8 c0 6 -8 8 -12 4 l-4 -4 h-8 l-4 4 c-4 4 -12 2 -12 -4 z" fill="#74c0fc" opacity={0.85} stroke="#1971c2" strokeWidth={1.5} />
      <path d="M14 30 h10 v12 h-10 z" fill="#5c7cfa" />
      <path d="M14 30 v-6 a2 2 0 0 1 4 0 v6 M18 30 v-8 a2 2 0 0 1 4 0 v8" fill="#5c7cfa" />
      <path d="M28 30 h10 v12 h-10 z" fill="#5c7cfa" />
    </g>
  ),
  "spill-kit": (
    <g>
      <path d="M8 14 h32 l-3 28 h-26 z" fill="#fcc419" />
      <rect x={6} y={10} width={36} height={6} rx={2} fill="#f08c00" />
      <text x={24} y={30} textAnchor="middle" fontSize={6.5} fontWeight={900} fill="#212529">
        SPILL
      </text>
      <text x={24} y={37} textAnchor="middle" fontSize={6.5} fontWeight={900} fill="#212529">
        KIT
      </text>
    </g>
  ),
  neutraliser: (
    <g>
      <rect x={10} y={12} width={28} height={30} rx={4} fill="#f8f9fa" />
      <rect x={10} y={8} width={28} height={6} rx={2} fill="#2f9e44" />
      <text x={24} y={30} textAnchor="middle" fontSize={6.5} fontWeight={800} fill="#2b8a3e">
        NaHCO3
      </text>
    </g>
  ),
  naoh: (
    <g>
      <path d="M18 4 h12 v8 l6 6 v22 a3 3 0 0 1 -3 3 h-18 a3 3 0 0 1 -3 -3 v-22 l6 -6 z" fill="#dee2e6" />
      <rect x={15} y={22} width={18} height={14} fill="#fff" />
      <path d="M24 23 l6 6 l-6 6 l-6 -6 z" fill="none" stroke="#e03131" strokeWidth={1.5} />
      <text x={24} y={31} textAnchor="middle" fontSize={4.5} fontWeight={800} fill="#212529">
        NaOH
      </text>
    </g>
  ),
  "paper-towels": (
    <g>
      <rect x={10} y={10} width={24} height={30} rx={4} fill="#f8f9fa" />
      <ellipse cx={22} cy={10} rx={12} ry={4} fill="#e9ecef" />
      <ellipse cx={22} cy={10} rx={4} ry={1.5} fill="#adb5bd" />
      <path d="M34 22 h8 v16 h-8" fill="#f1f3f5" />
    </g>
  ),
  ice: (
    <g>
      <rect x={6} y={20} width={16} height={16} rx={3} fill="#a5d8ff" stroke="#74c0fc" />
      <rect x={24} y={22} width={16} height={16} rx={3} fill="#d0ebff" stroke="#74c0fc" />
      <rect x={15} y={6} width={16} height={16} rx={3} fill="#bfe3ff" stroke="#74c0fc" />
      <path d="M10 24 l4 4 M28 26 l4 4 M19 10 l4 4" stroke="#fff" strokeWidth={1.5} />
    </g>
  ),
  butter: (
    <g>
      <path d="M6 30 l18 -10 l18 10 l-18 10 z" fill="#e9ecef" />
      <path d="M12 26 l12 -7 l12 7 v6 l-12 7 l-12 -7 z" fill="#ffe066" />
      <path d="M12 26 l12 7 l12 -7" fill="none" stroke="#fab005" strokeWidth={1.5} />
    </g>
  ),
  toothpaste: (
    <g>
      <path d="M6 18 h28 l8 4 v4 l-8 4 h-28 z" fill="#f8f9fa" stroke="#dee2e6" />
      <rect x={6} y={18} width={6} height={12} fill="#1c7ed6" />
      <rect x={40} y={21} width={5} height={6} fill="#1c7ed6" />
      <path d="M16 24 h14" stroke="#e03131" strokeWidth={3} />
    </g>
  ),
  "cling-film": (
    <g>
      <rect x={6} y={14} width={36} height={12} rx={6} fill="#ced4da" />
      <path d="M10 26 h28 l-4 16 h-20 z" fill="#d0ebff" opacity={0.6} stroke="#a5d8ff" />
      <ellipse cx={42} cy={20} rx={2} ry={6} fill="#adb5bd" />
    </g>
  ),
  "cotton-wool": (
    <g>
      <circle cx={18} cy={26} r={9} fill="#fff" />
      <circle cx={29} cy={24} r={10} fill="#f8f9fa" />
      <circle cx={24} cy={32} r={8} fill="#fff" />
      <circle cx={33} cy={33} r={6} fill="#f1f3f5" />
    </g>
  ),
};
