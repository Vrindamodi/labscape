import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { solve, type Wire } from "../core/circuit";
import { CIRCUIT_EXAMPLES, CircuitSandbox, flipPart, released, settle, terminalsOf, toComponents, withHeld, type BoardPart, type CircuitBuild } from "./CircuitSandbox";
import { BUZZER, buzzLevel, DIODE, ldrOhms, MOTOR, motorRevPerS, ohmText, partOhms, thermistorOhms } from "./circuitParts";
import { conducting, explainCircuit, PART_INFO, storyOf } from "./circuitStory";

/** A 6 V battery (0.2 Ω inside) with the given parts in one loop, + end first. */
function loop(...parts: Partial<BoardPart>[]): CircuitBuild {
  const all = [{ id: "B1", kind: "battery", value: 6 }, ...parts].map((p, i) => ({ x: 100 + 100 * i, y: 100, ...p }) as BoardPart);
  return { parts: all, wires: all.map((p, i): Wire => [`${p.id}.${i === 0 ? "a" : "b"}`, `${all[(i + 1) % all.length]!.id}.${i === all.length - 1 ? "b" : "a"}`]) };
}
const run = (b: CircuitBuild) => solve(toComponents(b.parts), b.wires);
const amps = (b: CircuitBuild, id: string) => run(b).components[id]!.current;
const example = (key: string) => structuredClone(CIRCUIT_EXAMPLES[key]!.build);
const setValue = (b: CircuitBuild, id: string, value: number): CircuitBuild => ({ ...b, parts: b.parts.map((p) => (p.id === id ? { ...p, value } : p)) });

describe("part models", () => {
  it("an LDR falls from 10 kΩ in the dark to 100 Ω in bright light, on a log scale", () => {
    expect(ldrOhms(0)).toBe(10_000);
    expect(ldrOhms(50)).toBe(1000);
    expect(ldrOhms(100)).toBe(100);
    for (let l = 1; l <= 100; l++) expect(ldrOhms(l)).toBeLessThan(ldrOhms(l - 1));
  });

  it("a thermistor falls exponentially from 3 kΩ at 0 °C to 70 Ω at 100 °C", () => {
    expect(thermistorOhms(0)).toBe(3000);
    expect(thermistorOhms(100)).toBe(70);
    expect(thermistorOhms(50)).toBeCloseTo(Math.sqrt(3000 * 70), -1);
    for (let t = 1; t <= 100; t++) expect(thermistorOhms(t)).toBeLessThan(thermistorOhms(t - 1));
    // Out-of-range slider values cannot produce a silly resistance.
    expect(thermistorOhms(-40)).toBe(3000);
    expect(ldrOhms(250)).toBe(100);
  });

  it("writes resistances the way the board shows them", () => {
    expect(ohmText(40)).toBe("40 Ω");
    expect(ohmText(1170)).toBe("1.17 kΩ");
    expect(ohmText(10_000)).toBe("10 kΩ");
  });

  it("every kind on the palette has its plain-words description", () => {
    for (const kind of ["dimmer", "buzzer", "motor", "ldr", "thermistor", "button", "diode"] as const) expect(PART_INFO[kind].length).toBeGreaterThan(40);
  });
});

