# Product Direction

This document is the product contract for contributors, maintainers, and AI coding agents. `ROADMAP.md` turns it into sequenced work; architecture and ADRs describe the implementation and safety contracts.

## Definition

**AI Draw MCP is a simple, practical shared infinite board.** A person and an AI both draw and write on the same canvas to communicate. The AI connects through MCP and uses the board directly; the person uses a small local drawing surface. Project structure is only one optional thing someone may choose to draw or scan, not the definition of the product.

The canvas is the shared context. MCP is the AI access channel. The default interface is deliberately small, direct, and easy to use. The source repository remains the source of truth for code.

## Product promise

When a person draws or writes on the board, the AI can read the same objects and notes. When the AI draws or replies, the person sees it on the same board. Both sides work against one simple revisioned canvas without a mandatory workflow.

The main interaction is visual and lightweight: notes, text, shapes, lines, positions, and short messages beside the canvas. A standalone general-purpose chat stream is not the product surface.

## Shared loop

```text
person draws or writes on the infinite canvas
  → AI reads the same board with get_board
  → AI draws, edits, or replies with MCP tools
  → person sees the change and continues on the same canvas
```

The loop can pause or repeat at any point. Project scanning, source evidence, and code-change proposals live in `/workbench` and the legacy MCP tools; using them is optional.

## Product model

- **Canvas:** an infinite surface with bounded simple objects: notes, text, rectangles, ellipses, and directed arrow lines. A line runs from `(x,y)` to `(x+w,y+h)`; see [ADR 0026](ADR/0026-board-lines-are-directed-arrows.md).
- **Human input:** clicking, dragging, editing text, deleting objects, and short notes that may refer to a selected object.
- **AI input:** `get_board` reads the canvas; `draw_board` adds, edits, or removes objects; `reply_on_board` adds a short response.
- **Optional workbench:** project scans, source evidence, graph context, proposals, and approval-gated writes remain compatible secondary capabilities.
- **Approval:** a separate human decision that authorizes one specific project proposal. Canvas communication never authorizes project writes.

## Experience principles

1. **Open on an empty canvas.** A person should know where to click and how to draw immediately.
2. **Keep the tools few.** Selection, note, text, rectangle, ellipse, directed arrow, and delete are enough for the first screen.
3. **Keep communication beside the canvas.** Short notes are attached to the shared board, not a separate chat product.
4. **Make both authors visible.** Every object and note records whether a person or AI created it.
5. **Keep the surface small.** No default project scan, source evidence, workflow dashboard, diagnostics, or proposal cards.
6. **Keep project writes explicit.** The person reviews the full diff and approves the exact proposal; the AI applies it using the one-time receipt and existing path-safety checks.
7. **Stay local-first.** The board works with the local MCP host without an account or hosted collaboration service.
8. **Keep the agent in the agent.** MCP stdio tools and instructions are the default AI workflow; browser or IDE window opening is explicit.

## Boundaries

- This is a simple shared infinite board, not a project dashboard or static diagram exporter.
- It is not a hosted multi-user SaaS.
- It does not need a separate chat product, social presence, or mandatory turn-taking workflow.
- It does not let the AI write project files directly from a conversation, graph edit, or annotation. Every project write goes through a proposal, human-reviewed full diff, explicit approval, one-time receipt, path validation, and `SessionStore.applyProposal()`.
- The version 1 simple board state is independent of the optional project `SessionSnapshot`. Legacy MCP and session contracts remain compatibility boundaries for `/workbench`.
- `ai-draw://board/*` resources remain derived, credential-free projections for legacy project-workbench hosts.

## Current implementation gap

The repository already has project scanning, editable graphs, selection and focus, persistent board notes with human replies, AI replies in the same annotation threads, proposals, full diff review, and the approval gate. The default view is now composed of one board header, one continuous canvas, and one fixed object inspector; the legacy brand header, Flow rail, floating diagnostic cards, and duplicate render toolbar are not part of the first screen. The on-demand diagram library distinguishes local diagram previews from the single active shared board, while the review surface holds complete context and change diffs. Copyable read-only context remains a separate utility. Phase 3 continues with evidence freshness and uncertainty. This document and ADRs 0022–0023 set the product direction; the phases below close the remaining evidence and traceability gaps without claiming they are already fixed.

## Delivery plan

### Phase 0 — Align the product contract

