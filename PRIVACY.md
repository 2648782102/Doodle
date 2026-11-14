# Privacy Policy

Doodle is a local-first shared canvas for people and AI. This policy describes the data that the Doodle MCP server, Codex plugin, standalone canvas, and optional MCP App process. It applies to `doodle-mcp` and the `doodle` desktop-only plugin.

## Data categories

- **Board content:** text, coordinates, sizes, colors, author markers, object IDs, timestamps, revision metadata, optional visual variant/style/connection fields, and named editable board-library snapshots saved on the same machine.
- **Local project context:** when `scan_project` is called, bounded workspace-relative file paths and short `file:line` evidence excerpts. The scan skips dot-private paths, `.env`-like files, common generated directories, large text files, and credential-like evidence.
- **Local connection metadata:** the loopback address and selected `PREVIEW_PORT`, a random per-page `X-AI-Draw-Token`, WebSocket update messages, and an in-memory `confirmedBy: "human"` marker required for non-GET board writes.
- **Experimental canvas assets:** on the `codex/excalidraw-spike` branch, Excalidraw CSS, fonts, locale chunks, and JavaScript are served from the local plugin/preview package. No CDN, hosted font, telemetry endpoint, or external asset request is used by the experimental engine.
- **Browser view preferences:** camera position and zoom saved by the standalone canvas in browser localStorage.
- **Embedded model context:** in MCP Apps hosts that support context updates, the current board snapshot, deterministic visual digest, capabilities, and final-state differences are passed to that host for the current conversation's model context. A user-initiated notification adds one short message to the same host conversation. Doodle does not create a separate chat history or hosted transcript.
- **Support data:** information a person voluntarily sends through GitHub Issues or private vulnerability reporting.

Doodle does not require an account, hosted profile, payment data, precise location, advertising identifier, or conversation transcript. The plugin has no telemetry, analytics SDK, hosted endpoint, or third-party data receiver.

## Purpose of use

Board content provides shared visual context between a person and an AI. Local project context is used only to answer the current bounded scan request; the AI decides whether to visualize it with `draw_board`. The loopback server, token, and WebSocket updates keep the human canvas synchronized with the same local board. The board library keeps named editable snapshots locally so a person can save or switch boards. View preferences remember the same person's camera position. Support data is used to diagnose reports and maintain the open-source project.

## Recipients and disclosure

Doodle keeps board and scan data on the user's machine. Normal operation sends no board content, project evidence, telemetry, or credentials to Doodle contributors or another hosted third party. MCP tool results are returned to the connected agent host as part of the user's active conversation; compatible embedded Apps may also pass local board state into that same host conversation's model context through the MCP Apps bridge, and the notification button may add one short message. Whether the host subsequently processes conversation data under its own policy is controlled by that host. If a person opens a GitHub Issue or private vulnerability report, the information they choose to include is visible to repository maintainers and GitHub according to that reporting channel.

## Retention

- **Board content:** retained in `.doodle/board.json` and `.doodle/boards/` under `OUTPUT_DIR`, plugin data, or workspace-local `.doodle-data` until the user deletes those files or directories.
- **Browser view preferences:** retained in browser localStorage until the user clears site data.
- **Token and connection metadata:** the `X-AI-Draw-Token` is generated per page load and is not persisted; logs go to stderr and are retained only by the local process or log collector.
- **Support data:** retained in the chosen GitHub issue or vulnerability report for as long as the project needs it for resolution and historical context.

## User controls

The user chooses the workspace root, output directory, preview host, and preview port. They can stop the server, clear browser localStorage, delete the active board state or saved library snapshots, avoid calling `scan_project`, and remove the plugin at any time. `draw_board` supports object removal by ID and library snapshot deletion; HTTP write authorization requires a fresh page token and explicit human confirmation. Board content never becomes authority to write project files.

## Security and children

Doodle is intended for general developer use and does not knowingly collect personal data from children under 13. Do not paste access credentials, secrets, regulated sensitive data, or private board content into public issues. Report security concerns privately as described in `SECURITY.md`.

## Changes

Material changes to this policy are recorded in `CHANGELOG.md` and published in the repository before a new plugin package is submitted.
