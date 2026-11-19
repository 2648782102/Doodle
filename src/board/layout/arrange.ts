/**
 * Arranging existing objects on the board.
 *
 * `grid`, `row`, `column`, `timeline`, and `cluster` are simple deterministic
 * placements. `architecture` additionally reads connector bindings, derives
 * dependency layers, and repositions both the nodes and their arrows so a
 * hand-drawn structure can be tidied without redrawing it.
 */

import { LAYOUT_MODES, MAX_LINE_DELTA_X, MAX_LINE_DELTA_Y } from "../model/limits.js";
import type {
  BoardAuthor, BoardItem, BoardItemPatch, BoardLayoutInput, BoardPoint, SimpleBoard,
} from "../model/types.js";
import { updateBoardItems } from "../model/board.js";
import { BoardValidationError } from "../errors.js";

/** Both layout paths share these, but each mode has its own readable range. */
function assertLayoutBounds(
  layout: BoardLayoutInput,
  bounds: { columns: [number, number]; gap: [number, number] },
): void {
  const [minColumns, maxColumns] = bounds.columns;
  if (layout.columns !== undefined
    && (!Number.isInteger(layout.columns) || layout.columns < minColumns || layout.columns > maxColumns)) {
    throw new BoardValidationError(
      `layout.columns is ${layout.columns}; the range for this mode is ${minColumns}-${maxColumns}`,
      "LAYOUT_COLUMNS_OUT_OF_RANGE",
      "layout.columns",
      `an integer between ${minColumns} and ${maxColumns}`,
      `Leave the field out to use the mode's default, or pick a value inside the range.`,
    );
  }
  const [minGap, maxGap] = bounds.gap;
  if (layout.gap !== undefined && (!Number.isInteger(layout.gap) || layout.gap < minGap || layout.gap > maxGap)) {
    throw new BoardValidationError(
      `layout.gap is ${layout.gap}; the range for this mode is ${minGap}-${maxGap}`,
      "LAYOUT_GAP_OUT_OF_RANGE",
      "layout.gap",
      `an integer between ${minGap} and ${maxGap}`,
      `Leave the field out to use the mode's default spacing.`,
    );
  }
}

export function layoutBoardItems(
  board: SimpleBoard,
  layout: BoardLayoutInput,
  author: BoardAuthor = "human",
): SimpleBoard {
  if (layout.mode === "architecture") return layoutArchitectureBoard(board, layout, author);
  /*
   * A layout names objects, so every name has to exist.
   *
   * An unknown id used to leave an empty selection, which the filter read as
   * "no filter" and arranged the *whole* board instead of the requested subset
   * — a tidy-up that moved everything. The two numeric bounds were likewise
   * silently corrected: `columns: 0` became 1 and stacked every object on one
   * spot, and `gap: 500` was quietly reduced to 200. Bounds are rejected, not
   * repaired, everywhere else on the write path.
   */
  const knownIds = new Set(board.items.map((item) => item.id));
  for (const [index, id] of (layout.ids ?? []).entries()) {
    if (!knownIds.has(id)) {
      throw new BoardValidationError(
        `layout.ids[${index}] names ${JSON.stringify(id)}, which is not on this board`,
        "ITEM_NOT_FOUND",
        `layout.ids[${index}]`,
        "an id that exists on this board",
        `Re-read the board with get_board and list the ids you want arranged. Nothing was moved.`,
      );
    }
  }
  assertLayoutBounds(layout, { columns: [1, 12], gap: [8, 200] });
  if (layout.mode !== undefined && !LAYOUT_MODES.includes(layout.mode)) {
    throw new BoardValidationError(
      `Layout mode ${JSON.stringify(layout.mode)} is not one of ${LAYOUT_MODES.join(", ")}`,
      "INVALID_LAYOUT_MODE",
      "layout.mode",
      LAYOUT_MODES.join(", "),
      `Pick a mode from the list; "grid" is the default when the field is omitted.`,
    );
  }
  const selected = new Set(layout.ids ?? []);
  const candidates = board.items.filter((item) =>
    item.type !== "line" && (!selected.size || selected.has(item.id)));
  if (candidates.length < 2) return board;
  const sorted = [...candidates].sort((left, right) => left.y - right.y || left.x - right.x);
  const mode = layout.mode ?? "grid";
  const columns = layout.columns ?? (mode === "timeline" ? sorted.length : 3);
  const gap = layout.gap ?? 24;
  const origin = layout.origin ?? {
    x: Math.min(...sorted.map((item) => item.x)),
    y: Math.min(...sorted.map((item) => item.y)),
  };
  const maxWidth = Math.max(...sorted.map((item) => item.w));
  const maxHeight = Math.max(...sorted.map((item) => item.h));
  const cellX = (column: number) => origin.x + column * (maxWidth + gap);
  const cellY = (row: number) => origin.y + row * (maxHeight + gap);
  const updates = sorted.map((item, index) => ({
    id: item.id,
    patch: {
      x: Math.round(mode === "row" || mode === "timeline" ? cellX(index)
        : mode === "column" || mode === "cluster" ? origin.x : cellX(index % columns)),
      y: Math.round(mode === "row" || mode === "timeline" ? origin.y
        : mode === "column" ? cellY(index)
          : mode === "cluster" ? cellY(Math.floor(index / Math.max(1, Math.ceil(Math.sqrt(sorted.length)))))
            : cellY(Math.floor(index / columns))),
    },
  }));
  return updateBoardItems(board, updates, author);
}

