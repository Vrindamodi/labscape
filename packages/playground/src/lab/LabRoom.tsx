import { motion, useReducedMotion } from "framer-motion";

const FLASKS = [
  { x: 60, c: "#ff6b6b", h: 46 },
  { x: 102, c: "#4dabf7", h: 38 },
  { x: 140, c: "#ffd43b", h: 52 },
  { x: 184, c: "#9775fa", h: 40 },
  { x: 222, c: "#38d9a9", h: 48 },
  { x: 1240, c: "#ffa94d", h: 44 },
  { x: 1282, c: "#f783ac", h: 50 },
  { x: 1324, c: "#69db7c", h: 38 },
  { x: 1362, c: "#74c0fc", h: 46 },
];

/** Decorative, bright lab room behind the workbench. Purely visual. */
export function LabRoom() {
  const reduced = useReducedMotion();
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <linearGradient id="wall" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#c9f0f7" />
          <stop offset="1" stopColor="#e9fbff" />
        </linearGradient>
        <pattern id="tiles" width="48" height="48" patternUnits="userSpaceOnUse">
          <rect width="48" height="48" fill="none" stroke="#a5dde8" strokeWidth="1.5" />
        </pattern>
        <linearGradient id="bench" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#d9a067" />
          <stop offset="0.12" stopColor="#c88a52" />
          <stop offset="1" stopColor="#9c6234" />
        </linearGradient>
        <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#74c0fc" />
          <stop offset="1" stopColor="#d0ebff" />
        </linearGradient>
        <radialGradient id="lamp" cx="0.5" cy="0" r="0.8">
          <stop offset="0" stopColor="#fff9db" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff9db" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1440" height="900" fill="url(#wall)" />
      <rect width="1440" height="640" fill="url(#tiles)" opacity="0.7" />
      <ellipse cx="720" cy="0" rx="620" ry="420" fill="url(#lamp)" />

      {/* window */}
      <g transform="translate(560,60)">
        <rect width="320" height="190" rx="10" fill="url(#sky)" stroke="#ffffff" strokeWidth="10" />
        <motion.g
          animate={reduced ? {} : { x: [0, 40, 0] }}
          transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
        >
          <ellipse cx="80" cy="60" rx="34" ry="14" fill="#fff" opacity="0.9" />
          <ellipse cx="105" cy="54" rx="24" ry="12" fill="#fff" opacity="0.9" />
          <ellipse cx="230" cy="110" rx="30" ry="11" fill="#fff" opacity="0.85" />
        </motion.g>
        <line x1="160" y1="0" x2="160" y2="190" stroke="#fff" strokeWidth="8" />
        <line x1="0" y1="95" x2="320" y2="95" stroke="#fff" strokeWidth="8" />
        <path d="M30,190 l20,-30 l15,20 l20,-40 l25,50 z" fill="#69db7c" opacity="0.6" />
      </g>

      {/* shelves with coloured flasks */}
      {[
        { x: 30, y: 190 },
        { x: 1210, y: 190 },
      ].map((s, i) => (
        <g key={i}>
          <rect x={s.x} y={s.y} width="210" height="10" rx="3" fill="#b07945" />
          <rect x={s.x} y={s.y + 120} width="210" height="10" rx="3" fill="#b07945" />
        </g>
      ))}
      {FLASKS.map((f, i) => (
        <g key={i} transform={`translate(${f.x},${i < 5 ? 190 : 190})`}>
          <path
            d={`M-8,${-f.h} h16 v${f.h * 0.4} l12,${f.h * 0.55} a4,4 0 0 1 -4,${f.h * 0.05} h-32 a4,4 0 0 1 -4,${-f.h * 0.05} l12,${-f.h * 0.55} z`}
            fill="#ffffff"
            fillOpacity="0.55"
            stroke="#5c7cfa"
            strokeOpacity="0.4"
          />
          <path d={`M-14,${-f.h * 0.28} h28 l6,${f.h * 0.25} h-40 z`} fill={f.c} opacity="0.85" />
        </g>
      ))}
      {[0, 1, 2, 3].map((i) => (
        <g key={`b${i}`} transform={`translate(${48 + i * 50},${310})`}>
          <rect
            x="-12"
            y="-44"
            width="24"
            height="44"
            rx="4"
            fill={["#e599f7", "#ffa94d", "#4dabf7", "#a9e34b"][i]}
            opacity="0.85"
          />
          <rect x="-6" y="-52" width="12" height="9" rx="2" fill="#495057" />
        </g>
      ))}
      {[0, 1, 2, 3].map((i) => (
        <g key={`c${i}`} transform={`translate(${1230 + i * 50},${310})`}>
          <rect
            x="-12"
            y="-44"
            width="24"
            height="44"
            rx="4"
            fill={["#ff8787", "#63e6be", "#ffd43b", "#748ffc"][i]}
            opacity="0.85"
          />
          <rect x="-6" y="-52" width="12" height="9" rx="2" fill="#495057" />
        </g>
      ))}

      {/* periodic table poster */}
      <g transform="translate(300,80)">
        <rect width="200" height="130" rx="6" fill="#ffffff" stroke="#dee2e6" />
        {Array.from({ length: 7 }, (_, r) =>
          Array.from({ length: 18 }, (_, c) => {
            const skip = (r === 0 && c > 0 && c < 17) || (r < 3 && r > 0 && c > 1 && c < 12);
            if (skip) return null;
            const colours = [
              "#ff8787",
              "#ffc078",
              "#ffe066",
              "#c0eb75",
              "#63e6be",
              "#74c0fc",
              "#b197fc",
              "#faa2c1",
            ];
            return (
              <rect
                key={`${r}-${c}`}
                x={10 + c * 10.2}
                y={14 + r * 15}
                width="8.6"
                height="12"
                rx="1.5"
                fill={colours[(c + r) % colours.length]}
              />
            );
          }),
        )}
      </g>

      {/* safety poster + clock */}
      <g transform="translate(940,80)">
        <rect width="150" height="120" rx="8" fill="#fff3bf" stroke="#fcc419" strokeWidth="3" />
        <text
          x="75"
          y="34"
          textAnchor="middle"
          fontSize="15"
          fontWeight="800"
          fill="#e8590c"
          fontFamily="Space Grotesk, sans-serif"
        >
          SAFETY FIRST
        </text>
        <text x="75" y="62" textAnchor="middle" fontSize="28">
          🥽 🧤
        </text>
        <text
          x="75"
          y="96"
          textAnchor="middle"
          fontSize="11"
          fill="#7c5a00"
          fontFamily="Inter, sans-serif"
        >
          Goggles on. Waft, don't sniff.
        </text>
      </g>
      <g transform="translate(1150,110)">
        <circle r="34" fill="#fff" stroke="#adb5bd" strokeWidth="4" />
        <motion.line
          x1="0"
          y1="0"
          x2="0"
          y2="-22"
          stroke="#343a40"
          strokeWidth="3"
          strokeLinecap="round"
          animate={reduced ? {} : { rotate: 360 }}
          transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
        />
        <line x1="0" y1="0" x2="14" y2="0" stroke="#343a40" strokeWidth="4" strokeLinecap="round" />
      </g>

      {/* bench */}
      <rect x="0" y="640" width="1440" height="260" fill="url(#bench)" />
      <rect x="0" y="640" width="1440" height="10" fill="#e8b27c" />
      <rect x="0" y="650" width="1440" height="4" fill="#000" opacity="0.08" />
    </svg>
  );
}
