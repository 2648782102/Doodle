import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const packageRoot = process.cwd();
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-draw-board-ui-"));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function resolveChrome() {
  const configured = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configured && existsSync(configured)) return configured;
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((candidate) => existsSync(candidate));
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const { createServer } = await import(path.join(packageRoot, "dist/server.js"));

describe("simple board UI", () => {
  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.AI_DRAW_WORKSPACE_ROOT;
    delete process.env.OUTPUT_DIR;
    delete process.env.PREVIEW_PORT;
  });

  it("opens a small canvas, draws a note, and keeps the dense workbench out of the first screen", async () => {
    const chromePath = resolveChrome();
    if (!chromePath) return;
    const puppeteer = (await import("puppeteer")).default;
    const browser = await puppeteer.launch({
      headless: "new",
      executablePath: chromePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    process.env.AI_DRAW_WORKSPACE_ROOT = tempDir;
    process.env.OUTPUT_DIR = path.join(tempDir, "output");
    process.env.PREVIEW_PORT = String(port);
    const { preview } = await createServer();
    await preview.start();
    try {
      const page = await browser.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(base, { waitUntil: "networkidle2" });
      expect(await page.$eval("title", (element) => element.textContent)).toBe("AI 画板");
      expect(await page.$eval(".toolbar", (element) => element.querySelectorAll("button").length)).toBe(7);
      expect(await page.$(".board-header")).toBeNull();
      expect(await page.$("#btnWelcomeRescan")).toBeNull();
      expect(await page.$eval("#emptyState", (element) => element.textContent)).toContain("点一下画布开始画");
      await page.click('[data-tool="note"]');
      await page.mouse.click(420, 300);
      await page.waitForSelector(".board-item");
      expect(await page.$$eval(".board-item", (elements) => elements.length)).toBe(1);
      await page.click('[data-tool="line"]');
      await page.mouse.click(650, 300);
      await page.waitForFunction(() => document.querySelectorAll('.board-item[data-type="line"]').length === 1);
      expect(await page.$eval('.board-item[data-type="line"] svg > path', (element) => {
        const path = element.getAttribute("d");
        return {
          path,
          marker: element.getAttribute("marker-end"),
          stroke: element.getAttribute("stroke"),
        };
      })).toMatchObject({
        path: expect.stringMatching(/^M 0 0 L 180 0$/),
        marker: expect.stringMatching(/^url\(#board-arrow-\d+\)$/),
        stroke: expect.stringMatching(/^#[0-9a-fA-F]{6}$/),
      });
      await page.type("#noteInput", "这块画给 AI 看");
      await page.click("#btnSend");
      await page.waitForFunction(() => document.querySelectorAll(".note.human").length === 1);
      const board = await fetch(`${base}/api/board`).then((response) => response.json());
      expect(board.items).toHaveLength(2);
      expect(board.items[1]).toMatchObject({ type: "line", w: 180, h: 0 });
      expect(board.notes[0].body).toBe("这块画给 AI 看");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
      await preview.stop().catch(() => {});
    }
  });
});
