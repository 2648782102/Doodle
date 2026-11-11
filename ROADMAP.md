# Roadmap

Doodle is a simple shared infinite board. The roadmap protects that boundary rather than listing a large feature catalogue.

## Shipped baseline — 0.6.1

- One version 1 board state shared by MCP tools and the local human canvas.
- Four tools: `get_board`, `show_board`, `draw_board`, and optional `scan_project`.
- Notes, text, rectangles, ellipses, directed arrows, and object authors. Persisted messages remain only for old-state compatibility.
- One canvas UI that works as an optional MCP App beside the agent conversation and as a standalone local fallback, with click-to-place and drag-to-size drawing, directional arrows, pan/zoom gestures, local viewport memory, inline text editing, delete, and fit-to-content.
- Read-only project scanning with bounded relative paths and `file:line` evidence.
- Clean MCP stdio, stderr-only logs, minimal runtime dependencies, and offline repository guards.
- A desktop-only Codex plugin with one compatibility manifest, one bundled stdio server, a repository marketplace, plugin-safe data/workspace resolution, an optional loopback port, and a plugin guard in `npm run check` and CI.
- Explicit MCP tool annotations, published privacy/support/terms pages, a versioned submission ZIP, and documented public-directory eligibility gates.
- An idempotent publish workflow that creates the GitHub Release and attaches the submission ZIP after the full check.

## Near-term work

- Improve drawing ergonomics without adding tools or workflow state: clearer selection, more predictable arrow endpoints, and keyboard/accessibility polish.
- Improve agent-facing guidance with concrete, tested layout conventions for architecture sketches.
- Keep project scan evidence bounded, private-path safe, and useful without making structure the product.
- Strengthen tests around atomic board persistence, HTTP authorization, MCP instructions, and package contents.
- Improve local plugin installation and reload ergonomics without changing the four-tool protocol or adding hosted infrastructure.

## Explicit non-goals

- Hosted accounts, multi-user SaaS, or social presence.
- A general chat product or mandatory human/AI turn-taking workflow.
- A Mermaid/diagram asset library, screenshot exporter, or project dashboard.
- A second graph/session/proposal state model or derived context catalogue.
- Built-in code-change approval, diff review, one-time grants, or automatic project writes.
- Browser or IDE windows opened as side effects of normal MCP tools.

## Changing the roadmap

Open an issue describing the user problem, the smallest end-to-end demonstration, and the safety implications. Tool-surface, protocol, or security changes require a decision entry, synchronized docs, tests, examples, and offline guards.
