import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { CL, SC } from "../../src/geometry/clip";
import type { Layout } from "../../src/nest/types";
import type { TestHook } from "../../src/ui/app";

export const FIXTURE_DIR = resolve(import.meta.dirname, "../fixtures");
export const fixtureFiles = (): string[] =>
  readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".svg"))
    .sort()
    .map((f) => resolve(FIXTURE_DIR, f));

declare global {
  interface Window {
    __plateNester: TestHook;
  }
}

export const idle = (page: Page) =>
  page.waitForSelector('#status[data-state="idle"]', { timeout: 120_000, state: "attached" });

/** Open the app, wait for the first nest to finish, then switch the search to a short deterministic budget. */
export async function openApp(page: Page, o: { budgetMs?: number; maxIterations?: number; seed?: number } = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await idle(page);
  await page.evaluate((cfg) => window.__plateNester.configure(cfg), {
    budgetMs: 1e9,
    maxIterations: 25,
    seed: 7,
    ...o,
  });
  return errors;
}

export async function rerun(page: Page) {
  await page.evaluate(() => window.__plateNester.rerun());
  await page.waitForTimeout(50);
  await idle(page);
}

export async function setMode(page: Page, mode: "shape" | "bbox") {
  await page.click(mode === "shape" ? "#m-shape" : "#m-bbox");
  await page.waitForTimeout(50);
  await idle(page);
}

/** Replace the sample parts with the given files, then wait for the layout. */
export async function loadFiles(page: Page, files: string[]) {
  await page.setInputFiles("#file", files);
  await expect(page.locator(".part")).toHaveCount(files.length, { timeout: 30_000 });
  await page.waitForTimeout(50);
  await idle(page);
}

/** Set every part's quantity through the UI. */
export async function setQty(page: Page, qty: number) {
  const n = await page.locator(".part input[type=number]").count();
  for (let i = 0; i < n; i++) await page.locator(".part input[type=number]").nth(i).fill(String(qty));
  await page.waitForTimeout(50);
  await idle(page);
}

export const getLayout = (page: Page): Promise<Layout> => page.evaluate(() => window.__plateNester.getLayout()!);

const toPaths = (env: [number, number][][]) =>
  env.map((q) => q.map(([x, y]) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) })));

/** Overlap in mm² of two sets of polygons given in plate mm. */
export function overlapMM2(a: [number, number][][], b: [number, number][][]): number {
  const c = new CL.Clipper();
  c.AddPaths(toPaths(a), CL.PolyType.ptSubject, true);
  c.AddPaths(toPaths(b), CL.PolyType.ptClip, true);
  const r = new CL.Paths();
  c.Execute(CL.ClipType.ctIntersection, r, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  return r.reduce((s, q) => s + Math.abs(CL.Clipper.Area(q)), 0) / (SC * SC);
}

/** The preview outline of a bounding-box placement grown by half the spacing on every side. */
export function grownBox(env: [number, number][][], half: number): [number, number][][] {
  const pts = env.flat();
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [
    Math.min(...xs) - half,
    Math.max(...xs) + half,
    Math.min(...ys) - half,
    Math.max(...ys) + half,
  ];
  return [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
  ];
}

/** Rasterise an SVG string at `pxPerMm` and return it as a PNG. */
export async function rasterise(page: Page, svg: string, plateW: number, plateH: number, pxPerMm = 4): Promise<PNG> {
  const dataUrl = await page.evaluate(
    async ([s, w, h, k]) => {
      const url = URL.createObjectURL(new Blob([s as string], { type: "image/svg+xml" }));
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = Math.round((w as number) * (k as number));
      c.height = Math.round((h as number) * (k as number));
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      return c.toDataURL("image/png");
    },
    [svg, plateW, plateH, pxPerMm],
  );
  return PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
}

export function diffPixels(a: PNG, b: PNG): { diff: number; ink: number } {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let ink = 0;
  for (let i = 0; i < a.data.length; i += 4) if (a.data[i] < 250 || a.data[i + 1] < 250 || a.data[i + 2] < 250) ink++;
  const diff = pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0.1, includeAA: false });
  return { diff, ink };
}
