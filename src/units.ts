/** All internal lengths are millimetres. This module converts to and from the display unit. */
export const IN = 25.4;
export type Unit = "mm" | "in";

export const toDisp = (mm: number, unit: Unit): number => (unit === "in" ? mm / IN : mm);
export const fromDisp = (v: number, unit: Unit): number => (unit === "in" ? v * IN : v);

/** Format a length given in mm for display, trimmed of trailing zeros. */
export const fmt = (mm: number, unit: Unit, decimals?: number): string =>
  (+toDisp(mm, unit).toFixed(decimals ?? (unit === "in" ? 3 : 1))).toString();

/** Parse an SVG length attribute ("12.5mm", "3in", "40") to mm. Unitless values are px at `dpi` px per inch. */
export function lenToMM(str: string | null | undefined, dpi: number): number | null {
  if (!str) return null;
  const m = /^\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px)?\s*$/i.exec(str);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = (m[2] || "px").toLowerCase() as "mm" | "cm" | "in" | "pt" | "pc" | "px";
  return { mm: v, cm: v * 10, in: v * IN, pt: (v * IN) / 72, pc: (v * IN) / 6, px: (v * IN) / dpi }[u];
}
