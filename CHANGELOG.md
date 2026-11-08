# Changelog

All notable changes are documented here. Versions follow `VERSIONING.md`.

## 0.4.0 — Simple shared board cleanup

### Added

- Renamed the product to **Doodle**. The npm package and CLI are `doodle-mcp`; the GitHub repository is `Doodle`.
- `DOODLE_WORKSPACE_ROOT` is the preferred workspace variable. `AI_DRAW_WORKSPACE_ROOT` remains a legacy alias so existing MCP host configs keep working.

### Changed

- Collapsed the product to one simple shared infinite canvas with four AI-first MCP tools: `get_board`, `draw_board`, `reply_on_board`, and an optional read-only `scan_project`.
- Reorganized source into a focused `src/board/` module plus small `src/infra/` primitives.
- Replaced the human surface with one restrained infinite canvas: toolbar, free placement, directed SVG arrows, short notes, and local viewport state.
- Rewrote `AGENTS.md`, architecture, product direction, decisions, troubleshooting, governance, launch copy, contribution docs, and offline repository guards around the simplified product.
- Reduced runtime dependencies to the MCP SDK, Express, WebSocket, and Zod.

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
