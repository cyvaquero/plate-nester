import { describe, expect, it } from "vitest";
import { SC } from "../../src/geometry/clip";
import { clearNfpCache } from "../../src/geometry/nfp";
import { ABORT, better, mulberry, noPacer, score, timedPacer } from "../../src/nest/common";
import { computeRectLayout, rectFits } from "../../src/nest/rect";
import { ShapeSearch } from "../../src/nest/search";
import { toNestPart } from "../../src/nest/shape";
import type { Layout, NestSettings, WirePart } from "../../src/nest/types";
import { L_SHAPE, centred, crescent, overlapArea, poly, star } from "./helpers";

const cfg: NestSettings = {
  plateW: 200,
  plateH: 200,
  kerf: 0.1,
  gap: 1,
  margin: 3,
  rotStep: 90,
  prec: 0.25,
  rotate90: true,
};
const ctx = { prec: cfg.prec, kerf: cfg.kerf, gap: cfg.gap, geoVer: 1 };

function wire(uid: number, name: string, pts: [number, number][], qty: number, lock = false): WirePart {
  const p = centred(poly(pts));
  const xs = pts.map((q) => q[0]),
    ys = pts.map((q) => q[1]);
  const w = Math.max(...xs) - Math.min(...xs),
    h = Math.max(...ys) - Math.min(...ys);
  let a = 0;
  for (let i = 0; i < p.length; i++) a += p[i].X * p[(i + 1) % p.length].Y - p[(i + 1) % p.length].X * p[i].Y;
  return {
    uid,
    name,
    qty,
    lock,
    outers: [p],
    areaMM: Math.abs(a) / 2 / (SC * SC),
    wMM: w,
    hMM: h,
    center: [0, 0],
    origin: [Math.min(...xs), Math.min(...ys)],
  };
}
const rectPart = (uid: number, w: number, h: number, qty: number, lock = false) =>
  wire(
    uid,
    `r${uid}`,
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
    qty,
    lock,
  );

const envOverlapMM2 = (a: Layout["plates"][0]["placements"][0], b: typeof a) =>
  overlapArea(
    a.env.map((q) => poly(q)),
    b.env.map((q) => poly(q)),
  ) /
  (SC * SC);

function expectNoOverlap(layout: Layout, tolMM2 = 0.05) {
  for (const pl of layout.plates)
    for (let i = 0; i < pl.placements.length; i++)
      for (let j = i + 1; j < pl.placements.length; j++)
        expect(envOverlapMM2(pl.placements[i], pl.placements[j])).toBeLessThanOrEqual(tolMM2);
}

describe("common", () => {
  it("mulberry32 is seeded and in [0,1)", () => {
    const a = mulberry(42),
      b = mulberry(42);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(mulberry(1)()).not.toBe(mulberry(2)());
  });
  it("scores by plate count, then by −Σ fill²", () => {
    expect(better(score([1, 1], 4), score([1, 1, 1], 4))).toBe(true);
    expect(better(score([3, 1], 4), score([2, 2], 4))).toBe(true); // more uneven = better
    expect(better(score([2, 2], 4), score([2, 2], 4))).toBe(false);
  });
});

