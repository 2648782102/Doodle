# Changelog

All notable changes are documented here. Versions follow `VERSIONING.md`.

## Unreleased — Richer shared canvas

### Added

- Extended version 1 board objects with freehand `stroke`, bounded local `image`, `title`, `shape`, `groupId`, and `emphasis: focus`; older boards remain valid without migration.
- `draw_board` now supports precise `updates`, batch `items`, `remove_ids`, and deterministic `layout` while keeping exactly four MCP tools.
- Human canvas adds marquee multi-select, batch move/delete/group/layout, undo/redo, double-click-to-create notes, arrow-key nudging, alignment snapping, and bounded `Ctrl/⌘+V` image paste.
- The pen now lays down ink immediately on pointer-down, tracks the full path while dragging, stays active for continuous strokes, and commits one stroke object on pointer-up. The eraser removes only touched freehand ink segments in one undoable batch and never deletes notes, shapes, arrows, or images.
- Added a local editable board library: save the current image under a name, switch between saved boards, create/rename/duplicate/delete boards, and import/export version 1 JSON. `draw_board.library`, HTTP `/api/board/library`, the standalone `图库` panel, and the MCP App share the same action vocabulary without adding a fifth tool.
- Added AI-facing visual expression: `capabilities`, deterministic `visualDigest`, recipes, variant/role/z/style fields, connector bindings, and five layout modes. Connected arrows follow bound object edges; the canvas renders variants, styles, z-order, and multi-selection bounds.
- Added `docs/GOAL_EXPERIENCE.md` as the maintained objective for native visual expression and updated the documentation map and link checks.
- Experimental `codex/excalidraw-spike`: added `@excalidraw/excalidraw` as an optional `?engine=excalidraw` canvas with self-hosted assets, a Board v1 ↔ Excalidraw adapter, and `docs/GOAL_EXCALIDRAW.md`. The default DOM canvas, four MCP tools, and Board v1 persistence remain authoritative.
- New local HTTP batch/replacement endpoints support these canvas operations with human confirmation and revision checks.

### Changed

- MCP guidance, READMEs, agent handbook, architecture, decisions, product direction, experience audit, and guards now describe the richer two-way canvas.
- Text projection for AI and model context includes titles and marks freehand/image/focus semantics without turning them into a message feed or project-write authority.

## 0.7.0 — Current-session board context sync

### Added

- The embedded MCP App now detects `updateModelContext` after connecting to a compatible host. Each newly observed board revision publishes the complete current final board snapshot plus `added` / `updated` / `removed` differences from the last successfully published snapshot. The delta contains final object values or removed IDs, never click, drag, text-input, or tool-call operations.
- `structuredContent` preserves the untruncated current board, final-state delta, and fixed read-only flags; the text projection is bounded for model context size and points the agent back to `get_board` as the authoritative reread tool.
- A `通知 Agent` button appears only in embedded hosts that support both model context updates and `sendMessage`. It ensures the latest context has been published, then sends one short message into the existing host conversation: 「我改了 Doodle 画板，你看下图。」 It does not add a Doodle chat, session, message feed, or automatic model turn.
- Added `src/board/app-context.ts` and `test/app-context.test.mjs` for pure final-state deltas, complete structured snapshots, updates, removals, and bounded text projections.

### Changed

- Documented the current-session loop in Chinese and English READMEs, the agent handbook, product direction, architecture, decisions, plugin goal, MCP instructions, skill, privacy, FAQ, troubleshooting, examples, launch copy, roadmap, and release notes.
- Repository and plugin guards now verify capability detection, `updateModelContext` / `sendMessage`, final-state delta language, the notification button, and the bundled MCP App bridge. MCP integration and HTTP tests check the embedded template surface.
- Bumped the package, lockfile, and plugin manifest to `0.7.0`; the published `0.6.3` npm package and GitHub Release remain immutable.

### Compatibility

- The four MCP tools, their schemas and annotations, version 1 persisted board state, `BOARD_JSON`, `PANEL_URL`, HTTP authorization, and revision-safe writes are unchanged.
- Hosts without MCP Apps context capabilities and the standalone `PANEL_URL` page continue to use `get_board` rereading; the notification button remains hidden there and never claims a host-session bridge.

