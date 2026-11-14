# FAQ

## Is Doodle public in the ChatGPT or Codex plugin directory?

No. The repository provides a local/repo marketplace for desktop installation. Public directory publication requires a separate approved local-MCP submission, verified developer or business identity, ZIP package, policy attestations, and review.

## Does Doodle upload my board or project files?

No hosted upload is part of the product. Board state stays on the local machine. `get_board` and `scan_project` return their results to the connected agent host as part of the active MCP conversation; they do not call a Doodle backend. See [PRIVACY.md](../PRIVACY.md).

## How does the AI learn about my canvas edits?

In an MCP Apps host that supports `updateModelContext`, the embedded canvas publishes the newest final board state and a final-state delta to the current host conversation's model context automatically; it is not an action log and does not start a new model turn. Click `通知 Agent` where available to send one short reminder in the existing host chat, or ask the AI to call `get_board`. On a standalone `PANEL_URL` page or a host without these capabilities, nothing is silently attached to the agent session: ask the AI to reread the board.

## Why is `show_board` separate from `get_board`?

`get_board` is the data tool for every MCP host and now also leads with `FIRST_USE` / `NEXT_STEPS`. `show_board` is an optional render tool for hosts that support MCP Apps. Text-only hosts retain the complete four-tool workflow and can use the `PANEL_URL` reported by `get_board` as a human-facing local fallback.

## What do I say after installing?

Start a new Codex session and say 「打开 Doodle 画板，我们先用画板交流。」 The AI reads the board, shows it where supported, and draws a starter object. Draw or edit on the same canvas: click-place or drag shapes, double-click text, or select an object and press `Enter` / click `Edit`. In supported embedded hosts the final board state syncs to the current session; click `通知 Agent` or ask the AI to read the board again. The AI can answer in chat or draw a visual response on the board. Use the `?` button for short gestures.

## Does a drawing change my source code?

No. Board objects are visual context. Code changes remain a separate, explicitly reviewed coding-agent action.

## Why is the plugin desktop-only?

The plugin starts a local stdio MCP server and a loopback HTTP preview on the user's machine. It has no hosted MCP endpoint and cannot run as a remote web plugin.

## Where is the board saved?

The active version 1 board state is saved as `.doodle/board.json` under `OUTPUT_DIR`, plugin data, or workspace-local `.doodle-data`. Named editable snapshots live beside it in `.doodle/boards/`. Generated runtime bundles and board state are ignored by Git. Use the `图库` panel or `draw_board.library` to save and switch these snapshots; Doodle does not export static PNG/SVG images.

## Where do I get help?

See [SUPPORT.md](../SUPPORT.md) and [Troubleshooting](TROUBLESHOOTING.md). Security issues should use private vulnerability reporting.
