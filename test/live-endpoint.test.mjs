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
  version: "0.9.2",
  ...overrides,
});

/** Find a pid that is definitely unused right now, without assuming a constant. */
function unusedPid() {
  for (let candidate = 100_000; candidate < 400_000; candidate += 1) {
    if (!isProcessAlive(candidate)) return candidate;
  }
  throw new Error("no unused pid found");
}

describe("live canvas endpoint", () => {
  it("reuses a live sibling but never itself or a dead process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isReusable(endpoint({ pid: process.pid }))).toBe(false);
    const dead = unusedPid();
    // A live sibling is reusable; a dead process and this process are not.
    expect(isReusable(endpoint({ pid: process.pid }), dead)).toBe(true);
    expect(isReusable(endpoint({ pid: dead }))).toBe(false);
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
