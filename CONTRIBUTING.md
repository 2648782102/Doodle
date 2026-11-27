# Contributing

Thanks for helping keep Doodle small, predictable, and useful inside an agent.

## Ground rules

- The shared infinite canvas is the product. Do not make project structure, a dashboard, a chat app, or an approval workflow the main subject again.
- Keep the MCP surface to the three drawing tools `get_board`, `show_board`, and `draw_board`. Keep the shared canvas UI optional so tools remain usable in text-only hosts, and keep the plugin as a distribution layer around the same server.
- Keep normal MCP calls free of browser, IDE, editor, and project-write side effects.
- Keep `SimpleBoard` versioned and bounded. Doodle reads and writes board state; host repository context stays outside the product.
- stdout is reserved for MCP JSON-RPC; logs go to stderr.

## Setup

Requires Node.js 20 or newer.

```bash
npm install
npm run build
npm run check
```

`npm run check` runs TypeScript lint, build, plugin build, Vitest, example syntax checks, offline repository guards, plugin guards, setup dry-run, `doctor`, and `npm pack --dry-run`. It never modifies the active user's Codex configuration. To inspect the human canvas, start `node dist/index.js`, read the `PANEL_URL` returned by `get_board`, and open that local address only when a person wants to see it.

The browser contract suite is intentionally opt-in: `npm run test:browser` needs a local Chromium download, so `npm run check` and CI leave it out. Run it before finishing any change to the canvas chrome, the first-use panels, the library drawer, or an Excalidraw upgrade. Those are precisely the surfaces where a DOM rename or focus regression looks fine in unit tests and fails for a person; the suite also pins the first-use card → shortcut-panel-once sequence.

## Parallel worktrees

Several branches can be worked on at the same time without cloning the repository again:

```bash
git worktree add ../doodle-worktrees/board-library -b codex/board-library
cd ../doodle-worktrees/board-library
npm ci
```

Use one worktree per branch and never two agents in the same checkout. Uncommitted edits belong to the checkout, not to a branch, so a second agent in the same directory will silently pick up and overwrite the first agent's work.

Each worktree builds and tests in isolation. Every preview server asks the OS for a free loopback port, so concurrent `npm test` runs do not collide; do not pin `PREVIEW_PORT` in tests. Board state also stays local: without `OUTPUT_DIR`, a checkout writes to its own `output/` directory, because the package root is the worktree itself. The main checkout's board is never shared into a worktree.

Two things are intentionally still global, so do not expect worktree isolation there:

- `npm run setup:codex` registers the local marketplace in the user's `~/.codex/config.toml`. Running it from a second worktree repoints the same `doodle@doodle` install at that worktree. Use one checkout for plugin installs, or run the others with `--dry-run`.
- The files that every change has to touch — `scripts/repo-check.mjs`, `CHANGELOG.md`, and `AGENTS.md` — conflict on merge by design. Resolve them when you integrate the branch; do not duplicate their content into per-branch variants.

## Protocol and safety changes

A change to an MCP tool schema, the version 1 board state, the HTTP API, the embedded host context bridge, or a security boundary must update all of these together:

- `AGENTS.md`, `README.md`, and `README.en.md`
- `docs/PRODUCT_DIRECTION.md`, `docs/GOALS.md`, `docs/ARCHITECTURE.md`, and `docs/DECISIONS.md`
- `CHANGELOG.md`, `SECURITY.md`, `PRIVACY.md`, `SUPPORT.md`, `TERMS.md`, `docs/FAQ.md`, `docs/SUBMISSION.md`, and relevant maintenance docs
- `test/board.test.mjs`, `test/http.test.mjs`, and `test/mcp.test.mjs`
- `examples/`, `.github/workflows/ci.yml`, `scripts/repo-check.mjs`, and `scripts/plugin-check.mjs`

Add a regression test before changing behavior. Do not reintroduce a second state model, a browser-launching dependency, or a project-write grant.

## Pull requests

- Keep changes focused and explain the human and AI sides of the experience.
- Run `npm run check` and paste the relevant result.
- Do not commit `dist/`, `.doodle-plugin/`, `doodle-plugin-submission/`, `.doodle-data/`, `output/.doodle/`, `.env`, credentials, generated images, or tarballs.
- Use the PR template and link an issue when the change affects product direction.

## Community

Please follow `CODE_OF_CONDUCT.md`. Report security issues privately as described in `SECURITY.md`. See `SUPPORT.md` for ordinary help channels and `docs/FAQ.md` for plugin distribution questions.
