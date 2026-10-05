/**
 * Public API: nest SVG parts onto plates from your own page.
 *
 * ```ts
 * import { nest } from "plate-nester/src/lib";
 * const result = await nest([{ name: "star.svg", svg: text, qty: 4 }], { plateW: 300, plateH: 300, kerf: 0.1 });
 * result.plates; // one SVG string per plate (mm units, one object per part)
 * ```
 *
 * Parsing needs the DOM (main thread); nesting runs in a Web Worker so the page stays responsive.
 * All lengths are millimetres.
 */
import { downloadBlob, plateFilename, plateSVG, zipPlates } from "./export/plate";
import { NestClient } from "./nest/client";
import type { Layout } from "./nest/types";
import { toNestSettings, toWire } from "./nest/wire";
import { parseSVG } from "./svg/parse";
import { DEFAULTS } from "./types";
import type { Mode, Part, Settings } from "./types";

export { DEFAULTS, downloadBlob, plateFilename, plateSVG, zipPlates };
export type { Layout, Mode, Part, Settings };
export type { Placement, PlateLayout } from "./nest/types";

export interface NestInput {
  /** File name; used for export ids (slugged) and messages. */
  name: string;
  /** SVG source text. */
  svg: string;
  /** Number of copies (default 1). */
  qty?: number;
  /** Never rotate this part. */
  lock?: boolean;
}

export interface NestOptions extends Partial<Omit<Settings, "unit">> {
  /** Search time budget in ms for true-shape mode (default 4000). Bounding-box mode ignores it. */
  budgetMs?: number;
  /** PRNG seed; with `maxIterations` the result is deterministic. */
  seed?: number;
  /** Cap on search iterations after the greedy start. */
  maxIterations?: number;
  /** Abort the search early; `nest` then resolves with the best layout found so far. */
  signal?: AbortSignal;
  /** Called with every strictly better layout while the search runs. */
  onLayout?: (result: NestResult) => void;
  onProgress?: (p: { tried: number; elapsedMs: number; budgetMs: number }) => void;
}

export interface NestStats {
  plates: number;
  /** Lower bound on the plate count from total envelope (or padded box) area. */
  minPlates: number;
  placed: number;
  /** Σ part area / Σ plate area, 0–1. */
  fill: number;
}

export interface NestResult {
  layout: Layout;
  /** Parsed parts by uid (placements reference these). */
  parts: Map<number, Part>;
  /** Inputs that could not be parsed, with the reason. */
  rejected: { name: string; error: string }[];
  settings: Settings;
  stats: NestStats;
  /** Layouts tried by the search (true-shape mode). */
  tried: number;
  /** Plate SVGs, ready to save (`plate-01-of-03.svg`, ...). */
  plates(): string[];
  /** All plates zipped. */
  zip(): Promise<Blob>;
}

let nextUid = 1;

/** Parse SVG sources into parts. Bad files are reported in `rejected` instead of throwing. */
export function loadParts(
  inputs: NestInput[],
  dpi = DEFAULTS.dpi,
): { parts: Part[]; rejected: NestResult["rejected"] } {
  const parts: Part[] = [],
    rejected: NestResult["rejected"] = [];
  for (const it of inputs) {
    try {
      const p = parseSVG(it.svg, it.name, nextUid++, dpi);
      p.qty = it.qty ?? 1;
      p.lock = !!it.lock;
      parts.push(p);
    } catch (e) {
      rejected.push({ name: it.name, error: (e as Error).message });
    }
  }
  return { parts, rejected };
}

/** Release the thumbnail object URLs held by parsed parts. */
export function disposeParts(parts: Iterable<Part>): void {
  for (const p of parts) URL.revokeObjectURL(p.thumb);
}

/** Nest SVG parts onto as few plates as possible. */
export async function nest(inputs: NestInput[], opts: NestOptions = {}): Promise<NestResult> {
  const settings: Settings = { ...DEFAULTS, unit: "mm" };
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[])
    if (opts[k as keyof NestOptions] !== undefined)
      (settings as unknown as Record<string, unknown>)[k] = opts[k as keyof NestOptions];
  const { parts, rejected } = loadParts(inputs, settings.dpi);
  const byId = new Map(parts.map((p) => [p.uid, p]));
  let tried = 0;

  const result = (layout: Layout): NestResult => {
    const plateA = settings.plateW * settings.plateH;
    const placed = layout.plates.reduce((s, p) => s + p.placements.length, 0);
    const area = layout.plates.reduce((s, p) => s + p.area, 0);
    const exportOpts = { plateW: settings.plateW, plateH: settings.plateH, outline: settings.outline };
    const plates = () => layout.plates.map((pl) => plateSVG(pl, byId, exportOpts));
    return {
      layout,
      parts: byId,
      rejected,
      settings,
      tried,
      stats: {
        plates: layout.plates.length,
        minPlates: layout.minPlates,
        placed,
        fill: layout.plates.length ? area / (plateA * layout.plates.length) : 0,
      },
      plates,
      zip: () => zipPlates(plates()),
    };
  };

  let best: Layout = { plates: [], oversize: [], minPlates: 0 };
  if (opts.signal?.aborted) return result(best);

  return new Promise<NestResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener("abort", onAbort);
      client.dispose();
      fn();
    };
    const onAbort = () => finish(() => resolve(result(best)));
    const client = new NestClient({
      onLayout(l) {
        best = l;
        opts.onLayout?.(result(l));
      },
      onProgress(p) {
        tried = p.tried;
        opts.onProgress?.({ tried: p.tried, elapsedMs: p.elapsedMs, budgetMs: p.budgetMs });
      },
      onDone(d) {
        tried = d.tried;
        finish(() => resolve(result(best)));
      },
      onError(e) {
        finish(() => reject(new Error(e.message)));
      },
    });
    opts.signal?.addEventListener("abort", onAbort);
    client.run({
      mode: settings.mode,
      parts: parts.map(toWire),
      settings: toNestSettings(settings),
      geoVer: 0,
      budgetMs: opts.budgetMs ?? 4000,
      seed: opts.seed,
      maxIterations: opts.maxIterations,
    });
  });
}
