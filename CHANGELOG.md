# Changelog

Format `major.minor.iterative`. Major/minor change only on request; the iterative number increments with every change.

## 0.1.0

- Repository scaffold: TypeScript, Vite, Vitest, Playwright, ESLint, Prettier; reference apps in `reference/`.

## 0.1.1

- Parity port of both reference apps into one app: SVG parse/flatten, outline/envelope/NFP geometry, true-shape and
  MaxRects nesting, worker-based search, per-plate SVG + zip export, vanilla-DOM UI with a mode switch.

## 0.1.2

Fixes found by the parity fixtures (deviations from the reference, both bugs there):

- Hidden (`display:none`) shapes no longer shape the true-shape outline (a far-off hidden circle made a part "too big").
- Original-markup parts (text, gradients, …) placed more than once now get per-instance ids, so exported plates never repeat an id.
- Status shows "Nesting…" immediately when a re-run is scheduled.

## 0.1.3

- Parity tests: Vitest unit suite (path parser, arcs, hull, RDP, convex decomposition, NFP sliding contact, envelope,
  MaxRects, shape search, export) and Playwright suite (sample set + fixtures with transforms, skew, CSS classes, hidden
  groups, text, arcs, gradients; overlap/margin/unique-id invariants; flattened-vs-original pixel parity; determinism; UI).

## 0.1.4

- Public library API `src/lib.ts` (`nest`, `loadParts`, `disposeParts`, export helpers): worker-backed, streaming,
  abortable, deterministic with `seed` + `maxIterations`.
- Standalone example page `examples/index.html` (built to `dist/examples/`), with Playwright coverage.
- `toWire`/`toNestSettings` moved to `src/nest/wire.ts` and shared by the app and the library.

## 0.1.5

- Example page restyled to match the reference apps: shared stylesheet and fonts (`src/ui/theme.ts`), plate & cutting
  panel with the highlighted kerf field, drag-and-drop parts panel, stats summary, search bar, plate cards with dashed
  spacing envelopes, margin line and fill bar, mode switch. Uses the reference sample set (`SAMPLE_PARTS` in `src/lib.ts`).

## 0.1.6

- Single-file builds that work when opened straight from disk (`file://`): `dist/standalone/plate-nester.html` and
  `dist/standalone/library-example.html` (`npm run build:standalone`, also part of `npm run build`). JS, CSS, fonts and
  the nesting worker are inlined; the worker is a classic blob worker because browsers refuse module workers on
  `file://` pages. No new dependencies (`vite-plugin-singlefile` was rejected: it pulls in `braces` with unpatched
  GHSA-vfj7-8cjw-p6xm).
- Source pages show a note explaining how to run them instead of rendering blank (#21).
- Fonts limited to Latin + Latin Extended subsets.
