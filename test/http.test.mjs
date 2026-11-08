import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BoardHttpServer } from "../dist/board/http.js";
import { BoardStore } from "../dist/board/store.js";
import { addBoardItem } from "../dist/board/types.js";

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

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-board-http-"));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const board = new BoardStore(path.join(tempDir, "output"));
await board.init();
const preview = new BoardHttpServer(board, {
  previewHost: "127.0.0.1",
  previewPort: port,
  outputDir: path.join(tempDir, "output"),
  workspaceRoot: tempDir,
});
await preview.start();

afterAll(async () => {
  await preview.stop().catch(() => {});
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("board HTTP surface", () => {
  it("serves the human board and the read-only board API", async () => {
    const html = await fetch(base).then((response) => response.text());
    expect(html).toContain("AI 画板");
    expect(html).toContain("/api/board");
    expect(html).not.toContain("/workbench");
    const snapshot = await fetch(`${base}/api/board`).then((response) => response.json());
    expect(snapshot).toMatchObject({ version: 1 });
  });

  it("requires the panel token and human confirmation for writes", async () => {
    const unauthenticated = await fetch(`${base}/api/board/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmedBy: "human", item: { type: "note", x: 0, y: 0 } }),
    });
    expect(unauthenticated.status).toBe(401);
    const html = await fetch(base).then((response) => response.text());
    const token = html.match(/const PANEL_TOKEN = "([^"]+)"/)?.[1];
    expect(token).toBeTruthy();
    const unconfirmed = await fetch(`${base}/api/board/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AI-Draw-Token": token },
      body: JSON.stringify({ item: { type: "note", x: 0, y: 0 } }),
    });
    expect(unconfirmed.status).toBe(403);
    const confirmed = await fetch(`${base}/api/board/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AI-Draw-Token": token },
      body: JSON.stringify({ confirmedBy: "human", item: { type: "note", x: 0, y: 0, text: "人画" } }),
    });
    expect(confirmed.status).toBe(200);
    const result = await confirmed.json();
    expect(result.board.items.at(-1)).toMatchObject({ text: "人画", author: "human" });
  });

  it("exposes read-only project context without project writes", async () => {
    await fs.writeFile(path.join(tempDir, "README.md"), "# Local test\n", "utf8");
    const project = await fetch(`${base}/api/board/project`).then((response) => response.json());
    expect(project).toMatchObject({ version: 1, readOnly: true, writes: "none" });
    expect(project).not.toHaveProperty("workspaceRoot");
    expect(JSON.stringify(project)).not.toContain(tempDir);
    expect(project.files.map((file) => file.path)).toContain("README.md");
    expect(await fetch(`${base}/api/board/project/text`).then((response) => response.text())).toContain("README.md");
    const current = await board.snapshot();
    expect(current.items.some((item) => item.text === "README.md")).toBe(false);
    expect(addBoardItem(current, { type: "text", x: 0, y: 0, text: "manual only" }).items.length).toBe(current.items.length + 1);
  });
});
