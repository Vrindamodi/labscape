import type { CircuitResult } from "../core/circuit";
import { LED } from "../core/circuit";
import type { BoardPart, CircuitBuild } from "./CircuitSandbox";
import { BUZZER, buzzLevel, DIODE, MOTOR, motorRevPerS, ohmText, partOhms } from "./circuitParts";

/**
 * Plain-words explanations for the circuit builder (ages 12-16): what the circuit is doing right
 * now, and what just changed and why. Pure functions of the board and the solver's result.
 */

export type Tone = "good" | "info" | "warn" | "bad";
export type Line = { tone: Tone; text: string; ids?: string[] };
export type Story = { tone: Tone; title: string; body: string };
export type Solved = { build: CircuitBuild; result: CircuitResult & { fuseTrip?: Record<string, number> } };
export type EditAction =
  | { kind: "add" | "remove" | "rotate" | "replace-fuse"; id: string }
  | { kind: "switch"; id: string; closed: boolean }
  | { kind: "press"; id: string; down: boolean }
  | { kind: "value"; id: string; from: number; to: number }
  | { kind: "wire" | "unwire" | "move" | "example" | "clear" | "undo" | "redo" };

/** Nominal power that makes a bulb glow fully, W. */
export const BULB_FULL_W = 3;
/** Above this a real LED burns out without a resistor, A. */
const LED_SAFE_A = 0.03;

export const PART_INFO: Record<BoardPart["kind"], string> = {
  battery: "A battery pushes charge round a circuit. Its voltage (V) is how hard it pushes. The red end is + (positive).",
  bulb: "A bulb is a very thin wire that gets so hot it glows. The more power it gets (P = V × I), the brighter it glows.",
  resistor: "A resistor makes it harder for current to flow. More ohms (Ω) means less current for the same push. The coloured bands show its value.",
  switch: "A switch opens or closes a gap. Closed = joined, so current can flow. Open = a gap, so current stops on that path.",
  ammeter: "An ammeter measures current, in amps (A): how much charge flows through it each second. It must go in the loop (in series).",
  voltmeter: "A voltmeter measures voltage, in volts (V): the push between two points. It must go across a part (in parallel), not in the loop.",
  led: "An LED (light-emitting diode) is a light that only lets current through one way: in at its + leg (red dot), out at the other. It needs about 2 V to light.",
  fuse: "A fuse is a thin wire that melts if the current goes over its rating. That breaks the circuit and protects the wires from overheating.",
  dimmer: "A variable resistor is a resistor you can turn up or down. More ohms (Ω) means less current, so a bulb in the same loop gets dimmer. Dimmer switches and volume knobs work like this.",
  buzzer: `A buzzer makes a sound when enough current goes through it: at least ${BUZZER.soundA} A here. More current, louder buzz. It has a resistance of ${BUZZER.ohm} Ω. Doorbells and alarms use one.`,
  motor: `A motor turns electrical energy into movement. More current makes it spin faster, and current the other way makes it spin the other way. It has a resistance of ${MOTOR.ohm} Ω.`,
  ldr: "An LDR (light-dependent resistor) is a light sensor. In bright light it resists very little (about 100 Ω); in the dark it resists a lot (about 10 kΩ). Street lights use one to know when it is night.",
  thermistor: "A thermistor is a temperature sensor. The hotter it gets, the less it resists: about 3 kΩ at 0 °C but only 70 Ω at 100 °C. Fire alarms and thermostats use one.",
  button: "A push button is a switch with a spring. It joins the gap only while you hold it down; let go and it springs open again. A doorbell button works like this.",
  diode: `A diode is a one-way valve for current: in at its + leg (red dot), out at the other, and nothing the other way. It keeps about ${DIODE.forwardV} V of the push for itself. Unlike an LED it gives no light.`,
};

const NAME: Record<BoardPart["kind"], string> = { battery: "battery", bulb: "bulb", resistor: "resistor", switch: "switch", ammeter: "ammeter", voltmeter: "voltmeter", led: "LED", fuse: "fuse", dimmer: "variable resistor", buzzer: "buzzer", motor: "motor", ldr: "light sensor", thermistor: "thermistor", button: "push button", diode: "diode" };
const n = (x: number, k = 3) => (Number.isFinite(x) ? String(Number(x.toPrecision(k))) : "–");
const I = (r: CircuitResult, id: string) => Math.abs(r.components[id]?.current ?? 0);
const V = (r: CircuitResult, id: string) => Math.abs(r.components[id]?.voltage ?? 0);
const LIVE_A = 1e-4;
const LOADS: BoardPart["kind"][] = ["bulb", "resistor", "led", "dimmer", "buzzer", "motor", "ldr", "thermistor", "diode"];
const isLoad = (p: BoardPart) => LOADS.includes(p.kind);
/** LEDs and diodes: one-way valves that keep a fixed slice of the voltage. */
const isValve = (p: BoardPart) => p.kind === "led" || p.kind === "diode";
const valveV = (p: BoardPart) => (p.kind === "diode" ? DIODE.forwardV : LED.forwardV);
const valveName = (p: BoardPart) => (p.kind === "diode" ? "Diode" : "LED");
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** Phrases as one trailing sentence: " L1 lights up and BZ1 starts buzzing." */
const sentence = (xs: string[]) => (xs.length ? ` ${list(xs)}.` : "");

