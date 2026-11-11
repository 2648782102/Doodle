import fs from "node:fs/promises";
import path from "node:path";
import { BoardRevisionConflictError } from "./errors.js";
import { AsyncMutex } from "./mutex.js";
import { createEmptyBoard, parseBoard, touchBoard, type SimpleBoard } from "./types.js";

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
          throw new Error(`Failed to read simple board: ${error instanceof Error ? error.message : String(error)}`);
        }
        this.board = createEmptyBoard();
        this.revision = 0;
        await this.persist(touchBoard(this.board));
      }
      await this.migrateLegacyState();
    });
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
    const temp = `${this.file}.tmp`;
    const serialized = JSON.stringify(board, null, 2);
    await fs.writeFile(temp, serialized, "utf-8");
    await fs.rename(temp, this.file);
    this.assign(board);
    return board;
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