function layoutArchitectureBoard(
  board: SimpleBoard,
  layout: BoardLayoutInput,
  author: BoardAuthor,
): SimpleBoard {
  /*
   * `architecture` has its own tighter bounds: it derives dependency layers, so
   * more than six columns stops being readable and the gap is tuned for
   * layer separation rather than a generic grid.
   */
  assertLayoutBounds(layout, { columns: [2, 6], gap: [24, 120] });
  const knownIds = new Set(board.items.map((item) => item.id));
  for (const [index, id] of (layout.ids ?? []).entries()) {
    if (!knownIds.has(id)) {
      throw new BoardValidationError(
        `layout.ids[${index}] names ${JSON.stringify(id)}, which is not on this board`,
        "ITEM_NOT_FOUND",
        `layout.ids[${index}]`,
        "an id that exists on this board",
        `Re-read the board with get_board and list the ids you want reflowed. Nothing was moved.`,
      );
    }
  }
  const selected = new Set(layout.ids ?? []);
  const nodes = board.items.filter((item) =>
    item.type !== "line" && item.type !== "stroke" && item.type !== "image"
    && (!selected.size || selected.has(item.id)));
  const connections = board.items.filter((item) => item.type === "line");
  if (!nodes.length) return board;
  const origin = layout.origin ?? { x: 40, y: 120 };
  const gap = layout.gap ?? 48;
  const columns = layout.columns ?? 4;
  const maxWidth = Math.max(...nodes.map((item) => item.w), 160);
  const maxHeight = Math.max(...nodes.map((item) => item.h), 80);
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const indegree = new Map(nodes.map((item) => [item.id, 0]));
  const outgoing = new Map(nodes.map((item) => [item.id, [] as string[]]));
  for (const line of connections) {
    if (line.startItemId && line.endItemId && byId.has(line.startItemId) && byId.has(line.endItemId)) {
      outgoing.get(line.startItemId)!.push(line.endItemId);
      indegree.set(line.endItemId, (indegree.get(line.endItemId) ?? 0) + 1);
    }
  }
  const layer = new Map<string, number>(nodes.map((item) => [item.id, 0]));
  const residual = new Map(indegree);
  const queue = nodes.filter((item) => (residual.get(item.id) ?? 0) === 0).map((item) => item.id);
  if (!queue.length && nodes.length) queue.push(nodes[0].id);
  const processed = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (processed.has(id)) continue;
    processed.add(id);
    for (const target of outgoing.get(id) ?? []) {
      layer.set(target, Math.max(layer.get(target) ?? 0, (layer.get(id) ?? 0) + 1));
      residual.set(target, Math.max(0, (residual.get(target) ?? 1) - 1));
      if ((residual.get(target) ?? 0) === 0) queue.push(target);
    }
  }
  const maxLayer = Math.max(1, ...layer.values());
  const groups = new Map<number, BoardItem[]>();
  for (const node of nodes) {
    const level = Math.min(maxLayer, layer.get(node.id) ?? 0);
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level)!.push(node);
  }
  const positions = new Map<string, BoardPoint>();
  for (const [level, group] of groups) {
    group.sort((left, right) => left.y - right.y || left.x - right.x);
    group.forEach((item, index) => {
      const row = Math.floor(index / Math.min(columns, maxLayer + 1));
      const column = index % Math.min(columns, maxLayer + 1);
      positions.set(item.id, {
        x: origin.x + level * (maxWidth + gap) + column * 24,
        y: origin.y + row * (maxHeight + gap),
      });
    });
  }
  const updates: BoardItemPatch[] = [];
  for (const node of nodes) {
    const position = positions.get(node.id)!;
    updates.push({ id: node.id, patch: { x: Math.round(position.x), y: Math.round(position.y) } });
  }
  for (const line of connections) {
    const source = line.startItemId ? positions.get(line.startItemId) : undefined;
    const target = line.endItemId ? positions.get(line.endItemId) : undefined;
    if (!source || !target) continue;
    updates.push({
      id: line.id,
      patch: {
        x: Math.round(source.x + maxWidth),
        y: Math.round(source.y + maxHeight / 2),
        w: Math.max(-MAX_LINE_DELTA_X, Math.min(MAX_LINE_DELTA_X, Math.round(target.x - source.x - maxWidth))),
        h: Math.max(-MAX_LINE_DELTA_Y, Math.min(MAX_LINE_DELTA_Y, Math.round(target.y - source.y))),
      },
    });
  }
  return updateBoardItems(board, updates, author);
}

