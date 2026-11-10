# AGENTS.md — AI Coding Agent Handbook

This is the current operating manual for AI coding agents. Humans should read `README.md`; architecture is in `docs/ARCHITECTURE.md`; contribution workflow is in `CONTRIBUTING.md`; current decisions are in `docs/DECISIONS.md`.

## Product

`doodle-mcp` is a local-first **shared infinite canvas embedded in the agent experience**. A person and an AI place notes, text, rectangles, ellipses, and directed arrows on one canvas. Compatible MCP Apps hosts can show the interactive canvas beside the existing agent conversation. Conversation stays in the host chat; the browser page is a standalone fallback.

The board is the product. Project structure is only one optional subject that can be drawn. There is no second session model, proposal workflow, approval grant, code-change authority, diagram library, or workbench.

Default loop:

```text
get_board → show_board → draw_board → person edits the same canvas → AI reads it again
```

Shared visual context is anchored to objects, coordinates, text, and authors. `scan_project` may provide bounded read-only project context; it does not draw, change the board, write files, or authorize code changes.

## Four MCP tools

| Tool | Use |
|---|---|
| `get_board` | Read `BOARD_JSON`: object IDs, coordinates, authors, and the drawing guide. Read-only. |
| `show_board` | Open the interactive shared canvas beside the conversation in MCP Apps hosts. The user asked to see or edit the canvas. |
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
│   ├── workspace.ts            DOODLE_WORKSPACE_ROOT resolution
│   ├── version.ts              package version lookup
│   └── templates/board.html    shared standalone and embedded infinite canvas
scripts/                        build, doctor, and offline repository guards
test/                           board, HTTP, and MCP integration checks
examples/                       MCP host config and a minimal client
docs/                           product, architecture, decisions, and maintenance
```

## Architecture rules

- stdout is reserved for MCP JSON-RPC. All logs and diagnostics go to stderr.
- Tool names are `snake_case`; TypeScript files are `kebab-case`; registration functions are `registerXxx`.
- Tool descriptions are written for an LLM and explain when to use another tool instead.
- `SimpleBoard` is version 1. Protocol or persisted-state changes require compatibility tests and synchronized docs/guards.
- The server version comes from `package.json`; do not hard-code it in `src/server.ts`.
- The preview server binds to `127.0.0.1` by default.
- Non-GET `/api/board/*` requests require the random HTML-injected `X-AI-Draw-Token` and `confirmedBy: "human"`.
- Human view settings belong only in browser localStorage. They are not board state or permission.
- `scan_project` returns workspace-relative paths and short evidence only; it skips dot-private paths, `.env`-like files, generated directories, large text, and common credential lines, with at most 40 evidence lines total.
- Board mutations are serialized across processes with a filesystem lock and atomic rename; stale snapshot replacement is rejected.
- Board objects are visual context. The embedded UI calls only the normal canvas read/write tools; it never becomes project-write authority. Code changes remain a separate, explicitly reviewed coding-agent action.

## Validation

Run `npm run check` before proposing a change. It covers TypeScript, build, tests, example syntax, offline repository guards, doctor, and package contents. Protocol, tool, security, or product changes must update all of `AGENTS.md`, `README.md`, `README.en.md`, `docs/PRODUCT_DIRECTION.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `CHANGELOG.md`, tests, examples, and `scripts/repo-check.mjs` together.

Keep the product small. Historical ADRs under `docs/archive/adr-legacy/` are read-only history, not current contracts.
