import { describe, expect, it } from "vitest";
import { IN, fmt, fromDisp, lenToMM, toDisp } from "../../src/units";

describe("units", () => {
  it("converts mm <-> in", () => {
    expect(toDisp(25.4, "in")).toBeCloseTo(1);
    expect(fromDisp(2, "in")).toBeCloseTo(50.8);
    expect(toDisp(10, "mm")).toBe(10);
    expect(fromDisp(10, "mm")).toBe(10);
  });
  it("formats lengths without trailing zeros", () => {
    expect(fmt(25.4, "in")).toBe("1");
    expect(fmt(12.34, "mm")).toBe("12.3");
    expect(fmt(0.1, "mm", 3)).toBe("0.1");
  });
  it("parses SVG lengths", () => {
    expect(lenToMM("12.5mm", 96)).toBeCloseTo(12.5);
    expect(lenToMM("2cm", 96)).toBeCloseTo(20);
    expect(lenToMM("1in", 96)).toBeCloseTo(IN);
    expect(lenToMM("72pt", 96)).toBeCloseTo(IN);
    expect(lenToMM("6pc", 96)).toBeCloseTo(IN);
    expect(lenToMM(" 96 ", 96)).toBeCloseTo(IN);
    expect(lenToMM("96", 72)).toBeCloseTo((96 * IN) / 72);
    expect(lenToMM("1e1mm", 96)).toBeCloseTo(10);
  });
  it("rejects percentages and junk", () => {
    expect(lenToMM("50%", 96)).toBeNull();
    expect(lenToMM("abc", 96)).toBeNull();
    expect(lenToMM(null, 96)).toBeNull();
  });
});