describe("new parts in a simple loop (solver level)", () => {
  it("variable resistor: I = V ÷ R with its slider value, and turning it up dims the bulb", () => {
    const at = (ohm: number) => loop({ id: "VR1", kind: "dimmer", value: ohm }, { id: "L1", kind: "bulb", value: 12 });
    expect(amps(at(20), "L1")).toBeCloseTo(6 / (20 + 12 + 0.2), 9);
    expect(amps(at(1), "L1")).toBeCloseTo(6 / (1 + 12 + 0.2), 9);
    expect(run(at(20)).components.VR1!.voltage).toBeCloseTo((20 * 6) / 32.2, 9);
    expect(run(at(60)).components.L1!.power).toBeLessThan(run(at(20)).components.L1!.power / 4);
  });

  it("buzzer: 40 Ω, silent below 0.02 A, loud from 0.05 A", () => {
    const b = loop({ id: "BZ1", kind: "buzzer" });
    expect(amps(b, "BZ1")).toBeCloseTo(6 / (BUZZER.ohm + 0.2), 9);
    expect(buzzLevel(amps(b, "BZ1"))).toBe("loud");
    // 6 V through 40 Ω + 220 Ω is 0.023 A: just enough to sound, quietly.
    const quiet = loop({ id: "BZ1", kind: "buzzer" }, { id: "R1", kind: "resistor", value: 220 });
    expect(amps(quiet, "BZ1")).toBeCloseTo(6 / 260.2, 9);
    expect(buzzLevel(amps(quiet, "BZ1"))).toBe("quiet");
    expect(buzzLevel(0.0199)).toBe("silent");
    expect(buzzLevel(-0.06)).toBe("loud");
  });

  it("motor: 8 Ω, speed proportional to current, and it reverses when the current does", () => {
    const b = loop({ id: "M1", kind: "motor" });
    const i = amps(b, "M1");
    expect(i).toBeCloseTo(6 / (MOTOR.ohm + 0.2), 9);
    expect(motorRevPerS(i)).toBeCloseTo(3 * i, 9);
    expect(motorRevPerS(2 * i)).toBeCloseTo(2 * motorRevPerS(i), 9);
    expect(motorRevPerS(0.049)).toBe(0);
    // Flip the battery where it sits: the same current, the other way.
    const back = flipPart(b, "B1");
    expect(amps(back, "M1")).toBeCloseTo(-i, 9);
    expect(motorRevPerS(amps(back, "M1"))).toBeLessThan(0);
    // Or flip the motor itself.
    expect(amps(flipPart(b, "M1"), "M1")).toBeCloseTo(-i, 9);
  });

  it("LDR: the light slider sets its resistance", () => {
    const at = (light: number) => loop({ id: "LDR1", kind: "ldr", value: light });
    expect(amps(at(0), "LDR1")).toBeCloseTo(6 / 10_000.2, 9);
    expect(amps(at(50), "LDR1")).toBeCloseTo(6 / 1000.2, 9);
    expect(amps(at(100), "LDR1")).toBeCloseTo(6 / 100.2, 9);
  });

  it("thermistor: the temperature slider sets its resistance", () => {
    const at = (t: number) => loop({ id: "TH1", kind: "thermistor", value: t });
    expect(amps(at(0), "TH1")).toBeCloseTo(6 / 3000.2, 9);
    expect(amps(at(100), "TH1")).toBeCloseTo(6 / 70.2, 9);
    expect(amps(at(25), "TH1")).toBeCloseTo(6 / (thermistorOhms(25) + 0.2), 9);
  });

  it("push button: a gap until it is held, a plain wire while it is", () => {
    const b = loop({ id: "PB1", kind: "button" }, { id: "L1", kind: "bulb", value: 12 });
    expect(run(b).open).toBe(true);
    expect(Math.abs(amps(b, "L1"))).toBeLessThan(1e-9);
    const down = withHeld(b, ["PB1"]);
    expect(amps(down, "L1")).toBeCloseTo(6 / (12 + 0.2 + 0.001), 9);
    // Letting go gives back an open button: a press never reaches a snapshot or the undo history.
    expect(released(down).parts.find((p) => p.id === "PB1")!.closed).toBe(false);
    expect(run(released(down)).open).toBe(true);
    expect(released(b)).toBe(b);
    expect(withHeld(b, [])).toBe(b);
    expect(withHeld(b, ["L1", "nope"])).toBe(b);
  });

  it("diode: drops 0.7 V one way, blocks the other, and leaves the LED model alone", () => {
    const b = loop({ id: "DIO1", kind: "diode" }, { id: "L1", kind: "bulb", value: 12 });
    const r = run(b);
    expect(r.components.L1!.current).toBeCloseTo((6 - DIODE.forwardV) / (12 + DIODE.onOhm + 0.2), 9);
    expect(r.components.DIO1!.voltage).toBeGreaterThan(DIODE.forwardV);
    expect(conducting(r, "DIO1")).toBe(true);
    const back = run(flipPart(b, "DIO1"));
    expect(Math.abs(back.components.L1!.current)).toBeLessThan(1e-6);
    expect(back.components.DIO1!.voltage).toBeCloseTo(-6, 3);
    expect(conducting(back, "DIO1")).toBe(false);
    // An LED in the same place still needs 2 V and has 10 Ω.
    expect(amps(loop({ id: "D1", kind: "led" }, { id: "R1", kind: "resistor", value: 220 }), "R1")).toBeCloseTo((6 - 2) / (220 + 10 + 0.2), 9);
  });

  it("old boards solve exactly as before: the eight original kinds map to the same solver components", () => {
    const old: BoardPart[] = [
      { id: "B1", kind: "battery", x: 0, y: 0, value: 6 },
      { id: "L1", kind: "bulb", x: 0, y: 0, value: 12 },
      { id: "R1", kind: "resistor", x: 0, y: 0, value: 10, vertical: true },
      { id: "S1", kind: "switch", x: 0, y: 0, closed: true },
      { id: "A1", kind: "ammeter", x: 0, y: 0 },
      { id: "V1", kind: "voltmeter", x: 0, y: 0 },
      { id: "D1", kind: "led", x: 0, y: 0, flip: true },
      { id: "F1", kind: "fuse", x: 0, y: 0, value: 1, blown: true },
    ];
    expect(toComponents(old)).toEqual([
      { id: "B1", kind: "battery", value: 6, internal: 0.2 },
      { id: "L1", kind: "bulb", value: 12 },
      { id: "R1", kind: "resistor", value: 10 },
      { id: "S1", kind: "switch", closed: true },
      { id: "A1", kind: "ammeter" },
      { id: "V1", kind: "voltmeter" },
      { id: "D1", kind: "led" },
      { id: "F1", kind: "fuse", value: 1, blown: true },
    ]);
    expect(partOhms({ kind: "bulb", value: 12 })).toBe(12);
    expect(partOhms({ kind: "battery", value: 6 })).toBeNull();
  });
});

