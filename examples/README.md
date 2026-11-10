# Examples

These examples are small and contain no secrets or absolute paths.

- `mcp-config/codex.toml` — Codex MCP stdio snippet.
- `mcp-config/cursor.json` — Cursor MCP stdio snippet.
- `mcp-config/stdio.json` — generic stdio configuration shape.
- `board-client.mjs` — a minimal MCP client that lists the four board tools, reads `BOARD_JSON`, opens the optional canvas UI, and draws one note.

Build the server first, then run:

```bash
npm run build
node examples/board-client.mjs
```

Normal MCP calls do not open a browser. Open `http://127.0.0.1:3399/` only when a human wants to see the shared canvas.
