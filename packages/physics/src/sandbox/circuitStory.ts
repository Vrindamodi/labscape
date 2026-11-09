import type { CircuitResult } from "../core/circuit";
import { LED } from "../core/circuit";
import type { BoardPart, CircuitBuild } from "./CircuitSandbox";

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
};

const NAME: Record<BoardPart["kind"], string> = { battery: "battery", bulb: "bulb", resistor: "resistor", switch: "switch", ammeter: "ammeter", voltmeter: "voltmeter", led: "LED", fuse: "fuse" };
const n = (x: number, k = 3) => (Number.isFinite(x) ? String(Number(x.toPrecision(k))) : "–");
const I = (r: CircuitResult, id: string) => Math.abs(r.components[id]?.current ?? 0);
const V = (r: CircuitResult, id: string) => Math.abs(r.components[id]?.voltage ?? 0);
const LIVE_A = 1e-4;
const isLoad = (p: BoardPart) => p.kind === "bulb" || p.kind === "resistor" || p.kind === "led";
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

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
    const next = build.parts.filter((p) => {
      if (seen.has(p.id) || p.kind === "battery" || I(r, p.id) < LIVE_A) return false;
      const c = r.components[p.id]!;
      const entry = c.current > 0 ? r.nodeOf[`${p.id}.a`] : r.nodeOf[`${p.id}.b`];
      return entry === cur;
    });
    if (next.length !== 1) return { order, splitInto: next.length > 1 ? next.map((p) => p.id) : null, closed: false };
    const p = next[0]!;
    seen.add(p.id);
    order.push(p.id);
    cur = r.components[p.id]!.current > 0 ? r.nodeOf[`${p.id}.b`] : r.nodeOf[`${p.id}.a`];
  }
  return { order, splitInto: null, closed: cur === end };
}

