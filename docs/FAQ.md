# FAQ

## Is Doodle public in the ChatGPT or Codex plugin directory?

No. The repository provides a local/repo marketplace for desktop installation. Public directory publication requires a separate approved local-MCP submission, verified developer or business identity, ZIP package, policy attestations, and review.

## Does Doodle upload my board or project files?

No hosted upload is part of the product. Board state stays on the local machine. `get_board` and `scan_project` return their results to the connected agent host as part of the active MCP conversation; they do not call a Doodle backend. See [PRIVACY.md](../PRIVACY.md).

## Why is `show_board` separate from `get_board`?

`get_board` is the data tool for every MCP host. `show_board` is an optional render tool for hosts that support MCP Apps. Text-only hosts retain the complete four-tool workflow and can use the `PANEL_URL` reported by `get_board` as a human-facing local fallback.

## Does a drawing change my source code?

No. Board objects are visual context. Code changes remain a separate, explicitly reviewed coding-agent action.

## Why is the plugin desktop-only?

The plugin starts a local stdio MCP server and a loopback HTTP preview on the user's machine. It has no hosted MCP endpoint and cannot run as a remote web plugin.

## Where is the board saved?

The version 1 board state is saved as `.doodle/board.json` under `OUTPUT_DIR`, plugin data, or workspace-local `.doodle-data`. Generated runtime bundles and board state are ignored by Git.

## Where do I get help?

See [SUPPORT.md](../SUPPORT.md) and [Troubleshooting](TROUBLESHOOTING.md). Security issues should use private vulnerability reporting.
