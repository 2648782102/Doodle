#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let ok = true;
const pass = (message) => console.log(`✅ ${message}`);
const warn = (message) => console.warn(`⚠️  ${message}`);
const fail = (message) => { console.error(`❌ ${message}`); ok = false; };

const major = Number.parseInt(process.version.slice(1), 10);
if (major >= 20) pass(`Node.js ${process.version} (>=20)`);
else fail(`Node.js ${process.version} — 需要 >= 20`);

const distIndex = path.join(root, "dist", "index.js");
if (fs.existsSync(distIndex)) pass("已构建 dist/index.js");
else warn("未找到 dist/index.js — 请先运行 npm run build");

const outputDir = process.env.OUTPUT_DIR
  ? path.resolve(process.env.OUTPUT_DIR)
  : process.env.PLUGIN_DATA
    ? path.join(path.resolve(process.env.PLUGIN_DATA), "doodle")
    : path.join(root, "output");
try {
  fs.mkdirSync(outputDir, { recursive: true });
  const probe = path.join(outputDir, ".doctor-write-probe");
  fs.writeFileSync(probe, "ok", "utf8");
  fs.unlinkSync(probe);
  pass(`OUTPUT_DIR 可写: ${outputDir}`);
} catch (error) {
  fail(`OUTPUT_DIR 不可写: ${outputDir} — ${error instanceof Error ? error.message : String(error)}`);
}

const port = Number.parseInt(process.env.PREVIEW_PORT?.trim() || "0", 10);
if (process.env.PREVIEW_PORT?.trim()) {
  const inUse = await new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" }, () => { socket.end(); resolve(true); });
    socket.on("error", () => resolve(false));
  });
  if (inUse) warn(`端口 ${port} 已被占用（可能 MCP 已在运行）`);
  else pass(`端口 ${port} 空闲`);
} else {
  pass("PREVIEW_PORT 未设置；启动时会自动选择空闲本地端口");
}

const configPath = path.join(os.homedir(), ".codex", "config.toml");
const pluginServer = path.join(root, ".doodle-plugin", "doodle", "server", "index.mjs");
if (fs.existsSync(pluginServer)) pass("已构建插件 server/index.mjs");
else warn("未找到插件 server/index.mjs — 请先运行 npm run build:plugin");
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const submissionZip = path.join(root, "doodle-plugin-submission", `doodle-${packageVersion}.zip`);
if (fs.existsSync(submissionZip)) console.log(`ℹ️  已构建插件提交包 doodle-${packageVersion}.zip（仅审核发行需要）`);
console.log([
  "",
  "首次使用：",
  "  1. npm run setup:codex",
  "  2. 开启一个新的 Codex 会话",
  "  3. 说：「打开 Doodle 画板，我们先用画板交流。」",
  "  4. 在画布上直接画 / 改，让 AI 看后再接着画",
  "",
  `ℹ️  零配置 MCP 示例：examples/mcp-config/；插件构建产物：.doodle-plugin/doodle/；本机 Codex 配置：${configPath}`,
].join("\n"));
process.exit(ok ? 0 : 1);