/** Why no current flows, most useful reason first. */
function whyBroken(s: Solved): Line[] {
  const { build, result: r } = s;
  const out: Line[] = [];
  build.parts.filter((p) => p.kind === "switch" && !p.closed).forEach((p) => out.push({ tone: "warn", ids: [p.id], text: `Switch ${p.id} is open. That leaves a gap, and current cannot jump a gap. Tap the switch to close it.` }));
  build.parts.filter((p) => p.kind === "fuse" && p.blown).forEach((p) => out.push({ tone: "warn", ids: [p.id], text: `Fuse ${p.id} has melted, so its path has a gap. Select it and press "Replace the fuse".` }));
  r.voltmeterInSeries.forEach((id) => out.push({ tone: "warn", ids: [id], text: `Voltmeter ${id} is in the loop. A voltmeter has a huge resistance, so it blocks almost all the current. Put it across a part instead.` }));
  build.parts.filter((p) => p.kind === "led" && ledForward(r, p.id) < -0.05).forEach((p) => out.push({ tone: "warn", ids: [p.id], text: `LED ${p.id} is the wrong way round. It is a one-way valve and is blocking the current. Rotate it twice to flip it.` }));
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

  const b = batteries.find((p) => I(r, p.id) >= LIVE_A)!;
  const E = b.value ?? 6;
  const path = currentPath(s, b.id);
  let pathText = `${b.id} (+) → ${path.order.join(" → ")}`;
  if (path.splitInto) pathText += `${path.order.length ? " → " : ""}then it splits between ${list(path.splitInto)}, and joins up again before returning to ${b.id} (−).`;
  else pathText += ` → back to ${b.id} (−).`;
  lines.push({ tone: "info", ids: path.order, text: `Current flows from the + end round to the − end: ${pathText} The moving dots show this.` });

  // Ohm's law with the real numbers.
  const Rtot = E / Ibat;
  lines.push({ tone: "info", text: `Ohm's law: current = voltage ÷ resistance. The battery pushes with ${n(E)} V and the whole loop resists with ${n(Rtot)} Ω (the parts plus about 0.2 Ω inside the battery), so I = ${n(E)} ÷ ${n(Rtot)} = ${n(Ibat, 2)} A.` });

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
      if (c.on) {
        lines.push({ tone: "good", ids: [p.id], text: `LED ${p.id} is lit: current goes in at its + leg and out of the other, the only way an LED allows.` });
        if (I(r, p.id) > LED_SAFE_A) lines.push({ tone: "warn", ids: [p.id], text: `${n(I(r, p.id), 2)} A is going through ${p.id}. A real LED burns out above about 0.03 A: put a resistor in series with it to limit the current.` });
      } else if (f < -0.05) lines.push({ tone: "warn", ids: [p.id], text: `LED ${p.id} is the wrong way round, so it blocks the current like a closed door. Rotate it twice to flip it.` });
      else if (f > 0.05) lines.push({ tone: "info", ids: [p.id], text: `LED ${p.id} is the right way round but only gets ${n(f, 2)} V. An LED needs about ${LED.forwardV} V before it lets current through and lights.` });
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
  const lit = (s: Solved) => s.build.parts.filter((p) => (p.kind === "bulb" && brightness(Math.abs(s.result.components[p.id]?.power ?? 0)) !== "off") || (p.kind === "led" && s.result.components[p.id]?.on)).map((p) => p.id);
  const litNow = lit(next).filter((id) => !lit(prev).includes(id));
  const outNow = lit(prev).filter((id) => next.build.parts.some((p) => p.id === id) && !lit(next).includes(id));

  if (action.kind === "switch") {
    if (action.closed) {
      if (on1) return { tone: "good", title: `${action.id} closed`, body: `The gap is joined, so the loop is complete and ${n(I1, 2)} A flows.${litNow.length ? ` ${list(litNow)} ${litNow.length > 1 ? "light" : "lights"} up.` : ""}` };
      return { tone: "warn", title: `${action.id} closed, but nothing happens`, body: whyBroken(next)[0]!.text };
    }
    if (!on1) return { tone: "info", title: `${action.id} opened`, body: `Opening the switch makes a gap. Current stops everywhere on that loop${outNow.length ? `, so ${list(outNow)} ${outNow.length > 1 ? "go" : "goes"} out` : ""}. In a series circuit one switch controls everything.` };
    return { tone: "info", title: `${action.id} opened`, body: `That branch stops${outNow.length ? ` (${list(outNow)} ${outNow.length > 1 ? "go" : "goes"} out)` : ""}, but current still flows (${n(I1, 2)} A) through paths that do not go through ${action.id}. That is how the separate light switches in a house work.` };
  }

  // A reversed LED is worth its own card.
  const flipped = next.build.parts.find((p) => p.kind === "led" && ledForward(nr, p.id) < -0.05 && !(ledForward(pr, p.id) < -0.05));
  if (flipped) return { tone: "warn", title: `${flipped.id} is the wrong way round`, body: "An LED only lets current through one way: in at its + leg (red dot). Backwards it blocks the current, so it stays dark. Rotate it twice to flip it." };
  const ledOn = litNow.find((id) => id.startsWith("D"));
  if (ledOn) return { tone: "good", title: `${ledOn} lights up`, body: "Current now goes in at the LED's + leg and out of the other, the only direction an LED allows, and it gets more than the 2 V it needs." };

  const newBypass = nr.bypassed.filter((id) => !pr.bypassed.includes(id));
  if (newBypass.length) return { tone: "warn", title: `${list(newBypass)} bypassed`, body: `A wire now joins both ends of ${list(newBypass)}, so current goes round through the wire (the easy path) and ${list(newBypass)} gets none.` };

  if (action.kind === "replace-fuse") return { tone: "good", title: "New fuse fitted", body: on1 ? `Current flows again: ${n(I1, 2)} A, below the rating.` : head() };
  if (on1 && !on0) return { tone: "good", title: "Loop complete!", body: `There is now an unbroken path from + to −, so ${n(I1, 2)} A flows.${litNow.length ? ` ${list(litNow)} ${litNow.length > 1 ? "light" : "lights"} up.` : ""}` };
  if (!on1 && on0) return { tone: "warn", title: "Circuit broken", body: `The current stopped. ${whyBroken(next)[0]!.text}` };
  if (!on1) return null;

  const change = (I1 - I0) / I0;
  if (Math.abs(change) < 0.02) return action.kind === "add" ? { tone: "info", title: `${action.id} added`, body: `${PART_INFO[next.build.parts.find((p) => p.id === action.id)!.kind]} It is not wired in yet: click its terminals to connect it.` } : null;
  const updown = `Battery current went ${I1 > I0 ? "up" : "down"} from ${n(I0, 2)} A to ${n(I1, 2)} A.`;
  if (action.kind === "value") {
    const p = next.build.parts.find((q) => q.id === action.id);
    if (p?.kind === "battery") return { tone: "info", title: `${p.id}: ${action.to} V`, body: `${updown} A ${action.to > action.from ? "bigger" : "smaller"} push drives ${action.to > action.from ? "more" : "less"} current through the same resistance (I = V ÷ R).` };
    if (p && (p.kind === "bulb" || p.kind === "resistor")) return { tone: "info", title: `${p.id}: ${action.to} Ω`, body: `${updown} ${action.to > action.from ? "More resistance makes it harder for current to flow, so less flows" : "Less resistance makes it easier for current to flow, so more flows"} (I = V ÷ R).` };
  }
  // A part newly in the loop: series or parallel?
  const joined = next.build.parts.filter((p) => isLoad(p) && I(nr, p.id) >= LIVE_A && I(pr, p.id) < LIVE_A);
  if (joined.length === 1) {
    const p = joined[0]!;
    if (Math.abs(I(nr, p.id) - I1) / I1 < 0.02) return { tone: "info", title: `${p.id} is in series`, body: `${updown} ${p.id} is in the same single loop, so the current must go through it too. That adds resistance, so less current flows and the other parts get ${I1 < I0 ? "dimmer" : "a smaller share"}.` };
    return { tone: "info", title: `${p.id} is in parallel`, body: `${updown} ${p.id} has its own branch, so it gets the full voltage. The battery now supplies extra current for the new branch: branch currents add up.` };
  }
  return { tone: "info", title: I1 > I0 ? "More current" : "Less current", body: `${updown} ${I1 > I0 ? "The loop now has less total resistance (or a new parallel path)." : "The loop now has more total resistance (or one path fewer)."}` };
}
