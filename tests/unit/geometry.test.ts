import type { Path } from "clipper-lib";
import { describe, expect, it } from "vitest";
import { CL, SC, area, bounds, rotatePaths } from "../../src/geometry/clip";
import { buildEnvelope, convexPieces, hull, rdp } from "../../src/geometry/envelope";
import { clearNfpCache, nfp } from "../../src/geometry/nfp";
import { buildOutline } from "../../src/geometry/outline";
import { L_SHAPE, crescent, overlapArea, poly, star, translate, unionArea } from "./helpers";

const isConvex = (p: Path) => {
  for (let i = 0; i < p.length; i++) {
    const a = p[i],
      b = p[(i + 1) % p.length],
      c = p[(i + 2) % p.length];
    if ((b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X) < 0) return false;
  }
  return true;
};
const polyArea = (p: Path) => Math.abs(area(p));
const segDist = (p: Path[number], a: Path[number], b: Path[number]) => {
  const dx = b.X - a.X,
    dy = b.Y - a.Y,
    l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.X - a.X) * dx + (p.Y - a.Y) * dy) / l2)) : 0;
  return Math.hypot(p.X - (a.X + t * dx), p.Y - (a.Y + t * dy));
};

describe("hull", () => {
  it("drops interior and collinear points and is positively oriented", () => {
    const pts = poly([
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 10],
      [5, 5],
      [0, 10],
      [3, 3],
      [0, 5],
    ]);
    const h = hull(pts);
    expect(h.length).toBe(4);
    expect(polyArea(h)).toBe(100 * SC * SC);
    expect(CL.Clipper.Orientation(h)).toBe(true);
  });
  it("returns tiny inputs unchanged", () => {
    expect(
      hull(
        poly([
          [0, 0],
          [1, 1],
        ]),
      ).length,
    ).toBe(2);
  });
});

describe("rdp", () => {
  it("collapses collinear points on a square", () => {
    const sq: [number, number][] = [];
    for (let i = 0; i < 10; i++) sq.push([i, 0]);
    for (let i = 0; i < 10; i++) sq.push([10, i]);
    for (let i = 10; i > 0; i--) sq.push([i, 10]);
    for (let i = 10; i > 0; i--) sq.push([0, i]);
    const r = rdp(poly(sq), 10);
    expect(r.length).toBe(4);
  });
  it("keeps every original vertex within the tolerance of the simplified ring", () => {
    const circle: [number, number][] = [];
    for (let i = 0; i < 720; i++) circle.push([20 * Math.cos((i * Math.PI) / 360), 20 * Math.sin((i * Math.PI) / 360)]);
    const orig = poly(circle);
    const tol = 0.2 * SC;
    const r = rdp(orig, tol);
    expect(r.length).toBeLessThan(60);
    expect(r.length).toBeGreaterThan(8);
    for (const p of orig) {
      let d = Infinity;
      for (let i = 0; i < r.length; i++) d = Math.min(d, segDist(p, r[i], r[(i + 1) % r.length]));
      expect(d).toBeLessThanOrEqual(tol + 1);
    }
  });
  it("leaves rings with fewer than 5 vertices alone", () => {
    const t = poly([
      [0, 0],
      [10, 0],
      [5, 8],
    ]);
    expect(rdp(t, 1e6)).toBe(t);
  });
});

