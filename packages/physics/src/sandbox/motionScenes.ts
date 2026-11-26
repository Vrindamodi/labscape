/**
 * The maths and the wording behind the newer Motion sandbox scenes: collisions, a mass on a spring
 * and a block on a ramp. Nothing here touches React, so every rule can be unit-tested. Each motion
 * is solved exactly rather than stepped, so it cannot drift or blow up at the slider extremes or
 * after a long frame gap.
 */
import type { Planet } from "../core/mechanics";
import { deg, rad } from "../core/runtime";
import { sf } from "../ui/kit";

/** Slower than this (m/s, or kg·m/s for momentum) reads as "not moving". */
const STILL = 5e-3;

/** A length in the unit a ruler would use: centimetres below a metre, metres above. */
export const lengthWords = (m: number) => (Math.abs(m) < 1 ? `${sf(m * 100)} cm` : `${sf(m)} m`);

/* ------------------------------------------------------------------ collisions */

/** Two carts on a straight track. Velocities are + to the right; restitution 0 sticks, 1 is perfectly elastic. */
export type CollisionParams = { m1: number; m2: number; u1: number; u2: number; restitution: number };
export const DEFAULT_COLLISION: CollisionParams = { m1: 2, m2: 1, u1: 2, u2: -1, restitution: 1 };

/** The track: 20 m long with open ends. Carts are 1 m long; A starts centred at 5 m, B at 15 m. */
export const TRACK = { lengthM: 20, cartM: 1, startA: 5, startB: 15 } as const;
/** How long (s) the scene keeps watching after a collision, or when there is none. */
const WATCH_AFTER_S = 4, WATCH_MISS_S = 5;

export const momentum = (m1: number, v1: number, m2: number, v2: number) => m1 * v1 + m2 * v2;
export const kineticEnergy = (m1: number, v1: number, m2: number, v2: number) => 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2;

/**
 * Velocities just after a head-on collision. Momentum is conserved whatever the restitution e;
 * the carts separate at e times the speed they closed at (0 = stuck together, 1 = no energy lost).
 */
export function collide(m1: number, m2: number, u1: number, u2: number, e: number): { v1: number; v2: number } {
  const p = momentum(m1, u1, m2, u2), closing = u1 - u2, total = m1 + m2;
  return { v1: (p - m2 * e * closing) / total, v2: (p + m1 * e * closing) / total };
}

/** Seconds until a cart centred at x leaves the end of the track at velocity v (never, if it is not moving). */
function exitTime(x: number, v: number): number {
  if (v > 0) return Math.max(0, (TRACK.lengthM - TRACK.cartM / 2 - x) / v);
  if (v < 0) return Math.max(0, (x - TRACK.cartM / 2) / -v);
  return Infinity;
}

export type CollisionOutcome = {
  /** "hit", or why they never meet: nothing moves, the gap is not closing, or a cart leaves the track first. */
  kind: "hit" | "still" | "sameSpeed" | "apart" | "offTrack";
  /** When they touch (s), and where along the track (m). Null when they never meet. */
  tHit: number | null;
  xHit: number | null;
  /** Velocities once it is over (unchanged when they never meet). */
  v1: number;
  v2: number;
  pBefore: number;
  pAfter: number;
  keBefore: number;
  keAfter: number;
  keLost: number;
  /** When the scene stops watching (s): a cart reaches the end of the track, or a few seconds have passed. */
  tEnd: number;
};

/** Works out the whole run before it is played: whether the carts meet, when, and what comes out. */
export function collisionOutcome(p: CollisionParams): CollisionOutcome {
  const { m1, m2, u1, u2 } = p;
  const e = Math.max(0, Math.min(1, p.restitution));
  const closing = u1 - u2;
  const gap = TRACK.startB - TRACK.startA - TRACK.cartM;
  const pBefore = momentum(m1, u1, m2, u2), keBefore = kineticEnergy(m1, u1, m2, u2);
  const leaves = Math.min(exitTime(TRACK.startA, u1), exitTime(TRACK.startB, u2));
  const tHit = closing > 0 ? gap / closing : Infinity;
  if (!(closing > 0 && tHit <= leaves)) {
    const kind = u1 === 0 && u2 === 0 ? "still" : closing > 0 ? "offTrack" : closing === 0 ? "sameSpeed" : "apart";
    return { kind, tHit: null, xHit: null, v1: u1, v2: u2, pBefore, pAfter: pBefore, keBefore, keAfter: keBefore, keLost: 0, tEnd: kind === "still" ? 0 : Math.min(leaves, WATCH_MISS_S) };
  }
  const { v1, v2 } = collide(m1, m2, u1, u2, e);
  const x1 = TRACK.startA + u1 * tHit;
  const keAfter = kineticEnergy(m1, v1, m2, v2);
  const stopped = Math.abs(v1) < STILL && Math.abs(v2) < STILL;
  const tEnd = tHit + Math.min(exitTime(x1, v1), exitTime(x1 + TRACK.cartM, v2), stopped ? 1 : WATCH_AFTER_S);
  return { kind: "hit", tHit, xHit: x1 + TRACK.cartM / 2, v1, v2, pBefore, pAfter: momentum(m1, v1, m2, v2), keBefore, keAfter, keLost: Math.max(0, keBefore - keAfter), tEnd };
}

