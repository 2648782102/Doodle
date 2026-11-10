# AGENTS.md — AI Coding Agent Handbook

This is the current operating manual for AI coding agents. Humans should read `README.md`; architecture is in `docs/ARCHITECTURE.md`; contribution workflow is in `CONTRIBUTING.md`; current decisions are in `docs/DECISIONS.md`.

## Product

`doodle-mcp` is a local-first **simple shared infinite board**. A person and an AI place notes, text, rectangles, ellipses, and directed arrows on one canvas. MCP stdio is the AI's normal access channel inside an agent; the repository also builds an installable desktop-only Codex plugin around the same four-tool MCP server. Compatible MCP Apps hosts may show the interactive canvas beside the existing agent conversation as an optional enhancement. Conversation stays in the host chat; the standalone local page is a fallback, never a side effect of a normal tool call.

The board is the product. Project structure is only one optional subject that can be drawn. There is no second session model, proposal workflow, approval grant, code-change authority, diagram library, or workbench.

Default loop:

```text
get_board → show_board → draw_board → person edits the same canvas → AI reads it again
```

Shared visual context is anchored to objects, coordinates, text, and authors. `scan_project` may provide bounded read-only project context; it does not draw, change the board, write files, or authorize code changes. `get_board` also reports `PANEL_URL`, the active local human-facing address.

## Four MCP tools

| Tool | Use |
|---|---|
| `get_board` | Read `BOARD_JSON`: object IDs, coordinates, authors, `PANEL_URL`, and the drawing guide. Read-only. |
| `show_board` | Render the optional MCP App canvas in compatible hosts when the user asks to see or edit the board. |
| `draw_board` | Batch add, update, or remove simple visual objects. Use `remove_ids` to clear old objects before redrawing a full diagram. |
| `scan_project` | Optional bounded read-only project paths and `file:line` evidence. Visualize the result with `draw_board` only when useful. |

Drawing contract:

- Read `BOARD_JSON` first and reuse existing item IDs for updates and removals. Board mutations are serialized against the latest state; stale browser edits require a reload after conflict.
- Put `author` at the `draw_board` top level, not inside each item.
- Use a strict grid, short labels, consistent sizes, and endpoints just outside source/target shapes.
- A `line` is a directed arrow from `(x,y)` to `(x+w,y+h)`. `w` and `h` are signed endpoint deltas and may be negative. Other objects use `(x,y)` as the top-left corner and positive width/height.
- In the human canvas, click to place a default-sized shape or drag to size shapes and draw arrows in any direction. Space-drag or middle-drag pans; the wheel pans and Ctrl/Command-wheel zooms.
- Do not fake connectors with text or decorative horizontal lines.
- Normal tool calls never open a browser, IDE, or editor, and never write project files.

## Source map

```text
src/
├── index.ts                    MCP stdio and HTTP lifecycle
├── server.ts                   composition root; registers four tools
├── board/
│   ├── types.ts                version 1 board state and pure mutations
│   ├── store.ts                locked atomic board.json persistence and revision sync
│   ├── project-scan.ts         bounded read-only workspace scan
│   ├── http.ts                 local board API, HTML, and WebSocket updates
│   ├── tools.ts                four MCP tools and optional MCP App resource
│   ├── app.ts                  MCP Apps bridge for the embedded canvas
│   ├── instructions.ts         MCP initialization instructions
│   └── index.ts                board module entrypoint
├── infra/
│   ├── config.ts               environment configuration
│   ├── logger.ts               stderr-only logger
│   ├── project-workspace.ts    plugin-safe workspace resolution
│   ├── workspace.ts            DOODLE_WORKSPACE_ROOT resolution
│   ├── version.ts              package version lookup
│   └── templates/board.html    shared standalone and embedded infinite canvas
plugins/doodle/                 installable Codex plugin source: compatibility manifest, MCP config, skill, assets
.agents/plugins/                repository-scoped plugin marketplace catalog
scripts/                        build, plugin build, doctor, and offline repository guards
test/                           board, HTTP, and MCP integration checks
examples/                       MCP host config and a minimal client
docs/                           product, architecture, decisions, and maintenance
```

## Architecture rules

- stdout is reserved for MCP JSON-RPC. All logs and diagnostics go to stderr.
- Tool names are `snake_case`; TypeScript files are `kebab-case`; registration functions are `registerXxx`.
- Tool descriptions are written for an LLM and explain when to use another tool instead.
- Every MCP tool registers explicit `readOnlyHint`, `destructiveHint`, and `openWorldHint` annotations. `draw_board` is destructive because it can remove or overwrite objects.
- `SimpleBoard` is version 1. Protocol or persisted-state changes require compatibility tests and synchronized docs/guards.
- The server version comes from `package.json`; do not hard-code it in `src/server.ts`.
- The preview server binds to `127.0.0.1` by default. `PREVIEW_PORT` selects a fixed port; when unset, the server binds to a free loopback port and `get_board` reports it as `PANEL_URL`.
- Normal startup connects MCP stdio before starting the local HTTP preview. Preview startup failure is logged on stderr and does not disable the MCP tools.
- Non-GET `/api/board/*` requests require the random HTML-injected `X-AI-Draw-Token` and `confirmedBy: "human"`.
- Human view settings belong only in browser localStorage. They are not board state or permission.
- `scan_project` returns workspace-relative paths and short evidence only; it skips dot-private paths, `.env`-like files, generated directories, large text, and common credential lines, with at most 40 evidence lines total.
- Board mutations are serialized across processes with a filesystem lock and atomic rename; stale snapshot replacement is rejected.
- Board objects are visual context. The embedded UI calls only the normal canvas read/write tools; it never becomes project-write authority. Code changes remain a separate, explicitly reviewed coding-agent action.
- The plugin package uses one Codex-compatible `.codex-plugin/plugin.json` and `.mcp.json` layout; portable Agent Plugins manifests are not mixed into the same package.
- `OUTPUT_DIR` is the explicit board state directory. Without it, plugin data is preferred; direct MCP launches may use workspace-local `.doodle-data`. `DOODLE_WORKSPACE_ROOT` still controls bounded `scan_project` context.
- `scripts/build-plugin.mjs` bundles the same source into `.doodle-plugin/doodle/server/index.mjs` with its board template, MCP App bundle, and package-version constant. Generated `.doodle-plugin/` output is never committed.

## Validation

Run `npm run check` before proposing a change. It covers TypeScript, build, plugin build, tests, example syntax, offline repository guards, plugin guards, submission ZIP, doctor, and package contents. CI runs the same plugin guard. Protocol, tool, security, plugin packaging, or product changes must update all of `AGENTS.md`, `README.md`, `README.en.md`, `docs/PRODUCT_DIRECTION.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/GOAL_PLUGIN.md`, `CHANGELOG.md`, tests, examples, `.github/workflows/ci.yml`, `scripts/repo-check.mjs`, and `scripts/plugin-check.mjs` together.

Keep the product small. Historical ADRs under `docs/archive/adr-legacy/` are read-only history, not current contracts.
