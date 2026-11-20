import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";
import { BoardHttpServer } from "../dist/board/http/server.js";
import { BoardRevisionCache } from "../dist/board/state/revision-cache.js";
import { BoardStore } from "../dist/board/state/store.js";
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
const revisions = new BoardRevisionCache();
const preview = new BoardHttpServer(board, {
  previewHost: "127.0.0.1",
  previewPort: port,
  outputDir: path.join(tempDir, "output"),
  workspaceRoot: tempDir,
  cwd: tempDir,
}, revisions);
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
    expect(html).toContain("body.doodle-drawer-open .doodle-topbar");
    expect(html).not.toContain("body.doodle-drawer-open .excalidraw-host > .excalidraw");
    expect(html).toContain("body:has(.excalidraw .dropdown-menu) .doodle-topbar");
    expect(html).toContain("body:has(.excalidraw .Modal) .doodle-topbar");
    expect(html).toContain(".doodle-library-section--boards");
    expect(html).toContain(".doodle-library-section--shares");
    /*
     * Library drawer information architecture.
     *
     * The panel used to carry six equal buttons plus two more below the list,
     * all on one grid: "另存为" and "复制所选" were the same operation under two
     * labels, and "重命名" read from the name field but sat rows away from it.
     * These assertions pin the grouping that replaced it, so a future edit
     * cannot quietly reintroduce the flat button wall.
     */
    expect(html).toContain('class="doodle-library-rename"');
    expect(html).toContain('id="doodleLibraryRename"');
    expect(html).toContain('class="doodle-library-sectionhead"');
    expect(html).toContain('data-library-action="duplicate">另存一份');
    expect(html).not.toContain('data-library-action="duplicate-selected"');
    // Opening a board is a single click on its row; the separate switch button
    // and the three-way select/double-click/switch dance are gone.
    expect(html).not.toContain('id="doodleLibrarySwitch"');
    // Per-row actions are built in the client, so assert the rule that styles
    // them rather than markup that only exists after render.
    expect(html).toContain(".doodle-library-entry-actions");
    expect(html.indexOf('href="/excalidraw/index.css"')).toBeLessThan(html.indexOf("<style>"));
    expect(html).toContain(".excalidraw .HelpDialog__header { display: none; }");
    expect(html).toContain("--color-primary: #2f6b5c");
    expect(html).toContain("--color-primary: #8fcbb4");
    expect(html).not.toContain("--color-primary: #6965db");
    const snapshot = await fetch(`${base}/api/board`).then((response) => response.json());
    expect(snapshot).toMatchObject({ version: 1 });
    expect(snapshot.library).toMatchObject({ version: 1 });
    expect(snapshot.capabilities.layouts).toContain("cluster");
    expect(snapshot.capabilities.canvasEngine).toBe("excalidraw");
    expect(snapshot.capabilities.sharingExports).toEqual(["png", "jpg", "svg"]);
    expect(snapshot.capabilities.sharingExportOwner).toBe("human-canvas");
    expect(snapshot.visualDigest).toMatchObject({ version: 1 });
  });

  it("lets the browser cache hashed assets while unhashed ones revalidate", async () => {
    /*
     * Every static file used to be `no-store`, including the 1.4 MB app bundle
     * and the 1.8 MB Excalidraw engine chunk, so each reload re-downloaded the
     * whole canvas. Build output is content-hashed, which is exactly the case
     * where a long immutable cache cannot go stale; Excalidraw's own
     * `index.css` is not, so it revalidates instead.
     *
     * Revalidation is pinned as a 304 rather than a re-read: an ETag that only
     * ever misses would preserve the download it was meant to remove.
     */
    const assetsDir = path.join(process.cwd(), "dist", "infra", "templates", "excalidraw");
    const hashed = (await fs.readdir(assetsDir)).find((name) => /^chunk-[A-Z0-9]{8}\.js$/.test(name));
    expect(hashed, "the build emits a content-hashed chunk").toBeTruthy();
    const hashedResponse = await fetch(`${base}/excalidraw/${hashed}`);
    expect(hashedResponse.status).toBe(200);
    expect(hashedResponse.headers.get("cache-control")).toContain("immutable");
    const hashedEtag = hashedResponse.headers.get("etag");
    expect(hashedEtag).toBeTruthy();
    const revalidated = await fetch(`${base}/excalidraw/${hashed}`, { headers: { "if-none-match": hashedEtag } });
    expect(revalidated.status).toBe(304);

    const css = await fetch(`${base}/excalidraw/index.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("cache-control")).toBe("no-cache");
  });

  it("merges a stale batch that only adds objects", async () => {
    // The same bug the MCP path had: `touched` is empty for an add-only
    // request, and treating that as a conflict rejected the commonest
    // concurrent write — a person and an agent each drawing a new note.
    const html = await fetch(base).then((response) => response.text());
    const token = html.match(/const PANEL_TOKEN = "([^"]+)"/)?.[1];
    const batch = async (body, revision) => {
      const response = await fetch(`${base}/api/board/batch`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ai-draw-token": token, "If-Match-Revision": String(revision) },
        body: JSON.stringify({ confirmedBy: "human", ...body }),
      });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    };

    const first = await fetch(`${base}/api/board`).then((response) => response.json());
    const pinned = first.revision;

    // Someone else writes, so the pinned revision goes stale...
    const then = await batch({ items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "someone else" }] }, pinned);
    expect(then.status).toBe(200);

    // ...and an add-only write against the stale revision still lands.
    const mine = await batch({ items: [{ type: "note", x: 300, y: 0, w: 160, h: 90, text: "mine" }] }, pinned);
    expect(mine.status).toBe(200);
    expect(mine.body.mergedFrom).toBe(pinned);
    const items = mine.body.board.items.map((item) => item.text);
    expect(items).toContain("someone else");
    expect(items).toContain("mine");
  });

  it("answers a bad canvas write with 400 and a field, not 500", async () => {
    // `(error as NodeJS.ErrnoException).code` treated `INVALID_COLOR` as a
    // filesystem failure, so the canvas got a 500 "Unable to persist board
    // changes" for a client mistake — a server error that named no field.
    const html = await fetch(base).then((response) => response.text());
    const token = html.match(/const PANEL_TOKEN = "([^"]+)"/)?.[1];
    const response = await fetch(`${base}/api/board/items`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ai-draw-token": token },
      body: JSON.stringify({
        confirmedBy: "human",
        item: { type: "rect", x: 0, y: 0, w: 100, h: 100, text: "x", color: "nope" },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "INVALID_COLOR", path: "items[].color" });
    expect(typeof body.fix).toBe("string");
  });

  it("answers a bad library action with 400 and a code, not 500", async () => {
    // The library route had no error handler, so switching to an unknown board
    // surfaced as 500 "Internal server error" while the specific message —
    // which board ids exist — went only to stderr.
    const html = await fetch(base).then((response) => response.text());
    const token = html.match(/const PANEL_TOKEN = "([^"]+)"/)?.[1];
    const response = await fetch(`${base}/api/board/library`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ai-draw-token": token },
      body: JSON.stringify({ confirmedBy: "human", action: { type: "switch", id: "ghost" } }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "BOARD_NOT_FOUND", path: "library.id" });
    expect(body.error).toContain("ghost");
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

  it("generates a semantic diagram through the local HTTP diagram API", async () => {
    const html = await fetch(base).then((response) => response.text());
    const token = html.match(/const PANEL_TOKEN = "([^"]+)"/)?.[1];
    const before = await fetch(`${base}/api/board`).then((response) => response.json());
    const result = await fetch(`${base}/api/board/diagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AI-Draw-Token": token, "If-Match-Revision": String(before.revision) },
      body: JSON.stringify({
        confirmedBy: "human",
        diagram: {
          title: "HTTP Diagram",
          nodes: [{ id: "n1", label: "A" }, { id: "n2", label: "B" }],
          edges: [{ from: "n1", to: "n2", label: "next" }],
        },
      }),
    }).then((response) => response.json());
    expect(result.ok).toBe(true);
    expect(result.board.title).toBe("HTTP Diagram");
    expect(result.board.items.some((item) => item.id === "n1")).toBe(true);
    expect(result.board.items.some((item) => item.id === "diagram_frame")).toBe(true);
    expect(result.board.items.some((item) => item.type === "line" && item.startItemId === "n1" && item.endItemId === "n2")).toBe(true);
    expect(result.board.items.some((item) => item.id === "n1_label")).toBe(false);
    expect((await fetch(`${base}/api/board/scene`).then((response) => response.status))).toBe(404);
    const invalid = await fetch(`${base}/api/board/diagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AI-Draw-Token": token },
      body: JSON.stringify({
        confirmedBy: "human",
        diagram: { nodes: [{ id: "a", label: "A" }, { id: "a", label: "Duplicate" }], edges: [] },
      }),
    });
    expect(invalid.status).toBe(400);
    const oversized = await fetch(`${base}/api/board/diagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AI-Draw-Token": token },
      body: JSON.stringify({
        confirmedBy: "human",
        diagram: {
          nodes: Array.from({ length: 49 }, (_, index) => ({ id: `n${index}`, label: `N${index}` })),
          edges: [],
        },
      }),
    });
    expect(oversized.status).toBe(400);
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
    expect(appText).toContain("https://github.com/2648782102/Doodle");
    expect(appText).toContain("library-menu-browse-button");
    expect(appText).not.toContain("MainMenu.DefaultItems");
    expect(html).toContain(".excalidraw .main-menu-trigger");
    expect(html).toContain(".excalidraw .Island.sidebar {");
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

  it("refuses to let a client bug erase the board, but still allows a deliberate delete", async () => {
    const html = await fetch(base).then((response) => response.text());
    const token = html.match(/const PANEL_TOKEN = "([^"]+)"/)?.[1];
    const before = await fetch(`${base}/api/board`).then((response) => response.json());
    const seeded = await board.mutate((current) => addBoardItem(current, {
      type: "note", x: 0, y: 0, w: 160, h: 90, text: "keep me", author: "human",
    }));
    const revision = seeded.revision;

    const cleared = await fetch(`${base}/api/board/replace`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AI-Draw-Token": token,
        "If-Match-Revision": String(revision),
      },
      body: JSON.stringify({
        confirmedBy: "human",
        board: { ...seeded, revision: revision + 1, items: [] },
      }),
    });
    expect(cleared.status).toBe(409);
    expect(await cleared.text()).toContain("Refusing to clear");

    // The guard must not depend on an optional header. A client that does not
    // track revisions (a stale canvas after reload) used to bypass it entirely
    // and erase the board.
    const clearedWithoutHeader = await fetch(`${base}/api/board/replace`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AI-Draw-Token": token,
      },
      body: JSON.stringify({
        confirmedBy: "human",
        board: { ...seeded, revision: revision + 2, items: [] },
      }),
    });
    expect(clearedWithoutHeader.status).toBe(409);
    expect(await clearedWithoutHeader.text()).toContain("Refusing to clear");

    const intact = await fetch(`${base}/api/board`).then((response) => response.json());
    expect(intact.items.some((entry) => entry.text === "keep me")).toBe(true);

    // A deliberate removal by id is still allowed.
    const target = intact.items.find((entry) => entry.text === "keep me");
    const removed = await fetch(`${base}/api/board/items/${target.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "X-AI-Draw-Token": token },
      body: JSON.stringify({ confirmedBy: "human" }),
    });
    expect(removed.status).toBe(200);
    expect(before.version).toBe(1);
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

  it("records browser writes in the shared revision cache", async () => {
    // A person drawing in the canvas writes over HTTP. `get_board` then asks
    // for `since_revision`, and without this the cache had never seen the
    // revision, so the delta path silently degraded to a full board on exactly
    // the edits it should describe.
    const html = await fetch(base).then((response) => response.text());
    const token = html.match(/const PANEL_TOKEN = "([^"]+)"/)?.[1];
    const current = await board.snapshot();
    const created = await fetch(`${base}/api/board/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AI-Draw-Token": token,
        "If-Match-Revision": String(current.revision),
      },
      body: JSON.stringify({
        confirmedBy: "human",
        item: { type: "text", x: 10, y: 10, w: 120, h: 24, text: "from browser" },
      }),
    }).then((response) => response.json());

    expect(revisions.get(created.board.revision)).toBeDefined();
    expect(revisions.get(created.board.revision).items.some((item) => item.text === "from browser")).toBe(true);
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

