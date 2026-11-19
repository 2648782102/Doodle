/**
 * Board construction and item-level mutation.
 *
 * Every mutation goes through `touchBoard`, so a revision always increases and
 * `updatedAt` always moves. That invariant is what makes the optimistic
 * revision check in `store.ts` and the delta projection in `agent-view.ts`
 * trustworthy.
 */

import { MAX_ITEMS, MAX_NOTES, MAX_TEXT } from "./limits.js";
import type {
  BoardAuthor, BoardItem, BoardItemInput, BoardItemPatch, BoardNote, SimpleBoard,
} from "./types.js";
import { makeId, now } from "./clock.js";
import { isAuthor, normalizeItem, parseBoard } from "./validate.js";
import { BoardValidationError } from "../errors.js";

export function touchBoard(board: SimpleBoard): SimpleBoard {
  return { ...board, revision: board.revision + 1, updatedAt: now() };
}

/**
 * The capacity ceiling is a bound, so it owes the caller a repair.
 *
 * "Board item limit reached" told a model nothing it could act on: not how many
 * objects exist, not how many it tried to add, and not that the answer is a
 * second board. The reply now carries all three.
 */
function itemLimitError(existing: number, adding: number): BoardValidationError {
  return new BoardValidationError(
    `Board holds ${existing} objects; adding ${adding} would exceed the ${MAX_ITEMS} limit`,
    "BOARD_ITEM_LIMIT",
    "items",
    `at most ${MAX_ITEMS} objects on one board`,
    `Remove objects with remove_ids, or put the extra content on a second board: draw_board.library {type: "create", switchTo: false} then draw there.`,
  );
}

export function createEmptyBoard(): SimpleBoard {
  const timestamp = now();
  return {
    version: 1,
    id: makeId("board"),
    title: "和 AI 一起画",
    revision: 0,
    updatedAt: timestamp,
    items: [],
    notes: [],
  };
}

