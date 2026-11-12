# Doodle

> A local-first two-way board where people and AI draw to express intent through MCP.

## Product definition

Doodle has one kernel: **one infinite board shared by a person and an AI**. The AI draws through MCP tools inside the agent; the person draws directly on the canvas. Either side can continue or revise what the other left behind. The board is the communication medium. Conversation stays in the host chat; Doodle creates no second session.

There are two supported entry points:

- **Codex plugin**: the recommended install, one command.
- **Direct MCP / `npx`**: works in any MCP host without cloning the repository.

Host capability has three layers: the four tools always work; MCP Apps hosts show the same canvas beside the chat; hosts with `updateModelContext` / `sendMessage` add automatic final-state sync and a short notification. When a host cannot render the canvas, `PANEL_URL` from `get_board` is the local fallback page. Project structure is optional source material, not the product.

`PANEL_URL` belongs to the current MCP server process: it becomes unavailable when that session or host exits. For a local preview independent of a conversation, run `npm run preview:board`. It starts only the board HTTP server, registers no MCP stdio tools, and installs no background service. Stop it with `Ctrl+C`.

The two-way loop:

```text
AI draws with draw_board → person draws or edits on the canvas
→ final state enters the current conversation context / person notifies the agent
→ AI reads with get_board or model context → AI draws again → repeat
```

## 30-second start

Choose one entry point:

**Codex desktop plugin**: from a Doodle checkout, run one command:

```bash
npm run setup:codex
```

It installs dependencies when needed, builds the self-contained plugin, registers this repository as a local marketplace, installs `doodle@doodle`, and prints the first prompt. **Start a new Codex session**, then say:

```text
Open the Doodle board so we can communicate on it.
```

MCP Apps-compatible hosts show the canvas beside the chat. The AI reads the board first, then draws a starter object. Pick a tool to click or drag to draw directly; double-click an object to edit text and double-click empty canvas to create a note. Drag on empty canvas to marquee-select for batch move/delete/group/layout, with undo/redo, arrow-key nudging, alignment snapping, and `Ctrl/⌘+V` image paste. Use `?` for the short gesture guide. After a person draws, capable hosts sync the final state automatically; `Notify Agent` sends one short reminder where supported. The AI replies in chat or keeps drawing on the board. If the host cannot render the canvas, ask for `PANEL_URL`, open that local address, and ask the AI to reread the board in chat.

The complete path is `npm run setup:codex → new session → first prompt → two-way drawing and editing → final-state context sync / notification → AI reads and draws again`.

**Any MCP host**: add the `npx -y doodle-mcp` snippet from `examples/mcp-config/` to your host configuration, restart the MCP session, and use the same first prompt. `show_board` / `draw_board` still present the canvas; if the host cannot render it, ask for `PANEL_URL`. This path needs no repository clone and does not imply public plugin-directory publication.

## Four tools

| Tool | Purpose |
|---|---|
| `get_board` | Read the shared canvas; an empty board returns `FIRST_USE` / `NEXT_STEPS` and the drawing guide, while later reads use a concise `NEXT`. `BOARD_JSON`, object IDs, coordinates, authors, and revision are always retained. |
| `show_board` | Open the interactive shared canvas beside the agent conversation when a user wants to see or edit it. |
| `draw_board` | Add items, apply precise updates/removals, or arrange objects; supports notes, text, shapes, arrows, strokes, images, headings, and focus markers; writes are serialized against the latest state. |
| `scan_project` | Optional read-only project paths and bounded `file:line` evidence. It does not draw or write files. |

The loop is two-way: `AI reads and draws → person draws or edits → final-state delta enters the current conversation context / person notifies the agent → AI reads and draws again`. `show_board` is the explicit render tool, while successful `draw_board` results also advertise the optional UI in compatible hosts. Project structure is only one possible subject; `scan_project` is optional and must be visualized with `draw_board` if needed.

## Install

### Codex plugin (recommended)

Run one command from a Doodle checkout:

```bash
npm run setup:codex
```

`scripts/setup-codex.mjs` modifies Codex configuration only when you invoke it: it runs `npm install` when needed, `npm run build`, `codex plugin marketplace add . --json`, and `codex plugin add doodle@doodle --json`. It is safe to repeat; use `npm run setup:codex -- --dry-run` to preview the commands. Official OpenAI documentation distinguishes local marketplaces from the [universal public plugin directory](https://developers.openai.com/plugins/build/plugins) and says to [start a new session](https://learn.chatgpt.com/docs/plugins) before using installed plugin skills and MCP tools. `npm run build:submission` also produces an ignored `doodle-plugin-submission/doodle-0.7.0.zip` for review. Public plugin-directory publication remains a separate approved OpenAI submission; see `docs/SUBMISSION.md`, `PRIVACY.md`, `SUPPORT.md`, `TERMS.md`, and `docs/FAQ.md`.

### Direct MCP stdio

Add a zero-configuration snippet from `examples/mcp-config/` to your MCP host. Published installs use `npx -y doodle-mcp`; local checkouts may use `node dist/index.js` after `npm run build`. The server chooses a free loopback port, an isolated board-state directory, and the launched workspace by default. Set `DOODLE_WORKSPACE_ROOT` only when the MCP host starts outside the project that `scan_project` should inspect; `OUTPUT_DIR`, `PREVIEW_HOST`, `PREVIEW_PORT`, and `LOG_LEVEL` remain optional overrides. When `PREVIEW_PORT` is unset or `0`, the server reports the active address as `PANEL_URL`; normal MCP calls do not open a browser.

### Contributor check

```bash
npm install
npm run check
npm run doctor
npm run preview:board
```

Version 1 board files may contain old notes. They remain readable for compatibility, but new canvas UI and agent tools do not display or write a message feed.

## Drawing contract

- Call `get_board` first; prefer `updates` for precise changes and reuse object IDs for removals.
- Put `author` at the `draw_board` top level.
- Use a strict grid, short labels, and consistent sizes for structured diagrams.
- A `line` is a directed arrow from `(x,y)` to `(x+w,y+h)`; `w` and `h` may be negative. Set `shape` to `straight`, `curve`, or `orthogonal`. Other objects use `(x,y)` as the top-left corner.
- `stroke.points` are local to the item bounds; `image.src` is a bounded `data:image/*;base64` source.
- Use `remove_ids` only when replacing a whole diagram.

## Safety

stdout carries only MCP JSON-RPC; logs go to stderr. The HTTP server binds to `127.0.0.1` by default. Non-GET `/api/board/*` requests require the random `X-AI-Draw-Token`, `confirmedBy: "human"`, and a matching board revision. Project scans return bounded workspace-relative paths and short evidence text only, filter common credential lines, and cap evidence at 40 lines. Board mutations are serialized across processes. Board content never authorizes project writes; the embedded UI uses only normal canvas tools through the MCP Apps host bridge.

All four tools carry explicit MCP annotations. `get_board`, `show_board`, and `scan_project` are read-only, non-destructive, and local-scope; `draw_board` is a destructive local write because it can remove or overwrite board objects. Embedded context updates carry local board state to the current host conversation only; the standalone `PANEL_URL` page has no session bridge and never pretends that context was synchronized.

See `SECURITY.md`, `PRIVACY.md`, `SUPPORT.md`, `TERMS.md`, `docs/ARCHITECTURE.md`, and `AGENTS.md` for details.

## License

MIT. See `LICENSE`.
