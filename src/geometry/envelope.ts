import type { Path, Paths } from "clipper-lib";
import { CL, SC, area } from "./clip";

/** Convex hull (Andrew's monotone chain), oriented the way Clipper calls positive. */
export function hull(pts: Path): Path {
  const P = pts.slice().sort((a, b) => a.X - b.X || a.Y - b.Y);
  if (P.length < 3) return P;
  const cr = (o: Path[number], a: Path[number], b: Path[number]) =>
    (a.X - o.X) * (b.Y - o.Y) - (a.Y - o.Y) * (b.X - o.X);
  const lo: Path = [],
    up: Path = [];
  for (const p of P) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  if (!CL.Clipper.Orientation(h)) h.reverse();
  return h;
}

/** Ramer–Douglas–Peucker on a closed ring. Rings with fewer than 5 vertices are returned unchanged. */
export function rdp(path: Path, tol: number): Path {
  const n = path.length;
  if (n < 5) return path;
  let far = 0,
    fd = -1;
  for (let i = 1; i < n; i++) {
    const d = (path[i].X - path[0].X) ** 2 + (path[i].Y - path[0].Y) ** 2;
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const stack: [number, number][] = [
    [0, far],
    [far, n],
  ];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = path[a],
      B = path[b % n];
    const dx = B.X - A.X,
      dy = B.Y - A.Y,
      len = Math.hypot(dx, dy) || 1;
    let md = -1,
      mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (path[i].X - A.X) - dx * (path[i].Y - A.Y)) / len;
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > tol) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  const out: Path = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(path[i]);
  return out.length >= 3 ? out : path;
}

/** Ear-clipping triangulation, then Hertel–Mehlhorn merging into convex pieces that tile the polygon exactly. */
export function convexPieces(poly: Path): Path[] {
  const P = poly.map((v) => ({ X: v.X, Y: v.Y }));
  let sa = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i],
      b = P[(i + 1) % P.length];
    sa += a.X * b.Y - b.X * a.Y;
  }
  if (sa < 0) P.reverse();
  const cr = (a: Path[number], b: Path[number], c: Path[number]) =>
    (b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X);
  const idx = P.map((_, i) => i);
  const tris: number[][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length],
        ib = idx[k],
        ic = idx[(k + 1) % idx.length];
      const a = P[ia],
        b = P[ib],
        c = P[ic],
        z = cr(a, b, c);
      if (z === 0) {
        idx.splice(k, 1);
        cut = true;
        break;
      }
      if (z < 0) continue;
      let inside = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const q = P[j];
        if (cr(a, b, q) >= 0 && cr(b, c, q) >= 0 && cr(c, a, q) >= 0) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      tris.push([ia, ib, ic]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) return [poly]; // self-intersecting or degenerate: fall back to the whole outline
  }
  if (idx.length === 3) tris.push(idx.slice());
  const pcs = tris;
  const convexIdx = (r: number[]) => {
    for (let i = 0; i < r.length; i++)
      if (cr(P[r[i]], P[r[(i + 1) % r.length]], P[r[(i + 2) % r.length]]) < 0) return false;
    return true;
  };
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < pcs.length; i++)
      for (let j = i + 1; j < pcs.length; j++) {
        const A = pcs[i],
          B = pcs[j];
        for (let a = 0; a < A.length; a++) {
          const u = A[a],
            v = A[(a + 1) % A.length];
          const b = B.indexOf(v);
          if (b < 0 || B[(b + 1) % B.length] !== u) continue;
          const Ar = A.slice(a + 1).concat(A.slice(0, a + 1)); // v ... u
          const Br = B.slice(b + 1).concat(B.slice(0, b + 1)); // u ... v
          const m = Ar.concat(Br.slice(1, -1));
          if (convexIdx(m)) {
            pcs.splice(j, 1);
            pcs[i] = m;
            merged = true;
            break outer;
          }
        }
      }
  }
  return pcs.map((r) => r.map((i) => P[i]));
}

export interface Envelope {
  ver: number;
  /** Grown, simplified outer contours (integer units). */
  paths: Paths;
  /** Convex pieces tiling `paths`, used for NFP construction. */
  pieces: Path[];
  convex: boolean;
  tol: number;
  area: number;
}

export interface EnvelopeOptions {
  /** Outline precision, mm. */
  prec: number;
  kerf: number;
  gap: number;
}

export const ENVELOPE_MAX_VERTICES = 72;

/**
 * Spacing envelope: the outline simplified with RDP (tolerance = precision, raised ×1.5 until ≤ 72 vertices or 2 mm),
 * grown outward by (kerf+gap)/2 + tolerance with a mitre join (limit 2), snapped to its convex hull when within 1 %
 * of it, otherwise split into convex pieces.
 */
export function buildEnvelope(outers: Paths, opts: EnvelopeOptions, ver = 0): Envelope {
  let tol = opts.prec * SC;
  let simp: Paths = [];
  for (let tries = 0; tries < 8; tries++) {
    simp = outers.map((q) => rdp(q, tol * 0.8));
    if (simp.reduce((s, q) => s + q.length, 0) <= ENVELOPE_MAX_VERTICES || tol >= 2 * SC) break;
    tol *= 1.5;
  }
  simp.forEach((q) => {
    if (!CL.Clipper.Orientation(q)) q.reverse();
  });
  const off = new CL.ClipperOffset(2, tol * 0.5);
  off.AddPaths(simp, CL.JoinType.jtMiter, CL.EndType.etClosedPolygon);
  let res = new CL.Paths();
  off.Execute(res, ((opts.kerf + opts.gap) / 2) * SC + tol);
  res = res.filter((q) => CL.Clipper.Orientation(q)).map((q) => rdp(q, tol * 0.15));
  let convex = false;
  if (res.length === 1) {
    const h = hull(res[0]);
    if (area(h) - area(res[0]) <= area(h) * 0.01) {
      res = [h];
      convex = true;
    }
  }
  const pieces = convex ? [res[0]] : res.flatMap((q) => convexPieces(q));
  return { ver, paths: res, pieces, convex, tol, area: res.reduce((s, q) => s + area(q), 0) };
}
