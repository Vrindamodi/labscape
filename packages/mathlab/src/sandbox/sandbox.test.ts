import { describe, expect, it } from "vitest";
import { rootsIn } from "./GraphSandbox";

describe("graphing sandbox root finder", () => {
  it("finds both roots of x^2 - 2", () => {
    const r = rootsIn((x) => x * x - 2, -5, 5);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(-Math.SQRT2, 6);
    expect(r[1]).toBeCloseTo(Math.SQRT2, 6);
  });

  it("snaps a root at the origin to exactly 0", () => {
    expect(rootsIn((x) => x * (x - 3), -1, 5)).toEqual([0, expect.closeTo(3, 6)]);
  });

  it("does not report the poles of tan x as roots", () => {
    const r = rootsIn(Math.tan, -4, 4);
    expect(r.map((x) => Math.round(x * 1000) / 1000)).toEqual([-3.142, 0, 3.142]);
  });

  it("returns nothing for a curve that never crosses", () => {
    expect(rootsIn((x) => x * x + 1, -10, 10)).toEqual([]);
  });
});
