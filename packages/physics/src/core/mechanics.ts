/**
 * Mechanics models (build plan 3.3, 3.7): projectiles with and without air resistance, the simple
 * pendulum with its exact large-angle period, and Archimedes' principle on a spring balance.
 */
import { rad, rk4, STEP_S } from "./runtime";

export const PLANETS = {
  earth: { label: "Earth", g: 9.81 },
  moon: { label: "Moon", g: 1.62 },
  mars: { label: "Mars", g: 3.71 },
  jupiter: { label: "Jupiter", g: 24.79 },
} as const;
export type Planet = keyof typeof PLANETS;

export const PROJECTILES = {
  ball: { label: "Tennis ball", massKg: 0.058, radiusM: 0.0335, cd: 0.55 },
  shot: { label: "Shot put", massKg: 7.26, radiusM: 0.06, cd: 0.47 },
  feather: { label: "Shuttlecock", massKg: 0.005, radiusM: 0.033, cd: 0.6 },
} as const;
export type ProjectileKind = keyof typeof PROJECTILES;

export type Launch = { speed: number; angleDeg: number; g: number; heightM?: number; drag?: boolean; projectile?: ProjectileKind };

/** Analytic flight (no drag), from launch height h above the landing level. */
export function idealFlight({ speed, angleDeg, g, heightM = 0 }: Launch) {
  const th = rad(angleDeg);
  const vx = speed * Math.cos(th);
  const vy = speed * Math.sin(th);
  const time = (vy + Math.sqrt(vy * vy + 2 * g * heightM)) / g;
  return { time, range: vx * time, maxHeight: heightM + (vy * vy) / (2 * g), apexTime: vy / g };
}

const AIR_RHO = 1.225;

export type FlightPoint = { t: number; x: number; y: number; vx: number; vy: number };

/** Integrates the flight with RK4 at 1/240 s; with drag uses F = 1/2 rho Cd A v^2. */
export function simulateFlight(l: Launch, h = STEP_S): { points: FlightPoint[]; range: number; time: number; maxHeight: number } {
  const p = PROJECTILES[l.projectile ?? "ball"];
  const k = l.drag ? (0.5 * AIR_RHO * p.cd * Math.PI * p.radiusM * p.radiusM) / p.massKg : 0;
  const f = (_t: number, y: number[]) => {
    const [, , vx, vy] = y as [number, number, number, number];
    const v = Math.hypot(vx, vy);
    return [vx, vy, -k * v * vx, -l.g - k * v * vy];
  };
  const th = rad(l.angleDeg);
  let y = [0, l.heightM ?? 0, l.speed * Math.cos(th), l.speed * Math.sin(th)];
  let t = 0;
  let maxH = y[1]!;
  const points: FlightPoint[] = [{ t, x: y[0]!, y: y[1]!, vx: y[2]!, vy: y[3]! }];
  for (let i = 0; i < 240 * 600; i++) {
    const next = rk4(f, t, y, h);
    if (next[1]! < 0 && i > 0) {
      // interpolate the landing between the two samples
      const s = y[1]! / (y[1]! - next[1]!);
      const xl = y[0]! + (next[0]! - y[0]!) * s;
      const tl = t + h * s;
      points.push({ t: tl, x: xl, y: 0, vx: next[2]!, vy: next[3]! });
      return { points, range: xl, time: tl, maxHeight: maxH };
    }
    y = next;
    t += h;
    maxH = Math.max(maxH, y[1]!);
    if (i % 4 === 0) points.push({ t, x: y[0]!, y: y[1]!, vx: y[2]!, vy: y[3]! });
  }
  return { points, range: y[0]!, time: t, maxHeight: maxH };
}

/* ------------------------------------------------------------------ pendulum */

function agm(a: number, b: number) {
  for (let i = 0; i < 30 && Math.abs(a - b) > 1e-15; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
  return a;
}

/** Exact period for amplitude theta0 (via the arithmetic-geometric mean). */
export function pendulumPeriod(lengthM: number, amplitudeDeg: number, g = 9.81): number {
  const t0 = 2 * Math.PI * Math.sqrt(lengthM / g);
  return t0 / agm(1, Math.cos(rad(amplitudeDeg) / 2));
}

/** Small-angle period 2 pi sqrt(L/g). */
export const smallAnglePeriod = (lengthM: number, g = 9.81) => 2 * Math.PI * Math.sqrt(lengthM / g);

/** Angle (rad) and angular velocity after integrating theta'' = -(g/L) sin theta - c theta'. */
export function pendulumStep(state: [number, number], lengthM: number, g: number, dt: number, damping = 0): [number, number] {
  const r = rk4((_t, y) => [y[1]!, -(g / lengthM) * Math.sin(y[0]!) - damping * y[1]!], 0, state, dt);
  return [r[0]!, r[1]!];
}

/* ------------------------------------------------------------------ buoyancy */

export const WATER_DENSITY = 1000; // kg/m^3

export type Sinker = { id: string; label: string; massG: number; volumeCm3: number };

export const SINKERS: Sinker[] = [
  { id: "brass", label: "Brass cylinder", massG: 170, volumeCm3: 20 },
  { id: "aluminium", label: "Aluminium block", massG: 108, volumeCm3: 40 },
  { id: "stone", label: "Stone", massG: 150, volumeCm3: 56 },
];

/**
 * Spring-balance reading (N) for a sinker immersed to a fraction of its volume, and the water it
 * pushes out (mL). Upthrust = weight of fluid displaced.
 */
export function buoyancy(s: Sinker, immersedFraction: number, g = 9.81, fluidDensity = WATER_DENSITY) {
  const f = Math.max(0, Math.min(1, immersedFraction));
  const weightN = (s.massG / 1000) * g;
  const displacedMl = s.volumeCm3 * f;
  const upthrustN = fluidDensity * (displacedMl * 1e-6) * g;
  return { weightN, upthrustN, readingN: weightN - upthrustN, displacedMl, displacedWeightN: upthrustN };
}
