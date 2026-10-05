import { describe, expect, it } from "vitest";
import { arcToCubics, cssColor, ellipseToD, parsePathD, rectToD } from "../../src/svg/flatten";
import { samplePath } from "./helpers";

const nums = (s: unknown) => (s as number[]).slice(1);

describe("parsePathD", () => {
  it("handles relative commands, H/V and close", () => {
    const s = parsePathD("m10 10 h20 v20 h-20 z");
    expect(s).toEqual([["M", 10, 10], ["L", 30, 10], ["L", 30, 30], ["L", 10, 30], ["Z"]]);
  });
  it("treats extra pairs after M as implicit lineto (relative stays relative)", () => {
    expect(parsePathD("M0 0 10 10 20 0")).toEqual([
      ["M", 0, 0],
      ["L", 10, 10],
      ["L", 20, 0],
    ]);
    expect(parsePathD("m1 1 2 2 3 -1")).toEqual([
      ["M", 1, 1],
      ["L", 3, 3],
      ["L", 6, 2],
    ]);
  });
  it("parses compact number forms", () => {
    expect(parsePathD("M.5.5L-1-2")).toEqual([
      ["M", 0.5, 0.5],
      ["L", -1, -2],
    ]);
    expect(parsePathD("M1e1,2E0 L1.5e-1 .25")).toEqual([
      ["M", 10, 2],
      ["L", 0.15, 0.25],
    ]);
    expect(parsePathD("M0,0,L5,5")).toEqual([
      ["M", 0, 0],
      ["L", 5, 5],
    ]);
  });
  it("reflects control points for S", () => {
    const s = parsePathD("M0 0 C10 0 20 10 30 10 S50 20 60 20");
    expect(s[2]).toEqual(["C", 40, 10, 50, 20, 60, 20]);
  });
  it("uses the current point for S/T without a preceding curve", () => {
    expect(parsePathD("M5 5 S10 10 20 5")[1]).toEqual(["C", 5, 5, 10, 10, 20, 5]);
    const t = parsePathD("M0 0 T10 0")[1];
    nums(t).forEach((v, i) => expect(v).toBeCloseTo([0, 0, 10 / 3, 0, 10, 0][i], 9));
  });
  it("converts Q to an equivalent C and reflects for T", () => {
    const q = parsePathD("M0 0 Q10 10 20 0 T40 0");
    expect(nums(q[1])).toEqual(expect.arrayContaining([20, 0]));
    nums(q[1]).forEach((v, i) => expect(v).toBeCloseTo([20 / 3, 20 / 3, 40 / 3, 20 / 3, 20, 0][i], 9));
    // T's control point = reflection of (10,10) about (20,0) = (30,-10)
    const c = nums(q[2]);
    expect(c[0]).toBeCloseTo(20 + (2 / 3) * (30 - 20));
    expect(c[1]).toBeCloseTo(0 + (2 / 3) * (-10 - 0));
    expect(c.slice(4)).toEqual([40, 0]);
  });
  it("does not reflect a cubic control through a non-curve command", () => {
    const s = parsePathD("M0 0 C1 1 2 2 3 3 L4 4 S9 9 10 10");
    expect(s[3]).toEqual(["C", 4, 4, 9, 9, 10, 10]);
  });
  it("restarts at the subpath start after Z", () => {
    const s = parsePathD("M10 10 L20 10 L20 20 Z l5 5");
    expect(s[4]).toEqual(["L", 15, 15]);
  });
  it("accepts compact arc flags: a10,8 30 01-20,0", () => {
    const s = parsePathD("M0 0 a10,8 30 01-20,0");
    const last = s[s.length - 1];
    expect(last[0]).toBe("C");
    expect(nums(last).slice(-2)).toEqual([-20, 0]);
  });
  it("accepts separated and repeated arc arguments", () => {
    const s = parsePathD("M0 0 A5 5 0 1 1 10 0 5 5 0 1 1 20 0");
    expect(nums(s[s.length - 1]).slice(-2)).toEqual([20, 0]);
  });
  it("throws on malformed paths", () => {
    expect(() => parsePathD("M0 0 A5 5 0 2 1 10 0")).toThrow();
    expect(() => parsePathD("M0")).toThrow();
    expect(() => parsePathD("M0 0 X5 5")).toThrow();
  });
  it("returns [] for an empty string", () => {
    expect(parsePathD("")).toEqual([]);
  });
});

