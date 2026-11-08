# ADR 0026 — Board lines are directed arrows

## Status

Accepted. Refines the simple board's rendering and AI drawing conventions in ADR 0025.

## Decision

A version 1 `SimpleBoard` item with `type: "line"` represents one directed arrow. Its `(x, y)` is the start point and `(x + w, y + h)` is the end point. `w` and `h` are signed endpoint deltas, not a bounding-box width and height. They may be negative, and at least one must be nonzero. Other item types keep their original top-left `(x, y)` plus positive width/height semantics.

The browser renders each line as an SVG path with an arrowhead and a centered optional label. The bounding box, hit target, selection outline, and fit-to-content calculation use the min/max of both endpoints. Existing version 1 `board.json` files remain valid; legacy lines with a small positive height become short diagonal arrows rather than horizontal decorations.

`get_board` returns a compact drawing guide with this contract. MCP initialization instructions, the `draw_board` schema description, and `AGENTS.md` repeat the same rule. AI agents read the existing board before drawing, use a strict grid, clean up old objects with `remove_ids`, place `author` at the tool's top level, and put arrow endpoints just outside source and target shapes.

## Alternatives considered

- Keep `line` as a CSS bottom border and chevron, then ask agents to use `text` with `→`: this is ambiguous, cannot connect two coordinates, and caused visibly misaligned architecture diagrams.
- Add a new `arrow` type: this would enlarge the item enum and leave the misleading `line` type in the product.
- Add explicit `fromId` / `toId` object references: this would make the board project-graph-like and less freeform than a simple infinite canvas.

## Consequences

- Structured diagrams can express direction without a second object model or a new MCP tool.
- Human-created arrows and AI-created arrows share one persisted version 1 contract.
- Negative `w` / `h` are valid only for lines; all coordinates remain finite and bounded.
- Fit-to-content and pointer interactions must account for both endpoints.
- Project writes, approval receipts, and the `/workbench` session protocol are unchanged.

## Safety

This decision changes only local canvas rendering and drawing guidance. It does not open a browser from MCP tools, expose workspace paths, grant write authority, or modify `apply_visual_proposal`. The preview server remains localhost-only and logs remain on stderr.
