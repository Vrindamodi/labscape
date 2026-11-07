/**
 * Line diagrams for "label the diagram" questions. Coordinates are percentages of a 100 x 100 box;
 * the targets in content/quizzes match these drawings.
 */
const stroke = { stroke: "#cfe0ff", strokeWidth: 0.9, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function Burette() {
  return (
    <g>
      <rect x={46} y={6} width={8} height={72} rx={1} {...stroke} />
      <rect x={46.6} y={14} width={6.8} height={63.4} fill="rgba(124,192,255,.25)" />
      <path d="M 46.6 14 Q 50 15.6 53.4 14" {...stroke} stroke="#7cf3ff" />
      {Array.from({ length: 13 }, (_, i) => (
        <line key={i} x1={54} y1={18 + i * 4.6} x2={i % 2 ? 56 : 58} y2={18 + i * 4.6} {...stroke} strokeWidth={0.5} />
      ))}
      <rect x={44} y={79} width={12} height={5} rx={1} {...stroke} />
      <rect x={56} y={80.5} width={9} height={2} rx={0.8} fill="#2f80ff" />
      <path d="M 48 84 L 49.3 95 L 50.7 95 L 52 84" {...stroke} />
    </g>
  );
}

function Bunsen() {
  return (
    <g>
      <path d="M 50 4 C 42 14 44 24 50 30 C 56 24 58 14 50 4 Z" fill="rgba(80,140,255,.35)" stroke="#6ea8ff" strokeWidth={0.9} />
      <path d="M 50 14 C 47 19 48 24 50 27 C 52 24 53 19 50 14 Z" fill="rgba(140,200,255,.6)" />
      <rect x={45} y={30} width={10} height={50} rx={1} {...stroke} />
      <rect x={44} y={70} width={12} height={8} rx={1} {...stroke} />
      <circle cx={50} cy={74} r={2} {...stroke} />
      <path d="M 30 88 L 70 88 L 72 94 L 28 94 Z" {...stroke} />
      <path d="M 55 84 L 84 84 L 84 88" {...stroke} />
      <rect x={45} y={80} width={10} height={8} {...stroke} />
    </g>
  );
}

function Circuit() {
  return (
    <g>
      <rect x={10} y={9} width={82} height={82} rx={2} {...stroke} strokeWidth={0.7} />
      {/* cell on the left side */}
      <rect x={6} y={44} width={8} height={12} fill="#0b1430" />
      <line x1={6} y1={47} x2={14} y2={47} {...stroke} strokeWidth={1.4} />
      <line x1={8} y1={53} x2={12} y2={53} {...stroke} strokeWidth={2.2} />
      {/* ammeter on top */}
      <circle cx={50} cy={9} r={5} {...stroke} fill="#0b1430" />
      <text x={50} y={11} fontSize={5} textAnchor="middle" fill="#cfe0ff" fontWeight={700}>
        A
      </text>
      {/* resistor on the right */}
      <rect x={67} y={44} width={10} height={12} fill="#0b1430" />
      <rect x={68} y={42} width={8} height={16} {...stroke} />
      {/* voltmeter across the resistor */}
      <path d="M 72 30 L 92 30 L 92 70 L 72 70" {...stroke} strokeWidth={0.6} />
      <line x1={72} y1={9} x2={72} y2={42} {...stroke} strokeWidth={0.7} />
      <line x1={72} y1={58} x2={72} y2={91} {...stroke} strokeWidth={0.7} />
      <circle cx={92} cy={50} r={5} {...stroke} fill="#0b1430" />
      <text x={92} y={52} fontSize={5} textAnchor="middle" fill="#cfe0ff" fontWeight={700}>
        V
      </text>
    </g>
  );
}

function Slab() {
  return (
    <g>
      <rect x={10} y={30} width={80} height={36} {...stroke} fill="rgba(160,210,255,.15)" />
      <line x1={30} y1={8} x2={30} y2={50} stroke="#cfe0ff" strokeWidth={0.6} strokeDasharray="2 1.5" />
      <line x1={10} y1={4} x2={30} y2={30} stroke="#ffd43b" strokeWidth={1} />
      <line x1={30} y1={30} x2={46} y2={66} stroke="#ffd43b" strokeWidth={1} />
      <line x1={46} y1={66} x2={66} y2={92} stroke="#ffd43b" strokeWidth={1} />
      <line x1={46} y1={56} x2={46} y2={80} stroke="#cfe0ff" strokeWidth={0.6} strokeDasharray="2 1.5" />
    </g>
  );
}

export const DIAGRAMS: Record<string, () => JSX.Element> = { burette: Burette, bunsen: Bunsen, circuit: Circuit, slab: Slab };
