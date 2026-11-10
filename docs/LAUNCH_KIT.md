# Launch Kit

## Canonical description

> A shared canvas for people and AI to draw together through MCP.

Recommended homepage: `https://github.com/2648782102/Doodle#readme`

Recommended topics: `ai`, `canvas`, `developer-tools`, `drawing`, `local-first`, `mcp`, `typescript`, `whiteboard`.

## Short post

Doodle is a small local MCP server with an optional MCP Apps canvas embedded beside the agent's existing conversation. Use `show_board` to open the canvas and `get_board` / `draw_board` to read and share sketches, arrows, and diagrams. The chat stays in the host, and the standalone local canvas is available as a fallback. Project structure is an optional read-only scan; the canvas never writes project files.

## Longer post

Most visual tools for agents are either static diagram generators or full dashboards. Doodle keeps the useful part: one canvas embedded alongside the conversation, with no second chat surface. Four focused MCP tools, one versioned board state file, and a standalone local fallback. `scan_project` can read bounded project structure, but the AI decides whether and how to draw it. The board never writes project files.

## Release notes starter

```text
0.5.0 continues the simple shared board with the canvas embedded beside the agent conversation. It removes the legacy workbench, Mermaid library, proposal/session state, IDE launcher, and extension code. The product has four MCP tools, a bounded read-only project scan, and a small dependency set.
```

Do not claim hosted collaboration, approval workflows, static diagram export, or automatic code changes.
