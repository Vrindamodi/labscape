import { motion, useReducedMotion } from "framer-motion";

/**
 * Illustrated scenes for the emergency simulator. Hazards scale with the 0-100 hazard level: fire
 * grows, smoke sheets come down from the ceiling (teaching "stay low"), sparks crackle, a spill
 * spreads, skin reddens. Consequences are shown through the hazard, never through injuries.
 */
export type Kind = "fire" | "spill" | "electric" | "burn";

const W = 640;
const H = 360;

export function SceneArt({ kind, hazard, calm, alarm }: { kind: Kind; hazard: number; calm: boolean; alarm: boolean }) {
  const reduced = useReducedMotion();
  const h = Math.max(0, Math.min(100, hazard)) / 100;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label={`${kind} scene, danger ${Math.round(hazard)} out of 100`}>
      <defs>
        <linearGradient id="smoke" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#3b3f47" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#4b5059" stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id="flame">
          <stop offset="0%" stopColor="#fff3b0" />
          <stop offset="40%" stopColor="#ffb02e" />
          <stop offset="100%" stopColor="#e8590c" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
          <stop offset="60%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor={alarm ? "#c92a2a" : "#000"} stopOpacity={alarm ? 0.55 : 0.4} />
        </radialGradient>
      </defs>
      {kind === "fire" && <Kitchen h={h} reduced={!!reduced} />}
      {kind === "spill" && <Lab h={h} />}
      {kind === "electric" && <Room h={h} reduced={!!reduced} />}
      {kind === "burn" && <Burn h={h} />}
      {/* smoke comes down from the ceiling as danger rises */}
      {(kind === "fire" || kind === "electric") && <motion.rect x={0} y={0} width={W} fill="url(#smoke)" animate={{ height: H * Math.min(0.75, h * 0.85) }} transition={{ duration: reduced ? 0 : 1.2 }} />}
      <rect width={W} height={H} fill="url(#vignette)" />
      {calm && !reduced && <motion.rect width={W} height={H} fill="#20c997" initial={{ opacity: 0.25 }} animate={{ opacity: 0 }} transition={{ duration: 1 }} />}
      {alarm && !reduced && <motion.rect width={W} height={H} fill="#e03131" initial={{ opacity: 0.35 }} animate={{ opacity: 0 }} transition={{ duration: 0.6 }} />}
    </svg>
  );
}

function Flames({ x, y, size, reduced }: { x: number; y: number; size: number; reduced: boolean }) {
  if (size < 0.05) return null;
  return (
    <g>
      {[0, 1, 2].map((i) => (
        <motion.ellipse
          key={i}
          cx={x + (i - 1) * 14 * size}
          cy={y - 30 * size}
          rx={18 * size + 6}
          ry={46 * size + 10}
          fill="url(#flame)"
          animate={reduced ? {} : { ry: [46 * size + 10, 56 * size + 12, 46 * size + 10], opacity: [0.9, 1, 0.85] }}
          transition={{ repeat: Infinity, duration: 0.6 + i * 0.15 }}
        />
      ))}
    </g>
  );
}

function Kitchen({ h, reduced }: { h: number; reduced: boolean }) {
  return (
    <g>
      <rect width={W} height={H} fill="#2b2f3a" />
      <rect y={250} width={W} height={110} fill="#3d3328" />
      <rect x={420} y={60} width={120} height={90} fill="#8fb4d8" opacity={0.5} stroke="#ccc" />
      <rect x={60} y={180} width={300} height={80} fill="#d8d2c4" />
      <rect x={60} y={176} width={300} height={8} fill="#9a8f80" />
      <rect x={120} y={164} width={90} height={14} rx={3} fill="#222" />
      <circle cx={145} cy={171} r={8} fill="#444" />
      <circle cx={185} cy={171} r={8} fill="#444" />
      {/* LPG cylinder under the counter */}
      <rect x={250} y={200} width={60} height={88} rx={20} fill="#c92a2a" />
      <rect x={268} y={190} width={24} height={14} rx={3} fill="#868e96" />
      <path d="M 280 190 C 280 170, 200 180, 165 170" stroke="#222" strokeWidth={4} fill="none" />
      <Flames x={280} y={196} size={0.3 + h * 1.4} reduced={reduced} />
      <rect x={560} y={140} width={60} height={150} fill="#6b4f35" />
      <circle cx={570} cy={220} r={4} fill="#ccc" />
    </g>
  );
}

