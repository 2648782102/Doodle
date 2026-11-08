import fs from "node:fs/promises";
import path from "node:path";
import { createEmptyBoard, parseBoard, type SimpleBoard } from "../domain/simple-board.js";

export class SimpleBoardStore {
  private board: SimpleBoard;
  private file: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(outputDir: string) {
    this.file = path.join(outputDir, ".ai-draw", "board.json");
    this.board = createEmptyBoard();
  }

  async init(): Promise<void> {
    try {
      this.board = parseBoard(JSON.parse(await fs.readFile(this.file, "utf-8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`Failed to read simple board: ${error instanceof Error ? error.message : String(error)}`);
      }
      await this.persist();
    }
  }

  get(): SimpleBoard {
    return this.board;
  }

  async replace(board: SimpleBoard): Promise<SimpleBoard> {
    this.board = parseBoard(board);
    await this.persist();
    return this.board;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    const serialized = JSON.stringify(this.board, null, 2);
    await fs.writeFile(temp, serialized, "utf-8");
    await fs.rename(temp, this.file);
  }
}
