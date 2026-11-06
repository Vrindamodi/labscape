/** Hand-drawn solid forms that sit at the bottom of the beaker (and on shelf cards). */
type Props = { form: string; fill: string; stroke?: string; seed?: number };

export function SolidShape({ form, fill, stroke = "rgba(0,0,0,0.35)", seed = 0 }: Props) {
  const j = (n: number) => Math.sin(seed * 12.9898 + n * 78.233) * 0.5 + 0.5;
  switch (form) {
    case "ribbon":
      return (
        <g>
          <path
            d="M-22,-2 C-14,-14 -6,10 2,-4 S16,-12 22,-2"
            fill="none"
            stroke={fill}
            strokeWidth={4.5}
            strokeLinecap="round"
          />
          <path
            d="M-22,-2 C-14,-14 -6,10 2,-4 S16,-12 22,-2"
            fill="none"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth={1.2}
            strokeLinecap="round"
            transform="translate(0,-1)"
          />
        </g>
      );
    case "granules":
      return (
        <g stroke={stroke} strokeWidth={0.6}>
          {[-14, -5, 5, 14, -9, 9].map((x, i) => (
            <path
              key={i}
              d={`M${x - 4},0 L${x - 3},${-5 - j(i) * 3} L${x + 2},${-7 - j(i + 3) * 2} L${x + 5},${-2} L${x + 2},1 Z`}
              transform={i > 3 ? `translate(0,-6)` : undefined}
              fill={fill}
            />
          ))}
        </g>
      );
    case "filings":
      return (
        <g fill={fill}>
          {Array.from({ length: 34 }, (_, i) => (
            <rect
              key={i}
              x={-20 + j(i) * 40}
              y={-1 - j(i + 40) * 7 * (1 - Math.abs(j(i) - 0.5))}
              width={1.6 + j(i + 7)}
              height={1.1}
              transform={`rotate(${j(i + 3) * 180})`}
            />
          ))}
        </g>
      );
    case "turnings":
      return (
        <g fill="none" stroke={fill} strokeWidth={2.4} strokeLinecap="round">
          <path d="M-18,0 c2,-10 10,-10 8,-2 s-8,6 -4,-6" />
          <path d="M2,0 c2,-12 12,-10 10,-2 s-10,4 -6,-8" />
          <path d="M-6,-6 c4,-6 10,-2 6,2" />
        </g>
      );
    case "chips":
      return (
        <g stroke={stroke} strokeWidth={0.6}>
          <path d="M-20,0 L-18,-9 L-9,-11 L-6,-3 L-10,1 Z" fill={fill} />
          <path d="M-5,1 L-3,-12 L7,-13 L10,-4 L6,1 Z" fill={fill} />
          <path d="M9,0 L11,-8 L19,-9 L21,-1 Z" fill={fill} />
          <path d="M-3,-12 L7,-13 L5,-9 Z" fill="rgba(255,255,255,0.35)" />
        </g>
      );
    case "crystals":
      return (
        <g stroke="rgba(255,255,255,0.35)" strokeWidth={0.6}>
          {[-14, -4, 6, 15].map((x, i) => (
            <path
              key={i}
              d={`M${x},${-1} L${x - 4},${-6 - j(i) * 2} L${x},${-12 - j(i + 2) * 3} L${x + 4},${-6} Z`}
              fill={fill}
            />
          ))}
        </g>
      );
    default:
      // powder heap
      return (
        <g>
          <path
            d="M-24,0 C-16,-4 -10,-12 0,-12 C10,-12 16,-4 24,0 Z"
            fill={fill}
            stroke={stroke}
            strokeWidth={0.5}
          />
          <path
            d="M-10,-9 C-4,-12 4,-12 8,-10"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={1.2}
            fill="none"
          />
        </g>
      );
  }
}