function Lab({ h }: { h: number }) {
  return (
    <g>
      <rect width={W} height={H} fill="#1f2a3d" />
      <rect y={260} width={W} height={100} fill="#3b4252" />
      <rect x={80} y={170} width={480} height={20} fill="#495057" />
      <rect x={90} y={190} width={20} height={70} fill="#343a40" />
      <rect x={530} y={190} width={20} height={70} fill="#343a40" />
      {[160, 220, 280].map((x) => (
        <rect key={x} x={x} y={120} width={30} height={50} rx={4} fill="#dbe4ff" opacity={0.6} />
      ))}
      <path d="M 330 150 l 14 -6 l 6 12 l -12 8 z" fill="#dbe4ff" opacity={0.7} />
      {/* spreading puddle on the bench and floor */}
      <ellipse cx={350} cy={175} rx={40 + h * 120} ry={6 + h * 4} fill="#ffe066" opacity={0.55} />
      <ellipse cx={360} cy={300} rx={10 + h * 140} ry={4 + h * 18} fill="#ffe066" opacity={0.45} />
      <text x={120} y={110} fill="#ffd43b" fontSize={12} fontWeight={700}>
        ⚠ CORROSIVE
      </text>
    </g>
  );
}

function Room({ h, reduced }: { h: number; reduced: boolean }) {
  return (
    <g>
      <rect width={W} height={H} fill="#262b38" />
      <rect y={270} width={W} height={90} fill="#3a3229" />
      <rect x={380} y={40} width={160} height={180} fill="#5c7cfa" opacity={0.18} />
      <path d={`M 360 40 L 380 40 L 380 ${230 - h * 30} L 360 230 Z`} fill="#a5b4fc" opacity={0.7} />
      <rect x={120} y={250} width={140} height={24} rx={4} fill="#e9ecef" />
      {[140, 175, 210, 240].map((x) => (
        <rect key={x} x={x} y={244} width={16} height={12} fill="#495057" />
      ))}
      <path d="M 190 262 C 230 290, 280 280, 320 300" stroke="#222" strokeWidth={5} fill="none" />
      <rect x={300} y={290} width={120} height={14} rx={2} fill="#adb5bd" />
      {/* sparks */}
      {h > 0.1 &&
        Array.from({ length: Math.round(4 + h * 10) }, (_, i) => (
          <motion.circle key={i} cx={190 + Math.cos(i * 1.7) * 30} cy={248 + Math.sin(i * 2.3) * 18} r={2} fill="#ffe066" animate={reduced ? {} : { opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 0.4, delay: i * 0.05 }} />
        ))}
      {h > 0.45 && <Flames x={370} y={230} size={(h - 0.45) * 1.6} reduced={reduced} />}
      <rect x={30} y={60} width={50} height={70} rx={4} fill="#495057" />
      <text x={36} y={100} fill="#adb5bd" fontSize={10} fontWeight={700}>
        MCB
      </text>
    </g>
  );
}

function Burn({ h }: { h: number }) {
  return (
    <g>
      <rect width={W} height={H} fill="#1f2a3d" />
      <rect x={60} y={200} width={520} height={20} fill="#495057" />
      {/* tap */}
      <path d="M 470 60 L 470 100 L 520 100" stroke="#adb5bd" strokeWidth={14} fill="none" strokeLinecap="round" />
      <rect x={440} y={180} width={120} height={22} rx={6} fill="#adb5bd" />
      {/* hand with reddened fingertips */}
      <path d="M 180 210 C 180 150, 200 130, 230 130 L 300 130 C 320 130, 320 150, 300 152 L 250 152 C 270 152, 340 150, 360 150 C 380 150, 380 172, 360 172 L 260 172 C 260 190, 220 210, 180 210 Z" fill="#e0b394" />
      <ellipse cx={355} cy={160} rx={18} ry={10} fill="#e03131" opacity={0.25 + h * 0.6} />
      <ellipse cx={305} cy={141} rx={14} ry={8} fill="#e03131" opacity={0.2 + h * 0.5} />
      <rect x={90} y={150} width={50} height={50} rx={6} fill="#dbe4ff" opacity={0.5} />
      <text x={92} y={140} fill="#ffa8a8" fontSize={11} fontWeight={700}>
        HOT
      </text>
    </g>
  );
}
