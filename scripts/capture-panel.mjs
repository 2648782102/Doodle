#!/usr/bin/env node
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "docs");
const port = Number(process.env.CAPTURE_PORT ?? 4418);
const base = `http://127.0.0.1:${port}`;
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-draw-capture-"));

function resolveChrome() {
  const configured = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configured && existsSync(configured)) return configured;
  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Chrome not found; set PUPPETEER_EXECUTABLE_PATH");
  return found;
}

process.env.AI_DRAW_WORKSPACE_ROOT = tempDir;
process.env.OUTPUT_DIR = path.join(tempDir, "output");
process.env.PREVIEW_PORT = String(port);

const { createServer } = await import(path.join(root, "dist/server.js"));
const { preview, board } = await createServer();
await preview.start();

const html = await fetch(base).then((response) => response.text());
const token = html.match(/const PANEL_TOKEN = "([^"]+)"/)?.[1];
if (!token) throw new Error("Panel token not found");
const headers = { "Content-Type": "application/json", "X-AI-Draw-Token": token };
const seedItems = [
  { type: "note", x: -260, y: -110, w: 190, h: 130, text: "想法：一个很简单的共享画板", color: "#f6d365" },
  { type: "rect", x: 10, y: -120, w: 190, h: 110, text: "人：点一下就能画", color: "#c7d8ff" },
  { type: "ellipse", x: -90, y: 80, w: 190, h: 110, text: "AI：读懂后补图", color: "#b8e0d2" },
  { type: "line", x: -70, y: 10, w: 220, h: 0, text: "一起改", color: "#64748b" },
  { type: "text", x: -250, y: 230, w: 420, h: 44, text: "少一点界面，多一点画布", color: "#ffffff" },
];
for (const item of seedItems) {
  const response = await fetch(`${base}/api/board/items`, {
    method: "POST",
    headers,
    body: JSON.stringify({ confirmedBy: "human", item }),
  });
  if (!response.ok) throw new Error(`Unable to seed board item: HTTP ${response.status}`);
}
for (const body of [
  "这里放三个想法就够了，界面越简单越好。",
  "我已经看到这些对象；需要时我会继续补在画布上。",
]) {
  const response = await fetch(`${base}/api/board/notes`, {
    method: "POST",
    headers,
    body: JSON.stringify({ confirmedBy: "human", body }),
  });
  if (!response.ok) throw new Error(`Unable to seed board note: HTTP ${response.status}`);
}
const currentBoard = await board.snapshot();
const noteIndex = currentBoard.notes.findIndex((note) => note.body === "我已经看到这些对象；需要时我会继续补在画布上。");
if (noteIndex < 0) throw new Error("Unable to locate the AI demo note");
currentBoard.notes[noteIndex] = { ...currentBoard.notes[noteIndex], author: "ai" };
await board.replace(currentBoard);

const browser = await puppeteer.launch({
  headless: "new",
  executablePath: resolveChrome(),
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle2" });
  await page.waitForSelector(".board-item");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector(".board-item");
  await page.evaluate(() => {
    const canvas = document.querySelector("#canvas");
    const world = document.querySelector("#world");
    world.style.transform = `translate(${canvas.clientWidth / 2}px, ${canvas.clientHeight / 2}px) scale(1)`;
    canvas.style.backgroundPosition = `${canvas.clientWidth / 2}px ${canvas.clientHeight / 2}px`;
  });
  await new Promise((resolve) => setTimeout(resolve, 220));
  await page.screenshot({ path: path.join(outputDir, "shared-board-panel.png") });
  console.log("✅ Captured docs/shared-board-panel.png");
} finally {
  await browser.close();
  await preview.stop().catch(() => {});
  await fs.rm(tempDir, { recursive: true, force: true });
}
