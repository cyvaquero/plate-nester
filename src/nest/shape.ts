import type { Path, Paths } from "clipper-lib";
import { CL, SC, bounds, rotatePaths } from "../geometry/clip";
import type { Bounds } from "../geometry/clip";
import { buildEnvelope } from "../geometry/envelope";
import type { Envelope } from "../geometry/envelope";
import { nfp } from "../geometry/nfp";
import type { Pacer } from "./common";
import type { NestSettings, Placement, WirePart } from "./types";

export interface GeoCtx {
  prec: number;
  kerf: number;
  gap: number;
  /** Bumped whenever anything that changes a part's geometry changes (kerf, gap, precision, scale, parts). */
  geoVer: number;
}

/** A part inside the nesting engine, with lazily built envelope and per-angle shapes. */
export interface NestPart extends WirePart {
  env: Envelope | null;
  shapes: Map<number, Shape>;
}

export const toNestPart = (w: WirePart): NestPart => ({ ...w, env: null, shapes: new Map() });

/** A part's envelope at one rotation angle. */
export interface Shape extends Bounds {
  key: string;
  part: NestPart;
  ang: number;
  paths: Paths;
  pieces: Path[];
  convex: boolean;
  area: number;
}

export function envelope(p: NestPart, ctx: GeoCtx): Envelope {
  if (p.env && p.env.ver === ctx.geoVer) return p.env;
  p.env = buildEnvelope(p.outers, ctx, ctx.geoVer);
  p.shapes = new Map();
  return p.env;
}

export function shape(p: NestPart, ang: number, ctx: GeoCtx): Shape {
  const env = envelope(p, ctx);
  let s = p.shapes.get(ang);
  if (s) return s;
  const paths = rotatePaths(env.paths, ang);
  s = {
    key: `${p.uid}:${ang}:${ctx.geoVer}`,
    part: p,
    ang,
    paths,
    pieces: rotatePaths(env.pieces, ang),
    convex: env.convex,
    area: env.area,
    ...bounds(paths),
  };
  p.shapes.set(ang, s);
  return s;
}

/** The usable region for envelope origins, integer units. Envelopes may overhang the margin line by their spacing. */
export interface Frame {
  L: number;
  T: number;
  R: number;
  B: number;
}

export function binFrame(s: Pick<NestSettings, "kerf" | "gap" | "margin" | "plateW" | "plateH" | "prec">): Frame {
  const half = (s.kerf + s.gap) / 2,
    tol = s.prec;
  return {
    L: (s.margin - half - tol) * SC,
    T: (s.margin - half - tol) * SC,
    R: (s.plateW - s.margin + half + tol) * SC,
    B: (s.plateH - s.margin + half + tol) * SC,
  };
}

export interface BinItem {
  s: Shape;
  x: number;
  y: number;
}
export interface Bin {
  items: BinItem[];
  /** Σ true part area, mm². */
  area: number;
  /** Σ envelope area, integer units². */
  envArea: number;
  bb: { x0: number; y0: number; x1: number; y1: number };
}

export const newBin = (): Bin => ({
  items: [],
  area: 0,
  envArea: 0,
  bb: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
});

export function addTo(bin: Bin, s: Shape, pos: { x: number; y: number }): void {
  bin.items.push({ s, x: pos.x, y: pos.y });
  bin.area += s.part.areaMM;
  bin.envArea += s.area;
  const b = bin.bb;
  b.x0 = Math.min(b.x0, pos.x + s.minX);
  b.y0 = Math.min(b.y0, pos.y + s.minY);
  b.x1 = Math.max(b.x1, pos.x + s.maxX);
  b.y1 = Math.max(b.y1, pos.y + s.maxY);
}

export interface Pos {
  x: number;
  y: number;
  sc: number;
}

/**
 * Best position for shape `Bs` on `bin`: the feasible region is the inner-fit rectangle minus the union of the
 * translated NFPs of everything already placed (Clipper difference). Candidates are the region's vertices; the score
 * is the area of the bounding box of all placed parts plus a tiny y + 0.5·x tie-break.
 */
