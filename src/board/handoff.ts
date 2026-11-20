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
  /** What the changes appear to mean, so the agent can respond to intent. */
  readings: HandoffReading[];
  note: string;
}

export type HandoffKind =
  | "relabel"
  | "move"
  | "resize"
  | "restyle"
  | "reorder"
  | "add-note"
  | "remove"
  | "edit";

export interface HandoffReading {
  id: string;
  kind: HandoffKind;
  /** Plain-language line the agent can quote or act on. */
  reading: string;
  /** A concrete, bounded suggestion - never an instruction to change code. */
  suggestion?: string;
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
  const lead = handoff.readings[0];
  const detail = lead ? `最要紧的是：${lead.reading}。${lead.suggestion ?? ""}` : "";
  return `NEXT: 人改动了 ${kinds}。${detail}先回应这些改动，除非人的改动明显有误；下次差量基准为 ${handoff.revision}。`;
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

/** Order the readings by how much they change the meaning of the board. */
const KIND_PRIORITY: HandoffKind[] = [
  "relabel", "add-note", "remove", "resize", "move", "restyle", "reorder", "edit",
];

function delta(previous: number, next: number): number {
  return Math.round(next - previous);
}

function direction(dx: number, dy: number): string {
  const horizontal = Math.abs(dx) < 8 ? "" : dx > 0 ? "右" : "左";
  const vertical = Math.abs(dy) < 8 ? "" : dy > 0 ? "下" : "上";
  return `${vertical}${horizontal}` || "原地";
}

function label(item: BoardItem): string {
  return clip(item.title || item.text || item.type);
}

/**
 * Turn a raw field diff into what the person probably meant.
 *
 * The agent can already see which fields changed; what it cannot see is
 * salience. A rename is usually a correction of meaning, a move is usually a
 * layout preference, and a colour change is usually emphasis. Reading them in
 * that order lets the agent respond to the intent instead of listing diffs.
 */
function readEdit(before: BoardItem, after: BoardItem): HandoffReading | undefined {
  const textChanged = before.text !== after.text || before.title !== after.title;
  const moved = delta(before.x, after.x) !== 0 || delta(before.y, after.y) !== 0;
  const resized = delta(before.w, after.w) !== 0 || delta(before.h, after.h) !== 0;
  const restyled = before.color !== after.color
    || JSON.stringify(before.style) !== JSON.stringify(after.style)
    || before.variant !== after.variant
    || before.emphasis !== after.emphasis;

  if (textChanged) {
    const was = clip(before.text || before.title || "");
    const now = clip(after.text || after.title || "");
    return {
      id: after.id,
      kind: "relabel",
      reading: was
        ? `把「${was}」改成了「${now}」，这是含义上的修正`
        : `给这个对象补了文字「${now}」`,
      suggestion: `按新的说法「${now}」调整周边标签或说明，保持一致。`,
    };
  }
  if (resized) {
    const width = delta(before.w, after.w);
    const height = delta(before.h, after.h);
    return {
      id: after.id,
      kind: "resize",
      reading: `把「${label(after)}」从 ${Math.round(before.w)}×${Math.round(before.h)} 改成了 ${Math.round(after.w)}×${Math.round(after.h)}`
        + `（${width >= 0 ? "变宽" : "变窄"}、${height >= 0 ? "变高" : "变矮"}），在强调或弱化这块内容`,
      suggestion: `检查「${label(after)}」变大后是否压住了相邻对象，必要时重新排布。`,
    };
  }
  if (moved) {
    const dx = delta(before.x, after.x);
    const dy = delta(before.y, after.y);
    return {
      id: after.id,
      kind: "move",
      reading: `把「${label(after)}」向${direction(dx, dy)}移动了（${dx >= 0 ? "+" : ""}${dx}, ${dy >= 0 ? "+" : ""}${dy}），这是布局偏好`,
      suggestion: `保持这个新位置，不要自动还原；如需整理，先问人是否要重排。`,
    };
  }
  if (restyled) {
    return {
      id: after.id,
      kind: "restyle",
      reading: `改了「${label(after)}」的样式（颜色或强调），在突出它`,
      suggestion: `让其他对象继续保持次要，别用同样强的样式抢焦点。`,
    };
  }
  if (before.z !== after.z) {
    return {
      id: after.id,
      kind: "reorder",
      reading: `调整了「${label(after)}」的层级，它现在更靠${(after.z ?? 0) > (before.z ?? 0) ? "上" : "下"}层`,
    };
  }
  return undefined;
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
  const readings: HandoffReading[] = [];

  for (const [id, item] of after) {
    const old = before.get(id);
    if (!old) {
      if (item.author === "human") {
        edits.push({ id, change: "added", author: "human", fields: ["__new"], now: nowOf(item) });
        readings.push({
          id,
          kind: "add-note",
          reading: `新增了「${label(item)}」，是想补上一块内容`,
          suggestion: `先回应这块新内容；如果它与已有对象重叠，画的时候让开。`,
        });
      }
      continue;
    }
    const fields = changedFields(old, item);
    if (!fields.length) continue;
    if (item.author === "human") {
      edits.push({ id, change: "edited", author: "human", fields, now: nowOf(item) });
      const reading = readEdit(old, item);
      if (reading) readings.push(reading);
    }
  }
  for (const [id, old] of before) {
    if (!after.has(id)) {
      edits.push({ id, change: "removed", author: "human", fields: [] });
      readings.push({
        id,
        kind: "remove",
        reading: `删掉了「${label(old)}」`,
        suggestion: `接受这个删除，不要把它画回来，除非人明确要求。`,
      });
    }
  }

  readings.sort((left, right) => KIND_PRIORITY.indexOf(left.kind) - KIND_PRIORITY.indexOf(right.kind));

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
    readings: readings.slice(0, EDIT_LIMIT),
    note: "Human-attributed final-state differences only; not a click or operation log, and never an instruction to change code.",
  };
}

function count(edits: HandoffEdit[], change: HandoffChange): number {
  return edits.filter((edit) => edit.change === change).length;
}
