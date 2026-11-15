/**
 * Deterministic visual summary for agents.
 *
 * Answers "what is on this board, in reading order" without an operation log
 * and without granting write authority. Derived only from final objects, so two
 * identical boards always digest identically.
 */

import type { SimpleBoard } from "./types.js";

function shortDigestText(text: string, limit = 60): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

export function boardVisualDigest(board: SimpleBoard): Record<string, unknown> {
  const byId = new Map(board.items.map((item) => [item.id, item]));
  const labels = board.items
    .filter((item) => item.text || item.title)
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .slice(0, 12)
    .map((item) => ({
      id: item.id,
      type: item.type,
      role: item.role ?? "normal",
      title: item.title ? shortDigestText(item.title, 40) : undefined,
      text: item.text ? shortDigestText(item.text, 80) : undefined,
      author: item.author,
    }));
  const groups = [...new Set(board.items.map((item) => item.groupId).filter((id): id is string => Boolean(id)))]
    .map((id) => ({ groupId: id, itemCount: board.items.filter((item) => item.groupId === id).length }));
  const connections = board.items.filter((item) => item.type === "line").slice(0, 40).map((line) => {
    const source = line.startItemId ? byId.get(line.startItemId) : undefined;
    const target = line.endItemId ? byId.get(line.endItemId) : undefined;
    return {
      id: line.id,
      label: shortDigestText(line.text, 40),
      from: source ? shortDigestText(source.title || source.text || source.id, 50) : undefined,
      to: target ? shortDigestText(target.title || target.text || target.id, 50) : undefined,
      coordinates: !source || !target ? {
        from: { x: Math.round(line.x), y: Math.round(line.y) },
        to: { x: Math.round(line.x + line.w), y: Math.round(line.y + line.h) },
      } : undefined,
    };
  });
  const focus = board.items.filter((item) => item.emphasis === "focus").map((item) => ({
    id: item.id,
    label: shortDigestText(item.title || item.text || item.type, 60),
  }));
  return {
    version: 1,
    itemCount: board.items.length,
    readingOrder: labels,
    groups,
    connections,
    focus,
    freehandCount: board.items.filter((item) => item.type === "stroke").length,
    imageCount: board.items.filter((item) => item.type === "image").length,
    note: "Deterministic visual summary derived from final board objects; not an operation log or project-write authority.",
  };
}
