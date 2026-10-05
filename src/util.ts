export const SVGNS = "http://www.w3.org/2000/svg";

export const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Round to 4 decimals (used for transform / viewBox values). */
export const n4 = (v: number): number => +v.toFixed(4);

/** Round to 3 decimals as a string, avoiding "-0". */
export const n3 = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};