### Validation

- `npm run check` covers the new pure-function tests, TypeScript, build, plugin build, example syntax, repository and plugin guards, setup dry-run, submission ZIP, doctor, and npm package dry-run. Live host-context delivery remains an MCP Apps host capability and is documented as an external surface.
- Remote CI and Publish Release pass; GitHub Release `v0.7.0` contains `doodle-0.7.0.zip`. npm direct-MCP publication remains a separate maintainer-authenticated action; see `docs/EXPERIENCE_AUDIT.md` E15.

## 0.6.3 — Complete install-to-use experience

### Added

- Added `npm run setup:codex`: one command installs dependencies when needed, builds the self-contained plugin, registers the repository marketplace, installs `doodle@doodle`, and prints one first-use prompt. `--dry-run` previews every command without changing Codex configuration.
- Added a short `FIRST_USE` / `NEXT_STEPS` preamble to `get_board`, a next-step line to `draw_board`, and matching initialization/skill guidance. The structured version 1 board snapshot is unchanged.
- Added a dismissible `?` help button and `?` keyboard shortcut to the shared standalone and embedded canvas, with three concise human gestures. Help state is browser localStorage only.

### Changed

- Replaced the multi-command Codex plugin quickstart with a 30-second path: install once, start a new session, use one first prompt, see or edit the canvas, then ask the AI to read it again. README and English README now lead with this complete chain.
- Replaced placeholder direct MCP examples with zero-configuration `npx -y doodle-mcp` snippets. `DOODLE_WORKSPACE_ROOT`, `OUTPUT_DIR`, `PREVIEW_HOST`, `PREVIEW_PORT`, and `LOG_LEVEL` are now clearly optional overrides.
- Updated `doctor` to present user-facing first-use steps and avoid treating the submission ZIP as a routine installation warning.
- Fixed the bundled plugin's standalone canvas template lookup so `PANEL_URL` returns a usable page even when the MCP host starts `server/index.mjs` from a project root.
- Added [`docs/EXPERIENCE_AUDIT.md`](docs/EXPERIENCE_AUDIT.md) with live AI/human findings, priorities, and closure criteria. Fixed the first batch: new boards start empty, `get_board` becomes concise after content exists, human edits and AI updates now record the current author, and the standalone canvas refreshes on WebSocket open with a single reconnect loop and remote-update status.
- Simplified human creation: blank default text, no editor for arrows, one automatic retry for revision conflicts, and a small free-placement search that avoids dropping a new shape on top of existing objects.
- Made help focus reversible and limited `Escape` to closing help when help is open; double-click editing now re-renders and focuses the selected object before editing.
- Added an explicit `编辑` button and `Enter` shortcut for selected objects, so text editing stays reliable in hosts that coalesce double-click events. Creating an object now returns to the select tool and clicking an existing object never starts a new drawing.
- Distinguished local saves from remote AI updates in the standalone status using broadcast revisions, and aligned the MCP Apps write bridge with the shared board snapshot shape.
- Closed every locally actionable item in [`docs/EXPERIENCE_AUDIT.md`](docs/EXPERIENCE_AUDIT.md); MCP Apps host support remains an external limitation with the documented `PANEL_URL` fallback.
- Documented the direct `npx -y doodle-mcp` path next to the Codex plugin path so the 30-second start no longer requires a repository clone for every MCP host.
- Synchronized the product handbook, product direction, architecture, decisions, plugin goal, roadmap, launch copy, examples, guards, tests, and CI with the new install/first-use experience.
- Closed `E12` in [`docs/EXPERIENCE_AUDIT.md`](docs/EXPERIENCE_AUDIT.md): after maintainer security-key confirmation, npm `latest` now serves `doodle-mcp@0.6.3`, the staged queue is empty, and a clean `npm exec --yes doodle-mcp` startup exposed the four MCP tools with `FIRST_USE`, `BOARD_JSON`, and a loopback `PANEL_URL`.

### Compatibility

