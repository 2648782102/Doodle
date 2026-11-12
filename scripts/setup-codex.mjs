#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const unknown = args.filter((arg) => arg !== "--dry-run");

if (unknown.length) {
  console.error(`Unknown option: ${unknown.join(" ")}`);
  process.exit(1);
}

const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));

function run(command, commandArgs) {
  console.log(`> ${[command, ...commandArgs].join(" ")}`);
  if (dryRun) return { status: 0 };
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit" });
  if (result.error?.code === "ENOENT") throw new Error(`Command not found: ${command}`);
  if (result.error) throw result.error;
  return result;
}

function mustRun(command, commandArgs) {
  const result = run(command, commandArgs);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  const hasDependencies = await fs.access(path.join(root, "node_modules")).then(() => true).catch(() => false);
  if (!hasDependencies) mustRun("npm", ["install"]);
  mustRun("npm", ["run", "build"]);
  mustRun("codex", ["plugin", "marketplace", "add", ".", "--json"]);
  mustRun("codex", ["plugin", "add", "doodle@doodle", "--json"]);
  console.log([
    `✅ Doodle ${packageJson.version} 已准备好${dryRun ? "（仅预览命令）" : ""}`,
    "",
    "请开启一个新的 Codex 会话，然后说：",
    "「打开 Doodle 画板，我们先用画板交流。」",
    "",
    "画布会出现在兼容 MCP Apps 的会话旁；其他宿主可在聊天里询问 PANEL_URL。",
  ].join("\n"));
} catch (error) {
  console.error(`❌ 安装未完成：${error instanceof Error ? error.message : String(error)}`);
  console.error("请确认已安装 Node.js >= 20 与 Codex CLI，然后重试 npm run setup:codex。");
  process.exit(1);
}
