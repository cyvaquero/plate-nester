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
