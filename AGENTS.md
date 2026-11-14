# AGENTS.md — AI Coding Agent Handbook

This is the current operating manual for AI coding agents. Humans should read `README.md`; architecture is in `docs/ARCHITECTURE.md`; contribution workflow is in `CONTRIBUTING.md`; current decisions are in `docs/DECISIONS.md`.

## Product

`doodle-mcp` is a local-first **two-way shared infinite board**. A person and an AI both place notes, text, rectangles, ellipses, directed arrows, freehand strokes, and images on one canvas to express intent; each side can read and continue what the other drew. MCP stdio is the AI's normal access channel inside an agent; the repository also builds an installable desktop-only Codex plugin around the same four-tool MCP server. Compatible MCP Apps hosts may show the interactive canvas beside the existing agent conversation as an optional enhancement and attach the board's final-state delta to that conversation's model context. Conversation stays in the host chat; the standalone local page is a fallback, never a side effect of a normal tool call.

The board is the product. Project structure is only one optional subject that can be drawn. A local board library stores editable named version 1 snapshots and lets a person save or switch the active board; it is not PNG export, a diagram asset catalogue, or a second session model. There is no proposal workflow, approval grant, code-change authority, or workbench.

Default two-way loop:

```text
AI: get_board → show_board when needed → draw_board → person sees the board
person: draws or edits the same canvas → final-state context sync / short notification
AI: reads with get_board or current model context → continues in chat or draws again
```

Install and first-use experience:

