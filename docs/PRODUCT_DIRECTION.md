# Product Direction

**Doodle is a local-first simple shared infinite board.** A person and an AI place visual objects and short labels on one canvas through four MCP tools. The preferred Codex installation path is one `npm run setup:codex` command that builds and installs a desktop-only plugin bundling the same local MCP stdio server. Compatible MCP Apps hosts may render the canvas beside their existing conversation as an optional enhancement; the standalone local page remains a fallback. Conversation always stays in the host chat.

The canvas is the shared context. The host conversation is where people ask questions and receive explanations. MCP is the AI access channel. The source repository remains the source of truth for code.

## Shared loop

```text
one-command install → new agent session → one first prompt
  → AI reads the shared board with get_board
  → show_board optionally renders the canvas in a compatible host
  → AI draws or edits with draw_board
  → person edits the canvas or continues the conversation
  → AI reads the same board again
```

The loop can pause or repeat at any point. `scan_project` is an optional read-only helper: when project structure is useful, the AI receives bounded paths and evidence, then uses `draw_board` to show relevant context.

## Product model

- **Canvas:** an infinite surface with bounded simple objects: notes, text, rectangles, ellipses, and directed arrow lines. A line runs from `(x,y)` to `(x+w,y+h)`. Click to place a default-sized shape or drag to size shapes and draw arrows in any direction. Space-drag or middle-drag pans; the wheel pans and Ctrl/Command-wheel zooms.
- **Human input:** clicking, dragging, editing text, and deleting canvas objects. Discussion happens in the agent host conversation.
- **AI input:** `get_board` reads progressive first-use or concise next-step guidance, canvas data, and the active loopback `PANEL_URL`; `show_board` returns the optional MCP App view; `draw_board` adds, edits, or removes objects and can reject stale UI edits by revision. The visible App refreshes the shared board so Agent drawings appear in place. `scan_project` optionally reads bounded project structure.
- **Authors:** every object records whether a person or AI created it. Legacy board notes remain in version 1 state for compatibility but are hidden from current tools and UI.
- **Approval:** this product has no built-in code-change approval protocol. Board content never authorizes project writes.

## Experience principles

1. Keep one shared canvas and one four-tool MCP server as the product.
2. Make plugin installation one command and first use one prompt, while preserving zero-configuration direct MCP configuration.
3. Keep conversation in the host. Do not reproduce its composer or message feed inside Doodle.
4. Keep drawing obvious, with direct click and drag gestures and one dismissible three-line help popover.
5. Keep the MCP App optional, attach it to `show_board`, and advertise it on successful `draw_board` results so AI drawings are visible immediately in compatible hosts.
6. Keep the local browser page as a standalone fallback; normal MCP tool calls do not open the system browser.
7. Keep project context optional, bounded, read-only, and free of absolute paths or secrets.
8. Keep the server local-first, plugin-safe, and dependencies small.
9. Keep publication metadata honest: review-facing policies describe local data, explicit tool annotations classify effects, and public directory approval is never implied by a repository marketplace.
10. Optimize the complete experience path, not isolated features: install, first session, visible canvas, human edit, and AI reread must each be obvious without adding a fifth tool or second state model.

## Boundaries

- No hosted accounts, multi-user SaaS, social presence, or mandatory turn-taking workflow.
- No duplicate chat product or board message feed.
- No project dashboard, Mermaid diagram library, IDE extension, or static image exporter.
- No `SessionSnapshot`, `VisualGraph`, annotation threads, proposals, diff review, approval receipts, or derived context catalogues.
- No AI project writes triggered by drawing or scans. Code changes remain a separately reviewed coding-agent action.
- No browser or IDE window opening from normal MCP tools.

## Acceptance

A fresh checkout installs through `npm run setup:codex`, and any MCP host can use the zero-configuration `npx -y doodle-mcp` CLI. Both paths build or expose exactly four tools. Text-only hosts can use all tools without rendering UI. MCP Apps-compatible hosts can show and edit the shared canvas beside their conversation; the UI reads and writes only through the host's `get_board` and `draw_board` calls. A person can open the standalone local page at the reported `PANEL_URL`, move objects, edit text, and see agent changes on the same board. Official OpenAI documentation says local marketplace installs are separate from the public directory and should be used in a new session.

## Next work

Keep the core canvas stable. Improve drawing ergonomics, accessibility, install and reload ergonomics, and agent-facing layout guidance while keeping discussion in the agent host and shared visual context on the board.

## Experience audit

[`EXPERIENCE_AUDIT.md`](EXPERIENCE_AUDIT.md) is the maintained record of live AI/human tests, prioritized friction, and closure evidence. All locally actionable items are closed; update it with any end-to-end product change. External host limitations remain documented as fallback paths; they do not expand the product surface.
