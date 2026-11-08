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

const outputDir = process.env.OUTPUT_DIR ? path.resolve(process.env.OUTPUT_DIR) : path.join(root, "output");
try {
  fs.mkdirSync(outputDir, { recursive: true });
  const probe = path.join(outputDir, ".doctor-write-probe");
  fs.writeFileSync(probe, "ok", "utf8");
  fs.unlinkSync(probe);
  pass(`OUTPUT_DIR 可写: ${outputDir}`);
} catch (error) {
  fail(`OUTPUT_DIR 不可写: ${outputDir} — ${error instanceof Error ? error.message : String(error)}`);
}

const port = Number.parseInt(process.env.PREVIEW_PORT ?? "3399", 10);
const inUse = await new Promise((resolve) => {
  const socket = net.createConnection({ port, host: "127.0.0.1" }, () => { socket.end(); resolve(true); });
  socket.on("error", () => resolve(false));
});
if (inUse) warn(`端口 ${port} 已被占用（可能 MCP 已在运行）`);
else pass(`端口 ${port} 空闲`);

const configPath = path.join(os.homedir(), ".codex", "config.toml");
console.log(`ℹ️  MCP 配置示例：examples/mcp-config/；本机 Codex 配置：${configPath}`);
process.exit(ok ? 0 : 1);
