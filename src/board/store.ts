import fs from "node:fs/promises";
import path from "node:path";
import { BoardRevisionConflictError } from "./errors.js";
import { AsyncMutex } from "./mutex.js";
import { createStarterBoard, parseBoard, touchBoard, type SimpleBoard } from "./types.js";

export class BoardStore {
  private board: SimpleBoard;
  private revision: number;
  private file: string;
  private legacyFile: string;
  private readonly mutex = new AsyncMutex();

  constructor(outputDir: string) {
    this.file = path.join(outputDir, ".doodle", "board.json");
    this.legacyFile = path.join(outputDir, ".ai-draw", "board.json");
    this.board = createStarterBoard();
    this.revision = 0;
  }

  async init(): Promise<void> {
    try {
      await this.reload();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`Failed to read simple board: ${error instanceof Error ? error.message : String(error)}`);
      }
      this.revision = 0;
      this.board = createStarterBoard();
      await this.commit(touchBoard(this.board));
    }
    await this.migrateLegacyState();
  }

  get(): SimpleBoard {
    return this.board;
  }

  async replace(board: SimpleBoard): Promise<SimpleBoard> {
    return this.commit(board);
  }

  async replaceIfRevision(board: SimpleBoard, expectedRevision: number): Promise<SimpleBoard> {
    return this.mutex.run(async () => {
      const current = await this.readFreshState();
      if (current.revision !== expectedRevision) {
        throw new BoardRevisionConflictError(expectedRevision, current.revision);
      }
      return this.persist(parseBoard(board));
    });
  }

  async snapshot(): Promise<SimpleBoard> {
    await this.reload().catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    return this.board;
  }

  async mutate(change: (board: SimpleBoard) => SimpleBoard): Promise<SimpleBoard> {
    return this.mutex.run(async () => {
      const current = await this.readFreshState();
      return this.persist(parseBoard(change(current)));
    });
  }

  private async commit(board: SimpleBoard): Promise<SimpleBoard> {
    return this.mutex.run(() => this.persist(parseBoard(board)));
  }

  private async reload(): Promise<void> {
    const next = await this.readFreshState();
    this.board = next;
    this.revision = next.revision;
  }

  private async readFreshState(): Promise<SimpleBoard> {
    const next = parseBoard(JSON.parse(await this.readState()));
    if (next.revision >= this.revision) {
      this.board = next;
      this.revision = next.revision;
    }
    return this.board;
  }

  private async readState(): Promise<string> {
    try {
      return await fs.readFile(this.file, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return fs.readFile(this.legacyFile, "utf-8");
    }
  }

  private async migrateLegacyState(): Promise<void> {
    if (this.revision === 0) return;
    try {
      await fs.access(this.file);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await this.commit(this.board);
  }

  private async persist(board: SimpleBoard): Promise<SimpleBoard> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    const serialized = JSON.stringify(board, null, 2);
    await fs.writeFile(temp, serialized, "utf-8");
    await fs.rename(temp, this.file);
    this.board = board;
    this.revision = board.revision;
    return board;
  }
}
