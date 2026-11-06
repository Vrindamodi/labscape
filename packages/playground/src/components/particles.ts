/**
 * Canvas particle system for the beaker (bubbles, precipitate flakes, steam, sparks, pour drops).
 * Coordinates are in the beaker's SVG viewBox units, so the canvas lines up with the SVG.
 * Simulations draw on canvas (motion rule 1); quality drops automatically on slow frames.
 */

export type BubbleSize = "fine" | "medium" | "coarse";

export type Emitter = {
  id: string;
  x0: number;
  x1: number;
  y: number;
  ratePerS: number;
  size: BubbleSize;
  until: number;
};

type Kind = "bubble" | "ring" | "flake" | "steam" | "spark" | "drop" | "mote" | "plume" | "ember";

export type SmokeEmitter = { id: string; colour: string; density: number; until: number };

type P = {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  max: number;
  colour: string;
  phase: number;
  floor: number;
};

export type Bounds = { left: number; right: number; bottom: number };

export class ParticleSystem {
  private ctx: CanvasRenderingContext2D | null;
  private particles: P[] = [];
  private emitters: Emitter[] = [];
  private acc = new Map<string, number>();
  private raf = 0;
  private last = 0;
  private scale = 1;
  private slowFrames = 0;
  private quality = 1;
  /** Vertical offset (viewBox units) of the vessel inside the canvas. */
  offsetY = 0;
  surfaceY = 360;
  steamLevel = 0;
  stirring = false;
  mouthY = 60;
  private smokes: SmokeEmitter[] = [];
  private embersUntil = 0;
  private emberColour = "#ffb060";

  /** Coloured smoke/gas drifting out of the vessel mouth. */
  smoke(colour: string, density: number, durationMs: number) {
    this.smokes = [
      ...this.smokes.filter((s) => s.until > performance.now()),
      { id: String(Math.random()), colour, density, until: performance.now() + durationMs },
    ];
  }

  /** Glowing embers and sparks thrown up by a burning solid. */
  embers(colour: string, durationMs: number) {
    this.emberColour = colour;
    this.embersUntil = performance.now() + durationMs;
  }

  constructor(
    private canvas: HTMLCanvasElement,
    private viewW: number,
    private viewH: number,
    private bounds: Bounds,
    private reduced: boolean,
  ) {
    this.ctx = canvas.getContext("2d");
    if (reduced) this.quality = 0.2;
  }

  resize(cssWidth: number, cssHeight: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.scale = Math.min((cssWidth * dpr) / this.viewW, (cssHeight * dpr) / this.viewH);
  }