describe("mini-project examples", () => {
  it("every example settles: nothing shorted, nothing melted, nothing left dangling", () => {
    for (const [key, ex] of Object.entries(CIRCUIT_EXAMPLES)) {
      const s = settle(ex.build);
      expect(s.result.shorted, key).toEqual([]);
      expect(s.result.blownFuses, key).toEqual([]);
      expect(s.result.floating, key).toEqual([]);
      expect(s.result.bypassed, key).toEqual([]);
      const e = explainCircuit(s);
      expect(e.lines.length, key).toBeGreaterThan(0);
      for (const l of [e.headline, ...e.lines]) expect(l.text, key).not.toMatch(/NaN|undefined|Infinity| – /);
    }
  });

  it("every example is live as loaded, apart from the two that wait for a tap or a press", () => {
    for (const [key, ex] of Object.entries(CIRCUIT_EXAMPLES)) {
      const s = settle(ex.build);
      const out = Math.abs(s.result.components.B1!.current);
      // The fuse demo starts with its switch open (closing it is the demo) and the doorbell with its button up.
      if (key === "fuse" || key === "doorbell") {
        expect(explainCircuit(s).headline.text, key).toMatch(/^Broken circuit/);
        continue;
      }
      expect(explainCircuit(s).headline.text, key).toMatch(/^Complete circuit/);
      expect(out, key).toBeGreaterThan(0.002);
      expect(out, key).toBeLessThan(2);
    }
  });

  it("Dimmer switch: the bulb glows at 10 Ω, is bright at 1 Ω and barely alight at 100 Ω", () => {
    const b = example("dimmer");
    const r = run(b);
    expect(r.components.L1!.current).toBeCloseTo(6 / (10 + 12 + 0.2), 9);
    expect(r.components.L1!.power).toBeCloseTo(0.877, 3);
    expect(run(setValue(b, "VR1", 1)).components.L1!.power).toBeCloseTo(2.48, 2);
    expect(run(setValue(b, "VR1", 100)).components.L1!.power).toBeCloseTo(0.034, 3);
    const e = explainCircuit(settle(b));
    expect(e.lines.some((l) => /^Series: VR1 and L1/.test(l.text))).toBe(true);
    expect(e.lines.some((l) => /Variable resistor VR1 is set to 10 Ω and takes 2\.7 V .* Turn it up and less current flows, so L1 gets dimmer\. Turn it down and more current flows, so L1 gets brighter\./.test(l.text))).toBe(true);
    const s = storyOf(settle(b), settle(setValue(b, "VR1", 40)), { kind: "value", id: "VR1", from: 10, to: 40 })!;
    expect(s.title).toBe("VR1: 40 Ω");
    expect(s.body).toBe("More resistance makes it harder for current to flow, so less flows (I = V ÷ R). Battery current went down from 0.27 A to 0.11 A. L1 gets dimmer.");
  });

  it("Fan with speed control: the motor turns clockwise at about one turn a second, faster with less resistance, backwards with the battery flipped", () => {
    const b = example("fan");
    const i = amps(b, "M1");
    expect(i).toBeCloseTo(6 / (8 + 10 + 0.2 + 0.001), 9);
    expect(motorRevPerS(i)).toBeCloseTo(0.989, 3);
    expect(motorRevPerS(amps(setValue(b, "VR1", 1), "M1"))).toBeCloseTo(1.96, 2);
    expect(motorRevPerS(amps(setValue(b, "VR1", 100), "M1"))).toBeCloseTo(0.166, 3);
    expect(explainCircuit(settle(b)).lines.some((l) => l.text.startsWith("Motor M1 spins clockwise at about 0.99 turns a second: 0.33 A goes through it."))).toBe(true);
    const faster = storyOf(settle(b), settle(setValue(b, "VR1", 2)), { kind: "value", id: "VR1", from: 10, to: 2 })!;
    expect(faster.body).toMatch(/Battery current went up from 0\.33 A to 0\.59 A\. M1 spins faster\.$/);

    const back = settle(flipPart(b, "B1"));
    expect(motorRevPerS(back.result.components.M1!.current)).toBeCloseTo(-0.989, 3);
    expect(explainCircuit(back).lines.some((l) => l.text.startsWith("Motor M1 spins anticlockwise"))).toBe(true);
    expect(storyOf(settle(b), back, { kind: "rotate", id: "B1" })!.title).toBe("M1 spins the other way");
    // Opening the switch stops it.
    const off = settle({ ...b, parts: b.parts.map((p) => (p.id === "S1" ? { ...p, closed: false } : p)) });
    expect(storyOf(settle(b), off, { kind: "switch", id: "S1", closed: false })!.body).toMatch(/so M1 stops\./);
  });

  it("Doorbell: silent until the button is held, loud while it is, silent again on release", () => {
    const b = example("doorbell");
    const up = settle(b);
    expect(Math.abs(up.result.components.BZ1!.current)).toBeLessThan(1e-9);
    expect(explainCircuit(up).lines[0]!.text).toMatch(/^Push button PB1 is not pressed/);
    const down = settle(withHeld(b, ["PB1"]));
    expect(down.result.components.BZ1!.current).toBeCloseTo(6 / (40 + 0.2 + 0.001), 9);
    expect(buzzLevel(down.result.components.BZ1!.current)).toBe("loud");
    expect(explainCircuit(down).lines.some((l) => l.text.startsWith("Buzzer BZ1 is buzzing loudly: 0.15 A goes through it"))).toBe(true);
    const press = storyOf(up, down, { kind: "press", id: "PB1", down: true })!;
    expect(press.title).toBe("PB1 pressed");
    expect(press.body).toBe("Holding the button down joins the gap, so the loop is complete and 0.15 A flows. BZ1 starts buzzing. Let go and it springs open again.");
    const let_go = storyOf(down, up, { kind: "press", id: "PB1", down: false })!;
    expect(let_go.title).toBe("PB1 released");
    expect(let_go.body).toMatch(/^The button springs back and leaves a gap, so the current stops and BZ1 goes quiet\./);
  });

  it("a held button that overloads a fuse melts it, and the melted fuse is what gets stored", () => {
    const b = loop({ id: "PB1", kind: "button" }, { id: "F1", kind: "fuse", value: 0.1 }, { id: "BZ1", kind: "buzzer" });
    const down = settle(withHeld(b, ["PB1"]));
    expect(down.result.fuseTrip?.F1).toBeCloseTo(6 / 40.251, 3);
    const stored = released(down.build);
    expect(stored.parts.find((p) => p.id === "F1")!.blown).toBe(true);
    expect(stored.parts.find((p) => p.id === "PB1")!.closed).toBe(false);
    expect(storyOf(settle(b), down, { kind: "press", id: "PB1", down: true })!.title).toBe("Fuse F1 melted!");
  });

  it("Fire alarm: quiet at room temperature, sounds from 66 °C", () => {
    const b = example("alarm");
    const cold = settle(b);
    expect(thermistorOhms(25)).toBe(1170);
    expect(cold.result.components.BZ1!.current).toBeCloseTo(6 / (1170 + 40 + 0.2), 9);
    expect(buzzLevel(cold.result.components.BZ1!.current)).toBe("silent");
    expect(explainCircuit(cold).lines.some((l) => l.text === "Buzzer BZ1 is silent: only 0.005 A goes through it, and it needs at least 0.02 A to make a sound.")).toBe(true);
    expect(explainCircuit(cold).lines.some((l) => l.text.startsWith("Thermistor TH1 is at 25 °C, so its resistance is 1.17 kΩ."))).toBe(true);
    expect(buzzLevel(amps(setValue(b, "TH1", 65), "BZ1"))).toBe("silent");
    expect(buzzLevel(amps(setValue(b, "TH1", 66), "BZ1"))).toBe("quiet");
    expect(buzzLevel(amps(setValue(b, "TH1", 100), "BZ1"))).toBe("loud");
    const hot = settle(setValue(b, "TH1", 80));
    expect(hot.result.components.BZ1!.current).toBeCloseTo(6 / (148 + 40 + 0.2), 9);
    const s = storyOf(cold, hot, { kind: "value", id: "TH1", from: 25, to: 80 })!;
    expect(s.title).toBe("TH1: 80 °C");
    expect(s.body).toBe("It is hotter, so its resistance falls from 1.17 kΩ to 148 Ω. It now has 4.7 V across it (it had 5.8 V). Battery current went up from 0.005 A to 0.032 A. BZ1 starts buzzing.");
  });

  it("Night light: the LED is lit in the dark and goes out in the light", () => {
    const b = example("night");
    const dark = settle(b);
    // In the dark the LDR (3.98 kΩ) would take almost all of the 3 V, so the LED across it gets its 2 V and conducts.
    expect(ldrOhms(20)).toBe(3980);
    expect(conducting(dark.result, "D1")).toBe(true);
    const vx = dark.result.components.LDR1!.voltage;
    expect(vx).toBeCloseTo((3 / 220.2 + 2 / 10) / (1 / 220.2 + 1 / 3980 + 1 / 10), 9);
    expect(dark.result.components.D1!.current).toBeCloseTo((vx - 2) / 10, 9);
    expect(dark.result.components.D1!.current).toBeGreaterThan(0.003);
    expect(dark.result.components.D1!.current).toBeLessThan(0.03);

    // In the light the LDR (251 Ω) takes only 1.6 V of the 3 V: under the LED's 2 V, so it is off.
    const day = settle(setValue(b, "LDR1", 80));
    expect(ldrOhms(80)).toBe(251);
    expect(conducting(day.result, "D1")).toBe(false);
    expect(day.result.components.D1!.current).toBe(0);
    expect(day.result.components.LDR1!.voltage).toBeCloseTo((3 * 251) / (220 + 251 + 0.2), 6);
    expect(explainCircuit(day).lines.some((l) => l.text === "LED D1 is the right way round but only gets 1.6 V. An LED needs about 2 V before it lets current through and lights.")).toBe(true);
    for (const s of [dark, day]) expect(explainCircuit(s).lines.some((l) => l.text.startsWith("Light sensor LDR1") && l.text.endsWith("LED D1 is wired across it, so the LED gets that same voltage and needs about 2 V to light. That is why it comes on as it gets darker."))).toBe(true);

    // It switches at about 67 % light, as the example's note says.
    const litAt = (light: number) => conducting(run(setValue(b, "LDR1", light)), "D1");
    expect([0, 20, 50, 67].every(litAt)).toBe(true);
    expect([68, 80, 100].some(litAt)).toBe(false);

    const dusk = storyOf(day, dark, { kind: "value", id: "LDR1", from: 80, to: 20 })!;
    expect(dusk.title).toBe("LDR1: 20 % light");
    expect(dusk.body).toBe("Less light falls on it, so its resistance rises from 251 Ω to 3.98 kΩ. It now has 2 V across it (it had 1.6 V). Battery current went down from 0.0064 A to 0.0044 A. D1 lights up.");
    expect(storyOf(dark, day, { kind: "value", id: "LDR1", from: 20, to: 80 })!.body).toMatch(/D1 goes out\.$/);
  });
});

