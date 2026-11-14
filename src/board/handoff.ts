/**
 * "What did the person change since I last looked?"
 *
 * A board is a conversation, and the agent's half of it is knowing which of its
 * own drawings a person picked up. `visualDigest` describes the current state;
 * this describes the handoff between two states, attributed to authors, so the
 * agent can answer "you moved this" instead of redrawing the whole board.
 */

import type { BoardAuthor, BoardItem, SimpleBoard } from "./types.js";

const EDIT_LIMIT = 12;
const TEXT_LIMIT = 60;

export type HandoffChange = "added" | "edited" | "removed";

export interface HandoffEdit {
  id: string;
  change: HandoffChange;
  author: BoardAuthor;
  /** Persisted fields that differ; for a removal this is empty. */
  fields: string[];
  /** Final values, clipped, so the agent never needs a second read to see them. */
  now?: {
    type: string;
    text?: string;
    title?: string;
    x: number;
    y: number;
  };
}

export interface BoardHandoff {
  baseRevision: number;
  revision: number;
  needsAttention: boolean;
  humanEdits: HandoffEdit[];
  omitted: number;
  summary: string;
  note: string;
}

/**
 * One line telling the agent what to do next.
 *
 * The board already knows whether a person is waiting on it. A fixed "read the
 * board again" hint wastes a turn when nothing changed, and under-describes the
 * case that matters: a person just edited something.
 */
export function handoffNextStep(handoff: BoardHandoff): string {
  if (!handoff.needsAttention) {
    return `NEXT: 人没有改动，不必重画或复述。需要更多对象时省略 since_revision 重读；下次差量基准为 ${handoff.revision}。`;
  }
  const edited = handoff.humanEdits.filter((edit) => edit.change === "edited").length;
  const added = handoff.humanEdits.filter((edit) => edit.change === "added").length;
  const removed = handoff.humanEdits.filter((edit) => edit.change === "removed").length;
  const kinds = [
    edited ? `${edited} 处修改` : "",
    added ? `${added} 处新增` : "",
    removed ? `${removed} 处删除` : "",
  ].filter(Boolean).join("、");
  return `NEXT: 人改动了 ${kinds}。先回应这些改动（改字、挪位、补图都可以），除非人的改动明显有误；下次差量基准为 ${handoff.revision}。`;
}

const COMPARED_FIELDS: Array<keyof BoardItem> = [
  "type", "x", "y", "w", "h", "text", "color", "title", "shape", "groupId",
  "emphasis", "variant", "role", "z", "startItemId", "endItemId", "author",
];

function clip(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= TEXT_LIMIT ? normalized : `${normalized.slice(0, TEXT_LIMIT - 1)}…`;
}

function changedFields(before: BoardItem, after: BoardItem): string[] {
  const fields: string[] = [];
  for (const field of COMPARED_FIELDS) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) fields.push(field);
  }
  return fields;
}

function nowOf(item: BoardItem): HandoffEdit["now"] {
  return {
    type: item.type,
    ...(item.text ? { text: clip(item.text) } : {}),
    ...(item.title ? { title: clip(item.title) } : {}),
    x: Math.round(item.x),
    y: Math.round(item.y),
  };
}

/**
 * Attribute changes between two boards.
 *
 * Only human-attributed changes are reported: telling the agent to review its
 * own last write is pure noise. A change counts as human when the item's author
 * is `human` now, or when an AI item disappeared (the person deleted it).
 */
export function describeHandoff(
  current: SimpleBoard,
  previous: SimpleBoard | null | undefined,
): BoardHandoff {
  const before = new Map((previous?.items ?? []).map((item) => [item.id, item]));
  const after = new Map(current.items.map((item) => [item.id, item]));
  const edits: HandoffEdit[] = [];

  for (const [id, item] of after) {
    const old = before.get(id);
    if (!old) {
      if (item.author === "human") {
        edits.push({ id, change: "added", author: "human", fields: ["__new"], now: nowOf(item) });
      }
      continue;
    }
    const fields = changedFields(old, item);
    if (!fields.length) continue;
    if (item.author === "human") {
      edits.push({ id, change: "edited", author: "human", fields, now: nowOf(item) });
    }
  }
  for (const [id, old] of before) {
    if (!after.has(id) && old.author === "human") {
      edits.push({ id, change: "removed", author: "human", fields: [] });
    }
  }

  const omitted = Math.max(0, edits.length - EDIT_LIMIT);
  const visible = edits.slice(0, EDIT_LIMIT);
  const needsAttention = visible.length > 0;
  const summary = needsAttention
    ? `人改动了 ${edits.length} 处：新增 ${count(edits, "added")} · 修改 ${count(edits, "edited")} · 删除 ${count(edits, "removed")}。`
    : "自上一版本以来人没有改动；画板只包含 AI 自己的变化或完全没变。";

  return {
    baseRevision: previous?.revision ?? 0,
    revision: current.revision,
    needsAttention,
    humanEdits: visible,
    omitted,
    summary,
    note: "Human-attributed final-state differences only; not a click or operation log, and never an instruction to change code.",
  };
}

function count(edits: HandoffEdit[], change: HandoffChange): number {
  return edits.filter((edit) => edit.change === change).length;
}
