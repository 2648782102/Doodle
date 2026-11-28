/**
 * Board library schema: the index shape, entry projection, and validation.
 *
 * One saved board is one version 1 snapshot plus a name. The index is a small
 * ordered list of those entries with the active id, validated as strictly as
 * the board itself so a truncated write cannot silently drop a board.
 */

import { createEmptyBoard, parseBoard, type SimpleBoard } from "../types.js";
import { makeId, now } from "../model/clock.js";

export interface BoardLibraryEntry {
  id: string;
  name: string;
  version: 1;
  revision: number;
  itemCount: number;
  updatedAt: string;
  active: boolean;
}

export interface BoardLibraryIndex {
  version: 1;
  activeId: string;
  boards: BoardLibraryEntry[];
}

export interface BoardLibraryDetail {
  index: BoardLibraryIndex;
  board: SimpleBoard;
}

export interface BoardLibraryMutation {
  index: BoardLibraryIndex;
  board: SimpleBoard;
  previousRevision?: number;
}

export type BoardLibraryAction =
  | { type: "list" }
  | { type: "get"; id?: string }
  | { type: "create"; name?: string; switchTo?: boolean }
  | { type: "save"; name?: string; id?: string; switchTo?: boolean; board?: unknown }
  | { type: "switch"; id: string }
  | { type: "rename"; id: string; name: string }
  | { type: "duplicate"; id: string; name?: string; switchTo?: boolean }
  | { type: "delete"; id: string }
  | { type: "import"; name?: string; board: unknown; switchTo?: boolean }
  | { type: "export"; id?: string };

export const MAX_LIBRARY_BOARDS = 80;
export const MAX_BOARD_NAME = 80;


export function safeId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error("Invalid board library ID");
  return value;
}

export function normalizeName(value: unknown, fallback: string): string {
  const name = typeof value === "string" ? cutAtCharacter(value.trim(), MAX_BOARD_NAME) : "";
  return name || fallback;
}

/**
 * The first `limit` characters of `text`, counted as a reader counts them.
 *
 * `slice` counts UTF-16 code units, so a limit that lands inside an astral
 * character (an emoji, a rare ideograph) keeps its high surrogate and drops the
 * low one. The result is half a character: it renders as a replacement glyph and
 * no other reader can turn it back into what was typed. Cutting by code point
 * and dropping a whole character is the honest overflow, and the stored name
 * still never exceeds the limit `slice` was there to enforce.
 */
function cutAtCharacter(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let out = "";
  for (const character of text) {
    if (out.length + character.length > limit) break;
    out += character;
  }
  return out;
}

export function entryFromBoard(board: SimpleBoard, name: string, active: boolean): BoardLibraryEntry {
  return {
    id: board.id,
    name,
    version: 1,
    revision: board.revision,
    itemCount: board.items.length,
    updatedAt: board.updatedAt,
    active,
  };
}

export function newBoard(name: string): SimpleBoard {
  return { ...createEmptyBoard(), title: name };
}

export function normalizeBoardSnapshot(value: unknown): SimpleBoard {
  const raw = value && typeof value === "object" ? value as Partial<SimpleBoard> : {};
  return parseBoard({ ...raw, version: raw.version ?? 1, notes: raw.notes ?? [] });
}

export function makeIndex(activeId: string, boards: BoardLibraryEntry[]): BoardLibraryIndex {
  return { version: 1, activeId, boards };
}

export function parseIndex(value: unknown): BoardLibraryIndex {
  if (!value || typeof value !== "object") throw new Error("Board library index must be an object");
  const raw = value as Partial<BoardLibraryIndex>;
  if (raw.version !== 1 || typeof raw.activeId !== "string" || !Array.isArray(raw.boards))
    throw new Error("Invalid board library index");
  const ids = new Set<string>();
  const boards = raw.boards.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new Error("Invalid board library entry");
    const entry = candidate as BoardLibraryEntry;
    safeId(entry.id);
    if (ids.has(entry.id)) throw new Error("Duplicate board library ID");
    ids.add(entry.id);
    if (typeof entry.name !== "string" || typeof entry.updatedAt !== "string"
      || !Number.isFinite(entry.revision) || !Number.isFinite(entry.itemCount))
      throw new Error("Invalid board library entry fields");
    return { ...entry, active: entry.id === raw.activeId };
  });
  if (!ids.has(raw.activeId)) throw new Error("Active board is missing from the library");
  return makeIndex(raw.activeId, boards);
}

