import { describe, expect, it } from "vitest";
import { PLANETS } from "../core/mechanics";
import { DEFAULT_MOTION, mergeMotionBuild, MOTION_TABS, type MotionSnapshot } from "./MotionSandbox";
import {
  collide,
  collisionAt,
  collisionNarration,
  collisionOutcome,
  DEFAULT_COLLISION,
  kineticEnergy,
  momentum,
  RAMP_LENGTH_M,
  rampAcceleration,
  rampForces,
  rampNarration,
  rampSlide,
  rampThresholdDeg,
  SPRING_MAX_PULL_M,
  springDampedPeriod,
  springEnergy,
  springNarration,
  springPeriod,
  springRestStretch,
  springStep,
  TRACK,
  type CollisionParams,
} from "./motionScenes";

/* ------------------------------------------------------------------ collisions */

const MASSES = [0.5, 1, 2.5, 5];
const SPEEDS = [-5, -1.5, 0, 2, 5];
const BOUNCE = [0, 0.3, 0.75, 1];
/** Every mass / velocity / restitution combination in which A is catching B up. */
const closingCases = MASSES.flatMap((m1) => MASSES.flatMap((m2) => SPEEDS.flatMap((u1) => SPEEDS.filter((u2) => u1 > u2).flatMap((u2) => BOUNCE.map((e) => ({ m1, m2, u1, u2, e }))))));

describe("collisions: collide", () => {
  it("conserves momentum for any restitution", () => {
    expect(closingCases.length).toBeGreaterThan(500);
    for (const { m1, m2, u1, u2, e } of closingCases) {
      const { v1, v2 } = collide(m1, m2, u1, u2, e);
      expect(momentum(m1, v1, m2, v2)).toBeCloseTo(momentum(m1, u1, m2, u2), 9);
    }
  });

  it("conserves kinetic energy if and only if the collision is perfectly elastic", () => {
    for (const { m1, m2, u1, u2, e } of closingCases) {
      const { v1, v2 } = collide(m1, m2, u1, u2, e);
      const before = kineticEnergy(m1, u1, m2, u2), after = kineticEnergy(m1, v1, m2, v2);
      if (e === 1) expect(after).toBeCloseTo(before, 9);
      else expect(after).toBeLessThan(before - 1e-6);
    }
  });

  it("separates at e times the closing speed, and never lets the carts pass through each other", () => {
    for (const { m1, m2, u1, u2, e } of closingCases) {
      const { v1, v2 } = collide(m1, m2, u1, u2, e);
      expect(v2 - v1).toBeCloseTo(e * (u1 - u2), 9);
    }
  });

  it("sticks the carts together when e = 0, at the shared velocity p / (m1 + m2)", () => {
    const { v1, v2 } = collide(2, 1, 2, -1, 0);
    expect(v1).toBeCloseTo(1, 12);
    expect(v2).toBeCloseTo(1, 12);
    // equal and opposite momenta: both stop, and all the kinetic energy is gone
    const stop = collide(2, 1, 1, -2, 0);
    expect(stop.v1).toBeCloseTo(0, 12);
    expect(stop.v2).toBeCloseTo(0, 12);
  });

  it("swaps the velocities of equal masses in an elastic collision", () => {
    const { v1, v2 } = collide(1.5, 1.5, 3, 0, 1);
    expect(v1).toBeCloseTo(0, 12);
    expect(v2).toBeCloseTo(3, 12);
  });
});

