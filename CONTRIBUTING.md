# Contributing

Thanks for helping keep Doodle small, predictable, and useful inside an agent.

## Ground rules

- The shared infinite canvas is the product. Do not make project structure, a dashboard, a chat app, or an approval workflow the main subject again.
- Keep the MCP tool surface at four tools unless `docs/DECISIONS.md` records an explicit change. Keep the shared canvas UI optional so tools remain usable in text-only hosts, and keep the plugin as a distribution layer around the same server.
- Keep normal MCP calls free of browser, IDE, editor, and project-write side effects.
- Keep `SimpleBoard` versioned, bounded, and independent of project files.
- stdout is reserved for MCP JSON-RPC; logs go to stderr.

## Setup

Requires Node.js 20 or newer.

```bash
npm install
npm run build
npm run check
```

`npm run check` runs TypeScript lint, build, plugin build, Vitest, example syntax checks, offline repository guards, plugin guards, setup dry-run, `doctor`, and `npm pack --dry-run`. It never modifies the active user's Codex configuration. To inspect the human canvas, start `node dist/index.js`, read the `PANEL_URL` returned by `get_board`, and open that local address only when a person wants to see it.

## Protocol and safety changes

A change to an MCP tool schema, the version 1 board state, the HTTP API, project scanning, or a security boundary must update all of these together:

- `AGENTS.md`, `README.md`, and `README.en.md`
- `docs/PRODUCT_DIRECTION.md`, `docs/GOAL_PLUGIN.md`, `docs/ARCHITECTURE.md`, and `docs/DECISIONS.md`
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