/**
 * True when an LED or diode really carries current. The solver's own `on` flag is also set for one
 * that sits at its forward voltage on a dead-end path (behind an open switch, say) with nothing flowing.
 */
export const conducting = (r: CircuitResult, id: string) => !!r.components[id]?.on && I(r, id) >= LIVE_A;

export function batteryCurrent(s: Solved): number {
  return s.build.parts.filter((p) => p.kind === "battery").reduce((m, p) => Math.max(m, I(s.result, p.id)), 0);
}

export function brightness(power: number): "bright" | "glowing" | "dim" | "off" {
  const f = power / BULB_FULL_W;
  return f > 0.6 ? "bright" : f > 0.2 ? "glowing" : f > 0.01 ? "dim" : "off";
}

/** LED voltage from + leg to - leg (negative = it is the wrong way round). */
const ledForward = (r: CircuitResult, id: string) => r.components[id]?.voltage ?? 0;

/** Parts on the board whose loose terminal stops them being in any loop. */
function looseParts(s: Solved): string[] {
  return [...new Set(s.result.floating.map((t) => t.split(".")[0]!))].filter((id) => s.build.parts.some((p) => p.id === id));
}

/** Walks conventional current from the + end of a battery. Stops where it splits. */
export function currentPath(s: Solved, batteryId: string): { order: string[]; splitInto: string[] | null; closed: boolean } {
  const { result: r, build } = s;
  const start = r.nodeOf[`${batteryId}.a`];
  const end = r.nodeOf[`${batteryId}.b`];
  const order: string[] = [];
  const seen = new Set<string>([batteryId]);
  let cur = start;
  for (let k = 0; k < 40 && cur !== undefined && cur !== end; k++) {
    // Current goes into a load at terminal a when its current is positive. A second battery that is
    // helping takes current in at its − end (b) and gives it out at +.
    const inAtA = (p: BoardPart) => (p.kind === "battery" ? r.components[p.id]!.current < 0 : r.components[p.id]!.current > 0);
    const next = build.parts.filter((p) => !seen.has(p.id) && I(r, p.id) >= LIVE_A && r.nodeOf[`${p.id}.${inAtA(p) ? "a" : "b"}`] === cur);
    if (next.length !== 1) return { order, splitInto: next.length > 1 ? next.map((p) => p.id) : null, closed: false };
    const p = next[0]!;
    seen.add(p.id);
    order.push(p.id);
    cur = r.nodeOf[`${p.id}.${inAtA(p) ? "b" : "a"}`];
  }
  return { order, splitInto: null, closed: cur === end };
}

/** Why no current flows, most useful reason first. */
function whyBroken(s: Solved): Line[] {
  const { build, result: r } = s;
  const out: Line[] = [];
  build.parts.filter((p) => p.kind === "switch" && !p.closed).forEach((p) => out.push({ tone: "warn", ids: [p.id], text: `Switch ${p.id} is open. That leaves a gap, and current cannot jump a gap. Tap the switch to close it.` }));
  build.parts.filter((p) => p.kind === "button" && !p.closed).forEach((p) => out.push({ tone: "warn", ids: [p.id], text: `Push button ${p.id} is not pressed. It only joins the gap while you hold it down: press and hold it.` }));
  build.parts.filter((p) => p.kind === "fuse" && p.blown).forEach((p) => out.push({ tone: "warn", ids: [p.id], text: `Fuse ${p.id} has melted, so its path has a gap. Select it and press "Replace the fuse".` }));
  r.voltmeterInSeries.forEach((id) => out.push({ tone: "warn", ids: [id], text: `Voltmeter ${id} is in the loop. A voltmeter has a huge resistance, so it blocks almost all the current. Put it across a part instead.` }));
  build.parts.filter((p) => isValve(p) && ledForward(r, p.id) < -0.05).forEach((p) => out.push({ tone: "warn", ids: [p.id], text: `${valveName(p)} ${p.id} is the wrong way round. It is a one-way valve and is blocking the current. Select it and press the flip button (or F) to turn it round.` }));
  build.parts.filter((p) => isValve(p) && !r.components[p.id]?.on && ledForward(r, p.id) > 0.05).forEach((p) => out.push({ tone: "warn", ids: [p.id], text: `${valveName(p)} ${p.id} is the right way round but only gets ${n(ledForward(r, p.id), 2)} V. It needs about ${valveV(p)} V before it lets any current through. Turn the battery voltage up.` }));
  const loose = looseParts(s);
  if (loose.length) out.push({ tone: "warn", ids: loose, text: `${list(loose)} ${loose.length > 1 ? "have" : "has"} a loose end that is not wired to anything. Every part needs a wire at both ends to be in a loop.` });
  if (!out.length) out.push({ tone: "info", text: "There is no complete loop from the + end of the battery back to its − end. Follow the wires with your finger: you must get back to where you started." });
  return out;
}

