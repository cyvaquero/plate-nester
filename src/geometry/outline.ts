import type { Path } from "clipper-lib";
import type { Ring } from "../types";
import { CL, SC, area } from "./clip";

const SHAPES = "path,rect,circle,ellipse,polygon,polyline,line,text,use,image";

/**
 * Sample every drawable element under `g` (attached to `host`) into polylines in the part's user units.
 * Curves are sampled with getTotalLength/getPointAtLength every `stepU` user units; a jump in the sampled points
 * starts a new ring (a subpath boundary). rect/text/use/image contribute their bounding box.
 */
export function sampleRings(g: SVGGElement, host: SVGSVGElement, stepU: number): Ring[] {
  const hostInv = host.getScreenCTM()!.inverse();
  const rings: Ring[] = [];
  for (const el of g.querySelectorAll(SHAPES)) {
    if (el.closest("defs,clipPath,mask,symbol,pattern,marker")) continue;
    const scr = (el as SVGGraphicsElement).getScreenCTM();
    if (!scr) continue;
    const m = hostInv.multiply(scr);
    const T = (x: number, y: number): [number, number] => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
    const tag = el.localName;
    if (tag === "rect" || tag === "text" || tag === "use" || tag === "image") {
      const b = (el as SVGGraphicsElement).getBBox();
      if (!b.width && !b.height) continue;
      rings.push({
        closed: true,
        pts: [T(b.x, b.y), T(b.x + b.width, b.y), T(b.x + b.width, b.y + b.height), T(b.x, b.y + b.height)],
      });
    } else if (tag === "polygon" || tag === "polyline") {
      const pts = [...(el as SVGPolygonElement).points].map((q) => T(q.x, q.y));
      if (pts.length > 1) rings.push({ closed: tag === "polygon", pts });
    } else if (tag === "line") {
      rings.push({
        closed: false,
        pts: [
          T(+(el.getAttribute("x1") ?? 0) || 0, +(el.getAttribute("y1") ?? 0) || 0),
          T(+(el.getAttribute("x2") ?? 0) || 0, +(el.getAttribute("y2") ?? 0) || 0),
        ],
      });
    } else {
      const geo = el as SVGGeometryElement;
      let L = 0;
      try {
        L = geo.getTotalLength();
      } catch {
        /* not a geometry element */
      }
      if (!(L > 0)) continue;
      const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
      const n = Math.min(6000, Math.max(24, Math.ceil((L * scale) / stepU)));
      const step = L / n;
      let cur: [number, number][] = [];
      let prev: DOMPoint | null = null;
      for (let i = 0; i <= n; i++) {
        const q = geo.getPointAtLength(Math.min(L, i * step));
        if (prev && Math.hypot(q.x - prev.x, q.y - prev.y) > step * 2.5) {
          if (cur.length > 1) rings.push({ closed: true, pts: cur });
          cur = [];
        }
        cur.push(T(q.x, q.y));
        prev = q;
      }
      if (cur.length > 1) {
        const a = cur[0],
          b = cur[cur.length - 1];
        const closed =
          tag !== "path" ||
          Math.hypot(a[0] - b[0], a[1] - b[1]) < step * 2.5 ||
          /z\s*$/i.test(el.getAttribute("d") || "");
        rings.push({ closed, pts: cur });
      }
    }
  }
  return rings;
}

export interface Outline {
  /** Outer contours, positively oriented, in integer clipper units centred on (cx, cy). */
  outers: Path[];
  areaMM: number;
}

/**
 * Union every ring (Clipper NonZero) and keep outer contours only — holes and engraving inside are treated as solid.
 * Coordinates are converted from user units to mm × SC and centred on (cx, cy). Open lines are thickened by 0.05 mm.
 */
export function buildOutline(rings: Ring[], cx: number, cy: number, kx: number, ky: number): Outline {
  const toInt = (r: Ring): Path =>
    r.pts.map(([x, y]) => ({ X: Math.round((x - cx) * kx * SC), Y: Math.round((y - cy) * ky * SC) }));
  const c = new CL.Clipper();
  const open: Path[] = [];
  for (const r of rings) {
    const path = toInt(r);
    if (r.closed && path.length >= 3 && Math.abs(area(path)) > SC * SC * 0.01)
      c.AddPath(path, CL.PolyType.ptSubject, true);
    else open.push(path);
  }
  if (open.length) {
    const off = new CL.ClipperOffset(2, 0.05 * SC);
    off.AddPaths(open, CL.JoinType.jtSquare, CL.EndType.etOpenSquare);
    const res = new CL.Paths();
    off.Execute(res, 0.05 * SC);
    c.AddPaths(res, CL.PolyType.ptSubject, true);
  }
  const tree = new CL.PolyTree();
  c.Execute(CL.ClipType.ctUnion, tree, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  const outers = tree
    .Childs()
    .map((n) => n.Contour())
    .filter((q) => q.length >= 3);
  outers.forEach((q) => {
    if (!CL.Clipper.Orientation(q)) q.reverse();
  });
  const areaMM = outers.reduce((s, q) => s + Math.abs(area(q)), 0) / (SC * SC);
  return { outers, areaMM };
}