  start() {
    const loop = (t: number) => {
      const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 0.016;
      this.last = t;
      if (dt > 0.03) this.slowFrames++;
      else this.slowFrames = Math.max(0, this.slowFrames - 1);
      if (this.slowFrames > 90 && this.quality > 0.4) this.quality = 0.4; // lite tier
      this.step(dt, t);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  clear() {
    this.particles = [];
    this.emitters = [];
    this.smokes = [];
    this.embersUntil = 0;
    this.acc.clear();
  }

  setEmitters(list: Emitter[]) {
    this.emitters = list;
  }

  /** Precipitate flakes that swirl, then sink to the bottom over settleMs. */
  flakes(colour: string, amount: number, settleMs: number) {
    const n = Math.round(Math.min(160, 40 + amount * 140) * this.quality);
    const top = this.surfaceY + 6;
    for (let i = 0; i < n; i++) {
      this.particles.push({
        kind: "flake",
        x: this.rand(this.bounds.left + 6, this.bounds.right - 6),
        y: this.rand(top, this.bounds.bottom - 4),
        vx: this.rand(-12, 12),
        vy: this.rand(-6, 6),
        r: this.rand(0.8, 2.2),
        life: 0,
        max: settleMs / 1000 + this.rand(4, 9),
        colour,
        phase: Math.random() * Math.PI * 2,
        floor: this.bounds.bottom - this.rand(0, 7),
      });
    }
  }

  sparks(x: number, y: number, colours: string[], count = 60) {
    const n = Math.round(count * this.quality);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = this.rand(60, 220);
      this.particles.push({
        kind: "spark",
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 60,
        r: this.rand(1, 2.6),
        life: 0,
        max: this.rand(0.6, 1.3),
        colour: colours[i % colours.length] ?? "#fff",
        phase: 0,
        floor: 0,
      });
    }
  }

  /** Falling drops for the pour stream (or rising drops when the pour reverses). */
  drops(x: number, fromY: number, colour: string, count: number, reverse = false) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        kind: "drop",
        x: x + this.rand(-3, 3),
        y: reverse ? this.surfaceY - this.rand(0, 10) : fromY + this.rand(-4, 4),
        vx: reverse ? this.rand(-30, 30) : this.rand(-6, 6),
        vy: reverse ? -this.rand(160, 320) : this.rand(60, 140),
        r: this.rand(1.4, 3.2),
        life: 0,
        max: 2,
        colour,
        phase: reverse ? 1 : 0,
        floor: 0,
      });
    }
  }

  private rand(a: number, b: number) {
    return a + Math.random() * (b - a);
  }

  private bubbleRadius(size: BubbleSize) {
    return size === "fine"
      ? this.rand(1, 2.2)
      : size === "medium"
        ? this.rand(2, 3.6)
        : this.rand(3, 5.5);
  }

  private step(dt: number, now: number) {
    // Emit bubbles from active emitters.
    for (const e of this.emitters) {
      if (now > e.until || this.surfaceY >= this.bounds.bottom - 2) continue;
      const remaining = (e.until - now) / 1000;
      const taper = Math.min(1, remaining / 1.5);
      const rate = e.ratePerS * this.quality * taper;
      const acc = (this.acc.get(e.id) ?? 0) + rate * dt;
      const whole = Math.floor(acc);
      this.acc.set(e.id, acc - whole);
      for (let i = 0; i < whole; i++) {
        this.particles.push({
          kind: "bubble",
          x: this.rand(e.x0, e.x1),
          y: Math.max(this.surfaceY + 4, e.y + this.rand(-4, 2)),
          vx: 0,
          vy: -this.rand(40, 95) * (e.size === "coarse" ? 1.25 : 1),
          r: this.bubbleRadius(e.size),
          life: 0,
          max: 8,
          colour: "",
          phase: Math.random() * Math.PI * 2,
          floor: 0,
        });
      }
    }
    if (this.steamLevel > 0 && Math.random() < this.steamLevel * 0.5 * this.quality) {
      this.particles.push({
        kind: "steam",
        x: this.rand(this.bounds.left + 20, this.bounds.right - 20),
        y: this.surfaceY - 4,
        vx: this.rand(-6, 6),
        vy: -this.rand(14, 30),
        r: this.rand(6, 14),
        life: 0,
        max: this.rand(2, 3.5),
        colour: "",
        phase: Math.random() * 6,
        floor: 0,
      });
    }

    for (const sm of this.smokes) {
      if (now > sm.until) continue;
      if (Math.random() < sm.density * 0.9 * this.quality) {
        this.particles.push({
          kind: "plume",
          x: this.rand(this.bounds.left + 30, this.bounds.right - 30),
          y: Math.min(this.surfaceY, this.bounds.bottom) - this.rand(0, 20),
          vx: this.rand(-8, 8),
          vy: -this.rand(28, 55),
          r: this.rand(10, 20),
          life: 0,
          max: this.rand(3, 5),
          colour: sm.colour,
          phase: Math.random() * 6,
          floor: sm.density,
        });
      }
    }
    if (now < this.embersUntil && Math.random() < 0.7 * this.quality) {
      for (let i = 0; i < 2; i++) {
        this.particles.push({
          kind: "ember",
          x: this.rand(this.bounds.left + 40, this.bounds.right - 40),
          y: this.bounds.bottom - this.rand(0, 14),
          vx: this.rand(-50, 50),
          vy: -this.rand(80, 220),
          r: this.rand(0.8, 2),
          life: 0,
          max: this.rand(0.5, 1.2),
          colour: this.emberColour,
          phase: 0,
          floor: 0,
        });
      }
    }

    const next: P[] = [];
    for (const p of this.particles) {
      p.life += dt;
      switch (p.kind) {
        case "bubble": {
          p.phase += dt * 9;
          p.x += Math.sin(p.phase) * 10 * dt + (this.stirring ? 20 * dt : 0);
          p.y += p.vy * dt;
          p.r += dt * 0.6;
          if (p.y <= this.surfaceY + p.r) {
            next.push({ ...p, kind: "ring", life: 0, max: 0.35, y: this.surfaceY, r: p.r });
            continue;
          }
          break;
        }
        case "ring":
          p.r += dt * 14;
          break;
        case "flake": {
          const settling = p.life > 0.6;
          p.phase += dt * 2;
          if (settling) {
            p.vx *= 0.97;
            p.vy = Math.min(p.vy + 10 * dt, 14);
          } else {
            p.vx += Math.cos(p.phase) * 30 * dt;
            p.vy += Math.sin(p.phase) * 30 * dt;
          }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.y >= p.floor) {
            p.y = p.floor;
            p.vx = 0;
            p.vy = 0;
          }
          p.x = Math.min(this.bounds.right - 4, Math.max(this.bounds.left + 4, p.x));
          if (p.y < this.surfaceY + 4) p.y = this.surfaceY + 4;
          break;
        }
        case "steam":
          p.x += p.vx * dt + Math.sin(p.life * 2 + p.phase) * 6 * dt;
          p.y += p.vy * dt;
          p.r += dt * 6;
          break;
        case "spark":
          p.vy += 260 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.985;
          break;
        case "drop":
          p.vy += (p.phase ? -200 : 900) * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (!p.phase && p.y >= this.surfaceY) continue;
          if (p.phase && p.y < -20) continue;
          break;
        case "plume":
          p.x += p.vx * dt + Math.sin(p.life * 1.6 + p.phase) * 10 * dt;
          p.y += p.vy * dt;
          if (p.y < this.mouthY)
            p.vx += (p.x < (this.bounds.left + this.bounds.right) / 2 ? -1 : 1) * 4 * dt;
          p.r += dt * 9;
          break;
        case "ember":
          p.vy += 120 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          break;
        case "mote":
          break;
      }
      if (p.life < p.max) next.push(p);
    }
    this.particles = next.length > 1400 ? next.slice(next.length - 1400) : next;
  }

  private draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const offsetX = (this.canvas.width - this.viewW * this.scale) / 2;
    const offsetY = (this.canvas.height - this.viewH * this.scale) / 2;
    ctx.setTransform(this.scale, 0, 0, this.scale, offsetX, offsetY + this.offsetY * this.scale);

    for (const p of this.particles) {
      const fade = 1 - p.life / p.max;
      switch (p.kind) {
        case "bubble": {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.10)";
          ctx.fill();
          ctx.lineWidth = 0.7;
          ctx.strokeStyle = "rgba(255,255,255,0.65)";
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.28, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.fill();
          break;
        }
        case "ring":
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.r, p.r * 0.3, 0, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,255,255,${0.5 * fade})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
          break;
        case "flake":
          ctx.globalAlpha = Math.min(1, fade * 3);
          ctx.fillStyle = p.colour;
          ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
          ctx.globalAlpha = 1;
          break;
        case "steam": {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          g.addColorStop(0, `rgba(230,240,255,${0.16 * fade})`);
          g.addColorStop(1, "rgba(230,240,255,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "spark":
          ctx.globalAlpha = fade;
          ctx.fillStyle = p.colour;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          break;
        case "drop":
          ctx.fillStyle = p.colour;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.r * 0.8, p.r * 1.3, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "plume": {
          const a = Math.min(1, p.life * 2) * fade * (0.35 + p.floor * 0.4);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          g.addColorStop(0, withAlpha(p.colour, a));
          g.addColorStop(1, withAlpha(p.colour, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "ember":
          ctx.globalAlpha = fade;
          ctx.fillStyle = p.colour;
          ctx.shadowColor = p.colour;
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
          break;
        case "mote":
          break;
      }
    }
  }
}

function withAlpha(colour: string, a: number): string {
  const m = colour.match(/rgba?\(([^)]+)\)/);
  if (m && m[1]) {
    const [r, g, b] = m[1].split(",").map((x) => parseFloat(x));
    return `rgba(${r ?? 255}, ${g ?? 255}, ${b ?? 255}, ${a.toFixed(3)})`;
  }
  return colour;
}