/** Where both carts are (centres, m) and how fast they move at time t of the run. */
export function collisionAt(p: CollisionParams, o: CollisionOutcome, t: number): { x1: number; x2: number; v1: number; v2: number; hit: boolean } {
  const tt = Math.max(0, Math.min(o.tEnd, t));
  if (o.tHit === null || tt < o.tHit) return { x1: TRACK.startA + p.u1 * tt, x2: TRACK.startB + p.u2 * tt, v1: p.u1, v2: p.u2, hit: false };
  const x1 = TRACK.startA + p.u1 * o.tHit, after = tt - o.tHit;
  return { x1: x1 + o.v1 * after, x2: x1 + TRACK.cartM + o.v2 * after, v1: o.v1, v2: o.v2, hit: true };
}

/** A velocity in words: which way and how fast. */
export const velocityWords = (v: number) => (Math.abs(v) < STILL ? "at rest" : `moving ${v > 0 ? "right" : "left"} at ${sf(Math.abs(v))} m/s`);
const momentumWords = (p: number) => (Math.abs(p) < STILL ? "0 kg·m/s" : `${sf(Math.abs(p))} kg·m/s to the ${p > 0 ? "right" : "left"}`);

/** What the carts are doing, in words: before Go, on the way in, after the collision, or once they have missed. */
export function collisionNarration(stage: "ready" | "approach" | "after" | "missed", p: CollisionParams, o: CollisionOutcome): string {
  if (o.kind === "still") return "Nothing is moving, so nothing will happen. Give one of the carts a starting velocity.";
  if (o.kind !== "hit") {
    if (stage === "ready") {
      if (o.kind === "apart") return "These carts will never meet: B is getting away from A. Make A faster, or send B to the left.";
      if (o.kind === "sameSpeed") return "Both carts have the same velocity, so the gap between them never changes. Make A faster than B, or send B to the left.";
      return "The gap is closing, but so slowly that a cart leaves the track before they can meet. Make the two velocities more different.";
    }
    const why = o.kind === "apart" ? "The carts are moving apart" : o.kind === "sameSpeed" ? "Both carts have the same velocity, so the gap never closes" : "The gap closes too slowly, so a cart reaches the end of the track first";
    if (stage === "missed") return `${why}: they never met. Nothing pushed on either cart, so each kept its speed and the total momentum stayed at ${momentumWords(o.pBefore)}.`;
    return `${why}. With nothing pushing on them, each cart just keeps its speed.`;
  }
  if (stage === "ready") return `Ready. Cart A (${p.m1} kg) is ${velocityWords(p.u1)} and cart B (${p.m2} kg) is ${velocityWords(p.u2)}, so they will meet. Total momentum: ${momentumWords(o.pBefore)}. Press Go.`;
  if (stage === "approach") return `Closing in: the gap shrinks by ${sf(p.u1 - p.u2)} m every second. Nothing is pushing on either cart yet, so each keeps its speed.`;
  const lost = `${sf(o.keLost)} J of movement energy (${sf(o.keBefore > 0 ? (100 * o.keLost) / o.keBefore : 0, 2)}%)`;
  if (p.restitution <= 0) {
    if (Math.abs(o.v1) < STILL) return `They stuck together and stopped dead. Their momenta were equal and opposite, so the total was 0 before and is still 0. All ${sf(o.keLost)} J of movement energy turned into heat, sound and squashed carts.`;
    return `They stuck together and now travel as one ${sf(p.m1 + p.m2)} kg lump, ${velocityWords(o.v1)}. Total momentum is still ${momentumWords(o.pAfter)}, but ${lost} turned into heat, sound and squashed carts.`;
  }
  const now = `A is now ${velocityWords(o.v1)} and B is ${velocityWords(o.v2)}`;
  if (p.restitution >= 1) return `A perfect bounce. ${now}. Total momentum is still ${momentumWords(o.pAfter)} and no movement energy was lost.`;
  return `They bounced apart. ${now}. Total momentum is still ${momentumWords(o.pAfter)}, but ${lost} turned into heat and sound.`;
}

