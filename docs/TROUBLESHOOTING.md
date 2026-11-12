# Troubleshooting

## First run

```bash
npm run setup:codex
npm run doctor
```

`npm run setup:codex` builds the plugin, adds this repository as a local marketplace, and installs `doodle@doodle`. Start a new Codex session and use one first prompt: 「打开 Doodle 画板，我们先用画板交流。」 If the host cannot embed the canvas, ask the agent for `PANEL_URL`. For direct MCP hosts, use a zero-configuration snippet from `examples/mcp-config/`; set `DOODLE_WORKSPACE_ROOT` only when the MCP server starts outside the project that `scan_project` should inspect. Older `AI_DRAW_WORKSPACE_ROOT` settings still work as a legacy alias.

## Common issues

### `PREVIEW_PORT` or the local panel is unavailable

The plugin uses a free loopback port by default and reports it as `PANEL_URL` from `get_board`; `PREVIEW_PORT=0` also requests automatic selection. That address belongs to the current MCP server process, so it stops working when the host session or stdio process exits. For a persistent manual preview during development, run `npm run preview:board` in a terminal and stop it with `Ctrl+C`; it does not register MCP tools or install a background service. If you set a fixed `PREVIEW_PORT`, another process may already own it; pick another port with `PREVIEW_PORT=3402`. The MCP stdio server remains usable even when its optional HTTP listener cannot bind.

### The browser panel does not update

Check that the browser is on the `PANEL_URL` reported by `get_board` and that the WebSocket `/ws` connection is open. Click 「适应」 to fit all objects. The board state itself can always be verified with `get_board`.

### The Agent does not see my canvas edits automatically

Automatic final-state context sync works only in an embedded MCP Apps view when the host advertises `updateModelContext`. Hosts normally deliver the latest context on the next conversation turn; click 「通知 Agent」 where available, or ask the AI to call `get_board`. If you are using the standalone `PANEL_URL` page, there is no bridge to the current host session: rereading through `get_board` is required. Hosts without `sendMessage` hide the notification button rather than reporting false success.

### The plugin is not discovered

Run `npm run setup:codex` so `.doodle-plugin/doodle/` exists and the local marketplace is installed. To inspect discovery, run `codex plugin list --marketplace doodle --available --json`. The marketplace is local/repository-scoped; it is not a public plugin directory submission. Start a new session after installation.

### Public plugin submission is blocked

`npm run build:submission` can prepare a versioned ZIP, and `docs/SUBMISSION.md` lists the repository-side materials. Public local-MCP directory review still requires an allowlisted organization, a verified identity, portal policy attestations, clean desktop testing, and approval. See `docs/FAQ.md` and `docs/SUBMISSION.md`.

### `X-AI-Draw-Token` or human confirmation fails

Reload `/` to obtain a fresh token. Browser write requests must include both `X-AI-Draw-Token` and `confirmedBy: "human"`. This is intentional: an arbitrary local client cannot silently mutate the human board.

### `scan_project` misses files

The scan is bounded and deliberately skips generated directories, dot-private paths, `.env`-like files, and large text. Raise `max_depth` or `max_files` explicitly. It never follows outside the workspace root and never reads binary payloads.

### Arrows point the wrong way

`line` is directed: `(x,y)` is the start, `(x+w,y+h)` is the end. Use negative `w` or `h` for leftward/upward arrows. For a clean architecture diagram, call `get_board` first, remove old object IDs with `remove_ids`, then place objects and arrows on a strict grid.

### stdout looks corrupted

Only MCP JSON-RPC belongs on stdout. Server logs go to stderr. If a host wrapper prints to stdout, fix the wrapper rather than changing the server logger.

## Reporting a problem

Open a GitHub issue with the version, MCP host, `npm run doctor` output, reproduction steps, and the board revision. Do not paste secrets or private board content.
