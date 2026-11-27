# Architecture Discussion First-Session Design (Retired)

> Historical proposal superseded on 2026-11-27 by [the drawing-only design](2026-11-27-doodle-drawing-only-design.md). The scanner workflow described below is not part of the current product.

## Intent

Make Doodle useful for a developer's first architecture discussion about an existing codebase. The person should be able to ask the agent to map the repository, correct the map directly on the shared canvas, and have the agent understand those corrections and continue the discussion without the person translating visual edits back into prose.

The project already has the required primitives: bounded read-only `scan_project`, semantic `draw_board.diagram`, `show_board`, a single Board v1 state, and human-attributed `HANDOFF` deltas. The current gap is the agent's architecture-specific workflow: the scan's generic top-level directory draft is only an overview, and the plugin guidance does not give a complete evidence-grounded architecture discussion loop.

## Goals

- Give a person a short, copyable first prompt for discussing the architecture of the current repository.
- Teach the agent to use scan evidence to compose a concise architecture map, rather than presenting every folder as a runtime component or inventing connections.
- Make the human edit → agent handoff → revised diagram loop explicit and repeatable.
- Pin the complete tool-level flow with an integration test against the real MCP server and its real temporary workspace.
- Keep the scope small enough to ship as one first-session improvement, then use it as the basis for a small pilot.

## Non-goals

- No fifth MCP tool, new tool fields, second board model, new session state, or protocol change.
- No automatic inference service, static source graph, full AST/import graph, or unbounded repository scan.
- No project file writes, code-change approval, or implied authority from a board drawing.
- No new hosted account, telemetry, analytics, or external service.
- No claim that automated tests alone establish user value; a small developer pilot remains necessary.

## Constraints

- Preserve exactly `get_board`, `show_board`, `draw_board`, and `scan_project`.
- `scan_project` remains bounded, read-only, workspace-relative, and secret-filtered. Its directory-only `DIAGRAM_DRAFT_JSON` remains an optional overview, not asserted architecture.
- Use Board v1 and existing Excalidraw, semantic diagram, final-state sync, and `HANDOFF` paths.
- Architecture nodes and arrows must be supported by `PROJECT_JSON` paths/evidence or clearly marked as questions/inferences for the person to resolve. Label only what the evidence proves: an import establishes an import relationship, not necessarily a runtime call. Do not turn directory adjacency into a dependency claim.
- Preserve human moves, wording, and deletions when the agent revises the diagram. Prefer precise updates/additions over whole-board replacement.
- Keep docs and plugin guidance honest about host differences: embedded context sync is optional; text-only and standalone hosts require an explicit `get_board` reread.
- Add no dependency.

## Approaches considered

### A. Workflow script and tests only

Add a scenario prompt and MCP integration test around the existing generic directory overview. This is the smallest change, but it leaves the agent without clear guidance for building a trustworthy architecture map from the scan's evidence.

### B. Architecture discussion first-session improvement — selected

Add an evidence-grounded architecture workflow to the built-in MCP instructions and Codex plugin skill, provide a copyable scenario prompt, and test scan → architecture diagram → human correction → `HANDOFF` read → precise agent continuation through the actual MCP server. Keep the generic scan draft as a suggested directory overview and preserve all existing protocol boundaries.

This directly exercises Doodle's differentiating loop while reusing the existing state and tools. It is the smallest approach that improves both first-use guidance and a verifiable end-to-end behavior.

### C. Dedicated architecture mode or graph subsystem

Add architecture-specific tool/state/UI or automatic source graph extraction. This could automate more of the drawing, but creates a second product surface, increases scan complexity and security review, and conflicts with the repository's four-tool / one-board boundary. It is deferred.

## User workflow

