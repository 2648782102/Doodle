# Doodle

> A tiny shared board for people and AI to doodle, draw, and leave short notes through MCP.

Doodle is a small local MCP server, not a hosted whiteboard, static diagram generator, chat product, or code-change approval system. It keeps only the shared canvas: a person can draw, move, edit, and leave a short note; an AI can read and draw on the same canvas from inside its coding agent.

## Four tools

| Tool | Purpose |
|---|---|
| `get_board` | Read `BOARD_JSON`, object IDs and coordinates, recent notes, and the drawing guide. Start here. |
| `draw_board` | Add, update, or remove notes, text, rectangles, ellipses, and directed arrows. |
| `reply_on_board` | Leave one short AI response beside the board, optionally linked to an object. |
| `scan_project` | Optional read-only project paths and bounded `file:line` evidence. It does not draw or write files. |

The default loop is `get_board → draw_board / reply_on_board → person edits the canvas → AI reads it again`. Project structure is only one possible subject; `scan_project` is optional and must be visualized with `draw_board` if needed.

## Quick start

```bash
npm install
npm run build
npm run check
npm run doctor
```

Add `dist/index.js` as a stdio MCP server in your MCP host. Config snippets are in `examples/mcp-config/`. Use `DOODLE_WORKSPACE_ROOT` for the project that `scan_project` should inspect and `OUTPUT_DIR` for the board state directory. The default local panel is `http://127.0.0.1:3399/`; normal MCP calls do not open a browser.

`AI_DRAW_WORKSPACE_ROOT` and the old `output/.ai-draw/board.json` path remain read-only compatibility aliases. New setups should use `DOODLE_WORKSPACE_ROOT`.

## Drawing contract

- Call `get_board` first and reuse object IDs for updates and removals.
- Put `author` at the `draw_board` top level.
- Use a strict grid, short labels, and consistent sizes for structured diagrams.
- A `line` is a directed arrow from `(x,y)` to `(x+w,y+h)`; `w` and `h` may be negative. Other objects use `(x,y)` as the top-left corner.
- Use `remove_ids` before redrawing a whole diagram.

## Safety

stdout carries only MCP JSON-RPC; logs go to stderr. The HTTP server binds to `127.0.0.1` by default. Non-GET `/api/board/*` requests require the random `X-AI-Draw-Token` and `confirmedBy: "human"`. Project scans return bounded workspace-relative paths and redacted evidence text only. Board writes are revision-checked so a stale snapshot cannot overwrite newer canvas work. Board communication never authorizes project writes.

See `SECURITY.md`, `docs/ARCHITECTURE.md`, and `AGENTS.md` for details.

## License

MIT. See `LICENSE`.