describe("object-level conflict handling", () => {
  const auth = async () => {
    const html = await fetch(base).then((response) => response.text());
    return html.match(/const PANEL_TOKEN = "([^"]+)"/)?.[1];
  };
  const post = (path, body, revision, token) => fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AI-Draw-Token": token,
      ...(revision === undefined ? {} : { "If-Match-Revision": String(revision) }),
    },
    body: JSON.stringify(body),
  });

  it("merges a stale batch that touches objects nobody else moved, and names the overlap otherwise", async () => {
    const token = await auth();
    const rev0 = (await fetch(`${base}/api/board`).then((response) => response.json())).revision;

    const created = await post("/api/board/batch", {
      confirmedBy: "human",
      items: [
        { type: "rect", x: 10, y: 10, w: 100, h: 60, text: "conflict-a" },
        { type: "rect", x: 10, y: 200, w: 100, h: 60, text: "conflict-b" },
      ],
    }, rev0, token).then((response) => response.json());
    const rev1 = created.board.revision;
    const a = created.board.items.find((item) => item.text === "conflict-a");
    const b = created.board.items.find((item) => item.text === "conflict-b");

    // Somebody else moves A while our canvas still holds rev1.
    const moved = await post("/api/board/batch", {
      confirmedBy: "human",
      updates: [{ id: a.id, patch: { ...a, x: 60 } }],
    }, rev1, token).then((response) => response.json());
    expect(moved.ok).toBe(true);

    // Moving B from rev1 must land: nothing else touched B.
    const mergedResponse = await post("/api/board/batch", {
      confirmedBy: "human",
      updates: [{ id: b.id, patch: { ...b, y: 240 } }],
    }, rev1, token);
    expect(mergedResponse.status).toBe(200);
    const merged = await mergedResponse.json();
    expect(merged.mergedFrom).toBe(rev1);

    const afterMerge = await fetch(`${base}/api/board`).then((response) => response.json());
    expect(afterMerge.items.find((item) => item.id === a.id).x).toBe(60);
    expect(afterMerge.items.find((item) => item.id === b.id).y).toBe(240);

    // Touching A from the same stale base must refuse, and name the object.
    const conflict = await post("/api/board/batch", {
      confirmedBy: "human",
      updates: [{ id: a.id, patch: { ...a, x: 999 } }],
    }, rev1, token);
    expect(conflict.status).toBe(409);
    const body = await conflict.json();
    expect(body.code).toBe("REVISION_CONFLICT_OBJECTS");
    expect(body.conflicts).toEqual([a.id]);
    expect(body.expectedRevision).toBe(afterMerge.revision);

    // Single-item PATCH/DELETE and whole-board replace must not bypass conflict checks.
    const stalePatch = await fetch(`${base}/api/board/items/${a.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-AI-Draw-Token": token,
        "If-Match-Revision": String(rev1),
      },
      body: JSON.stringify({ confirmedBy: "human", patch: { x: 777 } }),
    });
    expect(stalePatch.status).toBe(409);
    expect((await stalePatch.json()).conflicts).toEqual([a.id]);

    const staleReplace = await post("/api/board/replace", {
      confirmedBy: "human",
      board: { ...afterMerge, revision: rev1 + 1 },
    }, rev1, token);
    expect(staleReplace.status).toBe(409);

    // Whole-board layout (without layout.ids) must also conflict if an item was added concurrently.
    const added = await post("/api/board/batch", {
      confirmedBy: "human",
      items: [{ type: "rect", x: 300, y: 10, w: 100, h: 60, text: "conflict-c" }],
    }, afterMerge.revision, token).then((r) => r.json());
    const staleLayout = await post("/api/board/batch", {
      confirmedBy: "human",
      layout: { mode: "grid" },
    }, afterMerge.revision, token);
    expect(staleLayout.status).toBe(409);
    expect((await staleLayout.json()).conflicts).toContain(added.board.items.find((i) => i.text === "conflict-c").id);
  });

  it("allows deleting the very last object via DELETE and batch remove_ids", async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-last-delete-"));
    const isolatedPort = await freePort();
    const isolatedBase = `http://127.0.0.1:${isolatedPort}`;
    const isolatedBoard = new BoardStore(path.join(isolatedDir, "output"));
    await isolatedBoard.init();
    const isolatedServer = new BoardHttpServer(isolatedBoard, {
      previewHost: "127.0.0.1",
      previewPort: isolatedPort,
      outputDir: path.join(isolatedDir, "output"),
      workspaceRoot: isolatedDir,
      cwd: isolatedDir,
    }, new BoardRevisionCache());
    await isolatedServer.start();
    try {
      const html = await fetch(isolatedBase).then((r) => r.text());
      const token = html.match(/const PANEL_TOKEN = "([^"]+)"/)?.[1];
      const one = await fetch(`${isolatedBase}/api/board/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AI-Draw-Token": token },
        body: JSON.stringify({ confirmedBy: "human", item: { type: "note", x: 0, y: 0, text: "only" } }),
      }).then((r) => r.json());
      const lastId = one.board.items[0].id;

      const delLast = await fetch(`${isolatedBase}/api/board/items/${lastId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-AI-Draw-Token": token },
        body: JSON.stringify({ confirmedBy: "human" }),
      });
      expect(delLast.status).toBe(200);
      expect((await delLast.json()).board.items).toHaveLength(0);

      const again = await fetch(`${isolatedBase}/api/board/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AI-Draw-Token": token },
        body: JSON.stringify({ confirmedBy: "human", item: { type: "note", x: 0, y: 0, text: "only-2" } }),
      }).then((r) => r.json());
      const batchDel = await fetch(`${isolatedBase}/api/board/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AI-Draw-Token": token,
          "If-Match-Revision": String(again.board.revision),
        },
        body: JSON.stringify({ confirmedBy: "human", remove_ids: [again.board.items[0].id] }),
      });
      expect(batchDel.status).toBe(200);
      expect((await batchDel.json()).board.items).toHaveLength(0);
    } finally {
      await isolatedServer.stop();
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });
});

