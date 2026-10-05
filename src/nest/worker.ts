/// <reference lib="webworker" />
import { Engine } from "./engine";
import type { Request, Response } from "./protocol";

const engine = new Engine((r: Response) => self.postMessage(r));

self.onmessage = (e: MessageEvent<Request>) => {
  const m = e.data;
  if (m.type === "run") void engine.run(m);
  else if (m.type === "more") void engine.more(m);
  else if (m.type === "stop") engine.stop();
};
