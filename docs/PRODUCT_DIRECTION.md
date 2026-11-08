# Product Direction

**AI Draw MCP is a simple, practical shared infinite board.** A person and an AI draw and write on the same canvas to communicate. The AI connects through MCP and uses the board directly inside its coding agent; the person uses a small local drawing surface. Project structure is only one optional thing to draw or inspect, not the definition of the product.

The canvas is the shared context. MCP is the AI access channel. The default interface is deliberately small, direct, and easy to use. The source repository remains the source of truth for code.

## Shared loop

```text
person draws or writes on the infinite canvas
  → AI reads the same board with get_board
  → AI draws, edits, or replies with MCP tools
  → person sees the change and continues on the same canvas
```

The loop can pause or repeat at any point. `scan_project` is an optional read-only helper: when project structure is useful, the AI receives bounded paths and evidence, then uses `draw_board` to express that structure on the same board.

## Product model

- **Canvas:** an infinite surface with bounded simple objects: notes, text, rectangles, ellipses, and directed arrow lines. A line runs from `(x,y)` to `(x+w,y+h)`.
- **Human input:** clicking, dragging, editing text, deleting objects, and short messages that may refer to a selected object.
- **AI input:** `get_board` reads the canvas; `draw_board` adds, edits, or removes objects; `reply_on_board` adds one short response; `scan_project` optionally reads bounded project structure.
- **Authors:** every object and note records whether a person or AI created it.
- **Approval:** this product has no built-in code-change approval protocol. Board communication never authorizes project writes.

## Experience principles

1. Open on a small canvas and make drawing obvious.
2. Keep the tools few: selection, note, text, rectangle, ellipse, directed arrow, and delete.
3. Keep short communication beside the canvas, not in a standalone chat product.
4. Keep the browser out of the AI's default path.
5. Keep project context optional, bounded, read-only, and free of absolute paths or secrets.
6. Keep the server local-first and the package small.
7. Keep protocol changes rare, tested, and explicitly documented.

## Boundaries

- No hosted accounts, multi-user SaaS, social presence, or mandatory turn-taking workflow.
- No project dashboard, Mermaid diagram library, IDE extension, or static image exporter.
- No `SessionSnapshot`, `VisualGraph`, annotation threads, proposals, diff review, approval receipts, or derived context catalogues.
- No AI project writes triggered by a drawing, note, or scan. Code changes remain an explicit, separately reviewed coding-agent action.
- No browser or IDE window opening from normal MCP tools.

## Acceptance

A fresh checkout can build, pass `npm run check`, and start a local MCP server with exactly four tools. An agent can read `BOARD_JSON`, draw a structured diagram with aligned arrows, and leave one short reply without opening a browser or touching project files. A human can open the same board locally, move objects, edit text, and leave a message that the AI reads on its next `get_board`.

## Next work

Keep the core canvas stable. Future changes should improve drawing ergonomics, bounded project context, accessibility, and agent-facing instructions without adding a second state model or making project structure the product again.
