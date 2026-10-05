import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Layout } from "../../src/nest/types";
import {
  diffPixels,
  fixtureFiles,
  getLayout,
  grownBox,
  loadFiles,
  openApp,
  overlapMM2,
  rasterise,
  rerun,
  setMode,
  setQty,
} from "./helpers";

interface PartInfo {
  uid: number;
  name: string;
  qty: number;
  wMM: number;
  hMM: number;
  flat: boolean;
  outersExtent: { w: number; h: number };
}

const partInfo = (page: Page): Promise<PartInfo[]> =>
  page.evaluate(() =>
    window.__plateNester.getParts().map((p) => {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const o of p.outers)
        for (const v of o) {
          x0 = Math.min(x0, v.X);
          x1 = Math.max(x1, v.X);
          y0 = Math.min(y0, v.Y);
          y1 = Math.max(y1, v.Y);
        }
      return {
        uid: p.uid,
        name: p.name,
        qty: p.qty,
        wMM: p.wMM,
        hMM: p.hMM,
        flat: !!p.flat,
        outersExtent: { w: (x1 - x0) / 1000, h: (y1 - y0) / 1000 },
      };
    }),
  );

/** Facts about each exported plate, measured in the browser from the actual export. */
async function inspectPlates(page: Page, count: number, outline: boolean) {
  return page.evaluate(
    ([n, withOutline]) => {
      const out = [];
      for (let i = 0; i < (n as number); i++) {
        const svg = window.__plateNester.plateSVG(i);
        const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
        const root = doc.documentElement;
        const host = document.createElement("div");
        host.style.cssText = "position:absolute;left:0;top:0;visibility:hidden";
        document.body.appendChild(host);
        host.appendChild(document.importNode(root, true));
        const el = host.firstElementChild as SVGSVGElement;
        el.style.width = el.viewBox.baseVal.width * 10 + "px";
        el.style.height = el.viewBox.baseVal.height * 10 + "px";
        const r0 = el.getBoundingClientRect();
        const kids = [...el.children] as SVGGraphicsElement[];
        const partKids = withOutline ? kids.filter((k) => k.hasAttribute("id")) : kids;
        const boxes = partKids.map((k) => {
          const r = k.getBoundingClientRect();
          return {
            id: k.id,
            tag: k.localName,
            hasTransform: k.hasAttribute("transform"),
            inner: !!k.querySelector("[transform]"),
            x0: (r.left - r0.left) / 10,
            y0: (r.top - r0.top) / 10,
            x1: (r.right - r0.left) / 10,
            y1: (r.bottom - r0.top) / 10,
          };
        });
        const ids = [...el.querySelectorAll("[id]")].map((e) => e.id);
        out.push({
          topLevel: kids.length,
          widthAttr: root.getAttribute("width"),
          heightAttr: root.getAttribute("height"),
          viewBox: root.getAttribute("viewBox"),
          outlineRect: kids.some((k) => k.localName === "rect" && k.getAttribute("stroke") === "#ff0000"),
          ids,
          uniqueIds: new Set(ids).size === ids.length,
          boxes,
        });
        host.remove();
      }
      return out;
    },
    [count, outline] as const,
  );
}

