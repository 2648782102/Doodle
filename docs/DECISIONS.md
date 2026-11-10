# Current Decisions

`0.6.0` keeps the simple shared infinite board and makes an installable desktop-only Codex plugin the preferred distribution path. The plugin wraps the same four-tool MCP stdio server; direct MCP configuration remains supported. MCP Apps rendering is an optional host enhancement. A standalone local page remains available. Discussion stays in the host conversation; Doodle owns only shared visual context.

## Decisions in force

0. **The product is called Doodle.** The project and GitHub repository are `Doodle`; the npm package, CLI, and MCP server identity are `doodle-mcp`.
1. **The board is the product.** `BOARD_JSON` is the only shared collaboration state. It is independent of project files, graph sessions, and proposal state.
2. **The agent chat stays in the host.** Remove the duplicate composer and message feed from Doodle. The MCP App remains optional and calls existing board tools through the host bridge; text-only MCP clients retain their complete workflow.
3. **Four MCP tools are enough.** `get_board` reads canvas data and `PANEL_URL`, `show_board` renders the optional UI, and `draw_board` mutates objects. `scan_project` is an optional read-only project-structure helper. The chat-like `reply_on_board` tool remains removed.
4. **AI development stays inside the agent.** No tool opens a browser, IDE window, or editor. Logs stay on stderr; stdout remains clean for MCP JSON-RPC.
5. **Project scanning is context, not authority.** `scan_project` returns bounded relative paths and `file:line` evidence text. It does not draw automatically, write files, or grant code-change authority.
6. **Directed arrows are a canvas primitive.** A `line` goes from `(x,y)` to `(x+w,y+h)`; signed `w`/`h` are endpoint deltas. Both views render the same SVG arrow contract.
7. **Human writes are explicitly local.** Non-GET `/api/board/*` requests require `X-AI-Draw-Token` and `confirmedBy: "human"`. The server binds to `127.0.0.1` by default.
8. **No project-write protocol is bundled.** Code changes remain ordinary coding-agent work. Board objects never become approval credentials or automatic file edits.
9. **Dependencies follow the product.** Mermaid rendering, image conversion, IDE launchers, nanoid, and VS Code extension code were removed in `0.4.0`; MCP Apps and esbuild support the optional embedded canvas from `0.5.0`. The `0.6.0` plugin reuses the same dependencies through one bundled server.
10. **Board mutations are serialized across processes.** Every mutation acquires a filesystem lock, reads the latest board, and atomically replaces it through a unique temporary file. Browser snapshot writes require an exact expected revision and reject stale writes.
11. **Project evidence is secret-filtered and bounded.** Scans omit lines that resemble common credential names or formats and return at most 40 evidence lines in total.
12. **Canvas gestures stay direct and reversible.** Click places a default-sized shape; drag sizes shapes or draws arrows. Space/middle drag pans, the wheel pans, and Ctrl/Command-wheel zooms. Escape cancels the current gesture or text edit.
13. **The plugin is a distribution layer, not a second product.** One Codex-compatible manifest, one `.mcp.json`, a repository marketplace, one skill, and one self-contained server bundle expose the same four tools and version 1 board state. Portable Agent Plugins manifests are not mixed into the package.
14. **Plugin runtime is local and robust.** MCP stdio connects before the optional HTTP preview; preview failure does not disable tools. Without `PREVIEW_PORT`, the server binds a free loopback port and `get_board` reports `PANEL_URL`. `OUTPUT_DIR`, plugin data, or workspace-local `.doodle-data` isolate board state, while `DOODLE_WORKSPACE_ROOT` still scopes `scan_project`.
15. **The plugin build is reproducible.** `scripts/build-plugin.mjs` copies both canvas templates and the MCP App bundle, injects the package version, and writes ignored `.doodle-plugin/` output. `npm run check` and CI run the plugin guard.
16. **Public submission materials are separable from approval.** The repository prepares explicit tool annotations, privacy/support/terms URLs, a versioned ZIP, and `docs/SUBMISSION.md`; allowlisting, verified identity, portal attestations, clean desktop testing, and approval remain OpenAI-side conditions.

## MCP App boundary

Official OpenAI documentation describes custom MCP UI as optional, recommends separating data tools from render tools, confirms the `.codex-plugin/plugin.json` compatibility layout, and marks local stdio MCP plugins desktop-only. Doodle attaches its canvas only to `show_board`; its UI refreshes through `get_board`. Text-only hosts and plugin installs use the same tools without the UI. See [Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui), [Package your plugin](https://developers.openai.com/plugins/build/plugins), and [Submit desktop-only plugins](https://developers.openai.com/plugins/deploy/desktop-only).

## Historical records

ADRs `0001`–`0026` described earlier project-workbench iterations. They are retained as read-only history in `docs/archive/adr-legacy/`. They are not current product contracts and must not be used to reintroduce removed tool, session, or approval surfaces.

## Adding a decision

Add a short entry here when changing the board protocol, MCP tool surface, persisted state, security boundary, or product definition. Keep alternatives, consequences, and safety notes together. Update `AGENTS.md`, `docs/ARCHITECTURE.md`, tests, examples, and `scripts/repo-check.mjs` in the same change.
