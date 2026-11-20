import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { BoardHttpServer } from "../dist/board/http/server.js";
import { BoardStore } from "../dist/board/state/store.js";

/**
 * First-paint budgets.
 *
 * Issue #22 asked for a startup and first-paint budget that CI can observe.
 * Artifact size alone does not answer it: a 14 MB `dist` is fine if the browser
 * only needs the shell and the entry chunk to paint, and a small one is not if
 * the first screen waits on the whole engine. So this measures the bytes the
 * canvas actually asks for before it can draw, plus a very loose wall-clock
 * ceiling that would only fail on a pathological regression (a per-request scan
 * of the font tree, a synchronous re-read of every asset).
 *
 * The ceilings are budgets, not measurements: they sit well above today's
 * numbers so that ordinary growth passes and a real regression does not.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUDGETS = {
  htmlBytes: 200 * 1024,
  cssBytes: 400 * 1024,
  entryBytes: 4 * 1024 * 1024,
  /** Cold-loopback ceilings: generous enough for a loaded CI runner. */
  htmlMs: 3_000,
  entryMs: 6_000,
};

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

const hasTemplate = await fs.access(path.join(root, "dist", "infra", "templates", "excalidraw.html"))
  .then(() => true, () => false);

const tempDir = hasTemplate ? await fs.mkdtemp(path.join(os.tmpdir(), "doodle-startup-")) : null;
const port = hasTemplate ? await freePort() : 0;
const base = `http://127.0.0.1:${port}`;
let store = null;
let preview = null;
let revisions = null;

if (hasTemplate) {
  store = new BoardStore(path.join(tempDir, "output"));
  await store.init();
  const { BoardRevisionCache } = await import("../dist/board/state/revision-cache.js");
  revisions = new BoardRevisionCache();
  preview = new BoardHttpServer(store, {
    previewHost: "127.0.0.1",
    previewPort: port,
    outputDir: path.join(tempDir, "output"),
    workspaceRoot: tempDir,
    cwd: root,
  }, revisions);
  await preview.start();
}

afterAll(async () => {
  await preview?.stop().catch(() => {});
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

async function timed(url) {
  const started = Date.now();
  const response = await fetch(url);
  const body = await response.text();
  return { status: response.status, bytes: Buffer.byteLength(body), ms: Date.now() - started };
}

describe.skipIf(!hasTemplate)("canvas first paint", () => {
  it("serves the shell and the entry chunk inside their budgets", async () => {
    const html = await timed(`${base}/`);
    expect(html.status).toBe(200);
    expect(html.bytes).toBeLessThan(BUDGETS.htmlBytes);
    expect(html.ms).toBeLessThan(BUDGETS.htmlMs);

    const css = await timed(`${base}/excalidraw/index.css`);
    expect(css.status).toBe(200);
    expect(css.bytes).toBeLessThan(BUDGETS.cssBytes);

    const entry = await timed(`${base}/excalidraw/excalidraw-app.js`);
    expect(entry.status).toBe(200);
    expect(entry.bytes).toBeGreaterThan(1_000);
    expect(entry.bytes).toBeLessThan(BUDGETS.entryBytes);
    expect(entry.ms).toBeLessThan(BUDGETS.entryMs);
  });

  it("keeps the sync state and conflict surfaces in the shipped shell", async () => {
    const html = await (await fetch(`${base}/`)).text();
    // The chip is the answer to "is this saved, and did the agent see it?".
    expect(html).toContain('id="doodleSyncState"');
    expect(html).toContain("data-sync-label");
    expect(html).toContain("data-sync-detail");
    // A conflict is a decision: it needs a container that stays and two ways out.
    expect(html).toContain('id="doodleConflictNotice"');
    expect(html).toContain("data-conflict-actions");
    expect(html).not.toMatch(/id="doodleSyncState"[^>]*hidden/);
    // The two choices are built at runtime; esbuild escapes non-ASCII in the
    // minified chunk, so assert them where they are authored rather than in bytes.
    const app = await fs.readFile(path.join(root, "src", "infra", "templates", "excalidraw-app.tsx"), "utf8");
    expect(app).toContain("载入最新");
    expect(app).toContain("保留我的");
    expect(app).toContain("REVISION_CONFLICT_OBJECTS");
  });

  it("serves the same shell to the plugin and the standalone page", async () => {
    const standalone = await (await fetch(`${base}/`)).text();
    const pluginShell = await fs.readFile(path.join(root, "plugins", "doodle", "server", "infra", "templates", "excalidraw.html"), "utf8").catch(() => null);
    if (!pluginShell) return;
    // Same template source, so a surface added to one path cannot be missing on the other.
    expect(pluginShell).toContain('id="doodleSyncState"');
    expect(pluginShell).toContain('id="doodleConflictNotice"');
    expect(standalone).toContain('id="doodleSyncState"');
  });
});
