/**
 * Build single-file HTML versions of the app and the library example that work when opened straight from disk
 * (file://): JS, CSS, fonts and the nesting worker are all inlined. Output: dist/standalone/*.html
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const outDir = resolve(root, "dist/standalone");
const tmp = resolve(root, "dist/.standalone-tmp");
const PAGES = [
  ["index.html", "plate-nester.html"],
  ["examples/index.html", "library-example.html"],
];

mkdirSync(outDir, { recursive: true });
for (const [page, name] of PAGES) {
  rmSync(tmp, { recursive: true, force: true });
  await build({
    configFile: false,
    root,
    base: "./",
    logLevel: "warn",
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    // file:// pages have an opaque origin: Chrome refuses blob *module* workers there, classic ones are fine
    worker: { format: "iife" },
    resolve: {
      alias: [{ find: /^\.\/worker-factory$/, replacement: resolve(root, "src/nest/worker-factory.inline.ts") }],
    },
    build: {
      outDir: tmp,
      emptyOutDir: true,
      target: "es2022",
      sourcemap: false,
      modulePreload: false,
      cssCodeSplit: false,
      assetsInlineLimit: () => true, // fonts become data: URIs inside the CSS
      rollupOptions: { input: resolve(root, page) },
    },
  });
  const htmlPath = resolve(tmp, page);
  const dir = dirname(htmlPath);
  let html = readFileSync(htmlPath, "utf8");
  html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_m, src) => {
    const js = readFileSync(resolve(dir, src), "utf8").replace(/<\/script/gi, "<\\/script");
    return `<script type="module">${js}</script>`;
  });
  html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_m, href) => {
    const css = readFileSync(resolve(dir, href), "utf8")
      .replace(/,\s*url\(data:font\/woff;base64,[^)]*\)\s*format\(["']woff["']\)/g, "") // woff2 is enough
      .replace(/<\/style/gi, "<\\/style");
    return `<style>${css}</style>`;
  });
  html = html.replace(/<p\s+class="source-only"[\s\S]*?<\/p>\s*/g, ""); // the "open via dev server" hint is moot here
  const left = html.match(/(?:src|href)="\.{0,2}\/?assets\/[^"]+"/g);
  if (left) throw new Error(`${name}: unresolved asset references: ${left.join(", ")}`);
  writeFileSync(resolve(outDir, name), html);
  console.log(`dist/standalone/${name}  ${(html.length / 1024).toFixed(0)} kB`);
}
rmSync(tmp, { recursive: true, force: true });
