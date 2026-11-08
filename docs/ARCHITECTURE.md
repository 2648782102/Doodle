# Architecture

AI Draw MCP is a local-first shared infinite board. The AI uses MCP stdio inside its coding agent; the human uses one small HTTP canvas. Both sides read and write one independent version 1 board state file. The project source remains the source of truth for code.

## Source layout

```text
src/
├── index.ts                    MCP stdio and HTTP lifecycle
├── server.ts                   composition root; four tools
├── board/
│   ├── types.ts                version 1 board state and pure object mutations
│   ├── store.ts                atomic board.json persistence and revision sync
│   ├── project-scan.ts         bounded read-only workspace path/evidence scan
│   ├── http.ts                 local board API, HTML template, WebSocket updates
│   ├── tools.ts                get / draw / reply / scan MCP tools
│   ├── instructions.ts         MCP initialization guidance for agents
│   └── index.ts                board module entrypoint
├── infra/
│   ├── config.ts               PREVIEW_HOST / PREVIEW_PORT / OUTPUT_DIR / workspace
│   ├── logger.ts               stderr-only logger
│   ├── workspace.ts            AI_DRAW_WORKSPACE_ROOT resolution
│   ├── version.ts              version read from package.json
│   └── templates/board.html    one human-facing infinite canvas
```

There is no `src/domain/` workbench model, `src/tools/render-*`, Mermaid renderer, session store, proposal store, or legacy panel template in `0.4.0`.

## MCP surface

`src/server.ts` registers exactly four tools:

| Tool | Effect | Output |
|---|---|---|
| `get_board` | Reads one shared version 1 board | `BOARD_JSON`, drawing guide, recent notes |
| `draw_board` | Adds / updates / removes visual objects | revision and counts |
| `reply_on_board` | Adds one short AI note beside the board | note ID and revision |
| `scan_project` | Reads bounded project paths and evidence | `PROJECT_JSON` and `PROJECT_TEXT` |

No tool opens a browser, writes a project file, launches an IDE, or emits approval credentials. MCP initialization instructions and `get_board` both describe the directed-arrow contract and the recommended strict-grid workflow.

## Board state

`BoardStore` persists `output/.ai-draw/board.json` through a temporary file and atomic rename. Every read compares the on-disk revision with the in-memory revision, so a long-lived HTTP process and short-lived MCP clients stay synchronized.

`SimpleBoard` is version 1 and contains bounded `items` and `notes`. Items have finite coordinates, one of five simple types, a hex color, a `human` / `ai` author, and timestamps. For `line`, `(x,y)` is the start point and `(x+w,y+h)` is the end point; `w` and `h` are signed endpoint deltas. Other types use `(x,y)` as the top-left corner and positive width/height.

All board mutations are pure functions in `src/board/types.ts`. They validate finite numbers, bound text and collection sizes, reject unknown authors, and raise the board revision once per change.

## Human HTTP surface

The HTTP server binds to `127.0.0.1` by default and serves only the board:

| Endpoint | Purpose |
|---|---|
| `GET /` | Thin local infinite canvas |
| `GET /api/board` | Current version 1 board state |
| `POST /api/board/items` | Human-confirmed object creation |
| `PATCH /api/board/items/:id` | Human-confirmed object update |
| `DELETE /api/board/items/:id` | Human-confirmed object deletion |
| `POST /api/board/notes` | Human-confirmed short message |
| `GET /project` | Bounded read-only project structure JSON |
| `GET /project/text` | Plain-text projection of the same scan |
| `WS /ws` | `board_updated` revision broadcasts |

Non-GET `/api/board/*` requests require the random `X-AI-Draw-Token` injected into the HTML and `confirmedBy: "human"`. The token exists only in the local browser session and never enters persisted state.

## Read-only project scan

`scan_project` walks the configured workspace root with bounded depth and entry count, skips common generated/private directories, ignores dot-private files including `.env`, and reads only small text files for at most five safe `file:line` evidence lines. Paths are workspace-relative. It returns no file contents beyond short evidence excerpts, no absolute workspace path, and no write capability.

Project scanning does not modify the board. If the AI wants to show structure, it calls `draw_board` with a layout derived from the scan result.

## Safety model

- stdout is reserved for MCP JSON-RPC; all logs go to stderr.
- The preview server defaults to `127.0.0.1`; use `PREVIEW_HOST` only for explicit local configuration.
- The board is communication context, never an authorization channel.
- `scan_project` never writes files; board writes never write project files.
- Offline guards in `scripts/repo-check.mjs` verify the four-tool surface, dependency cleanup, docs alignment, arrow contract, HTTP authentication, and read-only scan boundary. `scripts/build.mjs` removes known stale compiled directories and templates so a local rebuild cannot package deleted source modules.
- `npm run check` runs lint, build, tests, example syntax, offline guards, doctor, and package dry-run.

## Compatibility

Existing `output/.ai-draw/board.json` version 1 files remain compatible. The removed `0.3.x` workbench, 29-tool catalogue, session proposals, Mermaid diagram library, and VS Code extension are intentionally not part of `0.4.0`; their ADRs are historical records under `docs/archive/adr-legacy/`.