describe("collisions: the run", () => {
  const gap = TRACK.startB - TRACK.startA - TRACK.cartM;

  it("times the hit from the gap and the closing speed, and reports before / after totals", () => {
    const p: CollisionParams = { m1: 2, m2: 1, u1: 2, u2: -1, restitution: 0.5 };
    const o = collisionOutcome(p);
    expect(o.kind).toBe("hit");
    expect(o.tHit).toBeCloseTo(gap / 3, 12);
    expect(o.pAfter).toBeCloseTo(o.pBefore, 9);
    expect(o.pBefore).toBeCloseTo(3, 12);
    expect(o.keLost).toBeCloseTo(o.keBefore - o.keAfter, 12);
    expect(o.keLost).toBeGreaterThan(0);
    expect(o.tEnd).toBeGreaterThan(o.tHit!);
  });

  it("loses no energy when e = 1 and the most when e = 0", () => {
    const elastic = collisionOutcome({ ...DEFAULT_COLLISION, restitution: 1 });
    const sticky = collisionOutcome({ ...DEFAULT_COLLISION, restitution: 0 });
    const half = collisionOutcome({ ...DEFAULT_COLLISION, restitution: 0.5 });
    expect(elastic.keLost).toBeCloseTo(0, 9);
    expect(sticky.keLost).toBeGreaterThan(half.keLost);
    expect(sticky.v1).toBeCloseTo(sticky.v2, 12);
  });

  it("handles carts that never meet: apart, same velocity, standing still, or off the track first", () => {
    const cases: [CollisionParams, string][] = [
      [{ m1: 1, m2: 1, u1: -1, u2: 1, restitution: 1 }, "apart"],
      [{ m1: 1, m2: 1, u1: 0, u2: 2, restitution: 1 }, "apart"],
      [{ m1: 1, m2: 1, u1: 2, u2: 2, restitution: 1 }, "sameSpeed"],
      [{ m1: 1, m2: 1, u1: 0, u2: 0, restitution: 1 }, "still"],
      // B crawls after A, but A leaves the left end of the track long before B could reach it
      [{ m1: 1, m2: 1, u1: -5, u2: -5.5, restitution: 1 }, "offTrack"],
    ];
    for (const [p, kind] of cases) {
      const o = collisionOutcome(p);
      expect(o.kind).toBe(kind);
      expect(o.tHit).toBeNull();
      expect([o.v1, o.v2]).toEqual([p.u1, p.u2]);
      expect(o.pAfter).toBe(o.pBefore);
      expect(o.keLost).toBe(0);
      expect(Number.isFinite(o.tEnd)).toBe(true);
      // positions simply follow the starting velocities, and nothing is ever flagged as a hit
      const end = collisionAt(p, o, 1e6);
      expect(end.hit).toBe(false);
      expect(end.x1).toBeCloseTo(TRACK.startA + p.u1 * o.tEnd, 9);
      expect(end.x2).toBeCloseTo(TRACK.startB + p.u2 * o.tEnd, 9);
    }
    expect(collisionOutcome({ m1: 1, m2: 1, u1: 0, u2: 0, restitution: 1 }).tEnd).toBe(0);
  });

  it("keeps the carts from overlapping at every moment, touching exactly at the hit", () => {
    for (const { m1, m2, u1, u2, e } of closingCases) {
      const p = { m1, m2, u1, u2, restitution: e };
      const o = collisionOutcome(p);
      for (let i = 0; i <= 12; i++) {
        const s = collisionAt(p, o, (o.tEnd * i) / 12);
        expect(s.x2 - s.x1).toBeGreaterThan(TRACK.cartM - 1e-9);
        expect(momentum(m1, s.v1, m2, s.v2)).toBeCloseTo(o.pBefore, 9);
      }
      if (o.tHit === null) continue;
      const at = collisionAt(p, o, o.tHit);
      expect(at.hit).toBe(true);
      expect(at.x2 - at.x1).toBeCloseTo(TRACK.cartM, 9);
      expect(o.xHit).toBeCloseTo((at.x1 + at.x2) / 2, 9);
      // stuck carts stay touching for the rest of the run
      if (e === 0) expect(collisionAt(p, o, o.tEnd).x2 - collisionAt(p, o, o.tEnd).x1).toBeCloseTo(TRACK.cartM, 9);
    }
  });

  it("stops watching once a cart reaches the end of the track, and clamps the clock", () => {
    for (const { m1, m2, u1, u2, e } of closingCases) {
      const p = { m1, m2, u1, u2, restitution: e };
      const o = collisionOutcome(p);
      const end = collisionAt(p, o, o.tEnd);
      expect(end.x1).toBeGreaterThan(TRACK.cartM / 2 - 1e-9);
      expect(end.x2).toBeLessThan(TRACK.lengthM - TRACK.cartM / 2 + 1e-9);
      expect(collisionAt(p, o, o.tEnd + 100)).toEqual(end);
      expect(collisionAt(p, o, -3)).toEqual(collisionAt(p, o, 0));
    }
  });

  it("narrates each case in words", () => {
    const hit = (restitution: number) => {
      const p = { ...DEFAULT_COLLISION, restitution };
      return collisionNarration("after", p, collisionOutcome(p));
    };
    expect(hit(0)).toMatch(/stuck together/);
    expect(hit(0)).toMatch(/3 kg·m\/s to the right/);
    expect(hit(1)).toMatch(/perfect bounce.*no movement energy was lost/);
    expect(hit(0.5)).toMatch(/bounced apart.*heat and sound/);
    const stop = { m1: 2, m2: 1, u1: 1, u2: -2, restitution: 0 };
    expect(collisionNarration("after", stop, collisionOutcome(stop))).toMatch(/stopped dead/);
    const apart = { m1: 1, m2: 1, u1: -1, u2: 1, restitution: 1 };
    expect(collisionNarration("ready", apart, collisionOutcome(apart))).toMatch(/never meet/);
    expect(collisionNarration("missed", apart, collisionOutcome(apart))).toMatch(/never met/);
    const still = { m1: 1, m2: 1, u1: 0, u2: 0, restitution: 1 };
    expect(collisionNarration("ready", still, collisionOutcome(still))).toMatch(/Nothing is moving/);
    expect(collisionNarration("ready", DEFAULT_COLLISION, collisionOutcome(DEFAULT_COLLISION))).toMatch(/Press Go/);
  });
});

