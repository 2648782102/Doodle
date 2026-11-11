# Architecture

Doodle is a local-first shared infinite canvas. The repository builds two distribution paths from the same source: the npm CLI/direct MCP server and a desktop-only Codex plugin with a bundled stdio server. Compatible MCP Apps hosts may render its interactive canvas beside the agent conversation as an optional enhancement; the host retains its existing chat surface. A standalone local HTTP page provides the same canvas when the host does not render MCP Apps. Both views and the AI tools share one independent version 1 board state file.

## Source layout

```text
src/
├── index.ts                    MCP stdio and HTTP lifecycle
├── server.ts                   composition root; four tools
├── board/
│   ├── types.ts                version 1 board state and pure object mutations
│   ├── store.ts                atomic board.json persistence and revision sync
│   ├── errors.ts               revision conflict error
│   ├── mutex.ts                cross-process board write lock
│   ├── project-scan.ts         bounded read-only workspace path/evidence scan
│   ├── http.ts                 local board API, HTML and WebSocket updates
│   ├── tools.ts                get / draw / scan tools and MCP App resource
│   ├── app.ts                  MCP Apps bridge client for embedded canvas edits
│   ├── instructions.ts         MCP initialization guidance for agents
│   └── index.ts                board module entrypoint
├── infra/
│   ├── config.ts               PREVIEW_HOST / PREVIEW_PORT / OUTPUT_DIR / workspace
│   ├── logger.ts               stderr-only logger
│   ├── project-workspace.ts    plugin-safe workspace resolution
│   ├── workspace.ts            DOODLE_WORKSPACE_ROOT resolution
│   ├── version.ts              package version read
│   └── templates/board.html    shared standalone and embedded infinite canvas
plugins/doodle/                 compatibility manifest, MCP config, skill, assets
.agents/plugins/                repository-scoped plugin marketplace
scripts/build.mjs               copies HTML and bundles the optional MCP Apps client
scripts/build-plugin.mjs        bundles the self-contained plugin server and templates
scripts/plugin-check.mjs        validates plugin manifests, skill, marketplace, and build output
```

There is no `src/domain/` workbench model, Mermaid renderer, session store, proposal store, or legacy panel template in `0.6.1`. The plugin uses only the supported Codex compatibility layout; generated `.doodle-plugin/` output is ignored.

## MCP surface

Both runtime paths register exactly four tools:

| Tool | Effect | Output |
|---|---|---|
| `get_board` | Reads one shared version 1 board | `BOARD_JSON`, drawing guide, structured board snapshot |
| `show_board` | Returns the optional MCP App resource beside the conversation | initial structured board snapshot and interactive UI |
| `draw_board` | Adds / updates / removes visual objects under the board lock; can reject stale app edits by expected revision | revision, counts, authoritative structured snapshot |
| `scan_project` | Reads bounded project paths and evidence | `PROJECT_JSON` and `PROJECT_TEXT` |

All tools are registered through the MCP SDK config API with explicit annotations: `get_board`, `show_board`, and `scan_project` are read-only, non-destructive, and local-scope; `draw_board` is destructive because it can remove or overwrite visual objects. These values are integration-tested and guarded by the offline repository checks.

The optional canvas resource uses `text/html;profile=mcp-app` and is attached to `show_board` and to successful `draw_board` results. `show_board` remains the explicit render tool; the write result also advertises the canvas so compatible hosts automatically show the board after an AI drawing. The app calls `get_board` and `draw_board` through the host bridge, refreshes at a low rate while visible, and sends the revision it has rendered so a concurrent model edit cannot be overwritten. This keeps browser HTTP credentials inside the standalone page while the embedded canvas uses the host's authenticated MCP connection. Text-only hosts retain the complete tool workflow and should call `show_board` after drawing when they support it.

No tool opens a browser, writes a project file, launches an IDE, or emits approval credentials. MCP initialization instructions and `get_board` describe the directed-arrow contract and strict-grid workflow.

## Board state

`BoardStore` persists `.doodle/board.json` under the configured output directory through a uniquely named temporary file and atomic rename. A filesystem lock serializes mutations across processes; mutations always read the latest board while holding the lock. Snapshot-based browser edits require the expected revision and fail instead of overwriting a concurrent update. Stale-lock recovery checks the recorded process ID. It can read the legacy `.ai-draw/board.json` under the same output directory once when the new file does not exist.