- Make this document authoritative and supersede ADR 0020's MCP-tool-first product hierarchy.
- Align README, English quickstart, architecture overview, `AGENTS.md`, goal-mode guidance, launch copy, package metadata, and the offline repository checks.
- Mark existing screenshots and UI copy as the current implementation baseline where they do not yet express the new direction.

**Status:** complete. Product definition, ADR, roadmap, contributor guidance, public copy, and canonical preview references are aligned.

### Phase 1 — Restore the shared communication loop

- Audit the existing message and annotation endpoints, persisted session model, and `get_visual_context` / `reply_to_visual_context` tools before adding protocol state.
- Reuse persisted node annotations and the existing `/api/collab/annotations/:id/reply` endpoint; the AI already replies through `reply_to_visual_context` and those replies are rendered in the panel.
- **Implemented:** the primary human input saves a note to the focused node, or to the board scope when no node is focused, through the existing annotation contract. The clipboard-only composer is gone; copy failures use a separate read-only text box.
- **Implemented:** each thread has an in-place human reply control. Replies retain author and ordering through the existing endpoint and the same thread refreshes in place.
- Preserve pending/resolved state, graph revision and anchor status. Keep broad notes associated with the board or selected scope only where existing contracts support it; do not invent a second message store.

**Status: implemented and browser-regressed.** A person can add a node or scope note, see the AI reply in that thread, and reply again from the same board without copy/paste; an MCP client reads the ordered exchange with its visual context. Reloading preserves the thread, and no project-write path is introduced.

### Phase 2 — Make the canvas the primary workspace

- Use one default canvas with a contextual inspector for the current node, edge, or selection; keep notes and AI responses next to their visual anchors.
- Move proposal review into a focused, secondary review surface that returns to the same graph context.
- Remove duplicate progress rails, repeated status summaries, and technical projection cards from the default view; retain useful details behind deliberate expand actions.
- Use consistent plain-language names and a compact set of visual states for human input, AI response, evidence, unresolved intent, and proposed code changes.
- Rework first-run guidance and capture one canonical screenshot that demonstrates the shared board loop.

**Status:** implemented. The default workspace is the full canvas with one board header and one fixed object inspector; first-run guidance offers a direct read-only project scan. The on-demand library handles local diagram previews and downloads without silently switching the shared session, and the review surface holds graph editing, derived context, proposal review, and approval. `docs/shared-board-panel.png` is the reproducible canonical screenshot and the only retained UI capture.

**Complete when:** a first-time user can identify the shared project model, add a contextual correction, see the AI-side update, and find code review without navigating a multi-step dashboard. Keyboard, narrow-screen, empty, loading, and error states remain usable; broader cross-breakpoint validation remains part of ongoing UI maintenance.

### Phase 3 — Ground the board in project evidence

- Improve scanner evidence and graph relationships based on observed user gaps, prioritizing trustworthy file and symbol links over additional derived status projections.
- Make evidence freshness and uncertainty visible when a scan is incomplete or source anchors have moved.
- Keep graph revisions and contextual notes traceable across rescans without treating stale discussion as current intent.

**Complete when:** a person can inspect why a node or edge exists, and both human and AI can recognize when its evidence needs another scan or correction.

### Phase 4 — Connect visual intent to safe code changes

- Connect a board note or selected graph scope to the existing proposal preflight and proposal creation tools.
- Present the exact affected files and full line diff in context of the graph intent that motivated them.
- Keep approval, one-time receipt, path safety, atomic application, and failure rollback unchanged.
- Refresh the board after application and show which visual intent the resulting graph revision addresses.

**Complete when:** the person can trace a change from board intent to proposal and applied project revision, while every write still passes the existing human approval boundary.

## First implementation slice

Start with Phase 1. Reuse the existing session and collaboration API where it fits; do not add a second message store or new conversation state machine by default. Implement and verify this end-to-end path before redesigning the whole page:

1. Human selects a graph object and adds an anchored note using the existing annotation contract.
2. An MCP client reads the note; the AI replies to that annotation using the existing MCP capability.
3. The panel shows the reply in the same thread and lets the human continue that thread through the existing reply endpoint.
4. Refreshing the panel preserves the ordered human/AI exchange and its anchor state.
5. The generic clipboard-only composer is removed or redirected into this contextual path.
6. No project file changes unless a separate proposal is reviewed and approved.

The first slice is successful when a fresh local session demonstrates a complete human → AI → human exchange attached to a graph object, with no clipboard handoff and no new persistence protocol.
