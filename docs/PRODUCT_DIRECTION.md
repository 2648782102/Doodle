# Product Direction

**Doodle is a shared infinite canvas inside the agent workflow.** Compatible MCP Apps hosts render the canvas beside their existing conversation, letting a person and AI share visual context without adding another chat surface. The standalone local page provides the same canvas when the host does not render MCP Apps.

The canvas is the shared context. The host conversation is where people ask questions and receive explanations. MCP is the AI access channel. The source repository remains the source of truth for code.

## Shared loop

```text
person asks or explains in the host conversation
  → AI reads the shared board with get_board
  → compatible host renders the same interactive canvas beside chat
  → AI draws or edits with draw_board
  → person edits the canvas or continues the conversation
```

The loop can pause or repeat at any point. `scan_project` is an optional read-only helper: when project structure is useful, the AI receives bounded paths and evidence, then uses `draw_board` to show relevant context.

## Product model

- **Canvas:** an infinite surface with bounded simple objects: notes, text, rectangles, ellipses, and directed arrow lines. A line runs from `(x,y)` to `(x+w,y+h)`. Click to place a default-sized shape or drag to size shapes and draw arrows in any direction. Space-drag or middle-drag pans; the wheel pans and Ctrl/Command-wheel zooms.
- **Human input:** clicking, dragging, editing text, and deleting canvas objects. Discussion happens in the agent host conversation.
- **AI input:** `get_board` reads canvas data; `show_board` returns the optional MCP App view; `draw_board` adds, edits, or removes objects and can reject stale UI edits by revision. The visible App refreshes the shared board so Agent drawings appear in place. `scan_project` optionally reads bounded project structure.
- **Authors:** every object records whether a person or AI created it. Legacy board notes remain in version 1 state for compatibility but are hidden from current tools and UI.
- **Approval:** this product has no built-in code-change approval protocol. Board content never authorizes project writes.

## Experience principles

1. Make the shared canvas available beside the existing Agent conversation when the host supports MCP Apps.
2. Keep conversation in the host. Do not reproduce its composer or message feed inside Doodle.
3. Keep drawing obvious, with direct click and drag gestures.
4. Keep the tools few: canvas read, canvas draw, and optional project scan.
5. Keep the local browser page as a standalone fallback; normal MCP tool calls do not open it.
6. Keep project context optional, bounded, read-only, and free of absolute paths or secrets.
7. Keep the server local-first and dependencies small.

## Boundaries

- No hosted accounts, multi-user SaaS, social presence, or mandatory turn-taking workflow.
- No duplicate chat product or board message feed.
- No project dashboard, Mermaid diagram library, IDE extension, or static image exporter.
- No `SessionSnapshot`, `VisualGraph`, annotation threads, proposals, diff review, approval receipts, or derived context catalogues.
- No AI project writes triggered by drawing or scans. Code changes remain a separately reviewed coding-agent action.
- No browser or IDE window opening from normal MCP tools.

## Acceptance

A fresh checkout builds and provides exactly four tools. Text-only hosts can use all tools without rendering UI. MCP Apps-compatible hosts can show and edit the shared canvas beside their conversation; the UI reads and writes only through the host's `get_board` and `draw_board` calls. A person can open the standalone local page, move objects, edit text, and see agent changes on the same board.

## Next work

Keep the core canvas stable. Improve drawing ergonomics, accessibility, and agent-facing layout guidance while keeping discussion in the agent host and shared visual context on the board.