describe("rect (MaxRects)", () => {
  const parts = [rectPart(1, 80, 50, 5), rectPart(2, 40, 40, 8), rectPart(3, 120, 30, 3)];
  it("places every part with no overlap, keeping spacing and margin", () => {
    const L = computeRectLayout(parts, cfg, { maxIterations: 50, budgetMs: 1e9 });
    expect(L.plates.reduce((s, p) => s + p.placements.length, 0)).toBe(16);
    const s = cfg.kerf + cfg.gap;
    for (const pl of L.plates) {
      for (const p of pl.placements) {
        for (const q of p.env[0]) {
          expect(q[0]).toBeGreaterThanOrEqual(cfg.margin - 1e-9);
          expect(q[1]).toBeGreaterThanOrEqual(cfg.margin - 1e-9);
          expect(q[0]).toBeLessThanOrEqual(cfg.plateW - cfg.margin + 1e-9);
          expect(q[1]).toBeLessThanOrEqual(cfg.plateH - cfg.margin + 1e-9);
        }
      }
      // boxes inflated by half the spacing must not overlap
      for (let i = 0; i < pl.placements.length; i++)
        for (let j = i + 1; j < pl.placements.length; j++) {
          const grow = (e: [number, number][]) => {
            const xs = e.map((q) => q[0]),
              ys = e.map((q) => q[1]);
            const x0 = Math.min(...xs) - s / 2,
              x1 = Math.max(...xs) + s / 2,
              y0 = Math.min(...ys) - s / 2,
              y1 = Math.max(...ys) + s / 2;
            return poly([
              [x0, y0],
              [x1, y0],
              [x1, y1],
              [x0, y1],
            ]);
          };
          expect(
            overlapArea([grow(pl.placements[i].env[0])], [grow(pl.placements[j].env[0])]) / (SC * SC),
          ).toBeLessThanOrEqual(0.001);
        }
    }
  });
  it("is deterministic for the same seed and iteration cap", () => {
    const run = () => computeRectLayout(parts, cfg, { seed: 99, maxIterations: 40, budgetMs: 1e9 });
    expect(run()).toEqual(run());
  });
  it("rotates 90° only when allowed and not locked", () => {
    const tall = [rectPart(1, 40, 150, 2)];
    const narrow = { ...cfg, plateW: 160, plateH: 60 };
    const L = computeRectLayout(tall, { ...narrow, rotate90: true }, { maxIterations: 5, budgetMs: 1e9 });
    expect(L.oversize).toEqual([]);
    expect(L.plates.flatMap((p) => p.placements).every((p) => p.ang === 90)).toBe(true);
    expect(computeRectLayout(tall, { ...narrow, rotate90: false }).oversize).toEqual([1]);
    expect(computeRectLayout([rectPart(1, 40, 150, 2, true)], narrow).oversize).toEqual([1]);
  });
  it("reports parts that cannot fit and an unusable margin", () => {
    expect(computeRectLayout([rectPart(1, 500, 10, 1)], cfg).oversize).toEqual([1]);
    expect(computeRectLayout([rectPart(1, 10, 10, 1)], { ...cfg, margin: 150 }).noArea).toBe(true);
  });
  it("rectFits honours margins and rotation", () => {
    expect(rectFits({ wMM: 194, hMM: 10, lock: false }, cfg)).toBe(true);
    expect(rectFits({ wMM: 195, hMM: 10, lock: false }, cfg)).toBe(false);
  });
  it("opens a new plate when full, and the minimum plate count is a lower bound", () => {
    const L = computeRectLayout([rectPart(1, 190, 190, 3)], cfg);
    expect(L.plates.length).toBe(3);
    expect(L.plates.length).toBeGreaterThanOrEqual(L.minPlates);
  });
});

