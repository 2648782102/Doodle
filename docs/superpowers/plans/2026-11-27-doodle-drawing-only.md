# Doodle Drawing Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove repository-reading capability from Doodle and leave it as a shared drawing board with three MCP tools.

**Architecture:** Delete the project scanner and diagram-draft helper, remove their MCP and HTTP registrations and scan-only config, and preserve default board storage resolution under a storage-specific name. Reframe architecture discussion as a host-agent workflow that supplies drawings to Doodle.

**Tech Stack:** TypeScript, MCP SDK, Express, Vitest, repository and plugin guards, Markdown documentation.

**Spec:** `docs/superpowers/specs/2026-11-27-doodle-drawing-only-design.md`

## Global Constraints

- MCP exposes exactly `get_board`, `show_board`, and `draw_board`.
- Board v1, local persistence, human canvas edits, and HANDOFF remain compatible.
- Doodle must not enumerate or read project files for context.
- Board-data path resolution may use host-provided path metadata only to choose where Doodle persists its own board data.
- Historical release notes remain historically accurate; current product docs describe drawing only.

## Review Focus

- MCP tool registration: assert exactly the three board tools and no scan guidance.
- HTTP surface: assert both retired project scan paths return 404 and reveal no workspace content.
- Default storage selection: assert plugin data and host workspace selection continue to work without scan-only variables.
- Collaborative drawing: assert draw, human correction, and HANDOFF continue to work in the architecture discussion scenario.
- Build guards and generated plugin: assert the removed scanner is not bundled and all published/current entry points agree on the three-tool contract.

## File map

- `src/board/mcp/tools.ts`, `src/board/index.ts`, and `src/board/http/routes.ts`: remove scan registrations, exports, and endpoints.
- `src/infra/config.ts`, `src/infra/project-workspace.ts`, and `src/infra/workspace.ts`: retain only storage-directory resolution and remove scan-only configuration.
- `src/board/project/scan.ts`, `src/board/project/diagram.ts`, and `src/board/mcp/tools/registerScanProjectTool.ts`: delete the unused project-reading implementation.
- `test/mcp.test.mjs`, `test/http.test.mjs`, `test/first-try.test.mjs`, `test/board.test.mjs`, and `test/architecture-discussion.test.mjs`: replace scanner tests with absence and drawing-loop contracts.
- `scripts/repo-check.mjs`, `scripts/plugin-check.mjs`, `bench/measure-context.mjs`, and `server.json`: align guards, benchmark tool list, and published metadata.
- `AGENTS.md`, both READMEs, `docs/PRODUCT_DIRECTION.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/GOALS.md`, `docs/EXPERIENCE_AUDIT.md`, `docs/LAUNCH_KIT.md`, `docs/FAQ.md`, `docs/TROUBLESHOOTING.md`, `ROADMAP.md`, `PRIVACY.md`, `SECURITY.md`, `TERMS.md`, `VERSIONING.md`, `examples/README.md`, `examples/architecture-discussion.md`, and `plugins/doodle/skills/doodle/SKILL.md`: describe the drawing-only boundary.

### Task 1: Remove project reading from runtime surfaces — complete

**Interfaces:** Existing MCP canvas and HTTP board routes remain unchanged. `AppConfig` retains only board output and preview settings; a storage-specific resolver chooses the default board-data directory.

- [x] **Step 1: Write MCP and HTTP regression assertions.** Assert the MCP tool set is exactly three tools with drawing-only guidance; assert `/api/board/project` and `/api/board/project/text` return 404.
- [x] **Step 2: Run the targeted tests.** Replaced the old scanner expectations with three-tool, 404, and shared-drawing contracts.
- [x] **Step 3: Remove runtime scan paths.** Deleted the scanner, draft, and MCP registration modules; removed their exports, tool registration and HTTP routes; removed workspace roots from `AppConfig`; introduced a storage-specific resolver without `DOODLE_WORKSPACE_ROOT` or `AI_DRAW_WORKSPACE_ROOT`.
- [x] **Step 4: Remove scanner-only unit and range tests and update setup fixtures** to stop injecting scan-only environment variables.
- [x] **Step 5: Run focused MCP, HTTP, configuration, board, and first-try tests.**

### Task 2: Reframe examples, plugin guidance, docs, and guards — complete

**Interfaces:** Runtime provides three MCP tools and board-storage-only config from Task 1.

- [x] **Step 1: Rewrite the architecture discussion integration test** to supply the architecture content from the host conversation, assert the three-tool surface, draw the diagram, apply a human correction, read HANDOFF, and continue drawing without Doodle reading fixture files.
- [x] **Step 2: Run the architecture discussion test** against the new drawing-only contract.
- [x] **Step 3: Rewrite the scenario and current product guidance** to state Doodle's shared-board boundary. Add the removal to the current changelog, privacy and security docs, and mark superseded scan plans as historical.
- [x] **Step 4: Update offline repository and plugin guards, server registry metadata, and the context benchmark** to enforce a three-tool surface and absence of active scanner modules/routes/config.
- [x] **Step 5: Run focused architecture, cleanup, repository-guard, plugin-guard, and plugin build checks.**

### Task 3: Full acceptance — complete

- [x] **Step 1: Run `npm run check`.** Passed lint, build, 497 tests across 40 files, examples, repository/plugin guards, setup dry-run, submission build, doctor, and npm package dry-run.
- [x] **Step 2: Run `npm run test:browser`.** All 11 canvas contracts passed.
- [x] **Step 3: Search active runtime and current documentation for scanner paths and review `git diff` for unintentional changes.** Active source and product guidance have no scanner implementation; historical release/audit entries are labelled by version and kept as history.
