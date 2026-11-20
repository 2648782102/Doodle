/**
 * Browser-level contract for the human canvas.
 *
 * Everything else in `test/` runs in Node: model, HTTP, MCP, adapter. That
 * covers the protocol but not the page — so an Excalidraw upgrade could remove
 * `.App-toolbar` and every suite would stay green while the canvas rendered
 * wrong. These are four assertions, not an E2E suite: each one fails for a
 * reason a person would otherwise discover first.
 *
 * Opt-in as `npm run test:browser`. It needs a Chromium download, so it is
 * excluded from `npm run check` and from the default `npm test`.
 */

import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-browser-"));

/**
 * Excalidraw internals Doodle's CSS depends on, split by when they exist.
 *
 * If one disappears, the chrome silently loses its styling instead of failing —
 * so assert them by name. The two below are conditional: Excalidraw only renders
 * `.App-bottom-bar` below its mobile breakpoint, and `.dropdown-menu` exists
 * while a menu is open, so asserting them on a desktop page would be a false
 * failure.
 */
const DEPENDED_SELECTORS = [
  ".excalidraw",
  ".App-toolbar",
  ".Island",
  ".layer-ui__wrapper",
  ".ToolIcon",
  ".App-menu_top",
];

/** Rendered only under the mobile breakpoint. */
const MOBILE_SELECTORS = [".App-bottom-bar"];

/** Rendered only while a dropdown is open. */
const MENU_SELECTORS = [".dropdown-menu"];

let browser;
let page;
let server;
let panelUrl;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** One MCP connection owns the server lifetime; the browser only reads its page. */
async function startBoard() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: {
      ...process.env,
      PREVIEW_PORT: String(await freePort()),
      LOG_LEVEL: "error",
      OUTPUT_DIR: tempDir,
      DOODLE_WORKSPACE_ROOT: process.cwd(),
    },
  });
  const client = new Client({ name: "doodle-browser-contract", version: "1.0.0" });
  await client.connect(transport);
  const text = (await client.callTool({ name: "get_board", arguments: {} }))
    .content.map((part) => part.text ?? "").join("\n");
  const url = text.match(/PANEL_URL: (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
  if (!url) throw new Error("PANEL_URL missing from get_board");
  return { client, url };
}

beforeAll(async () => {
  const started = await startBoard();
  server = started.client;
  panelUrl = started.url;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(panelUrl, { waitUntil: "domcontentloaded" });
  // The canvas mounts asynchronously; wait for the engine, not a timeout.
  await page.waitForSelector(".excalidraw", { timeout: 30_000 });
  await page.waitForSelector("#doodleLibraryToggle", { timeout: 30_000 });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("human canvas contract", () => {
  it("keeps the Doodle top bar clear of Excalidraw's toolbar", async () => {
    // Both float at the top of the page. They overlapped once already, and a
    // bare screenshot would not catch a two-pixel regression on every width.
    const bars = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      return { doodle: rect("#doodleLibraryToggle"), excalidraw: rect(".App-toolbar") };
    });

    expect(bars.doodle).not.toBeNull();
    expect(bars.excalidraw).not.toBeNull();
    const overlaps = !(
      bars.doodle.x + bars.doodle.width <= bars.excalidraw.x
      || bars.excalidraw.x + bars.excalidraw.width <= bars.doodle.x
      || bars.doodle.y + bars.doodle.height <= bars.excalidraw.y
      || bars.excalidraw.y + bars.excalidraw.height <= bars.doodle.y
    );
    expect(overlaps).toBe(false);
  });

  it("keeps a card's id across create, move, and a second edit", async () => {
    // Id drift is silent: the board looks right and the AI loses every
    // reference it held. Check the id the *server* stores, not the canvas text.
    /*
     * The first-run welcome card sits over the centre of an empty board, so
     * double-clicking there hits the card, not the canvas. Dismiss it first —
     * that is what a person does — and use a point that is provably the canvas.
     */
    await page.evaluate(() => {
      const dismiss = document.querySelector("#doodleWelcome button, #doodleWelcome [role='button']");
      if (dismiss instanceof HTMLElement) dismiss.click();
      document.querySelector("#doodleWelcome")?.remove();
    });
    await page.mouse.dblclick(900, 600);
    await page.waitForTimeout(600);
    await page.keyboard.type("contract card");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);

    const afterCreate = (await server.callTool({ name: "get_board", arguments: { include_guide: false } }))
      .structuredContent;
    const card = afterCreate.items.find((item) => item.text === "contract card");
    expect(card, "the typed note reached the board").toBeTruthy();

    // Drag it, then edit again.
    await page.mouse.move(900, 600);
    await page.mouse.down();
    await page.mouse.move(1000, 660, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
    await page.mouse.dblclick(1000, 660);
    await page.waitForTimeout(400);
    await page.keyboard.type(" edited");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);

    const afterEdit = (await server.callTool({ name: "get_board", arguments: { include_guide: false } }))
      .structuredContent;
    const same = afterEdit.items.find((item) => item.id === card.id);
    expect(same, "the same id still exists after a move and a second edit").toBeTruthy();
    expect(same.text).toContain("edited");
  }, 60_000);

  it("lets the last object be deleted", async () => {
    // Regression #35: an empty board is a legitimate state, and the guard
    // against accidental clears must not block a deliberate delete.
    const before = (await server.callTool({ name: "get_board", arguments: { include_guide: false } }))
      .structuredContent;
    for (const item of before.items) {
      await server.callTool({ name: "draw_board", arguments: { author: "human", remove_ids: [item.id] } });
    }
    const after = (await server.callTool({ name: "get_board", arguments: { include_guide: false } }))
      .structuredContent;
    expect(after.itemCount).toBe(0);
  }, 30_000);

  it("still has every Excalidraw internal the chrome styles", async () => {
    // The whole reason this file exists: an upstream upgrade that renames
    // `.App-toolbar` must fail here, not in a person's browser.
    const present = await page.evaluate((selectors) => {
      return selectors.filter((selector) => document.querySelector(selector) === null);
    }, DEPENDED_SELECTORS);

    expect(present, `missing Excalidraw internals: ${present.join(", ")}`).toEqual([]);
  });

  it("still has the internals that only appear on a mobile load", async () => {
    /*
     * Excalidraw decides its mobile layout once, at mount: resizing a desktop
     * page down to 390px never adds `excalidraw--mobile`. That is a property of
     * the engine, not a bug to work around, so this assertion opens a page that
     * starts at phone width.
     */
    const mobilePage = await browser.newPage({ viewport: { width: 390, height: 780 } });
    try {
      await mobilePage.goto(panelUrl, { waitUntil: "domcontentloaded" });
      await mobilePage.waitForSelector(".excalidraw--mobile", { timeout: 30_000 });
      for (const selector of MOBILE_SELECTORS) {
        await mobilePage.waitForSelector(selector, { state: "visible", timeout: 15_000 });
      }
    } finally {
      await mobilePage.close();
    }
  }, 60_000);
});
