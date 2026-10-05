import { better, mulberry, score } from "./common";
import type { Score } from "./common";
import type { Layout, NestSettings, Placement, WirePart } from "./types";

const EPS = 1e-7;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Item {
  part: WirePart;
  /** Padded size (part + kerf + gap). */
  w: number;
  h: number;
  area: number;
  rot: boolean;
}
interface Used extends Rect {
  rot: boolean;
  item: Item;
  s1: number;
  s2: number;
}

/** Heuristics: 0 best short side, 1 best long side, 2 best area, 3 bottom-left. */
export const HEURISTICS = 4;

/** MaxRects bin. */
export class Bin {
  free: Rect[];
  used: Used[] = [];
  area = 0;
  constructor(
    readonly W: number,
    readonly H: number,
  ) {
    this.free = [{ x: 0, y: 0, w: W, h: H }];
  }

  find(w: number, h: number, canRot: boolean, heur: number): Omit<Used, "item"> | null {
    let best: Omit<Used, "item"> | null = null;
    const tryIt = (f: Rect, ww: number, hh: number, rot: boolean) => {
      if (ww > f.w + EPS || hh > f.h + EPS) return;
      let s1: number, s2: number;
      const lw = f.w - ww,
        lh = f.h - hh;
      if (heur === 0) {
        s1 = Math.min(lw, lh);
        s2 = Math.max(lw, lh);
      } else if (heur === 1) {
        s1 = Math.max(lw, lh);
        s2 = Math.min(lw, lh);
      } else if (heur === 2) {
        s1 = f.w * f.h - ww * hh;
        s2 = Math.min(lw, lh);
      } else {
        s1 = f.y + hh;
        s2 = f.x;
      }
      if (!best || s1 < best.s1 - EPS || (Math.abs(s1 - best.s1) <= EPS && s2 < best.s2))
        best = { x: f.x, y: f.y, w: ww, h: hh, rot, s1, s2 };
    };
    for (const f of this.free) {
      tryIt(f, w, h, false);
      if (canRot && Math.abs(w - h) > EPS) tryIt(f, h, w, true);
    }
    return best;
  }

  place(n: Used): void {
    const out: Rect[] = [];
    for (const f of this.free) {
      if (n.x >= f.x + f.w - EPS || n.x + n.w <= f.x + EPS || n.y >= f.y + f.h - EPS || n.y + n.h <= f.y + EPS) {
        out.push(f);
        continue;
      }
      if (n.x > f.x + EPS) out.push({ x: f.x, y: f.y, w: n.x - f.x, h: f.h });
      if (n.x + n.w < f.x + f.w - EPS) out.push({ x: n.x + n.w, y: f.y, w: f.x + f.w - n.x - n.w, h: f.h });
      if (n.y > f.y + EPS) out.push({ x: f.x, y: f.y, w: f.w, h: n.y - f.y });
      if (n.y + n.h < f.y + f.h - EPS) out.push({ x: f.x, y: n.y + n.h, w: f.w, h: f.y + f.h - n.y - n.h });
    }
    this.free = out.filter(
      (a, i) =>
        !out.some(
          (b, j) =>
            j !== i &&
            a.x >= b.x - EPS &&
            a.y >= b.y - EPS &&
            a.x + a.w <= b.x + b.w + EPS &&
            a.y + a.h <= b.y + b.h + EPS &&
            (j < i ||
              !(
                Math.abs(a.x - b.x) < EPS &&
                Math.abs(a.y - b.y) < EPS &&
                Math.abs(a.w - b.w) < EPS &&
                Math.abs(a.h - b.h) < EPS
              )),
        ),
    );
    this.used.push(n);
  }
}

function packOnce(items: Item[], order: number[], heur: number, W: number, H: number): Bin[] {
  const bins: Bin[] = [];
  for (const i of order) {
    const it = items[i];
    let done = false;
    for (const b of bins) {
      const r = b.find(it.w, it.h, it.rot, heur);
      if (r) {
        b.place({ ...r, item: it });
        b.area += it.area;
        done = true;
        break;
      }
    }
    if (!done) {
      const b = new Bin(W, H);
      const r = b.find(it.w, it.h, it.rot, heur)!;
      b.place({ ...r, item: it });
      b.area += it.area;
      bins.push(b);
    }
  }
  return bins;
}

export function rectFits(
  p: Pick<WirePart, "wMM" | "hMM" | "lock">,
  s: Pick<NestSettings, "plateW" | "plateH" | "margin" | "rotate90">,
): boolean {
  const bw = s.plateW - 2 * s.margin,
    bh = s.plateH - 2 * s.margin;
  const a = p.wMM <= bw + 1e-9 && p.hMM <= bh + 1e-9;
  const b = !p.lock && s.rotate90 && p.hMM <= bw + 1e-9 && p.wMM <= bh + 1e-9;
  return a || b;
}

