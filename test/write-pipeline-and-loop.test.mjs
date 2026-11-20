import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BoardHttpServer,
  BoardRevisionCache,
  BoardStore,
  addBoardItem,
  addBoardItems,
  boardItemsFromExcalidrawBoard,
  commitBoardWrite,
  removeBoardItem,
  updateBoardItem,
} from "../dist/board/index.js";
import { diffBoardItems } from "../dist/board/item-diff.js";
import { describeHandoff } from "../dist/board/handoff.js";
import { buildBoardModelContext } from "../dist/board/app-context.js";
import {
  BoardRevisionConflictError,
  BoardValidationError,
  EmptyWriteRefusedError,
  ObjectConflictError,
} from "../dist/board/errors.js";
import { isDoodleProjectLink } from "../src/infra/templates/client/link-policy.ts";
import { canvasThemeFor, isDoodleTheme } from "../src/infra/templates/client/theme.ts";
import { toolErrorMessage } from "../src/infra/templates/client/transport.ts";
import { boardBounds } from "../src/infra/templates/client/types.ts";

const dirs = [];

async function tempDir(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

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

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("unified board write pipeline", () => {
  it("merges disjoint concurrent writes and rejects overlapping writes identically for MCP and HTTP", async () => {
    const dir = await tempDir("doodle-pipeline-");
    const store = new BoardStore(dir);
    await store.init();
    const revisions = new BoardRevisionCache();

    const seeded = await commitBoardWrite({
      store,
      revisions,
      author: "ai",
      change: (current) => addBoardItems(current, [
        { type: "rect", x: 0, y: 0, w: 120, h: 60, text: "A", author: "ai" },
        { type: "rect", x: 200, y: 0, w: 120, h: 60, text: "B", author: "ai" },
      ]),
    });
    const baseRev = seeded.board.revision;
    const [a, b] = seeded.board.items;

    // AI edits A
    await commitBoardWrite({
      store,
      revisions,
      author: "ai",
      expectedRevision: baseRev,
      conflictScope: { updates: [{ id: a.id }] },
      change: (current) => updateBoardItem(current, a.id, { text: "A-ai" }, "ai"),
    });

    // Human edits B from stale baseRev → merges cleanly
    const merged = await commitBoardWrite({
      store,
      revisions,
      author: "human",
      expectedRevision: baseRev,
      guardEmptyWrite: true,
      conflictScope: { id: b.id },
      change: (current) => updateBoardItem(current, b.id, { text: "B-human" }, "human"),
    });
    expect(merged.mergedFrom).toBe(baseRev);
    expect(merged.board.items.find((i) => i.id === a.id).text).toBe("A-ai");
    expect(merged.board.items.find((i) => i.id === b.id).text).toBe("B-human");

    // Overlapping edit to A from stale baseRev → ObjectConflictError naming A
    await expect(commitBoardWrite({
      store,
      revisions,
      author: "human",
      expectedRevision: baseRev,
      conflictScope: { id: a.id },
      change: (current) => updateBoardItem(current, a.id, { text: "A-conflict" }, "human"),
    })).rejects.toThrow(ObjectConflictError);

    // Whole-board replace against stale revision → BoardRevisionConflictError
    await expect(commitBoardWrite({
      store,
      revisions,
      author: "ai",
      expectedRevision: baseRev,
      wholeBoard: true,
      change: (current) => updateBoardItem(current, a.id, { text: "nope" }, "ai"),
    })).rejects.toThrow(BoardRevisionConflictError);
  });

  it("serializes two simultaneous pinned disjoint writes inside the lock without TOCTOU 409", async () => {
    const dir = await tempDir("doodle-pipeline-race-");
    const store = new BoardStore(dir);
    await store.init();
    const revisions = new BoardRevisionCache();

    const seeded = await commitBoardWrite({
      store,
      revisions,
      author: "ai",
      change: (current) => addBoardItems(current, [
        { type: "rect", x: 0, y: 0, w: 120, h: 60, text: "A", author: "ai" },
        { type: "rect", x: 200, y: 0, w: 120, h: 60, text: "B", author: "ai" },
      ]),
    });
    const baseRev = seeded.board.revision;
    const [a, b] = seeded.board.items;

    const [first, second] = await Promise.all([
      commitBoardWrite({
        store,
        revisions,
        author: "ai",
        expectedRevision: baseRev,
        conflictScope: { updates: [{ id: a.id }] },
        change: (current) => updateBoardItem(current, a.id, { text: "A-race" }, "ai"),
      }),
      commitBoardWrite({
        store,
        revisions,
        author: "human",
        expectedRevision: baseRev,
        conflictScope: { id: b.id },
        change: (current) => updateBoardItem(current, b.id, { text: "B-race" }, "human"),
      }),
    ]);

    const finalBoard = await store.snapshot();
    expect(finalBoard.items.find((i) => i.id === a.id).text).toBe("A-race");
    expect(finalBoard.items.find((i) => i.id === b.id).text).toBe("B-race");
    expect([first.mergedFrom, second.mergedFrom].filter((v) => v === baseRev)).toHaveLength(1);
  });

  it("enforces empty-write protection unless allowEmpty is explicit, and honors uncachedMode", async () => {
    const dir = await tempDir("doodle-pipeline-empty-");
    const store = new BoardStore(dir);
    await store.init();
    const revisions = new BoardRevisionCache();

    const one = await commitBoardWrite({
      store,
      revisions,
      author: "human",
      change: (current) => addBoardItem(current, { type: "note", x: 0, y: 0, text: "last", author: "human" }),
    });
    const lastId = one.board.items[0].id;

    // Suspicious empty write blocked
    await expect(commitBoardWrite({
      store,
      revisions,
      author: "human",
      guardEmptyWrite: true,
      allowEmpty: false,
      change: (current) => removeBoardItem(current, lastId),
    })).rejects.toThrow(EmptyWriteRefusedError);

    // Explicit delete allowed
    const cleared = await commitBoardWrite({
      store,
      revisions,
      author: "human",
      guardEmptyWrite: true,
      allowEmpty: true,
      change: (current) => removeBoardItem(current, lastId),
    });
    expect(cleared.board.items).toHaveLength(0);

    // Uncached stale revision honors uncachedMode
    await expect(commitBoardWrite({
      store,
      revisions: new BoardRevisionCache(),
      author: "ai",
      expectedRevision: 0,
      uncachedMode: "validation-error",
      change: (current) => addBoardItem(current, { type: "note", x: 0, y: 0, text: "x", author: "ai" }),
    })).rejects.toThrow(BoardValidationError);
  });
});

describe("split canvas client modules", () => {
  it("extracts repairable message and fix from MCP ERROR_JSON", () => {
    const text = toolErrorMessage({
      content: [{
        type: "text",
        text: 'ERROR_JSON:\n{"message":"Item color invalid","fix":"Use #f6d365"}',
      }],
    });
    expect(text).toBe("Item color invalid — Use #f6d365");
    expect(toolErrorMessage({ content: [{ type: "text", text: "MCP error -32602" }] })).toBe("Board update failed");
  });

  it("enforces closed link policy, theme guards, and board bounding box calculation", () => {
    expect(isDoodleProjectLink("https://github.com/2648782102/Doodle")).toBe(true);
    expect(isDoodleProjectLink("https://github.com/2648782102/Doodle/issues/24")).toBe(true);
    expect(isDoodleProjectLink("https://github.com/2648782102/Doodle-evil")).toBe(false);
    expect(isDoodleProjectLink("https://evil.example/")).toBe(false);

    expect(isDoodleTheme("light")).toBe(true);
    expect(isDoodleTheme("dark")).toBe(true);
    expect(isDoodleTheme("glass")).toBe(true);
    expect(isDoodleTheme("neon")).toBe(false);
    expect(canvasThemeFor("glass")).toBe("light");
    expect(canvasThemeFor("dark")).toBe("dark");

    expect(boardBounds([{ x: 100, y: 50, w: -40, h: 30 }])).toEqual({
      minX: 60, minY: 50, maxX: 100, maxY: 80,
    });
    expect(boardBounds([])).toBeUndefined();
  });
});

describe("end-to-end bidirectional loop (observable latency & full edit cycle)", () => {
  it("completes AI draw → human create/edit/re-edit/delete-last → incremental context & handoff within 2 seconds", async () => {
    const started = Date.now();
    const dir = await tempDir("doodle-e2e-loop-");
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const store = new BoardStore(path.join(dir, "output"));
    await store.init();
    const revisions = new BoardRevisionCache();
    const server = new BoardHttpServer(store, {
      previewHost: "127.0.0.1",
      previewPort: port,
      outputDir: path.join(dir, "output"),
      workspaceRoot: dir,
      cwd: dir,
    }, revisions);
    await server.start();

    try {
      // 1. AI draws an initial node via the unified pipeline
      const aiDraw = await commitBoardWrite({
        store,
        revisions,
        author: "ai",
        change: (current) => addBoardItem(current, {
          type: "rect", x: 40, y: 40, w: 180, h: 90, text: "API 网关", author: "ai",
        }),
      });
      const aiRev = aiDraw.board.revision;

      // 2. Human browser fetches the page token and board
      const html = await fetch(base).then((r) => r.text());
      const token = html.match(/const PANEL_TOKEN = "([^"]+)"/)?.[1];
      let clientSnapshot = await fetch(`${base}/api/board`).then((r) => r.json());
      const sendBatch = async (nextItems, baseSnap) => {
        const diff = diffBoardItems(baseSnap.items, nextItems);
        const response = await fetch(`${base}/api/board/batch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-AI-Draw-Token": token,
            "If-Match-Revision": String(baseSnap.revision),
          },
          body: JSON.stringify({
            confirmedBy: "human",
            items: diff.added,
            updates: diff.updated,
            remove_ids: diff.removed,
          }),
        });
        expect(response.status).toBe(200);
        return (await response.json()).board;
      };

      // 3. Human creates a new box in Excalidraw (local id `ex_box_1`)
      const aiItem = clientSnapshot.items[0];
      const sceneAfterCreate = [
        { id: aiItem.id, type: "rectangle", x: aiItem.x, y: aiItem.y, width: aiItem.w, height: aiItem.h, backgroundColor: aiItem.color },
        { id: `${aiItem.id}_text`, type: "text", containerId: aiItem.id, x: 50, y: 60, width: 160, height: 40, text: aiItem.text },
        { id: "ex_box_1", type: "rectangle", x: 300, y: 40, width: 160, height: 80, backgroundColor: "#f6d365" },
      ];
      const projected1 = boardItemsFromExcalidrawBoard(clientSnapshot, sceneAfterCreate);
      const afterCreate = await sendBatch(projected1.items, clientSnapshot);
      const createdServerItem = afterCreate.items.find((i) => i.id !== aiItem.id);
      expect(createdServerItem).toBeDefined();

      // 4. Human immediately drags that newly created box (Excalidraw still holds `ex_box_1`)
      const sceneAfterMove = [
        sceneAfterCreate[0],
        sceneAfterCreate[1],
        { ...sceneAfterCreate[2], x: 420, y: 90 },
      ];
      const projected2 = boardItemsFromExcalidrawBoard(afterCreate, sceneAfterMove);
      const afterMove = await sendBatch(projected2.items, afterCreate);
      // Server id must stay stable — no delete + recreate drift
      expect(afterMove.items.map((i) => i.id)).toEqual(afterCreate.items.map((i) => i.id));
      expect(afterMove.items.find((i) => i.id === createdServerItem.id)).toMatchObject({ x: 420, y: 90 });

      // 5. Host model context publishes an incremental delta from AI rev → human rev
      const context = buildBoardModelContext(afterMove, aiDraw.board);
      expect(context.structuredContent.delta.baseRevision).toBe(aiRev);
      expect(context.structuredContent.delta.added.map((i) => i.id)).toEqual([createdServerItem.id]);

      // 6. Human deletes the AI box and then deletes their own box (board becomes empty)
      const projectedDelAi = boardItemsFromExcalidrawBoard(afterMove, [sceneAfterMove[2]]);
      const afterDelAi = await sendBatch(projectedDelAi.items, afterMove);
      const handoffAfterDelAi = describeHandoff(afterDelAi, aiDraw.board);
      expect(handoffAfterDelAi.needsAttention).toBe(true);
      expect(handoffAfterDelAi.humanEdits.some((e) => e.id === aiItem.id && e.change === "removed")).toBe(true);

      const afterClearAll = await sendBatch([], afterDelAi);
      expect(afterClearAll.items).toHaveLength(0);

      // Observable latency budget: full round-trip well under 2 seconds
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      await server.stop();
    }
  });
});
