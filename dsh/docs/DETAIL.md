# Doodle shared board

This bundle connects the local Doodle MCP server over stdio. It registers
`mcp__doodle__*` tools for one shared, two-way infinite board.

## What it provides

- `get_board` reads the current board as version 1 objects: ids, coordinates,
  authors, visual digest, and the active local `PANEL_URL`.
- `show_board` opens the interactive canvas in hosts that can render MCP Apps.
- `draw_board` adds notes, text, shapes, arrows, freehand ink, images, bound
  connectors, deterministic layouts, and semantic diagrams.
- `scan_project` returns bounded, read-only project context for optional use
  as drawing material.

Both sides can edit: the agent draws with tools, and the person draws directly
on the canvas. The person's edits come back through `get_board` or the host's
final-state context sync.

## Configuration

- Transport: stdio, running the self-contained server bundle that ships with
  the Doodle repository.
- `DOODLE_WORKSPACE_ROOT` scopes optional `scan_project` reads to the DSH
  workspace, so project scanning never leaves this folder.
- `cwd` is the same workspace; board state is written under the server's local
  data directory, never into the workspace.
- `startupTimeoutMs` covers the first launch of the bundled server.

## Using it

Open the canvas with `PANEL_URL` from `get_board`, or let an MCP Apps host show
it inline. Then ask the agent to draw, and draw on the same canvas yourself.

## Limitations

- The canvas is a local loopback page owned by the MCP server process; it stops
  when that process exits. Use `npm run preview:board` in the Doodle repository
  for a preview that is independent of the agent session.
- The board is visual context only. It never authorizes file writes or code
  changes; those remain ordinary, reviewed agent actions.
- The server is a local child process and is not sandboxed separately from the
  agent.
