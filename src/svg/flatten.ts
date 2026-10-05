import type { FlatItem, Seg } from "../types";
import { SVGNS } from "../util";

/**
 * Parse an SVG path `d` string into absolute segments. Relative commands, H/V, S/T reflection, Q→C and arcs→cubics
 * are all normalised, and compact arc flags such as "a10,8 30 01-20,0" are handled. Throws on malformed input.
 */
export function parsePathD(d: string): Seg[] {
  const out: Seg[] = [];
  const n = d.length;
  const reNum = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/y;
  let i = 0;
  let cmd = "";
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0;
  let lcx: number | null = null,
    lcy: number | null = null,
    lqx: number | null = null,
    lqy: number | null = null;
  const ws = () => {
    while (i < n && (d[i] === "," || d[i] === " " || d[i] === "\t" || d[i] === "\n" || d[i] === "\r" || d[i] === "\f"))
      i++;
  };
  const num = () => {
    ws();
    reNum.lastIndex = i;
    const m = reNum.exec(d);
    if (!m || !m[0].length) throw new Error("bad path");
    i = reNum.lastIndex;
    return +m[0];
  };
  const flag = () => {
    ws();
    const c = d[i];
    if (c !== "0" && c !== "1") throw new Error("bad flag");
    i++;
    return c === "1";
  };
  const more = () => {
    ws();
    return i < n && /[-+.\d]/.test(d[i]);
  };
  while (true) {
    ws();
    if (i >= n) break;
    if (/[a-zA-Z]/.test(d[i])) cmd = d[i++];
    else if (!cmd) throw new Error("bad path");
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    let first = true;
    do {
      const ox = rel ? x : 0,
        oy = rel ? y : 0;
      let keepC = false,
        keepQ = false;
      if (C === "M") {
        x = ox + num();
        y = oy + num();
        if (first) {
          out.push(["M", x, y]);
          sx = x;
          sy = y;
        } else out.push(["L", x, y]);
      } else if (C === "L") {
        x = ox + num();
        y = oy + num();
        out.push(["L", x, y]);
      } else if (C === "H") {
        x = ox + num();
        out.push(["L", x, y]);
      } else if (C === "V") {
        y = oy + num();
        out.push(["L", x, y]);
      } else if (C === "C" || C === "S") {
        let x1: number, y1: number;
        if (C === "C") {
          x1 = ox + num();
          y1 = oy + num();
        } else {
          x1 = lcx == null ? x : 2 * x - lcx;
          y1 = lcy == null ? y : 2 * y - lcy!;
        }
        const x2 = ox + num(),
          y2 = oy + num(),
          ex = ox + num(),
          ey = oy + num();
        out.push(["C", x1, y1, x2, y2, ex, ey]);
        lcx = x2;
        lcy = y2;
        x = ex;
        y = ey;
        keepC = true;
      } else if (C === "Q" || C === "T") {
        let qx: number, qy: number;
        if (C === "Q") {
          qx = ox + num();
          qy = oy + num();
        } else {
          qx = lqx == null ? x : 2 * x - lqx;
          qy = lqy == null ? y : 2 * y - lqy!;
        }
        const ex = ox + num(),
          ey = oy + num();
        out.push([
          "C",
          x + (2 / 3) * (qx - x),
          y + (2 / 3) * (qy - y),
          ex + (2 / 3) * (qx - ex),
          ey + (2 / 3) * (qy - ey),
          ex,
          ey,
        ]);
        lqx = qx;
        lqy = qy;
        x = ex;
        y = ey;
        keepQ = true;
      } else if (C === "A") {
        const rx = num(),
          ry = num(),
          rot = num(),
          fa = flag(),
          fs = flag(),
          ex = ox + num(),
          ey = oy + num();
        for (const c of arcToCubics(x, y, rx, ry, rot, fa, fs, ex, ey)) out.push(c);
        x = ex;
        y = ey;
      } else if (C === "Z") {
        out.push(["Z"]);
        x = sx;
        y = sy;
      } else throw new Error("bad command");
      if (!keepC) {
        lcx = lcy = null;
      }
      if (!keepQ) {
        lqx = lqy = null;
      }
      first = false;
    } while (C !== "Z" && more());
  }
  return out;
}

/** Endpoint-parameterised SVG arc → cubic Béziers (≤ 90° each). The last cubic ends exactly at (x2, y2). */
export function arcToCubics(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phi: number,
  fa: boolean,
  fs: boolean,
  x2: number,
  y2: number,
): Seg[] {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return [["L", x2, y2]];
  const p = (phi * Math.PI) / 180,
    cp = Math.cos(p),
    sp = Math.sin(p);
  const dx = (x1 - x2) / 2,
    dy = (y1 - y2) / 2,
    x1p = cp * dx + sp * dy,
    y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
  }
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, (rx * rx * ry * ry - den) / den));
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry,
    cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2,
    cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  else if (fs && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9)),
    del = dt / segs,
    k = (4 / 3) * Math.tan(del / 4);
  const map = (u: number, v: number): [number, number] => [
    cx + rx * cp * u - ry * sp * v,
    cy + rx * sp * u + ry * cp * v,
  ];
  const out: Seg[] = [];
  for (let s = 0; s < segs; s++) {
    const a = t1 + s * del,
      b = a + del,
      ca = Math.cos(a),
      sa = Math.sin(a),
      cb = Math.cos(b),
      sb = Math.sin(b);
    const c1 = map(ca - k * sa, sa + k * ca),
      c2 = map(cb + k * sb, sb - k * cb);
    const e = s === segs - 1 ? [x2, y2] : map(cb, sb);
    out.push(["C", c1[0], c1[1], c2[0], c2[1], e[0], e[1]]);
  }
  return out;
}

