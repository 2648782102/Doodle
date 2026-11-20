import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { describe, expect, it } from "vitest";
import { watchBoardState } from "../dist/board/state/state-watch.js";
import { BoardHttpServer } from "../dist/board/http/server.js";
import { BoardStore } from "../dist/board/state/store.js";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Inotify delivery is not synchronous, and CI runners are slow. Wait for the fact. */
async function waitFor(predicate, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await wait(25);
  }
  return false;
}

describe("cross-process board state watch", () => {
  /*
   * The state is a file, the broadcast bus is a process. Running
   * `npm run preview:board` beside an MCP host put both writers on one board,
   * and the canvas in the preview process never heard about an AI write.
   */
  it("reports a revision written by another process exactly once", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-watch-"));
    try {
      const file = path.join(dir, "board.json");
      const board = { version: 1, id: "b1", title: "", revision: 3, updatedAt: "x", items: [] };
      await fs.writeFile(file, JSON.stringify(board), "utf8");

      const seen = [];
      const watcher = watchBoardState(file, (revision) => seen.push(revision));

      await fs.writeFile(file, JSON.stringify({ ...board, revision: 4 }), "utf8");
      expect(await waitFor(() => seen.length > 0), "no revision reported").toBe(true);

      // Rewriting the same revision must not fire again.
      await fs.writeFile(file, JSON.stringify({ ...board, revision: 4 }), "utf8");
      await wait(300);
      watcher.close();

      expect(seen).toEqual([4]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("broadcasts a board_updated it did not write", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-watch-http-"));
    const port = await freePort();
    const outputDir = path.join(tempDir, "output");
    const store = new BoardStore(outputDir);
    await store.init();
    const preview = new BoardHttpServer(store, {
      previewHost: "127.0.0.1",
      previewPort: port,
      outputDir,
      workspaceRoot: tempDir,
      cwd: tempDir,
    });
    await preview.start();

    try {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });

      const messages = [];
      socket.on("message", (raw) => messages.push(JSON.parse(String(raw))));

      // Another process: bump the revision on disk behind this server's back.
      const state = JSON.parse(await fs.readFile(store.statePath, "utf8"));
      await fs.writeFile(store.statePath, JSON.stringify({ ...state, revision: state.revision + 5 }), "utf8");

      const found = await waitFor(() => messages.some((message) => message.type === "board_updated"));
      socket.close();

      expect(found, `messages: ${JSON.stringify(messages)}`).toBe(true);
      const update = messages.find((message) => message.type === "board_updated");
      expect(update.revision).toBe(state.revision + 5);
    } finally {
      await preview.stop().catch(() => {});
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
