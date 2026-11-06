import type { Oklab } from "@labscape/contracts";

function toSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

/** Oklab -> CSS rgba(). */
export function oklabToCss(c: Oklab, alphaScale = 1): string {
  const l_ = c.L + 0.3963377774 * c.a + 0.2158037573 * c.b;
  const m_ = c.L - 0.1055613458 * c.a - 0.0638541728 * c.b;
  const s_ = c.L - 0.0894841775 * c.a - 1.291485548 * c.b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const b = toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  const a = Math.min(1, Math.max(0, (c.alpha ?? 1) * alphaScale));
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Blend liquids by volume for the pour animation (physical mixing only, not a reaction). */
export function blendHex(items: { hex: string; weight: number; opacity: number }[]): string {
  let tw = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (const it of items) {
    const h = it.hex.replace("#", "");
    const w = it.weight * (0.15 + it.opacity);
    tw += w;
    r += parseInt(h.slice(0, 2), 16) * w;
    g += parseInt(h.slice(2, 4), 16) * w;
    b += parseInt(h.slice(4, 6), 16) * w;
    a += it.opacity * w;
  }
  if (tw <= 0) return "rgba(216, 241, 255, 0.06)";
  return `rgba(${Math.round(r / tw)}, ${Math.round(g / tw)}, ${Math.round(b / tw)}, ${Math.max(0.06, a / tw).toFixed(3)})`;
}

/** Parse an rgba() string back to components. */
export function parseRgba(css: string): [number, number, number, number] {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m || !m[1]) return [216, 241, 255, 0.06];
  const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

export function withAlpha(css: string, alpha: number): string {
  const [r, g, b] = parseRgba(css);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function lighten(css: string, amount: number, alphaBoost = 0): string {
  const [r, g, b, a] = parseRgba(css);
  const f = (v: number) => Math.round(v + (255 - v) * amount);
  return `rgba(${f(r)}, ${f(g)}, ${f(b)}, ${Math.min(1, a + alphaBoost).toFixed(3)})`;
}

/** Mix a poured colour into the current liquid colour by volume fraction. */
export function mixRgba(current: string, added: string, fraction: number): string {
  const [r1, g1, b1, a1] = parseRgba(current);
  const [r2, g2, b2, a2] = parseRgba(added);
  const f = Math.max(0, Math.min(1, fraction));
  const mix = (x: number, y: number) => Math.round(x + (y - x) * f);
  return `rgba(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)}, ${(a1 + (a2 - a1) * f).toFixed(3)})`;
}