/* ------------------------------------------------------------------ spring */

/** Runs the spring the way the scene does (frame steps split in four) and times its upward passes through rest. */
function measurePeriod(massKg: number, k: number, damping: number, frame = 1 / 60, bounces = 5): number {
  let y: [number, number] = [0.1, 0];
  let t = 0;
  const crossings: number[] = [];
  const h = frame / 4;
  while (crossings.length <= bounces && t < 600) {
    const prev = y;
    y = springStep(y, massKg, k, damping, h);
    if (prev[0] > 0 && y[0] <= 0) crossings.push(t + (h * prev[0]) / (prev[0] - y[0]));
    t += h;
  }
  return (crossings[crossings.length - 1]! - crossings[0]!) / (crossings.length - 1);
}

describe("spring", () => {
  const corners: [number, number][] = [[0.5, 20], [0.1, 100], [2, 5], [0.1, 5], [2, 100]];

  it("has period 2π√(m/k), with no gravity in it", () => {
    expect(springPeriod(0.5, 20)).toBeCloseTo(0.99346, 4);
    expect(springPeriod(2, 20) / springPeriod(0.5, 20)).toBeCloseTo(2, 12);
    expect(springPeriod(0.5, 80) / springPeriod(0.5, 20)).toBeCloseTo(0.5, 12);
    expect(springPeriod.length).toBe(2);
  });

  it("bounces with that period when integrated, within 1%, at the slider extremes and after a long frame", () => {
    for (const [m, k] of corners) {
      for (const frame of [1 / 60, 1 / 30, 0.05]) {
        const T = springPeriod(m, k);
        // a 50 ms frame only resolves the fastest spring (T = 0.2 s) to a few steps per bounce: skip that pair
        if (frame / 4 > T / 12) continue;
        expect(Math.abs(measurePeriod(m, k, 0, frame) - T) / T).toBeLessThan(0.01);
      }
    }
  });

  it("conserves energy without damping, over many steps and over one huge step", () => {
    for (const [m, k] of corners) {
      let y: [number, number] = [SPRING_MAX_PULL_M, 0];
      const e0 = springEnergy(m, k, y[0], y[1]).total;
      for (let i = 0; i < 20000; i++) y = springStep(y, m, k, 0, 1 / 240);
      expect(springEnergy(m, k, y[0], y[1]).total / e0).toBeCloseTo(1, 9);
      const far = springStep([SPRING_MAX_PULL_M, 0], m, k, 0, 1);
      expect(springEnergy(m, k, far[0], far[1]).total / e0).toBeCloseTo(1, 9);
      expect(Math.abs(far[0])).toBeLessThanOrEqual(SPRING_MAX_PULL_M + 1e-12);
    }
  });

  it("is exact: one long step lands where many short ones do, with or without damping", () => {
    for (const [m, k] of corners) {
      for (const b of [0, 0.3, 2]) {
        let y: [number, number] = [0.2, -0.4];
        for (let i = 0; i < 500; i++) y = springStep(y, m, k, b, 0.001);
        const once = springStep([0.2, -0.4], m, k, b, 0.5);
        expect(once[0]).toBeCloseTo(y[0], 9);
        expect(once[1]).toBeCloseTo(y[1], 8);
      }
    }
  });

  it("loses energy steadily with damping and never gains any", () => {
    for (const [m, k] of corners) {
      let y: [number, number] = [0.2, 0];
      let e = springEnergy(m, k, y[0], y[1]).total;
      for (let i = 0; i < 2000; i++) {
        y = springStep(y, m, k, 0.5, 1 / 240);
        const next = springEnergy(m, k, y[0], y[1]).total;
        expect(next).toBeLessThanOrEqual(e * (1 + 1e-12));
        e = next;
      }
      expect(e).toBeLessThan(0.5 * k * 0.2 * 0.2 * 0.5);
    }
  });

  it("creeps back without overshooting when the damping is too strong to bounce", () => {
    // m = 0.1 kg, k = 5 N/m: critical damping is 2√(mk) = 1.41 kg/s
    expect(springDampedPeriod(0.1, 5, 2)).toBeNull();
    expect(springDampedPeriod(0.1, 5, 2 * Math.sqrt(0.5))).toBeNull();
    for (const b of [2, 2 * Math.sqrt(0.5)]) {
      let y: [number, number] = [0.2, 0];
      for (let i = 0; i < 4000; i++) {
        y = springStep(y, 0.1, 5, b, 1 / 240);
        expect(y[0]).toBeGreaterThan(0);
        expect(Number.isFinite(y[1])).toBe(true);
      }
      expect(y[0]).toBeLessThan(1e-3);
    }
  });

  it("bounces a little slower with light damping", () => {
    const T = springPeriod(0.5, 20), Td = springDampedPeriod(0.5, 20, 1)!;
    expect(Td).toBeGreaterThan(T);
    expect(springDampedPeriod(0.5, 20, 0)).toBeCloseTo(T, 12);
    expect(Math.abs(measurePeriod(0.5, 20, 1) - Td) / Td).toBeLessThan(0.01);
  });

  it("lets gravity move the rest position but nothing else", () => {
    expect(springRestStretch(0.5, 20, PLANETS.earth.g)).toBeCloseTo(0.24525, 5);
    expect(springRestStretch(0.5, 20, PLANETS.moon.g) / springRestStretch(0.5, 20, PLANETS.earth.g)).toBeCloseTo(1.62 / 9.81, 12);
  });

  it("narrates the bounce in words", () => {
    const p = { massKg: 0.5, k: 20, damping: 0 };
    expect(springNarration(0.15, 0, p)).toMatch(/Lowest point/);
    expect(springNarration(-0.15, 0, p)).toMatch(/Highest point/);
    expect(springNarration(0, -0.9, p)).toMatch(/Passing the rest position/);
    expect(springNarration(0.08, -0.5, p)).toMatch(/Heading back/);
    expect(springNarration(0.08, 0.5, p)).toMatch(/Moving away/);
    expect(springNarration(0, 0, { ...p, damping: 0.5 })).toMatch(/died away/);
    expect(springNarration(0.1, 0, { massKg: 0.1, k: 5, damping: 2 })).toMatch(/cannot bounce/);
    expect(springNarration(0.12, 0, p, true)).toMatch(/Pulled 12 cm/);
  });
});