describe("shape search", () => {
  const parts = () =>
    [wire(1, "star", star(), 4), wire(2, "l", L_SHAPE, 3), wire(3, "moon", crescent(), 4)].map(toNestPart);

  it("places every instance with envelopes that overlap by ≤ 0.05 mm² and stay in the frame", async () => {
    clearNfpCache();
    const s = new ShapeSearch(parts(), cfg, ctx);
    await s.run({ budgetMs: 1e9, maxIterations: 15 });
    const L = s.bestLayout!;
    expect(L.plates.reduce((n, p) => n + p.placements.length, 0)).toBe(11);
    expectNoOverlap(L);
    const half = (cfg.kerf + cfg.gap) / 2 + ctx.prec;
    for (const pl of L.plates)
      for (const p of pl.placements)
        for (const e of p.env)
          for (const [x, y] of e) {
            expect(x).toBeGreaterThanOrEqual(cfg.margin - half - 1e-3);
            expect(y).toBeGreaterThanOrEqual(cfg.margin - half - 1e-3);
            expect(x).toBeLessThanOrEqual(cfg.plateW - cfg.margin + half + 1e-3);
            expect(y).toBeLessThanOrEqual(cfg.plateH - cfg.margin + half + 1e-3);
          }
  });

  it("is deterministic for the same seed and iteration cap", async () => {
    const run = async () => {
      clearNfpCache();
      const s = new ShapeSearch(parts(), cfg, ctx, 1234);
      await s.run({ budgetMs: 1e9, maxIterations: 12 });
      return s.bestLayout;
    };
    expect(await run()).toEqual(await run());
  });

  it("a different seed can produce a different search path but never a worse-than-greedy result", async () => {
    const a = new ShapeSearch(parts(), cfg, ctx, 1);
    await a.run({ budgetMs: 1e9, maxIterations: 0 });
    const greedy = a.bestScore!;
    const b = new ShapeSearch(parts(), cfg, ctx, 2);
    await b.run({ budgetMs: 1e9, maxIterations: 10 });
    expect(better(greedy, b.bestScore!)).toBe(false);
  });

  it("streams strictly improving layouts and can be resumed", async () => {
    const s = new ShapeSearch(parts(), { ...cfg, plateW: 110, plateH: 110 }, { ...ctx, geoVer: 9 });
    const seen: number[] = [];
    await s.run({ budgetMs: 1e9, maxIterations: 6, onLayout: (l) => seen.push(l.plates.length) });
    expect(seen.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThanOrEqual(seen[i - 1]);
    const tried = s.tried;
    await s.run({ budgetMs: 1e9, maxIterations: 4 });
    expect(s.tried).toBeGreaterThan(tried);
  });

  it("is cancellable through the pacer", async () => {
    const s = new ShapeSearch(parts(), cfg, ctx);
    await expect(s.run({ budgetMs: 1e9, maxIterations: 50, pacer: timedPacer(() => true, -1) })).rejects.toBe(ABORT);
  });

  it("only uses allowed rotation angles; lock pins a part to 0°", async () => {
    const ps = [wire(1, "l", L_SHAPE, 4, true), wire(2, "moon", crescent(), 4)].map(toNestPart);
    const s = new ShapeSearch(ps, { ...cfg, rotStep: 90 }, ctx);
    await s.run({ budgetMs: 1e9, maxIterations: 5 });
    const placements = s.bestLayout!.plates.flatMap((p) => p.placements);
    expect(placements.filter((p) => p.partId === 1).every((p) => p.ang === 0)).toBe(true);
    expect(placements.every((p) => p.ang % 90 === 0)).toBe(true);
    const none = new ShapeSearch([wire(2, "moon", crescent(), 3)].map(toNestPart), { ...cfg, rotStep: 0 }, ctx);
    await none.run({ budgetMs: 1e9, maxIterations: 3 });
    expect(none.bestLayout!.plates.flatMap((p) => p.placements).every((p) => p.ang === 0)).toBe(true);
  });

  it("rotation helps: crescents and Ls fit on fewer plates than without rotation", async () => {
    const mk = () => [wire(1, "l", L_SHAPE, 6), wire(2, "moon", crescent(), 6)].map(toNestPart);
    const small = { ...cfg, plateW: 150, plateH: 150 };
    const a = new ShapeSearch(mk(), { ...small, rotStep: 0 }, { ...ctx, geoVer: 2 });
    await a.run({ budgetMs: 1e9, maxIterations: 8 });
    const b = new ShapeSearch(mk(), { ...small, rotStep: 45 }, { ...ctx, geoVer: 3 });
    await b.run({ budgetMs: 1e9, maxIterations: 8 });
    expect(b.bestLayout!.plates.length).toBeLessThanOrEqual(a.bestLayout!.plates.length);
  });

  it("reports oversize parts, zero-quantity parts and an unusable margin", async () => {
    const big = wire(
      1,
      "big",
      [
        [0, 0],
        [400, 0],
        [400, 20],
        [0, 20],
      ],
      1,
    );
    const ok = wire(2, "ok", star(), 0);
    const s = new ShapeSearch([big, ok].map(toNestPart), cfg, ctx);
    expect(s.oversize.map((p) => p.uid)).toEqual([1]);
    expect(s.items.length).toBe(0);
    expect(s.emptyLayout().oversize).toEqual([1]);
    expect(new ShapeSearch([], { ...cfg, margin: 120 }, ctx).emptyLayout().noArea).toBe(true);
  });

  it("noPacer never yields or cancels", async () => {
    await noPacer.tick();
  });
});
