/**
 * Deterministic visual diagnosis for agents.
 *
 * `boardVisualDigest` says what is on the board. This module says what an agent
 * should notice before editing it: which objects are isolated, which overlap,
 * where the current focus is, and where there is room to add something. Every
 * field is bounded and derived only from final Board v1 objects, so it stays
 * cheap to read and safe to use as model context.
 */

import type { BoardItem, SimpleBoard } from "./types.js";

const MAX_ITEMS = 12;
const MAX_ISSUES = 20;
const MAX_NAME = 60;

function label(item: BoardItem): string {
  const text = (item.title || item.text || item.type).replace(/\s+/g, " ").trim();
  return text.length <= MAX_NAME ? text : `${text.slice(0, MAX_NAME - 1)}…`;
}

function center(item: BoardItem): { x: number; y: number } {
  return { x: Math.round(item.x + item.w / 2), y: Math.round(item.y + item.h / 2) };
}

function overlaps(left: BoardItem, right: BoardItem): boolean {
  const padding = 2;
  return left.x < right.x + right.w - padding
    && left.x + left.w > right.x + padding
    && left.y < right.y + right.h - padding
    && left.y + left.h > right.y + padding;
}

export function diagnoseBoard(board: SimpleBoard): Record<string, unknown> {
  const byId = new Map(board.items.map((item) => [item.id, item]));
  // Frames and labels are layout furniture, not content nodes. Counting them as
  // nodes made every generated diagram report its own frame as isolated and
  // overlapping with each real step.
  const nodes = board.items.filter((item) =>
    item.type !== "line"
    && item.type !== "stroke"
    && item.role !== "frame"
    && item.role !== "label");
  const lines = board.items.filter((item) => item.type === "line");
  const connected = new Set<string>();
  for (const line of lines) {
    if (line.startItemId && byId.has(line.startItemId)) connected.add(line.startItemId);
    if (line.endItemId && byId.has(line.endItemId)) connected.add(line.endItemId);
  }

  const isolated = nodes
    .filter((item) => !connected.has(item.id))
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .slice(0, MAX_ITEMS)
    .map((item) => ({ id: item.id, label: label(item), type: item.type, ...center(item) }));

  const overlapping: Array<Record<string, unknown>> = [];
  for (let index = 0; index < nodes.length && overlapping.length < MAX_ISSUES; index += 1) {
    for (let other = index + 1; other < nodes.length && overlapping.length < MAX_ISSUES; other += 1) {
      if (overlaps(nodes[index], nodes[other])) {
        overlapping.push({
          a: { id: nodes[index].id, label: label(nodes[index]) },
          b: { id: nodes[other].id, label: label(nodes[other]) },
        });
      }
    }
  }

  const focus = board.items
    .filter((item) => item.emphasis === "focus")
    .slice(0, MAX_ITEMS)
    .map((item) => ({ id: item.id, label: label(item), ...center(item) }));

  const unresolved = lines
    .filter((line) => (line.startItemId && !byId.has(line.startItemId)) || (line.endItemId && !byId.has(line.endItemId)))
    .slice(0, MAX_ITEMS)
    .map((line) => ({ id: line.id, label: label(line), startItemId: line.startItemId, endItemId: line.endItemId }));

  const bounds = (() => {
    if (!board.items.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return {
      minX: Math.round(Math.min(...board.items.map((item) => item.x))),
      minY: Math.round(Math.min(...board.items.map((item) => item.y))),
      maxX: Math.round(Math.max(...board.items.map((item) => item.x + item.w))),
      maxY: Math.round(Math.max(...board.items.map((item) => item.y + item.h))),
    };
  })();

  const freeSpace = {
    below: { x: bounds.minX, y: bounds.maxY + 60, note: "Candidate area for an additional group; verify against current view." },
    right: { x: bounds.maxX + 60, y: bounds.minY, note: "Candidate area for another column; verify against current view." },
  };

  return {
    version: 1,
    itemCount: board.items.length,
    nodeCount: nodes.length,
    lineCount: lines.length,
    bounds,
    focus,
    isolated,
    overlapping,
    unresolved,
    freeSpace,
    occupancyCount: board.items.length,
    note: "Deterministic bounded diagnosis derived from final Board v1 objects; advisory only, never write authority.",
  };
}
