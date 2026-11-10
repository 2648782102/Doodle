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
const store = await read("src/board/store.ts");
const mutex = await read("src/board/mutex.ts");
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
const goalPlugin = await read("docs/GOAL_PLUGIN.md");
const pluginManifest = JSON.parse(await read("plugins/doodle/.codex-plugin/plugin.json"));
const pluginMcp = JSON.parse(await read("plugins/doodle/.mcp.json"));
const marketplace = JSON.parse(await read(".agents/plugins/marketplace.json"));
const pluginSkill = await read("plugins/doodle/skills/doodle/SKILL.md");
const ci = await read(".github/workflows/ci.yml");
const gitignore = await read(".gitignore");
const index = await read("src/index.ts");
const privacy = await read("PRIVACY.md");
const support = await read("SUPPORT.md");
const terms = await read("TERMS.md");
const faq = await read("docs/FAQ.md");
const submission = await read("docs/SUBMISSION.md");
const submissionScript = await read("scripts/build-submission.mjs");
const config = await read("src/infra/config.ts");
const projectWorkspace = await read("src/infra/project-workspace.ts");
const version = await read("src/infra/version.ts");
const sourceFiles = (await fs.readdir(path.join(root, "src", "board"), { recursive: true }))
  .filter((name) => typeof name === "string" && name.endsWith(".ts"));
const totalSourceFiles = (await fs.readdir(path.join(root, "src"), { recursive: true }))
  .filter((name) => typeof name === "string" && name.endsWith(".ts"));
const canonicalDescription = "A shared canvas for people and AI to draw together through MCP.";
const canonicalTopics = ["ai", "canvas", "developer-tools", "drawing", "local-first", "mcp", "typescript", "whiteboard"];

