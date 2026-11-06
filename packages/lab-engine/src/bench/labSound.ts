/**
 * Lab sounds (build plan 2.11), synthesised so they cost no downloads: glass clinks pitched to
 * vessel size, a pour whose pitch rises as the vessel fills, drop plinks, fizz loops that scale
 * with gas rate, burner hiss rising to a roar, the squeaky pop. Routed on the "lab" channel volume.
 */
import { sound } from "@labscape/audio";

let ctx: AudioContext | null = null;
let out: GainNode | null = null;

function ac() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    out = ctx.createGain();
    out.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  out!.gain.value = sound.settings.muted ? 0 : sound.settings.master * sound.settings.channels.lab;
  return ctx;
}

function noise(c: AudioContext, seconds: number) {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export const labSound = {
  clink(size = 1) {
    const c = ac();
    if (!c || !out) return;
    const t = c.currentTime;
    [2600, 4100, 5900].forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = f / Math.sqrt(size);
      g.gain.setValueAtTime(0.06 / (i + 1), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(out!);
      o.start(t);
      o.stop(t + 0.4);
    });
  },
  plink() {
    const c = ac();
    if (!c || !out) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.08);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.14);
  },
  pop() {
    const c = ac();
    if (!c || !out) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noise(c, 0.25);
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(4200, t + 0.12);
    f.Q.value = 3;
    const g = c.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(f).connect(g).connect(out);
    src.start(t);
  },
  splash() {
    const c = ac();
    if (!c || !out) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noise(c, 0.4);
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 1600;
    const g = c.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(f).connect(g).connect(out);
    src.start(t);
  },
};

/** A continuous loop (pour, fizz, burner) whose level and pitch you steer every frame. */
export class LoopSound {
  private src: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  constructor(private kind: "pour" | "fizz" | "burner" | "boil") {}

  set(level: number, pitch = 0.5) {
    const c = ac();
    if (!c || !out) return;
    if (level <= 0.001) {
      this.stop();
      return;
    }
    if (!this.src) {
      this.src = c.createBufferSource();
      this.src.buffer = noise(c, 2);
      this.src.loop = true;
      this.filter = c.createBiquadFilter();
      this.filter.type = this.kind === "burner" ? "lowpass" : "bandpass";
      this.filter.Q.value = this.kind === "pour" ? 4 : 1.2;
      this.gain = c.createGain();
      this.gain.gain.value = 0;
      this.src.connect(this.filter).connect(this.gain).connect(out);
      this.src.start();
    }
    const now = c.currentTime;
    const base = { pour: 500 + pitch * 1500, fizz: 3000 + pitch * 3000, burner: 300 + pitch * 1700, boil: 180 + pitch * 200 }[this.kind];
    this.filter!.frequency.setTargetAtTime(base, now, 0.08);
    const amp = { pour: 0.22, fizz: 0.09, burner: 0.12, boil: 0.2 }[this.kind];
    this.gain!.gain.setTargetAtTime(level * amp, now, 0.08);
  }

  stop() {
    if (!this.src || !ctx) return;
    const s = this.src;
    this.gain?.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    window.setTimeout(() => s.stop(), 200);
    this.src = null;
  }
}
