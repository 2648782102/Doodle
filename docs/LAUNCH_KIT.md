# Launch Kit

## Canonical description

> A shared canvas for people and AI to draw together through MCP.

Recommended homepage: `https://github.com/2648782102/Doodle#readme`

Recommended topics: `ai`, `canvas`, `developer-tools`, `drawing`, `local-first`, `mcp`, `typescript`, `whiteboard`.

## Short post

Doodle is a small local MCP board you can install with one `npm run setup:codex` command, then use from one first prompt in a new Codex session. Or connect the same four tools directly over zero-configuration stdio. Use `get_board` / `draw_board` to read and share sketches, arrows, and diagrams; `show_board` optionally renders the canvas in compatible MCP Apps hosts. The chat stays in the host, and the standalone local canvas is available as a fallback. Project structure is an optional read-only scan; the canvas never writes project files.

## Longer post

Most visual tools for agents are either static diagram generators or full dashboards. Doodle keeps the useful part: one local shared canvas with no second chat surface. A desktop-only plugin, four focused MCP tools, one versioned board state file, an optional MCP App, and a standalone local fallback all use the same server. `scan_project` can read bounded project structure, but the AI decides whether and how to draw it. The board never writes project files.

## Release notes starter

```text
0.6.3 shortens the complete product experience to one install command, one first prompt, one shared canvas, and one reread loop. It adds `npm run setup:codex`, zero-configuration direct MCP snippets, progressive `get_board` guidance, and a dismissible canvas help popover. The desktop-only plugin, automatic post-draw canvas presentation, four tools, bounded read-only project scan, version 1 board state, and local-only safety boundary are unchanged. Public directory approval remains a separate approved-partner process.
```

Do not claim hosted collaboration, approval workflows, static diagram export, or automatic code changes.
