/**
 * 2D ray optics (build plan 3.5): Snell's law at every interface, total internal reflection past
 * the critical angle, Schlick partial reflection, Cauchy dispersion, polygon blocks (slab, prism),
 * a semicircular block, thin lenses and plane mirrors.
 */
import { deg, rad } from "./runtime";

export type Vec = { x: number; y: number };
const v = (x: number, y: number): Vec => ({ x, y });
const add = (a: Vec, b: Vec) => v(a.x + b.x, a.y + b.y);
const sub = (a: Vec, b: Vec) => v(a.x - b.x, a.y - b.y);
const mul = (a: Vec, s: number) => v(a.x * s, a.y * s);
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
const norm = (a: Vec) => mul(a, 1 / Math.hypot(a.x, a.y));

/** Refractive index from Cauchy's equation n = A + B / lambda^2 (lambda in micrometres); crown glass. */
export const cauchy = (nm: number, A = 1.5046, B = 0.0042) => A + B / Math.pow(nm / 1000, 2);

export const criticalAngleDeg = (n1: number, n2 = 1) => (n1 <= n2 ? null : deg(Math.asin(n2 / n1)));

/** Refraction angle (deg) for incidence i (deg) from n1 into n2; null means total internal reflection. */
export function snellDeg(iDeg: number, n1: number, n2: number): number | null {
  const s = (n1 / n2) * Math.sin(rad(iDeg));
  return Math.abs(s) > 1 ? null : deg(Math.asin(s));
}

/**
 * Vector refraction of unit direction d at a surface with unit normal n (pointing against d).
 * Returns the refracted direction, or null for total internal reflection.
 */
export function refract(d: Vec, n: Vec, n1: number, n2: number): Vec | null {
  const cosi = -dot(n, d);
  const eta = n1 / n2;
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  return norm(add(mul(d, eta), mul(n, eta * cosi - Math.sqrt(k))));
}

export const reflect = (d: Vec, n: Vec) => norm(sub(d, mul(n, 2 * dot(d, n))));

/** Schlick's approximation to the Fresnel reflectance. */
export function reflectance(cosi: number, n1: number, n2: number): number {
  const r0 = ((n1 - n2) / (n1 + n2)) ** 2;
  return r0 + (1 - r0) * Math.pow(1 - Math.abs(cosi), 5);
}

/* ------------------------------------------------------------------ scene */

export type Shape =
  | { kind: "polygon"; id: string; points: Vec[]; n: number | "cauchy" }
  | { kind: "lens"; id: string; at: Vec; height: number; f: number }
  | { kind: "mirror"; id: string; a: Vec; b: Vec }
  | { kind: "screen"; id: string; a: Vec; b: Vec };

export type Segment = { a: Vec; b: Vec; intensity: number; inside: boolean; nm?: number };
export type Hit = { at: Vec; shape: string; kind: "refract" | "tir" | "reflect" | "lens" | "screen"; incidenceDeg: number; outDeg: number | null };

/** A rectangle (glass slab) of width w and thickness t, top-left at (x, y), y down. */
export const slab = (id: string, x: number, y: number, w: number, t: number, n = 1.5): Shape => ({ kind: "polygon", id, n, points: [v(x, y), v(x + w, y), v(x + w, y + t), v(x, y + t)] });

/** Equilateral prism with side s, base centre at c. */
export function prism(id: string, c: Vec, s: number, n: number | "cauchy" = "cauchy"): Shape {
  const h = (s * Math.sqrt(3)) / 2;
  return { kind: "polygon", id, n, points: [v(c.x - s / 2, c.y), v(c.x + s / 2, c.y), v(c.x, c.y - h)] };
}

/** Semicircular block (flat side down) as a fine polygon. */
export function semicircle(id: string, c: Vec, r: number, n = 1.5, segs = 128): Shape {
  const pts = [v(c.x + r, c.y)];
  for (let i = 1; i < segs; i++) {
    const a = (i / segs) * Math.PI;
    pts.push(v(c.x + r * Math.cos(a), c.y - r * Math.sin(a)));
  }
  pts.push(v(c.x - r, c.y));
  return { kind: "polygon", id, n, points: pts };
}