/** Path `d` for a rect, including rounded corners (rx/ry clamped to half the side). */
export function rectToD(x: number, y: number, w: number, h: number, rxIn: number | null, ryIn: number | null): string {
  let rx = rxIn,
    ry = ryIn;
  if (rx == null) rx = ry ?? 0;
  if (ry == null) ry = rx;
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  return rx > 0 && ry > 0
    ? `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
    : `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
}

export const ellipseToD = (cx: number, cy: number, rx: number, ry: number): string =>
  `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;

export const lineToD = (x1: number, y1: number, x2: number, y2: number): string => `M${x1} ${y1}L${x2} ${y2}`;

export const polyToD = (pts: { x: number; y: number }[], close: boolean): string =>
  "M" + pts.map((q) => `${q.x} ${q.y}`).join("L") + (close ? "Z" : "");

/** True when the element or any ancestor below `root` has display:none. */
export function isHidden(el: Element, root: Element): boolean {
  for (let a: Element | null = el; a && a !== root; a = a.parentElement)
    if (getComputedStyle(a).display === "none") return true;
  return false;
}

const FLAT_SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const FLAT_SKIP = new Set([
  "g",
  "a",
  "svg",
  "switch",
  "defs",
  "style",
  "title",
  "desc",
  "metadata",
  "linearGradient",
  "radialGradient",
  "stop",
  "symbol",
  "clipPath",
  "mask",
  "pattern",
  "marker",
  "filter",
]);

/** Computed colour → "none" | "#rrggbb" | named colour; `undefined` for url() paints (needs the original markup). */
export function cssColor(v: string | null | undefined): string | undefined {
  if (!v || v === "none") return "none";
  if (/^url\(/i.test(v)) return undefined;
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(v);
  if (!m) return v;
  if (m[4] != null && parseFloat(m[4]) === 0) return "none";
  return "#" + [m[1], m[2], m[3]].map((c) => Math.round(+c).toString(16).padStart(2, "0")).join("");
}

/**
 * Flatten every drawable shape under `g` (which must be attached to `host`) to absolute path segments in the part's
 * own user units, with each element's CTM relative to the part root baked in. Returns null — "keep the original
 * markup" — when the part has text, image, <use>, a clip-path, mask or filter, or a url() paint.
 */
export function extractFlat(g: SVGGElement, host: SVGSVGElement): FlatItem[] | null {
  const hostInv = host.getScreenCTM()!.inverse();
  const out: FlatItem[] = [];
  for (const el of g.querySelectorAll("*")) {
    if (el.namespaceURI !== SVGNS) continue;
    if (el.closest("defs,clipPath,mask,symbol,pattern,marker")) continue;
    const tag = el.localName;
    const cs = getComputedStyle(el);
    if (
      (cs.clipPath && cs.clipPath !== "none") ||
      (cs.mask && cs.mask !== "none") ||
      (cs.filter && cs.filter !== "none")
    )
      return null;
    if (FLAT_SKIP.has(tag)) continue;
    if (!FLAT_SHAPES.has(tag)) return null; // text, images, <use>: keep original markup
    if (isHidden(el, g)) continue;
    const fill = cssColor(cs.fill),
      stroke = cssColor(cs.stroke);
    if (fill === undefined || stroke === undefined) return null;
    if (fill === "none" && stroke === "none") continue;
    let d: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (k: string): number => (el as any)[k].baseVal.value;
    if (tag === "path") d = el.getAttribute("d") || "";
    else if (tag === "rect") {
      const w = v("width"),
        h = v("height");
      if (w <= 0 || h <= 0) continue;
      d = rectToD(v("x"), v("y"), w, h, el.hasAttribute("rx") ? v("rx") : null, el.hasAttribute("ry") ? v("ry") : null);
    } else if (tag === "circle" || tag === "ellipse") {
      const rx = tag === "circle" ? v("r") : v("rx"),
        ry = tag === "circle" ? v("r") : v("ry");
      if (rx <= 0 || ry <= 0) continue;
      d = ellipseToD(v("cx"), v("cy"), rx, ry);
    } else if (tag === "line") d = lineToD(v("x1"), v("y1"), v("x2"), v("y2"));
    else {
      const pts = [...(el as SVGPolygonElement).points];
      if (pts.length < 2) continue;
      d = polyToD(pts, tag === "polygon");
    }
    let segs: Seg[];
    try {
      segs = parsePathD(d);
    } catch {
      return null;
    }
    if (!segs.length) continue;
    const scr = (el as SVGGraphicsElement).getScreenCTM();
    if (!scr) continue;
    const m = hostInv.multiply(scr);
    for (const s of segs as unknown as number[][])
      for (let j = 1; j < s.length; j += 2) {
        const px = s[j],
          py = s[j + 1];
        s[j] = m.a * px + m.c * py + m.e;
        s[j + 1] = m.b * px + m.d * py + m.f;
      }
    const sw = (parseFloat(cs.strokeWidth) || 0) * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    const op = parseFloat(cs.opacity);
    const o = isNaN(op) ? 1 : op;
    out.push({
      segs,
      fill,
      stroke,
      sw,
      evenodd: cs.fillRule === "evenodd",
      fo: o * (parseFloat(cs.fillOpacity) || (cs.fillOpacity === "0" ? 0 : 1)),
      so: o * (parseFloat(cs.strokeOpacity) || (cs.strokeOpacity === "0" ? 0 : 1)),
    });
  }
  return out.length ? out : null;
}
