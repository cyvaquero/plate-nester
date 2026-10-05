# plate-nester

Client-side SVG nesting for laser cutting (true-shape + bounding-box). `reference/*.html` are the original single-file
apps and the source of truth for behaviour: port first, improve second. The export format is verified in WeCreat MakeIT
and must stay exactly as is.

## Rules

- **Git-flow**: `main` + `develop`; feature branches off `develop`; PRs into `develop`.
- **Versioning** `#.#.#` (major.minor.iterative), kept in `package.json` and `CHANGELOG.md`:
  - major: only bumped when the user explicitly says so; zeroes minor and iterative.
  - minor: only bumped when the user explicitly says so; keeps major, zeroes iterative.
  - iterative: bump automatically with every change.
- All internal lengths are mm. Nesting runs in a Web Worker; DOM-dependent geometry stays on the main thread.
- Sandboxed sessions may not be able to read `~/.gitconfig`: run git with `GIT_CONFIG_GLOBAL` set to a file holding only
  the gh credential helper. The commit identity lives in this clone's `.git/config` (GitHub no-reply address).
