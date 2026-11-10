# Changelog

All notable changes are documented here. Versions follow `VERSIONING.md`.

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