describe("convexPieces", () => {
  const cases: [string, [number, number][]][] = [
    ["L bracket", L_SHAPE],
    ["5-point star", star()],
    ["crescent", crescent()],
    [
      "plus sign",
      [
        [10, 0],
        [20, 0],
        [20, 10],
        [30, 10],
        [30, 20],
        [20, 20],
        [20, 30],
        [10, 30],
        [10, 20],
        [0, 20],
        [0, 10],
        [10, 10],
      ],
    ],
  ];
  for (const [name, pts] of cases)
    it(`${name}: pieces are convex and cover the polygon exactly`, () => {
      const p = poly(pts);
      const pcs = convexPieces(p);
      expect(pcs.length).toBeGreaterThan(1);
      for (const c of pcs) expect(isConvex(c)).toBe(true);
      const total = polyArea(p);
      expect(pcs.reduce((s, c) => s + polyArea(c), 0)).toBe(total); // no overlap, no gap
      expect(unionArea(pcs)).toBe(total);
      expect(overlapArea(pcs, [p])).toBe(total);
    });
  it("merges triangles: an L needs only two convex pieces", () => {
    expect(convexPieces(poly(L_SHAPE)).length).toBe(2);
  });
  it("is orientation independent", () => {
    const p = poly(L_SHAPE).reverse();
    const pcs = convexPieces(p);
    expect(pcs.reduce((s, c) => s + polyArea(c), 0)).toBe(polyArea(p));
  });
  it("terminates and returns something for self-intersecting or degenerate input", () => {
    const bow = poly([
      [0, 0],
      [10, 10],
      [10, 0],
      [0, 10],
    ]);
    expect(convexPieces(bow).length).toBeGreaterThanOrEqual(1);
    const pent = poly([
      [0, 0],
      [10, 20],
      [20, 0],
      [-5, 12],
      [25, 12],
    ]); // pentagram order
    expect(convexPieces(pent).length).toBeGreaterThanOrEqual(1);
  });
});

describe("buildOutline", () => {
  const sq = (x: number, y: number, s: number) => ({
    closed: true,
    pts: [
      [x, y],
      [x + s, y],
      [x + s, y + s],
      [x, y + s],
    ] as [number, number][],
  });
  it("keeps outer contours only: an inner ring (hole) is solid", () => {
    const o = buildOutline([sq(0, 0, 20), sq(5, 5, 5)], 10, 10, 1, 1);
    expect(o.outers.length).toBe(1);
    expect(o.areaMM).toBeCloseTo(400, 6);
    expect(bounds(o.outers)).toEqual({ minX: -10 * SC, minY: -10 * SC, maxX: 10 * SC, maxY: 10 * SC });
  });
  it("unions overlapping shapes and keeps disjoint ones separate", () => {
    expect(buildOutline([sq(0, 0, 10), sq(5, 0, 10)], 0, 0, 1, 1).areaMM).toBeCloseTo(150, 6);
    expect(buildOutline([sq(0, 0, 10), sq(20, 0, 10)], 0, 0, 1, 1).outers.length).toBe(2);
  });
  it("applies the unit scale and orients contours positively", () => {
    const o = buildOutline([sq(0, 0, 10)], 0, 0, 2, 3);
    expect(o.areaMM).toBeCloseTo(600, 6);
    expect(o.outers.every((q) => CL.Clipper.Orientation(q))).toBe(true);
  });
  it("thickens open lines by 0.05 mm each side", () => {
    const o = buildOutline(
      [
        {
          closed: false,
          pts: [
            [0, 0],
            [10, 0],
          ],
        },
      ],
      0,
      0,
      1,
      1,
    );
    expect(o.outers.length).toBe(1);
    expect(o.areaMM).toBeGreaterThan(1.0);
    expect(o.areaMM).toBeLessThan(1.3);
  });
  it("ignores degenerate (zero-area) closed rings", () => {
    expect(
      buildOutline(
        [
          {
            closed: true,
            pts: [
              [0, 0],
              [10, 0],
              [20, 0],
            ],
          },
        ],
        0,
        0,
        1,
        1,
      ).outers.length,
    ).toBe(1); // falls to open-line thickening
  });
});

