import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BoardLibrary } from "../dist/board/library.js";
import { addBoardItem, createEmptyBoard, touchBoard } from "../dist/board/types.js";

describe("local board library", () => {
  it("seeds the active board and saves, switches, renames, duplicates, exports, and deletes snapshots", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-library-"));
    try {
      const library = new BoardLibrary(outputDir);
      const first = touchBoard(addBoardItem(createEmptyBoard(), {
        type: "note", x: 10, y: 20, text: "first", author: "human",
      }));
      let result = await library.apply({ type: "list" }, first);
      expect(result.index.boards).toHaveLength(1);
      expect(result.index.activeId).toBe(first.id);

      result = await library.apply({ type: "save", name: "方案 A", switchTo: true }, result.board);
      expect(result.index.boards[0].name).toBe("方案 A");
      expect(result.board.title).toBe("方案 A");
      const firstId = result.index.activeId;

      result = await library.apply({ type: "create", name: "空白", switchTo: true }, result.board);
      expect(result.index.boards).toHaveLength(2);
      expect(result.index.activeId).not.toBe(firstId);
      expect(result.board.items).toHaveLength(0);

      result = await library.apply({ type: "switch", id: firstId }, result.board);
      expect(result.index.activeId).toBe(firstId);
      expect(result.board.items[0].text).toBe("first");

      result = await library.apply({ type: "duplicate", id: firstId, switchTo: true }, result.board);
      expect(result.index.boards).toHaveLength(3);
      expect(result.board.items[0].text).toBe("first");
      const duplicateId = result.index.activeId;

      result = await library.apply({ type: "rename", id: duplicateId, name: "方案 B" }, result.board);
      expect(result.index.boards.find((entry) => entry.id === duplicateId).name).toBe("方案 B");

      const exported = await library.apply({ type: "export", id: firstId }, result.board);
      expect(exported.board.items[0].text).toBe("first");
      expect(exported.board.notes).toEqual([]);

      result = await library.apply({ type: "delete", id: duplicateId }, result.board);
      expect(result.index.boards.some((entry) => entry.id === duplicateId)).toBe(false);

      result = await library.apply({ type: "import", name: "导入图", board: { ...first, notes: undefined }, switchTo: true }, result.board);
      expect(result.index.boards.at(-1).name).toBe("导入图");
      expect(result.board.items[0].text).toBe("first");
      expect(result.board.notes).toEqual([]);
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });

  it("keeps at least one board and rejects invalid imported state", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-library-invalid-"));
    try {
      const library = new BoardLibrary(outputDir);
      const current = touchBoard(createEmptyBoard());
      const seeded = await library.apply({ type: "list" }, current);
      await expect(library.apply({ type: "delete", id: seeded.index.activeId }, seeded.board)).rejects.toThrow("last board");
      await expect(library.apply({ type: "import", board: { version: 2 }, switchTo: true }, seeded.board)).rejects.toThrow("Unsupported board version");
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });
});
