/**
 * Shared simulation runtime (build plan 3.1): a seeded generator, RK4, and a fixed-step clock
 * (1/240 s) with interpolation so the picture is smooth at any display rate while the physics
 * stays identical everywhere.
 */

export const STEP_S = 1 / 240;

/** mulberry32: tiny, fast and fully deterministic for a given seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Integer in [0, n). */
    int: (n: number) => Math.floor(next() * n),
    /** Standard normal (Box–Muller). */
    normal: () => {
      const u = Math.max(next(), 1e-12);
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}
export type Rng = ReturnType<typeof rng>;

/** One classical Runge–Kutta step for y' = f(t, y). */
export function rk4(f: (t: number, y: number[]) => number[], t: number, y: number[], h: number): number[] {
  const k1 = f(t, y);
  const k2 = f(t + h / 2, y.map((v, i) => v + (h / 2) * k1[i]!));
  const k3 = f(t + h / 2, y.map((v, i) => v + (h / 2) * k2[i]!));
  const k4 = f(t + h, y.map((v, i) => v + h * k3[i]!));
  return y.map((v, i) => v + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!));
}

/**
 * Fixed-step clock. Feed it real elapsed seconds (already scaled by the speed setting); it calls
 * `step` a whole number of times and returns the interpolation fraction for rendering.
 */
export class FixedClock {
  private acc = 0;
  steps = 0;
  constructor(readonly h = STEP_S, private readonly maxStepsPerFrame = 240) {}
  advance(dtS: number, step: (h: number) => void): number {
    this.acc += Math.min(dtS, this.h * this.maxStepsPerFrame);
    while (this.acc >= this.h) {
      step(this.h);
      this.acc -= this.h;
      this.steps++;
    }
    return this.acc / this.h;
  }
  reset() {
    this.acc = 0;
    this.steps = 0;
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const deg = (rad: number) => (rad * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;

/** Significant-figure rounding used for readouts and state hashes. */
export function sig(x: number, n = 6): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const p = Math.pow(10, n - 1 - Math.floor(Math.log10(Math.abs(x))));
  return Math.round(x * p) / p;
}