- The four MCP tools, their schemas and annotations, version 1 persisted board state, HTTP authorization, and revision-safe writes are unchanged.
- The setup script is user-invoked only; `npm run check` and CI never modify the active user's Codex configuration.

### Validation

- `npm test` passes with 31 tests; `npm run check` covers the repository and plugin guards, setup dry-run, submission ZIP, doctor, and npm package dry-run.
- An isolated `CODEX_HOME` marketplace/installation smoke test discovers and enables `doodle@doodle` version `0.6.3`.
- A fresh AI/human/AI loop reached revision 7 with browser auto-refresh, human author changes, concise `get_board`, and distinct local/remote status; see `docs/EXPERIENCE_AUDIT.md`.
- The WebSocket regression test uses the project's `ws` client so the Node 20 CI matrix does not depend on a global `WebSocket`, and the release workflow creates its version tag before publishing a verified release.

## 0.6.2 — Automatic canvas presentation

### Changed

- Successful `draw_board` results now advertise the shared MCP App canvas so compatible hosts automatically show or refresh the canvas after an AI drawing.
- Updated agent instructions and the Doodle plugin skill to keep the canvas visible after drawing, with `show_board` as the fallback for hosts that do not render the draw result.
- Made submission ZIP generation work on Windows by using the built-in `tar.exe` archive command when Unix `zip` is unavailable.

### Validation

- `npm run check` passes with 27 tests, repository and plugin guards, the Windows submission ZIP, doctor, and npm package dry-run.

## 0.6.0 — Codex plugin distribution

### Added

- Added a desktop-only Codex plugin package under `plugins/doodle/` using the supported `.codex-plugin/plugin.json` compatibility manifest, one `.mcp.json`, a concise Doodle skill, and local SVG assets.
- Added a repository-scoped marketplace at `.agents/plugins/marketplace.json` and a reproducible `scripts/build-plugin.mjs` that creates a self-contained `.doodle-plugin/doodle/server/index.mjs` with both canvas templates and the optional MCP App bundle.
- Added `scripts/plugin-check.mjs` and `npm run repo:plugin-check` to CI and `npm run check`, covering plugin identity, manifests, marketplace, skill, build output, dynamic preview runtime, and generated-artifact hygiene.
- Added plugin-safe runtime configuration: MCP stdio connects before the optional HTTP preview, preview failure leaves tools usable, `PREVIEW_PORT` is optional, `get_board` reports the active loopback `PANEL_URL`, and board state prefers explicit `OUTPUT_DIR`, plugin data, or workspace-local `.doodle-data`.
- Added publication materials for an approved local-MCP directory submission: `PRIVACY.md`, `SUPPORT.md`, `TERMS.md`, `docs/FAQ.md`, `docs/SUBMISSION.md`, a versioned submission ZIP build, and HTTPS listing URLs that identify the publisher.
- Added explicit `readOnlyHint`, `destructiveHint`, and `openWorldHint` annotations to every MCP tool, with integration and offline regression checks.
- Added an idempotent publish workflow that runs the full check on `master`, creates a GitHub Release for the current package version when missing, and attaches the versioned submission ZIP.

### Changed

- Reframed the product around one local-first shared infinite board: the plugin is the preferred Codex distribution layer, direct MCP stdio remains supported, and MCP Apps rendering is an optional host enhancement rather than the product definition.
- Kept the four tools `get_board`, `show_board`, `draw_board`, and `scan_project`, the version 1 board state, revision-safe writes, HTTP authorization, and the standalone canvas fallback.
- Bumped the package, plugin manifest, lockfile, security support, changelog, roadmap, docs map, launch copy, and offline guards together.
- Made the plugin display name `Doodle Shared Board` and tied the publisher metadata to the product repository, reducing generic-name review risk while preserving the `Doodle` product and package identity.

### Compatibility

- Existing version 1 board files remain readable. `AI_DRAW_WORKSPACE_ROOT` remains a legacy alias; `DOODLE_WORKSPACE_ROOT`, `OUTPUT_DIR`, `PREVIEW_HOST`, and `PREVIEW_PORT` remain explicit overrides.
- The generated `.doodle-plugin/` runtime, `doodle-plugin-submission/` ZIP output, and `.doodle-data/` board state are ignored and never committed.

