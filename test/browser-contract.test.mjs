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
async function startBoard(outputDir = tempDir) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: {
      ...process.env,
      PREVIEW_PORT: String(await freePort()),
      LOG_LEVEL: "error",
      OUTPUT_DIR: outputDir,
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
  it("retires the welcome card when the first object is drawn through it", async () => {
    /*
     * A newcomer does not have to press 开始画. Drawing straight onto the empty
     * board is a valid first move, and leaving the card up then covers the very
     * object they just made. Use a fresh page: the shared page below has already
     * dismissed the card by the time its cases run.
     */
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const firstPage = await context.newPage();
    try {
      await firstPage.goto(panelUrl, { waitUntil: "domcontentloaded" });
      await firstPage.waitForSelector("#doodleWelcome:not([hidden])", { timeout: 30_000 });
      await firstPage.mouse.dblclick(900, 600);
      await firstPage.keyboard.type("first object");
      await firstPage.keyboard.press("Escape");
      await firstPage.waitForFunction(() => document.querySelector("#doodleWelcome")?.hidden === true, { timeout: 10_000 });
      expect(await firstPage.evaluate(() => localStorage.getItem("doodle-welcome-dismissed"))).toBe("1");
      const boxes = await firstPage.evaluate(() => {
        const welcome = document.querySelector("#doodleWelcome");
        const text = [...document.querySelectorAll(".excalidraw text, .excalidraw [data-testid*='text']")]
          .find((element) => element.textContent?.includes("first object"));
        return { welcomeHidden: welcome?.hidden === true, textVisible: Boolean(text) };
      });
      expect(boxes.welcomeHidden, "the card still covers the first object").toBe(true);
    } finally {
      await context.close();
    }
  }, 60_000);

  it("retires the welcome card when the agent draws the first object", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const firstPage = await context.newPage();
    try {
      await firstPage.goto(panelUrl, { waitUntil: "domcontentloaded" });
      await firstPage.waitForSelector("#doodleWelcome:not([hidden])", { timeout: 30_000 });
      await server.callTool({
        name: "draw_board",
        arguments: { items: [{ type: "note", x: 120, y: 120, w: 180, h: 80, text: "agent first" }] },
      });
      await firstPage.waitForFunction(() => document.querySelector("#doodleWelcome")?.hidden === true, { timeout: 10_000 });
      expect(await firstPage.evaluate(() => localStorage.getItem("doodle-welcome-dismissed"))).toBe("1");
    } finally {
      await context.close();
    }
  }, 60_000);

  it("introduces the shortcut panel once after the welcome card retires", async () => {
    /*
     * The two panels are complementary, not simultaneous: the card teaches
     * gestures on a truly empty board, then the `?` list introduces itself on
     * the next visit. Neither should keep appearing after that.
     */
    /*
     * The shared board has content by now, which correctly suppresses the
     * welcome card. A clean OUTPUT_DIR is the only honest way to test the
     * first-visit sequence without depending on case order.
     */
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-browser-welcome-"));
    const emptyServer = await startBoard(emptyDir);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const firstPage = await context.newPage();
    try {
      await firstPage.goto(emptyServer.url, { waitUntil: "domcontentloaded" });
      await firstPage.waitForSelector("#doodleWelcome:not([hidden])", { timeout: 30_000 });
      await firstPage.click("#doodleWelcomeDismiss");
      expect(await firstPage.evaluate(() => document.querySelector("#doodleShortcuts")?.hidden)).toBe(true);

      await firstPage.reload({ waitUntil: "domcontentloaded" });
      await firstPage.waitForSelector("#doodleShortcuts:not([hidden])", { timeout: 30_000 });
      expect(await firstPage.evaluate(() => localStorage.getItem("doodle-shortcuts-seen"))).toBe("1");

      await firstPage.reload({ waitUntil: "domcontentloaded" });
      await firstPage.waitForSelector(".excalidraw", { timeout: 30_000 });
      await firstPage.waitForTimeout(600);
      expect(await firstPage.evaluate(() => {
        const card = document.querySelector("#doodleWelcome");
        const panel = document.querySelector("#doodleShortcuts");
        return (card?.hidden ?? true) && (panel?.hidden ?? true);
      }), "both first-use surfaces should stay retired").toBe(true);
    } finally {
      await context.close();
      await emptyServer.client.close();
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  }, 60_000);

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

  it("lets a keyboard user reach the Doodle controls", async () => {
    /*
     * The chrome is a toolbar plus buttons; keyboard users must be able to
     * reach it without a mouse. Focus starts at the document so the test does
     * not inherit whatever the previous case left selected.
     */
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    const seen = new Set();
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      seen.add(await page.evaluate(() => document.activeElement?.id || ""));
      if (seen.has("doodleLibraryToggle") && seen.has("doodleShortcutToggle")) break;
    }
    expect(seen.has("doodleLibraryToggle"), "图库 button is not tabbable").toBe(true);
    expect(seen.has("doodleShortcutToggle"), "? help button is not tabbable").toBe(true);
    expect(await page.locator("[data-theme-option]").count()).toBe(3);
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
      /*
       * Hide it; do not remove it. A later case asserts that page notices are
       * hidden while the drawer is open, and removing the node here made that
       * assertion fail with "missing" — an ordering bug in the test, not the page.
       */
      const card = document.querySelector("#doodleWelcome");
      if (card instanceof HTMLElement) card.hidden = true;
    });
    /*
     * Poll the server instead of sleeping a fixed time.
     *
     * The write is debounced 450 ms and then round-trips through the MCP tool,
     * so a fixed delay passes alone and fails when the machine is busy — a
     * flaky contract test is worse than none, because it teaches people to
     * rerun CI.
     */
    const waitForBoard = async (predicate, what) => {
      const deadline = Date.now() + 15_000;
      let last;
      while (Date.now() < deadline) {
        last = (await server.callTool({ name: "get_board", arguments: { include_guide: false } })).structuredContent;
        if (predicate(last)) return last;
        await page.waitForTimeout(250);
      }
      throw new Error(`timed out waiting for ${what}; board has ${last?.itemCount} objects`);
    };

    await page.mouse.dblclick(900, 600);
    await page.waitForTimeout(600);
    await page.keyboard.type("contract card");
    await page.keyboard.press("Escape");

    const afterCreate = await waitForBoard(
      (board) => board.items.some((item) => item.text === "contract card"),
      "the typed note to reach the board",
    );
    const card = afterCreate.items.find((item) => item.text === "contract card");
    expect(card, "the typed note reached the board").toBeTruthy();

    // Drag it, then edit again.
    /*
     * Drag from the card's centre, not the point it was created at.
     *
     * Double-click places a text element with `(900, 600)` as its top-left and
     * measures it from the content — a single line comes out about 134×25, so
     * pressing at exactly (900, 600) lands on the corner and the drag misses.
     * The stored box is the source of truth for where the middle is.
     */
    const centre = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
    await page.mouse.click(centre.x, centre.y);
    await page.waitForTimeout(400);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    for (const step of [0.2, 0.4, 0.6, 0.8, 1]) {
      await page.mouse.move(centre.x + 100 * step, centre.y + 60 * step, { steps: 3 });
    }
    await page.mouse.up();
    // The move must persist before the second edit, or the edit races it.
    await waitForBoard((board) => {
      const moved = board.items.find((item) => item.id === card.id);
      return moved && (moved.x !== card.x || moved.y !== card.y);
    }, "the drag to persist");
    await page.mouse.dblclick(centre.x + 100, centre.y + 60);
    await page.waitForTimeout(400);
    await page.keyboard.type(" edited");
    await page.keyboard.press("Escape");
    const afterEdit = await waitForBoard(
      (board) => board.items.some((item) => item.id === card.id && item.text.includes("edited")),
      "the second edit to persist",
    );
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

  it("keeps the library drawer keyboard-contained", async () => {
    /*
     * The drawer used to only animate. Focus stayed on `<body>`, Tab walked out
     * into the canvas behind the scrim, and closing dropped focus at the top of
     * the page — so a keyboard user could not reach the panel without tabbing
     * through the whole toolbar, and could not leave it once inside.
     */
    /*
     * Open it the way a person does.
     *
     * A programmatic `element.click()` leaves focus wherever it was — on the
     * canvas, in this case — so "return focus to the control that opened it"
     * could only ever be satisfied by accident. A real click focuses the button
     * first, which is the state the contract is about.
     */
    await page.click("#doodleLibraryToggle");
    await page.waitForSelector("#doodleLibraryPanel[aria-modal='true']", { timeout: 10_000 });
    const opened = await page.evaluate(() => document.activeElement?.id);
    expect(opened, "opening the drawer must move focus into it").toBe("doodleLibraryPanel");

    const escaped = [];
    for (let step = 0; step < 30; step += 1) {
      await page.keyboard.press("Tab");
      const outside = await page.evaluate(() => {
        const panel = document.querySelector("#doodleLibraryPanel");
        const active = document.activeElement;
        return !active || !panel?.contains(active);
      });
      if (outside) {
        escaped.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
        break;
      }
    }
    expect(escaped, "Tab escaped the open drawer").toEqual([]);

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("#doodleLibraryPanel")?.hidden === true, { timeout: 10_000 });
    const restored = await page.evaluate(() => document.activeElement?.id);
    expect(restored, "closing must return focus to the control that opened it").toBe("doodleLibraryToggle");
  }, 60_000);

  it("hides page notices behind the open drawer", async () => {
    /*
     * The welcome card and the error banner sit above the drawer in the z-order.
     * On a phone the drawer is the whole window, so the card landed in the middle
     * of the board list. The conflict bar is the exception: it is an unsaved
     * change waiting on a decision, so it stays above the panel.
     */
    await page.evaluate(() => {
      /*
       * The banner is created lazily on the first failure, so a quiet page has
       * none. Add the same node the app would, then prove the drawer hides it.
       */
      if (!document.querySelector("#doodleSyncBanner")) {
        const banner = document.createElement("div");
        banner.id = "doodleSyncBanner";
        banner.className = "doodle-sync-banner doodle-glass";
        document.body.append(banner);
      }
      for (const selector of ["#doodleWelcome", "#doodleSyncBanner"]) {
        const element = document.querySelector(selector);
        if (element instanceof HTMLElement) {
          element.hidden = false;
          element.dataset.visible = "true";
        }
      }
    });
    await page.click("#doodleLibraryToggle");
    await page.waitForSelector("#doodleLibraryPanel[aria-modal='true']", { timeout: 10_000 });

    const state = await page.evaluate(() => {
      const visibility = (selector) => {
        const element = document.querySelector(selector);
        return element ? getComputedStyle(element).visibility : "missing";
      };
      return { welcome: visibility("#doodleWelcome"), banner: visibility("#doodleSyncBanner") };
    });
    expect(state.welcome, "the welcome card still paints over the open drawer").toBe("hidden");
    expect(state.banner, "the error banner still paints over the open drawer").toBe("hidden");
  }, 60_000);
});