export function bestPos(bin: Bin, Bs: Shape, F: Frame): Pos | null {
  const xMin = F.L - Bs.minX,
    yMin = F.T - Bs.minY;
  let xMax = F.R - Bs.maxX,
    yMax = F.B - Bs.maxY;
  if (xMin > xMax || yMin > yMax) return null;
  if (xMax - xMin < 2) xMax = xMin + 2;
  if (yMax - yMin < 2) yMax = yMin + 2;
  const ifp: Path = [
    { X: xMin, Y: yMin },
    { X: xMax, Y: yMin },
    { X: xMax, Y: yMax },
    { X: xMin, Y: yMax },
  ];
  let region: Paths;
  if (!bin.items.length) region = [ifp];
  else {
    const c = new CL.Clipper();
    c.AddPath(ifp, CL.PolyType.ptSubject, true);
    for (const it of bin.items) {
      // skip neighbours that can't reach the inner-fit rectangle
      if (
        it.x + it.s.maxX - Bs.minX < xMin ||
        it.x + it.s.minX - Bs.maxX > xMax ||
        it.y + it.s.maxY - Bs.minY < yMin ||
        it.y + it.s.minY - Bs.maxY > yMax
      )
        continue;
      for (const q of nfp(it.s, Bs))
        c.AddPath(
          q.map((v) => ({ X: v.X + it.x, Y: v.Y + it.y })),
          CL.PolyType.ptClip,
          true,
        );
    }
    region = new CL.Paths();
    c.Execute(CL.ClipType.ctDifference, region, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  }
  let best: Pos | null = null;
  const bb = bin.bb;
  for (const path of region)
    for (const v of path) {
      const x0 = Math.min(bb.x0, v.X + Bs.minX),
        y0 = Math.min(bb.y0, v.Y + Bs.minY),
        x1 = Math.max(bb.x1, v.X + Bs.maxX),
        y1 = Math.max(bb.y1, v.Y + Bs.maxY);
      const sc = ((x1 - x0) / SC) * ((y1 - y0) / SC) + ((v.Y + v.X * 0.5) / SC) * 1e-3;
      if (!best || sc < best.sc) best = { x: v.X, y: v.Y, sc };
    }
  return best;
}

export interface PackItem {
  part: NestPart;
  envArea: number;
}

/** Every allowed rotation angle for a part. */
export function angleList(p: NestPart, rotStep: number): number[] {
  if (p.lock || !rotStep) return [0];
  const out: number[] = [];
  for (let a = 0; a < 360; a += rotStep) out.push(a);
  return out;
}

export function fitsPlate(p: NestPart, F: Frame, rotStep: number, ctx: GeoCtx): boolean {
  return angleList(p, rotStep).some((a) => {
    const s = shape(p, a, ctx);
    return F.R - F.L >= s.maxX - s.minX && F.B - F.T >= s.maxY - s.minY;
  });
}

/**
 * Multi-plate first-fit: place `order`'s items one by one on the first plate where they fit, trying every allowed
 * rotation and keeping the best-scoring one; open a new plate when none fits.
 */
export async function pack(
  items: PackItem[],
  order: number[],
  angs: (it: PackItem) => number[],
  F: Frame,
  ctx: GeoCtx,
  pacer: Pacer,
): Promise<Bin[]> {
  const bins: Bin[] = [];
  const frameA = (F.R - F.L) * (F.B - F.T);
  const tryAngles = (bin: Bin, it: PackItem, list: number[]) => {
    let best: { s: Shape; pos: Pos } | null = null;
    for (const a of list) {
      const s = shape(it.part, a, ctx);
      const pos = bestPos(bin, s, F);
      if (pos && (!best || pos.sc < best.pos.sc)) best = { s, pos };
    }
    return best;
  };
  for (const i of order) {
    const it = items[i];
    let done = false;
    const list = angs(it);
    for (const bin of bins) {
      if (frameA - bin.envArea < it.envArea * 0.98) continue;
      const best = tryAngles(bin, it, list);
      if (best) {
        addTo(bin, best.s, best.pos);
        done = true;
        break;
      }
      await pacer.tick();
    }
    if (!done) {
      const bin = newBin();
      const best = tryAngles(bin, it, list);
      if (best) {
        addTo(bin, best.s, best.pos);
        bins.push(bin);
      }
    }
    await pacer.tick();
  }
  return bins;
}

/** Convert packed bins to plain placements (plate mm), with the preview envelopes in plate coordinates. */
export function binsToPlates(bins: Bin[]): { placements: Placement[]; area: number }[] {
  return bins.map((b) => ({
    area: b.area,
    placements: b.items.map((it) => ({
      partId: it.s.part.uid,
      x: it.x / SC,
      y: it.y / SC,
      ang: it.s.ang,
      rx: it.s.part.center[0],
      ry: it.s.part.center[1],
      env: it.s.paths.map((q) => q.map((v): [number, number] => [(v.X + it.x) / SC, (v.Y + it.y) / SC])),
    })),
  }));
}
