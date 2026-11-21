/**
 * The three layers that keep the board usable when the session that hosted it
 * is gone: a local snapshot copy, a replay queue, and an endpoint record.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBoardCache, memoryCacheStore } from "../dist/infra/templates/client/board-cache.js";
import { syncPhaseAfter, syncPhaseView } from "../dist/infra/templates/client/sync-state.js";
import {
  clearLiveEndpoint,
  isProcessAlive,
  isReusable,
  liveEndpointPath,
  readLiveEndpoint,
  writeLiveEndpoint,
} from "../dist/board/state/live-endpoint.js";

const board = (id, revision, items = []) => ({
  version: 1,
  id,
  title: "t",
  revision,
  updatedAt: new Date(0).toISOString(),
  items,
});

describe("local board cache", () => {
  it("round-trips a snapshot and remembers which board was active", async () => {
    const cache = createBoardCache(memoryCacheStore());
    await cache.write(board("b1", 3, [{ id: "a" }]));
    const restored = await cache.readActive();
    expect(restored?.id).toBe("b1");
    expect(restored?.revision).toBe(3);
    expect(restored?.items).toHaveLength(1);
  });

  it("restores the newest board, not the first one ever seen", async () => {
    const cache = createBoardCache(memoryCacheStore());
    await cache.write(board("b1", 1));
    await cache.write(board("b2", 2));
    expect((await cache.readActive())?.id).toBe("b2");
    // The older board is still addressable by id.
    expect((await cache.read("b1"))?.revision).toBe(1);
  });

  it("refuses to store something that is not a board", async () => {
    // A corrupt or partial write must not become the thing a boot paints.
    const cache = createBoardCache(memoryCacheStore());
    await cache.write({ id: "x" });
    await cache.write(null);
    expect(await cache.readActive()).toBeNull();
  });

  it("forgets a deleted board without losing the others", async () => {
    const cache = createBoardCache(memoryCacheStore());
    await cache.write(board("b1", 1));
    await cache.write(board("b2", 2));
    await cache.forget("b1");
    expect(await cache.boardIds()).toEqual(["b2"]);
    expect((await cache.readActive())?.id).toBe("b2");
  });
});

describe("sync phases for a detached board", () => {
  it("separates a recoverable disconnect from a dead board", () => {
    expect(syncPhaseView("offline").label).toBe("离线");
    expect(syncPhaseView("detached").label).toBe("已断开");
    // A conflict still outranks a disconnect: it needs a decision either way.
    expect(syncPhaseAfter("conflict", "offline")).toBe("conflict");
    expect(syncPhaseAfter("saved", "offline")).toBe("offline");
    expect(syncPhaseAfter("offline", "online")).toBe("saved");
    expect(syncPhaseAfter("detached", "online")).toBe("saved");
    expect(syncPhaseAfter("saved", "detached")).toBe("detached");
  });
});

describe("live endpoint record", () => {
  const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), "doodle-live-"));

  it("round-trips an endpoint", async () => {
    const dir = await tempDir();
    await writeLiveEndpoint(dir, {
      pid: process.pid, port: 4321, host: "127.0.0.1",
      boardId: "b1", startedAt: new Date().toISOString(), version: "0.0.0",
    });
    const found = await readLiveEndpoint(dir);
    expect(found?.port).toBe(4321);
    expect(found?.pid).toBe(process.pid);
  });

  it("treats a garbage record as absent rather than trusted", async () => {
    const dir = await tempDir();
    await fs.mkdir(path.join(dir, ".doodle"), { recursive: true });
    await fs.writeFile(liveEndpointPath(dir), "{ not json");
    expect(await readLiveEndpoint(dir)).toBeNull();
    // A structurally wrong record is also refused.
    await fs.writeFile(liveEndpointPath(dir), JSON.stringify({ pid: "x", port: 1 }));
    expect(await readLiveEndpoint(dir)).toBeNull();
  });

  it("never reuses its own pid", () => {
    expect(isReusable({ pid: process.pid, port: 1, host: "h" })).toBe(false);
  });

  it("clears a record whose owner is gone", async () => {
    const dir = await tempDir();
    await writeLiveEndpoint(dir, {
      pid: 999_999, port: 1, host: "h",
      boardId: "b", startedAt: new Date().toISOString(), version: "0",
    });
    expect(isProcessAlive(999_999)).toBe(false);
    await clearLiveEndpoint(dir);
    expect(await readLiveEndpoint(dir)).toBeNull();
  });

  it("clears its own record on shutdown", async () => {
    const dir = await tempDir();
    await writeLiveEndpoint(dir, {
      pid: process.pid, port: 1, host: "h",
      boardId: "b", startedAt: new Date().toISOString(), version: "0",
    });
    await clearLiveEndpoint(dir);
    expect(await readLiveEndpoint(dir)).toBeNull();
  });

  /*
   * A library switch moves the active board without restarting the process.
   *
   * Adoption compares the recorded board id against the current one, so a
   * record left stale by a switch silently disables single-instance reuse for
   * every later session — a new port each time, which is the exact behaviour
   * this whole record exists to remove.
   */
  it("can be refreshed when the active board changes under a live process", async () => {
    const dir = await tempDir();
    await writeLiveEndpoint(dir, {
      pid: process.pid, port: 5555, host: "127.0.0.1",
      boardId: "board_a", startedAt: new Date().toISOString(), version: "0",
    });
    // The switch: same endpoint, new board.
    await writeLiveEndpoint(dir, {
      pid: process.pid, port: 5555, host: "127.0.0.1",
      boardId: "board_b", startedAt: new Date().toISOString(), version: "0",
    });
    const record = await readLiveEndpoint(dir);
    expect(record?.boardId).toBe("board_b");
    expect(record?.port).toBe(5555);
  });
});