/* ------------------------------------------------------------------ spring */

/** A mass hanging on a spring. `amplitudeM` is how far below its rest position it is let go; `damping` is in kg/s. */
export type SpringParams = { massKg: number; k: number; amplitudeM: number; damping: number; planet: Planet };
export const DEFAULT_SPRING: SpringParams = { massKg: 0.5, k: 20, amplitudeM: 0.15, damping: 0, planet: "earth" };
/** The furthest the mass can be pulled below its rest position (m). */
export const SPRING_MAX_PULL_M = 0.3;

/** Period of the bounce, 2 pi sqrt(m/k). Gravity is not in it. */
export const springPeriod = (massKg: number, k: number) => 2 * Math.PI * Math.sqrt(massKg / k);

/** How far the weight stretches the spring before it hangs still: mg / k. This is all that gravity changes. */
export const springRestStretch = (massKg: number, k: number, g: number) => (massKg * g) / k;

/** Period with damping b (kg/s), a little longer than without; null when the damping is too strong to bounce at all. */
export function springDampedPeriod(massKg: number, k: number, damping: number): number | null {
  const w2 = k / massKg - (damping / (2 * massKg)) ** 2;
  return w2 > 1e-9 ? (2 * Math.PI) / Math.sqrt(w2) : null;
}

/**
 * Displacement below the rest position (m) and velocity (m/s, + downwards) after dt seconds of
 * m y'' = -k y - b y'. This is the exact solution (bouncing, critical or creeping), so it is stable
 * for any dt and loses no energy when b = 0.
 */
export function springStep(state: [number, number], massKg: number, k: number, damping: number, dt: number): [number, number] {
  const [y0, v0] = state;
  const gamma = damping / (2 * massKg);
  const w2 = k / massKg;
  const disc = w2 - gamma * gamma;
  const decay = Math.exp(-gamma * dt);
  const a = v0 + gamma * y0, b = w2 * y0 + gamma * v0;
  // c and s are cos and sin/w for a bounce, cosh and sinh/q for a creep, and 1 and dt in between.
  let c = 1, s = dt;
  if (disc > 1e-9) {
    const w = Math.sqrt(disc);
    c = Math.cos(w * dt);
    s = Math.sin(w * dt) / w;
  } else if (disc < -1e-9) {
    const q = Math.sqrt(-disc);
    c = Math.cosh(q * dt);
    s = Math.sinh(q * dt) / q;
  }
  return [decay * (y0 * c + a * s), decay * (v0 * c - b * s)];
}

/**
 * Movement energy and stored energy (J). Measured from the rest position, the spring's stretch
 * energy and the height energy add up to k y^2 / 2, so the two are shown as one "stored" amount.
 */
export function springEnergy(massKg: number, k: number, y: number, v: number) {
  const ke = 0.5 * massKg * v * v, pe = 0.5 * k * y * y;
  return { ke, pe, total: ke + pe };
}

/** What the mass is doing right now, in words. y is metres below the rest position, v is + downwards. */
export function springNarration(y: number, v: number, p: Pick<SpringParams, "massKg" | "k" | "damping">, dragging = false): string {
  if (dragging) return y < 0.005 ? "You are holding the mass at its rest position. Pull it down, then let go." : `Pulled ${lengthWords(y)} below the rest position: the spring now pulls up harder than gravity pulls down. Let go to release it.`;
  // The size of the bounce right now, from its energy (so it shrinks smoothly with damping).
  const size = Math.sqrt(y * y + (p.massKg / p.k) * v * v);
  if (size < 0.003) return p.damping > 0 ? "The bounce has died away: damping has taken all of its energy. It hangs still where the spring's pull balances its weight." : "It is hanging still, where the spring's pull balances its weight. Pull it down and let go.";
  if (springDampedPeriod(p.massKg, p.k, p.damping) === null) return "The damping is so strong that it cannot bounce: it creeps back to the rest position without overshooting.";
  const frac = Math.abs(y) / size;
  if (frac > 0.95) return y > 0 ? "Lowest point: the spring is stretched the most, so it pulls up harder than gravity pulls down. The mass stops for an instant and heads back up." : "Highest point: the spring pulls least here, so gravity wins. The mass stops for an instant and comes back down.";
  if (frac < 0.15) return "Passing the rest position: the spring's pull and the weight balance here, and this is where it moves fastest. All the stored energy has become movement.";
  return Math.sign(y) !== Math.sign(v) ? "Heading back to the rest position: it is speeding up as stored energy turns into movement energy." : "Moving away from the rest position: it is slowing down as movement energy is stored again.";
}

