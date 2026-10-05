import type { Path, Paths } from "clipper-lib";
import { CL } from "./clip";
import { hull } from "./envelope";

export interface NfpShape {
  /** Unique per (part, angle, geometry version): the cache key. */
  key: string;
  /** Convex pieces tiling the shape. */
  pieces: Path[];
}

const cache = new Map<string, Paths>();
const CACHE_LIMIT = 20000;

export const clearNfpCache = (): void => cache.clear();
export const nfpCacheSize = (): number => cache.size;

/** Minkowski difference of two convex polygons: hull of every vertex difference a − b. */
function convexSum(pa: Path, pb: Path): Path {
  const pts: Path = [];
  for (const a of pa) for (const b of pb) pts.push({ X: a.X - b.X, Y: a.Y - b.Y });
  return hull(pts);
}

/**
 * No-fit polygon A ⊕ (−B): the region where B's origin may NOT go when A sits at the origin. Built as the union of the
 * convex hulls of pairwise vertex differences over every pair of convex pieces, and cached by shape key pair.
 */
export function nfp(A: NfpShape, B: NfpShape): Paths {
  const key = A.key + "|" + B.key;
  let r = cache.get(key);
  if (r) return r;
  if (A.pieces.length === 1 && B.pieces.length === 1) r = [convexSum(A.pieces[0], B.pieces[0])];
  else {
    const c = new CL.Clipper();
    for (const pa of A.pieces) for (const pb of B.pieces) c.AddPath(convexSum(pa, pb), CL.PolyType.ptSubject, true);
    r = new CL.Paths();
    c.Execute(CL.ClipType.ctUnion, r, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  }
  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(key, r);
  return r;
}