describe("HTTP and WebSocket security boundaries", () => {
  it("returns structured 400 on invalid project scan bounds", async () => {
    const response = await fetch(`${base}/api/board/project?max_depth=99`);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("SCAN_RANGE_OUT_OF_RANGE");
    expect(body.path).toBe("max_depth");
  });

  it("rejects sibling-prefix path traversal and cross-origin writes or WebSockets", async () => {
    const { isPathWithinRoot } = await import("../dist/board/http/security.js");
    expect(isPathWithinRoot("/tmp/templates/excalidraw", "/tmp/templates/excalidraw/index.css")).toBe(true);
    expect(isPathWithinRoot("/tmp/templates/excalidraw", "/tmp/templates/excalidraw.html")).toBe(false);
    expect(isPathWithinRoot("/tmp/templates/excalidraw", "/tmp/templates/excalidraw-app.tsx")).toBe(false);

    const html = await fetch(base).then((r) => r.text());
    const token = html.match(/const PANEL_TOKEN = "([^"]+)"/)?.[1];
    const crossOriginWrite = await fetch(`${base}/api/board/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AI-Draw-Token": token,
        Origin: "https://evil.example",
      },
      body: JSON.stringify({ confirmedBy: "human", item: { type: "note", x: 0, y: 0, text: "x" } }),
    });
    expect(crossOriginWrite.status).toBe(403);

    const wsRejected = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: "https://evil.example" } });
      ws.once("unexpected-response", (_req, res) => resolve(res.statusCode));
      ws.once("open", () => { ws.close(); resolve(101); });
      ws.once("error", () => resolve(403));
    });
    expect(wsRejected).not.toBe(101);
  });
});