/** Everything the "What's happening" panel says about the board right now. */
export function explainCircuit(s: Solved): { headline: Line; lines: Line[] } {
  const { build, result: r } = s;
  const batteries = build.parts.filter((p) => p.kind === "battery");
  if (!build.parts.length) return { headline: { tone: "info", text: "The board is empty." }, lines: [{ tone: "info", text: "Try: add a battery and a bulb, then click a terminal on each to join them with wires into a loop." }] };
  if (!batteries.length) return { headline: { tone: "info", text: "No battery, so nothing happens." }, lines: [{ tone: "info", text: "A battery is what pushes the current round. Add one from the toolbar." }] };

  const lines: Line[] = [];
  if (r.shorted.length) {
    const b = r.shorted[0]!;
    lines.push({ tone: "bad", ids: r.shortPath, text: `A wire (or an ammeter) goes from the + end of ${b} back to its − end with almost nothing in the way. Current always takes the easiest path, so ${n(I(r, b))} A rushes through it.` });
    lines.push({ tone: "bad", text: "In real life the wires get hot enough to burn you and the battery drains in minutes. Remove the wire that skips past the parts." });
    return { headline: { tone: "bad", text: "Short circuit!" }, lines };
  }

  const Ibat = batteryCurrent(s);
  if (Ibat < LIVE_A) return { headline: { tone: "warn", text: "Broken circuit: no current flows." }, lines: whyBroken(s) };

  const liveBats = batteries.filter((p) => I(r, p.id) >= LIVE_A);
  const b = liveBats[0]!;
  // Batteries in one loop add their pushes (one that faces the other way, and is being driven backwards, takes its push away).
  const oneLoop = liveBats.every((p) => Math.abs(I(r, p.id) - Ibat) / Ibat < 0.02);
  const E = liveBats.reduce((a, p) => a + Math.sign(r.components[p.id]!.current) * (p.value ?? 6), 0);
  const path = currentPath(s, b.id);
  let pathText = `${b.id} (+) → ${path.order.join(" → ")}`;
  if (path.splitInto) pathText += `${path.order.length ? " → " : ""}then it splits between ${list(path.splitInto)}, and joins up again before returning to ${b.id} (−).`;
  else pathText += ` → back to ${b.id} (−).`;
  lines.push({ tone: "info", ids: path.order, text: `Current flows from the + end round to the − end: ${pathText} The moving dots show this.` });

  // Ohm's law with the real numbers. LEDs and diodes are not resistors: they take their slice of the voltage first.
  const many = liveBats.length > 1;
  const push = !many ? `The battery pushes with ${n(E)} V` : liveBats.every((p) => r.components[p.id]!.current > 0) ? `The batteries are joined + to −, so their pushes add up to ${n(E)} V,` : `The batteries push against each other, so the push left over is ${n(E)} V,`;
  const inside = `the parts plus about 0.2 Ω inside ${many ? "each" : "the"} battery`;
  const valves = build.parts.filter((p) => isValve(p) && conducting(r, p.id));
  const valveNames = list(valves.map((p) => `${NAME[p.kind]} ${p.id}`));
  if (!oneLoop) lines.push({ tone: "info", text: `The batteries here are not in one single loop, so one sum does not cover the whole board. The busiest battery supplies ${n(Ibat, 2)} A. Select a part to read its own current and voltage.` });
  else if (!valves.length) lines.push({ tone: "info", text: `Ohm's law: current = voltage ÷ resistance. ${push} and the whole loop resists with ${n(E / Ibat)} Ω (${inside}), so I = ${n(E)} ÷ ${n(E / Ibat)} = ${n(Ibat, 2)} A.` });
  else if (valves.every((p) => Math.abs(I(r, p.id) - Ibat) / Ibat < 0.02)) {
    const rest = E - valves.reduce((a, p) => a + V(r, p.id), 0);
    lines.push({ tone: "info", ids: valves.map((p) => p.id), text: `${push}${many ? "" : ","} but ${valveNames} ${valves.length > 1 ? "are not plain resistors: they keep" : "is not a plain resistor: it keeps"} ${n(E - rest)} V of that for ${valves.length > 1 ? "themselves" : "itself"}. The other ${n(rest)} V drives the current through the rest of the loop, which resists with ${n(rest / Ibat)} Ω (${inside}). Ohm's law: I = ${n(rest)} ÷ ${n(rest / Ibat)} = ${n(Ibat, 2)} A.` });
  } else lines.push({ tone: "info", ids: valves.map((p) => p.id), text: `${push}${many ? "" : ","} and ${n(Ibat, 2)} A flows round. ${valveNames.replace(/^d/, "D")} ${valves.length > 1 ? "are not plain resistors: each keeps" : "is not a plain resistor: it keeps"} a fixed slice of the voltage once current flows, so one I = V ÷ R sum does not cover this whole circuit. Look at each part's own voltage below.` });

  // Series or parallel.
  const loads = build.parts.filter((p) => isLoad(p) && I(r, p.id) >= LIVE_A);
  if (loads.length >= 2) {
    const same = loads.every((p) => Math.abs(I(r, p.id) - Ibat) / Ibat < 0.02);
    const pairKey = (p: BoardPart) => [r.nodeOf[`${p.id}.a`], r.nodeOf[`${p.id}.b`]].sort().join("-");
    const groups = new Map<string, BoardPart[]>();
    loads.forEach((p) => groups.set(pairKey(p), [...(groups.get(pairKey(p)) ?? []), p]));
    const par = [...groups.values()].find((g) => g.length > 1);
    if (same) lines.push({ tone: "info", ids: loads.map((p) => p.id), text: `Series: ${list(loads.map((p) => p.id))} are in one single loop. The same current (${n(Ibat, 2)} A) goes through each, and the battery's push is shared out: ${loads.map((p) => `${p.id} gets ${n(V(r, p.id), 2)} V`).join(", ")}. More parts in series = more resistance = less current.` });
    else if (par) {
      const sum = par.reduce((a, p) => a + I(r, p.id), 0);
      lines.push({ tone: "info", ids: par.map((p) => p.id), text: `Parallel: ${list(par.map((p) => p.id))} each have their own branch between the same two points. Each branch gets the full ${n(V(r, par[0]!.id), 2)} V, and the branch currents add up: ${par.map((p) => n(I(r, p.id), 2)).join(" + ")} = ${n(sum, 2)} A. If one branch breaks, the others keep working.` });
    } else lines.push({ tone: "info", text: "Mixed: some parts are in series (one after another) and some are in parallel (side by side)." });
  }

  for (const p of build.parts) {
    const c = r.components[p.id];
    if (!c) continue;
    if (r.bypassed.includes(p.id)) {
      lines.push({ tone: "warn", ids: [p.id], text: `${p.id} carries no current: a wire joins both of its ends, so the current takes that easy path round it instead (it is "bypassed"). Remove that wire to put ${p.id} back in the loop.` });
      continue;
    }
    if (p.kind === "bulb") {
      const lvl = brightness(Math.abs(c.power));
      if (lvl === "off") lines.push({ tone: "info", ids: [p.id], text: `${p.id} is off: ${I(r, p.id) < LIVE_A ? "no current goes through it, because it is not on a complete loop." : "the current through it is too small to make it glow."}` });
      else lines.push({ tone: "good", ids: [p.id], text: `${p.id} is ${lvl}: power = voltage × current = ${n(V(r, p.id), 2)} V × ${n(I(r, p.id), 2)} A = ${n(Math.abs(c.power), 2)} W. More power, brighter bulb.` });
    }
    if (p.kind === "led") {
      const f = ledForward(r, p.id);
      if (conducting(r, p.id)) {
        lines.push({ tone: "good", ids: [p.id], text: `LED ${p.id} is lit: current goes in at its + leg and out of the other, the only way an LED allows.` });
        if (I(r, p.id) > LED_SAFE_A) lines.push({ tone: "warn", ids: [p.id], text: `${n(I(r, p.id), 2)} A is going through ${p.id}. A real LED burns out above about 0.03 A: put a resistor in series with it to limit the current.` });
      } else if (f < -0.05) lines.push({ tone: "warn", ids: [p.id], text: `LED ${p.id} is the wrong way round, so it blocks the current like a closed door. Select it and press the flip button (or F) to turn it round.` });
      else if (!c.on && f > 0.05) lines.push({ tone: "info", ids: [p.id], text: `LED ${p.id} is the right way round but only gets ${n(f, 2)} V. An LED needs about ${LED.forwardV} V before it lets current through and lights.` });
    }
    if (p.kind === "diode") {
      const f = ledForward(r, p.id);
      if (conducting(r, p.id)) {
        lines.push({ tone: "good", ids: [p.id], text: `Diode ${p.id} is letting current through: ${n(I(r, p.id), 2)} A goes in at its + leg and out of the other. It keeps ${n(f, 2)} V of the push for itself.` });
        if (I(r, p.id) > DIODE.safeA) lines.push({ tone: "warn", ids: [p.id], text: `${n(I(r, p.id), 2)} A is a lot for a small diode: a real one overheats above about ${DIODE.safeA} A. Put a bulb or a resistor in the same loop to limit the current.` });
      } else if (f < -0.05) lines.push({ tone: "info", ids: [p.id], text: `Diode ${p.id} is blocking: the current is trying to go through it backwards, and a diode only lets current through one way. Select it and press the flip button (or F) to turn it round.` });
      else if (!c.on && f > 0.05) lines.push({ tone: "info", ids: [p.id], text: `Diode ${p.id} is the right way round but only gets ${n(f, 2)} V. A diode needs about ${DIODE.forwardV} V before it lets current through.` });
    }
    if (p.kind === "dimmer" && I(r, p.id) >= LIVE_A) {
      // What it controls: the first bulb, motor or buzzer that carries the same current.
      const mate = build.parts.find((o) => (o.kind === "bulb" || o.kind === "motor" || o.kind === "buzzer") && I(r, o.id) >= LIVE_A && Math.abs(I(r, o.id) - I(r, p.id)) / I(r, p.id) < 0.02);
      const [less, more] = !mate ? ["", ""] : mate.kind === "bulb" ? [`, so ${mate.id} gets dimmer`, `, so ${mate.id} gets brighter`] : mate.kind === "motor" ? [`, so ${mate.id} slows down`, `, so ${mate.id} speeds up`] : [`, so ${mate.id} gets quieter`, `, so ${mate.id} gets louder`];
      lines.push({ tone: "info", ids: mate ? [p.id, mate.id] : [p.id], text: `Variable resistor ${p.id} is set to ${n(partOhms(p)!)} Ω and takes ${n(V(r, p.id), 2)} V of the battery's push for itself. Turn it up and less current flows${less}. Turn it down and more current flows${more}.` });
    }
    if (p.kind === "buzzer") {
      const lvl = buzzLevel(c.current);
      if (lvl !== "silent") lines.push({ tone: "good", ids: [p.id], text: `Buzzer ${p.id} is buzzing ${lvl === "loud" ? "loudly" : "quietly"}: ${n(I(r, p.id), 2)} A goes through it, and it sounds from ${BUZZER.soundA} A up. More current, louder buzz.` });
      else lines.push({ tone: "info", ids: [p.id], text: `Buzzer ${p.id} is silent: ${I(r, p.id) < LIVE_A ? "no current goes through it, because it is not on a complete loop." : `only ${n(I(r, p.id), 2)} A goes through it, and it needs at least ${BUZZER.soundA} A to make a sound.`}` });
    }
    if (p.kind === "motor") {
      const rev = motorRevPerS(c.current);
      if (rev !== 0) lines.push({ tone: "good", ids: [p.id], text: `Motor ${p.id} spins ${rev > 0 ? "clockwise" : "anticlockwise"} at about ${n(Math.abs(rev), 2)} turns a second: ${n(I(r, p.id), 2)} A goes through it. More current, faster spin. Send the current through it the other way (flip the battery) and it spins the other way.` });
      else lines.push({ tone: "info", ids: [p.id], text: `Motor ${p.id} is not turning: ${I(r, p.id) < LIVE_A ? "no current goes through it, because it is not on a complete loop." : `${n(I(r, p.id), 2)} A is too little to get it moving. It needs about ${MOTOR.startA} A.`}` });
    }
    if (p.kind === "ldr" || p.kind === "thermistor") {
      const live = I(r, p.id) >= LIVE_A;
      // An LED wired across a sensor is switched by the sensor's share of the voltage (a night light, a frost warning).
      const na = r.nodeOf[`${p.id}.a`], nb = r.nodeOf[`${p.id}.b`];
      const led = live ? build.parts.find((o) => o.kind === "led" && ((r.nodeOf[`${o.id}.a`] === na && r.nodeOf[`${o.id}.b`] === nb) || (r.nodeOf[`${o.id}.a`] === nb && r.nodeOf[`${o.id}.b`] === na))) : undefined;
      const why = led ? ` LED ${led.id} is wired across it, so the LED gets that same voltage and needs about ${LED.forwardV} V to light. That is why it comes on as it gets ${p.kind === "ldr" ? "darker" : "colder"}.` : "";
      if (p.kind === "ldr") {
        const light = p.value ?? 50;
        lines.push({ tone: "info", ids: led ? [p.id, led.id] : [p.id], text: `Light sensor ${p.id} is in ${light < 34 ? "the dark" : light < 67 ? "dim light" : "bright light"} (${light} %), so its resistance is ${ohmText(partOhms(p)!)}. The darker it gets, the more it resists.${live ? ` It has ${n(V(r, p.id), 2)} V across it: the more it resists, the bigger its share of the battery's push.` : ""}${why}` });
      } else lines.push({ tone: "info", ids: led ? [p.id, led.id] : [p.id], text: `Thermistor ${p.id} is at ${p.value ?? 25} °C, so its resistance is ${ohmText(partOhms(p)!)}. The hotter it gets, the less it resists, so more current can flow.${live ? ` It has ${n(V(r, p.id), 2)} V across it${led ? ": the more it resists, the bigger its share of the battery's push" : ""}.` : ""}${why}` });
    }
    if (p.kind === "button") {
      if (p.closed) lines.push({ tone: "good", ids: [p.id], text: `Push button ${p.id} is held down, so its gap is joined and current can cross. Let go and it springs open again.` });
      else lines.push({ tone: "info", ids: [p.id], text: `Push button ${p.id} is not pressed, so its path has a gap. Press and hold it to let current through.` });
    }
    if (p.kind === "ammeter") {
      if (r.ammeterAcross.includes(p.id)) lines.push({ tone: "warn", ids: [p.id], text: `Ammeter ${p.id} is across a part (in parallel). It has almost no resistance, so current floods through it instead of the part. Ammeters go in the loop, in series.` });
      else lines.push({ tone: "info", ids: [p.id], text: `Ammeter ${p.id} reads ${n(I(r, p.id))} A: the current flowing through it. In a series loop the current is the same everywhere, so every part in that loop has this current too.` });
    }
    if (p.kind === "voltmeter") {
      const na = r.nodeOf[`${p.id}.a`], nb = r.nodeOf[`${p.id}.b`];
      const across = build.parts.find((o) => o.id !== p.id && o.kind !== "voltmeter" && ((r.nodeOf[`${o.id}.a`] === na && r.nodeOf[`${o.id}.b`] === nb) || (r.nodeOf[`${o.id}.a`] === nb && r.nodeOf[`${o.id}.b`] === na)));
      if (r.voltmeterInSeries.includes(p.id)) lines.push({ tone: "warn", ids: [p.id], text: `Voltmeter ${p.id} is in the loop (in series). Its huge resistance starves the circuit. Connect it across a part instead.` });
      else if (across) lines.push({ tone: "info", ids: [p.id, across.id], text: `Voltmeter ${p.id} reads ${n(V(r, p.id))} V: the push used up by ${across.kind === "battery" ? `the whole circuit (it is across ${across.id})` : `${NAME[across.kind]} ${across.id}`}.` });
      else if (!r.floating.some((t) => t.startsWith(`${p.id}.`))) lines.push({ tone: "info", ids: [p.id], text: `Voltmeter ${p.id} reads ${n(V(r, p.id))} V between the two points it touches.` });
    }
    if (p.kind === "fuse" && !p.blown) {
      const rating = p.value ?? 1;
      const frac = I(r, p.id) / rating;
      if (frac > 0.8) lines.push({ tone: "warn", ids: [p.id], text: `Fuse ${p.id} carries ${n(I(r, p.id), 2)} A, close to its ${rating} A rating. A little more current and it melts.` });
      else if (I(r, p.id) >= LIVE_A) lines.push({ tone: "good", ids: [p.id], text: `Fuse ${p.id} is fine: ${n(I(r, p.id), 2)} A is below its ${rating} A rating.` });
    }
  }
  const loose = looseParts(s).filter((id) => I(r, id) < LIVE_A);
  if (loose.length) lines.push({ tone: "info", ids: loose, text: `${list(loose)} ${loose.length > 1 ? "have" : "has"} a loose end, so ${loose.length > 1 ? "they are" : "it is"} not part of any loop and ${loose.length > 1 ? "carry" : "carries"} no current.` });
  return { headline: { tone: "good", text: `Complete circuit: ${n(Ibat, 2)} A flows.` }, lines };
}

/** Bulbs and LEDs giving light. */
const litIds = (s: Solved) => s.build.parts.filter((p) => (p.kind === "bulb" && brightness(Math.abs(s.result.components[p.id]?.power ?? 0)) !== "off") || (p.kind === "led" && conducting(s.result, p.id))).map((p) => p.id);

/**
 * What a student would see or hear change between two boards, as short phrases: things that came
 * on ("L1 lights up"), went off ("BZ1 goes quiet") or shifted ("M1 spins faster").
 */
function effects(prev: Solved, next: Solved): { on: string[]; off: string[]; shift: string[]; reversed: string[] } {
  const on: string[] = [], off: string[] = [], shift: string[] = [];
  const amps = (s: Solved, id: string) => s.result.components[id]?.current ?? 0;
  const power = (s: Solved, id: string) => Math.abs(s.result.components[id]?.power ?? 0);
  const still = (ids: string[]) => ids.filter((id) => next.build.parts.some((p) => p.id === id));
  const say = (out: string[], ids: string[], one: string, many: string) => ids.length && out.push(`${list(ids)} ${ids.length > 1 ? many : one}`);
  const of = (s: Solved, kind: BoardPart["kind"], test: (id: string) => boolean) => s.build.parts.filter((p) => p.kind === kind && test(p.id)).map((p) => p.id);
  const changed = (a: number, b: number) => Math.abs(b - a) > 0.02 * Math.max(Math.abs(a), Math.abs(b));

  const lit0 = litIds(prev), lit1 = litIds(next);
  say(on, lit1.filter((id) => !lit0.includes(id)), "lights up", "light up");
  say(off, still(lit0).filter((id) => !lit1.includes(id)), "goes out", "go out");
  const bulbs = of(next, "bulb", (id) => lit0.includes(id) && lit1.includes(id) && changed(power(prev, id), power(next, id)));
  say(shift, bulbs.filter((id) => power(next, id) > power(prev, id)), "gets brighter", "get brighter");
  say(shift, bulbs.filter((id) => power(next, id) < power(prev, id)), "gets dimmer", "get dimmer");

  const buzz0 = of(prev, "buzzer", (id) => buzzLevel(amps(prev, id)) !== "silent"), buzz1 = of(next, "buzzer", (id) => buzzLevel(amps(next, id)) !== "silent");
  say(on, buzz1.filter((id) => !buzz0.includes(id)), "starts buzzing", "start buzzing");
  say(off, still(buzz0).filter((id) => !buzz1.includes(id)), "goes quiet", "go quiet");
  const both = buzz1.filter((id) => buzz0.includes(id) && changed(amps(prev, id), amps(next, id)));
  say(shift, both.filter((id) => Math.abs(amps(next, id)) > Math.abs(amps(prev, id))), "gets louder", "get louder");
  say(shift, both.filter((id) => Math.abs(amps(next, id)) < Math.abs(amps(prev, id))), "gets quieter", "get quieter");

  const spin0 = of(prev, "motor", (id) => motorRevPerS(amps(prev, id)) !== 0), spin1 = of(next, "motor", (id) => motorRevPerS(amps(next, id)) !== 0);
  say(on, spin1.filter((id) => !spin0.includes(id)), "starts spinning", "start spinning");
  say(off, still(spin0).filter((id) => !spin1.includes(id)), "stops", "stop");
  const turning = spin1.filter((id) => spin0.includes(id) && changed(amps(prev, id), amps(next, id)));
  const swapped = turning.filter((id) => amps(prev, id) * amps(next, id) < 0);
  say(shift, swapped, "now spins the other way", "now spin the other way");
  say(shift, turning.filter((id) => !swapped.includes(id) && Math.abs(amps(next, id)) > Math.abs(amps(prev, id))), "spins faster", "spin faster");
  say(shift, turning.filter((id) => !swapped.includes(id) && Math.abs(amps(next, id)) < Math.abs(amps(prev, id))), "slows down", "slow down");
  return { on, off, shift, reversed: swapped };
}

/** A short card about what an edit just did, or null when there is nothing worth saying. */
export function storyOf(prev: Solved, next: Solved, action: EditAction): Story | null {
  const pr = prev.result, nr = next.result;
  const head = () => explainCircuit(next).headline.text;
  if (action.kind === "undo" || action.kind === "redo") return { tone: "info", title: action.kind === "undo" ? "Undone" : "Redone", body: `${action.kind === "undo" ? "Went back one step" : "Went forward one step"}. ${head()}` };
  if (action.kind === "clear") return null;

  // Fuses that blew because of this edit (even mid-drag of a slider).
  const blown = Object.keys(next.result.fuseTrip ?? {});
  if (action.kind === "move" && !blown.length) return null;
  if (action.kind === "example" && !blown.length) return { tone: "info", title: "Example loaded", body: `${head()} Read "What's happening" to see why.` };
  if (blown.length) {
    const id = blown[0]!;
    const rating = next.build.parts.find((p) => p.id === id)?.value ?? 1;
    return { tone: "bad", title: `Fuse ${id} melted!`, body: `${n(next.result.fuseTrip![id]!, 2)} A tried to flow, but ${id} is rated ${rating} A. Its thin wire got hot and melted, leaving a gap, so the current stopped. That is a fuse's job: it protects the wires from overheating. Fix the cause (more resistance, or fewer parallel paths), then replace the fuse.` };
  }
  if (nr.shorted.length && !pr.shorted.length) return { tone: "bad", title: "Short circuit!", body: `Current found a path from + to − with almost no resistance, so a huge ${n(batteryCurrent(next), 2)} A flows. Real wires would get dangerously hot. Remove the wire that skips past the parts.` };
  if (!nr.shorted.length && pr.shorted.length) return { tone: "good", title: "Short circuit gone", body: `${head()} The current now has to go through the parts, which limit it.` };

  const I0 = batteryCurrent(prev), I1 = batteryCurrent(next);
  const on0 = I0 >= LIVE_A, on1 = I1 >= LIVE_A;
  const fx = effects(prev, next);
  const litNow = litIds(next).filter((id) => !litIds(prev).includes(id));
  const updown = () => `Battery current went ${I1 > I0 ? "up" : "down"} from ${n(I0, 2)} A to ${n(I1, 2)} A.`;
  const steady = !on0 || Math.abs(I1 - I0) / I0 < 0.02;

  if (action.kind === "switch") {
    if (action.closed) {
      if (on1) return { tone: "good", title: `${action.id} closed`, body: `The gap is joined, so the loop is complete and ${n(I1, 2)} A flows.${sentence(fx.on)}` };
      return { tone: "warn", title: `${action.id} closed, but nothing happens`, body: whyBroken(next)[0]!.text };
    }
    if (!on1) return { tone: "info", title: `${action.id} opened`, body: `Opening the switch makes a gap. Current stops everywhere on that loop${fx.off.length ? `, so ${list(fx.off)}` : ""}. In a series circuit one switch controls everything.` };
    return { tone: "info", title: `${action.id} opened`, body: `That branch stops${fx.off.length ? ` (${list(fx.off)})` : ""}, but current still flows (${n(I1, 2)} A) through paths that do not go through ${action.id}. That is how the separate light switches in a house work.` };
  }

  if (action.kind === "press") {
    if (action.down) {
      if (on1) return { tone: "good", title: `${action.id} pressed`, body: `Holding the button down joins the gap, so ${on0 ? "its path" : "the loop"} is complete and ${n(I1, 2)} A flows.${sentence(fx.on)} Let go and it springs open again.` };
      return { tone: "warn", title: `${action.id} pressed, but nothing happens`, body: whyBroken(next)[0]!.text };
    }
    if (!on1) return { tone: "info", title: `${action.id} released`, body: `The button springs back and leaves a gap, so the current stops${fx.off.length ? ` and ${list(fx.off)}` : ""}. A push button is only on while you hold it, which is just what a doorbell needs.` };
    return { tone: "info", title: `${action.id} released`, body: `Its path has a gap again${fx.off.length ? ` (${list(fx.off)})` : ""}, but current still flows (${n(I1, 2)} A) through paths that do not go through ${action.id}.` };
  }

  // The variable resistor and the two sensors: say what the slider did to the part, then what that did to the circuit.
  const tuned = action.kind === "value" ? next.build.parts.find((q) => q.id === action.id && (q.kind === "dimmer" || q.kind === "ldr" || q.kind === "thermistor")) : undefined;
  if (tuned && action.kind === "value") {
    const R0 = partOhms({ kind: tuned.kind, value: action.from })!, R1 = partOhms(tuned)!;
    const seen = sentence([...fx.on, ...fx.off, ...fx.shift]);
    const loop = !on1 ? " It is not on a complete loop yet, so nothing else changes." : `${steady ? "" : ` ${updown()}`}${seen}`;
    if (tuned.kind === "dimmer") return { tone: "info", title: `${tuned.id}: ${action.to} Ω`, body: `${R1 > R0 ? "More resistance makes it harder for current to flow, so less flows" : "Less resistance makes it easier for current to flow, so more flows"} (I = V ÷ R).${loop}` };
    const share = on1 ? ` It now has ${n(V(nr, tuned.id), 2)} V across it (it had ${n(V(pr, tuned.id), 2)} V).` : "";
    if (tuned.kind === "ldr") return { tone: "info", title: `${tuned.id}: ${action.to} % light`, body: `${action.to < action.from ? "Less" : "More"} light falls on it, so its resistance ${R1 > R0 ? "rises" : "falls"} from ${ohmText(R0)} to ${ohmText(R1)}.${share}${loop}` };
    return { tone: "info", title: `${tuned.id}: ${action.to} °C`, body: `It is ${action.to > action.from ? "hotter" : "cooler"}, so its resistance ${R1 > R0 ? "rises" : "falls"} from ${ohmText(R0)} to ${ohmText(R1)}.${share}${loop}` };
  }

  // A reversed LED is worth its own card.
  const flipped = next.build.parts.find((p) => isValve(p) && ledForward(nr, p.id) < -0.05 && !(ledForward(pr, p.id) < -0.05));
  if (flipped?.kind === "led") return { tone: "warn", title: `${flipped.id} is the wrong way round`, body: "An LED only lets current through one way: in at its + leg (red dot). Backwards it blocks the current, so it stays dark. Select it and press the flip button (or F) to turn it round." };
  if (flipped) return { tone: "info", title: `${flipped.id} is blocking`, body: `A diode is a one-way valve: current can only go in at its + leg (red dot). Here the current is trying to go through it backwards, so the diode stops it${fx.off.length ? ` and ${list(fx.off)}` : ""}. Select it and press the flip button (or F) to turn it round.` };
  const ledOn = litNow.find((id) => next.build.parts.some((p) => p.id === id && p.kind === "led"));
  if (ledOn) return { tone: "good", title: `${ledOn} lights up`, body: "Current now goes in at the LED's + leg and out of the other, the only direction an LED allows, and it gets more than the 2 V it needs." };

  if (fx.reversed.length) return { tone: "info", title: `${list(fx.reversed)} ${fx.reversed.length > 1 ? "spin" : "spins"} the other way`, body: "The current now goes through the motor in the opposite direction, so it pushes the rotor round the other way. That is how a toy car goes into reverse." };

  const newBypass = nr.bypassed.filter((id) => !pr.bypassed.includes(id));
  if (newBypass.length) return { tone: "warn", title: `${list(newBypass)} bypassed`, body: `A wire now joins both ends of ${list(newBypass)}, so current goes round through the wire (the easy path) and ${list(newBypass)} gets none.` };

  if (action.kind === "replace-fuse") return { tone: "good", title: "New fuse fitted", body: on1 ? `Current flows again: ${n(I1, 2)} A, below the rating.` : head() };
  if (on1 && !on0) return { tone: "good", title: "Loop complete!", body: `There is now an unbroken path from + to −, so ${n(I1, 2)} A flows.${sentence(fx.on)}` };
  if (!on1 && on0) return { tone: "warn", title: "Circuit broken", body: `The current stopped. ${whyBroken(next)[0]!.text}` };
  if (!on1) return null;

  if (steady) return action.kind === "add" ? { tone: "info", title: `${action.id} added`, body: `${PART_INFO[next.build.parts.find((p) => p.id === action.id)!.kind]} It is not wired in yet: click its terminals to connect it.` } : null;
  if (action.kind === "value") {
    const p = next.build.parts.find((q) => q.id === action.id);
    if (p?.kind === "battery") return { tone: "info", title: `${p.id}: ${action.to} V`, body: `${updown()} A ${action.to > action.from ? "bigger" : "smaller"} push drives ${action.to > action.from ? "more" : "less"} current through the same resistance (I = V ÷ R).` };
    if (p && (p.kind === "bulb" || p.kind === "resistor")) return { tone: "info", title: `${p.id}: ${action.to} Ω`, body: `${updown()} ${action.to > action.from ? "More resistance makes it harder for current to flow, so less flows" : "Less resistance makes it easier for current to flow, so more flows"} (I = V ÷ R).` };
  }
  // A part newly in the loop: series or parallel?
  const joined = next.build.parts.filter((p) => isLoad(p) && I(nr, p.id) >= LIVE_A && I(pr, p.id) < LIVE_A);
  if (joined.length === 1) {
    const p = joined[0]!;
    if (Math.abs(I(nr, p.id) - I1) / I1 < 0.02) return { tone: "info", title: `${p.id} is in series`, body: `${updown()} ${p.id} is in the same single loop, so the current must go through it too. That adds resistance, so less current flows and the other parts get ${I1 < I0 ? "dimmer" : "a smaller share"}.` };
    return { tone: "info", title: `${p.id} is in parallel`, body: `${updown()} ${p.id} has its own branch, so it gets the full voltage. The battery now supplies extra current for the new branch: branch currents add up.` };
  }
  return { tone: "info", title: I1 > I0 ? "More current" : "Less current", body: `${updown()} ${I1 > I0 ? "The loop now has less total resistance (or a new parallel path)." : "The loop now has more total resistance (or one path fewer)."}` };
}
