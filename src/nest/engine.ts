import { clearNfpCache } from "../geometry/nfp";
import { ABORT, timedPacer } from "./common";
import { computeRectLayout } from "./rect";
import { ShapeSearch } from "./search";
import { toNestPart } from "./shape";
import type { NestPart } from "./shape";
import type { MoreRequest, Response, RunRequest } from "./protocol";

/**
 * The nesting engine behind the worker: owns the current search so "search more" can resume it, and a run token so
 * a newer request (or `stop`) cancels whatever is in flight at its next yield point.
 */
export class Engine {
  private token = 0;
  private search: ShapeSearch | null = null;
  private geoVer = -1;
  private parts = new Map<number, NestPart>();

  constructor(private readonly post: (r: Response) => void) {}

  stop(): void {
    this.token++;
  }

  async run(req: RunRequest): Promise<void> {
    const token = ++this.token;
    const cancelled = () => token !== this.token;
    try {
      if (req.mode === "bbox") {
        this.search = null;
        const layout = computeRectLayout(req.parts, req.settings, { seed: req.seed, maxIterations: req.maxIterations });
        if (cancelled()) return;
        this.post({ type: "layout", id: req.id, layout });
        this.post({
          type: "done",
          id: req.id,
          tried: 0,
          bestPlates: layout.plates.length,
          minPlates: layout.minPlates,
          canSearchMore: false,
        });
        return;
      }
      if (req.geoVer !== this.geoVer) {
        this.geoVer = req.geoVer;
        this.parts.clear();
        clearNfpCache();
      }
      const parts = req.parts.map((w) => {
        const existing = this.parts.get(w.uid);
        const p = existing ? Object.assign(existing, { qty: w.qty, lock: w.lock }) : toNestPart(w);
        this.parts.set(w.uid, p);
        return p;
      });
      for (const uid of [...this.parts.keys()]) if (!req.parts.some((w) => w.uid === uid)) this.parts.delete(uid);
      const ctx = { prec: req.settings.prec, kerf: req.settings.kerf, gap: req.settings.gap, geoVer: req.geoVer };
      const search = new ShapeSearch(parts, req.settings, ctx, req.seed);
      this.search = search;
      this.post({ type: "layout", id: req.id, layout: search.emptyLayout() });
      await this.drive(search, req.id, req.budgetMs, token, req.maxIterations);
    } catch (e) {
      this.fail(req.id, e);
    }
  }

  async more(req: MoreRequest): Promise<void> {
    const search = this.search;
    if (!search) return;
    const token = ++this.token;
    try {
      await this.drive(search, req.id, req.budgetMs, token);
    } catch (e) {
      this.fail(req.id, e);
    }
  }

  private async drive(
    search: ShapeSearch,
    id: number,
    budgetMs: number,
    token: number,
    maxIterations?: number,
  ): Promise<void> {
    const cancelled = () => token !== this.token;
    await search.run({
      budgetMs,
      maxIterations,
      pacer: timedPacer(cancelled),
      onLayout: (layout) => {
        if (!cancelled()) this.post({ type: "layout", id, layout });
      },
      onProgress: (tried, elapsedMs) => {
        if (!cancelled()) this.post({ type: "progress", id, tried, elapsedMs, budgetMs });
      },
    });
    if (cancelled()) return;
    const bestPlates = search.bestLayout?.plates.length ?? 0;
    this.post({
      type: "done",
      id,
      tried: search.tried,
      bestPlates,
      minPlates: search.minPlates,
      canSearchMore: search.items.length > 1 && !search.finished,
    });
  }

  private fail(id: number, e: unknown): void {
    if (e === ABORT) return;
    console.error(e);
    this.post({ type: "error", id, message: e instanceof Error ? e.message : String(e) });
  }
}