/* ------------------------------------------------------------------ ramp */

/** A block on a slope, with one friction coefficient for both holding and sliding. */
export type RampParams = { angleDeg: number; mu: number; massKg: number; planet: Planet };
export const DEFAULT_RAMP: RampParams = { angleDeg: 30, mu: 0.3, massKg: 2, planet: "earth" };
/** How far the block slides from the top of the ramp to the bottom (m). */
export const RAMP_LENGTH_M = 5;

/** The steepest angle (degrees) at which friction can still hold the block: tan(angle) = mu. */
export const rampThresholdDeg = (mu: number) => deg(Math.atan(mu));

/**
 * Every force on the block (N). The weight splits into a part along the slope and a part into it;
 * the surface pushes back with the normal force, and friction can supply up to mu x normal. It
 * slides only when the pull along the slope beats that (tan angle > mu), and then
 * a = g (sin angle - mu cos angle): the mass cancels.
 */
export function rampForces(massKg: number, angleDeg: number, mu: number, g: number) {
  const th = rad(angleDeg);
  const weight = massKg * g;
  const along = weight * Math.sin(th), into = weight * Math.cos(th);
  const maxFriction = mu * into;
  const slides = Math.sin(th) - mu * Math.cos(th) > 1e-9;
  const friction = slides ? maxFriction : along;
  const net = slides ? along - friction : 0;
  return { weight, along, into, normal: into, maxFriction, friction, net, accel: net / massKg, slides };
}

/** Acceleration down the slope (m/s^2): g (sin angle - mu cos angle), or 0 when friction holds it. */
export const rampAcceleration = (angleDeg: number, mu: number, g: number) => rampForces(1, angleDeg, mu, g).accel;

/** Distance slid (m), speed (m/s) and clock (s) t seconds after release from rest; it stops at the bottom. */
export function rampSlide(accel: number, t: number, lengthM = RAMP_LENGTH_M): { s: number; v: number; t: number; done: boolean } {
  if (!(accel > 0) || !(t > 0)) return { s: 0, v: 0, t: 0, done: false };
  const tEnd = Math.sqrt((2 * lengthM) / accel);
  if (t >= tEnd) return { s: lengthM, v: accel * tEnd, t: tEnd, done: true };
  return { s: 0.5 * accel * t * t, v: accel * t, t, done: false };
}

/** What the block is doing, in words: held at the top, released but stuck, sliding, or at the bottom. */
export function rampNarration(stage: "held" | "stuck" | "sliding" | "bottom", p: Pick<RampParams, "angleDeg" | "mu" | "massKg">, g: number, now: { v: number; t: number } = { v: 0, t: 0 }): string {
  const f = rampForces(p.massKg, p.angleDeg, p.mu, g);
  if (stage === "sliding") return `Sliding: it speeds up by ${sf(f.accel)} m/s every second (now ${sf(now.v, 2)} m/s). A heavier block is pulled harder but is just as much harder to speed up, so mass makes no difference.`;
  if (stage === "bottom") return `Reached the bottom after ${sf(now.t)} s, going ${sf(now.v)} m/s. Change the mass and release it again: the time will be exactly the same.`;
  if (p.angleDeg <= 0) return "The ramp is flat, so none of the weight pulls along it and the block has no reason to move. Tilt the ramp.";
  if (!f.slides) {
    const fix = p.mu > 0 ? `Tilt it past ${sf(rampThresholdDeg(p.mu))}° or make it more slippery and it will slide.` : "";
    return `${stage === "stuck" ? "It stays put" : "It will stay put"}. Gravity pulls it down the slope with ${sf(f.along)} N, and friction could push back with up to ${sf(f.maxFriction)} N, so friction simply matches the ${sf(f.along)} N. ${fix}`.trim();
  }
  const left = p.mu > 0 ? `The pull down the slope (${sf(f.along)} N) beats the most friction can manage (${sf(f.maxFriction)} N). The ${sf(f.net)} N left over` : `There is no friction, so the whole ${sf(f.along)} N pull down the slope`;
  return `Ready to slide. ${left} will speed it up by ${sf(f.accel)} m/s every second. Press Release.`;
}
