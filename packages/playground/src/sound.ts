/**
 * Tiny synthesised sound kit (no audio files). Part 1's @labscape/audio bus replaces this;
 * the cue names map onto its "lab" and "alert" channels.
 */
type Cue =
  | "click"
  | "pour"
  | "drop"
  | "fizz"
  | "chime"
  | "discover"
  | "warn"
  | "deny"
  | "freeze"
  | "clink";

class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
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
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(start: number, dur: number, freq: number, q: number, gain: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + start;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
      data[i] = (Math.random() * 2 - 1) * (Math.random() < 0.3 ? 1 : 0.35);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
  }

  play(cue: Cue, intensity = 1) {
    switch (cue) {
      case "click":
        this.tone(880, 0, 0.06, "triangle", 0.12);
        break;
      case "clink":
        this.tone(2400, 0, 0.18, "sine", 0.08);
        this.tone(3600, 0.01, 0.12, "sine", 0.04);
        break;
      case "pour":
        this.noise(0, 0.7, 900, 0.8, 0.25);
        break;
      case "drop":
        this.tone(520, 0, 0.12, "sine", 0.18, 260);
        break;
      case "fizz":
        this.noise(0, 1.6 + intensity, 5200, 0.6, 0.06 + 0.1 * Math.min(1, intensity));
        break;
      case "chime":
        [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, i * 0.08, 0.5, "sine", 0.16));
        break;
      case "discover":
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          this.tone(f, i * 0.09, 0.7, "triangle", 0.15),
        );
        this.tone(1568, 0.38, 0.9, "sine", 0.07);
        break;
      case "warn":
        this.tone(440, 0, 0.18, "triangle", 0.14);
        this.tone(554, 0.16, 0.22, "triangle", 0.12);
        break;
      case "freeze":
        this.tone(1200, 0, 0.6, "sine", 0.06, 300);
        break;
      case "deny":
        this.tone(140, 0, 0.45, "sawtooth", 0.18, 70);
        this.tone(220, 0.02, 0.3, "square", 0.06, 110);
        this.tone(660, 0.25, 0.25, "square", 0.05);
        this.tone(660, 0.55, 0.25, "square", 0.05);
        break;
    }
  }
}

export const sound = new SoundKit();
export type { Cue as SoundCue };
