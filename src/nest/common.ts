/** Thrown (as a value) from a pacer when the current run has been cancelled. */
export const ABORT = Object.freeze({ aborted: true });

/** Lets long-running pack loops yield to the event loop (so `stop` messages arrive) and be cancelled. */
export interface Pacer {
  tick(): Promise<void>;
}
/** Never yields; used by tests and for synchronous packing. */
export const noPacer: Pacer = { async tick() {} };

/** Time-sliced pacer: yields to the event loop every `sliceMs`, throwing ABORT when `cancelled()` says so. */
export function timedPacer(cancelled: () => boolean, sliceMs = 30): Pacer {
  let last = performance.now();
  return {
    async tick() {
      if (performance.now() - last <= sliceMs) return;
      await new Promise<void>((r) => setTimeout(r, 0));
      last = performance.now();
      if (cancelled()) throw ABORT;
    },
  };
}

/** mulberry32: small, fast, seedable PRNG returning floats in [0, 1). */
export function mulberry(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Layout score: (plate count, −Σ fill²); lexicographically smaller is better. */
export type Score = [number, number];

export function score(areas: number[], plateA: number): Score {
  let sq = 0;
  for (const a of areas) {
    const u = a / plateA;
    sq += u * u;
  }
  return [areas.length, -sq];
}

export const better = (a: Score, b: Score): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1] - 1e-9);