function inside(p: Vec, poly: Vec[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Ray-segment intersection: distance along the ray, or null. */
function hitSeg(o: Vec, d: Vec, a: Vec, b: Vec): number | null {
  const e = sub(b, a);
  const den = cross(d, e);
  if (Math.abs(den) < 1e-12) return null;
  const w = sub(a, o);
  const t = cross(w, e) / den;
  const u = cross(w, d) / den;
  return t > 1e-7 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}

/**
 * Traces one ray through the scene. The main beam follows refraction (or TIR); a weaker reflected
 * ray is spawned at each refracting surface when its reflectance is noticeable.
 */
export function trace(origin: Vec, dirIn: Vec, shapes: Shape[], opts: { nm?: number; maxDepth?: number; length?: number; minIntensity?: number } = {}): { segments: Segment[]; hits: Hit[] } {
  const segments: Segment[] = [];
  const hits: Hit[] = [];
  const maxDepth = opts.maxDepth ?? 24;
  const L = opts.length ?? 4000;
  const nOf = (s: Extract<Shape, { kind: "polygon" }>) => (s.n === "cauchy" ? cauchy(opts.nm ?? 589) : s.n);

  const go = (o: Vec, d: Vec, intensity: number, depth: number) => {
    if (depth > maxDepth || intensity < (opts.minIntensity ?? 0.02)) return;
    let best: { t: number; shape: Shape; normal: Vec; edge?: [Vec, Vec] } | null = null;
    for (const s of shapes) {
      if (s.kind === "polygon") {
        for (let i = 0; i < s.points.length; i++) {
          const a = s.points[i]!;
          const b = s.points[(i + 1) % s.points.length]!;
          const t = hitSeg(o, d, a, b);
          if (t !== null && (!best || t < best.t)) {
            const e = norm(sub(b, a));
            best = { t, shape: s, normal: v(-e.y, e.x), edge: [a, b] };
          }
        }
      } else if (s.kind === "lens") {
        const a = v(s.at.x, s.at.y - s.height / 2);
        const b = v(s.at.x, s.at.y + s.height / 2);
        const t = hitSeg(o, d, a, b);
        if (t !== null && (!best || t < best.t)) best = { t, shape: s, normal: v(-1, 0) };
      } else {
        const t = hitSeg(o, d, s.a, s.b);
        if (t !== null && (!best || t < best.t)) {
          const e = norm(sub(s.b, s.a));
          best = { t, shape: s, normal: v(-e.y, e.x) };
        }
      }
    }
    const inPoly = shapes.some((s) => s.kind === "polygon" && inside(add(o, mul(d, 1e-4)), s.points));
    if (!best) {
      segments.push({ a: o, b: add(o, mul(d, L)), intensity, inside: inPoly, ...(opts.nm ? { nm: opts.nm } : {}) });
      return;
    }
    const p = add(o, mul(d, best.t));
    segments.push({ a: o, b: p, intensity, inside: inPoly, ...(opts.nm ? { nm: opts.nm } : {}) });
    let n = best.normal;
    if (dot(n, d) > 0) n = mul(n, -1); // face the incoming ray
    const incidence = deg(Math.acos(Math.min(1, Math.abs(dot(n, d)))));
    const s = best.shape;
    if (s.kind === "screen") {
      hits.push({ at: p, shape: s.id, kind: "screen", incidenceDeg: incidence, outDeg: null });
      return;
    }
    if (s.kind === "mirror") {
      hits.push({ at: p, shape: s.id, kind: "reflect", incidenceDeg: incidence, outDeg: incidence });
      go(p, reflect(d, n), intensity * 0.95, depth + 1);
      return;
    }
    if (s.kind === "lens") {
      // Thin lens: a ray at height y from the axis turns so that parallel rays meet at the focus.
      const y = p.y - s.at.y;
      const slope = d.y / d.x - y / s.f;
      const dir = norm(v(Math.sign(d.x) || 1, slope * (Math.sign(d.x) || 1)));
      hits.push({ at: p, shape: s.id, kind: "lens", incidenceDeg: incidence, outDeg: deg(Math.atan(slope)) });
      go(p, dir, intensity, depth + 1);
      return;
    }
    const n2glass = nOf(s);
    const entering = !inside(add(p, mul(d, -1e-4)), s.points) && inside(add(p, mul(d, 1e-4)), s.points);
    const [n1, n2] = entering ? [1, n2glass] : [n2glass, 1];
    const out = refract(d, n, n1, n2);
    if (!out) {
      hits.push({ at: p, shape: s.id, kind: "tir", incidenceDeg: incidence, outDeg: null });
      go(p, reflect(d, n), intensity, depth + 1);
      return;
    }
    const R = reflectance(dot(n, d), n1, n2);
    hits.push({ at: p, shape: s.id, kind: "refract", incidenceDeg: incidence, outDeg: deg(Math.acos(Math.min(1, Math.abs(dot(n, out))))) });
    go(p, out, intensity * (1 - R), depth + 1);
    if (R * intensity > 0.05) go(p, reflect(d, n), intensity * R, depth + 1);
  };
  go(origin, norm(dirIn), 1, 0);
  return { segments, hits };
}

/* ------------------------------------------------------------------ glass slab */

/** For a parallel-sided slab: refraction angle, emergence angle and lateral shift. */
export function slabGeometry(iDeg: number, thickness: number, n = 1.5) {
  const r = snellDeg(iDeg, 1, n)!;
  const shift = (thickness * Math.sin(rad(iDeg - r))) / Math.cos(rad(r));
  return { r, e: iDeg, shift };
}

/** Thin-lens image by 1/v - 1/u = 1/f (Cartesian sign convention: u is negative for a real object). */
export function lensImage(u: number, f: number) {
  const inv = 1 / f + 1 / u;
  if (Math.abs(inv) < 1e-12) return { v: Infinity, m: Infinity, real: false };
  const vv = 1 / inv;
  return { v: vv, m: vv / u, real: vv > 0 };
}

/** Wavelength (nm) to an sRGB hex colour, for drawing spectra. */
export function wavelengthHex(nm: number): string {
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm < 440) [r, g, b] = [-(nm - 440) / 60, 0, 1];
  else if (nm < 490) [r, g, b] = [0, (nm - 440) / 50, 1];
  else if (nm < 510) [r, g, b] = [0, 1, -(nm - 510) / 20];
  else if (nm < 580) [r, g, b] = [(nm - 510) / 70, 1, 0];
  else if (nm < 645) [r, g, b] = [1, -(nm - 645) / 65, 0];
  else [r, g, b] = [1, 0, 0];
  const f = nm < 420 ? 0.3 + (0.7 * (nm - 380)) / 40 : nm > 700 ? 0.3 + (0.7 * (780 - nm)) / 80 : 1;
  return `#${[r, g, b].map((c) => Math.round(255 * Math.pow(Math.max(0, c) * f, 0.8)).toString(16).padStart(2, "0")).join("")}`;
}