- Product story is one kernel, two entry points, three capability layers: one shared board; Codex plugin or direct MCP; four tools always, optional embedded canvas, optional context sync and notification. Project structure is optional source material only.
- `npm run setup:codex` is the one-command Codex install path. It runs `npm install` when needed, builds the self-contained plugin, adds the repository marketplace, installs `doodle@doodle`, and prints one first prompt. It never runs as a hidden side effect of validation.
- Official OpenAI documentation distinguishes local marketplaces from the public plugin directory; installed plugin skills and MCP tools are used in a new session. See [Package your plugin](https://developers.openai.com/plugins/build/plugins) and [Developer commands](https://learn.chatgpt.com/docs/developer-commands).
- Direct MCP examples use zero-configuration `npx -y doodle-mcp`; `DOODLE_WORKSPACE_ROOT` and other environment variables are optional overrides, not installation prerequisites.
- `PANEL_URL` belongs to the current MCP server process and may disappear when the host session ends. `npm run preview:board` is the explicit terminal-owned HTTP-only preview; it registers no MCP tools and installs no background service.
- `get_board` uses progressive guidance: an empty board returns `FIRST_USE` / `NEXT_STEPS` and the drawing guide; a board with objects returns a concise `NEXT`. It always retains `BOARD_JSON`, `PANEL_URL`, the structured snapshot, and version 1 board state.
- `get_board` includes the local `library` index; `draw_board.library` performs save/switch/create/rename/duplicate/delete/import/export actions on editable version 1 board snapshots and may change the active board.
- The canvas exposes a dismissible `?` help popover with creation, multi-select, undo/redo, image paste, and navigation gestures. It is UI state in browser localStorage, never board state or permission.
- In MCP Apps hosts that advertise `updateModelContext`, the embedded canvas publishes the current final board snapshot and a delta from the last published snapshot. This is final state, not an operation log, and it does not trigger a model turn. A `通知 Agent` button appears only when `sendMessage` is also supported; it sends one short user message in the host's existing conversation. Neither path creates a Doodle chat, session, or message feed. `get_board` remains authoritative; a standalone `PANEL_URL` page has no bridge to the current host session.

Shared visual context is anchored to objects, coordinates, text, and authors. Either side may add or revise objects. `scan_project` may provide bounded read-only project context; it does not draw, change the board, write files, or authorize code changes. `get_board` also reports `PANEL_URL`, the active local human-facing address; mention it when a person asks where to look or when the host cannot render an embedded canvas.

## Four MCP tools

| Tool | Use |
|---|---|
| `get_board` | Read progressive `FIRST_USE` / `NEXT_STEPS` or `NEXT` guidance, `BOARD_JSON`: object IDs, coordinates, authors, `PANEL_URL`, and the drawing guide on an empty board. Read-only. |
| `show_board` | Render the optional MCP App canvas in compatible hosts when the user asks to see or edit the board. |
| `draw_board` | Add items, precise updates/removals, deterministic layout, visual-expression fields, and local board-library actions. Use `remove_ids` only when clearing old objects before a deliberate full redraw. |
| `scan_project` | Optional bounded read-only project paths and `file:line` evidence. Visualize the result with `draw_board` only when useful. |

Drawing contract:

- Read `BOARD_JSON` first; prefer `updates` for precise changes and reuse existing item IDs for removals. Board mutations are serialized against the latest state; stale browser edits require a reload after conflict.
- Put `author` at the `draw_board` top level, not inside each item.
- Use a strict grid, short labels, consistent sizes, and endpoints just outside source/target shapes.
- A `line` is a directed arrow from `(x,y)` to `(x+w,y+h)`. `w` and `h` are signed endpoint deltas and may be negative; `shape` may be `straight`, `curve`, or `orthogonal`. `startItemId` / `endItemId` bind endpoints to object edges. Other objects use `(x,y)` as the top-left corner and positive width/height.
- `stroke.points` are local to the object bounds; `image.src` is a bounded `data:image/*;base64` source. `title`, `emphasis: focus`, and `groupId` are optional version 1 fields; old boards remain valid.
- `variant`, `role`, `z`, `style`, `startItemId`, and `endItemId` are optional version 1 visual-expression fields. `get_board` returns `capabilities`, `visualDigest`, and recipe guidance; read them before drawing or interpreting a board.
- In the human canvas, click to place a default-sized object or drag to size shapes, sketch strokes, and draw arrows in any direction. Double-click empty canvas creates a note; dragging on empty canvas marquee-selects; selected objects support batch move/delete/group/layout, undo/redo, arrow-key nudging, and alignment snapping. The `图库` panel saves, switches, renames, duplicates, deletes, imports, and exports editable board snapshots. `Ctrl/⌘+V` pastes a bounded local image. Space-drag or middle-drag pans; the wheel pans and Ctrl/Command-wheel zooms.
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
│   ├── app-context.ts          final-state board delta and model context projection
│   ├── instructions.ts         MCP initialization instructions
│   ├── library.ts              local editable board snapshot index and actions
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
scripts/setup-codex.mjs         one-command Codex plugin install and first-use guide
test/                           board, HTTP, and MCP integration checks
examples/                       MCP host config and a minimal client
docs/                           product, architecture, decisions, and maintenance
```

## Architecture rules

- stdout is reserved for MCP JSON-RPC. All logs and diagnostics go to stderr.
- Tool names are `snake_case`; TypeScript files are `kebab-case`; registration functions are `registerXxx`.
- Tool descriptions are written for an LLM and explain when to use another tool instead.
- Every MCP tool registers explicit `readOnlyHint`, `destructiveHint`, and `openWorldHint` annotations. `draw_board` is destructive because it can remove or overwrite objects.
- `SimpleBoard` is version 1. Extended optional object fields are backward-compatible version 1 additions; any required or incompatible state change still requires compatibility tests and synchronized docs/guards.
- The server version comes from `package.json`; do not hard-code it in `src/server.ts`.
- The preview server binds to `127.0.0.1` by default. `PREVIEW_PORT` selects a fixed port; when unset or `0`, the server binds to a free loopback port and `get_board` reports it as `PANEL_URL`.
- Normal startup connects MCP stdio before starting the local HTTP preview. Preview startup failure is logged on stderr and does not disable the MCP tools.
- Non-GET `/api/board/*` requests require the random HTML-injected `X-AI-Draw-Token` and `confirmedBy: "human"`.
- Human view settings belong only in browser localStorage. They are not board state or permission.
- `scan_project` returns workspace-relative paths and short evidence only; it skips dot-private paths, `.env`-like files, generated directories, large text, and common credential lines, with at most 40 evidence lines total.
- Board mutations are serialized across processes with a filesystem lock and atomic rename; stale snapshot replacement is rejected.
- Board library mutations use their own local lock and atomic JSON files under `OUTPUT_DIR/.doodle/boards/`; the active `board.json` remains authoritative for the current MCP session.
- Board objects are visual context. The embedded UI calls only the normal canvas read/write tools; it never becomes project-write authority. Code changes remain a separate, explicitly reviewed coding-agent action.
- The embedded canvas calls `updateModelContext` only after host capability detection and `app.connect()`. Each update overwrites the prior context and includes the complete current structured snapshot plus `added` / `updated` / `removed` final-state differences. Automatic updates never call `sendMessage`; the button alone sends the short notification. Failures are logged in the app and never break canvas editing.
- The plugin package uses one Codex-compatible `.codex-plugin/plugin.json` and `.mcp.json` layout; portable Agent Plugins manifests are not mixed into the same package.
- `OUTPUT_DIR` is the explicit board state directory. Without it, plugin data is preferred; direct MCP launches may use workspace-local `.doodle-data`. `DOODLE_WORKSPACE_ROOT` still controls bounded `scan_project` context.
- `scripts/build-plugin.mjs` bundles the same source into `.doodle-plugin/doodle/server/index.mjs` with its board template, MCP App bundle, and package-version constant. Generated `.doodle-plugin/` output is never committed.

## Validation

Run `npm run check` before proposing a change. It covers TypeScript, build, plugin build, tests, example syntax, offline repository guards, plugin guards, submission ZIP, doctor, and package contents. CI runs the same plugin guard. Protocol, tool, security, plugin packaging, or product changes must update all of `AGENTS.md`, `README.md`, `README.en.md`, `docs/PRODUCT_DIRECTION.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/GOAL_PLUGIN.md`, `docs/EXPERIENCE_AUDIT.md`, `CHANGELOG.md`, `PRIVACY.md`, tests, examples, `.github/workflows/ci.yml`, `scripts/repo-check.mjs`, and `scripts/plugin-check.mjs` together.

Keep the product small. Historical ADRs under `docs/archive/adr-legacy/` are read-only history, not current contracts.
