import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { readFileSync } from "node:fs";
import { idle, openApp, setMode } from "./helpers";

test("sample parts load on first open and a plate is previewed", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#sampleBadge")).toBeVisible();
  await expect(page.locator(".part")).toHaveCount(6);
  await expect(page.locator(".plate").first()).toBeVisible();
  await expect(page.locator("#sParts")).toHaveText("32");
});

test("downloads one plate SVG and a zip of all plates as normal browser downloads", async ({ page }) => {
  await openApp(page);
  const [svgDl] = await Promise.all([page.waitForEvent("download"), page.locator(".plate button").first().click()]);
  expect(svgDl.suggestedFilename()).toMatch(/^plate-01-of-\d\d\.svg$/);
  const svg = readFileSync((await svgDl.path())!, "utf8");
  expect(svg).toMatch(/^<svg [^>]*width="300mm" height="300mm" viewBox="0 0 300 300">/);
  const [zipDl] = await Promise.all([page.waitForEvent("download"), page.click("#dlAll")]);
  expect(zipDl.suggestedFilename()).toBe("nested-plates.zip");
  const zip = await JSZip.loadAsync(readFileSync((await zipDl.path())!));
  expect(Object.keys(zip.files).sort()).toEqual(["plate-01-of-02.svg", "plate-02-of-02.svg"]);
});

test("settings persist in localStorage across reloads", async ({ page }) => {
  await openApp(page);
  await page.fill("#plateW", "250");
  await page.fill("#kerf", "0.15");
  await page.selectOption("#rotStep", "45");
  await setMode(page, "bbox");
  await page.waitForTimeout(100);
  await page.reload();
  await idle(page);
  await expect(page.locator("#plateW")).toHaveValue("250");
  await expect(page.locator("#kerf")).toHaveValue("0.15");
  await expect(page.locator("#rotStep")).toHaveValue("45");
  await expect(page.locator("#m-bbox")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("body")).toHaveAttribute("data-mode", "bbox");
});

test("kerf helper computes designed − measured and applies it", async ({ page }) => {
  await openApp(page);
  await page.locator(".kerf summary").click();
  await page.fill("#kDesign", "20");
  await page.fill("#kMeasured", "19.86");
  await expect(page.locator("#kOut")).toHaveText("Kerf: 0.14 mm");
  await page.click("#kUse");
  await expect(page.locator("#kerf")).toHaveValue("0.14");
  expect((await page.evaluate(() => window.__plateNester.getSettings())).kerf).toBeCloseTo(0.14, 9);
  await page.fill("#kMeasured", "21"); // measured > designed is not a kerf
  await expect(page.locator("#kUse")).toBeDisabled();
});

test("unit switch converts displayed lengths but keeps mm internally", async ({ page }) => {
  await openApp(page);
  await page.click("#u-in");
  await expect(page.locator("#plateW")).toHaveValue("11.811");
  expect((await page.evaluate(() => window.__plateNester.getSettings())).plateW).toBe(300);
  await page.click("#u-mm");
  await expect(page.locator("#plateW")).toHaveValue("300");
});

test("stop cancels a long search and keeps the best layout", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__plateNester.configure({ maxIterations: undefined, budgetMs: 60000 }));
  await page.click("#more");
  await expect(page.locator("#stop")).toBeVisible();
  await page.click("#stop");
  await idle(page);
  await expect(page.locator("#more")).toBeEnabled();
  await expect(page.locator(".plate").first()).toBeVisible();
});

test("removing a part and quantity edits re-nest; non-SVG files are rejected", async ({ page }) => {
  await openApp(page);
  await page.locator(".part .icon").nth(1).click();
  await expect(page.locator(".part")).toHaveCount(5);
  await page.waitForTimeout(100);
  await idle(page);
  await page.setInputFiles("#file", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
  await expect(page.locator("#toast")).toContainText("Only .svg files");
  await page.setInputFiles("#file", { name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg") });
  await expect(page.locator("#toast")).toContainText("isn't a readable SVG");
});
