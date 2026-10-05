import type { Path, Paths } from "clipper-lib";
import { CL, SC } from "../../src/geometry/clip";
import type { Seg } from "../../src/types";

/** Polygon from [x, y] points in mm → integer clipper path. */
export const poly = (pts: [number, number][]): Path =>
  pts.map(([x, y]) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) }));

export const translate = (p: Paths, dx: number, dy: number): Paths =>
  p.map((q) => q.map((v) => ({ X: v.X + dx, Y: v.Y + dy })));

/** Total area (integer units²) of the intersection of two path sets. */
export function overlapArea(a: Paths, b: Paths): number {
  const c = new CL.Clipper();
  c.AddPaths(a, CL.PolyType.ptSubject, true);
  c.AddPaths(b, CL.PolyType.ptClip, true);
  const r = new CL.Paths();
  c.Execute(CL.ClipType.ctIntersection, r, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  return r.reduce((s, q) => s + Math.abs(CL.Clipper.Area(q)), 0);
}

export function unionArea(paths: Paths): number {
  const c = new CL.Clipper();
  c.AddPaths(paths, CL.PolyType.ptSubject, true);
  const r = new CL.Paths();
  c.Execute(CL.ClipType.ctUnion, r, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  return r.reduce((s, q) => s + Math.abs(CL.Clipper.Area(q)), 0);
}

/** Sample the cubic/line segments of a flattened path into points (absolute coordinates). */
export function samplePath(segs: Seg[], perCurve = 16): [number, number][] {
  const out: [number, number][] = [];
  let cx = 0,
    cy = 0;
  for (const s of segs as unknown as (string | number)[][]) {
    const t = s[0];
    const v = s.slice(1) as number[];
    if (t === "M" || t === "L") {
      [cx, cy] = [v[0], v[1]];
      out.push([cx, cy]);
    } else if (t === "C") {
      for (let i = 1; i <= perCurve; i++) {
        const u = i / perCurve,
          w = 1 - u;
        out.push([
          w * w * w * cx + 3 * w * w * u * v[0] + 3 * w * u * u * v[2] + u * u * u * v[4],
          w * w * w * cy + 3 * w * w * u * v[1] + 3 * w * u * u * v[3] + u * u * u * v[5],
        ]);
      }
      [cx, cy] = [v[4], v[5]];
    }
  }
  return out;
}

export const star = (cx = 0, cy = 0, R = 30, r = 12, n = 5): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2,
      rad = i % 2 ? r : R;
    out.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  return out;
};

export const L_SHAPE: [number, number][] = [
  [0, 0],
  [80, 0],
  [80, 16],
  [16, 16],
  [16, 60],
  [0, 60],
];

/** Crescent: outer arc through the left, inner arc back (both ends at (30,0) and (30,60)). */
export function crescent(): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = Math.PI / 2 + (Math.PI * i) / 24; // 90° → 270°
    out.push([30 + 30 * Math.cos(t), 30 - 30 * Math.sin(t)]);
  }
  const R = Math.hypot(30, 20),
    a0 = Math.atan2(30, -20),
    a1 = Math.atan2(-30, -20) + 2 * Math.PI;
  for (let i = 1; i < 24; i++) {
    const t = a0 + ((a1 - a0) * i) / 24;
    out.push([50 + R * Math.cos(t), 30 + R * Math.sin(t)]);
  }
  return out;
}

/** Re-centre integer paths on their bounding-box centre, as the outline stage does. */
export function centred(p: Path): Path {
  const xs = p.map((v) => v.X),
    ys = p.map((v) => v.Y);
  const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
    cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
  return p.map((v) => ({ X: v.X - cx, Y: v.Y - cy }));
}
