/**
 * Persistence for the board library.
 *
 * One index plus one JSON file per saved board, all written atomically under a
 * filesystem mutex. The active `board.json` managed by `BoardStore` stays the
 * source of truth for the current session; this directory only holds the named
 * snapshots a person can switch between.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncMutex } from "../state/mutex.js";
import { externalizeImages, hydrateImages } from "../state/image-store.js";
import { BoardValidationError } from "../errors.js";
import { renameWithRetry } from "../../infra/atomic-write.js";
import { touchBoard, type SimpleBoard } from "../types.js";
import { makeId, now } from "../model/clock.js";
import {
  MAX_LIBRARY_BOARDS,
  entryFromBoard,
  makeIndex,
  newBoard,
  normalizeBoardSnapshot,
  normalizeName,
  parseIndex,
  safeId,
  type BoardLibraryAction,
  type BoardLibraryIndex,
  type BoardLibraryMutation,
} from "./schema.js";

export class BoardLibrary {
  private readonly directory: string;
  private readonly imagesDir: string;
  private readonly indexFile: string;
  private readonly mutex: AsyncMutex;

  constructor(outputDir: string) {
    this.directory = path.join(outputDir, ".doodle", "boards");
    this.imagesDir = path.join(outputDir, ".doodle", "images");
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
    const raw = JSON.parse(await fs.readFile(this.boardFile(id), "utf8"));
    return normalizeBoardSnapshot(await hydrateImages(raw, this.imagesDir));
  }

  private async writeBoard(board: SimpleBoard): Promise<void> {
    const snapshot = normalizeBoardSnapshot(board);
    await writeJsonAtomic(this.boardFile(board.id), await externalizeImages(snapshot, this.imagesDir));
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
    if (!existing && boards.length > MAX_LIBRARY_BOARDS) {
      throw new BoardValidationError(
        `Library already holds ${boards.length} boards; the limit is ${MAX_LIBRARY_BOARDS}`,
        "BOARD_LIBRARY_LIMIT",
        "library",
        `at most ${MAX_LIBRARY_BOARDS} saved boards`,
        `Delete a board you no longer need with library {type: "delete", id}, then create this one.`,
      );
    }
    return makeIndex(index.activeId, boards.map((candidate) => ({ ...candidate, active: candidate.id === index.activeId })));
  }

  private async applyAction(action: BoardLibraryAction, current: SimpleBoard): Promise<BoardLibraryMutation> {
    let index = await this.ensureSeeded(current);
    const activeId = index.activeId;
    const currentEntry = index.boards.find((entry) => entry.id === activeId);
    if (!currentEntry) throw new Error("Active board is missing");

    const activeSnapshotInSync = current.id === activeId
      && currentEntry.revision === current.revision
      && currentEntry.itemCount === current.items.length
      && currentEntry.updatedAt === current.updatedAt;
    const saveActive = async () => {
      if (activeSnapshotInSync) return;
      index = await this.upsert(index, current, currentEntry.name);
      currentEntry.name = index.boards.find((entry) => entry.id === activeId)!.name;
    };
    /*
     * A `list` is a read, and a read must not write the board file.
     *
     * `list` used to call `saveActive()`, which rewrites the active board
     * snapshot and then the index. It is called on every `get_board`, every
     * `show_board`, `GET /api/board`, `GET /api/board/library`, and after every
     * successful write — so a 400-object board paid two whole-file writes
     * (~537 KB) per read, refreshed the file's mtime, and made the documented
     * read-only surface write to disk.
     *
     * The snapshot it was refreshing only carries what the index displays:
     * title, revision, itemCount, updatedAt. Those are known from the live
     * board, so the same index can be derived in memory. Persisting a *new*
     * board still goes through `save` / `create` / `switch`, which is where a
     * snapshot actually changes.
     */
    const listIndex = (): BoardLibraryIndex => {
      const entry = entryFromBoard(current, currentEntry.name, true);
      return makeIndex(activeId, index.boards.map((candidate) => (
        candidate.id === activeId ? entry : candidate
      )));
    };
    const requireBoard = (id: string) => {
      if (!index.boards.some((entry) => entry.id === id)) {
        const known = index.boards.map((entry) => `${entry.name} (${entry.id})`).join(", ");
        throw new BoardValidationError(
          `No saved board has the id ${JSON.stringify(id)}`,
          "BOARD_NOT_FOUND",
          "library.id",
          "an id from the library index",
          `Call draw_board with library {type: "list"} to see the ids. Known boards: ${known || "none"}.`,
        );
      }
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
      return { index: listIndex(), board: { ...normalizeBoardSnapshot(current), title: currentEntry.name } };
    }
    if (action.type === "get" || action.type === "export") {
      const id = action.id ? requireBoard(action.id) : activeId;
      const board = id === activeId ? normalizeBoardSnapshot(current) : await this.readBoard(id);
      /*
       * `get` and `export` are reads too. They carry the same index entry as
       * `list`, so they derive it the same way instead of writing the snapshot
       * back; exporting another board must not touch the one on disk either.
       */
      return {
        index: activeSnapshotInSync ? index : listIndex(),
        board: id === activeId ? { ...board, title: currentEntry.name } : board,
      };
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
      /*
       * The library always keeps one board, because the MCP session needs an
       * active board to read and write. Say that, rather than refusing flatly.
       */
      const lastBoardError = () => new BoardValidationError(
        "Cannot delete the only saved board",
        "LAST_BOARD",
        "library.id",
        "a library holding at least two boards",
        `Create another board first: draw_board with library {type: "create"}. The active board is the one the session reads and writes.`,
      );
      if (index.boards.length <= 1) throw lastBoardError();
      if (id === index.activeId) {
        const replacement = index.boards.find((entry) => entry.id !== id);
        if (!replacement) throw lastBoardError();
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
    /*
     * The schema is a discriminated union, so reaching here means the caller
     * sent a `type` the union does not contain — a shape mistake, not an
     * internal one. Name the accepted set.
     */
    throw new BoardValidationError(
      `Unknown library action ${JSON.stringify((action as { type?: unknown }).type)}`,
      "UNKNOWN_LIBRARY_ACTION",
      "library.type",
      `list, get, save, switch, create, rename, duplicate, delete, import, or export`,
      `Use one of the listed action types. "list" shows the library; "switch" opens a saved board.`,
    );
  }

  async apply(action: BoardLibraryAction, current: SimpleBoard): Promise<BoardLibraryMutation> {
    return this.mutex.run(() => this.applyAction(action, current));
  }

  /**
   * One saved board, for a thumbnail. Never writes.
   *
   * Deliberately outside `apply`: that path can save the active board as a side
   * effect (`saveActive`), which a picture must never trigger — a library
   * thumbnail request is a read. Unknown ids throw the same way `apply` does, so
   * the caller can turn them into a 404.
   */
  async readForPreview(id: string, current: SimpleBoard): Promise<SimpleBoard> {
    const index = await this.readIndex();
    if (!index.boards.some((entry) => entry.id === safeId(id))) {
      throw new Error(`Board ${id} is not in the library`);
    }
    // The active board is the caller's in-memory snapshot; reading its file would
    // lag behind an edit that has not been persisted yet.
    if (id === index.activeId) return normalizeBoardSnapshot(current);
    return this.readBoard(id);
  }
}

export function boardLibraryIndexText(index: BoardLibraryIndex): string {
  return JSON.stringify(index, null, 2);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Per-writer name, same reason as BoardStore: never share a temp path.
  const temp = `${file}.${process.pid}-${randomUUID()}.tmp`;
  try {
    // Compact for the same reason as BoardStore: these files are read by code.
    await fs.writeFile(temp, JSON.stringify(value), "utf8");
    await renameWithRetry(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}