describe("example layouts", () => {
  type Pt = { x: number; y: number };
  const W = 960, H = 560;
  /** A wire is drawn across from its first terminal, then up or down to its second. */
  const segments = (b: CircuitBuild) => {
    const term: Record<string, Pt> = Object.assign({}, ...b.parts.map(terminalsOf));
    const node = new Map<string, string>();
    const find = (t: string): string => (node.get(t) === undefined || node.get(t) === t ? t : find(node.get(t)!));
    b.wires.forEach(([a, c]) => node.set(find(a), find(c)));
    const segs = b.wires.flatMap(([a, c]) => {
      const p = term[a]!, q = term[c]!;
      return [{ a: p, b: { x: q.x, y: p.y }, node: find(a) }, { a: { x: q.x, y: p.y }, b: q, node: find(a) }].filter((s) => s.a.x !== s.b.x || s.a.y !== s.b.y);
    });
    return { term, find, segs };
  };
  const box = (s: { a: Pt; b: Pt }) => ({ x0: Math.min(s.a.x, s.b.x), x1: Math.max(s.a.x, s.b.x), y0: Math.min(s.a.y, s.b.y), y1: Math.max(s.a.y, s.b.y) });

  it("every part sits on the grid, inside the board, clear of the others", () => {
    for (const [key, ex] of Object.entries(CIRCUIT_EXAMPLES)) {
      const half = (p: BoardPart) => (p.vertical ? { w: 30, h: 48 } : { w: 48, h: 30 });
      for (const p of ex.build.parts) {
        expect(p.x % 20 === 0 && p.y % 20 === 0, `${key} ${p.id} on the grid`).toBe(true);
        expect(p.x >= 60 && p.x <= W - 60 && p.y >= 50 && p.y <= H - 50, `${key} ${p.id} on the board`).toBe(true);
        for (const o of ex.build.parts) if (o.id < p.id) expect(Math.abs(p.x - o.x) >= half(p).w + half(o).w || Math.abs(p.y - o.y) >= half(p).h + half(o).h, `${key}: ${p.id} clear of ${o.id}`).toBe(true);
      }
      expect(new Set(ex.build.parts.map((p) => p.id)).size, key).toBe(ex.build.parts.length);
    }
  });

  it("no wire runs through a part, over a terminal it is not joined to, or across another wire", () => {
    for (const [key, ex] of Object.entries(CIRCUIT_EXAMPLES)) {
      const { term, find, segs } = segments(ex.build);
      for (const s of segs) {
        const r = box(s);
        for (const p of ex.build.parts) {
          const [w, h] = p.vertical ? [22, 30] : [30, 22];
          expect(r.x0 < p.x + w && r.x1 > p.x - w && r.y0 < p.y + h && r.y1 > p.y - h, `${key}: a wire runs through ${p.id}`).toBe(false);
        }
        for (const [t, pt] of Object.entries(term)) if (find(t) !== s.node) expect(pt.x >= r.x0 && pt.x <= r.x1 && pt.y >= r.y0 && pt.y <= r.y1, `${key}: a wire passes over ${t}`).toBe(false);
        for (const o of segs) {
          if (o.node === s.node) continue;
          const q = box(o);
          expect(r.x0 <= q.x1 && r.x1 >= q.x0 && r.y0 <= q.y1 && r.y1 >= q.y0, `${key}: two separate wires touch`).toBe(false);
        }
      }
    }
  });
});

