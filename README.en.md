# Doodle

> A shared canvas for people and AI to draw together through MCP.

Doodle is a local-first MCP canvas, not a project workbench, static diagram generator, chat product, or code approval system. Install the desktop-only Codex plugin from this repository's marketplace, or connect the same four-tool stdio server directly. In hosts that support MCP Apps, `show_board` optionally presents the interactive canvas beside the existing agent conversation. Conversation stays in the host chat. `get_board` reports the active local `PANEL_URL` as a standalone fallback; normal MCP calls never open a browser.

Choose a tool to click-place or drag-size objects. Space or middle-button drag pans; the wheel pans and Ctrl/Command-wheel zooms. Double-click an object to edit its text. The embedded UI calls the same `get_board` and `draw_board` tools through the host bridge; it needs no separate chat service.

## Four tools

| Tool | Purpose |
|---|---|
| `get_board` | Read `BOARD_JSON`, object IDs and coordinates, authors, and the drawing guide. |
| `show_board` | Open the interactive shared canvas beside the agent conversation when a user wants to see or edit it. |
| `draw_board` | Add, update, or remove notes, text, rectangles, ellipses, and directed arrows; writes are serialized against the latest state. |
| `scan_project` | Optional read-only project paths and bounded `file:line` evidence. It does not draw or write files. |

The loop is `agent conversation ↔ shared canvas: get_board → draw_board → person edits the canvas → AI reads it again`. `show_board` is an optional render tool, and project structure is only one possible subject; `scan_project` is optional and must be visualized with `draw_board` if needed.

## Quick start

```bash
npm install
npm run build
npm run check
npm run doctor
```

For Codex, build the plugin and add this repository as a local marketplace:

```bash
npm install
npm run build
codex plugin marketplace add . --json
codex plugin add doodle@doodle --json
```

`npm run build:submission` also produces an ignored `doodle-plugin-submission/doodle-0.6.0.zip` for review. Public plugin-directory publication remains a separate approved OpenAI submission; see `docs/SUBMISSION.md`, `PRIVACY.md`, `SUPPORT.md`, `TERMS.md`, and `docs/FAQ.md`.

For direct MCP hosts, add `dist/index.js` as a stdio server. Config snippets are in `examples/mcp-config/`. Use `DOODLE_WORKSPACE_ROOT` for the project that `scan_project` should inspect and `OUTPUT_DIR` for the board state directory. When `PREVIEW_PORT` is unset, the server chooses a free loopback port and reports it as `PANEL_URL`; normal MCP calls do not open a browser.

Version 1 board files may contain old notes. They remain readable for compatibility, but new canvas UI and agent tools do not display or write a message feed.

## Drawing contract

- Call `get_board` first and reuse object IDs for updates and removals.
- Put `author` at the `draw_board` top level.
- Use a strict grid, short labels, and consistent sizes for structured diagrams.
- A `line` is a directed arrow from `(x,y)` to `(x+w,y+h)`; `w` and `h` may be negative. Other objects use `(x,y)` as the top-left corner.
- Use `remove_ids` before redrawing a whole diagram.

## Safety

stdout carries only MCP JSON-RPC; logs go to stderr. The HTTP server binds to `127.0.0.1` by default. Non-GET `/api/board/*` requests require the random `X-AI-Draw-Token`, `confirmedBy: "human"`, and a matching board revision. Project scans return bounded workspace-relative paths and short evidence text only, filter common credential lines, and cap evidence at 40 lines. Board mutations are serialized across processes. Board content never authorizes project writes; the embedded UI uses only normal canvas tools through the MCP Apps host bridge.

All four tools carry explicit MCP annotations. `get_board`, `show_board`, and `scan_project` are read-only, non-destructive, and local-scope; `draw_board` is a destructive local write because it can remove or overwrite board objects.

See `SECURITY.md`, `PRIVACY.md`, `SUPPORT.md`, `TERMS.md`, `docs/ARCHITECTURE.md`, and `AGENTS.md` for details.

## License

MIT. See `LICENSE`.
