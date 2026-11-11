# Doodle

> A shared canvas for people and AI to draw together through MCP.

Doodle is a local-first MCP canvas, not a project workbench, static diagram generator, chat product, or code approval system. Install the desktop-only Codex plugin from this repository's marketplace, or connect the same four-tool stdio server directly. In hosts that support MCP Apps, `show_board` optionally presents the interactive canvas beside the existing agent conversation, and successful `draw_board` results advertise the same UI so completed AI drawings appear immediately. Hosts that advertise `updateModelContext` receive the current final board snapshot plus a final-state delta from the last published snapshot in the **current host conversation's** model context. This is not an operation log and does not trigger a model turn. Hosts that also advertise `sendMessage` show a `Notify Agent` button that sends only one short message into the existing host chat; Doodle adds no session or chat window. Conversation stays in the host chat. `get_board` reports the active local `PANEL_URL` as a standalone fallback; normal MCP calls never open the system browser.

Choose a tool to click-place or drag-size objects. Space or middle-button drag pans; the wheel pans and Ctrl/Command-wheel zooms. Double-click an object to edit its text. The embedded UI calls the same `get_board` and `draw_board` tools through the host bridge; it needs no separate chat service.

## 30-second start

Choose one path:

**Codex desktop plugin**: from a Doodle checkout, run one command:

```bash
npm run setup:codex
```

It installs dependencies when needed, builds the self-contained plugin, registers this repository as a local marketplace, installs `doodle@doodle`, and prints the first prompt. **Start a new Codex session**, then say:

```text
Open the Doodle board and put one note on it so I can edit it.
```

MCP Apps-compatible hosts show the canvas beside the chat. The AI reads the board first, then draws a starter object. Pick a tool to click or drag, then double-click or select an object and press `Enter` / click `Edit` to change its text. Use the `?` button or press `?` for the short human gestures. Hosts with context support sync the final board state automatically; after editing, click `Notify Agent` for one short reminder, or say “read the board again” so the AI calls `get_board`. If the host cannot embed the canvas or lacks these capabilities, ask the agent for `PANEL_URL`, open that local address, and ask the AI to reread the board in chat. Normal MCP calls never open a browser as a side effect.

The complete path is `npm run setup:codex → new session → first prompt → see or edit one canvas → final-state context sync / notify agent → AI reads it again`.

**Any MCP host**: add the `npx -y doodle-mcp` snippet from `examples/mcp-config/` to your host configuration, restart the MCP session, and use the same first prompt. `show_board` / `draw_board` still present the canvas; if the host cannot render it, ask for `PANEL_URL`. This path needs no repository clone and does not imply public plugin-directory publication.

## Four tools

| Tool | Purpose |
|---|---|
| `get_board` | Read the shared canvas; an empty board returns `FIRST_USE` / `NEXT_STEPS` and the drawing guide, while later reads use a concise `NEXT`. `BOARD_JSON`, object IDs, coordinates, authors, and revision are always retained. |
| `show_board` | Open the interactive shared canvas beside the agent conversation when a user wants to see or edit it. |
| `draw_board` | Add, update, or remove notes, text, rectangles, ellipses, and directed arrows; writes are serialized against the latest state. |
| `scan_project` | Optional read-only project paths and bounded `file:line` evidence. It does not draw or write files. |

The loop is `agent conversation ↔ shared canvas: get_board → draw_board → person sees or edits the canvas → final-state delta enters the current conversation context → notify agent / AI reads it again`. `show_board` is the explicit render tool, while successful `draw_board` results also advertise the optional UI in compatible hosts. Project structure is only one possible subject; `scan_project` is optional and must be visualized with `draw_board` if needed.

## Install

### Codex plugin (recommended)

Run one command from a Doodle checkout:

```bash
npm run setup:codex
```

`scripts/setup-codex.mjs` modifies Codex configuration only when you invoke it: it runs `npm install` when needed, `npm run build`, `codex plugin marketplace add . --json`, and `codex plugin add doodle@doodle --json`. It is safe to repeat; use `npm run setup:codex -- --dry-run` to preview the commands. Official OpenAI documentation distinguishes local marketplaces from the [universal public plugin directory](https://developers.openai.com/plugins/build/plugins) and says to [start a new session](https://learn.chatgpt.com/docs/plugins) before using installed plugin skills and MCP tools. `npm run build:submission` also produces an ignored `doodle-plugin-submission/doodle-0.7.0.zip` for review. Public plugin-directory publication remains a separate approved OpenAI submission; see `docs/SUBMISSION.md`, `PRIVACY.md`, `SUPPORT.md`, `TERMS.md`, and `docs/FAQ.md`.

### Direct MCP stdio

Add a zero-configuration snippet from `examples/mcp-config/` to your MCP host. Published installs use `npx -y doodle-mcp`; local checkouts may use `node dist/index.js` after `npm run build`. The server chooses a free loopback port, an isolated board-state directory, and the launched workspace by default. Set `DOODLE_WORKSPACE_ROOT` only when the MCP host starts outside the project that `scan_project` should inspect; `OUTPUT_DIR`, `PREVIEW_HOST`, `PREVIEW_PORT`, and `LOG_LEVEL` remain optional overrides. When `PREVIEW_PORT` is unset, the server reports the active address as `PANEL_URL`; normal MCP calls do not open a browser.

### Contributor check

```bash
npm install
npm run check
npm run doctor
```

Version 1 board files may contain old notes. They remain readable for compatibility, but new canvas UI and agent tools do not display or write a message feed.

## Drawing contract

- Call `get_board` first and reuse object IDs for updates and removals.
- Put `author` at the `draw_board` top level.
- Use a strict grid, short labels, and consistent sizes for structured diagrams.
- A `line` is a directed arrow from `(x,y)` to `(x+w,y+h)`; `w` and `h` may be negative. Other objects use `(x,y)` as the top-left corner.
- Use `remove_ids` before redrawing a whole diagram.

## Safety

stdout carries only MCP JSON-RPC; logs go to stderr. The HTTP server binds to `127.0.0.1` by default. Non-GET `/api/board/*` requests require the random `X-AI-Draw-Token`, `confirmedBy: "human"`, and a matching board revision. Project scans return bounded workspace-relative paths and short evidence text only, filter common credential lines, and cap evidence at 40 lines. Board mutations are serialized across processes. Board content never authorizes project writes; the embedded UI uses only normal canvas tools through the MCP Apps host bridge.

All four tools carry explicit MCP annotations. `get_board`, `show_board`, and `scan_project` are read-only, non-destructive, and local-scope; `draw_board` is a destructive local write because it can remove or overwrite board objects. Embedded context updates carry local board state to the current host conversation only; the standalone `PANEL_URL` page has no session bridge and never pretends that context was synchronized.

See `SECURITY.md`, `PRIVACY.md`, `SUPPORT.md`, `TERMS.md`, `docs/ARCHITECTURE.md`, and `AGENTS.md` for details.

## License

MIT. See `LICENSE`.