export function createStarterBoard(): SimpleBoard {
  const timestamp = now();
  const authorStamp = `starter_${timestamp}`;
  const title = "Doodle · 和 AI 一起画";
  const items: BoardItem[] = [
    {
      id: "starter_title", type: "text", x: 40, y: 36, w: 560, h: 44,
      text: "Doodle · 人和 AI 的共享画板", color: "#ffffff", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_hint", type: "text", x: 40, y: 82, w: 680, h: 32,
      text: "画一个对象或写一句短标签，AI 会从同一张画布继续", color: "#ffffff", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_human", type: "note", x: 40, y: 150, w: 210, h: 120,
      text: "人\n在这里随手画", color: "#f6d365", author: "human",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_board", type: "rect", x: 330, y: 150, w: 230, h: 120,
      text: "同一张无限画布", color: "#c7d8ff", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_ai", type: "note", x: 640, y: 150, w: 210, h: 120,
      text: "AI\n用 MCP 读 / 画", color: "#b8e0d2", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_arrow_human", type: "line", x: 250, y: 210, w: 70, h: 0,
      text: "画", color: "#64748b", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_arrow_ai", type: "line", x: 560, y: 210, w: 70, h: 0,
      text: "读 / 画", color: "#64748b", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_loop", type: "text", x: 40, y: 320, w: 810, h: 32,
      text: "get_board  →  show_board / draw_board  →  人继续画", color: "#ffffff", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_boundary", type: "text", x: 40, y: 370, w: 810, h: 32,
      text: "项目结构只是可画的主题之一；画板不写项目文件", color: "#ffffff", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
  ];
  const notes: BoardNote[] = [{
    id: `note_${authorStamp}`,
    author: "ai",
    body: "欢迎来到 Doodle。随手画，AI 会从同一张画布继续。",
    createdAt: timestamp,
  }];
  return { version: 1, id: `board_${authorStamp}`, title, revision: 0, updatedAt: timestamp, items, notes };
}


export function addBoardItem(board: SimpleBoard, input: BoardItemInput): SimpleBoard {
  const normalized = normalizeItem(input);
  if (board.items.length >= MAX_ITEMS) throw itemLimitError(board.items.length, 1);
  const timestamp = now();
  const item: BoardItem = { ...normalized, createdAt: timestamp, updatedAt: timestamp };
  return touchBoard({ ...board, items: [...board.items, item] });
}

export function updateBoardItem(
  board: SimpleBoard,
  id: string,
  patch: Partial<BoardItemInput>,
  author: BoardAuthor = "human",
): SimpleBoard {
  const existing = board.items.find((item) => item.id === id);
  if (!existing) {
    throw new BoardValidationError(
      `No item has the id ${JSON.stringify(id)}`,
      "ITEM_NOT_FOUND",
      "updates[].id",
      "an id that exists on this board",
      `Re-read the board with get_board and use one of its item ids; ids are not recreated between calls.`,
    );
  }
  const normalized = normalizeItem({ ...existing, ...patch, id, author });
  const timestamp = now();
  return touchBoard({
    ...board,
    items: board.items.map((item) => item.id === id
      ? { ...normalized, createdAt: existing.createdAt, updatedAt: timestamp }
      : item),
  });
}

export function addBoardItems(board: SimpleBoard, inputs: BoardItemInput[]): SimpleBoard {
  if (board.items.length + inputs.length > MAX_ITEMS) throw itemLimitError(board.items.length, inputs.length);
  const timestamp = now();
  const items = inputs.map((input) => {
    const normalized = normalizeItem(input);
    return { ...normalized, createdAt: timestamp, updatedAt: timestamp } satisfies BoardItem;
  });
  return touchBoard({ ...board, items: [...board.items, ...items] });
}

export function updateBoardItems(
  board: SimpleBoard,
  updates: BoardItemPatch[],
  author: BoardAuthor = "human",
): SimpleBoard {
  /*
   * Every requested update must name a real item.
   *
   * This looped over the *board* and looked each item up in the patch map, so
   * an update for an id that does not exist was silently dropped while the
   * call still reported success. A model revising five labels and mistyping one
   * id would be told all five landed. Checking the request instead of the board
   * is what makes the report honest.
   */
  const knownIds = new Set(board.items.map((item) => item.id));
  for (const [index, update] of updates.entries()) {
    if (!knownIds.has(update.id)) {
      throw new BoardValidationError(
        `Update ${index} targets ${JSON.stringify(update.id)}, which is not on this board`,
        "ITEM_NOT_FOUND",
        `updates[${index}].id`,
        "an id that exists on this board",
        `Re-read the board with get_board and use one of its item ids. Nothing was written; re-send the whole batch with the corrected id.`,
      );
    }
  }
  const patches = new Map(updates.map((update) => [update.id, update.patch]));
  const timestamp = now();
  const items = board.items.map((item) => {
    const patch = patches.get(item.id);
    if (!patch) return item;
    const normalized = normalizeItem({ ...item, ...patch, id: item.id, author });
    return { ...normalized, createdAt: item.createdAt, updatedAt: timestamp };
  });
  return touchBoard({ ...board, items });
}

export function removeBoardItems(board: SimpleBoard, ids: string[]): SimpleBoard {
  /*
   * A removal that silently skips an unknown id reports a cleanup that did not
   * happen. Name the missing id instead, with its position in the request.
   */
  const presentIds = new Set(board.items.map((item) => item.id));
  for (const [index, id] of ids.entries()) {
    if (!presentIds.has(id)) {
      throw new BoardValidationError(
        `remove_ids[${index}] names ${JSON.stringify(id)}, which is not on this board`,
        "ITEM_NOT_FOUND",
        `remove_ids[${index}]`,
        "an id that exists on this board",
        `Re-read the board with get_board and use one of its item ids. Nothing was removed.`,
      );
    }
  }
  const removeSet = new Set(ids);
  return touchBoard({
    ...board,
    items: board.items.filter((item) => !removeSet.has(item.id)),
    notes: board.notes.map((note) => note.itemId && removeSet.has(note.itemId) ? { ...note, itemId: undefined } : note),
  });
}

export function replaceBoardContent(current: SimpleBoard, incoming: unknown): SimpleBoard {
  const parsed = parseBoard(incoming);
  return touchBoard({ ...parsed, id: current.id, title: current.title, revision: current.revision });
}


export function removeBoardItem(board: SimpleBoard, id: string): SimpleBoard {
  if (!board.items.some((item) => item.id === id)) throw new Error("Board item not found");
  return touchBoard({
    ...board,
    items: board.items.filter((item) => item.id !== id),
    notes: board.notes.map((note) => note.itemId === id ? { ...note, itemId: undefined } : note),
  });
}

export function addBoardNote(
  board: SimpleBoard,
  input: { body: string; author: BoardAuthor; itemId?: string },
): SimpleBoard {
  const body = input.body.trim().slice(0, MAX_TEXT);
  if (!body) throw new Error("Note body is required");
  if (!isAuthor(input.author)) throw new Error("Invalid note author");
  if (input.itemId && !board.items.some((item) => item.id === input.itemId))
    throw new Error("Referenced board item not found");
  if (board.notes.length >= MAX_NOTES) throw new Error("Board note limit reached");
  const note: BoardNote = {
    id: makeId("note"),
    author: input.author,
    body,
    itemId: input.itemId,
    createdAt: now(),
  };
  return touchBoard({ ...board, notes: [...board.notes, note] });
}

export function boardCopyText(board: SimpleBoard): string {
  const items = board.items.map((item) => {
    const label = item.title ? `${item.title}：${item.text}` : item.text;
    const extra = item.type === "image" ? " · 图片" : item.type === "stroke" ? " · 手绘" : item.shape && item.type === "line" && item.shape !== "straight" ? ` · ${item.shape}` : "";
    return `- ${item.type} · ${label || "(空)"} · ${item.author} · ${Math.round(item.x)},${Math.round(item.y)}${extra}`;
  });
  const notes = board.notes.slice(-12).map((note) => `- ${note.author}: ${note.body}`);
  return [
    `Doodle · ${board.title} · revision ${board.revision}`,
    `画布对象 ${board.items.length}`,
    ...items,
    `最近留言 ${Math.min(board.notes.length, 12)}`,
    ...notes,
  ].join("\n");
}

function shortDigestText(text: string, limit = 60): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

