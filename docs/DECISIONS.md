# Current Decisions

`0.4.0` is a deliberate cleanup release. The product is one simple shared infinite board: a human and an AI draw notes, text, rectangles, ellipses, directed arrows, and short messages on one local canvas. The agent uses MCP stdio inside its normal coding workflow; the browser is only a human-facing view.

## Decisions in force

0. **The product is called Doodle.** The project and GitHub repository are `Doodle`; the npm package, CLI, and MCP server identity are `doodle-mcp`. The short name should stay casual and avoid platform or diagram-generator connotations.
1. **The board is the product.** `BOARD_JSON` is the only shared collaboration state. It is independent of project files, graph sessions, and proposal state.
2. **Four MCP tools are enough.** `get_board`, `draw_board`, and `reply_on_board` form the default loop. `scan_project` is an optional read-only project-structure helper.
3. **AI development stays inside the agent.** No tool opens a browser, IDE window, or editor. Logs stay on stderr; stdout remains clean for MCP JSON-RPC.
4. **Project scanning is context, not authority.** `scan_project` returns bounded relative paths and file:line evidence text. It does not draw automatically, write files, or grant code-change authority.
5. **Directed arrows are a canvas primitive.** A `line` goes from `(x,y)` to `(x+w,y+h)`; signed `w`/`h` are endpoint deltas. The human template renders the same SVG arrow contract.
6. **Human writes are explicitly local.** Non-GET `/api/board/*` requests require `X-AI-Draw-Token` and `confirmedBy: "human"`. The server binds to `127.0.0.1` by default.
7. **No project-write protocol is bundled.** Code changes remain ordinary coding-agent work. Board objects and notes never become approval credentials or automatic file edits.
8. **Dependencies follow the product.** Mermaid rendering, image conversion, IDE launchers, nanoid, and VS Code extension code were removed in `0.4.0`.

## Historical records

ADRs `0001`–`0026` described earlier project-workbench iterations. They are retained as read-only history in `docs/archive/adr-legacy/`. They are not current product contracts and must not be used to reintroduce the removed tool, session, or approval surfaces.

## Adding a decision

Add a short entry here when changing the board protocol, MCP tool surface, persisted state, security boundary, or product definition. Keep alternatives, consequences, and safety notes together. Update `AGENTS.md`, `docs/ARCHITECTURE.md`, tests, and `scripts/repo-check.mjs` in the same change.
