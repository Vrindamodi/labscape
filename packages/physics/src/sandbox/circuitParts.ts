import type { BoardPart } from "./CircuitSandbox";

/**
 * Electrical models of the playground-only parts. Each one maps onto a kind the core solver already
 * knows (see `toComponents`), so the scored labs' solver is untouched: a variable resistor, buzzer,
 * motor, LDR and thermistor are resistors with a computed value, a push button is a switch, and a
 * diode is the LED model with its own forward voltage.
 */

/** Sounds from `soundA`, loudly from `loudA`. */
export const BUZZER = { ohm: 40, soundA: 0.02, loudA: 0.05 } as const;
/** Turns from `startA`; speed is proportional to current. */
export const MOTOR = { ohm: 8, startA: 0.05, revPerSPerA: 3 } as const;
/** Needs `forwardV` to open, then adds almost no resistance. A real small diode overheats above `safeA`. */
export const DIODE = { forwardV: 0.7, onOhm: 0.1, safeA: 1 } as const;
/** Light level 0 % (dark) to 100 % (bright), on a log scale. */
export const LDR = { darkOhm: 10_000, brightOhm: 100 } as const;
/** NTC: falls exponentially from 0 °C to 100 °C. */
export const THERMISTOR = { ohm0C: 3000, ohm100C: 70 } as const;

/** Three significant figures, so the numbers a student reads are exactly the numbers the solver used. */
const sig3 = (x: number) => Number(x.toPrecision(3));
const frac = (v: number) => Math.max(0, Math.min(1, v / 100));

export const ldrOhms = (lightPct: number) => sig3(LDR.darkOhm * Math.pow(LDR.brightOhm / LDR.darkOhm, frac(lightPct)));
export const thermistorOhms = (tempC: number) => sig3(THERMISTOR.ohm0C * Math.pow(THERMISTOR.ohm100C / THERMISTOR.ohm0C, frac(tempC)));

/** Resistance (Ω) of a part that behaves as a plain resistor, or null for everything else. */
export function partOhms(p: Pick<BoardPart, "kind" | "value">): number | null {
  switch (p.kind) {
    case "resistor":
    case "bulb":
      return p.value ?? 10;
    case "dimmer":
      return Math.max(1, p.value ?? 20);
    case "buzzer":
      return BUZZER.ohm;
    case "motor":
      return MOTOR.ohm;
    case "ldr":
      return ldrOhms(p.value ?? 50);
    case "thermistor":
      return thermistorOhms(p.value ?? 25);
    default:
      return null;
  }
}

export type BuzzLevel = "silent" | "quiet" | "loud";
export function buzzLevel(amps: number): BuzzLevel {
  const a = Math.abs(amps);
  return a >= BUZZER.loudA ? "loud" : a >= BUZZER.soundA ? "quiet" : "silent";
}

/** Turns per second, signed: positive (clockwise) when current goes in at terminal a. 0 below the start current. */
export const motorRevPerS = (amps: number) => (Math.abs(amps) < MOTOR.startA ? 0 : amps * MOTOR.revPerSPerA);

export const ohmText = (ohm: number) => (ohm >= 1000 ? `${sig3(ohm / 1000)} kΩ` : `${sig3(ohm)} Ω`);
