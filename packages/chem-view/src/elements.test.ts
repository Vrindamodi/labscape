import { describe, expect, it } from "vitest";
import { configText, configuration, madelungFill, orbitalBoxes, phaseAt, subshellName, type Element } from "./elements";

const total = (z: number) => configuration(z).filling.reduce((a, s) => a + s.electrons, 0);

describe("electron configurations", () => {
  it("conserves electrons for every element", () => {
    for (let z = 1; z <= 118; z++) expect(total(z)).toBe(z);
  });

  it("follows Madelung where there is no exception", () => {
    expect(configText(configuration(26))).toBe("[Ar] 3d⁶ 4s²"); // Fe
    expect(configText(configuration(17))).toBe("[Ne] 3s² 3p⁵"); // Cl
    expect(configText(configuration(1))).toBe("1s¹");
    expect(configText(configuration(2))).toBe("1s²");
    expect(configText(configuration(118))).toBe("[Rn] 5f¹⁴ 6d¹⁰ 7s² 7p⁶");
  });

  it("applies the measured exceptions", () => {
    expect(configText(configuration(24))).toBe("[Ar] 3d⁵ 4s¹"); // Cr
    expect(configText(configuration(29))).toBe("[Ar] 3d¹⁰ 4s¹"); // Cu
    expect(configText(configuration(46))).toBe("[Kr] 4d¹⁰"); // Pd
    expect(configText(configuration(79))).toBe("[Xe] 4f¹⁴ 5d¹⁰ 6s¹"); // Au
    expect(configText(configuration(64))).toBe("[Xe] 4f⁷ 5d¹ 6s²"); // Gd
    expect(configText(configuration(90))).toBe("[Rn] 6d² 7s²"); // Th
    expect(configText(configuration(103))).toBe("[Rn] 5f¹⁴ 7s² 7p¹"); // Lr
    expect(configuration(24).predicted?.map(subshellName)).toContain("4s");
    expect(configuration(26).predicted).toBeNull();
  });

  it("counts Bohr shells", () => {
    expect(configuration(11).shells).toEqual([2, 8, 1]);
    expect(configuration(26).shells).toEqual([2, 8, 14, 2]);
    expect(configuration(29).shells).toEqual([2, 8, 18, 1]);
  });

  it("fills orbital boxes by Hund's rule", () => {
    expect(orbitalBoxes(1, 4)).toEqual([2, 1, 1]);
    expect(orbitalBoxes(2, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(orbitalBoxes(2, 6)).toEqual([2, 1, 1, 1, 1]);
    expect(madelungFill(20).map(subshellName)).toEqual(["1s", "2s", "2p", "3s", "3p", "4s"]);
  });
});

describe("phase at a temperature", () => {
  const el = (z: number, meltingK: number | null, boilingK: number | null) => ({ z, meltingK, boilingK, state: "solid" }) as Element;
  it("uses melting and boiling points at 1 atm", () => {
    expect(phaseAt(el(35, 265.8, 332), 298)).toBe("liquid"); // Br
    expect(phaseAt(el(31, 302.91, 2673), 310)).toBe("liquid"); // Ga in your hand
    expect(phaseAt(el(33, 1090, 887), 1000)).toBe("gas"); // As sublimes
    expect(phaseAt(el(2, null, 4.22), 3)).toBe("liquid"); // He never freezes
  });
});

import { buildScene, SCENES } from "./molecules";

describe("molecular scenes", () => {
  it("conserve every atom and map bonds", () => {
    for (const [slug, s] of Object.entries(SCENES)) {
      if (s.kind !== "reaction") continue;
      const b = buildScene(s);
      expect(b.counts.before, slug).toEqual(b.counts.after);
    }
  });
  it("show the proton moving in neutralisation", () => {
    const b = buildScene(SCENES["acid-base-titration"] as Parameters<typeof buildScene>[0]);
    expect(b.bonds.filter((x) => x.kind === "broken")).toHaveLength(1);
    expect(b.bonds.filter((x) => x.kind === "formed")).toHaveLength(1);
  });
});
