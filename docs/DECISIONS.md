# Current Decisions

`0.5.0` continues the simple shared infinite board from `0.4.0`. The current product direction embeds its canvas beside the agent's existing conversation in MCP Apps-compatible hosts. A standalone local page remains available. Discussion stays in the host conversation; Doodle owns only shared visual context.

## Decisions in force

0. **The product is called Doodle.** The project and GitHub repository are `Doodle`; the npm package, CLI, and MCP server identity are `doodle-mcp`.
1. **The board is the product.** `BOARD_JSON` is the only shared collaboration state. It is independent of project files, graph sessions, and proposal state.
2. **The agent chat stays in the host.** Remove the duplicate composer and message feed from Doodle. The MCP App is optional and calls existing board tools through the host bridge; text-only MCP clients retain their complete workflow.
3. **Four MCP tools are enough.** `get_board` reads canvas data, `show_board` renders the optional UI, and `draw_board` mutates objects. `scan_project` is an optional read-only project-structure helper. The chat-like `reply_on_board` tool is removed.
4. **AI development stays inside the agent.** No tool opens a browser, IDE window, or editor. Logs stay on stderr; stdout remains clean for MCP JSON-RPC.
5. **Project scanning is context, not authority.** `scan_project` returns bounded relative paths and `file:line` evidence text. It does not draw automatically, write files, or grant code-change authority.
6. **Directed arrows are a canvas primitive.** A `line` goes from `(x,y)` to `(x+w,y+h)`; signed `w`/`h` are endpoint deltas. Both views render the same SVG arrow contract.
7. **Human writes are explicitly local.** Non-GET `/api/board/*` requests require `X-AI-Draw-Token` and `confirmedBy: "human"`. The server binds to `127.0.0.1` by default.
8. **No project-write protocol is bundled.** Code changes remain ordinary coding-agent work. Board objects never become approval credentials or automatic file edits.
9. **Dependencies follow the product.** Mermaid rendering, image conversion, IDE launchers, nanoid, and VS Code extension code were removed in `0.4.0`; MCP Apps and esbuild support the embedded canvas in `0.5.0`.
10. **Board mutations are serialized across processes.** Every mutation acquires a filesystem lock, reads the latest board, and atomically replaces it through a unique temporary file. Browser snapshot writes require an exact expected revision and reject stale writes.
11. **Project evidence is secret-filtered and bounded.** Scans omit lines that resemble common credential names or formats and return at most 40 evidence lines in total.
12. **Canvas gestures stay direct and reversible.** Click places a default-sized shape; drag sizes shapes or draws arrows. Space/middle drag pans, the wheel pans, and Ctrl/Command-wheel zooms. Escape cancels the current gesture or text edit.

## MCP App boundary

OpenAI's MCP Apps guide recommends separating data tools from render tools when an App should not reopen on each tool call. Doodle attaches the canvas to `show_board`; its UI refreshes through the ordinary `get_board` tool. The guide describes rendering in ChatGPT, while Codex MCP documentation establishes tool connection but does not confirm rendering MCP App components. Doodle keeps the standalone local page as a fallback. See [Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui).

## Historical records

ADRs `0001`–`0026` described earlier project-workbench iterations. They are retained as read-only history in `docs/archive/adr-legacy/`. They are not current product contracts and must not be used to reintroduce removed tool, session, or approval surfaces.

## Adding a decision

Add a short entry here when changing the board protocol, MCP tool surface, persisted state, security boundary, or product definition. Keep alternatives, consequences, and safety notes together. Update `AGENTS.md`, `docs/ARCHITECTURE.md`, tests, examples, and `scripts/repo-check.mjs` in the same change.