`SimpleBoard` remains version 1 and contains bounded `items` and `notes`. Existing note data is retained only for persisted-state compatibility and is not exposed in the current tool projection or UI. Items have finite coordinates, one of five simple types, a hex color, a `human` / `ai` author, and timestamps. For `line`, `(x,y)` is the start point and `(x+w,y+h)` is the end point; `w` and `h` are signed endpoint deltas. Other types use `(x,y)` as the top-left corner and positive width/height.

All board mutations are pure functions in `src/board/types.ts`. They validate finite numbers, bound text and collection sizes, reject unknown authors, and raise the board revision once per change. Persisted text is revalidated against the same limits.

## Human HTTP surface

The HTTP server binds to `127.0.0.1` by default and a free loopback port when `PREVIEW_PORT` is unset. MCP stdio is connected first; preview startup failure is logged on stderr and leaves the tools usable. `get_board` reports the active `PANEL_URL`. The server serves the standalone canvas:

| Endpoint | Purpose |
|---|---|
| `GET /` | Standalone infinite canvas |
| `GET /api/board` | Current version 1 board state |
| `POST /api/board/items` | Human-confirmed object creation |
| `PATCH /api/board/items/:id` | Human-confirmed object update |
| `DELETE /api/board/items/:id` | Human-confirmed object deletion |
| `GET /api/board/project` | Bounded read-only project structure JSON |
| `GET /api/board/project/text` | Plain-text projection of the same scan |
| `WS /ws` | `board_updated` revision broadcasts |

Non-GET `/api/board/*` requests require the random `X-AI-Draw-Token` injected into the HTML and `confirmedBy: "human"`. The human canvas also sends `If-Match-Revision` equal to its last read board revision; a conflict returns HTTP 409. Legacy clients without the revision header are serialized against the latest state. Oversized JSON returns HTTP 413. The token exists only in the local browser session and never enters persisted state.

## Read-only project scan

`scan_project` walks the configured workspace root with bounded depth and entry count, skips common generated/private directories, ignores dot-private files including `.env`, and reads only small text files for at most five evidence lines per file and 40 total. Candidate lines containing common secret names or credential formats are omitted. Paths are workspace-relative. It returns no file contents beyond short evidence excerpts, no absolute workspace path, and no write capability.

The canvas supports click-to-place defaults, drag-to-size shapes, directional drag-to-draw arrows, Space or middle-button panning, wheel panning, and Ctrl/Command-wheel zoom. Pointer cancellation discards an in-progress drawing. Dragging arrows uses their bounds so negative endpoint deltas do not make them jump. In MCP Apps hosts, a small `展开` control appears when fullscreen is available.

Project scanning does not modify the board. If the AI wants to show structure, it calls `draw_board` with a layout derived from the scan result.

## Safety model

- stdout is reserved for MCP JSON-RPC; all logs go to stderr.
- The preview server defaults to `127.0.0.1`; use `PREVIEW_HOST` only for explicit local configuration.
- The board is visual context, never an authorization channel.
- Board mutations acquire a cross-process lock, read current state inside the lock, and persist with a unique temporary file plus atomic rename.
- Project-scan evidence filters common credential lines and is capped at 40 lines total.
- `scan_project` never writes files; board writes never write project files.
- Offline guards in `scripts/repo-check.mjs` verify the four-tool surface, optional MCP App registration, dependency setup, plugin packaging, docs alignment, arrow contract, HTTP authentication, and read-only scan boundary. `scripts/plugin-check.mjs` validates the plugin identity, marketplace, skill, bundle template paths, generated runtime, and desktop-only flag. `scripts/build.mjs` prunes stale compiled files, copies the canvas template, and bundles the embedded App.
- `npm run check` runs lint, build, plugin build, tests, example syntax, offline guards, plugin guard, doctor, and package dry-run.

## Compatibility

Existing version 1 `.ai-draw/board.json` files under the configured output directory remain readable, including their notes. `AI_DRAW_WORKSPACE_ROOT` remains a legacy alias for `DOODLE_WORKSPACE_ROOT`. Explicit `OUTPUT_DIR`, plugin data, and workspace-local `.doodle-data` all point at the same board-state layout. `CODEX_PROJECT_ROOT`/`PWD` help the plugin find the launched workspace without exposing plugin-internal paths. The removed `0.3.x` workbench, 29-tool catalogue, session proposals, Mermaid diagram library, and VS Code extension remain only as historical records under `docs/archive/adr-legacy/`.
