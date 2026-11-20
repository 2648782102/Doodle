#!/usr/bin/env node
/**
 * One-action on-ramp: start the local board and put it in front of the person.
 *
 * This is the "reach for it" path, so it optimises for a person rather than an
 * MCP host: it prints what to do, opens the default browser, and keeps the
 * process in the foreground so closing the terminal stops the board. On a
 * headless machine it prints the URL instead of failing.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureOutputDirWritable, loadRuntimeConfig } from "../dist/infra/config.js";
import { BoardHttpServer } from "../dist/board/http/server.js";
import { BoardStore } from "../dist/board/state/store.js";
import { logger } from "../dist/infra/logger.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const noBrowser = process.argv.includes("--no-browser") || process.argv.includes("--print");

function openInBrowser(url) {
  const command = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: "ignore", detached: true });
      child.on("error", () => resolve(false));
      child.on("spawn", () => { child.unref(); resolve(true); });
    } catch {
      resolve(false);
    }
  });
}

function banner(url, opened) {
  const lines = [
    "",
    "  Doodle · 你的画板已经打开",
    "",
    `  ${url}`,
    "",
    opened ? "  已在浏览器中打开。直接开始画就行。" : "  复制上面的地址到浏览器打开。",
    "",
    "  画布：点一下放对象 · 双击空白写便签 · 空格拖动平移 · 滚轮平移",
    "  和 AI 一起画：在 Codex 等宿主里说「打开 Doodle 画板，我们先用画板交流」",
    "",
    "  这个终端就是画板的开关：关掉它，画板随之停止。",
    "",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

const config = await loadRuntimeConfig();
await ensureOutputDirWritable(config.outputDir);
const board = new BoardStore(config.outputDir);
await board.init();
const preview = new BoardHttpServer(board, config);

const shutdown = async () => {
  await preview.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await preview.start();
} catch (error) {
  logger.error(`无法启动画板：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const url = preview.panelUrl;
if (!url) {
  logger.error("画板已启动，但没有拿到可访问地址。");
  process.exit(1);
}

const opened = noBrowser ? false : await openInBrowser(url);
banner(url, opened);
