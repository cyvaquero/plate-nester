import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import JSZip from "jszip";
import { readFileSync } from "node:fs";
import { fixtureFiles } from "./helpers";

const done = (page: Page) => expect(page.locator("#status")).toHaveText(/^Done/, { timeout: 60_000 });

test.describe("library example page", () => {
  test("nests the sample parts with the public API and renders every plate", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/examples/");
    await done(page);
    await expect(page.locator("#partsNote")).toContainText("6 sample parts");
    await expect(page.locator("#sampleBadge")).toBeVisible();
    await expect(page.locator("#sParts")).toHaveText("32");
    const cards = page.locator(".plate");
    expect(await cards.count()).toBeGreaterThan(0);
    await expect(cards.first().locator(".t")).toHaveText(/^Plate 1 of \d+$/);
    expect(await cards.first().locator(".sheet polygon").count()).toBeGreaterThan(0); // dashed spacing envelopes
    for (const ok of await page
      .locator(".sheet img")
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0),
      ))
      expect(ok).toBe(true);
    // looks like the app: shared stylesheet and fonts are applied
    expect(await page.locator("h1").evaluate((e) => getComputedStyle(e).fontFamily)).toContain("Barlow Semi Condensed");
    expect(errors).toEqual([]);
  });

  test("uses uploaded SVGs, bounding-box mode, and downloads", async ({ page }) => {
    await page.goto("/examples/");
    await done(page);
    await page.fill("#qty", "2");
    await page.click("#m-bbox");
    await done(page);
    await page.setInputFiles("#files", fixtureFiles());
    await expect(page.locator("#partsNote")).toContainText(`${fixtureFiles().length} files × 2`);
    await done(page);
    await expect(page.locator("#sParts")).toHaveText(String(fixtureFiles().length * 2));
    await expect(page.locator("#sampleBadge")).toBeHidden();
    const [svg] = await Promise.all([page.waitForEvent("download"), page.locator(".plate .hd button").first().click()]);
    expect(svg.suggestedFilename()).toMatch(/^plate-01-of-\d\d\.svg$/);
    expect(readFileSync((await svg.path())!, "utf8")).toContain('width="300mm"');
    await page.click("#useSamples");
    await done(page);
    const [zip] = await Promise.all([page.waitForEvent("download"), page.click("#zip")]);
    const files = Object.keys((await JSZip.loadAsync(readFileSync((await zip.path())!))).files);
    expect(files.length).toBe(await page.locator(".plate").count());
  });

  test("Stop resolves with the best layout found so far", async ({ page }) => {
    await page.goto("/examples/");
    await done(page);
    await page.fill("#budget", "60");
    await page.click("#run");
    await expect(page.locator("#status")).toHaveText(/Searching/, { timeout: 30_000 });
    await page.click("#stop");
    await done(page);
    expect(await page.locator(".plate").count()).toBeGreaterThan(0);
  });

  test("reports oversize parts and bad files without failing", async ({ page }) => {
    await page.goto("/examples/");
    await done(page);
    await page.setInputFiles("#files", [
      { name: "broken.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg") },
      {
        name: "huge.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="900mm" height="10mm" viewBox="0 0 900 10"><rect width="900" height="10" fill="none" stroke="#000" stroke-width=".2"/></svg>',
        ),
      },
    ]);
    await done(page);
    await expect(page.locator("#msgs")).toContainText("broken.svg isn't a readable SVG file.");
    await expect(page.locator("#msgs")).toContainText("huge.svg (900 × 10 mm) doesn't fit");
  });
});
