/**
 * Human- and model-readable report of what a write changed.
 *
 * A tool reply that only says "updated" forces the agent to issue another
 * `get_board` just to explain its own action. This report is derived from the
 * before/after board with the same delta logic used by `get_board`, so the text
 * and the structured snapshot cannot disagree.
 */

import { boardAgentDelta, summarizeAgentBoard } from "../agent-view.js";
import type { SimpleBoard } from "../types.js";

function short(item: { id: string; type: string; text?: string; title?: string }): string {
  const label = (item.title || item.text || item.type).replace(/\s+/g, " ").trim();
  return label.length > 40 ? `${label.slice(0, 39)}…` : label;
}

export function changeReport(before: SimpleBoard, after: SimpleBoard): Record<string, unknown> {
  const delta = boardAgentDelta(after, before);
  return {
    baseRevision: delta.baseRevision,
    revision: delta.revision,
    added: delta.added.map((item) => `${item.type}:${short(item)}`),
    updated: delta.updated.map((item) => `${item.type}:${short(item)}`),
    removed: delta.removed,
    summary: summarizeAgentBoard(after),
    note: "Final-state change report; an operation summary, not an operation log.",
  };
}

export function changeReportText(report: Record<string, unknown>): string {
  const added = report.added as string[];
  const updated = report.updated as string[];
  const removed = report.removed as string[];
  return [
    // Compact on purpose: the same report is already in `structuredContent`,
    // so the text copy only needs to be parseable, not pretty.
    `CHANGE_JSON: ${JSON.stringify(report)}`,
    `CHANGED: 新增 ${added.length} · 更新 ${updated.length} · 删除 ${removed.length}`,
  ].join("\n");
}
