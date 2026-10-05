import type { DoneResponse, ErrorResponse, ProgressResponse, Request, Response, RunRequest } from "./protocol";
import type { Layout } from "./types";
import { createWorker } from "./worker-factory";

export interface NestHandlers {
  onLayout(layout: Layout): void;
  onProgress(p: ProgressResponse): void;
  onDone(d: DoneResponse): void;
  onError(e: ErrorResponse): void;
}

/** Main-thread handle on the nesting worker. Responses from superseded runs are dropped. */
export class NestClient {
  private worker: Worker;
  private current = 0;

  constructor(private readonly h: NestHandlers) {
    this.worker = createWorker();
    this.worker.onmessage = (e: MessageEvent<Response>) => {
      const m = e.data;
      if (m.id !== this.current) return;
      if (m.type === "layout") this.h.onLayout(m.layout);
      else if (m.type === "progress") this.h.onProgress(m);
      else if (m.type === "done") this.h.onDone(m);
      else this.h.onError(m);
    };
  }

  private send(r: Request) {
    this.worker.postMessage(r);
  }

  run(req: Omit<RunRequest, "type" | "id">): void {
    this.send({ type: "run", id: ++this.current, ...req });
  }

  more(budgetMs: number): void {
    this.send({ type: "more", id: ++this.current, budgetMs });
  }

  stop(): void {
    this.current++;
    this.send({ type: "stop" });
  }

  /** Terminate the worker. The client cannot be used afterwards. */
  dispose(): void {
    this.current++;
    this.worker.terminate();
  }
}
