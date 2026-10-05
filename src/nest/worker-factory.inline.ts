/** Standalone builds: the worker is bundled into the page, so it also runs from file://. */
import InlineWorker from "./worker.ts?worker&inline";

export const createWorker = (): Worker => new InlineWorker();
