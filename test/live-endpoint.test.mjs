import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isProcessAlive, isReusable, readLiveEndpoint, writeLiveEndpoint } from "../dist/board/state/live-endpoint.js";

const endpoint = (overrides = {}) => ({
  pid: 1,
  port: 4242,
  host: "127.0.0.1",
  boardId: "board-1",
  startedAt: "2026-11-24T00:00:00.000Z",
  version: "0.9.1",
  ...overrides,
});

describe("live canvas endpoint", () => {
  it("reuses a live sibling but never itself or a dead process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isReusable(endpoint({ pid: process.pid }))).toBe(false);
    // A different, definitely-live process is reusable; a made-up high pid is not.
    expect(isReusable(endpoint({ pid: process.pid }), process.pid + 100_000)).toBe(true);
    expect(isReusable(endpoint({ pid: 2_147_483_647 }))).toBe(false);
    expect(isReusable(null)).toBe(false);
  });

  it("round-trips a valid record and rejects malformed ones", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-live-endpoint-"));
    try {
      const record = endpoint({ pid: process.pid });
      await writeLiveEndpoint(dir, record);
      expect(await readLiveEndpoint(dir)).toEqual(record);

      await fs.writeFile(path.join(dir, ".doodle", "live.json"), '{"pid":"no","port":1,"host":"x"}');
      expect(await readLiveEndpoint(dir)).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