/* ------------------------------------------------------------------ ramp */

describe("ramp", () => {
  const g = PLANETS.earth.g;

  it("holds up to the angle where tan θ = μ", () => {
    expect(rampThresholdDeg(1)).toBeCloseTo(45, 12);
    expect(rampThresholdDeg(0)).toBe(0);
    for (const mu of [0.05, 0.3, 0.5, 0.8]) {
      const edge = rampThresholdDeg(mu);
      expect(Math.tan((edge * Math.PI) / 180)).toBeCloseTo(mu, 12);
      expect(rampForces(2, edge - 0.5, mu, g).slides).toBe(false);
      expect(rampForces(2, edge + 0.5, mu, g).slides).toBe(true);
    }
  });

  it("stays still when tan θ ≤ μ: friction only matches the pull, and nothing is left over", () => {
    const f = rampForces(2, 20, 0.5, g);
    expect(f.slides).toBe(false);
    expect(f.accel).toBe(0);
    expect(f.net).toBe(0);
    expect(f.friction).toBeCloseTo(f.along, 12);
    expect(f.friction).toBeLessThan(f.maxFriction);
    expect(rampAcceleration(20, 0.5, g)).toBe(0);
    // exactly on the edge (tan 45° = 1 = μ) it still holds
    expect(rampForces(2, 45, 1, g).slides).toBe(false);
    expect(rampSlide(0, 10)).toEqual({ s: 0, v: 0, t: 0, done: false });
  });

  it("slides with a = g (sin θ − μ cos θ) once it is steeper than that", () => {
    const f = rampForces(2, 30, 0.3, g);
    expect(f.slides).toBe(true);
    expect(f.friction).toBeCloseTo(0.3 * f.normal, 12);
    expect(f.accel).toBeCloseTo(9.81 * (0.5 - 0.3 * Math.cos(Math.PI / 6)), 9);
    expect(rampAcceleration(30, 0.3, g)).toBeCloseTo(2.3563, 3);
    expect(rampAcceleration(30, 0, g)).toBeCloseTo(g / 2, 9);
    expect(rampAcceleration(60, 1, PLANETS.jupiter.g)).toBeCloseTo(24.79 * (Math.sin(Math.PI / 3) - 0.5), 9);
  });

  it("splits the weight into parts along and into the slope, with the normal force matching the second", () => {
    for (const angle of [0, 10, 37, 60]) {
      const f = rampForces(3, angle, 0.2, g);
      expect(f.weight).toBeCloseTo(3 * g, 12);
      expect(Math.hypot(f.along, f.into)).toBeCloseTo(f.weight, 9);
      expect(f.normal).toBe(f.into);
      expect(f.maxFriction).toBeCloseTo(0.2 * f.normal, 12);
    }
    const flat = rampForces(3, 0, 0.2, g);
    expect(flat.along).toBe(0);
    expect(flat.friction).toBe(0);
    expect(flat.slides).toBe(false);
  });

  it("gives the same acceleration and the same tipping angle whatever the mass", () => {
    const light = rampForces(0.5, 35, 0.25, g), heavy = rampForces(10, 35, 0.25, g);
    expect(heavy.accel).toBeCloseTo(light.accel, 9);
    expect(heavy.net / light.net).toBeCloseTo(20, 9);
    expect(heavy.friction / light.friction).toBeCloseTo(20, 9);
    expect(rampForces(0.5, 14, 0.25, g).slides).toBe(rampForces(10, 14, 0.25, g).slides);
  });

  it("slides from rest with s = a t² / 2 and stops at the bottom", () => {
    const a = rampAcceleration(30, 0.3, g);
    const mid = rampSlide(a, 1);
    expect(mid).toEqual({ s: a / 2, v: a, t: 1, done: false });
    const tEnd = Math.sqrt((2 * RAMP_LENGTH_M) / a);
    const end = rampSlide(a, 1e6);
    expect(end.done).toBe(true);
    expect(end.s).toBe(RAMP_LENGTH_M);
    expect(end.t).toBeCloseTo(tEnd, 12);
    expect(end.v).toBeCloseTo(Math.sqrt(2 * a * RAMP_LENGTH_M), 9);
    expect(rampSlide(a, tEnd).done).toBe(true);
    expect(rampSlide(a, -1).s).toBe(0);
  });

  it("narrates each stage in words", () => {
    const hold = { angleDeg: 20, mu: 0.5, massKg: 2 }, slip = { angleDeg: 30, mu: 0.3, massKg: 2 };
    expect(rampNarration("held", hold, g)).toMatch(/It will stay put.*26\.6°/);
    expect(rampNarration("stuck", hold, g)).toMatch(/^It stays put/);
    expect(rampNarration("held", slip, g)).toMatch(/Ready to slide.*2\.36 m\/s every second/);
    expect(rampNarration("held", { ...slip, mu: 0 }, g)).toMatch(/no friction/);
    expect(rampNarration("held", { ...slip, angleDeg: 0 }, g)).toMatch(/flat/);
    expect(rampNarration("sliding", slip, g, { v: 1.2, t: 0.5 })).toMatch(/mass makes no difference/);
    expect(rampNarration("bottom", slip, g, { v: 4.85, t: 2.06 })).toMatch(/Reached the bottom after 2\.06 s/);
  });
});

