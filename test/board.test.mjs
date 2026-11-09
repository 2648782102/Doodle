import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addBoardItem,
  addBoardNote,
  boardCopyText,
  createEmptyBoard,
  createStarterBoard,
  parseBoard,
  removeBoardItem,
  updateBoardItem,
} from "../dist/board/types.js";
import { BoardStore } from "../dist/board/store.js";
import { BoardRevisionConflictError } from "../dist/board/errors.js";
import { scanProject } from "../dist/board/project-scan.js";

describe("simple shared board", () => {
  it("keeps a bounded version 1 canvas independent of project state", () => {
    let board = createEmptyBoard();
    board = addBoardItem(board, { type: "note", x: 12, y: 24, text: "你好", author: "human" });
    board = addBoardItem(board, { type: "rect", x: 220, y: 24, text: "AI 补充", author: "ai" });
    board = addBoardNote(board, { author: "human", body: "把这两个连起来", itemId: board.items[0].id });
    expect(board).toMatchObject({ version: 1, revision: 3 });
    expect(board.items).toHaveLength(2);
    expect(board.items[1].author).toBe("ai");
    expect(boardCopyText(board)).toContain("把这两个连起来");
    expect(() => parseBoard({ ...board, version: 2 })).toThrow();
    expect(() => addBoardItem(board, { type: "note", x: Number.NaN, y: 0 })).toThrow();
  });

  it("keeps signed line deltas as directed endpoints", () => {
    const board = addBoardItem(createEmptyBoard(), {
      type: "line",
      x: 320,
      y: 120,
      w: -180,
      h: 40,
      text: "返回",
      color: "#64748b",
      author: "ai",
    });
    expect(board.items[0]).toMatchObject({ w: -180, h: 40, author: "ai" });
    expect(parseBoard(JSON.parse(JSON.stringify(board))).items[0].w).toBe(-180);
    expect(() => addBoardItem(board, { type: "line", x: 0, y: 0, w: 0, h: 0 })).toThrow();
  });

  it("updates, removes, revalidates, and persists independently", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-board-store-"));
    try {
      const store = new BoardStore(outputDir);
      await store.init();
      const created = addBoardItem(store.get(), { type: "text", x: 10, y: 20, text: "draft" });
      await store.replace(created);
      const id = created.items[0].id;
      await store.replace(updateBoardItem(store.get(), id, { text: "final" }));
      const reload = new BoardStore(outputDir);
      await reload.init();
      expect(reload.get().items[0].text).toBe("final");
      const removed = removeBoardItem(reload.get(), id);
      expect(removed.items.some((item) => item.id === id)).toBe(false);
      expect(() => addBoardNote(removed, { author: "ai", body: "orphan", itemId: id })).toThrow();
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });

  it("reloads a newer board written by another process", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-board-sync-"));
    try {
      const writer = new BoardStore(outputDir);
      const reader = new BoardStore(outputDir);
      await writer.init();
      await reader.init();
      const written = await writer.mutate((current) => addBoardItem(current, {
        type: "note", x: 10, y: 20, text: "from another agent",
      }));
      const observed = await reader.snapshot();
      expect(observed.revision).toBe(written.revision);
      expect(observed.items.some((item) => item.text === "from another agent")).toBe(true);
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });

  it("starts new boards with a Doodle welcome sketch and rejects stale writes", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-board-cas-"));
    try {
      const store = new BoardStore(outputDir);
      await store.init();
      const initial = await store.snapshot();
      expect(initial.title).toContain("Doodle");
      expect(initial.items.length).toBeGreaterThan(0);
      expect(initial.notes[0]?.body).toContain("Doodle");
      expect(initial.revision).toBe(1);

      const stale = addBoardItem(initial, { type: "note", x: 900, y: 0, text: "stale" });
      await store.mutate((current) => addBoardItem(current, { type: "note", x: 900, y: 120, text: "newer" }));
      await expect(store.replaceIfRevision(stale, initial.revision)).rejects.toBeInstanceOf(BoardRevisionConflictError);
      const current = await store.snapshot();
      expect(current.items.some((item) => item.text === "newer")).toBe(true);
      expect(current.items.some((item) => item.text === "stale")).toBe(false);
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });

  it("serializes simultaneous human-style writes", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-board-lock-"));
    try {
      const store = new BoardStore(outputDir);
      await store.init();
      await Promise.all(Array.from({ length: 6 }, (_, index) => store.mutate((current) =>
        addBoardItem(current, { type: "text", x: index * 20, y: 0, text: `item ${index}` }))));
      const current = await store.snapshot();
      expect(current.items.filter((item) => /^item \d$/.test(item.text))).toHaveLength(6);
      expect(current.revision).toBe(7);
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });
});

describe("read-only project scan", () => {
  it("returns bounded relative paths and evidence without writing files", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-scan-"));
    try {
      await fs.mkdir(path.join(workspace, "src"));
      await fs.writeFile(path.join(workspace, "README.md"), "# Demo\n", "utf8");
      await fs.writeFile(path.join(workspace, "src", "main.ts"), "export function main() {}\n", "utf8");
      await fs.writeFile(path.join(workspace, ".env"), "SECRET=never-export\n", "utf8");
      await fs.writeFile(path.join(workspace, "src", "config.ts"), "export const apiKey = 'sk-live-abcdef123456';\n", "utf8");
      const snapshot = await scanProject(workspace, { maxDepth: 2, maxFiles: 20 });
      expect(snapshot).toMatchObject({ version: 1, readOnly: true, writes: "none" });
      expect(snapshot.files.map((file) => file.path)).toContain("README.md");
      expect(snapshot.files.map((file) => file.path)).toContain("src/main.ts");
      expect(snapshot.files.map((file) => file.path)).not.toContain(".env");
      expect(snapshot.evidence.some((item) => item.path === "src/main.ts" && item.kind === "definition")).toBe(true);
      expect(JSON.stringify(snapshot)).not.toContain("never-export");
      expect(JSON.stringify(snapshot)).not.toContain("sk-live-abcdef123456");
      expect(snapshot.evidence.some((item) => item.excerpt.includes("apiKey"))).toBe(false);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
