# Privacy Policy

Doodle is a local-first shared canvas for people and AI. This policy describes the data that the Doodle MCP server, Codex plugin, standalone canvas, and optional MCP App process. It applies to `doodle-mcp` and the `doodle` desktop-only plugin.

## Data categories

- **Board content:** text, coordinates, sizes, colors, author markers, object IDs, timestamps, and revision metadata that people or agents place on the canvas.
- **Local project context:** when `scan_project` is called, bounded workspace-relative file paths and short `file:line` evidence excerpts. The scan skips dot-private paths, `.env`-like files, common generated directories, large text files, and credential-like evidence.
- **Local connection metadata:** the loopback address and selected `PREVIEW_PORT`, a random per-page `X-AI-Draw-Token`, WebSocket update messages, and an in-memory `confirmedBy: "human"` marker required for non-GET board writes.
- **Browser view preferences:** camera position and zoom saved by the standalone canvas in browser localStorage.
- **Support data:** information a person voluntarily sends through GitHub Issues or private vulnerability reporting.

Doodle does not require an account, hosted profile, payment data, precise location, advertising identifier, or conversation transcript. The plugin has no telemetry, analytics SDK, hosted endpoint, or third-party data receiver.

## Purpose of use

Board content provides shared visual context between a person and an AI. Local project context is used only to answer the current bounded scan request; the AI decides whether to visualize it with `draw_board`. The loopback server, token, and WebSocket updates keep the human canvas synchronized with the same local board. View preferences remember the same person's camera position. Support data is used to diagnose reports and maintain the open-source project.

## Recipients and disclosure

Doodle keeps board and scan data on the user's machine. Normal operation sends no board content, project evidence, telemetry, or credentials to Doodle contributors, OpenAI, or another hosted third party. MCP tool results are returned to the connected agent host as part of the user's active conversation. If a person opens a GitHub Issue or private vulnerability report, the information they choose to include is visible to repository maintainers and GitHub according to that reporting channel.

## Retention

- **Board content:** retained in `.doodle/board.json` under `OUTPUT_DIR`, plugin data, or workspace-local `.doodle-data` until the user deletes that file or directory.
- **Browser view preferences:** retained in browser localStorage until the user clears site data.
- **Token and connection metadata:** the `X-AI-Draw-Token` is generated per page load and is not persisted; logs go to stderr and are retained only by the local process or log collector.
- **Support data:** retained in the chosen GitHub issue or vulnerability report for as long as the project needs it for resolution and historical context.

## User controls

The user chooses the workspace root, output directory, preview host, and preview port. They can stop the server, clear browser localStorage, delete the board state file, avoid calling `scan_project`, and remove the plugin at any time. `draw_board` supports object removal by ID; HTTP write authorization requires a fresh page token and explicit human confirmation. Board content never becomes authority to write project files.

## Security and children

Doodle is intended for general developer use and does not knowingly collect personal data from children under 13. Do not paste access credentials, secrets, regulated sensitive data, or private board content into public issues. Report security concerns privately as described in `SECURITY.md`.

## Changes

Material changes to this policy are recorded in `CHANGELOG.md` and published in the repository before a new plugin package is submitted.
