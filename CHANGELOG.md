# Changelog

All notable changes are documented here. Versions follow `VERSIONING.md`.

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
