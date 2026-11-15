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
| `get_board` | Read progressive guidance, `BOARD_JSON`: object IDs, coordinates, authors, `PANEL_URL`, and the drawing guide once per process. Pass `since_revision` for a delta plus `HANDOFF` (human-attributed changes only). Canvas fidelity metadata is returned only with `include_canvas_fidelity: true`, which the canvas uses to rebuild its scene. Read-only. |
| `show_board` | Render the optional MCP App canvas in compatible hosts when the user asks to see or edit the board. |
| `draw_board` | Add items, precise updates/removals, deterministic layout, visual-expression fields, local board-library actions, and `diagram` for one complete semantic diagram. Use `remove_ids` only when clearing old objects before a deliberate full redraw. |
| `scan_project` | Optional bounded read-only project paths and `file:line` evidence. Visualize the result with `draw_board` only when useful. |

Drawing contract:

- Read `BOARD_JSON` first; prefer `updates` for precise changes and reuse existing item IDs for removals. Board mutations are serialized against the latest state; stale browser edits require a reload after conflict.
- Put `author` at the `draw_board` top level, not inside each item.
- Use a strict grid, short labels, consistent sizes, and endpoints just outside source/target shapes.
- A `line` is a directed arrow from `(x,y)` to `(x+w,y+h)`. `w` and `h` are signed endpoint deltas and may be negative; `shape` may be `straight`, `curve`, or `orthogonal`. `startItemId` / `endItemId` bind endpoints to object edges. Other objects use `(x,y)` as the top-left corner and positive width/height.
- `draw_board.diagram` is the preferred AI authoring primitive for complex diagrams. It takes semantic nodes/edges, adds one deterministic bounded Board v1 diagram beside existing objects, and must not be combined with other mutation fields; only `replace: true` clears the board. `diagram.mode` selects `flow` (edges derive columns), `timeline`, `compare`, or `matrix` (explicit `column`/`row`). `layout.mode: "architecture"` reflows existing connected objects.
- `diagram` reports what it drew: the reply states `n 个节点 · m 条连接`, and every edge in `diagram.edges` now produces a routed line — snaked, skip, and vertical links included — so `m` equals the requested count. A `flow` with no explicit `column`/`row` snakes after six columns instead of becoming one unreadable strip. When the diagram is added beside existing objects, any generated id that is already taken (`diagram_frame`, a reused `n1`) gets a numeric suffix and its connector bindings are rewritten, so a second iteration never fails with `Duplicate board item ID`.
- Connector bindings in Board v1 may reference an item that appears *later* in the array; `parseBoard` validates existence only after every item is collected. Do not reintroduce the incremental `itemIds.has()` check — it rejected the natural "line first, then its endpoints" ordering with `Invalid line start item`.
- `stroke.points` are local to the object bounds; `image.src` is a bounded `data:image/*;base64` source. `title`, `emphasis: focus`, and `groupId` are optional version 1 fields; old boards remain valid.
- `variant`, `role`, `z`, `style`, `startItemId`, and `endItemId` are optional version 1 visual-expression fields. `get_board` returns `capabilities`, `visualDigest`, and recipe guidance; read them before drawing or interpreting a board.
- In the human canvas, click to place a default-sized object or drag to size shapes, sketch strokes, and draw arrows in any direction. Double-click empty canvas creates a note; dragging on empty canvas marquee-selects; selected objects support batch move/delete/group/layout, undo/redo, arrow-key nudging, and alignment snapping. The `图库` drawer overlays the canvas without resizing it, hides its launcher while open, keeps its board list independently scrollable, and pins its action rows. The Doodle top bar yields to Excalidraw dropdown menus and modal overlays instead of stacking above them. `Ctrl/⌘+V` pastes a bounded local image. Space-drag or middle-drag pans; the wheel pans and Ctrl/Command-wheel zooms.
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
│   └── templates/
│       ├── excalidraw.html     Excalidraw-only standalone and embedded canvas
│       ├── excalidraw-app.tsx  canvas client: board sync, library, exports, theme
│       └── liquid-glass.ts     per-pane SVG refraction filters for the chrome
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
- Hover and active feedback must not change element geometry. Color, border, and shadow may change; transform, scale, rotation, margin, padding, and size changes are forbidden because they cause controls to overlap and shift surrounding layout.
- Doodle chrome and native Excalidraw chrome share one palette, and both use one liquid-glass material defined by `--glass-*` tokens plus `.doodle-glass`. It is a lens, not a frosted panel: `src/infra/templates/liquid-glass.ts` generates a per-pane SVG backdrop filter from a bevelled displacement map, a specular map, and a rim-shade map, and writes `--glass-refraction`; CSS only supplies the fallback blur and the rim shadows. Maps are rasterised at device resolution, rebuilt on resize and theme change, and dropped with their observers on dispose. Keep the fill under ~16% alpha and the blur under ~1.5px, or the dot grid disappears and the pane reads as a grey card again. Glass belongs to the shell only: never to the canvas surface, and never to popovers or dialogs that hold their own content. Native Excalidraw islands stay on Excalidraw's own surface tokens (`color-mix(... var(--island-bg-color) ...)`) because Doodle pins Excalidraw to its light theme while the page may be dark; tinting them with the page theme hides their icons. The canvas washes (`--doodle-wash-*`) exist so the bevel has a gradient to refract; keep them at the page edges and do not tint the drawing area. Map Excalidraw's primary, surface, island, border, input, button, selection, and shadow variables in `excalidraw.html` for both light and dark themes; never leave the upstream violet primary or rely on a hue-rotate/saturate filter for the canvas.
- The material needs a rounded rim on every side, so every floating surface is inset from the window edges and rounded: Doodle capsule at `top/left: 16px` / `radius: 14px`, library drawer at `top: 72px`, `left: 12px`, `bottom: 12px` / `radius: 18px`, library sidebar inset `top: 72px`, `right/bottom: 12px` / `radius: 18px`, selected-object style panel at `top: 72px`, `left: 12px` / `radius: 18px` with a `calc(100vh - 148px)` height budget so it clears the zoom controls. Do not dock a pane flush to the window edge or give it square corners; that removes the bevel the lens is built from.
- Never use a negative-spread inset glow (`inset 0 0 <blur> -<spread> var(--glass-*)`) for the pane highlight. A negative spread shrinks the inner shadow into a smaller rounded rectangle, which paints a visible box inset from the rim and reads as a second pane layered under the glass. Edge light comes from the specular map only; the box-shadow list stays limited to hairline edges (`inset 0 1px 0`, `inset 0 -1px`, `inset 0 0 0 1px`) plus the drop shadow.
- The bevel displacement must taper to zero at *both* ends of the band. Stopping with amplitude still applied leaves a one-pixel jump between two sampled backdrops, which shows as a seam across the pane interior. `bevelAmplitude` multiplies its rise by `1 - t^3` for exactly that reason.
- Surfaces that *hold controls* are the exception to translucency: the mobile expanded property sheet (`.App-bottom-bar .App-mobile-menu`) uses `--doodle-surface-solid` with `backdrop-filter: none`, because ghosting the board behind swatch labels made it unreadable. It is capped at `62vh`, scrolls internally, and lays its sections out in a two-column grid with colour pickers and the opacity slider spanning both columns. Keep it that way; making it translucent again reintroduces the complaint.
- Not every chrome control is an `.Island`. The bottom-left zoom/undo cluster, the help button, and the top-right library trigger are plain `<button>`s painted with an opaque `--button-gray-1` / `--button-bg` fill inside a `--island-bg-color` container, so island-scoped glass rules never reach them. Give the *container* the material and clear the inner button fills (`.zoom-actions button`, `.undo-redo-buttons button`, `.sidebar-trigger`, `.default-sidebar-trigger`), or a solid pill sits on top of the glass. `.help-icon` is the pill itself, so it keeps a translucent fill and only needs a denser tint to stay visible. Add any new non-island chrome to `GLASS_SELECTOR` in `liquid-glass.ts` as well, otherwise it gets the CSS fill but no refraction map.
- Excalidraw's wordmark menu is intentionally not mounted. Its only entries were Search, Help, and an outbound GitHub link; search lives in the toolbar palette action and help is the `?` control, and the board ships no outbound links. CSS also hides `.main-menu-trigger` as a guard, and `App-menu_top__left` stays empty so the shape toolbar keeps Excalidraw's optical centring. Do not restore the menu or re-add external links.
- Doodle pins Excalidraw to the light theme so board colours stay literal, so `:root[data-doodle-theme="dark"] .excalidraw` must re-theme Excalidraw's chrome tokens alongside `.excalidraw.theme--dark`. Without it the zoom group, help button, and library trigger render as white panes on a black canvas.
- The canvas pairs with `parseBoard`, which rejects any non-stroke object below `MIN_SHAPE_SIZE` (16px) and fails the *entire* write, not one item. `excalidrawElementsToBoardItems` therefore clamps width/height to that floor after rounding: Excalidraw reports a single text line as ~15px, and letting it through made a fresh drawing disappear when the client reloaded the previous revision. Add adapter tests whenever the projection changes.
- A rejected board write must never repaint the canvas from the server. Keep the person's local drawing, refresh only `activeSnapshot.revision` so a retry can succeed, and surface the failure through the `#doodleSyncBanner` element. Silent reload-on-error is what made lost work look like a broken board.
- The human canvas is a closed local surface: its main menu may link only to `https://github.com/2648782102/Doodle`. Native Excalidraw Socials, help-header links, the materials-library browse link, arbitrary web embeds, and AI/Mermaid generation entries are removed. Canvas object links open only when they target the project repository; other links are prevented at pointer-click and `onLinkOpen`.
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