describe("explanations that were wrong before", () => {
  it("an LED behind an open switch is not lit, on the board or in the story", () => {
    const b = loop({ id: "D1", kind: "led" }, { id: "R1", kind: "resistor", value: 220 }, { id: "S1", kind: "switch", closed: false });
    const s = settle(b);
    // The solver parks it at exactly 2 V with nothing flowing and calls that "on".
    expect(s.result.components.D1!.on).toBe(true);
    expect(conducting(s.result, "D1")).toBe(false);
    const closed = settle({ ...b, parts: b.parts.map((p) => (p.id === "S1" ? { ...p, closed: true } : p)) });
    expect(conducting(closed.result, "D1")).toBe(true);
    expect(storyOf(s, closed, { kind: "switch", id: "S1", closed: true })!.body).toMatch(/D1 lights up\.$/);
    expect(storyOf(closed, s, { kind: "switch", id: "S1", closed: false })!.body).toMatch(/so D1 goes out\./);
  });

  it("an LED on too small a battery is told so, not that the loop is incomplete", () => {
    const b = loop({ id: "D1", kind: "led" }, { id: "R1", kind: "resistor", value: 220 });
    b.parts[0]!.value = 1.5;
    const e = explainCircuit(settle(b));
    expect(e.headline.text).toMatch(/^Broken circuit/);
    expect(e.lines[0]!.text).toBe("LED D1 is the right way round but only gets 1.5 V. It needs about 2 V before it lets any current through. Turn the battery voltage up.");
  });

  it("two batteries in a line: the sum uses both pushes", () => {
    const b = loop({ id: "B2", kind: "battery", value: 6 }, { id: "L1", kind: "bulb", value: 12 });
    // loop() joins + to +; turn B2 round so the two are + to −.
    const series = flipPart(b, "B2");
    const e = explainCircuit(settle(series));
    expect(Math.abs(run(series).components.L1!.current)).toBeCloseTo(12 / 12.4, 9);
    expect(e.lines.some((l) => l.text.includes("their pushes add up to 12 V, and the whole loop resists with 12.4 Ω (the parts plus about 0.2 Ω inside each battery), so I = 12 ÷ 12.4 = 0.97 A."))).toBe(true);
    expect(e.lines[0]!.text).toContain("B1 (+) → B2 → L1 → back to B1 (−)");
    // Facing each other with equal pushes, nothing flows at all.
    expect(explainCircuit(settle(b)).headline.text).toMatch(/^Broken circuit/);
  });

  it("an LED in the loop: the sum takes the LED's share off first, so the numbers add up", () => {
    const e = explainCircuit(settle(example("led")));
    expect(e.lines.some((l) => l.text.includes("LED D1 is not a plain resistor: it keeps 2.17 V of that for itself. The other 3.83 V drives the current through the rest of the loop, which resists with 220 Ω") && l.text.endsWith("I = 3.83 ÷ 220 = 0.017 A."))).toBe(true);
  });

  it("the flip button really swaps the two ends: a backwards LED lights once flipped", () => {
    const b = example("led");
    const back = flipPart(b, "D1");
    expect(conducting(run(back), "D1")).toBe(false);
    expect(storyOf(settle(b), settle(back), { kind: "rotate", id: "D1" })!.title).toBe("D1 is the wrong way round");
    const again = flipPart(back, "D1");
    expect(again.wires).toEqual(b.wires);
    expect(again.parts.map(terminalsOf)).toEqual(b.parts.map(terminalsOf));
    expect(storyOf(settle(back), settle(again), { kind: "rotate", id: "D1" })!.title).toBe("D1 lights up");
    // Its terminals stay where the wires are: only the names swap.
    const at = (bd: CircuitBuild) => terminalsOf(bd.parts.find((p) => p.id === "D1")!);
    expect(at(back)["D1.b"]).toEqual(at(b)["D1.a"]);
  });

  it("a diode turned against the current gets its own card", () => {
    const b = loop({ id: "DIO1", kind: "diode" }, { id: "M1", kind: "motor" });
    const s = storyOf(settle(b), settle(flipPart(b, "DIO1")), { kind: "rotate", id: "DIO1" })!;
    expect(s.title).toBe("DIO1 is blocking");
    expect(s.body).toContain("so the diode stops it and M1 stops.");
    expect(explainCircuit(settle(b)).lines.some((l) => l.text.startsWith("Diode DIO1 is letting current through: 0.64 A goes in at its + leg and out of the other. It keeps 0.76 V of the push for itself."))).toBe(true);
  });
});

