/**
 * Materialise a diagram into Board v1 objects.
 *
 * Placement comes from `diagram/layout.js`; this module decides identity and
 * rendering: the frame, title, subtitle, node cards, routed connectors, and the
 * legend. Generated ids are claimed against ids already on the board so a
 * second iteration appends cleanly instead of colliding.
 */

import {
  MAX_LINE_DELTA_X, MAX_LINE_DELTA_Y, MAX_SHAPE_HEIGHT, MAX_SHAPE_WIDTH, MIN_SHAPE_SIZE,
} from "../model/limits.js";
import type { BoardAuthor, BoardItem, ExpandedDiagramInput } from "../model/types.js";
import { now } from "../model/clock.js";
import { parseBoard } from "../model/validate.js";
import { resolveDiagramLayout } from "./layout.js";

/**
 * @param reservedIds IDs already on the target board. When the diagram is added
 *   beside existing objects, fixed generated IDs such as `diagram_frame` or a
 *   reused node id (`n1` on a second iteration) would collide and the whole
 *   draw call failed with `Duplicate board item ID`. Reserved IDs get a numeric
 *   suffix, and connector bindings are rewritten to match.
 */
export function diagramToBoardItems(
  diagram: ExpandedDiagramInput,
  author: BoardAuthor = "ai",
  reservedIds: Iterable<string> = [],
): BoardItem[] {
  const timestamp = now();
  const { origin, width, height, columnGap, rowGap, positions, rows } = resolveDiagramLayout(diagram);
  const maxRows = Math.max(...rows.values());
  const allPositions = [...positions.values()];
  const maxY = Math.max(...allPositions.map((position) => position.y));
  const leftmostX = Math.min(...allPositions.map((position) => position.x));
  const rightmostX = Math.max(...allPositions.map((position) => position.x));
  const bottom = Math.max(maxY + height + (diagram.edges.some((edge) => edge.label) ? rowGap + 28 : 0), origin.y + (maxRows + 1) * (height + rowGap) + 28);
  const bounds = { left: leftmostX, top: origin.y - 94, right: rightmostX + width, bottom };
  const items: BoardItem[] = [];
  const taken = new Set(reservedIds);
  const renames = new Map<string, string>();
  /**
   * Keep a requested id when it is free; otherwise append the smallest numeric
   * suffix that is. Deterministic per call, so re-issuing the same diagram on a
   * clean board still produces the same IDs.
   */
  const claim = (id: string): string => {
    if (!taken.has(id)) {
      taken.add(id);
      renames.set(id, id);
      return id;
    }
    let attempt = 2;
    while (taken.has(`${id}_${attempt}`)) attempt += 1;
    const next = `${id}_${attempt}`;
    taken.add(next);
    renames.set(id, next);
    return next;
  };
  const base = (id: string): Pick<BoardItem, "id" | "author" | "createdAt" | "updatedAt"> => ({
    id: claim(id), author, createdAt: timestamp, updatedAt: timestamp,
  });
  const frameTop = bounds.top - 12;
  const frame = {
    ...base("diagram_frame"), type: "rect" as const, x: bounds.left - 20, y: frameTop,
    w: bounds.right - bounds.left + 40, h: bounds.bottom - frameTop + 24,
    text: "", color: "#ffffff", variant: "frame" as const, role: "frame" as const, z: 0,
  };
  items.push(frame);
  if (diagram.title) items.push({
    ...base("diagram_title"), type: "text", x: origin.x, y: origin.y - 94, w: 760, h: 44,
    text: diagram.title, color: "#ffffff", variant: "heading", role: "label", z: 3,
    style: { fontSize: 28, fontWeight: "bold", textAlign: "left" },
  });
  if (diagram.subtitle) items.push({
    ...base("diagram_subtitle"), type: "text", x: origin.x, y: origin.y - 48, w: 900, h: 28,
    text: diagram.subtitle, color: "#ffffff", z: 3, style: { fontSize: 14, textAlign: "left" },
  });
  for (const node of diagram.nodes) {
    const position = positions.get(node.id)!;
    items.push({
      ...base(node.id), type: node.type ?? "rect", x: position.x, y: position.y, w: width, h: height,
      text: node.label.slice(0, 24), color: node.color ?? "#f6d365", variant: "card", role: node.role ?? "step",
      ...(node.emphasis ? { emphasis: node.emphasis } : {}),
      z: 2,
      style: { fontSize: 15, textAlign: "center" },
    });
    if (node.detail) items.push({
      ...base(`${node.id}_detail`), type: "text", x: position.x, y: position.y + height + 6, w: width, h: 24,
      text: node.detail.slice(0, 40), color: "#ffffff", z: 3, style: { fontSize: 12, textAlign: "center" },
    });
  }
  let edgeIndex = 0;
  diagram.edges.forEach((edge) => {
    const from = positions.get(edge.from)!;
    const to = positions.get(edge.to)!;
    /*
     * Route every edge instead of dropping the ones that span more than one
     * column. The old rule only drew a connector when the two nodes were
     * horizontally adjacent on the same row, so a snaked flow, a skip edge
     * (`step 1 → step 4`) or any vertical link was silently omitted: a 16-step
     * chain lost 5 of its 15 arrows while the tool still reported success.
     *
     * Anchors are chosen from the dominant direction so the arrow leaves the
     * side it is heading toward, which avoids lines crossing through the node
     * they connect.
     */
    const centerFrom = { x: from.x + width / 2, y: from.y + height / 2 };
    const centerTo = { x: to.x + width / 2, y: to.y + height / 2 };
    const dx = centerTo.x - centerFrom.x;
    const dy = centerTo.y - centerFrom.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const startX = horizontal ? (dx >= 0 ? from.x + width + 8 : from.x - 8) : centerFrom.x;
    const startY = horizontal ? centerFrom.y : (dy >= 0 ? from.y + height + 8 : from.y - 8);
    const endX = horizontal ? (dx >= 0 ? to.x - 8 : to.x + width + 8) : centerTo.x;
    const endY = horizontal ? centerTo.y : (dy >= 0 ? to.y - 8 : to.y + height + 8);
    const deltaX = Math.max(-MAX_LINE_DELTA_X, Math.min(MAX_LINE_DELTA_X, Math.round(endX - startX)));
    const deltaY = Math.max(-MAX_LINE_DELTA_Y, Math.min(MAX_LINE_DELTA_Y, Math.round(endY - startY)));
    if (deltaX === 0 && deltaY === 0) return;
    edgeIndex += 1;
    items.push({
      ...base(`diagram_edge_${edgeIndex}`), type: "line",
      x: Math.round(startX), y: Math.round(startY), w: deltaX, h: deltaY,
      // A short hop can carry its own label without covering anything. A long
      // or cross-row route cannot, so its text stays in the legend instead of
      // printing a caption over unrelated shapes.
      text: edge.label && horizontal && Math.abs(deltaX) <= width + columnGap * 1.5
        ? edge.label.slice(0, 40)
        : "",
      color: "#64748b",
      // A snaked or skip edge is not a straight horizontal hop; an orthogonal
      // route keeps it readable without crossing the shapes it passes.
      shape: horizontal ? "straight" : "orthogonal",
      // Bind to the ids actually emitted, which may be suffixed on append.
      startItemId: renames.get(edge.from) ?? edge.from,
      endItemId: renames.get(edge.to) ?? edge.to,
      z: 1,
    });
  });
  const legendLabels = diagram.edges.filter((edge) => edge.label).map((edge) => edge.label).join(" · ");
  if (legendLabels) {
    const legendWidth = Math.max(MIN_SHAPE_SIZE, Math.min(MAX_SHAPE_WIDTH, bounds.right - bounds.left));
    items.push({
      ...base("diagram_legend"), type: "text", x: origin.x, y: bottom - 28,
      w: legendWidth, h: 28, text: `连接：${legendLabels}`.slice(0, 120), color: "#ffffff", z: 3, style: { fontSize: 12, textAlign: "left" },
    });
  }
  /*
   * Make the frame hug what was actually drawn.
   *
   * The layout formula above derives its bounds from the node grid, which is
   * wrong twice over: `maxRows` counts rows per column but the expression reads
   * it as a row index, so it reserved one empty row (134px) at the bottom; and
   * the grid knows nothing about detail captions hanging below the last card or
   * about a title wider than the columns. Measured margins were 20 / 12 / 20 /
   * 200 with the title overflowing the right edge on a small diagram.
   *
   * Deriving all four sides from the items themselves cannot drift from what is
   * on the board, whatever the layout did.
   */
  const drawn = items.filter((item) => item !== frame);
  if (drawn.length > 0) {
    const left = Math.min(...drawn.map((item) => item.x));
    const top = Math.min(...drawn.map((item) => item.y));
    const right = Math.max(...drawn.map((item) => item.x + item.w));
    const bottomOfContent = Math.max(...drawn.map((item) => item.y + item.h));
    frame.x = left - 20;
    frame.y = top - 12;
    frame.w = right - left + 40;
    frame.h = bottomOfContent - top + 32;
  }
  // Hold the reference: on append the frame id may be suffixed, so looking it
  // up by the original name would return undefined.
  frame.w = Math.max(MIN_SHAPE_SIZE, Math.min(MAX_SHAPE_WIDTH, frame.w));
  frame.h = Math.max(MIN_SHAPE_SIZE, Math.min(MAX_SHAPE_HEIGHT, frame.h));
  const candidate = { version: 1 as const, id: "diagram_validation", title: diagram.title ?? "diagram", revision: 0, updatedAt: timestamp, items, notes: [] };
  parseBoard(candidate);
  return items;
}

