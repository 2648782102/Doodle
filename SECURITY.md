# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.4.x | Yes |
| 0.3.x and earlier | No |

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting or contact the maintainers privately. Do not publish exploitable details in a public issue. Include reproduction steps, affected version, impact, and a suggested fix if available. Avoid pasting private board content or secrets.

## Threat model

AI Draw MCP is local-first. The MCP server uses stdio; a small HTTP server binds to `127.0.0.1` by default so a person can see and edit the same canvas. Do not expose that port to an untrusted network. Point `AI_DRAW_WORKSPACE_ROOT` only at a workspace you are willing to scan for bounded path and short source-evidence text.

## Guarantees and boundaries

- stdout carries only MCP JSON-RPC; logs go to stderr.
- The board state file lives under `OUTPUT_DIR/.ai-draw/board.json` and is ignored by Git.
- Non-GET `/api/board/*` requests require the random `X-AI-Draw-Token` injected into the local HTML and `confirmedBy: "human"`. The token is not persisted.
- Board objects, notes, and AI replies are communication context. They never become approval credentials or authority to write project files.
- `scan_project` is read-only. It returns workspace-relative paths and bounded evidence excerpts, skips dot-private and `.env`-like paths, skips common generated directories, and does not follow paths outside the configured workspace root.
- Normal MCP tools do not open browsers, launch IDEs, execute workspace commands, or write workspace files.
- Code changes remain a separate coding-agent action with its own human review process.

## Disclosure

Maintainers will acknowledge reports, provide a fixed release when applicable, and credit reporters in `CHANGELOG.md` and release notes with permission.
