import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  externalizeImages, hydrateImages, pruneOrphanImages,
} from "../dist/board/state/image-store.js";
import { BoardStore } from "../dist/board/state/store.js";
import { BoardLibrary } from "../dist/board/library.js";
import { addBoardItem, createEmptyBoard, parseBoard, touchBoard } from "../dist/board/types.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const dirs = [];

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-images-"));
  dirs.push(dir);
  return dir;
}

function withImage(src = PNG, extra = {}) {
  return { type: "image", x: 0, y: 0, w: 100, h: 100, src, mime: "image/png", author: "human", ...extra };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("external image storage", () => {
  it("writes image bytes to disk and keeps a short reference", async () => {
    const imagesDir = path.join(await tempDir(), "images");
    const board = addBoardItem(createEmptyBoard(), withImage());
    const stored = await externalizeImages(board, imagesDir);

    expect(stored).not.toBe(board);
    expect(stored.items[0].src).toMatch(/^doodle-image:[0-9a-f]{24}\.png$/);
    expect(board.items[0].src).toBe(PNG);
    const files = await fs.readdir(imagesDir);
    expect(files).toHaveLength(1);
    expect((await fs.readFile(path.join(imagesDir, files[0]))).toString("base64"))
      .toBe(PNG.split(",")[1]);
  });

  it("round-trips a reference back to the original data URL", async () => {
    const imagesDir = path.join(await tempDir(), "images");
    const board = addBoardItem(createEmptyBoard(), withImage());
    const stored = await externalizeImages(board, imagesDir);
    const restored = parseBoard(await hydrateImages(JSON.parse(JSON.stringify(stored)), imagesDir));
    expect(restored.items[0].src).toBe(PNG);
  });

  it("deduplicates identical images by content", async () => {
    const imagesDir = path.join(await tempDir(), "images");
    let board = addBoardItem(createEmptyBoard(), withImage());
    board = addBoardItem(board, withImage(PNG, { x: 120 }));
    await externalizeImages(board, imagesDir);
    expect(await fs.readdir(imagesDir)).toHaveLength(1);
  });

  it("keeps distinct images on distinct files even after repeated writes", async () => {
    const imagesDir = path.join(await tempDir(), "images");
    const other = `data:image/png;base64,${"A".repeat(400)}`;
    let board = addBoardItem(createEmptyBoard(), withImage());
    board = addBoardItem(board, withImage(other, { x: 120 }));

    const first = await externalizeImages(board, imagesDir);
    const second = await externalizeImages(board, imagesDir);
    expect(first.items.map((item) => item.src)).toEqual(second.items.map((item) => item.src));
    expect(new Set(first.items.map((item) => item.src)).size).toBe(2);
    expect(await fs.readdir(imagesDir)).toHaveLength(2);
  });

  it("persists a small reference in board.json and rehydrates on a fresh store", async () => {
    const output = await tempDir();
    const store = new BoardStore(output);
    await store.init();
    await store.mutate((board) => addBoardItem(board, withImage()));

    const statePath = path.join(output, ".doodle", "board.json");
    const onDisk = JSON.parse(await fs.readFile(statePath, "utf8"));
    expect(onDisk.items[0].src).toMatch(/^doodle-image:/);
    expect(onDisk.items[0].src.length).toBeLessThan(60);
    expect((await fs.stat(statePath)).size).toBeLessThan(2000);

    const fresh = new BoardStore(output);
    await fresh.init();
    expect(fresh.get().items[0].src).toBe(PNG);
  });

  it("still reads an inline data URL from a pre-migration board and migrates on write", async () => {
    const output = await tempDir();
    const statePath = path.join(output, ".doodle", "board.json");
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(addBoardItem(createEmptyBoard(), withImage())));

    const store = new BoardStore(output);
    await store.init();
    expect(store.get().items[0].src).toBe(PNG);

    await store.mutate((board) => addBoardItem(board, { type: "note", x: 0, y: 120, text: "hi", author: "human" }));
    const onDisk = JSON.parse(await fs.readFile(statePath, "utf8"));
    expect(onDisk.items[0].src).toMatch(/^doodle-image:/);
  });

  it("drops only the image whose file went missing", async () => {
    const output = await tempDir();
    const store = new BoardStore(output);
    await store.init();
    await store.mutate((board) => addBoardItem(board, withImage()));
    await store.mutate((board) => addBoardItem(board, { type: "note", x: 0, y: 120, text: "keep", author: "human" }));

    const imagesDir = path.join(output, ".doodle", "images");
    await Promise.all((await fs.readdir(imagesDir)).map((name) => fs.unlink(path.join(imagesDir, name))));

    const fresh = new BoardStore(output);
    await fresh.init();
    expect(fresh.get().items.map((item) => item.type)).toEqual(["note"]);
  });

  it("rejects a traversal reference instead of reading outside the images dir", async () => {
    const imagesDir = path.join(await tempDir(), "images");
    const raw = {
      version: 1,
      items: [{ type: "image", src: "doodle-image:../../etc/passwd" }],
    };
    expect(await hydrateImages(raw, imagesDir)).toEqual({ version: 1, items: [] });
  });

  it("externalizes images in library snapshots and restores them on export", async () => {
    const output = await tempDir();
    const library = new BoardLibrary(output);
    const board = touchBoard(addBoardItem(createEmptyBoard(), withImage()));
    const result = await library.apply({ type: "list" }, board);
    expect(result.board.items[0].src).toBe(PNG);

    const boardsDir = path.join(output, ".doodle", "boards");
    const snapshotName = (await fs.readdir(boardsDir))
      .find((name) => name.endsWith(".json") && name !== "index.json");
    const snapshotPath = path.join(boardsDir, snapshotName);
    const onDisk = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
    expect(onDisk.items[0].src).toMatch(/^doodle-image:/);
    expect((await fs.stat(snapshotPath)).size).toBeLessThan(2000);

    const exported = await library.apply({ type: "export", id: result.index.activeId }, result.board);
    expect(exported.board.items[0].src).toBe(PNG);
  });

  it("prunes unreferenced image files and stale temp files while sparing fresh temp files", async () => {
    const output = await tempDir();
    const store = new BoardStore(output);
    await store.init();
    await store.mutate((board) => addBoardItem(board, withImage()));

    const imagesDir = path.join(output, ".doodle", "images");
    const [name] = await fs.readdir(imagesDir);
    const staleTmp = path.join(imagesDir, "stale.tmp-123");
    const freshTmp = path.join(imagesDir, "fresh.tmp-456");
    await fs.writeFile(staleTmp, "junk");
    await fs.writeFile(freshTmp, "in-flight");
    const oldTime = new Date(Date.now() - 120_000);
    await fs.utimes(staleTmp, oldTime, oldTime);

    expect(await pruneOrphanImages(imagesDir, new Set([name]))).toBe(1);
    expect((await fs.readdir(imagesDir)).sort()).toEqual(["fresh.tmp-456", name].sort());
  });

  it("preserves standard image/jpeg MIME type on round-trip", async () => {
    const imagesDir = path.join(await tempDir(), "images");
    const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAA==";
    const board = addBoardItem(createEmptyBoard(), {
      type: "image", x: 0, y: 0, w: 100, h: 100, src: jpeg, mime: "image/jpeg", author: "human",
    });
    const stored = await externalizeImages(board, imagesDir);
    const restored = parseBoard(await hydrateImages(JSON.parse(JSON.stringify(stored)), imagesDir));
    expect(restored.items[0].src).toBe(jpeg);
  });
});
