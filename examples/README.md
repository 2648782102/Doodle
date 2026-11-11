# Examples

These examples are small, zero-configuration, and contain no secrets or absolute paths.

- `mcp-config/codex.toml` — zero-config Codex MCP stdio snippet using the published npm CLI.
- `mcp-config/cursor.json` — zero-config Cursor MCP stdio snippet.
- `mcp-config/stdio.json` — generic zero-config stdio shape.
- `board-client.mjs` — a minimal MCP client that lists the four board tools, reads `BOARD_JSON` and `PANEL_URL`, opens the optional canvas UI, and draws one note.

The stdio snippets start the published package with `npx -y doodle-mcp`. The server chooses plugin data or workspace-local `.doodle-data` for board state, a free loopback port for the fallback page, and the launched workspace for bounded project scans. Set `DOODLE_WORKSPACE_ROOT` only when the host starts the MCP server outside the project you want to scan; `OUTPUT_DIR`, `PREVIEW_HOST`, `PREVIEW_PORT`, and `LOG_LEVEL` remain optional overrides.

For a Codex plugin install from a repository checkout, run `npm run setup:codex` instead. It builds the ignored `.doodle-plugin/doodle/` package, adds the repository marketplace, installs the plugin, and prints the first prompt. The plugin is desktop-only; public plugin directory submission is separate and described in `../docs/SUBMISSION.md`.

To run the minimal client against a local checkout, build the server first:

```bash
npm run build
node examples/board-client.mjs
```

Normal MCP calls do not open a browser. Ask the agent for `PANEL_URL` and open that local address only when a human wants to see the shared canvas.
