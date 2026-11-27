# Launch Kit

## Canonical description

> A local-first two-way board where people and AI draw to express intent through MCP.

Recommended homepage: `https://github.com/2648782102/Doodle#readme`

Recommended topics: `ai`, `canvas`, `developer-tools`, `drawing`, `local-first`, `mcp`, `typescript`, `whiteboard`.

## Short post

Doodle is a small local MCP board you can install with one `npm run setup:codex` command, then use from one first prompt in a new Codex session. Or connect the same three drawing tools directly over zero-configuration stdio. Use `get_board` / `draw_board` to read and share sketches, arrows, and diagrams; `show_board` optionally renders the canvas in compatible MCP Apps hosts. The chat stays in the host, and the standalone local canvas is available as a fallback. People and AI both work on the same canvas.

## Longer post

Most visual tools for agents are either static diagram generators or full dashboards. Doodle keeps the useful part: one local shared canvas with no second chat surface. A desktop-only plugin, three focused drawing tools, one versioned board state file, a local editable board library, AI-facing visual recipes and connected compositions, an optional MCP App, and a standalone local fallback all use the same server. Every mark comes from an AI or a person drawing on the shared canvas.

## Release notes starter

```text
0.8.0 keeps one install command, one first prompt, and one shared canvas while making the loop feel native inside an agent: compatible MCP Apps hosts receive the latest final board state and final-state delta in the current conversation's model context, and a `通知 Agent` button sends one short reminder. The three drawing tools, version 1 board state, local-only safety boundary, and `get_board` fallback are unchanged. Public directory approval remains a separate approved-partner process.
```

Do not claim hosted collaboration, approval workflows, static diagram export, or automatic code changes.
