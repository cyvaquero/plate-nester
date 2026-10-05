import { better, mulberry, noPacer, score } from "./common";
import type { Pacer, Score } from "./common";
import { angleList, binFrame, binsToPlates, envelope, fitsPlate, pack, shape } from "./shape";
import type { Frame, GeoCtx, NestPart, PackItem } from "./shape";
import type { Layout, NestSettings } from "./types";

export interface SearchCallbacks {
  /** Called whenever a strictly better layout is found. */
  onLayout?: (layout: Layout) => void;
  /** Called after every layout tried. */
  onProgress?: (tried: number, elapsedMs: number) => void;
}

export interface RunOptions extends SearchCallbacks {
  budgetMs: number;
  /** Stop after this many mutation iterations (makes runs deterministic regardless of machine speed). */
  maxIterations?: number;
  pacer?: Pacer;
}

/**
 * True-shape order search. Starts from greedy orders (largest envelope area, longest side), then mutates the best
 * order with swap / move operations within a time budget. Seeded, cancellable (through the pacer) and resumable:
 * call `run` again to continue from the best order found so far.
 */
export class ShapeSearch {
  readonly items: PackItem[] = [];
  readonly oversize: NestPart[] = [];
  readonly frame: Frame;
  minPlates = 0;
  tried = 0;
  bestScore: Score | null = null;
  bestOrder: number[] | null = null;
  bestLayout: Layout | null = null;
  noArea = false;
  private initialised = false;
  private rnd: () => number;
  private cur: number[] | null = null;
  private curScore: Score | null = null;
  private readonly plateA: number;

  constructor(
    parts: NestPart[],
    private readonly cfg: NestSettings,
    private readonly ctx: GeoCtx,
    seed = 7,
  ) {
    this.frame = binFrame({ ...cfg, prec: ctx.prec });
    this.plateA = cfg.plateW * cfg.plateH;
    this.rnd = mulberry(seed);
    const F = this.frame;
    if (F.R <= F.L || F.B <= F.T) {
      this.noArea = true;
      return;
    }
    for (const p of parts) {
      if (!p.qty) continue;
      if (!fitsPlate(p, F, cfg.rotStep, ctx)) {
        this.oversize.push(p);
        continue;
      }
      const e = envelope(p, ctx);
      for (let k = 0; k < p.qty; k++) this.items.push({ part: p, envArea: e.area });
    }
    this.minPlates = this.items.length
      ? Math.ceil(this.items.reduce((s, it) => s + it.envArea, 0) / ((F.R - F.L) * (F.B - F.T)) - 1e-9)
      : 0;
  }

  private layoutOf(bins: Parameters<typeof binsToPlates>[0]): Layout {
    return { plates: binsToPlates(bins), oversize: this.oversize.map((p) => p.uid), minPlates: this.minPlates };
  }

  /** The layout to show before any packing has happened (empty, with oversize and area warnings). */
  emptyLayout(): Layout {
    return {
      plates: [],
      oversize: this.oversize.map((p) => p.uid),
      minPlates: this.minPlates,
      noArea: this.noArea || undefined,
    };
  }

  private angs = (it: PackItem) => angleList(it.part, this.cfg.rotStep);

  /** True when there is nothing left to improve. */
  get finished(): boolean {
    return (
      !this.items.length || (this.bestScore !== null && this.bestScore[0] <= this.minPlates && this.bestScore[0] === 1)
    );
  }

  /** Run (or continue) the search for up to `budgetMs`. Throws ABORT if the pacer cancels the run. */
  async run(opts: RunOptions): Promise<void> {
    const pacer = opts.pacer ?? noPacer;
    const t0 = performance.now();
    const progress = () => opts.onProgress?.(this.tried, performance.now() - t0);
    if (!this.items.length) return;
    if (!this.initialised) {
      this.initialised = true;
      const idx = this.items.map((_, i) => i);
      const keys: ((it: PackItem) => number)[] = [
        (it) => it.envArea,
        (it) => {
          const s = shape(it.part, 0, this.ctx);
          return Math.max(s.maxX - s.minX, s.maxY - s.minY);
        },
      ];
      for (const key of keys) {
        const order = [...idx].sort(
          (a, b) => key(this.items[b]) - key(this.items[a]) || this.items[a].part.uid - this.items[b].part.uid,
        );
        const bins = await pack(this.items, order, this.angs, this.frame, this.ctx, pacer);
        this.tried++;
        const sc = score(
          bins.map((b) => b.area),
          this.plateA,
        );
        if (!this.bestScore || better(sc, this.bestScore)) {
          this.bestOrder = order;
          this.bestScore = sc;
          this.bestLayout = this.layoutOf(bins);
          opts.onLayout?.(this.bestLayout);
        }
        progress();
      }
      this.cur = this.bestOrder;
      this.curScore = this.bestScore;
    }
    if (this.items.length < 2) return;
    let iterations = 0;
    while (performance.now() - t0 < opts.budgetMs && iterations++ < (opts.maxIterations ?? Infinity)) {
      if (this.finished) break;
      const o = this.cur!.slice(),
        n = o.length;
      const moves = 1 + Math.floor(this.rnd() * 3);
      for (let m = 0; m < moves; m++) {
        const a = Math.floor(this.rnd() * n),
          b = Math.floor(this.rnd() * n);
        if (this.rnd() < 0.5) [o[a], o[b]] = [o[b], o[a]];
        else {
          const [x] = o.splice(a, 1);
          o.splice(b, 0, x);
        }
      }
      const bins = await pack(this.items, o, this.angs, this.frame, this.ctx, pacer);
      this.tried++;
      const sc = score(
        bins.map((b) => b.area),
        this.plateA,
      );
      if (!better(this.curScore!, sc)) {
        this.cur = o;
        this.curScore = sc;
      }
      if (better(sc, this.bestScore!)) {
        this.bestOrder = o;
        this.bestScore = sc;
        this.bestLayout = this.layoutOf(bins);
        opts.onLayout?.(this.bestLayout);
      }
      progress();
    }
  }
}