/* ------------------------------------------------------------------ saved builds */

describe("mergeMotionBuild", () => {
  it("returns the defaults for nothing at all, as a fresh copy", () => {
    expect(mergeMotionBuild()).toEqual(DEFAULT_MOTION);
    expect(mergeMotionBuild(null)).toEqual(DEFAULT_MOTION);
    const a = mergeMotionBuild(null);
    a.spring.k = 99;
    expect(DEFAULT_MOTION.spring.k).toBe(20);
  });

  it("loads an old-format snapshot that only knows the projectile and the pendulum", () => {
    const old = {
      tab: "pendulum",
      projectile: { speed: 33, angleDeg: 60, heightM: 5, planet: "moon", projectile: "shot", drag: true },
      pendulum: { lengthM: 2.5, amplitudeDeg: 45, planet: "mars", damping: 0.1 },
    } satisfies MotionSnapshot;
    const b = mergeMotionBuild(old);
    expect(b.tab).toBe("pendulum");
    expect(b.projectile).toEqual(old.projectile);
    expect(b.pendulum).toEqual(old.pendulum);
    expect(b.collisions).toEqual(DEFAULT_MOTION.collisions);
    expect(b.spring).toEqual(DEFAULT_MOTION.spring);
    expect(b.ramp).toEqual(DEFAULT_MOTION.ramp);
  });

  it("accepts a bare { tab } for every scene", () => {
    for (const tab of MOTION_TABS) expect(mergeMotionBuild({ tab })).toEqual({ ...DEFAULT_MOTION, tab });
  });

  it("opens the projectile for an unknown or missing tab", () => {
    expect(mergeMotionBuild({ tab: "orbits" }).tab).toBe("projectile");
    expect(mergeMotionBuild({ tab: null }).tab).toBe("projectile");
    expect(mergeMotionBuild({ spring: { k: 50 } }).tab).toBe("projectile");
  });

  it("fills in the settings a scene is missing and keeps the ones it has", () => {
    const b = mergeMotionBuild({ tab: "spring", spring: { k: 50 }, pendulum: { lengthM: 2 }, ramp: null });
    expect(b.spring).toEqual({ ...DEFAULT_MOTION.spring, k: 50 });
    expect(b.pendulum).toEqual({ ...DEFAULT_MOTION.pendulum, lengthM: 2 });
    expect(b.ramp).toEqual(DEFAULT_MOTION.ramp);
  });

  it("falls back to the default for a value of the wrong kind", () => {
    const junk = { tab: "ramp", ramp: { angleDeg: "steep", mu: NaN, planet: "venus", massKg: 4 }, projectile: { projectile: "anvil", drag: "yes", planet: "toString" } } as unknown as MotionSnapshot;
    const b = mergeMotionBuild(junk);
    expect(b.ramp).toEqual({ ...DEFAULT_MOTION.ramp, massKg: 4 });
    expect(b.projectile).toEqual(DEFAULT_MOTION.projectile);
  });
});
