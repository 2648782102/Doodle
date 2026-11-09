# Troubleshooting

## First run

```bash
npm install
npm run build
npm run check
npm run doctor
```

Then configure the MCP host using a snippet from `examples/mcp-config/`. Set `DOODLE_WORKSPACE_ROOT` to the project the agent is working on and `OUTPUT_DIR` to a writable location. Older `AI_DRAW_WORKSPACE_ROOT` settings still work as a legacy alias.

## Common issues

### `PREVIEW_PORT` is already in use

Another MCP host may already run the board. Pick another port with `PREVIEW_PORT=3402`, or stop the old process. The MCP stdio server still works if its own HTTP listener can bind.

### The browser panel does not update

Check that the browser is on `http://127.0.0.1:<PREVIEW_PORT>/` and that the WebSocket `/ws` connection is open. Click 「适应」 to fit all objects. The board state itself can always be verified with `get_board`.

### `X-AI-Draw-Token` or human confirmation fails

Reload `/` to obtain a fresh token. Browser write requests must include both `X-AI-Draw-Token` and `confirmedBy: "human"`. This is intentional: an arbitrary local client cannot silently mutate the human board.

### `scan_project` misses files

The scan is bounded and deliberately skips generated directories, dot-private paths, `.env`-like files, large text, and credential-like evidence. Raise `max_depth` or `max_files` explicitly. It never follows outside the workspace root and never reads binary payloads.

### A board write reports a revision conflict

Another human or AI edit reached the shared board first. Call `get_board` again, reapply the intended object IDs or drawing plan, and retry; Doodle intentionally rejects stale writes instead of overwriting newer canvas work.

### A board write times out waiting for its lock

Another local Doodle process held the board lock. Wait briefly and retry; Doodle removes stale lock files automatically and never clears the board to recover from a lock.

### Arrows point the wrong way

`line` is directed: `(x,y)` is the start, `(x+w,y+h)` is the end. Use negative `w` or `h` for leftward/upward arrows. For a clean architecture diagram, call `get_board` first, remove old object IDs with `remove_ids`, then place objects and arrows on a strict grid.

### stdout looks corrupted

Only MCP JSON-RPC belongs on stdout. Server logs go to stderr. If a host wrapper prints to stdout, fix the wrapper rather than changing the server logger.

## Reporting a problem

Open a GitHub issue with the version, MCP host, `npm run doctor` output, reproduction steps, and the board revision. Do not paste secrets or private board content.
