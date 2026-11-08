#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const read = (relative) => fs.readFile(path.join(root, relative), "utf8");
const exists = async (relative) => {
  try {
    await fs.access(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
};
const check = (condition, message) => { if (!condition) failures.push(message); };

const packageJson = JSON.parse(await read("package.json"));
const server = await read("src/server.ts");
const buildScript = await read("scripts/build.mjs");
const instructions = await read("src/board/instructions.ts");
const boardIndex = await read("src/board/index.ts");
const tools = await read("src/board/tools.ts");
const boardTypes = await read("src/board/types.ts");
const boardTemplate = await read("src/infra/templates/board.html");
const http = await read("src/board/http.ts");
const scanner = await read("src/board/project-scan.ts");
const launchKit = await read("docs/LAUNCH_KIT.md");
const readme = await read("README.md");
const readmeEn = await read("README.en.md");
const agents = await read("AGENTS.md");
const productDirection = await read("docs/PRODUCT_DIRECTION.md");
const architecture = await read("docs/ARCHITECTURE.md");
const changelog = await read("CHANGELOG.md");
const contributing = await read("CONTRIBUTING.md");
const security = await read("SECURITY.md");
const roadmap = await read("ROADMAP.md");
const sourceFiles = (await fs.readdir(path.join(root, "src", "board"), { recursive: true }))
  .filter((name) => typeof name === "string" && name.endsWith(".ts"));
const canonicalDescription = "A tiny shared board for people and AI to doodle, draw, and leave short notes through MCP.";
const canonicalTopics = ["ai", "canvas", "developer-tools", "drawing", "local-first", "mcp", "typescript", "whiteboard"];

check(packageJson.version === "0.4.0", "package.json is not version 0.4.0");
check(packageJson.name === "doodle-mcp", "npm package name is not doodle-mcp");
check(packageJson.repository.url.includes("/Doodle.git") && packageJson.homepage.includes("/Doodle#readme"), "repository URLs do not use the Doodle project name");
check(packageJson.bin["doodle-mcp"] === "dist/index.js", "doodle-mcp CLI entrypoint is missing");
check(packageJson.description === canonicalDescription, "package description does not match the canonical Doodle description");
check(packageJson.keywords.join(",") === canonicalTopics.join(","), "package keywords do not match the canonical GitHub topics");
check(launchKit.includes(`> ${canonicalDescription}`), "launch kit does not contain the canonical Doodle description");
check(launchKit.includes(`Recommended topics: ${canonicalTopics.map((topic) => `\`${topic}\``).join(", ")}`), "launch kit topics do not match the canonical GitHub topics");
check(readmeEn.includes(`> ${canonicalDescription}`), "English README does not use the canonical Doodle description");
check(!packageJson.dependencies.mermaid && !packageJson.dependencies.sharp && !packageJson.dependencies.open && !packageJson.dependencies.nanoid, "package.json still has removed rendering/IDE dependencies");
check(!packageJson.scripts["ui:shots"] && !packageJson.scripts["github:sync"], "package.json still has removed legacy scripts");
check(Object.keys(packageJson.dependencies).sort().join(",") === "@modelcontextprotocol/sdk,express,ws,zod", "runtime dependencies are not minimal");
check(packageJson.overrides?.["@hono/node-server"] && packageJson.overrides?.hono && packageJson.overrides?.["fast-uri"], "transitive security overrides are missing");
check(server.includes("registerBoardTools") && server.includes("TOOL_COUNT = 4"), "server.ts is not the four-tool board composition root");
check(server.includes('name: "doodle-mcp"'), "MCP server identity is not Doodle");
check(!buildScript.includes('fs.rm(path.join(root, "dist")'), "build.mjs deletes tsc output");
check(buildScript.includes("pruneCompiledFiles"), "build.mjs does not prune stale compiled artifacts");
check(instructions.includes("Start with get_board") && instructions.includes("scan_project is optional"), "MCP instructions do not describe the agent-first board loop");
check(instructions.includes("Doodle is"), "MCP instructions do not introduce Doodle");
check(sourceFiles.length === 7, `src/board has ${sourceFiles.length} TypeScript modules; expected the focused seven-module structure`);
check(!boardIndex.includes("preview-server") && !boardIndex.includes("session-store"), "board index re-exports legacy infrastructure");
check((tools.match(/server\.tool\(/g) ?? []).length === 4, "tools.ts does not register exactly four MCP tools");
check(tools.includes('"scan_project"') && tools.includes("Use draw_board to visualize"), "scan_project is not a read-only board-context tool");
check(boardTypes.includes("signedWidth") && boardTypes.includes("signedHeight"), "board types lost signed directed-arrow deltas");
check(boardTemplate.includes('data-tool="line"') && boardTemplate.includes("箭头"), "board template lost the arrow tool");
check(boardTemplate.includes('createElementNS("http://www.w3.org/2000/svg", "svg")'), "board template does not render directed SVG arrows");
check(http.includes('"/api/board"') && http.includes("X-AI-Draw-Token"), "board HTTP server lost its authenticated API");
check(http.includes('"/api/board/project"') && !http.includes('"/project"'), "project scan is outside the authenticated board API namespace");
check(!http.includes("/workbench") && !http.includes("/api/collab"), "board HTTP server still exposes workbench routes");
check(scanner.includes("readOnly: true") && scanner.includes('writes: "none"'), "project scan lost its read-only safety boundary");
check(scanner.includes("workspaceName") && !scanner.includes("workspaceRoot:"), "project scan exposes an absolute workspace root");
check(scanner.includes("isPrivateEntry") && !scanner.includes('relative.includes("/.env")'), "project scan does not filter private path segments");
check(await exists("package-lock.json"), "package-lock.json is missing");
check(await exists("LICENSE") && (await read("LICENSE")).includes("Doodle contributors"), "LICENSE does not credit Doodle contributors");
check(await exists("README.en.md") && await exists("ROADMAP.md") && await exists("RELEASING.md") && await exists("VERSIONING.md"), "open-source root documentation is incomplete");
for (const [file, label] of [
  [readme, "README.md"],
  [readmeEn, "README.en.md"],
  [agents, "AGENTS.md"],
  [productDirection, "PRODUCT_DIRECTION.md"],
  [architecture, "ARCHITECTURE.md"],
  [changelog, "CHANGELOG.md"],
  [contributing, "CONTRIBUTING.md"],
  [security, "SECURITY.md"],
  [roadmap, "ROADMAP.md"],
]) {
  check(!file.includes("29 个 MCP 工具") && !file.includes("26 个 MCP 工具"), `${label} still advertises the legacy tool count`);
  check(!file.includes("/workbench"), `${label} still describes the removed workbench as current`);
  check(!file.includes("SessionSnapshot") || label === "ARCHITECTURE.md" || label === "PRODUCT_DIRECTION.md" || label === "CHANGELOG.md", `${label} still describes the removed session model as current`);
}
check(await exists("LICENSE"), "LICENSE is missing");
check(await exists("SECURITY.md"), "SECURITY.md is missing");
check(await exists("CODE_OF_CONDUCT.md"), "CODE_OF_CONDUCT.md is missing");
check(await exists(".github/workflows/ci.yml"), "CI workflow is missing");
check(await exists("examples/board-client.mjs"), "board MCP client example is missing");

if (failures.length) {
  console.error("❌ Offline repository checks failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("✅ Offline repository checks passed: simple-board source, docs, and metadata are aligned");