async function checkInvariants(page: Page, mode: "shape" | "bbox", expectOversize: string[] = []) {
  const layout: Layout = await getLayout(page);
  const parts = await partInfo(page);
  const settings = await page.evaluate(() => window.__plateNester.getSettings());
  const byId = new Map(parts.map((p) => [p.uid, p]));

  // every non-oversize instance is placed exactly once
  const expectedPlaced = parts.filter((p) => !layout.oversize.includes(p.uid)).reduce((s, p) => s + p.qty, 0);
  expect(layout.plates.reduce((s, p) => s + p.placements.length, 0)).toBe(expectedPlaced);
  expect(layout.oversize.map((u) => byId.get(u)!.name).sort()).toEqual(expectOversize.sort());

  // no two envelopes overlap by more than 0.05 mm²
  const half = (settings.kerf + settings.gap) / 2;
  for (const pl of layout.plates)
    for (let i = 0; i < pl.placements.length; i++)
      for (let j = i + 1; j < pl.placements.length; j++) {
        const a = pl.placements[i].env,
          b = pl.placements[j].env;
        const ov = mode === "shape" ? overlapMM2(a, b) : overlapMM2(grownBox(a, half), grownBox(b, half));
        expect(
          ov,
          `plate ${layout.plates.indexOf(pl) + 1}: ${byId.get(pl.placements[i].partId)!.name} vs ${byId.get(pl.placements[j].partId)!.name}`,
        ).toBeLessThanOrEqual(0.05);
      }

  // exported plates: one top-level element per part, unique ids, parts inside the margin
  const plates = await inspectPlates(page, layout.plates.length, settings.outline);
  const slack = mode === "shape" ? 0.8 * settings.prec + 0.05 : 0.05; // RDP may let a curve bulge ≤ 0.8·precision past its envelope
  plates.forEach((pi, i) => {
    const pl = layout.plates[i];
    expect(pi.topLevel).toBe(pl.placements.length + (settings.outline ? 1 : 0));
    expect(pi.boxes.length).toBe(pl.placements.length);
    expect(pi.uniqueIds).toBe(true);
    expect(pi.ids.length).toBeGreaterThanOrEqual(pl.placements.length); // every part has an id; originals may keep unique inner ids
    expect(pi.widthAttr).toBe(`${settings.plateW}mm`);
    expect(pi.heightAttr).toBe(`${settings.plateH}mm`);
    expect(pi.viewBox).toBe(`0 0 ${settings.plateW} ${settings.plateH}`);
    expect(pi.outlineRect).toBe(settings.outline);
    for (const b of pi.boxes) {
      expect(b.x0, `${b.id} left`).toBeGreaterThanOrEqual(settings.margin - slack);
      expect(b.y0, `${b.id} top`).toBeGreaterThanOrEqual(settings.margin - slack);
      expect(b.x1, `${b.id} right`).toBeLessThanOrEqual(settings.plateW - settings.margin + slack);
      expect(b.y1, `${b.id} bottom`).toBeLessThanOrEqual(settings.plateH - settings.margin + slack);
    }
  });
  return { layout, parts, plates, settings };
}

/** Flattened export and original-markup export must render the same. */
async function checkVisual(page: Page, layout: Layout, plateW: number, plateH: number) {
  for (let i = 0; i < layout.plates.length; i++) {
    const [flat, orig] = await page.evaluate(
      (k) => [window.__plateNester.plateSVG(k), window.__plateNester.plateSVG(k, { forceOriginal: true })],
      i,
    );
    const a = await rasterise(page, flat, plateW, plateH),
      b = await rasterise(page, orig, plateW, plateH);
    const { diff, ink } = diffPixels(a, b);
    expect(ink, `plate ${i + 1} has visible ink`).toBeGreaterThan(500);
    expect(diff / ink, `plate ${i + 1}: ${diff} differing px of ${ink} inked`).toBeLessThan(0.01);
  }
}

