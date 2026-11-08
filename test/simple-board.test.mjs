import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addBoardItem,
  addBoardNote,
  boardCopyText,
  createEmptyBoard,
  parseBoard,
  removeBoardItem,
  updateBoardItem,
} from "../dist/domain/simple-board.js";
import { SimpleBoardStore } from "../dist/infra/simple-board-store.js";

describe("simple shared board", () => {
  it("keeps a bounded version 1 canvas independent of project state", () => {
    let board = createEmptyBoard();
    board = addBoardItem(board, { type: "note", x: 12, y: 24, text: "你好", author: "human" });
    board = addBoardItem(board, { type: "rect", x: 220, y: 24, text: "AI 补充", author: "ai" });
    board = addBoardNote(board, { author: "human", body: "把这两个连起来", itemId: board.items[0].id });
    expect(board).toMatchObject({ version: 1, revision: 3 });
    expect(board.items).toHaveLength(2);
    expect(board.items[1].author).toBe("ai");
    expect(board.notes[0].itemId).toBe(board.items[0].id);
    expect(boardCopyText(board)).toContain("把这两个连起来");
    expect(() => parseBoard({ ...board, version: 2 })).toThrow();
    expect(() => addBoardItem(board, { type: "note", x: Number.NaN, y: 0 })).toThrow();
  });

  it("updates, removes, revalidates, and persists independently", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-draw-board-store-"));
    try {
      const store = new SimpleBoardStore(outputDir);
      await store.init();
      const created = addBoardItem(store.get(), { type: "text", x: 10, y: 20, text: "draft" });
      await store.replace(created);
      const id = created.items[0].id;
      await store.replace(updateBoardItem(store.get(), id, { text: "final" }));
      const reload = new SimpleBoardStore(outputDir);
      await reload.init();
      expect(reload.get().items[0].text).toBe("final");
      const removed = removeBoardItem(reload.get(), id);
      expect(removed.items).toHaveLength(0);
      expect(() => addBoardNote(removed, { author: "ai", body: "orphan", itemId: id })).toThrow();
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });

  it("reloads a newer board written by another process", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-draw-board-sync-"));
    try {
      const writer = new SimpleBoardStore(outputDir);
      const reader = new SimpleBoardStore(outputDir);
      await writer.init();
      await reader.init();
      const written = await writer.mutate((current) => addBoardItem(current, {
        type: "note",
        x: 10,
        y: 20,
        text: "from another agent",
      }));
      const observed = await reader.snapshot();
      expect(observed.revision).toBe(written.revision);
      expect(observed.items[0]?.text).toBe("from another agent");
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });
});
