# AGENTS.md — AI Coding Agent Handbook

This is the current operating manual for AI coding agents. Humans should read `README.md`; architecture is in `docs/ARCHITECTURE.md`; contribution workflow is in `CONTRIBUTING.md`; current decisions are in `docs/DECISIONS.md`.

## Product

`doodle-mcp` is a local-first **simple shared infinite board**. A person and an AI place notes, text, rectangles, ellipses, directed arrows, and short messages on one canvas. MCP stdio is the AI's normal access channel inside an agent. The browser is a human-facing view, never a side effect of a normal tool call.

The board is the product. Project structure is only one optional subject that can be drawn. There is no second session model, proposal workflow, approval grant, code-change authority, diagram library, or workbench.

Default loop:

```text
get_board → draw_board / reply_on_board → person edits the same canvas → AI reads it again
```

Communication is anchored to objects, coordinates, text, authors, and short notes. `scan_project` may provide bounded read-only project context; it does not draw, change the board, write files, or authorize code changes.

## Four MCP tools

| Tool | Use |
|---|---|
| `get_board` | Read `BOARD_JSON`: object IDs, coordinates, authors, recent notes, and the drawing guide. Start here. Read-only. |
| `draw_board` | Batch add, update, or remove simple visual objects. Use `remove_ids` to clear old objects before redrawing a full diagram. |
| `reply_on_board` | Put one short AI response beside the canvas, optionally referring to one object ID. |
| `scan_project` | Optional bounded read-only project paths and `file:line` evidence. Visualize the result with `draw_board` only when useful. |

Drawing contract:

- Read `BOARD_JSON` first and reuse existing item IDs for updates and removals.
- Put `author` at the `draw_board` top level, not inside each item.
- Use a strict grid, short labels, consistent sizes, and endpoints just outside source/target shapes.
- A `line` is a directed arrow from `(x,y)` to `(x+w,y+h)`. `w` and `h` are signed endpoint deltas and may be negative. Other objects use `(x,y)` as the top-left corner and positive width/height.
- Do not fake connectors with text or decorative horizontal lines.
- Normal tool calls never open a browser, IDE, or editor, and never write project files.

## Source map

```text
src/
├── index.ts                    MCP stdio and HTTP lifecycle
├── server.ts                   composition root; registers four tools
├── board/
│   ├── types.ts                version 1 board state and pure mutations
│   ├── store.ts                atomic board.json persistence and revision sync
│   ├── errors.ts               board revision conflict error
│   ├── mutex.ts                cross-process board write lock
│   ├── project-scan.ts         bounded read-only workspace scan
│   ├── http.ts                 local board API, HTML, and WebSocket updates
│   ├── tools.ts                four MCP tools
│   ├── instructions.ts         MCP initialization instructions
│   └── index.ts                board module entrypoint
├── infra/
│   ├── config.ts               environment configuration
│   ├── logger.ts               stderr-only logger
│   ├── workspace.ts            DOODLE_WORKSPACE_ROOT resolution
│   ├── version.ts              package version lookup
│   └── templates/board.html    one human-facing infinite canvas
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
- Board writes take a local lock file, reread disk state, and check the expected revision; a stale `draw_board` call fails instead of overwriting a newer canvas.
- Human view settings belong only in browser localStorage. They are not board state or permission.
- `scan_project` returns workspace-relative paths and short evidence only; it skips dot-private paths, `.env`-like files, generated directories, large text, and redacts credential-like evidence.
- Board objects and notes are communication context. They never become approval credentials or project writes. Code changes remain a separate, explicitly reviewed coding-agent action.

## Validation

Run `npm run check` before proposing a change. It covers TypeScript, build, tests, example syntax, offline repository guards, doctor, and package contents. Protocol, tool, security, or product changes must update all of `AGENTS.md`, `README.md`, `README.en.md`, `docs/PRODUCT_DIRECTION.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `CHANGELOG.md`, tests, examples, and `scripts/repo-check.mjs` together.

Keep the product small. Historical ADRs under `docs/archive/adr-legacy/` are read-only history, not current contracts.
