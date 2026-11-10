# Examples

These examples are small and contain no secrets or absolute paths.

- `mcp-config/codex.toml` — Codex MCP stdio snippet.
- `mcp-config/cursor.json` — Cursor MCP stdio snippet.
- `mcp-config/stdio.json` — generic stdio configuration shape.
- `board-client.mjs` — a minimal MCP client that lists the four board tools, reads `BOARD_JSON` and `PANEL_URL`, opens the optional canvas UI, and draws one note.

For a Codex plugin install, build the ignored `.doodle-plugin/doodle/` package first, then add this repository as a local marketplace. The plugin is desktop-only; public plugin directory submission is separate and described in `../docs/SUBMISSION.md`.

Build the server first, then run:

```bash
npm run build
node examples/board-client.mjs
```

Normal MCP calls do not open a browser. Open the `PANEL_URL` returned by `get_board` only when a human wants to see the shared canvas.