1. In the agent host, the person asks: “帮我看一下这个仓库的架构，先画出主要模块和有依据的调用关系，我们一起在图上修正。”
2. The agent reads the current board with `get_board`, scans the current workspace with `scan_project`, and opens the shared canvas with `show_board` when the person wants to work visually.
3. The agent uses bounded paths and `file:line` evidence to choose a small set of meaningful runtime or responsibility nodes. It creates arrows only for relationships supported by imports or explicit project evidence. Uncertain relationships become short question/annotation objects, not asserted arrows. The generic `DIAGRAM_DRAFT_JSON` may help orient the agent but is not copied as an architecture without interpretation.
4. The agent draws one concise semantic diagram with `draw_board.diagram`, short labels, independent detail text for source evidence, and stable IDs. It keeps the canvas visible after drawing.
5. The person changes a label or position, removes a mistaken node/edge, and/or adds a note on the canvas.
6. In a host that publishes canvas context, the agent uses the delivered final state. Otherwise, it calls `get_board` with the revision it last saw and reads `HANDOFF`.
7. The agent acknowledges the person's actual edits, treats labels and removals as intent, preserves moved/deleted objects, and uses precise `updates` / additions to continue or refine the architecture diagram. It asks a focused question if the visual correction leaves a material ambiguity.
8. Project code remains untouched unless the person separately asks for a code change.

## Implementation shape

- Update `src/board/mcp/instructions.ts` with the architecture-specific evidence, uncertainty, visibility, handoff, and preservation rules.
- Update `plugins/doodle/skills/doodle/SKILL.md` with the short first prompt and the same end-to-end behavior for Codex users.
- Add `examples/architecture-discussion.md` as a copyable scenario and host-neutral checklist; link it from `examples/README.md` and the relevant README/docs entry points.
- Add `test/architecture-discussion.test.mjs` as an MCP integration test. It creates a temporary fixture repository with a small, explicit module structure and imports, starts the built server with that fixture as `DOODLE_WORKSPACE_ROOT`, reads the bounded evidence, draws a diagram grounded in that evidence, applies a human-attributed label/move/removal/addition, reads the delta from the prior revision, and continues with precise writes. Assertions cover evidence-backed topology, the `HANDOFF` intent and final values, preservation of the human changes, returned `CHANGE_JSON`, exactly four registered tools, and no writes to fixture source files.
- Update `docs/GOALS.md`, `docs/EXPERIENCE_AUDIT.md`, `ROADMAP.md`, `README.md` / `README.en.md`, and `CHANGELOG.md` only where needed to describe the workflow, automated engineering evidence, and the remaining pilot validation honestly. Do not claim real-user success before a developer pilot occurs.

## Acceptance

### Automated

- A fresh MCP server registers exactly the existing four tools and its initialization guidance describes the architecture discussion loop.
- A fixture scan returns only bounded relative paths/evidence and leaves every fixture source file byte-for-byte unchanged.
- The test's architecture nodes and import arrow correspond to the fixture's explicit modules/import; the unconnected UI module gets no arrow, and uncertain relationships are not asserted as dependencies.
- A human-attributed edit/addition/removal is returned by `get_board.since_revision` in `HANDOFF` with the correct final values and readings.
- The agent's follow-up preserves the person's move, wording, and deletion, incorporates the added intent, and reports its own precise changes.
- `npm run check` passes. The browser contract suite is run if its local Chromium prerequisite is available; otherwise the limitation is recorded and existing canvas contract coverage is included in the evidence.

### Manual product check

Provide a short pilot checklist for three developer tasks: understanding a new repository, correcting a wrong dependency, and adding a missing module or constraint. For each, record whether the person could express the correction directly on the board, whether the agent reflected it accurately on the next turn, and whether anything had to be retyped in chat. Report this as pending until an actual human session is run; automated MCP tests cannot substitute for it.

## Risks and mitigations

- **The agent invents runtime structure from folder names.** Guidance and fixture assertions require evidence for connections and explicitly demote uncertain relationships to questions.
- **Large or unusual repositories exceed scan coverage.** Keep all scan bounds and truncation information; instruct the agent to state when the available evidence is incomplete and ask before widening the scan.
- **A human's canvas edits are not delivered automatically by a host.** State the explicit `get_board.since_revision` fallback in plugin and example guidance.
- **The integration test proves protocol behavior but not visual legibility or customer value.** Run existing browser contracts when possible and leave pilot conclusions pending real sessions.
- **The first diagram could overwrite board work.** Keep append behavior and require precise updates/removals; only use `replace: true` after an explicit request to redraw the whole board.

## Builder decisions

- Use the current `scan_project` evidence contract; do not expand its schema or scanner heuristics in this phase.
- Keep the first prompt short and in Chinese, with an English equivalent where examples are mirrored.
- Use a deterministic temporary fixture and the existing MCP SDK client patterns for integration coverage.
- Treat browser installation/availability as an environment prerequisite, not a reason to alter dependencies for this phase.
