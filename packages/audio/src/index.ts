// @labscape/audio - owned by Part 1.
// Sound bus with five channels, ducking, a voice cap and haptics. Every UI sound is synthesised
// with WebAudio (no asset downloads, no licensing), so the bus works offline.

export type AudioChannel = "ui" | "lab" | "ambient" | "alert" | "voice";

export const AUDIO_CHANNELS: readonly AudioChannel[] = ["ui", "lab", "ambient", "alert", "voice"];

/** Ducking rules: alerts duck ambient by 12 dB; AI speech ducks lab sound by 8 dB. */
export const DUCKING = [
  { trigger: "alert", target: "ambient", db: -12 },
  { trigger: "voice", target: "lab", db: -8 },
] as const satisfies readonly { trigger: AudioChannel; target: AudioChannel; db: number }[];

export const MAX_SIMULTANEOUS_VOICES = 16;

export type HapticPattern = "tick" | "tap" | "success";
export const HAPTICS: Record<HapticPattern, number | number[]> = {
  tick: 8,
  tap: 18,
  success: [14, 40, 14, 40, 28],
};

/** Named UI cues. Labs add their own on the "lab" channel. */
export type Cue =
  | "click"
  | "hover"
  | "toggle"
  | "open"
  | "close"
  | "success"
  | "error"
  | "xp"
  | "coin"
  | "levelUp"
  | "badge"
  | "streak"
  | "notify"
  | "whoosh";

export type BusSettings = {
  master: number;
  channels: Record<AudioChannel, number>;
  muted: boolean;
  haptics: boolean;
};

export const DEFAULT_BUS_SETTINGS: BusSettings = {
  master: 0.8,
  channels: { ui: 0.6, lab: 0.8, ambient: 0.4, alert: 1, voice: 1 },
  muted: false,
  haptics: true,
};

type Note = { f: number; t: number; d: number; type?: OscillatorType; g?: number; glide?: number };

const SCORES: Record<Cue, { channel: AudioChannel; notes: Note[]; noise?: { t: number; d: number; g: number; hp: number } }> = {
  click: { channel: "ui", notes: [{ f: 1800, t: 0, d: 0.035, type: "triangle", g: 0.18, glide: 900 }] },
  hover: { channel: "ui", notes: [{ f: 2400, t: 0, d: 0.02, type: "sine", g: 0.04 }] },
  toggle: { channel: "ui", notes: [{ f: 880, t: 0, d: 0.05, type: "triangle", g: 0.14 }, { f: 1320, t: 0.04, d: 0.06, type: "triangle", g: 0.12 }] },
  open: { channel: "ui", notes: [{ f: 520, t: 0, d: 0.12, type: "sine", g: 0.12, glide: 880 }] },
  close: { channel: "ui", notes: [{ f: 760, t: 0, d: 0.1, type: "sine", g: 0.1, glide: 420 }] },
  success: { channel: "ui", notes: [523.25, 659.25, 783.99, 1046.5].map((f, i): Note => ({ f, t: i * 0.07, d: 0.22, type: "triangle", g: 0.14 })) },
  error: { channel: "alert", notes: [{ f: 220, t: 0, d: 0.16, type: "square", g: 0.06 }, { f: 165, t: 0.12, d: 0.22, type: "square", g: 0.06 }] },
  xp: { channel: "ui", notes: [{ f: 1318.5, t: 0, d: 0.08, type: "sine", g: 0.12 }, { f: 1975.5, t: 0.05, d: 0.14, type: "sine", g: 0.1 }] },
  coin: { channel: "ui", notes: [{ f: 987.77, t: 0, d: 0.06, type: "square", g: 0.05 }, { f: 1318.5, t: 0.06, d: 0.2, type: "square", g: 0.05 }] },
  levelUp: {
    channel: "ui",
    notes: [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].map((f, i): Note => ({ f, t: i * 0.09, d: 0.5 - i * 0.04, type: "sawtooth", g: 0.05 }))
      .concat([{ f: 1046.5, t: 0.55, d: 1.1, type: "triangle", g: 0.12 }, { f: 1567.98, t: 0.55, d: 1.1, type: "sine", g: 0.08 }] as Note[]),
    noise: { t: 0.5, d: 0.6, g: 0.05, hp: 6000 },
  },
  badge: {
    channel: "ui",
    notes: [{ f: 659.25, t: 0, d: 0.16, type: "triangle", g: 0.14 }, { f: 987.77, t: 0.1, d: 0.16, type: "triangle", g: 0.14 }, { f: 1318.5, t: 0.2, d: 0.6, type: "sine", g: 0.14 }],
    noise: { t: 0.18, d: 0.4, g: 0.04, hp: 7000 },
  },
  streak: { channel: "ui", notes: [{ f: 300, t: 0, d: 0.35, type: "sawtooth", g: 0.05, glide: 900 }], noise: { t: 0, d: 0.35, g: 0.06, hp: 1500 } },
  notify: { channel: "ui", notes: [{ f: 1046.5, t: 0, d: 0.12, type: "sine", g: 0.12 }, { f: 1567.98, t: 0.09, d: 0.2, type: "sine", g: 0.1 }] },
  whoosh: { channel: "ui", notes: [], noise: { t: 0, d: 0.28, g: 0.08, hp: 900 } },
};

class SoundBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private gains = new Map<AudioChannel, GainNode>();
  private duck = new Map<AudioChannel, number>();
  private active = 0;
  settings: BusSettings = structuredClone(DEFAULT_BUS_SETTINGS);

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      for (const ch of AUDIO_CHANNELS) {
        const g = this.ctx.createGain();
        g.connect(this.master);
        this.gains.set(ch, g);
      }
      this.apply();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  configure(next: Partial<BusSettings>) {
    this.settings = { ...this.settings, ...next, channels: { ...this.settings.channels, ...next.channels } };
    this.apply();
  }

  private apply() {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, now, 0.02);
    for (const ch of AUDIO_CHANNELS) {
      const ducked = (this.duck.get(ch) ?? 0) < 0 ? Math.pow(10, (this.duck.get(ch) ?? 0) / 20) : 1;
      this.gains.get(ch)?.gain.setTargetAtTime(this.settings.channels[ch] * ducked, now, 0.05);
    }
  }

  /** Lowers `target` while `trigger` is playing, per the DUCKING table. */
  private duckFor(trigger: AudioChannel, seconds: number) {
    for (const rule of DUCKING) {
      if (rule.trigger !== trigger) continue;
      this.duck.set(rule.target, rule.db);
      this.apply();
      window.setTimeout(() => {
        this.duck.set(rule.target, 0);
        this.apply();
      }, seconds * 1000);
    }
  }

  play(cue: Cue) {
    if (this.settings.muted) return;
    const ctx = this.ensure();
    if (!ctx || this.active >= MAX_SIMULTANEOUS_VOICES) return;
    const score = SCORES[cue];
    const out = this.gains.get(score.channel);
    if (!out) return;
    const t0 = ctx.currentTime + 0.005;
    let end = 0;
    for (const n of score.notes) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = n.type ?? "sine";
      osc.frequency.setValueAtTime(n.f, t0 + n.t);
      if (n.glide) osc.frequency.exponentialRampToValueAtTime(n.glide, t0 + n.t + n.d);
      g.gain.setValueAtTime(0.0001, t0 + n.t);
      g.gain.exponentialRampToValueAtTime(n.g ?? 0.1, t0 + n.t + Math.min(0.012, n.d / 3));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
      osc.connect(g).connect(out);
      osc.start(t0 + n.t);
      osc.stop(t0 + n.t + n.d + 0.02);
      end = Math.max(end, n.t + n.d);
    }
    if (score.noise) {
      const { t, d, g: gain, hp } = score.noise;
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * d), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = hp;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(filter).connect(g).connect(out);
      src.start(t0 + t);
      end = Math.max(end, t + d);
    }
    this.active++;
    window.setTimeout(() => (this.active = Math.max(0, this.active - 1)), end * 1000 + 60);
    if (score.channel === "alert" || score.channel === "voice") this.duckFor(score.channel, end + 0.3);
  }

  haptic(pattern: HapticPattern) {
    if (!this.settings.haptics || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    try {
      navigator.vibrate(HAPTICS[pattern]);
    } catch {
      // some browsers throw without a user gesture
    }
  }
}

/** The app-wide bus. Call sound.play("click") from anywhere. */
export const sound = new SoundBus();
