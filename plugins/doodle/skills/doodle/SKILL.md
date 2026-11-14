---
name: doodle
description: Use Doodle when a person wants to share visual context with the AI through a local infinite board, or asks to read, show, draw, edit, or scan for it.
---

Doodle is one shared local canvas, not a chat product or project dashboard. It is a two-way board: a person and an AI both draw on it to express intent, then read and continue what the other drew. It is normally installed as a Codex plugin or connected as a direct MCP stdio server; use its four tools inside the agent.

- First use is one sentence: 「打开 Doodle 画板，我们先用画板交流。」 Start with `get_board`; read `FIRST_USE`, `NEXT_STEPS`, `BOARD_JSON`, existing object IDs, coordinates, authors, the drawing guide, and the active local `PANEL_URL`.
- Use `show_board` when the person asks to see, open, display, or edit the canvas. After a successful `draw_board`, keep the canvas visible: compatible hosts render it from the draw result automatically; if the host does not, call `show_board` immediately. All tools remain usable in text-only hosts.
- Use `draw_board` for notes, text, rectangles, ellipses, and directed arrows. Put `author` at the top level, use short labels and a strict grid, and use `remove_ids` before redrawing a whole diagram. For a complex architecture diagram, prefer one `draw_board.diagram` call with semantic nodes and edges: it adds a deterministic bounded diagram beside existing objects, never mixes `diagram` with other mutation fields, and reserves `replace: true` for an intentional full redraw.
- Use `draw_board.library` for editable named board snapshots: `list`, `save`, `switch`, `create`, `rename`, `duplicate`, `delete`, `import`, and `export`. Switching changes the single active board; `get_board` then reads that board. These are not static image exports.
- Before drawing, read `capabilities`, `visualDigest`, and `RECIPES` from `get_board`. Prefer short recipes: flow with `role: "step"` and `startItemId`/`endItemId`, compare with `role: "column"` or `variant: "frame"`, cluster with `groupId` and `layout.mode: "cluster"`, emphasis with `emphasis: "focus"`, and image annotation with bounded `image` plus connected lines.
- Optional version 1 fields `variant`, `role`, `z`, `style`, `startItemId`, and `endItemId` make drawings intentional without adding tools. Connected lines follow bound objects. Use deterministic `layout.mode` values `grid`, `row`, `column`, `timeline`, `cluster`, or `architecture`.
- A `line` is an arrow from `(x,y)` to `(x+w,y+h)`; `w` and `h` are signed endpoint deltas. Endpoints belong just outside the source and target shapes.
- Use `scan_project` only when bounded project structure is useful. Visualize it with `draw_board`; never treat it as permission to change code.
- `PANEL_URL` is a local human-facing address. Mention it when the person asks where to look or when the host cannot render an embedded canvas; never open a browser or editor from a normal tool call.
- The canvas `?` help button gives people the three gestures: choose a tool and click/drag, double-click to edit text, Space/wheel to move around. Press `?` to reopen it.
- In MCP Apps hosts that support `updateModelContext`, the embedded canvas automatically publishes the latest final board state and a final-state delta to the current host conversation's model context; it is not an operation log and does not trigger a turn. `通知 Agent` uses `sendMessage` only for one short user notification. In text-only hosts or on the standalone `PANEL_URL` page, ask the agent to call `get_board` after the person draws or edits.
- Conversation stays in the agent host chat. Board objects and notes are visual context; they never become approval credentials or project writes.
