import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isSuspiciousEmptyWrite } from "../dist/board/store.js";
import { BoardStore } from "../dist/board/store.js";

function board(items) {
  return {
    version: 1,
    id: "b",
    title: "t",
    revision: 1,
    updatedAt: "2026-11-15T00:00:00.000Z",
    items,
    notes: [],
  };
}

const note = {
  id: "a",
  type: "note",
  x: 0, y: 0, w: 160, h: 90,
  text: "x",
  color: "#ffffff",
  author: "human",
  createdAt: "2026-11-15T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
};

describe("empty board write guard", () => {
  it("flags clearing a board that had objects", () => {
    expect(isSuspiciousEmptyWrite(board([note, { ...note, id: "b" }]), board([]))).toBe(true);
  });

  it("allows writing an empty board when it was already empty", () => {
    expect(isSuspiciousEmptyWrite(board([]), board([]))).toBe(false);
  });

  it("allows normal edits that keep content", () => {
    expect(isSuspiciousEmptyWrite(board([note]), board([note]))).toBe(false);
    expect(isSuspiciousEmptyWrite(board([note]), board([note, { ...note, id: "b" }]))).toBe(false);
  });

  it("allows deleting the last object when the caller means it", () => {
    expect(isSuspiciousEmptyWrite(board([note]), board([]), { allowEmpty: true })).toBe(false);
  });

  it("does not treat a first write as suspicious", () => {
    expect(isSuspiciousEmptyWrite(undefined, board([]))).toBe(false);
  });
});

describe("corrupt board state recovery", () => {
  it("starts from an empty board and preserves the damaged file", async () => {
    // A crash mid-write or a manual edit can leave invalid JSON. Throwing here
    // failed init(), so the plugin registered no tools at all.
    const dir = await mkdtemp(path.join(tmpdir(), "doodle-corrupt-test-"));
    const first = new BoardStore(dir);
    await first.init();
    const statePath = path.join(dir, ".doodle", "board.json");
    await writeFile(statePath, "{ not json", "utf8");

    const second = new BoardStore(dir);
    await expect(second.init()).resolves.toBeUndefined();
    expect(second.get().items).toHaveLength(0);

    const files = await readdir(path.join(dir, ".doodle"));
    const backup = files.find((name) => name.includes("board.json.corrupt-"));
    expect(backup).toBeDefined();
    expect(await readFile(path.join(dir, ".doodle", backup), "utf8")).toBe("{ not json");
    // The live file is a valid empty board again.
    expect(JSON.parse(await readFile(statePath, "utf8")).items).toEqual([]);
  });
});