describe("arcToCubics", () => {
  it("ends exactly at the endpoint", () => {
    for (const [fa, fs] of [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ] as const) {
      const c = arcToCubics(3, 4, 7, 5, 25, fa, fs, -9, 2);
      expect(nums(c[c.length - 1]).slice(-2)).toEqual([-9, 2]);
    }
  });
  it("keeps every segment endpoint on a half circle of radius 10", () => {
    const segs = arcToCubics(10, 0, 10, 10, 0, false, true, -10, 0);
    expect(segs.length).toBe(2);
    for (const s of segs) {
      const [x, y] = nums(s).slice(-2);
      expect(Math.hypot(x, y)).toBeCloseTo(10, 9);
    }
    // sweep=1 in y-down coordinates goes through (0, 10)
    expect(nums(segs[0]).slice(-2)[1]).toBeCloseTo(10, 9);
  });
  it("approximates the circle within 0.03% of the radius (sampled along the curves)", () => {
    for (const [fa, ex, ey] of [
      [false, 0, 10],
      [true, 0, -10],
    ] as const) {
      const segs = arcToCubics(10, 0, 10, 10, 0, fa, true, ex, ey);
      const pts = samplePath([["M", 10, 0], ...segs]);
      for (const [x, y] of pts) expect(Math.abs(Math.hypot(x, y) - 10)).toBeLessThan(0.003);
    }
  });
  it("scales up radii that are too small", () => {
    const segs = arcToCubics(0, 0, 1, 1, 0, false, true, 20, 0);
    const pts = samplePath([["M", 0, 0], ...segs]);
    for (const [x, y] of pts) expect(Math.hypot(x - 10, y)).toBeCloseTo(10, 1);
  });
  it("degenerates to a line for zero radius and to nothing for equal endpoints", () => {
    expect(arcToCubics(0, 0, 0, 5, 0, false, true, 5, 5)).toEqual([["L", 5, 5]]);
    expect(arcToCubics(1, 1, 5, 5, 0, false, true, 1, 1)).toEqual([]);
  });
  it("splits a full sweep into ≤90° pieces", () => {
    expect(arcToCubics(10, 0, 10, 10, 0, true, true, -10, 0).length).toBe(2);
    expect(arcToCubics(0, 0, 10, 10, 0, false, true, 10, 10).length).toBe(1);
  });
});

describe("shape → path conversions", () => {
  const bbox = (d: string) => {
    const pts = samplePath(parsePathD(d), 64);
    const xs = pts.map((p) => p[0]),
      ys = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  it("plain rect", () => {
    expect(parsePathD(rectToD(1, 2, 10, 5, null, null))).toEqual([
      ["M", 1, 2],
      ["L", 11, 2],
      ["L", 11, 7],
      ["L", 1, 7],
      ["Z"],
    ]);
  });
  it("rounded rect keeps its bounding box and clamps radii", () => {
    const b = bbox(rectToD(0, 0, 20, 10, 3, null));
    expect(b.map((v) => +v.toFixed(6))).toEqual([0, 0, 20, 10]);
    const c = bbox(rectToD(0, 0, 20, 10, 50, 50)); // clamped to 10 x 5
    expect(c.map((v) => +v.toFixed(6))).toEqual([0, 0, 20, 10]);
    // only ry given → rx = ry
    expect(parsePathD(rectToD(0, 0, 20, 10, null, 2)).length).toBeGreaterThan(5);
  });
  it("circle / ellipse", () => {
    const b = bbox(ellipseToD(5, 6, 4, 2));
    expect(b[0]).toBeCloseTo(1, 6);
    expect(b[2]).toBeCloseTo(9, 6);
    expect(b[1]).toBeGreaterThan(3.99);
    expect(b[1]).toBeLessThan(4.01);
    expect(b[3]).toBeGreaterThan(7.99);
    expect(b[3]).toBeLessThan(8.01);
  });
});

describe("cssColor", () => {
  it("normalises computed colours", () => {
    expect(cssColor("rgb(255, 0, 16)")).toBe("#ff0010");
    expect(cssColor("rgba(0, 0, 0, 0)")).toBe("none");
    expect(cssColor("rgba(10, 20, 30, 0.5)")).toBe("#0a141e");
    expect(cssColor("none")).toBe("none");
    expect(cssColor("")).toBe("none");
    expect(cssColor("red")).toBe("red");
  });
  it("flags url() paints as needing the original markup", () => {
    expect(cssColor("url(#g1)")).toBeUndefined();
  });
});
