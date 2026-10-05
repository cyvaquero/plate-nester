/** Creates the nesting worker from its own file (normal builds and the dev server). */
export const createWorker = (): Worker => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
