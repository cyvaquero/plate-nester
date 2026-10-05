# Plate Nester

Client-side nesting of SVG parts onto laser-cutter plates. One app, two modes:

- **True shape** (default): parts interlock by their real outlines and can rotate (none / 180 / 90 / 45 / 30 / 15°).
  Envelopes → no-fit polygons → first-fit on multiple plates, improved by a seeded, cancellable order search.
- **Bounding box**: MaxRects packing (4 heuristics × 5 sort orders) with optional 90° rotation.

Everything runs in the browser — no server, no uploads. Nesting runs in a Web Worker; SVG parsing and geometry
sampling need the DOM and run on the main thread.

Exports one SVG per plate (mm units, one object per part, ids unique) and a zip of all plates. The export format was
verified against WeCreat MakeIT 3.06 (macOS) for the WeCreat Vision Pro 45W and must not change.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static site in dist/ + single-file pages in dist/standalone/
npm run build:standalone  # only the single-file pages (open them by double-click, no server needed)
npm test             # Vitest unit tests
npm run test:e2e     # Playwright (first time: npx playwright install chromium)
npm run lint && npm run typecheck
```

## Use it as a library

`src/lib.ts` is the public API. A working example page lives in [`examples/`](examples/index.html). To see it:

- `npm run build:standalone`, then double-click `dist/standalone/library-example.html` (works from disk, no server), or
- `npm run dev` and open <http://localhost:5173/examples/>.

The `.html` files in the source tree load TypeScript, so opening them directly from disk only shows a note
explaining this. `dist/standalone/plate-nester.html` is the full app as one file, like the original reference apps.

```ts
import { nest, downloadBlob, plateFilename } from "./src/lib";

const result = await nest([{ name: "star.svg", svg: starSource, qty: 4 }], {
  mode: "shape", // or "bbox"
  plateW: 300,
  plateH: 300,
  kerf: 0.1,
  gap: 1,
  margin: 3,
  rotStep: 90, // all mm / degrees
  budgetMs: 3000, // search time; stop early with `signal: abortController.signal`
  onLayout: (r) => console.log(r.stats.plates, "plates so far"),
});
result
  .plates()
  .forEach((svg, i) => downloadBlob(new Blob([svg], { type: "image/svg+xml" }), plateFilename(i, result.stats.plates)));
```

`nest` parses on the main thread (it needs the DOM) and nests in a Web Worker. It resolves with the layout, stats
(`plates`, `minPlates`, `placed`, `fill`), rejected inputs, `plates()` (export SVG strings) and `zip()`.
Pass `seed` + `maxIterations` for deterministic results.

## Layout

| Path                  | Purpose                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `src/units.ts`        | mm/in conversion; all internal lengths are mm                             |
| `src/svg/parse.ts`    | DOMParser, sanitizing, id prefixing, physical scale, bbox                 |
| `src/svg/flatten.ts`  | path-d parser, shape→path, CTM baking, computed style                     |
| `src/geometry/`       | outline sampling + union, envelope (RDP, offset, hull, convex split), NFP |
| `src/nest/`           | shape placement, MaxRects, search, engine + worker + client               |
| `src/export/plate.ts` | per-plate SVG, zip, download                                              |
| `src/ui/`             | vanilla-DOM controls, parts list, plate previews                          |
| `reference/`          | the original single-file apps — source of truth for behaviour             |

## Workflow

git-flow: `main` + `develop`, feature branches off `develop`, PRs into `develop`.
Versions are `major.minor.iterative`: major and minor are bumped only on request (zeroing what follows); the
iterative number is bumped with every change. See [CHANGELOG.md](CHANGELOG.md).
