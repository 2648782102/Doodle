# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.6.x | Yes |
| 0.5.x and earlier | No |

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting or contact the maintainers privately. Do not publish exploitable details in a public issue. Include reproduction steps, affected version, impact, and a suggested fix if available. Avoid pasting private board content or secrets.

## Threat model

Doodle is local-first. The MCP server uses stdio either directly or from a bundled desktop-only plugin; a small HTTP server binds to `127.0.0.1` by default so a person can see and edit the same canvas. Do not expose that port to an untrusted network. Point `DOODLE_WORKSPACE_ROOT` only at a workspace you are willing to scan for bounded path and short source-evidence text.

## Guarantees and boundaries

- stdout carries only MCP JSON-RPC; logs go to stderr.
- The board state file lives under `.doodle/board.json` inside `OUTPUT_DIR`, plugin data, or workspace-local `.doodle-data`, and is ignored by Git.
- Non-GET `/api/board/*` requests require the random `X-AI-Draw-Token` injected into the local HTML and `confirmedBy: "human"`. The human canvas sends a matching board revision so stale edits are rejected; legacy clients without it are serialized against the latest state. The token is not persisted.
- Board objects are visual context. They never become approval credentials or authority to write project files. The MCP App calls the server's normal tools through the host bridge; it has no separate project-write capability.
- `scan_project` is read-only. It returns workspace-relative paths and bounded evidence excerpts, skips dot-private and `.env`-like paths, skips common generated directories, caps evidence at 40 lines, filters common secret names and credential formats, and does not follow symlinks outside the configured workspace root.
- Board writes use a cross-process filesystem lock and atomic rename. Snapshot replacements with stale or non-advancing revisions are rejected.
- Normal MCP tools do not open browsers, launch IDEs, execute workspace commands, or write workspace files.
- The plugin is desktop-only and local. It contains no hosted endpoint, remote state, telemetry, lifecycle hook, or public-directory credentials.
- Code changes remain a separate coding-agent action with its own human review process.

## Disclosure

Maintainers will acknowledge reports, provide a fixed release when applicable, and credit reporters in `CHANGELOG.md` and release notes with permission.
