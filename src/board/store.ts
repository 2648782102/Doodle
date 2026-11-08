import fs from "node:fs/promises";
import path from "node:path";
import { createEmptyBoard, parseBoard, type SimpleBoard } from "./types.js";

export class BoardStore {
  private board: SimpleBoard;
  private revision: number;
  private file: string;
  private legacyFile: string;

  constructor(outputDir: string) {
    this.file = path.join(outputDir, ".doodle", "board.json");
    this.legacyFile = path.join(outputDir, ".ai-draw", "board.json");
    this.board = createEmptyBoard();
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
      await this.persist();
    }
    await this.migrateLegacyState();
  }

  get(): SimpleBoard {
    return this.board;
  }

  async replace(board: SimpleBoard): Promise<SimpleBoard> {
    this.board = parseBoard(board);
    this.revision = this.board.revision;
    await this.persist();
    return this.board;
  }

  async snapshot(): Promise<SimpleBoard> {
    await this.reload().catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    return this.board;
  }

  async mutate(change: (board: SimpleBoard) => SimpleBoard): Promise<SimpleBoard> {
    await this.snapshot();
    return this.replace(change(this.board));
  }

  private async reload(): Promise<void> {
    const raw = await this.readState();
    const next = parseBoard(JSON.parse(raw));
    if (next.revision >= this.revision) {
      this.board = next;
      this.revision = next.revision;
    }
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
    await this.persist();
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    const serialized = JSON.stringify(this.board, null, 2);
    await fs.writeFile(temp, serialized, "utf-8");
    await fs.rename(temp, this.file);
  }
}
