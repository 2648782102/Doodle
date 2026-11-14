import fs from "node:fs/promises";
import path from "node:path";
import { AsyncMutex } from "./mutex.js";
import { createEmptyBoard, parseBoard, touchBoard, type SimpleBoard } from "./types.js";

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

const MAX_LIBRARY_BOARDS = 80;
const MAX_BOARD_NAME = 80;

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function now(): string {
  return new Date().toISOString();
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error("Invalid board library ID");
  return value;
}

function normalizeName(value: unknown, fallback: string): string {
  const name = typeof value === "string" ? value.trim().slice(0, MAX_BOARD_NAME) : "";
  return name || fallback;
}

function entryFromBoard(board: SimpleBoard, name: string, active: boolean): BoardLibraryEntry {
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

function newBoard(name: string): SimpleBoard {
  return { ...createEmptyBoard(), title: name };
}

export function normalizeBoardSnapshot(value: unknown): SimpleBoard {
  const raw = value && typeof value === "object" ? value as Partial<SimpleBoard> : {};
  return parseBoard({ ...raw, version: raw.version ?? 1, notes: raw.notes ?? [] });
}

function makeIndex(activeId: string, boards: BoardLibraryEntry[]): BoardLibraryIndex {
  return { version: 1, activeId, boards };
}

function parseIndex(value: unknown): BoardLibraryIndex {
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

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temp, file);
}

export class BoardLibrary {
  private readonly directory: string;
  private readonly indexFile: string;
  private readonly mutex: AsyncMutex;

  constructor(outputDir: string) {
    this.directory = path.join(outputDir, ".doodle", "boards");
    this.indexFile = path.join(this.directory, "index.json");
    this.mutex = new AsyncMutex(this.indexFile);
  }

  private boardFile(id: string): string {
    return path.join(this.directory, `${safeId(id)}.json`);
  }

  private async readIndex(): Promise<BoardLibraryIndex> {
    try {
      return parseIndex(JSON.parse(await fs.readFile(this.indexFile, "utf8")));
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      return makeIndex("", []);
    }
  }

  private async readBoard(id: string): Promise<SimpleBoard> {
    return normalizeBoardSnapshot(JSON.parse(await fs.readFile(this.boardFile(id), "utf8")));
  }

  private async writeBoard(board: SimpleBoard): Promise<void> {
    await writeJsonAtomic(this.boardFile(board.id), normalizeBoardSnapshot(board));
  }

  private async writeIndex(index: BoardLibraryIndex): Promise<void> {
    await writeJsonAtomic(this.indexFile, parseIndex(index));
  }

  private async ensureSeeded(current: SimpleBoard): Promise<BoardLibraryIndex> {
    let index = await this.readIndex();
    const shouldSeed = index.boards.length === 0;
    if (shouldSeed) {
      const seeded = { ...normalizeBoardSnapshot(current), title: normalizeName(current.title, "画板 1") };
      await this.writeBoard(seeded);
      index = makeIndex(seeded.id, [entryFromBoard(seeded, seeded.title, true)]);
      await this.writeIndex(index);
      return index;
    }
    let changed = false;
    for (const entry of index.boards) {
      try {
        await fs.access(this.boardFile(entry.id));
      } catch (error) {
        if (isMissingFile(error)) {
          const board = entry.id === index.activeId ? current : newBoard(entry.name);
          await this.writeBoard({ ...board, id: entry.id });
          changed = true;
        } else throw error;
      }
    }
    if (!index.activeId || !index.boards.some((entry) => entry.id === index.activeId)) {
      const fallback = index.boards[0];
      if (!fallback) throw new Error("Board library has no boards");
      index = makeIndex(fallback.id, index.boards);
      changed = true;
    }
    if (changed) await this.writeIndex(index);
    return index;
  }

  private async upsert(index: BoardLibraryIndex, board: SimpleBoard, name?: string): Promise<BoardLibraryIndex> {
    await this.writeBoard(board);
    const existing = index.boards.find((entry) => entry.id === board.id);
    const entry = entryFromBoard(board, normalizeName(name ?? existing?.name ?? board.title, board.title), false);
    const boards = existing
      ? index.boards.map((candidate) => candidate.id === board.id ? entry : candidate)
      : [...index.boards, entry];
    if (!existing && boards.length > MAX_LIBRARY_BOARDS) throw new Error("Board library limit reached");
    return makeIndex(index.activeId, boards.map((candidate) => ({ ...candidate, active: candidate.id === index.activeId })));
  }

