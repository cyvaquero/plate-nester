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

## 0.1.7

- **Single-file app, no Node.** `plate-nester.html` is one HTML file with inline JavaScript, like the reference apps:
  True shape / Bounding box mode switch, both reference engines, sample parts, normal browser downloads (replacing the
  artifact-only `window.claude` downloads). Libraries load by script tag as in the references.
- Keeps the two fixes from 0.1.2: hidden (`display:none`) shapes no longer shape the outline; original-markup parts
  placed more than once get per-instance ids.
- Removed the TypeScript/Vite/npm project (`src/`, `tests/`, configs, `package.json`). Test SVGs moved to `fixtures/`.
  0.1.4–0.1.6 (library API, example page, standalone build) lived only in the closed PR #20.
