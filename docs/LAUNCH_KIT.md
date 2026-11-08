# Launch Kit

## Canonical description

> A simple shared infinite canvas where people and AI draw objects, arrows, and short notes through MCP.

Recommended homepage: `https://github.com/2648782102/ai-draw-mcp#readme`

Recommended topics: `mcp`, `model-context-protocol`, `ai`, `canvas`, `whiteboard`, `drawing`, `visualization`, `developer-tools`, `local-first`, `typescript`.

## Short post

AI Draw MCP is a tiny local MCP server that gives a person and a coding agent one shared infinite canvas. The agent uses `get_board`, `draw_board`, and `reply_on_board` inside its normal workflow; project structure is an optional read-only scan. Draw a note, an arrow, or a whole architecture sketch without opening a browser from the agent or giving the canvas authority to edit code.

## Longer post

Most visual tools for agents are either static diagram generators or full dashboards. AI Draw MCP keeps the useful part: one canvas where both sides can place simple objects and short messages. Four MCP tools, one versioned board state file, one small local web surface, and no mandatory workflow. `scan_project` can read bounded project structure, but the AI decides whether and how to draw it. The board never writes project files.

## Release notes starter

```text
0.4.0 removes the legacy workbench, Mermaid library, proposal/session state, IDE launcher, and extension code. The product is now one simple shared board with four MCP tools, a bounded read-only project scan, and a smaller dependency set.
```

Do not claim hosted collaboration, approval workflows, static diagram export, or automatic code changes.