describe("buildEnvelope", () => {
  const opts = { prec: 0.25, kerf: 0.1, gap: 1 };
  it("grows a square by (kerf+gap)/2 + tolerance with square mitred corners", () => {
    const e = buildEnvelope(
      [
        poly([
          [-5, -5],
          [5, -5],
          [5, 5],
          [-5, 5],
        ]),
      ],
      opts,
    );
    const grow = 0.55 + 0.25;
    expect(bounds(e.paths)).toEqual({
      minX: -Math.round((5 + grow) * SC),
      minY: -Math.round((5 + grow) * SC),
      maxX: Math.round((5 + grow) * SC),
      maxY: Math.round((5 + grow) * SC),
    });
    expect(e.convex).toBe(true);
    expect(e.pieces.length).toBe(1);
  });
  it("simplifies a dense circle to ≤ 72 vertices and snaps to the hull", () => {
    const c: [number, number][] = [];
    for (let i = 0; i < 2000; i++)
      c.push([40 * Math.cos((i * 2 * Math.PI) / 2000), 40 * Math.sin((i * 2 * Math.PI) / 2000)]);
    const e = buildEnvelope([poly(c)], opts);
    expect(e.paths.length).toBe(1);
    expect(e.paths[0].length).toBeLessThanOrEqual(72);
    expect(e.convex).toBe(true);
    // the envelope contains the whole circle plus ≥ spacing/2
    const b = bounds(e.paths);
    expect(b.maxX).toBeGreaterThanOrEqual(Math.round((40 + 0.55) * SC));
  });
  it("raises the tolerance for very complex outlines (≤ 2 mm) to reach the vertex cap", () => {
    const wavy: [number, number][] = [];
    for (let i = 0; i < 1500; i++) {
      const t = (i * 2 * Math.PI) / 1500;
      wavy.push([(30 + 1.2 * Math.sin(40 * t)) * Math.cos(t), (30 + 1.2 * Math.sin(40 * t)) * Math.sin(t)]);
    }
    const e = buildEnvelope([poly(wavy)], opts);
    expect(e.tol).toBeGreaterThan(opts.prec * SC);
    expect(e.tol).toBeLessThanOrEqual(2 * SC * 1.5);
  });
  it("keeps concave shapes concave and splits them into convex pieces that tile it", () => {
    const e = buildEnvelope([poly(L_SHAPE)], opts);
    expect(e.convex).toBe(false);
    expect(e.pieces.length).toBeGreaterThan(1);
    for (const p of e.pieces) expect(isConvex(p)).toBe(true);
    expect(e.pieces.reduce((s, p) => s + polyArea(p), 0)).toBe(e.area);
    expect(unionArea(e.pieces)).toBe(e.area);
    // contains the original outline
    expect(overlapArea(e.paths, [poly(L_SHAPE)])).toBe(polyArea(poly(L_SHAPE)));
  });
  it("snaps a nearly convex shape (within 1% of its hull) to the hull", () => {
    const almost = poly([
      [0, 0],
      [100, 0],
      [100, 100],
      [51, 100],
      [50, 99.5],
      [49, 100],
      [0, 100],
    ]);
    expect(buildEnvelope([almost], opts).convex).toBe(true);
  });
});

