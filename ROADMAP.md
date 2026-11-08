# Roadmap

AI Draw MCP is a simple shared infinite board. The roadmap protects that boundary rather than listing a large feature catalogue.

## Shipped baseline — 0.4.0

- One version 1 board state shared by MCP tools and the local human canvas.
- Four AI-first tools: `get_board`, `draw_board`, `reply_on_board`, and optional `scan_project`.
- Notes, text, rectangles, ellipses, directed arrows, object authors, short messages, and object references.
- One restrained local web surface with pan/zoom, local viewport memory, inline text editing, delete, and fit-to-content.
- Read-only project scanning with bounded relative paths and `file:line` evidence.
- Clean MCP stdio, stderr-only logs, minimal runtime dependencies, and offline repository guards.

## Near-term work

- Improve drawing ergonomics without adding tools or workflow state: clearer selection, more predictable arrow endpoints, and keyboard/accessibility polish.
- Improve agent-facing guidance with concrete, tested layout conventions for architecture sketches.
- Keep project scan evidence bounded, private-path safe, and useful without making structure the product.
- Strengthen tests around atomic board persistence, HTTP authorization, MCP instructions, and package contents.

## Explicit non-goals

- Hosted accounts, multi-user SaaS, or social presence.
- A general chat product or mandatory human/AI turn-taking workflow.
- A Mermaid/diagram asset library, screenshot exporter, or project dashboard.
- A second graph/session/proposal state model or derived context catalogue.
- Built-in code-change approval, diff review, one-time grants, or automatic project writes.
- Browser or IDE windows opened as side effects of normal MCP tools.

## Changing the roadmap

Open an issue describing the user problem, the smallest end-to-end demonstration, and the safety implications. Tool-surface, protocol, or security changes require a decision entry, synchronized docs, tests, examples, and offline guards.
