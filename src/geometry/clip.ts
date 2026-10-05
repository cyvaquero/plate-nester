import ClipperLib from "clipper-lib";
import type { Path, Paths } from "clipper-lib";

export const CL = ClipperLib;
export type { Path, Paths };

/** Clipper integer units per mm. */
export const SC = 1000;

/** Signed area in integer units² (positive for the orientation Clipper calls "true"). */
export const area = (path: Path): number => CL.Clipper.Area(path);

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bounds(paths: Paths): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of paths)
    for (const q of p) {
      if (q.X < minX) minX = q.X;
      if (q.Y < minY) minY = q.Y;
      if (q.X > maxX) maxX = q.X;
      if (q.Y > maxY) maxY = q.Y;
    }
  return { minX, minY, maxX, maxY };
}

/** Rotate integer paths about the origin by `ang` degrees (rounded back to integers). */
export function rotatePaths(paths: Paths, ang: number): Paths {
  if (ang === 0) return paths;
  const r = (ang * Math.PI) / 180,
    co = Math.cos(r),
    si = Math.sin(r);
  return paths.map((q) => q.map((v) => ({ X: Math.round(v.X * co - v.Y * si), Y: Math.round(v.X * si + v.Y * co) })));
}
