/**
 * Synthesised lab sound kit (no audio files). Part 1's @labscape/audio bus replaces this;
 * one-shots map to its "lab"/"alert" channels, loops to "lab"/"ambient".
 */
export type SoundCue =
  | "click"
  | "clink"
  | "drip"
  | "scoop"
  | "pop"
  | "squeakyPop"
  | "tinkle"
  | "bang"
  | "crackle"
  | "sizzle"
  | "whoosh"
  | "hiss"
  | "spark"
  | "chime"
  | "discover"
  | "warn"
  | "deny"
  | "freeze"
  | "fizz"
  | "drop"
  | "pour";

export type LoopName = "pour" | "fizz" | "burner" | "stir";

type Loop = { stop: () => void; set: (v: number) => void };

class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private loops = new Map<LoopName, Loop>();
  muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.4;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  private noiseBuffer(ctx: AudioContext, seconds: number) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private tone(
    freq: number,
    start: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    glideTo?: number,
  ) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private burst(
    start: number,
    dur: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    gain: number,
    sweepTo?: number,
  ) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + start;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, dur);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  play(cue: SoundCue, intensity = 1) {
    switch (cue) {
      case "click":
        this.tone(900, 0, 0.05, "triangle", 0.1);
        break;
      case "clink":
        this.tone(2600, 0, 0.25, "sine", 0.09);
        this.tone(3900, 0.005, 0.18, "sine", 0.04);
        break;
      case "drip":
      case "drop":
        this.tone(1400, 0, 0.09, "sine", 0.16, 520);
        this.tone(700, 0.04, 0.12, "sine", 0.06, 380);
        break;
      case "scoop":
        this.burst(0, 0.18, "highpass", 2500, 0.7, 0.12);
        this.tone(320, 0.05, 0.12, "triangle", 0.06, 200);
        break;
      case "pop":
        this.burst(0, 0.12, "lowpass", 2400, 0.8, 0.5, 300);
        this.tone(420, 0, 0.12, "sine", 0.3, 90);
        break;
      case "squeakyPop":
        // The hydrogen test: a sharp crack with a short high squeak riding on it.
        this.burst(0, 0.1, "bandpass", 2600, 0.9, 0.55, 600);
        this.tone(1900, 0, 0.16, "square", 0.08, 700);
        this.tone(380, 0, 0.14, "sine", 0.32, 80);
        break;
      case "tinkle":
        // Crystals forming: a scatter of tiny glassy chimes.
        for (let i = 0; i < 7; i++) this.tone(2400 + Math.random() * 2600, i * 0.11 + Math.random() * 0.05, 0.22, "sine", 0.04);
        break;
      case "bang":
        this.burst(0, 0.7, "lowpass", 1800, 0.5, 0.9, 80);
        this.tone(110, 0, 0.6, "sine", 0.6, 40);
        break;
      case "crackle":
        for (let i = 0; i < 14; i++)
          this.burst(Math.random() * 1.4, 0.03, "bandpass", 3000 + Math.random() * 3000, 2, 0.18);
        break;
      case "sizzle":
        this.burst(0, 1.6 * intensity, "highpass", 4500, 0.5, 0.16);
        break;
      case "whoosh":
        this.burst(0, 1.1, "bandpass", 300, 0.6, 0.5, 2200);
        break;
      case "hiss":
        this.burst(0, 1.2, "highpass", 3500, 0.4, 0.2);
        break;
      case "spark":
        this.burst(0, 0.05, "highpass", 5000, 1, 0.4);
        this.burst(0.06, 0.04, "highpass", 6000, 1, 0.3);
        break;
      case "fizz":
        this.burst(0, 1.4 + intensity, "bandpass", 5200, 0.6, 0.05 + 0.08 * Math.min(1, intensity));
        break;
      case "pour":
        this.burst(0, 0.6, "bandpass", 700, 1.2, 0.2);
        break;
      case "chime":
        [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, i * 0.08, 0.5, "sine", 0.15));
        break;
      case "discover":
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          this.tone(f, i * 0.09, 0.7, "triangle", 0.14),
        );
        this.tone(1568, 0.38, 0.9, "sine", 0.07);
        break;
      case "warn":
        this.tone(440, 0, 0.18, "triangle", 0.13);
        this.tone(554, 0.16, 0.22, "triangle", 0.11);
        break;
      case "freeze":
        this.tone(1200, 0, 0.6, "sine", 0.06, 300);
        break;
      case "deny":
        this.tone(150, 0, 0.45, "sawtooth", 0.16, 70);
        this.tone(660, 0.25, 0.2, "square", 0.05);
        this.tone(660, 0.5, 0.2, "square", 0.05);
        break;
    }
  }

  /** Continuous sounds: pouring glugs, fizzing, the burner roar, glass-rod stirring. */
  loop(name: LoopName, on: boolean, level = 1) {
    const existing = this.loops.get(name);
    if (!on) {
      existing?.stop();
      this.loops.delete(name);
      return;
    }
    if (existing) {
      existing.set(level);
      return;
    }
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 2);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    let base = 0.1;
    switch (name) {
      case "pour":
        f.type = "bandpass";
        f.frequency.value = 650;
        f.Q.value = 1.4;
        lfo.frequency.value = 7; // glug-glug
        lfoGain.gain.value = 0.08;
        base = 0.16;
        break;
      case "fizz":
        f.type = "bandpass";
        f.frequency.value = 5200;
        f.Q.value = 0.5;
        lfo.frequency.value = 23;
        lfoGain.gain.value = 0.03;
        base = 0.08;
        break;
      case "burner":
        f.type = "lowpass";
        f.frequency.value = 420;
        f.Q.value = 0.7;
        lfo.frequency.value = 3;
        lfoGain.gain.value = 0.03;
        base = 0.22;
        break;
      case "stir":
        f.type = "bandpass";
        f.frequency.value = 2800;
        f.Q.value = 4;
        lfo.frequency.value = 2.2;
        lfoGain.gain.value = 0.04;
        base = 0.05;
        break;
    }
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(f).connect(g).connect(this.master);
    const set = (v: number) =>
      g.gain.setTargetAtTime(Math.max(0.0001, base * Math.min(1.5, v)), ctx.currentTime, 0.08);
    set(level);
    src.start();
    lfo.start();
    this.loops.set(name, {
      set,
      stop: () => {
        g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.06);
        window.setTimeout(() => {
          try {
            src.stop();
            lfo.stop();
          } catch {
            /* already stopped */
          }
        }, 400);
      },
    });
  }

  stopAll() {
    for (const name of [...this.loops.keys()]) this.loop(name, false);
  }
}

export const sound = new SoundKit();
