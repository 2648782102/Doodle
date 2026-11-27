import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BoardLibrary } from "../dist/board/library.js";
import { MAX_BOARD_NAME, normalizeName } from "../dist/board/library.js";
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
      // The refusal now says why the library always keeps one board.
      await expect(library.apply({ type: "delete", id: seeded.index.activeId }, seeded.board)).rejects.toThrow("only saved board");
      // The message now names the version it found, so a caller can tell an
      // old snapshot from a corrupted one.
      await expect(library.apply({ type: "import", board: { version: 2 }, switchTo: true }, seeded.board)).rejects.toThrow("Board version must be 1, got 2");
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });

  it("answers a list without writing, whether or not the active board changed", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-library-readonly-"));
    try {
      const library = new BoardLibrary(outputDir);
      const current = touchBoard(addBoardItem(createEmptyBoard(), {
        type: "note", x: 10, y: 20, text: "steady", author: "human",
      }));
      await library.apply({ type: "list" }, current);
      const indexPath = path.join(outputDir, ".doodle", "boards", "index.json");
      const snapshotPath = path.join(outputDir, ".doodle", "boards", `${current.id}.json`);
      const past = new Date(Date.now() - 60_000);
      await fs.utimes(indexPath, past, past);
      await fs.utimes(snapshotPath, past, past);
      const beforeIndexMtime = (await fs.stat(indexPath)).mtimeMs;
      const beforeSnapshotMtime = (await fs.stat(snapshotPath)).mtimeMs;

      await library.apply({ type: "list" }, current);
      expect((await fs.stat(indexPath)).mtimeMs).toBe(beforeIndexMtime);
      expect((await fs.stat(snapshotPath)).mtimeMs).toBe(beforeSnapshotMtime);
      /*
       * An *advanced* board is the case that used to force a write: the stored
       * snapshot lagged the live one, so `saveActive()` rewrote both files on
       * every read. The index must still describe the live board without that
       * write, because the canvas and `get_board` read revision and item count
       * off the entry.
       */
      const advanced = touchBoard(addBoardItem(current, {
        type: "note", x: 200, y: 20, text: "drawn without saving", author: "human",
      }));
      const listed = await library.apply({ type: "list" }, advanced);
      expect((await fs.stat(indexPath)).mtimeMs).toBe(beforeIndexMtime);
      expect((await fs.stat(snapshotPath)).mtimeMs).toBe(beforeSnapshotMtime);
      const entry = listed.index.boards.find((candidate) => candidate.id === listed.index.activeId);
      expect(entry.revision).toBe(advanced.revision);
      expect(entry.itemCount).toBe(advanced.items.length);
      expect(entry.updatedAt).toBe(advanced.updatedAt);
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });

  it("reads a board for a thumbnail without writing the active one", async () => {
    /*
     * The preview route needs one saved board's geometry, and its picture must
     * never cause a write. `apply` saves the active board as a side effect, which
     * is exactly what a thumbnail request must not do: opening the drawer would
     * rewrite the board and bump the index mtime.
     */
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-preview-"));
    try {
      const library = new BoardLibrary(outputDir);
      const active = touchBoard(addBoardItem(createEmptyBoard(), {
        type: "note", x: 0, y: 0, text: "active", author: "human",
      }));
      let result = await library.apply({ type: "list" }, active);
      result = await library.apply({ type: "create", name: "第二张", switchTo: true }, result.board);
      const activeId = result.index.activeId;
      const firstId = result.index.boards.find((entry) => entry.id !== activeId).id;

      const snapshotPath = path.join(outputDir, ".doodle", "boards", `${activeId}.json`);
      const before = (await fs.stat(snapshotPath)).mtimeMs;

      const other = await library.readForPreview(firstId, result.board);
      expect(other.id).toBe(firstId);
      // The active board comes from the caller's snapshot, not a stale file.
      const current = await library.readForPreview(activeId, result.board);
      expect(current.id).toBe(activeId);

      expect((await fs.stat(snapshotPath)).mtimeMs, "a thumbnail request wrote the board").toBe(before);
      await expect(library.readForPreview("board_missing", result.board)).rejects.toThrow();
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });
  it("cuts an over-long name at a character, never through one", () => {
    /*
     * `slice(0, MAX)` counts UTF-16 code units, so a name whose code unit 80
     * lands inside an astral character (an emoji, a rare CJK ideograph) kept the
     * high surrogate and dropped the low one. The stored name then ended in a
     * lone surrogate, which renders as a replacement glyph: the person sees
     * their board renamed to mojibake, and the file holds an escape no other
     * reader can turn back into the character they typed.
     */
    const emoji = "\u{1F3A8}";
    const overLong = "a".repeat(MAX_BOARD_NAME - 1) + emoji;
    const cut = normalizeName(overLong, "fallback");
    expect(cut.length).toBeLessThanOrEqual(MAX_BOARD_NAME);
    const lastUnit = cut.charCodeAt(cut.length - 1);
    expect(lastUnit >= 0xd800 && lastUnit <= 0xdbff, "the cut left half a character").toBe(false);
    expect(cut.endsWith(emoji), "the whole character should have gone, not half of it").toBe(false);
    expect(cut).toBe("a".repeat(MAX_BOARD_NAME - 1));
  });

  it("keeps a name that fits, and trims it", () => {
    expect(normalizeName("  画板  ", "fallback")).toBe("画板");
    expect(normalizeName("", "fallback")).toBe("fallback");
    expect(normalizeName(undefined, "fallback")).toBe("fallback");
    const exactly = "画".repeat(MAX_BOARD_NAME);
    expect(normalizeName(exactly, "fallback")).toBe(exactly);
  });
});