test.describe("true shape mode", () => {
  test("sample set: invariants, export structure, visual parity", async ({ page }) => {
    const errors = await openApp(page);
    const { layout, settings } = await checkInvariants(page, "shape");
    expect(layout.plates.length).toBeGreaterThanOrEqual(layout.minPlates);
    await checkVisual(page, layout, settings.plateW, settings.plateH);
    expect(errors).toEqual([]);
  });

  test("sample set with the plate outline: one extra non-part element", async ({ page }) => {
    await openApp(page);
    await page.setChecked("#outline", true);
    await checkInvariants(page, "shape");
  });

  test("fixtures: transforms, skew, CSS classes, hidden groups, text, arcs, gradient", async ({ page }) => {
    const errors = await openApp(page);
    await loadFiles(page, fixtureFiles());
    await setQty(page, 3);
    const { layout, parts, plates, settings } = await checkInvariants(page, "shape");

    // hidden shapes must not leak into the outline
    const hidden = parts.find((p) => p.name === "hidden-group.svg")!;
    expect(Math.abs(hidden.outersExtent.w - hidden.wMM)).toBeLessThan(0.5);
    expect(Math.abs(hidden.outersExtent.h - hidden.hMM)).toBeLessThan(0.5);
    expect(hidden.wMM).toBeCloseTo(50, 1);

    // physical scale comes from width/height + viewBox
    expect(parts.find((p) => p.name === "text.svg")!.wMM).toBeGreaterThan(55);

    // text and url() paints keep their original markup, everything else is flattened
    const flatByName = Object.fromEntries(parts.map((p) => [p.name, p.flat]));
    expect(flatByName["text.svg"]).toBe(false);
    expect(flatByName["gradient.svg"]).toBe(false);
    for (const n of ["transforms.svg", "skew.svg", "css-classes.svg", "hidden-group.svg", "arcs.svg"])
      expect(flatByName[n], n).toBe(true);

    for (const pi of plates)
      for (const b of pi.boxes) {
        const base = b.id.replace(/-\d+$/, "");
        if (base === "text" || base === "gradient") {
          expect(b.tag).toBe("g");
          expect(b.hasTransform).toBe(true);
        } else {
          expect(b.hasTransform, b.id).toBe(false); // transform-free: baked into the coordinates
          expect(b.inner, b.id).toBe(false);
        }
      }
    await checkVisual(page, layout, settings.plateW, settings.plateH);
    expect(errors).toEqual([]);
  });

  test("a single-style part exports as one <path>; a mixed part as one <g> of paths", async ({ page }) => {
    await openApp(page);
    await loadFiles(
      page,
      fixtureFiles().filter((f) => /transforms|css-classes|hex/.test(f) || true),
    );
    const { plates } = await checkInvariants(page, "shape");
    const tags = new Map<string, string>();
    for (const pi of plates) for (const b of pi.boxes) tags.set(b.id.replace(/-\d+$/, ""), b.tag);
    expect(tags.get("css-classes")).toBe("g"); // cut lines in two colours + a fill
    expect(tags.get("hidden-group")).toBe("path"); // all unfilled black lines
    expect(tags.get("transforms")).toBe("g"); // black and red strokes
  });

  test("oversize parts are reported and left out", async ({ page }) => {
    await openApp(page);
    await loadFiles(page, fixtureFiles());
    await page.fill("#plateW", "60");
    await page.fill("#plateH", "40");
    await page.waitForTimeout(400);
    await rerun(page);
    const { layout } = await checkInvariants(page, "shape", await oversizeNames(page));
    expect(layout.oversize.length).toBeGreaterThan(0);
    await expect(page.locator("#msgs .msg").first()).toContainText("doesn't fit");
  });

  test("same inputs and seed give the same layout", async ({ page }) => {
    await openApp(page, { seed: 11, maxIterations: 20 });
    await rerun(page);
    const a = await getLayout(page);
    await rerun(page);
    const b = await getLayout(page);
    expect(b).toEqual(a);
    await page.evaluate(() => window.__plateNester.configure({ seed: 12 }));
    await rerun(page);
    const c = await getLayout(page);
    await page.evaluate(() => window.__plateNester.configure({ seed: 12 }));
    await rerun(page);
    expect(await getLayout(page)).toEqual(c);
  });

  test("rotation setting is respected", async ({ page }) => {
    await openApp(page);
    await page.selectOption("#rotStep", "0");
    await page.waitForTimeout(50);
    await idle0(page);
    expect((await getLayout(page)).plates.flatMap((p) => p.placements).every((p) => p.ang === 0)).toBe(true);
    await page.selectOption("#rotStep", "45");
    await page.waitForTimeout(50);
    await idle0(page);
    const angs = new Set((await getLayout(page)).plates.flatMap((p) => p.placements).map((p) => p.ang));
    expect([...angs].every((a) => a % 45 === 0)).toBe(true);
  });
});

test.describe("bounding box mode", () => {
  test("sample set and fixtures: invariants, export structure, visual parity", async ({ page }) => {
    const errors = await openApp(page);
    await setMode(page, "bbox");
    const first = await checkInvariants(page, "bbox");
    await checkVisual(page, first.layout, first.settings.plateW, first.settings.plateH);
    await loadFiles(page, fixtureFiles());
    await setQty(page, 3);
    const second = await checkInvariants(page, "bbox");
    await checkVisual(page, second.layout, second.settings.plateW, second.settings.plateH);
    expect(errors).toEqual([]);
  });

  test("same inputs and seed give the same layout", async ({ page }) => {
    await openApp(page, { seed: 5, maxIterations: 30 });
    await setMode(page, "bbox");
    const a = await getLayout(page);
    await rerun(page);
    expect(await getLayout(page)).toEqual(a);
  });

  test("90° rotation checkbox and lock", async ({ page }) => {
    await openApp(page);
    await setMode(page, "bbox");
    await page.setChecked("#rotate90", false);
    await page.waitForTimeout(50);
    await idle0(page);
    expect((await getLayout(page)).plates.flatMap((p) => p.placements).every((p) => p.ang === 0)).toBe(true);
  });
});

async function idle0(page: Page) {
  await page.waitForSelector('#status[data-state="idle"]', { timeout: 120_000, state: "attached" });
}

async function oversizeNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const l = window.__plateNester.getLayout()!;
    const names = new Map(window.__plateNester.getParts().map((p) => [p.uid, p.name]));
    return l.oversize.map((u) => names.get(u)!);
  });
}
