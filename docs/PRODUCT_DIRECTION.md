# Product Direction

**Doodle is a local-first two-way board for a person and an AI.** Both sides can draw notes, text, shapes, and directed arrows on one infinite canvas to express intent. The AI draws through four MCP tools; the person draws directly on the canvas. The board is the communication medium, not a one-way display of AI output or a human annotation form.

The product story is deliberately small: one kernel, two entry points, three capability layers.

- One kernel: the shared infinite board and version 1 state.
- Two entry points: the recommended Codex plugin and direct MCP / `npx` for any MCP host.
- Three layers: four tools always work; MCP Apps hosts render the canvas; hosts with `updateModelContext` / `sendMessage` add automatic final-state sync and a short notification. The standalone `PANEL_URL` page is the fallback when no embedded canvas is available.

Project structure is optional source material, not the product. Conversation stays in the host chat. MCP is the AI access channel. The source repository remains the source of truth for code.

## Shared loop

```text
AI draws with draw_board
  → person sees the board and draws or edits directly
  → final-state delta is attached to the current host conversation's model context, or the person sends a short notification
  → AI reads with get_board or current model context
  → AI continues in chat or draws another response on the board
  → repeat in either direction
```

The loop can start from either side and pause at any point. `get_board` remains the authoritative read. `scan_project` is an optional read-only helper: when project structure is useful, the AI receives bounded paths and evidence, then may use `draw_board` to show relevant context.

## Product model

- **Canvas:** an infinite surface with bounded simple objects: notes, text, rectangles, ellipses, and directed arrow lines. A line runs from `(x,y)` to `(x+w,y+h)`. Click to place a default-sized shape or drag to size shapes and draw arrows in any direction. Space-drag or middle-drag pans; the wheel pans and Ctrl/Command-wheel zooms.
- **Human input:** clicking, dragging, editing text, deleting objects, and drawing new visual context. Discussion happens in the agent host conversation; an optional `通知 Agent` button adds one short message there, never a second chat surface.
- **AI input:** `get_board` reads progressive first-use or concise next-step guidance, canvas data, and the active loopback `PANEL_URL`; `show_board` returns the optional MCP App view; `draw_board` adds, edits, or removes objects and can reject stale UI edits by revision. The visible App refreshes the shared board so either side sees the other's drawings in place. `scan_project` optionally reads bounded project structure.
- **Authors:** every object records whether a person or AI created it. Legacy board notes remain in version 1 state for compatibility but are hidden from current tools and UI.
- **Approval:** this product has no built-in code-change approval protocol. Board content never authorizes project writes.

## Experience principles

1. Keep one shared canvas and one four-tool MCP server as the product.
2. Make plugin installation one command and first use one prompt, while preserving zero-configuration direct MCP configuration.
3. Keep conversation in the host. Do not reproduce its composer or message feed inside Doodle.
4. Keep drawing obvious, with direct click and drag gestures and one dismissible three-line help popover.
5. Keep the MCP App optional, attach it to `show_board`, and advertise it on successful `draw_board` results so AI drawings are visible immediately in compatible hosts. In capable hosts, publish the latest final board snapshot plus a delta from the last published state to the current session's model context without triggering a turn.
6. Keep the local browser page as a standalone fallback; normal MCP tool calls do not open the system browser.
7. Keep project context optional, bounded, read-only, and free of absolute paths or secrets.
8. Keep the server local-first, plugin-safe, and dependencies small.
9. Keep publication metadata honest: review-facing policies describe local data, explicit tool annotations classify effects, and public directory approval is never implied by a repository marketplace.
10. Optimize the complete two-way experience path, not isolated features: install, first session, visible canvas, AI drawing, human drawing, final-state sync, and AI reread must each be obvious without adding a fifth tool or second state model.

## Boundaries

- No hosted accounts, multi-user SaaS, social presence, or mandatory turn-taking workflow.
- No duplicate chat product, second session model, or board message feed. A host notification is one short message in the existing conversation.
- No project dashboard, Mermaid diagram library, IDE extension, or static image exporter.
- No `SessionSnapshot`, `VisualGraph`, annotation threads, proposals, diff review, approval receipts, or derived context catalogues.
- No AI project writes triggered by drawing or scans. Code changes remain a separately reviewed coding-agent action.
- No browser or IDE window opening from normal MCP tools.

## Acceptance

A fresh checkout installs through `npm run setup:codex`, and any MCP host can use the zero-configuration `npx -y doodle-mcp` CLI. Both paths build or expose exactly four tools. Text-only hosts can use all tools without rendering UI. MCP Apps-compatible hosts can show and edit the shared canvas beside their conversation; the UI reads and writes only through the host's `get_board` and `draw_board` calls. Hosts that advertise `updateModelContext` receive a complete current structured snapshot plus `added` / `updated` / `removed` final-state differences, never an operation log; `sendMessage` is used only by the user-initiated notification button. A person can open the standalone local page at the reported `PANEL_URL`, move objects, edit text, draw new objects, and see AI changes on the same board; this fallback has no current-host-session bridge. Official OpenAI documentation says local marketplace installs are separate from the public directory and should be used in a new session.

## Next work

Keep the core canvas stable and two-way. Improve drawing ergonomics, accessibility, install and reload ergonomics, and agent-facing layout guidance while keeping discussion in the agent host and shared visual context on the board.

## Experience audit

[`EXPERIENCE_AUDIT.md`](EXPERIENCE_AUDIT.md) is the maintained record of live AI/human tests, prioritized friction, and closure evidence. All locally actionable items are closed; update it with any end-to-end product change. External host limitations remain documented as fallback paths; they do not expand the product surface.
