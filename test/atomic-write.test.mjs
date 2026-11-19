import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renameWithRetry } from "../dist/infra/atomic-write.js";

describe("renameWithRetry", () => {
  it("renames a file and leaves no temporary behind", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-rename-"));
    try {
      const from = path.join(dir, "board.json.1-2.tmp");
      const to = path.join(dir, "board.json");
      await fs.writeFile(from, '{"version":1}', "utf8");

      await renameWithRetry(from, to);

      await expect(fs.readFile(to, "utf8")).resolves.toBe('{"version":1}');
      await expect(fs.access(from)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("replaces an existing destination", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-rename-"));
    try {
      const from = path.join(dir, "board.json.3-4.tmp");
      const to = path.join(dir, "board.json");
      await fs.writeFile(to, "old", "utf8");
      await fs.writeFile(from, "new", "utf8");

      await renameWithRetry(from, to);

      await expect(fs.readFile(to, "utf8")).resolves.toBe("new");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rethrows a non-transient error instead of burning retries", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-rename-"));
    try {
      const missing = path.join(dir, "does-not-exist.tmp");
      const to = path.join(dir, "board.json");

      await expect(renameWithRetry(missing, to)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
