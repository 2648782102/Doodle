---
name: doodle
description: Use Doodle when a person wants to share visual context with the AI through a local infinite board, or asks to read, show, draw, edit, or scan for it.
---

Doodle is one shared local canvas, not a chat product or project dashboard. It is normally installed as a Codex plugin or connected as a direct MCP stdio server; use its four tools inside the agent.

- First use is one sentence: 「打开 Doodle 画板，放一张便签，我来改给你看。」 Start with `get_board`; read `FIRST_USE`, `NEXT_STEPS`, `BOARD_JSON`, existing object IDs, coordinates, authors, the drawing guide, and the active local `PANEL_URL`.
- Use `show_board` when the person asks to see, open, display, or edit the canvas. After a successful `draw_board`, keep the canvas visible: compatible hosts render it from the draw result automatically; if the host does not, call `show_board` immediately. All tools remain usable in text-only hosts.
- Use `draw_board` for notes, text, rectangles, ellipses, and directed arrows. Put `author` at the top level, use short labels and a strict grid, and use `remove_ids` before redrawing a whole diagram.
- A `line` is an arrow from `(x,y)` to `(x+w,y+h)`; `w` and `h` are signed endpoint deltas. Endpoints belong just outside the source and target shapes.
- Use `scan_project` only when bounded project structure is useful. Visualize it with `draw_board`; never treat it as permission to change code.
- `PANEL_URL` is a local human-facing address. Mention it when the person asks where to look or when the host cannot render an embedded canvas; never open a browser or editor from a normal tool call.
- The canvas `?` help button gives people the three gestures: choose a tool and click/drag, double-click to edit text, Space/wheel to move around. Press `?` to reopen it.
- Conversation stays in the agent host chat. Board objects and notes are visual context; they never become approval credentials or project writes.
