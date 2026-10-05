import JSZip from "jszip";
import type { FlatItem, Part } from "../types";
import type { PlateLayout, Placement } from "../nest/types";
import { SVGNS, n3, n4 } from "../util";

export type Matrix = [number, number, number, number, number, number];

/** Part user units → plate mm: translate(tx,ty) rotate(deg) scale(kx,ky) translate(-cx,-cy), as a 2×3 matrix. */
export function placeMatrix(
  tx: number,
  ty: number,
  deg: number,
  kx: number,
  ky: number,
  cx: number,
  cy: number,
): Matrix {
  const r = (deg * Math.PI) / 180;
  const exact = Math.abs(deg % 90) === 0;
  const co = exact ? Math.round(Math.cos(r)) : Math.cos(r);
  const si = exact ? Math.round(Math.sin(r)) : Math.sin(r);
  const a = kx * co,
    b = kx * si,
    c = -ky * si,
    d = ky * co;
  return [a, b, c, d, tx - (a * cx + c * cy), ty - (b * cx + d * cy)];
}

/** Safe XML id base from a file name. */
export const slug = (s: string): string =>
  (
    s
      .replace(/\.svg$/i, "")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "part"
  ).replace(/^(\d)/, "p$1");

/**
 * One object per part. A single <path> when all its shapes are unfilled lines with the same stroke; otherwise a
 * <g> of transform-free paths. Falls back to <g transform="…"> around the original markup when `flat` is null.
 */
export function partMarkup(
  p: Pick<Part, "flat" | "rootAttrs" | "inner">,
  M: Matrix,
  id: string,
  fallbackTransform: string,
): string {
  if (!p.flat) return `<g id="${id}" transform="${fallbackTransform}"><g ${p.rootAttrs}>${p.inner}</g></g>`;
  const [a, b, c, d, e, f] = M;
  const sc = Math.sqrt(Math.abs(a * d - b * c));
  const toD = (segs: FlatItem["segs"]) =>
    segs
      .map((s) => {
        if (s[0] === "Z") return "Z";
        const o: string[] = [];
        const v = s as unknown as number[];
        for (let j = 1; j < v.length; j += 2)
          o.push(n3(a * v[j] + c * v[j + 1] + e) + " " + n3(b * v[j] + d * v[j + 1] + f));
        return s[0] + o.join(" ");
      })
      .join("");
  const strokeAttr = (st: string, sw: number, so: number) =>
    st === "none"
      ? `stroke="none"`
      : `stroke="${st}" stroke-width="${n3(Math.max(sw * sc, 0.01))}"${so < 1 ? ` stroke-opacity="${n3(so)}"` : ""}`;
  const lines = new Map<string, { stroke: string; sw: number; so: number; d: string[] }>();
  const els: string[] = [];
  for (const it of p.flat) {
    if (it.fill === "none") {
      const k = it.stroke + "|" + n3(it.sw * sc) + "|" + n3(it.so);
      if (!lines.has(k)) lines.set(k, { stroke: it.stroke, sw: it.sw, so: it.so, d: [] });
      lines.get(k)!.d.push(toD(it.segs));
    } else
      els.push(
        `<path d="${toD(it.segs)}" fill="${it.fill}"${it.fo < 1 ? ` fill-opacity="${n3(it.fo)}"` : ""}${it.evenodd ? ` fill-rule="evenodd"` : ""} ${strokeAttr(it.stroke, it.sw, it.so)}/>`,
      );
  }
  const lineEls = [...lines.values()].map(
    (L) => `<path d="${L.d.join("")}" fill="none" ${strokeAttr(L.stroke, L.sw, L.so)}/>`,
  );
  const all = lineEls.concat(els);
  if (all.length === 1) return all[0].replace("<path ", `<path id="${id}" `);
  return `<g id="${id}">${all.join("")}</g>`;
}

export interface PlateExportOptions {
  plateW: number;
  plateH: number;
  /** Draw the red plate outline (ignored for previews). */
  outline: boolean;
  /** Preview rendering: never draws the plate outline. */
  preview?: boolean;
  /** Test/diagnostic: wrap the original markup of every part instead of flattening. */
  forceOriginal?: boolean;
}

/** Build one plate's SVG: width/height in mm, viewBox in mm. */
export function plateSVG(plate: PlateLayout, parts: ReadonlyMap<number, Part>, o: PlateExportOptions): string {
  const W = o.plateW,
    H = o.plateH;
  let s = `<svg xmlns="${SVGNS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n4(W)}mm" height="${n4(H)}mm" viewBox="0 0 ${n4(W)} ${n4(H)}">`;
  if (o.outline && !o.preview)
    s += `<rect x="0" y="0" width="${n4(W)}" height="${n4(H)}" fill="none" stroke="#ff0000" stroke-width="0.1"/>`;
  const ids = new Map<string, number>();
  for (const pl of plate.placements) {
    const p = parts.get(pl.partId)!;
    const t = fallbackTransform(pl, p);
    const base = slug(p.name),
      k = (ids.get(base) || 0) + 1;
    ids.set(base, k);
    const src = o.forceOriginal ? { ...p, flat: null } : p;
    s += partMarkup(src, placeMatrix(pl.x, pl.y, pl.ang, p.kx, p.ky, pl.rx, pl.ry), `${base}-${k}`, t);
  }
  return s + `</svg>`;
}

const fallbackTransform = (pl: Placement, p: Pick<Part, "kx" | "ky">): string =>
  `translate(${n4(pl.x)} ${n4(pl.y)})${pl.ang ? ` rotate(${pl.ang})` : ""} scale(${n4(p.kx)} ${n4(p.ky)}) translate(${n4(-pl.rx)} ${n4(-pl.ry)})`;

export const plateFilename = (i: number, total: number): string =>
  `plate-${String(i + 1).padStart(2, "0")}-of-${String(total).padStart(2, "0")}.svg`;

/** Zip every plate (already serialised) into one archive. */
export async function zipPlates(svgs: string[]): Promise<Blob> {
  const zip = new JSZip();
  svgs.forEach((svg, i) => zip.file(plateFilename(i, svgs.length), svg));
  return zip.generateAsync({ type: "blob" });
}

/** Normal browser download of a blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
