import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BoardRevisionConflictError } from "./errors.js";
import { AsyncMutex } from "./mutex.js";
import { logger } from "../infra/logger.js";
import { createEmptyBoard, parseBoard, touchBoard, type SimpleBoard } from "./types.js";

/**
 * True when a write would erase every object from a board that had some.
 *
 * In a two-way board, "the board went blank" is almost always a client state
 * bug rather than intent: a canvas that has not yet mounted, a stale scene, a
 * race between a reload and a write. Clearing on purpose stays explicit through
 * `allowEmpty`, so deleting the last object is still possible.
 */
export function isSuspiciousEmptyWrite(
  current: SimpleBoard | undefined,
  next: SimpleBoard,
  options: { allowEmpty?: boolean } = {},
): boolean {
  if (options.allowEmpty) return false;
  if (!current) return false;
  return current.items.length > 0 && next.items.length === 0;
}

export class BoardStore {
  private board: SimpleBoard;
  private revision: number;
  private file: string;
  private legacyFile: string;
  private readonly mutex: AsyncMutex;

  constructor(outputDir: string) {
    this.file = path.join(outputDir, ".doodle", "board.json");
    this.legacyFile = path.join(outputDir, ".ai-draw", "board.json");
    this.mutex = new AsyncMutex(this.file);
    this.board = createEmptyBoard();
    this.revision = 0;
  }

  async init(): Promise<void> {
    await this.mutex.run(async () => {
      try {
        const current = await this.readState();
        this.assign(current);
      } catch (error) {
        if (!isMissingFile(error)) {
          /*
           * A corrupt board file must not brick the MCP server.
           *
           * Board state is local and single-writer, but a crash mid-write, a
           * manual edit, or a disk problem can leave invalid JSON. Throwing here
           * failed `init()` and the plugin never registered any tools, so the
           * user saw "no tools" instead of a recoverable board. Preserve the
           * damaged file for inspection, start from an empty board, and say so
           * on stderr. `parseBoard` still guards every write after this.
           */
          const backup = await this.quarantineCorruptState();
          logger.error(
            `Board state was unreadable (${error instanceof Error ? error.message : String(error)}); `
            + `started from an empty board. Damaged file preserved at ${backup}.`,
          );
        }
        this.board = createEmptyBoard();
        this.revision = 0;
        await this.persist(touchBoard(this.board));
      }
      await this.migrateLegacyState();
    });
  }

  /** Move an unreadable state file aside so it is never silently overwritten. */
  private async quarantineCorruptState(): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const source = await fs.access(this.file).then(() => this.file, () => this.legacyFile);
    const backup = `${source}.corrupt-${stamp}`;
    try {
      await fs.rename(source, backup);
      return backup;
    } catch (error) {
      if (isMissingFile(error)) return `${backup} (source already missing)`;
      throw error;
    }
  }

  get(): SimpleBoard {
    return this.board;
  }

  async replace(board: SimpleBoard, expectedRevision?: number): Promise<SimpleBoard> {
    return this.mutex.run(() => this.persistIfRevision(board, expectedRevision));
  }

  async replaceIfRevision(board: SimpleBoard, expectedRevision: number): Promise<SimpleBoard> {
    return this.replace(board, expectedRevision);
  }

  async snapshot(): Promise<SimpleBoard> {
    try {
      this.assign(await this.readState());
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    return this.board;
  }

  async mutate(change: (board: SimpleBoard) => SimpleBoard): Promise<SimpleBoard> {
    return this.mutex.run(async () => {
      const current = await this.readState();
      const next = parseBoard(change(current));
      if (next.revision <= current.revision) {
        throw new BoardRevisionConflictError(current.revision, next.revision);
      }
      return this.persist(next);
    });
  }

  private assign(board: SimpleBoard): void {
    this.board = board;
    this.revision = board.revision;
  }

  private async readState(): Promise<SimpleBoard> {
    return parseBoard(JSON.parse(await this.readStateText()));
  }

  private async persistIfRevision(board: SimpleBoard, expectedRevision?: number): Promise<SimpleBoard> {
    const current = await this.readState();
    const baseRevision = expectedRevision ?? current.revision;
    if (current.revision !== baseRevision) {
      throw new BoardRevisionConflictError(baseRevision, current.revision);
    }
    const next = parseBoard(board);
    if (next.revision <= baseRevision) {
      throw new BoardRevisionConflictError(baseRevision, next.revision);
    }
    return this.persist(next);
  }

  private async readStateText(): Promise<string> {
    try {
      return await fs.readFile(this.file, "utf-8");
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      return fs.readFile(this.legacyFile, "utf-8");
    }
  }

  private async migrateLegacyState(): Promise<void> {
    if (this.revision === 0) return;
    try {
      await fs.access(this.file);
      return;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    await this.persist(this.board);
  }

  private async persist(board: SimpleBoard): Promise<SimpleBoard> {
    /*
     * The mutex makes writers sequential today, but a fixed `<file>.tmp` name
     * still assumes that. A per-writer name costs one UUID and removes the
     * assumption entirely, so a future writer outside the lock cannot have its
     * half-written file renamed into place by someone else.
     */
    const temp = `${this.file}.${process.pid}-${randomUUID()}.tmp`;
    const serialized = JSON.stringify(board, null, 2);
    try {
      await fs.writeFile(temp, serialized, "utf-8");
      await fs.rename(temp, this.file);
    } catch (error) {
      // A unique name is not overwritten by the next write, so clean it up here.
      await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
    this.assign(board);
    return board;
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
