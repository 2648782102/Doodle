export const MCP_INSTRUCTIONS = [
  "Doodle is a shared infinite canvas embedded beside the agent conversation in MCP Apps-compatible hosts. The agent conversation stays in the host; the canvas is for shared visual context. Normal tool calls never open a browser or write project files.",
  "Use get_board to read BOARD_JSON, current object IDs, coordinates, authors, and the drawing guide. Use show_board when the user asks to open, see, display, or edit the canvas; it renders the interactive app in compatible hosts without duplicating the conversation.",
  "Board writes are serialized against the latest state; embedded canvas edits include expected_revision so stale edits are rejected and refreshed before retry.",
  "Use draw_board to add, update, or remove notes, text, rectangles, ellipses, and directed arrows. Keep conversation in the agent chat; use canvas objects for visual context rather than posting chat replies onto the board.",
  "Drawing contract: a line is an arrow from (x,y) to (x+w,y+h); w/h are signed endpoint deltas and may be negative. Other items use (x,y) as the top-left corner with positive width/height.",
  "For a structured diagram, read the board first, use a strict grid, short labels, and endpoints just outside the source and target shapes. Use remove_ids to clean old objects before redrawing a whole diagram. Put author at the draw_board top level.",
  "scan_project is optional: a read-only project-structure capability. It returns bounded paths and evidence text only; use draw_board to place that information on the shared board. It never mutates files or grants write authority.",
  "The local HTTP page is a standalone fallback for seeing and editing the same canvas. MCP Apps-compatible hosts embed it beside the conversation. Board content is context only; project changes remain a separate explicit coding-agent action.",
].join("\n");