describe("nfp", () => {
  const shapeOf = (key: string, pts: [number, number][]) => ({ key, poly: poly(pts), pieces: convexPieces(poly(pts)) });
  const inside = (paths: Path[], t: Path[number]) => {
    let n = 0;
    for (const p of paths) {
      const r = CL.Clipper.PointInPolygon(t, p);
      if (r === -1) return -1;
      if (r === 1) n++;
    }
    return n % 2;
  };

  it("two convex shapes: the NFP is the Minkowski difference hull", () => {
    clearNfpCache();
    const A = shapeOf("sqA", [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const B = shapeOf("sqB", [
      [0, 0],
      [4, 0],
      [4, 6],
      [0, 6],
    ]);
    const r = nfp(A, B);
    expect(r.length).toBe(1);
    expect(bounds(r)).toEqual({ minX: -4 * SC, minY: -6 * SC, maxX: 10 * SC, maxY: 10 * SC });
  });

  it("caches by key pair", () => {
    const A = shapeOf("cA", [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const B = shapeOf("cB", [
      [0, 0],
      [3, 0],
      [3, 3],
      [0, 3],
    ]);
    expect(nfp(A, B)).toBe(nfp(A, B));
  });

  const pairs: [string, [number, number][], [number, number][]][] = [
    ["L vs star", L_SHAPE, star(0, 0, 14, 6)],
    ["crescent vs L", crescent(), L_SHAPE],
    ["star vs crescent", star(0, 0, 25, 10), crescent()],
  ];
  for (const [name, pa, pb] of pairs) {
    it(`${name}: no overlap outside the NFP, overlap inside (grid)`, () => {
      clearNfpCache();
      const A = shapeOf("A" + name, pa),
        B = shapeOf("B" + name, pb);
      const N = nfp(A, B);
      const b = bounds(N);
      const step = 4 * SC + 137; // avoid landing exactly on axis-aligned boundaries
      let checked = 0;
      for (let x = b.minX - 2 * step; x <= b.maxX + 2 * step; x += step)
        for (let y = b.minY - 2 * step; y <= b.maxY + 2 * step; y += step) {
          const ins = inside(N, { X: x, Y: y });
          if (ins === -1) continue;
          const ov = overlapArea(A.poly ? [A.poly] : [], translate([B.poly], x, y));
          if (ins === 1) expect(ov, `inside at ${x},${y}`).toBeGreaterThan(0);
          else expect(ov, `outside at ${x},${y}`).toBe(0);
          checked++;
        }
      expect(checked).toBeGreaterThan(100);
    });

    it(`${name}: sliding contact — just outside every NFP edge touches without overlap, just inside overlaps`, () => {
      clearNfpCache();
      const A = shapeOf("sA" + name, pa),
        B = shapeOf("sB" + name, pb);
      const N = nfp(A, B);
      let edges = 0;
      for (const path of N)
        for (let i = 0; i < path.length; i++) {
          const p = path[i],
            q = path[(i + 1) % path.length];
          const len = Math.hypot(q.X - p.X, q.Y - p.Y);
          if (len < 200) continue;
          const mx = (p.X + q.X) / 2,
            my = (p.Y + q.Y) / 2,
            nx = -(q.Y - p.Y) / len,
            ny = (q.X - p.X) / len;
          const e = 3; // 3 integer units = 0.003 mm
          const a = { X: Math.round(mx + nx * e), Y: Math.round(my + ny * e) },
            c = { X: Math.round(mx - nx * e), Y: Math.round(my - ny * e) };
          const ia = inside(N, a),
            ic = inside(N, c);
          if (ia === -1 || ic === -1 || ia === ic) continue;
          const [out, inn] = ia === 0 ? [a, c] : [c, a];
          expect(overlapArea([A.poly], translate([B.poly], out.X, out.Y))).toBe(0);
          expect(overlapArea([A.poly], translate([B.poly], inn.X, inn.Y))).toBeGreaterThan(0);
          edges++;
        }
      expect(edges).toBeGreaterThan(5);
    });
  }

  it("rotating shapes keeps the NFP valid (rotated B)", () => {
    clearNfpCache();
    const A = shapeOf("rA", L_SHAPE);
    const Bp = rotatePaths([poly(star(0, 0, 14, 6))], 37)[0];
    const B = { key: "rB", poly: Bp, pieces: convexPieces(Bp) };
    const N = nfp(A, B);
    for (const t of [
      { X: 0, Y: 0 },
      { X: 20 * SC, Y: 5 * SC },
      { X: 200 * SC, Y: 0 },
      { X: -60 * SC, Y: -60 * SC },
    ]) {
      const ins = inside(N, t);
      const ov = overlapArea([A.poly], translate([B.poly], t.X, t.Y));
      expect(ins === 1).toBe(ov > 0);
    }
  });
});
