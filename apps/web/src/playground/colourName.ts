/** Everyday colour words for captions ("White precipitate", "Lilac flame"). Nearest match wins. */
const NAMED: [string, string][] = [
  ["white", "#f6f6f4"],
  ["off-white", "#e8ddc8"],
  ["grey", "#8f969e"],
  ["silver-grey", "#cfd4da"],
  ["black", "#1a1a1c"],
  ["pale yellow", "#f2e27a"],
  ["yellow", "#f2e040"],
  ["golden-yellow", "#f7c21a"],
  ["cream", "#eee3bf"],
  ["orange", "#ff8a2a"],
  ["orange-brown", "#c8641e"],
  ["rust-brown", "#9b4a1c"],
  ["dark brown", "#4a2f1d"],
  ["pinky-brown", "#b5653a"],
  ["red", "#e0302a"],
  ["crimson", "#ff2a4a"],
  ["pink", "#e8338a"],
  ["purple", "#7b1f8a"],
  ["violet", "#8a4fd0"],
  ["lilac", "#c08cff"],
  ["blue", "#3a8ee0"],
  ["pale blue", "#a8d4ff"],
  ["deep blue", "#1d3fd0"],
  ["blue-green", "#3fe0b0"],
  ["green", "#3fa38a"],
  ["pale green", "#a6d6a0"],
  ["dirty green", "#6d8f58"],
  ["yellow-green", "#cfe35a"],
  ["apple-green", "#a6f05a"],
];

const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] as const;
};

/** Squared distance with rough perceptual weights. */
export function colourDistance(a: string, b: string) {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return 2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2;
}

export function colourName(hex: string): string {
  if (!/^#?[0-9a-f]{6}$/i.test(hex)) return "coloured";
  let best = NAMED[0]![0];
  let bestD = Infinity;
  for (const [name, h] of NAMED) {
    const d = colourDistance(hex, h);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

export const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
