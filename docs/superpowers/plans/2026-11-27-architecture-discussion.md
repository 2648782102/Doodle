# Architecture Discussion First-Session Implementation Plan (Retired)

> Historical plan superseded on 2026-11-27 by [the drawing-only implementation plan](2026-11-27-doodle-drawing-only.md). Its scanner-related steps document prior work and must not be treated as current product requirements.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first architecture discussion in Doodle an evidence-grounded, copyable, end-to-end human/AI board loop.

**Architecture:** Keep the existing four MCP tools and Board v1. Improve the server and Codex instructions, add a host-neutral scenario example, and prove the scan → diagram → human handoff → precise continuation against a temporary fixture repository using the real MCP server.

**Tech Stack:** Node.js 20+, TypeScript, MCP SDK, Vitest, Markdown.

**Spec:** `docs/superpowers/specs/2026-11-27-architecture-discussion-design.md`

## Global Constraints

- Preserve exactly `get_board`, `show_board`, `draw_board`, and `scan_project`.
- Keep `scan_project` bounded, read-only, workspace-relative, and secret-filtered.
- Keep Board v1 as the only board protocol and state.
- Ground architecture arrows in explicit file/import evidence; show uncertain relationships as questions.
- Preserve human moves, wording, and deletions; prefer precise updates and additions.
- Support both optional embedded context sync and explicit `get_board.since_revision` fallback.
- Add no dependency and never write project files as part of the board workflow.

## Review Focus

- **Import evidence can mention dependencies that are not runtime architecture.** Fixture test ensures only the explicit server import relationship is drawn and an unproven UI relationship is not asserted.
- **A scan can be truncated or contain private/secret data.** Existing scan contract remains in force; integration fixture asserts relative paths and source immutability.
- **A host may not publish canvas edits into model context.** Test the explicit revision-based `HANDOFF` path.
- **Agent continuation can undo human intent.** Integration asserts that moved, relabelled, and deleted objects remain so while the agent makes a precise addition/update.
- **The example may overpromise product validation.** Docs must label the human pilot as pending until real sessions are run.

---

### Task 1: Prove the Architecture Discussion MCP Loop

**Files:**
- Create: `test/architecture-discussion.test.mjs`
- Modify: `src/board/mcp/instructions.ts`

**Interfaces:**
- Consumes: Existing `get_board`, `show_board`, `draw_board`, and `scan_project` contracts.
- Produces: Built-in initialization guidance that describes evidence-grounded architecture drawing and human-edit continuation; a real-server integration test proving the full flow.

- [x] **Step 1: Write the failing integration test** named `test/architecture-discussion.test.mjs`. Start `node dist/index.js` using the existing MCP SDK client pattern with a temporary `OUTPUT_DIR` and a temporary `DOODLE_WORKSPACE_ROOT`. Create fixture files `src/server.ts` importing `./board/index.js`, `src/board/index.ts` exporting `createBoard`, and `src/ui.ts` exporting `renderBoard` with no imports. Assert: exactly four tools; initialization instructions mention architecture, evidence, and `since_revision`; `scan_project` returns the three relative paths and explicit import evidence and does not change source contents; the test draws the two supported architecture nodes and one bound arrow; a human update changes the server label and moves the board module, and a human deletion removes the arrow; the revision delta/HANDOFF reports the corrected label, move, and deletion; an AI follow-up preserves those human changes and adds a human-requested note; its result contains `CHANGE_JSON`; fixture source contents remain unchanged.
- [x] **Step 2: Run the new test before implementation.** Run `npm test -- test/architecture-discussion.test.mjs`. Expected: fail because the test asks for architecture evidence/handoff guidance that initialization instructions do not yet contain (not a syntax or harness error).
- [x] **Step 3: Add the minimum architecture workflow guidance in `src/board/mcp/instructions.ts`.** State that `scan_project` evidence and `DIAGRAM_DRAFT_JSON` are only bounded source material; arrows require explicit import/evidence support; uncertain relations should be drawn as questions; after a human edits, use host context or `get_board.since_revision`; preserve human moves, labels, and deletions and continue with precise `updates`/additions. Mention `replace:true` only for an explicit full redraw.
- [x] **Step 4: Run the new integration test again.** Expected: PASS, including source immutability and human handoff preservation assertions.
- [x] **Step 5: Run the MCP contract tests.** Run `npm test -- test/architecture-discussion.test.mjs test/mcp.test.mjs`. Expected: both files PASS with four-tool behavior unchanged.

### Task 2: Publish the First-Session Scenario

