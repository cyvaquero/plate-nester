import type { Part } from "../types";
import { IN, lenToMM } from "../units";
import { SVGNS, esc } from "../util";
import { buildOutline, sampleRings } from "../geometry/outline";
import { extractFlat } from "./flatten";

/** Presentation attributes copied from the root <svg> onto the wrapper group (thumbnail + original-markup export). */
export const KEEP_ATTRS = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "fill-rule",
  "clip-rule",
  "opacity",
  "style",
  "class",
  "font-family",
  "font-size",
  "color",
];

let host: SVGSVGElement | undefined;

/** A hidden <svg> in the page used to measure bounding boxes and CTMs. */
export function getHost(): SVGSVGElement {
  if (!host || !host.isConnected) {
    host = document.createElementNS(SVGNS, "svg");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:absolute;left:0;top:0;width:10px;height:10px;visibility:hidden;pointer-events:none";
    document.body.appendChild(host);
  }
  return host;
}

/** Strip <script>, <foreignObject> and on* attributes. */
export function sanitize(root: Element): void {
  root.querySelectorAll("script,foreignObject").forEach((n) => n.remove());
  for (const el of [root, ...root.querySelectorAll("*")])
    for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
}

/**
 * Prefix every id under `root` and rewrite url(#id), href/#id references and <style> selectors, so parts from
 * different files can share a plate without id collisions.
 */
export function prefixIds(root: Element, pfx: string): void {
  const ids = new Map<string, string>();
  root.querySelectorAll("[id]").forEach((el) => {
    ids.set(el.id, pfx + el.id);
    el.id = pfx + el.id;
  });
  if (!ids.size) return;
  const re = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g;
  const fix = (v: string) => v.replace(re, (m, id: string) => (ids.has(id) ? `url(#${ids.get(id)})` : m));
  for (const el of [root, ...root.querySelectorAll("*")]) {
    for (const a of [...el.attributes]) {
      let nv = fix(a.value);
      if (a.localName === "href" && nv[0] === "#" && ids.has(nv.slice(1))) nv = "#" + ids.get(nv.slice(1));
      if (nv !== a.value) el.setAttributeNS(a.namespaceURI, a.name, nv);
    }
    if (el.localName === "style")
      el.textContent = fix(el.textContent ?? "").replace(/#([A-Za-z_][\w-]*)/g, (m, id: string) =>
        ids.has(id) ? "#" + ids.get(id) : m,
      );
  }
}

/** mm per user unit from width/height/viewBox; unitless files use `dpi` px per inch. */
export function measureScale(p: Pick<Part, "vb" | "wAttr" | "hAttr">, dpi: number): { kx: number; ky: number } {
  let kx: number | null, ky: number | null;
  if (p.vb) {
    const w = lenToMM(p.wAttr, dpi),
      h = lenToMM(p.hAttr, dpi);
    kx = w ? w / p.vb[2] : null;
    ky = h ? h / p.vb[3] : null;
    if (kx == null && ky == null) kx = ky = IN / dpi;
    else if (kx == null) kx = ky;
    else if (ky == null) ky = kx;
  } else kx = ky = IN / dpi;
  return { kx: kx!, ky: ky! };
}

/** Apply a (new) dpi to an already-parsed part: rescales and rebuilds the outline. */
export function rescalePart(p: Part, dpi: number): void {
  const { kx, ky } = measureScale(p, dpi);
  p.kx = kx;
  p.ky = ky;
  p.wMM = p.bbox.width * kx;
  p.hMM = p.bbox.height * ky;
  const o = buildOutline(p.rings, p.cx, p.cy, kx, ky);
  p.outers = o.outers;
  p.areaMM = o.areaMM;
}

/** Parse, sanitize and measure one SVG file. `uid` must be unique per part. Throws a user-readable Error. */
export function parseSVG(text: string, name: string, uid: number, dpi: number): Part {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (doc.getElementsByTagName("parsererror").length || root.localName !== "svg")
    throw new Error(`${name} isn't a readable SVG file.`);
  sanitize(root);
  prefixIds(root, `p${uid}_`);
  const vbA = (root.getAttribute("viewBox") || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const vb = vbA.length === 4 && vbA.every(isFinite) && vbA[2] > 0 && vbA[3] > 0 ? vbA : null;
  const rootAttrs = KEEP_ATTRS.filter((a) => root.hasAttribute(a))
    .map((a) => `${a}="${esc(root.getAttribute(a))}"`)
    .join(" ");
  const ser = new XMLSerializer();
  const inner = [...root.childNodes]
    .filter((n) => n.nodeType === 1)
    .map((n) => ser.serializeToString(n))
    .join("");
  const h = getHost();
  const g = document.createElementNS(SVGNS, "g");
  for (const n of root.childNodes) if (n.nodeType === 1) g.appendChild(document.importNode(n, true));
  h.appendChild(g);
  const part = {
    uid,
    name,
    inner,
    rootAttrs,
    vb,
    wAttr: root.getAttribute("width"),
    hAttr: root.getAttribute("height"),
  };
  let bbox, flat, rings;
  try {
    const bb = g.getBBox();
    if (!bb || (bb.width <= 0 && bb.height <= 0)) throw new Error(`${name} has no visible shapes to place.`);
    bbox = { x: bb.x, y: bb.y, width: Math.max(bb.width, 1e-6), height: Math.max(bb.height, 1e-6) };
    const { kx, ky } = measureScale(part, dpi);
    rings = sampleRings(g, h, 0.1 / Math.min(kx, ky)); // sample at ~0.1 mm along curves
    flat = extractFlat(g, h);
  } finally {
    g.remove();
  }
  if (!rings.length) throw new Error(`${name} has no cuttable shapes.`);
  const thumbSVG = `<svg xmlns="${SVGNS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}"><g ${rootAttrs}>${inner}</g></svg>`;
  const p: Part = {
    ...part,
    bbox,
    cx: bbox.x + bbox.width / 2,
    cy: bbox.y + bbox.height / 2,
    kx: 1,
    ky: 1,
    wMM: 0,
    hMM: 0,
    flat,
    rings,
    outers: [],
    areaMM: 0,
    thumb: URL.createObjectURL(new Blob([thumbSVG], { type: "image/svg+xml" })),
    qty: 1,
    lock: false,
  };
  rescalePart(p, dpi);
  if (!p.outers.length) {
    URL.revokeObjectURL(p.thumb);
    throw new Error(`${name} has no closed outline to nest.`);
  }
  return p;
}