export interface RectOptions {
  seed?: number;
  /** Local-search time budget, ms (default 350, only used when there is more than one item). */
  budgetMs?: number;
  /** Cap on local-search iterations, for deterministic runs. */
  maxIterations?: number;
}

/**
 * MaxRects bounding-box packing: 4 heuristics (best short side, best long side, best area, bottom-left) × 5 sort
 * orders, optionally rotating 90°, followed by a short seeded swap-based local search on the best ordering.
 * Padding: each box is grown by kerf+gap and the bin by the same amount, so parts end up kerf+gap apart.
 */
export function computeRectLayout(parts: WirePart[], cfg: NestSettings, opts: RectOptions = {}): Layout {
  const s = cfg.kerf + cfg.gap;
  const W = cfg.plateW - 2 * cfg.margin + s,
    H = cfg.plateH - 2 * cfg.margin + s;
  const items: Item[] = [],
    oversize: number[] = [];
  for (const p of parts) {
    if (!p.qty) continue;
    if (!rectFits(p, cfg)) {
      oversize.push(p.uid);
      continue;
    }
    for (let k = 0; k < p.qty; k++)
      items.push({ part: p, w: p.wMM + s, h: p.hMM + s, area: p.wMM * p.hMM, rot: cfg.rotate90 && !p.lock });
  }
  const noArea = cfg.plateW - 2 * cfg.margin <= 0 || cfg.plateH - 2 * cfg.margin <= 0;
  if (!items.length || W <= 0 || H <= 0) return { plates: [], oversize, minPlates: 0, noArea: noArea || undefined };
  const plateA = cfg.plateW * cfg.plateH;
  const scoreOf = (bins: Bin[]): Score =>
    score(
      bins.map((b) => b.area),
      plateA,
    );
  const keys: ((it: Item) => number)[] = [
    (it) => it.w * it.h,
    (it) => Math.max(it.w, it.h),
    (it) => it.h,
    (it) => it.w,
    (it) => it.w + it.h,
  ];
  let best: Bin[] | null = null,
    bestScore: Score | null = null,
    bestOrder: { order: number[]; h: number } | null = null;
  const idx = items.map((_, i) => i);
  for (const key of keys) {
    const order = [...idx].sort((a, b) => key(items[b]) - key(items[a]));
    for (let h = 0; h < HEURISTICS; h++) {
      const bins = packOnce(items, order, h, W, H),
        sc = scoreOf(bins);
      if (!best || better(sc, bestScore!)) {
        best = bins;
        bestScore = sc;
        bestOrder = { order, h };
      }
    }
  }
  // local search: perturb the best ordering for a short, fixed budget
  const rnd = mulberry(opts.seed ?? 1234),
    t0 = performance.now(),
    budget = items.length > 1 ? (opts.budgetMs ?? 350) : 0;
  let cur = bestOrder!.order,
    curH = bestOrder!.h,
    iterations = 0;
  while (performance.now() - t0 < budget && iterations++ < (opts.maxIterations ?? Infinity)) {
    const o = cur.slice(),
      n = o.length,
      a = Math.floor(rnd() * n),
      b = Math.floor(rnd() * n);
    [o[a], o[b]] = [o[b], o[a]];
    const h = rnd() < 0.8 ? curH : Math.floor(rnd() * HEURISTICS);
    const bins = packOnce(items, o, h, W, H),
      sc = scoreOf(bins);
    if (!better(bestScore!, sc)) {
      cur = o;
      curH = h;
      if (better(sc, bestScore!)) {
        best = bins;
        bestScore = sc;
      }
    }
  }
  const padA = items.reduce((a, it) => a + it.w * it.h, 0);
  const plates = best!.map((b) => ({
    area: b.area,
    placements: b.used.map((u): Placement => {
      const p = u.item.part;
      const x = cfg.margin + u.x,
        y = cfg.margin + u.y;
      const w = u.rot ? p.hMM : p.wMM,
        h = u.rot ? p.wMM : p.hMM;
      return {
        partId: p.uid,
        x: u.rot ? x + p.hMM : x,
        y,
        ang: u.rot ? 90 : 0,
        rx: p.origin[0],
        ry: p.origin[1],
        env: [
          [
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h],
          ],
        ],
      };
    }),
  }));
  return { plates, oversize, minPlates: Math.ceil(padA / (W * H) - 1e-9) };
}