describe("the board renders", () => {
  it("draws every example and every kind of part, at every angle, without a bad number", async () => {
    // No type declarations for react-dom/server in this package, hence the loose import.
    const { renderToStaticMarkup } = (await import("react-dom/server" as string)) as { renderToStaticMarkup: (el: ReactElement) => string };
    const kinds = ["battery", "bulb", "resistor", "switch", "ammeter", "voltmeter", "led", "fuse", "dimmer", "buzzer", "motor", "ldr", "thermistor", "button", "diode"] as const;
    const everything: CircuitBuild = { parts: kinds.flatMap((kind, i) => [0, 1, 2, 3].map((r): BoardPart => ({ id: `${kind}${r}`, kind, x: 60 + 60 * i, y: 60 + 120 * r, vertical: r % 2 === 1, flip: r >= 2, ...(kind === "fuse" && r === 3 ? { blown: true } : {}) }))), wires: [] };
    for (const build of [...Object.values(CIRCUIT_EXAMPLES).map((ex) => ex.build), everything, withHeld(example("doorbell"), ["PB1"]), flipPart(example("fan"), "B1"), setValue(example("alarm"), "TH1", 100)]) {
      const html = renderToStaticMarkup(createElement(CircuitSandbox, { initial: build }));
      expect(html).toContain("<svg");
      expect(html).not.toMatch(/NaN|Infinity|undefined/);
      for (const p of build.parts) expect(html).toContain(`>${p.id}`);
    }
    // The palette offers all fifteen parts, and the new glyphs animate only through the classes reduced motion switches off.
    const html = renderToStaticMarkup(createElement(CircuitSandbox, { initial: example("fan") }));
    for (const label of ["+ Variable resistor", "+ Buzzer", "+ Motor", "+ Light sensor", "+ Thermistor", "+ Push button", "+ Diode"]) expect(html).toContain(label);
    expect(html).toContain('class="cs-spin"');
    expect(html).toMatch(/prefers-reduced-motion:reduce\)\{[^}]*\.cs-wave,\.cs-spin\{animation:none\}/);
  });
});
