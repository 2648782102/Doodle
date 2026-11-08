export type BoardAuthor = "human" | "ai";
export type BoardItemType = "note" | "text" | "rect" | "ellipse" | "line";

export interface BoardItem {
  id: string;
  type: BoardItemType;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  author: BoardAuthor;
  createdAt: string;
  updatedAt: string;
}

export interface BoardNote {
  id: string;
  author: BoardAuthor;
  body: string;
  itemId?: string;
  createdAt: string;
}

export interface SimpleBoard {
  version: 1;
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  items: BoardItem[];
  notes: BoardNote[];
}

export interface BoardItemInput {
  id?: string;
  type: BoardItemType;
  x: number;
  y: number;
  w?: number;
  h?: number;
  text?: string;
  color?: string;
  author?: BoardAuthor;
}

const ITEM_TYPES: BoardItemType[] = ["note", "text", "rect", "ellipse", "line"];
const COLORS = ["#f6d365", "#b8e0d2", "#c7d8ff", "#ffd1dc", "#e8e8e8", "#ffffff"];
const MAX_ITEMS = 400;
const MAX_NOTES = 200;
const MAX_TEXT = 1200;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAuthor(value: unknown): value is BoardAuthor {
  return value === "human" || value === "ai";
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function now(): string {
  return new Date().toISOString();
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

export function parseBoard(value: unknown): SimpleBoard {
  if (!value || typeof value !== "object") throw new Error("Board must be an object");
  const raw = value as Partial<SimpleBoard>;
  if (raw.version !== 1) throw new Error("Unsupported board version");
  if (typeof raw.id !== "string" || typeof raw.title !== "string") throw new Error("Invalid board identity");
  if (!isFiniteNumber(raw.revision) || raw.revision < 0) throw new Error("Invalid board revision");
  if (!Array.isArray(raw.items) || !Array.isArray(raw.notes)) throw new Error("Invalid board collections");
  if (raw.items.length > MAX_ITEMS || raw.notes.length > MAX_NOTES) throw new Error("Board is too large");
  const items = raw.items.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid board item");
    const candidate = item as Partial<BoardItem>;
    if (typeof candidate.id !== "string" || !ITEM_TYPES.includes(candidate.type as BoardItemType))
      throw new Error("Invalid board item type");
    if (![candidate.x, candidate.y, candidate.w, candidate.h].every(isFiniteNumber))
      throw new Error("Board item coordinates must be finite");
    if (typeof candidate.text !== "string" || typeof candidate.color !== "string")
      throw new Error("Invalid board item fields");
    if (!isAuthor(candidate.author)) throw new Error("Invalid board item author");
    return {
      id: candidate.id,
      type: candidate.type as BoardItemType,
      x: candidate.x as number,
      y: candidate.y as number,
      w: candidate.w as number,
      h: candidate.h as number,
      text: candidate.text,
      color: candidate.color,
      author: candidate.author,
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : now(),
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : now(),
    };
  });
  const notes = raw.notes.map((note) => {
    if (!note || typeof note !== "object") throw new Error("Invalid board note");
    const candidate = note as Partial<BoardNote>;
    if (typeof candidate.id !== "string" || typeof candidate.body !== "string" || !isAuthor(candidate.author))
      throw new Error("Invalid board note fields");
    return {
      id: candidate.id,
      author: candidate.author,
      body: candidate.body,
      itemId: typeof candidate.itemId === "string" ? candidate.itemId : undefined,
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : now(),
    };
  });
  return {
    version: 1,
    id: raw.id,
    title: raw.title,
    revision: raw.revision,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now(),
    items,
    notes,
  };
}

function normalizeItem(input: BoardItemInput): Omit<BoardItem, "createdAt" | "updatedAt"> {
  if (!input || typeof input !== "object") throw new Error("Invalid item input");
  if (!ITEM_TYPES.includes(input.type)) throw new Error("Unknown item type");
  if (![input.x, input.y].every(isFiniteNumber)) throw new Error("Item coordinates must be finite");
  if (input.w !== undefined && !isFiniteNumber(input.w)) throw new Error("Item width must be finite");
  if (input.h !== undefined && !isFiniteNumber(input.h)) throw new Error("Item height must be finite");
  const width = Math.max(16, Math.min(2000, input.w ?? (input.type === "line" ? 180 : 180)));
  const height = Math.max(16, Math.min(1200, input.h ?? (input.type === "line" ? 24 : 120)));
  const signedWidth = input.type === "line" && input.w !== undefined
    ? Math.max(-2000, Math.min(2000, input.w))
    : width;
  const signedHeight = input.type === "line" && input.h !== undefined
    ? Math.max(-1200, Math.min(1200, input.h))
    : height;
  const text = (input.text ?? "").slice(0, MAX_TEXT);
  if (text.length > MAX_TEXT) throw new Error("Item text is too long");
  const color = input.color && /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : COLORS[0];
  const author = isAuthor(input.author) ? input.author : "human";
  if (input.type === "line" && signedWidth === 0 && signedHeight === 0) throw new Error("Line needs a direction");
  return {
    id: input.id?.trim() || makeId("item"),
    type: input.type,
    x: Math.max(-100000, Math.min(100000, input.x)),
    y: Math.max(-100000, Math.min(100000, input.y)),
    w: signedWidth,
    h: signedHeight,
    text,
    color,
    author,
  };
}

export function addBoardItem(board: SimpleBoard, input: BoardItemInput): SimpleBoard {
  const normalized = normalizeItem(input);
  if (board.items.length >= MAX_ITEMS) throw new Error("Board item limit reached");
  const timestamp = now();
  const item: BoardItem = { ...normalized, createdAt: timestamp, updatedAt: timestamp };
  return touchBoard({ ...board, items: [...board.items, item] });
}

export function updateBoardItem(board: SimpleBoard, id: string, patch: Partial<BoardItemInput>): SimpleBoard {
  const existing = board.items.find((item) => item.id === id);
  if (!existing) throw new Error("Board item not found");
  const normalized = normalizeItem({ ...existing, ...patch, id });
  const timestamp = now();
  return touchBoard({
    ...board,
    items: board.items.map((item) => item.id === id
      ? { ...normalized, createdAt: existing.createdAt, updatedAt: timestamp }
      : item),
  });
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

export function touchBoard(board: SimpleBoard): SimpleBoard {
  return { ...board, revision: board.revision + 1, updatedAt: now() };
}

export function boardCopyText(board: SimpleBoard): string {
  const items = board.items.map((item) => `- ${item.type} · ${item.text || "(空)"} · ${item.author} · ${Math.round(item.x)},${Math.round(item.y)}`);
  const notes = board.notes.slice(-12).map((note) => `- ${note.author}: ${note.body}`);
  return [
    `AI Draw Board · ${board.title} · revision ${board.revision}`,
    `画布对象 ${board.items.length}`,
    ...items,
    `最近留言 ${Math.min(board.notes.length, 12)}`,
    ...notes,
  ].join("\n");
}