  private async applyAction(action: BoardLibraryAction, current: SimpleBoard): Promise<BoardLibraryMutation> {
    let index = await this.ensureSeeded(current);
    const activeId = index.activeId;
    const currentEntry = index.boards.find((entry) => entry.id === activeId);
    if (!currentEntry) throw new Error("Active board is missing");

    const saveActive = async () => {
      index = await this.upsert(index, current, currentEntry.name);
      currentEntry.name = index.boards.find((entry) => entry.id === activeId)!.name;
    };
    const requireBoard = (id: string) => {
      if (!index.boards.some((entry) => entry.id === id)) throw new Error("Board not found");
      return safeId(id);
    };
    const switchBoard = async (id: string): Promise<SimpleBoard> => {
      await saveActive();
      const board = await this.readBoard(requireBoard(id));
      index = makeIndex(id, index.boards);
      await this.writeIndex(index);
      return board;
    };

    if (action.type === "list") {
      await saveActive();
      await this.writeIndex(index);
      return { index, board: { ...normalizeBoardSnapshot(current), title: currentEntry.name } };
    }
    if (action.type === "get" || action.type === "export") {
      await saveActive();
      const id = action.id ? requireBoard(action.id) : activeId;
      const board = id === activeId ? normalizeBoardSnapshot(current) : await this.readBoard(id);
      await this.writeIndex(index);
      return { index, board: id === activeId ? { ...board, title: currentEntry.name } : board };
    }
    if (action.type === "save") {
      const id = action.id ? requireBoard(action.id) : activeId;
      const source = id === activeId ? current : await this.readBoard(id);
      const parsed = action.board !== undefined ? normalizeBoardSnapshot(action.board) : normalizeBoardSnapshot(source);
      const saved = {
        ...normalizeBoardSnapshot(source),
        ...parsed,
        id,
        title: normalizeName(action.name ?? parsed.title, parsed.title),
      };
      index = await this.upsert(index, saved, saved.title);
      const board = action.switchTo === false
        ? { ...current, title: currentEntry.name }
        : { ...saved, revision: current.revision + 1 };
      if (action.switchTo !== false) index = makeIndex(saved.id, index.boards);
      await this.writeIndex(index);
      return { index, board, previousRevision: action.switchTo === false ? undefined : current.revision };
    }
    if (action.type === "create" || action.type === "import") {
      await saveActive();
      const name = normalizeName(action.name, `画板 ${index.boards.length + 1}`);
      const board = action.type === "create"
        ? newBoard(name)
        : (() => {
          const parsed = normalizeBoardSnapshot(action.board);
          return { ...parsed, id: makeId("board"), title: name, revision: 0, updatedAt: now() };
        })();
      const stored = touchBoard(board);
      index = await this.upsert(index, stored, name);
      const next = action.switchTo === false
        ? { ...current, title: currentEntry.name }
        : { ...stored, revision: current.revision + 1 };
      if (action.switchTo !== false) index = makeIndex(board.id, index.boards);
      await this.writeIndex(index);
      return { index, board: next, previousRevision: action.switchTo === false ? undefined : current.revision };
    }
    if (action.type === "switch") {
      const board = await switchBoard(action.id);
      return { index, board, previousRevision: current.revision };
    }
    if (action.type === "rename") {
      await saveActive();
      const id = requireBoard(action.id);
      const name = normalizeName(action.name, "未命名画板");
      const board = id === activeId ? { ...current, title: name } : { ...await this.readBoard(id), title: name };
      index = await this.upsert(index, board, name);
      await this.writeIndex(index);
      return { index, board: id === activeId ? board : { ...current, title: currentEntry.name } };
    }
    if (action.type === "duplicate") {
      await saveActive();
      const id = requireBoard(action.id);
      const source = id === activeId ? current : await this.readBoard(id);
      const name = normalizeName(action.name, `${source.title} 副本`);
      const board = { ...source, id: makeId("board"), title: name, revision: 0, updatedAt: now() };
      const stored = touchBoard(board);
      index = await this.upsert(index, stored, name);
      const next = action.switchTo === false
        ? { ...current, title: currentEntry.name }
        : { ...stored, revision: current.revision + 1 };
      if (action.switchTo !== false) index = makeIndex(board.id, index.boards);
      await this.writeIndex(index);
      return { index, board: next, previousRevision: action.switchTo === false ? undefined : current.revision };
    }
    if (action.type === "delete") {
      await saveActive();
      const id = requireBoard(action.id);
      if (index.boards.length <= 1) throw new Error("Cannot delete the last board");
      if (id === index.activeId) {
        const replacement = index.boards.find((entry) => entry.id !== id);
        if (!replacement) throw new Error("Cannot delete the last board");
        await fs.unlink(this.boardFile(id)).catch((error) => { if (!isMissingFile(error)) throw error; });
        const board = await this.readBoard(replacement.id);
        index = makeIndex(replacement.id, index.boards.filter((entry) => entry.id !== id));
        await this.writeIndex(index);
        return { index, board, previousRevision: current.revision };
      }
      await fs.unlink(this.boardFile(id)).catch((error) => { if (!isMissingFile(error)) throw error; });
      index = makeIndex(index.activeId, index.boards.filter((entry) => entry.id !== id));
      await this.writeIndex(index);
      return { index, board: { ...current, title: currentEntry.name } };
    }
    throw new Error("Unsupported board library action");
  }

  async apply(action: BoardLibraryAction, current: SimpleBoard): Promise<BoardLibraryMutation> {
    return this.mutex.run(() => this.applyAction(action, current));
  }
}

export function boardLibraryIndexText(index: BoardLibraryIndex): string {
  return JSON.stringify(index, null, 2);
}