### Validation

- `npm run check` passes: TypeScript, build, 27 tests, examples, repository/plugin guards, submission ZIP, doctor, and `npm pack --dry-run`.
- CI passes on Node 20, 22, and 24; the tag release workflow and publish workflow run the same full check.
- Direct and bundled stdio servers expose exactly four annotated tools, `BOARD_JSON`, an active loopback `PANEL_URL`, and the MCP App resource.
- An isolated `CODEX_HOME` marketplace/installation smoke test discovers and enables `doodle@doodle` version `0.6.0`.

### Public plugin directory

The attached `doodle-0.6.0.zip` is a review-ready local-MCP plugin package. Public directory submission still requires an approved submitting organization, verified developer identity, portal review, policy attestations, and clean desktop testing.

## 0.5.0 — Canvas embedded in the agent

### Added

- Added an optional MCP Apps canvas resource linked from `get_board` and `draw_board`. Its UI reads and edits the board through the host's normal MCP bridge.

### Changed

- Removed the duplicate canvas-side conversation pane and message composer. Agent discussion stays in the host conversation; the canvas fills the available surface.
- Split canvas data and UI rendering into `get_board` and `show_board`; the four tools are `get_board`, `show_board`, `draw_board`, and optional `scan_project`.
- Kept version 1 persisted notes readable for compatibility while excluding them from current tool output and canvas UI.
- Kept the standalone local HTTP canvas as a fallback for hosts that do not render MCP Apps.

### Removed

- Removed `reply_on_board` and the human message endpoint from the active workflow.
- Removed the MCP tool/UI pattern that presented Doodle as a separate chat product.

## 0.4.0 — Simple shared board cleanup

### Added

- Renamed the product to **Doodle**. The npm package and CLI are `doodle-mcp`; the GitHub repository is `Doodle`.
- `DOODLE_WORKSPACE_ROOT` is the preferred workspace variable. `AI_DRAW_WORKSPACE_ROOT` remains a legacy alias so existing MCP host configs keep working.
- Improved canvas gestures: click-to-place, drag-to-size shapes and draw directional arrows, Space/middle-button panning, wheel panning, modifier-wheel zoom, and cancellable pointer gestures.
- Cross-process serialized board mutations, revision-checked browser writes, project-scan secret filtering, and persisted-text validation.

### Changed

- Collapsed the product to one simple shared infinite canvas with four AI-first MCP tools: `get_board`, `draw_board`, `reply_on_board`, and an optional read-only `scan_project`.
- Reorganized source into a focused `src/board/` module plus small `src/infra/` primitives.
- Replaced the human surface with one restrained infinite canvas: toolbar, free placement, directed SVG arrows, short notes, and local viewport state.
- Rewrote `AGENTS.md`, architecture, product direction, decisions, troubleshooting, governance, launch copy, contribution docs, and offline repository guards around the simplified product.
- Reduced runtime dependencies to the MCP SDK, Express, WebSocket, and Zod.
- Made a clean-checkout build recreate the template directory after pruning stale compiled files.

### Removed

- The 0.3.x project-workbench frontend, Mermaid/SVG diagram library, image renderer, diagram store, and screenshot generator.
- The old session, graph, annotation, selection, proposal, preflight, approval, diff, capability-catalogue, workflow, decision-trail, and derived-projection contracts.
- Browser/IDE auto-opening tools, the VS Code extension package, metadata-sync automation, and associated large dependency chains.
- Historical ADRs from the active documentation path; they remain as read-only records in `docs/archive/adr-legacy/`.

### Compatibility

- Existing version 1 `output/.ai-draw/board.json` files remain readable; new state is written to `output/.doodle/board.json`.
- Removed 0.3.x tool schemas, REST endpoints, and approval workflows are intentionally not restored. Code changes remain ordinary, separately reviewed coding-agent work.

## 0.3.x and earlier

Earlier releases explored a broader project-workbench and proposal-based collaboration surface. They are preserved in Git history and the archived ADRs; their tool schemas and state contracts are not part of 0.4.0.