**Files:**
- Create: `examples/architecture-discussion.md`
- Modify: `plugins/doodle/skills/doodle/SKILL.md`
- Modify: `examples/README.md`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: The workflow language established in Task 1.
- Produces: A short copyable Chinese and English prompt and a host-neutral checklist that explains scan evidence, board edits, and text-only fallback.

- [x] **Step 1: Add example assertions** to `test/architecture-discussion.test.mjs` for the copyable Chinese and English prompt markers, the `get_board` → `scan_project` → `draw_board.diagram` flow, explicit `HANDOFF` fallback, and project-write boundary. Run the test and expect failure because the example is absent.
- [x] **Step 2: Create `examples/architecture-discussion.md`.** Include the Chinese prompt “帮我看一下这个仓库的架构，先画出主要模块和有依据的调用关系，我们一起在图上修正。” and an English equivalent. Explain which scan evidence supports nodes/arrows, that uncertain relations are questions, how to edit the canvas, how to request a reread with the last revision on text-only/standalone hosts, and that board collaboration does not modify project files.
- [x] **Step 3: Update the Codex plugin skill.** Add the short prompt and concise end-to-end architecture workflow with the same evidence, uncertainty, handoff, preservation, and no-project-write constraints.
- [x] **Step 4: Link the example.** Add it to `examples/README.md`, both language READMEs and `docs/README.md` without implying scan results are a complete static dependency graph.
- [x] **Step 5: Run `npm test -- test/architecture-discussion.test.mjs` and `npm run test:examples`.** Expected: PASS; the Markdown example is linked and the JavaScript example syntax guard remains green.

### Task 3: Record Acceptance and Pilot Boundary

**Files:**
- Modify: `docs/GOALS.md`
- Modify: `docs/EXPERIENCE_AUDIT.md`
- Modify: `ROADMAP.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: The tested workflow and user-facing example from Tasks 1–2.
- Produces: Accurate engineering evidence and a pilot checklist explicitly marked pending real user sessions.

- [x] **Step 1: Add documentation assertions** to `test/architecture-discussion.test.mjs` for a tracked architecture discussion goal, the three pilot tasks, and pending status; run the focused test and expect failure.
- [x] **Step 2: Update `docs/GOALS.md`** with a goal/acceptance entry for evidence-grounded first-session architecture discussion and a concise pilot checklist: new-repository understanding, correcting a wrong dependency, adding a missing module/constraint; capture direct board correction, next-turn reflection, and retyping required. Mark the pilot `pending`.
- [x] **Step 3: Update `docs/EXPERIENCE_AUDIT.md`** with the automated MCP evidence and clearly state it does not establish visual or user value.
- [x] **Step 4: Update `ROADMAP.md` and `CHANGELOG.md`** to describe the first-session improvement as implemented while retaining the human pilot as future work.
- [x] **Step 5: Run `npm test -- test/architecture-discussion.test.mjs`.** Expected: PASS with docs stating the pilot is pending.

### Task 4: Full Verification and Branch Review

**Files:** All files above.

**Interfaces:**
- Consumes: Completed Tasks 1–3.
- Produces: Full repository verification results and an independently reviewed branch.

- [x] **Step 1: Run `npm ci`.** Expected: lockfile-resolved dependencies install without tracked lockfile changes.
- [x] **Step 2: Run `npm run check`.** Expected: lint, build, full test suite, examples, repository guards, plugin guards, setup dry run, submission build, doctor, and package dry run all exit 0.
- [x] **Step 3: Run `npm run test:browser` if local Chromium is already available.** If not, record the missing browser prerequisite and rely only on existing browser-contract code plus the completed MCP integration evidence; do not install an unrequested browser binary as part of this phase.
- [x] **Step 4: Run `git diff --check`, inspect the complete diff, and request one fresh code review.** Fix any critical or important findings with test-first changes, then rerun the relevant tests and full suite.

## File Map

- `src/board/mcp/instructions.ts`: model-facing architecture discussion behavior.
- `test/architecture-discussion.test.mjs`: real MCP workflow integration and copy/docs contracts.
- `examples/architecture-discussion.md`: host-neutral, copyable first-session scenario.
- `plugins/doodle/skills/doodle/SKILL.md`: Codex plugin invocation guidance.
- `examples/README.md`, `README.md`, `README.en.md`, `docs/README.md`: discovery links.
- `docs/GOALS.md`, `docs/EXPERIENCE_AUDIT.md`, `ROADMAP.md`, `CHANGELOG.md`: engineering acceptance and pilot status.
