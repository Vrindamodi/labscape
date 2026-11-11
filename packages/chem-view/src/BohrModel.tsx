import { configuration } from "./elements";

/**
 * Bohr shell diagram: one ring per shell, electrons evenly spaced, outer shells turning slower.
 * SVG with SMIL rotation so it is crisp at any size and costs nothing when idle.
 */
export function BohrModel({ z, symbol, colour = "#2f80ff", size = 220, animate = true }: { z: number; symbol: string; colour?: string; size?: number; animate?: boolean }) {
  const { shells } = configuration(z);
  const c = size / 2;
  const inner = size * 0.13;
  const step = (c - inner - 8) / Math.max(shells.length, 1);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Bohr model: ${shells.join(", ")} electrons per shell`}>
      <defs>
        <radialGradient id={`nuc-${z}`}>
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="45%" stopColor={colour} stopOpacity="0.9" />
          <stop offset="100%" stopColor={colour} stopOpacity="0.15" />
        </radialGradient>
        <filter id={`glow-${z}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx={c} cy={c} r={inner} fill={`url(#nuc-${z})`} />
      <text x={c} y={c + 1} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontWeight={800} fontSize={inner * 0.78} className="fill-[#1a1a1a] dark:fill-white">
        {symbol}
      </text>
      {shells.map((count, i) => {
        const r = inner + step * (i + 1);
        const dots = Math.min(count, 32);
        const period = 6 + i * 4;
        return (
          <g key={i}>
            {/* Classes beat the presentation attributes: ink tones on light surfaces, the glow palette on dark ones. */}
            <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(160,190,255,.22)" strokeWidth={1} className="stroke-ink/30 dark:stroke-[rgba(160,190,255,.22)]" />
            <g>
              {Array.from({ length: dots }, (_, k) => {
                const a = (k / dots) * Math.PI * 2 + i * 0.4;
                return <circle key={k} cx={c + r * Math.cos(a)} cy={c + r * Math.sin(a)} r={Math.max(1.6, size * 0.014)} fill="#8cc4ff" filter={`url(#glow-${z})`} className="fill-[#2f6bff] dark:fill-[#8cc4ff]" />;
              })}
              {animate && <animateTransform attributeName="transform" type="rotate" from={`0 ${c} ${c}`} to={`${i % 2 ? -360 : 360} ${c} ${c}`} dur={`${period}s`} repeatCount="indefinite" />}
            </g>
            <text x={c + r * Math.cos(-0.9)} y={c + r * Math.sin(-0.9) - 4} fill="rgba(200,215,255,.55)" fontSize={Math.max(8, size * 0.04)} fontWeight={700} className="fill-ink-muted dark:fill-[rgba(200,215,255,.55)]">
              {count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
