import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const fileUrl = (p: string) => pathToFileURL(resolve(ROOT, p)).href;

test.describe("opened straight from disk (file://)", () => {
  test.beforeAll(() => {
    execFileSync("node", ["scripts/build-standalone.mjs"], { cwd: ROOT, stdio: "ignore" });
  });

  test("standalone library example nests with the inlined worker", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("requestfailed", (r) => errors.push(`request failed: ${r.url()}`));
    await page.goto(fileUrl("dist/standalone/library-example.html"));
    await expect(page.locator("#status")).toHaveText(/^Done/, { timeout: 60_000 });
    await expect(page.locator("#sParts")).toHaveText("32");
    expect(await page.locator(".plate").count()).toBeGreaterThan(0);
    expect(await page.locator("h1").evaluate((e) => getComputedStyle(e).fontFamily)).toContain("Barlow Semi Condensed");
    expect(await page.evaluate(() => document.fonts.check('700 30px "Barlow Semi Condensed"'))).toBe(true);
    await expect(page.locator(".source-only")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("standalone app nests and downloads", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(fileUrl("dist/standalone/plate-nester.html"));
    await page.waitForSelector('#status[data-state="idle"]', { state: "attached", timeout: 60_000 });
    await expect(page.locator("#sParts")).toHaveText("32");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(".plate button").first().click()]);
    expect(readFileSync((await dl.path())!, "utf8")).toMatch(/^<svg [^>]*width="300mm"/);
    expect(errors).toEqual([]);
  });

  test("source pages explain how to run them instead of rendering blank", async ({ page }) => {
    for (const p of ["examples/index.html", "index.html"]) {
      await page.goto(fileUrl(p));
      await expect(page.locator(".source-only")).toBeVisible();
      await expect(page.locator(".source-only")).toContainText("npm run build:standalone");
    }
  });
});
