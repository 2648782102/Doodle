export const MCP_INSTRUCTIONS = [
  "AI Draw MCP is a simple shared infinite board for people and AI. Use it directly inside the agent; normal tool calls never open a browser or write project files.",
  "Start with get_board. It returns BOARD_JSON with existing object IDs, coordinates, recent short messages, and a compact drawing guide.",
  "Use draw_board to add, update, or remove notes, text, rectangles, ellipses, and directed arrows. Use reply_on_board for one short response beside the canvas.",
  "Drawing contract: a line is an arrow from (x,y) to (x+w,y+h); w/h are signed endpoint deltas and may be negative. Other items use (x,y) as the top-left corner with positive width/height.",
  "For a structured diagram, read the board first, use a strict grid, short labels, and endpoints just outside the source and target shapes. Use remove_ids to clean old objects before redrawing a whole diagram. Put author at the draw_board top level.",
  "scan_project is optional: a read-only project-structure capability. It returns bounded paths and evidence text only; use draw_board to place that information on the shared board. It never mutates files or grants write authority.",
  "The local HTTP panel is for a human to see and edit the same canvas. Board communication is context only; project changes remain a separate explicit coding-agent action.",
].join("\n");
