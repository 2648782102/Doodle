#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureOutputDirWritable, loadRuntimeConfig } from "../dist/infra/config.js";
import { BoardHttpServer } from "../dist/board/http.js";
import { BoardStore } from "../dist/board/store.js";
import { logger } from "../dist/infra/logger.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

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
  console.log(`Doodle 本地预览已启动：${preview.panelUrl ?? "unavailable"}`);
  console.log("这是手动启动的预览服务；Ctrl+C 或终止进程后停止。");
  logger.info("Local preview is running independently of an MCP session");
} catch (error) {
  logger.error(`Local preview failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
