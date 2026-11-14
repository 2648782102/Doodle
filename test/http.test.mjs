import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
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
  cwd: tempDir,
});
await preview.start();

afterAll(async () => {
  await preview.stop().catch(() => {});
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("board HTTP surface", () => {
  it("serves the human board and the read-only board API", async () => {
    const html = await fetch(base).then((response) => response.text());
    expect(preview.panelUrl).toBe(`${base}/`);
    expect(html).toContain("Doodle · Excalidraw Canvas");
    expect(html).toContain("const PANEL_TOKEN");
    expect(html).not.toContain("/workbench");
    expect(html).toContain("/excalidraw/excalidraw-app.js");
    expect(html).toContain('id="excalidrawRoot"');
    expect(html).not.toContain('id="libraryPanel"');
    expect(html).toContain('id="doodleLibraryPanel"');
    expect(html).not.toContain('id="toast"');
    const snapshot = await fetch(`${base}/api/board`).then((response) => response.json());
    expect(snapshot).toMatchObject({ version: 1 });
    expect(snapshot.library).toMatchObject({ version: 1 });
    expect(snapshot.capabilities.layouts).toContain("cluster");
    expect(snapshot.capabilities.canvasEngine).toBe("excalidraw");
    expect(snapshot.visualDigest).toMatchObject({ version: 1 });
  });

  it("exposes a human-confirmed local board library", async () => {
    const html = await fetch(base).then((response) => response.text());
    const token = html.match(/const PANEL_TOKEN = "([^"]+)"/)?.[1];
    const library = await fetch(`${base}/api/board/library`).then((response) => response.json());
    expect(library).toMatchObject({ version: 1 });
    expect(library.boards.length).toBeGreaterThan(0);
    const result = await fetch(`${base}/api/board/library`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AI-Draw-Token": token },
      body: JSON.stringify({ confirmedBy: "human", action: { type: "create", name: "Library HTTP", switchTo: true } }),
    }).then((response) => response.json());
    expect(result.ok).toBe(true);
    expect(result.index.boards.some((entry) => entry.name === "Library HTTP")).toBe(true);
    expect(result.board.title).toBe("Library HTTP");
  });

  it("serves the experimental Excalidraw engine and self-hosted assets", async () => {
    const html = await fetch(base).then((response) => response.text());
    expect(html).toContain("Doodle · Excalidraw Canvas");
    expect(html).toContain("/excalidraw/excalidraw-app.js");
    expect(html).toContain('const PANEL_TOKEN =');
    expect(html).not.toContain("https://");
    expect(html).not.toContain("?engine=dom");
    const app = await fetch(`${base}/excalidraw/excalidraw-app.js`);
    expect(app.status).toBe(200);
    const appText = await app.text();
    expect(appText).toContain("doodleLibraryPanel");
    expect(appText).toContain("editingTextElement");
    expect(appText).toContain("board_updated");
    expect(appText).not.toContain("已同步到 Doodle 画板");
    const css = await fetch(`${base}/excalidraw/index.css`);
    expect(css.status).toBe(200);
    expect(await css.text()).toContain("fonts/Assistant");
  });

  it("uses a free loopback port when previewPort is null", async () => {
    const dynamicBoard = new BoardStore(path.join(tempDir, "dynamic"));
    await dynamicBoard.init();
    const dynamicPreview = new BoardHttpServer(dynamicBoard, {
      previewHost: "127.0.0.1",
      previewPort: null,
      outputDir: path.join(tempDir, "dynamic"),
      workspaceRoot: tempDir,
      cwd: tempDir,
    });
    try {
      await dynamicPreview.start();
      const url = new URL(dynamicPreview.panelUrl);
      expect(url.hostname).toBe("127.0.0.1");
      expect(Number.parseInt(url.port, 10)).toBeGreaterThan(0);
      expect(await fetch(url).then((response) => response.status)).toBe(200);
    } finally {
      await dynamicPreview.stop();
    }
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

  it("marks human edits to AI objects with the human author", async () => {
    const html = await fetch(base).then((response) => response.text());
    const token = html.match(/const PANEL_TOKEN = "([^"]+)"/)?.[1];
    const created = await board.mutate((current) => addBoardItem(current, {
      type: "note", x: 0, y: 0, text: "AI note", author: "ai",
    }));
    const id = created.items.at(-1).id;
    const response = await fetch(`${base}/api/board/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-AI-Draw-Token": token },
      body: JSON.stringify({ confirmedBy: "human", patch: { text: "人改过" } }),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.board.items.find((item) => item.id === id)).toMatchObject({ text: "人改过", author: "human" });
  });

  it("broadcasts board updates to the standalone canvas", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const update = new Promise((resolve, reject) => {
      socket.on("message", (data) => resolve(JSON.parse(data.toString())));
      socket.on("error", reject);
    });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const next = await board.mutate((current) => addBoardItem(current, {
      type: "text", x: 10, y: 10, text: "broadcast", author: "ai",
    }));
    preview.broadcast({ type: "board_updated", revision: next.revision });
    expect(await update).toMatchObject({ type: "board_updated", revision: next.revision });
    socket.close();
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