check(packageJson.version === "0.6.0", "package.json is not version 0.6.0");
check(pluginManifest.version === packageJson.version, "plugin version does not match package.json");
check(pluginManifest.requires_local_executor === true, "plugin is not marked desktop-only");
check(pluginMcp.mcpServers.doodle.args[0] === "${PLUGIN_ROOT}/server/index.mjs", "plugin MCP entrypoint is not self-contained");
check(marketplace.plugins[0].source.path === "./.doodle-plugin/doodle", "marketplace does not point at the plugin build output");
check(pluginSkill.includes("get_board") && pluginSkill.includes("show_board") && !pluginSkill.includes("reply_on_board"), "plugin skill does not describe the current board workflow");
check(goalPlugin.includes("## Objective") && goalPlugin.includes("plugin") && goalPlugin.includes("MCP Apps"), "plugin goal document is missing or stale");
check(packageJson.scripts.build.includes("build-plugin.mjs") && packageJson.scripts.check.includes("repo:plugin-check"), "npm scripts do not build and check the plugin");
check(ci.includes("npm run repo:plugin-check"), "CI does not run the plugin guard");
check(ci.includes("npm run build:submission"), "CI does not build the submission ZIP");
check(gitignore.includes(".doodle-plugin/") && gitignore.includes(".doodle-data/") && gitignore.includes("doodle-plugin-submission/"), "generated plugin output, data, or submission ZIP is not ignored");
check(index.indexOf("await mcp.connect(transport);") < index.indexOf("await preview.start();"), "MCP stdio is not connected before optional preview startup");
check(index.includes("Preview unavailable"), "preview failure does not keep the MCP server alive");
check(config.includes("previewPort: rawPort ? parsePort(rawPort) : null") && config.includes("PLUGIN_DATA"), "runtime config is not plugin-safe");
check(version.includes("__DOODLE_PLUGIN_VERSION__"), "bundled server cannot report the injected version");
check(projectWorkspace.includes("CODEX_PROJECT_ROOT"), "plugin-safe workspace resolution is missing");
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
check(Object.keys(packageJson.dependencies).sort().join(",") === "@modelcontextprotocol/ext-apps,@modelcontextprotocol/sdk,express,ws,zod", "runtime dependencies do not match the MCP Apps canvas");
check(packageJson.devDependencies.esbuild, "esbuild is missing for the MCP Apps browser bundle");
check(packageJson.overrides?.["@hono/node-server"] && packageJson.overrides?.hono && packageJson.overrides?.["fast-uri"], "transitive security overrides are missing");
check(server.includes("registerBoardTools") && server.includes("TOOL_COUNT = 4"), "server.ts is not the four-tool board composition root");
check(server.includes('name: "doodle-mcp"'), "MCP server identity is not Doodle");
check(!buildScript.includes('fs.rm(path.join(root, "dist")'), "build.mjs deletes tsc output");
check(buildScript.includes("pruneCompiledFiles"), "build.mjs does not prune stale compiled artifacts");
check(buildScript.indexOf("await pruneCompiledFiles(distDir, expected);") < buildScript.indexOf("await fs.mkdir(targetDir, { recursive: true });"), "build.mjs creates the template target before pruning empty dist directories");
check(instructions.includes("get_board") && instructions.includes("show_board") && instructions.includes("scan_project is optional"), "MCP instructions do not describe the canvas data and render tools");
check(instructions.includes("PANEL_URL") && !instructions.includes("reply_on_board"), "MCP instructions do not describe the local panel URL correctly");
check(instructions.includes("Doodle is"), "MCP instructions do not introduce Doodle");
check(sourceFiles.length === 10, `src/board has ${sourceFiles.length} TypeScript modules; expected the focused ten-module structure`);
check(!boardIndex.includes("preview-server") && !boardIndex.includes("session-store"), "board index re-exports legacy infrastructure");
check((tools.match(/server\.registerTool\(/g) ?? []).length === 4 && !tools.includes("server.tool("), "tools.ts does not register exactly four annotated MCP tools");
check(tools.includes("readOnlyHint: true") && tools.includes("destructiveHint: true") && tools.includes("openWorldHint: false"), "tool annotations are incomplete");
check(tools.includes("registerAppResource") && tools.includes('"ui://doodle/board/v1.html"'), "MCP App canvas resource is missing");
check(tools.includes('"show_board"') && tools.includes('"get_board"'), "canvas render and data tools are not separated");
check(tools.includes("appBundleCandidates(ctx.config)") && tools.includes("PANEL_URL"), "MCP App resources are not plugin-safe and the panel URL is missing");
check(tools.includes("structuredContent: boardJson(board)"), "board tools do not return an authoritative structured snapshot");
check(tools.includes('"scan_project"') && tools.includes("Use draw_board to visualize"), "scan_project is not a read-only board-context tool");
check(boardTypes.includes("signedWidth") && boardTypes.includes("signedHeight"), "board types lost signed directed-arrow deltas");
check(boardTypes.includes("createStarterBoard"), "board types lost the Doodle welcome board");
check(boardTemplate.includes('data-tool="line"') && boardTemplate.includes("箭头"), "board template lost the arrow tool");
check(boardTemplate.includes('createElementNS("http://www.w3.org/2000/svg", "svg")'), "board template does not render directed SVG arrows");
check(boardTemplate.includes("<title>Doodle</title>") && boardTemplate.includes('class="brand">Doodle'), "board template lost the Doodle brand");
check(boardTemplate.includes("doodleBoardViewport") && !boardTemplate.includes('setItem("aiDrawBoardViewport"'), "board template does not use Doodle view-preference keys");
check(!boardTemplate.includes('id="noteInput"') && !boardTemplate.includes('class="side"'), "board template still contains a duplicate conversation pane");
check(boardTemplate.includes("DoodleBoardInit") && boardTemplate.includes("MCP_APP_BUNDLE") && boardTemplate.includes("btnExpand"), "board template is not connected to the MCP Apps adapter");
check(buildScript.includes('entryPoints: [path.join(sourceRoot, "board", "app.ts")]') && buildScript.includes("minify: true"), "build does not bundle a compact MCP App client");
check(instructions.includes("conversation") && !instructions.includes("reply_on_board"), "MCP instructions duplicate the host conversation");
check(http.includes('"/api/board"') && http.includes("X-AI-Draw-Token"), "board HTTP server lost its authenticated API");
check(http.includes("templateCandidates(this.config)") && http.includes("panelUrlValue"), "plugin bundle template resolution and dynamic panel URL are missing");
check(http.includes("canvasSnapshot") && http.includes("notes: _legacyNotes"), "HTTP canvas API still exposes the retired message feed");
check(http.includes('"/api/board/project"') && !http.includes('"/project"'), "project scan is outside the authenticated board API namespace");
check(!http.includes("/workbench") && !http.includes("/api/collab"), "board HTTP server still exposes workbench routes");
check(store.includes("AsyncMutex") && store.includes("replaceIfRevision") && store.includes("BoardRevisionConflictError"), "board store lost serialized revision-safe writes");
check(store.includes("new AsyncMutex(this.file)") && mutex.includes('fs.open(this.lockFile, "wx")'), "board store lost its cross-process write lock");
check(tools.includes("replaceIfRevision") && tools.includes("BoardRevisionConflictError"), "draw_board does not use revision-checked writes");
check(scanner.includes("readOnly: true") && scanner.includes('writes: "none"'), "project scan lost its read-only safety boundary");
check(scanner.includes("workspaceName") && !scanner.includes("workspaceRoot:"), "project scan exposes an absolute workspace root");
check(scanner.includes("isPrivateEntry") && !scanner.includes('relative.includes("/.env")'), "project scan does not filter private path segments");
check(scanner.includes("SENSITIVE_VALUE") && scanner.includes("containsSecret") && scanner.includes("isPrivateEntry"), "project scan lost conservative evidence redaction");
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
check(await exists("PRIVACY.md") && await exists("SUPPORT.md") && await exists("TERMS.md"), "public plugin policy documents are missing");
check(await exists("docs/FAQ.md") && await exists("docs/SUBMISSION.md"), "public plugin support or submission docs are missing");
check(packageJson.scripts["build:submission"]?.includes("build-submission.mjs"), "submission ZIP build script is missing");
check(packageJson.scripts.check.includes("build:submission"), "npm check does not build the submission ZIP");
check(packageJson.files.includes("PRIVACY.md") && packageJson.files.includes("SUPPORT.md") && packageJson.files.includes("TERMS.md"), "npm package omits public policy documents");
check(privacy.includes("Retention") && privacy.includes("Recipients") && privacy.includes("User controls"), "privacy policy is incomplete");
check(support.includes("GitHub Issue") && terms.includes("MIT License"), "support or terms document is incomplete");
check(faq.includes("plugin directory") && submission.includes("Required outside this repository"), "plugin publication docs are incomplete");
check(submissionScript.includes("zip") && submissionScript.includes("doodle-${packageJson.version}.zip"), "submission ZIP script is incomplete");
check(await exists("CODE_OF_CONDUCT.md"), "CODE_OF_CONDUCT.md is missing");
check(await exists(".github/workflows/ci.yml"), "CI workflow is missing");
check(await exists("examples/board-client.mjs"), "board MCP client example is missing");
check(await exists("plugins/doodle/skills/doodle/SKILL.md") && await exists("scripts/build-plugin.mjs") && await exists("scripts/plugin-check.mjs"), "plugin packaging files are incomplete");
check(totalSourceFiles.length === 17, `src has ${totalSourceFiles.length} TypeScript modules; expected the focused plugin-ready structure`);

if (failures.length) {
  console.error("❌ Offline repository checks failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("✅ Offline repository checks passed: simple-board source, docs, and metadata are aligned");
