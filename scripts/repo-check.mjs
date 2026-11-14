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
const appSource = await read("src/board/app.ts");
const appContext = await read("src/board/app-context.ts");
const boardIndex = await read("src/board/index.ts");
const tools = await read("src/board/tools.ts");
const boardTypes = await read("src/board/types.ts");
const boardTemplate = await read("src/infra/templates/board.html");
const http = await read("src/board/http.ts");
const scanner = await read("src/board/project-scan.ts");
const boardStore = await read("src/board/store.ts");
const boardLibrary = await read("src/board/library.ts");
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
const releasing = await read("RELEASING.md");
const publishWorkflow = await read(".github/workflows/publish-release.yml");
const privacy = await read("PRIVACY.md");
const support = await read("SUPPORT.md");
const terms = await read("TERMS.md");
const faq = await read("docs/FAQ.md");
const troubleshooting = await read("docs/TROUBLESHOOTING.md");
const submission = await read("docs/SUBMISSION.md");
const experienceAudit = await read("docs/EXPERIENCE_AUDIT.md");
const submissionScript = await read("scripts/build-submission.mjs");
const config = await read("src/infra/config.ts");
const projectWorkspace = await read("src/infra/project-workspace.ts");
const version = await read("src/infra/version.ts");
const setupScript = await read("scripts/setup-codex.mjs");
const store = await read("src/board/store.ts");
const stdioExample = JSON.parse(await read("examples/mcp-config/stdio.json"));
const cursorExample = JSON.parse(await read("examples/mcp-config/cursor.json"));
const codexExample = await read("examples/mcp-config/codex.toml");
const sourceFiles = (await fs.readdir(path.join(root, "src", "board"), { recursive: true }))
  .filter((name) => typeof name === "string" && name.endsWith(".ts"));
const totalSourceFiles = (await fs.readdir(path.join(root, "src"), { recursive: true }))
  .filter((name) => typeof name === "string" && name.endsWith(".ts"));
const canonicalDescription = "A local-first two-way board where people and AI draw to express intent through MCP.";
const canonicalTopics = ["ai", "canvas", "developer-tools", "drawing", "local-first", "mcp", "typescript", "whiteboard"];

check(packageJson.version === "0.7.0", "package.json is not version 0.7.0");
check(pluginManifest.version === packageJson.version, "plugin version does not match package.json");
check(pluginManifest.requires_local_executor === true, "plugin is not marked desktop-only");
check(pluginMcp.mcpServers.doodle.args[0] === "${PLUGIN_ROOT}/server/index.mjs", "plugin MCP entrypoint is not self-contained");
check(marketplace.plugins[0].source.path === "./.doodle-plugin/doodle", "marketplace does not point at the plugin build output");
check(pluginSkill.includes("get_board") && pluginSkill.includes("show_board") && !pluginSkill.includes("reply_on_board"), "plugin skill does not describe the current board workflow");
check(goalPlugin.includes("## Objective") && goalPlugin.includes("plugin") && goalPlugin.includes("MCP Apps"), "plugin goal document is missing or stale");
check(packageJson.scripts.build.includes("build-plugin.mjs") && packageJson.scripts.check.includes("repo:plugin-check"), "npm scripts do not build and check the plugin");
check(packageJson.scripts["setup:codex"] === "node scripts/setup-codex.mjs", "one-command Codex setup is missing");
check(packageJson.scripts["preview:board"] === "node scripts/preview-board.mjs", "explicit local preview command is missing");
check(await exists("scripts/preview-board.mjs"), "local preview script is missing");
check(troubleshooting.includes("npm run preview:board") && troubleshooting.includes("current MCP server process"), "troubleshooting does not explain PANEL_URL lifetime");
check(packageJson.scripts.check.includes("setup:codex -- --dry-run"), "npm check does not dry-run the Codex setup");
check(ci.includes("npm run repo:plugin-check"), "CI does not run the plugin guard");
check(ci.includes("npm run setup:codex -- --dry-run"), "CI does not dry-run the Codex setup");
check(ci.includes("npm run build:submission"), "CI does not build the submission ZIP");
check(ci.includes("BoardLibrary") && ci.includes("type: \"create\""), "CI does not verify the local board library");
check(ci.includes("Verify final-state board context projection") && ci.includes("buildBoardModelContext") && ci.includes("doodle_board_context"), "CI does not verify the final-state context projection");
check(publishWorkflow.includes("contents: write") && publishWorkflow.includes("gh release create"), "publish workflow cannot create a release");
check(publishWorkflow.includes("npm run check") && publishWorkflow.includes("--notes-file"), "publish workflow does not verify the package or use changelog notes");
check(publishWorkflow.includes('git tag -a "$tag"') && publishWorkflow.includes('git push origin "$tag"') && publishWorkflow.includes('--target "$GITHUB_SHA"'), "publish workflow does not create the matching tag before verifying it");
check(releasing.includes("publish workflow") && !releasing.includes("does not create a Release automatically"), "releasing guide does not describe release automation");
check(releasing.includes("npm stage approve") && releasing.includes("npm view doodle-mcp@<version> version"), "releasing guide does not describe the npm 2FA and version verification gates");
check(experienceAudit.includes("| E12 | P1 | fixed |") && experienceAudit.includes("doodle-mcp@0.6.3"), "experience audit does not record the closed npm publication");
check(experienceAudit.includes("| E13 | P0 | fixed |") && experienceAudit.includes("final-state delta"), "experience audit does not record host model context sync");
check(experienceAudit.includes("| E15 | P1 | external |") && experienceAudit.includes("npm `latest`"), "experience audit does not record the npm publication gate");
check(experienceAudit.includes("| E19 | P1 | fixed |") && experienceAudit.includes("terminal-owned preview command"), "experience audit does not record PANEL_URL lifecycle clarification");
check(!readme.includes("尚未更新") && !readmeEn.includes("until `npm view doodle-mcp version`"), "READMEs still warn about a resolved npm version gap");
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
check(instructions.includes("First use") && instructions.includes("FIRST_USE"), "MCP instructions do not include the first-use path");
check(instructions.includes("PANEL_URL") && !instructions.includes("reply_on_board"), "MCP instructions do not describe the local panel URL correctly");
check(instructions.includes("Doodle is"), "MCP instructions do not introduce Doodle");
check(instructions.includes("two-way") && instructions.includes("one kernel, two entry points, three capability layers"), "MCP instructions lost the two-way product story");
check(instructions.includes("updateModelContext") && instructions.includes("final-state delta"), "MCP instructions do not describe host model context sync");
check(sourceFiles.length === 12, `src/board has ${sourceFiles.length} TypeScript modules; expected the focused twelve-module structure`);
check(!boardIndex.includes("preview-server") && !boardIndex.includes("session-store"), "board index re-exports legacy infrastructure");
check((tools.match(/server\.registerTool\(/g) ?? []).length === 4 && !tools.includes("server.tool("), "tools.ts does not register exactly four annotated MCP tools");
check(tools.includes("readOnlyHint: true") && tools.includes("destructiveHint: true") && tools.includes("openWorldHint: false"), "tool annotations are incomplete");
check(tools.includes("registerAppResource") && tools.includes('"ui://doodle/board/v1.html"'), "MCP App canvas resource is missing");
check(tools.includes('"show_board"') && tools.includes('"get_board"'), "canvas render and data tools are not separated");
check(tools.includes("CANVAS_UI_META") && tools.includes("_meta: CANVAS_UI_META"), "draw_board does not advertise the canvas for automatic post-draw rendering");
check(tools.includes("appBundleCandidates(ctx.config)") && tools.includes("PANEL_URL"), "MCP App resources are not plugin-safe and the panel URL is missing");
check(tools.includes("FIRST_USE:") && tools.includes("NEXT_STEPS:") && tools.includes("NEXT:"), "get_board does not use progressive first-use and next-step guidance");
check(tools.includes("structuredContent: boardJson(board, libraryIndex)"), "board tools do not return an authoritative structured snapshot");
check(tools.includes("boardCapabilities()") && tools.includes("visualDigest: boardVisualDigest(board)") && tools.includes("boardRecipes()"), "board tools lost AI visual language");
check(tools.includes('startItemId: z.string()') && tools.includes('mode: z.enum(["grid", "row", "column", "timeline", "cluster"])'), "draw_board lost connector bindings or expanded layouts");
check(tools.includes('"scan_project"') && tools.includes("Use draw_board to visualize"), "scan_project is not a read-only board-context tool");
check(boardTypes.includes("signedWidth") && boardTypes.includes("signedHeight"), "board types lost signed directed-arrow deltas");
check(boardTypes.includes("boardVisualDigest") && boardTypes.includes("startItemId") && boardTypes.includes("variant"), "board types lost visual-expression fields or deterministic visual digest");
check(boardTypes.includes("createStarterBoard") && boardTypes.includes("createEmptyBoard"), "board types lost the compatibility starter or empty board");
check(boardStore.includes("createEmptyBoard") && !boardStore.includes("createStarterBoard()"), "new board state is not empty-first");
check(boardTemplate.includes('data-tool="line"') && boardTemplate.includes("箭头"), "board template lost the arrow tool");
check(boardTemplate.includes('createElementNS("http://www.w3.org/2000/svg", "svg")'), "board template does not render directed SVG arrows");
check(boardTemplate.includes("<title>Doodle</title>") && boardTemplate.includes('class="brand">Doodle'), "board template lost the Doodle brand");
check(boardTemplate.includes("doodleBoardViewport") && !boardTemplate.includes('setItem("aiDrawBoardViewport"'), "board template does not use Doodle view-preference keys");
check(!boardTemplate.includes('id="noteInput"') && !boardTemplate.includes('class="side"'), "board template still contains a duplicate conversation pane");
check(boardTemplate.includes("DoodleBoardInit") && boardTemplate.includes("MCP_APP_BUNDLE") && boardTemplate.includes("btnExpand"), "board template is not connected to the MCP Apps adapter");
check(boardTemplate.includes('id="btnNotifyAgent"') && boardTemplate.includes("canNotifyAgent") && boardTemplate.includes("notifyAgent()"), "board template lacks the host notification button");
check(boardTemplate.includes("嵌入画布会自动同步最终状态"), "board help does not explain automatic final-state context sync");
check(boardTemplate.includes("AI 和你都能画"), "board help does not explain the two-way board");
check(boardTemplate.includes("btnHelp") && boardTemplate.includes('event.key === "?"'), "board template lost its dismissible help popover");
check(!boardTemplate.includes("doodleHelpSeen"), "board template still auto-opens help on first visit");
check(boardTemplate.includes("canvas.focus();") && !boardTemplate.includes("helpCloseButton.focus();"), "board help steals persistent focus from the canvas");
check(boardTemplate.includes('defaultText = { note: "", text: "", rect: "", ellipse: "", line: "", stroke: "", image: "" }'), "board template lost the extended object defaults");
check(boardTemplate.includes('data-tool="stroke"') && boardTemplate.includes('data-tool="eraser"') && boardTemplate.includes('data-tool="image"'), "board template lost freehand, eraser, or image tools");
check(boardTemplate.includes('kind: "draw"') && boardTemplate.includes("strokeInk("), "board template does not draw ink immediately");
check(boardTemplate.includes('kind: "eraser"') && boardTemplate.includes("commitEraser(") && boardTemplate.includes('if (item.type !== "stroke" || !item.points?.length) continue;'), "board template lost freehand-only drag-to-erase behavior");
check(boardTemplate.includes('id="btnUndo"') && boardTemplate.includes('id="btnRedo"') && boardTemplate.includes('class="actionbar"'), "board template lost the separated history and selection controls");
check(boardTemplate.includes("function snapMove(") && boardTemplate.includes("kind: tool === \"select\" ? \"marquee\" : \"pan\""), "board template lost marquee selection or snapping");
check(boardTemplate.includes("function resolveConnector(") && boardTemplate.includes("function renderSelectionBounds("), "board template lost connected-arrow resolution or multi-selection bounds");
check(boardTemplate.includes("window.addEventListener(\"paste\""), "board template lost image paste");
check(boardTemplate.includes("findFreeSpot("), "board template no longer avoids overlapping new objects");
check(boardTemplate.includes('if (itemType !== "stroke" && itemType !== "eraser") selectTool("select");\n      if (newest && itemType !== "stroke")'), "board template does not return to select after creating a normal object");
check(boardTemplate.includes('tool !== "select" && !itemElement'), "board template creates objects when clicking an existing item");
check(boardTemplate.includes('canvas.addEventListener("dblclick"') && boardTemplate.includes('selectTool("select");\n      canvas.focus();'), "board template lost reliable double-click editing");
check(boardTemplate.includes('createItem("note", point, board.revision)'), "board template lost double-click-empty note creation");
check(boardTemplate.includes('id="btnEdit"') && boardTemplate.includes('function editSelected()') && boardTemplate.includes('event.key === "Enter"'), "board template lacks the explicit text-edit entry point");
check(boardTemplate.includes("function updateContextualTools()"), "board template does not scope edit and delete tools to a selection");
check(boardTemplate.includes("window.doodleBoardSocket") && boardTemplate.includes('socket.addEventListener("open"'), "board template lost singleton live WebSocket updates");
check(boardTemplate.includes('async function loadBoard(change = null)') && boardTemplate.includes('loadBoard(isCurrent ? "local" : "remote")'), "board template does not distinguish local and remote revision status");
check(buildScript.includes('entryPoints: [path.join(sourceRoot, "board", "app.ts")]') && buildScript.includes("minify: true"), "build does not bundle a compact MCP App client");
check(appSource.includes("updateModelContext") && appSource.includes("sendMessage") && appSource.includes("getHostCapabilities"), "MCP App bridge does not use host context and message capabilities");
check(appSource.includes("buildBoardModelContext") && appContext.includes("finalStateNotOperationLog"), "MCP App context is not a final-state delta");
check(appContext.includes("structuredContent") && !appContext.includes("operationLog"), "board model context lost its complete structured snapshot or added an operation log");
check(instructions.includes("conversation") && !instructions.includes("reply_on_board"), "MCP instructions duplicate the host conversation");
check(http.includes('"/api/board"') && http.includes("X-AI-Draw-Token"), "board HTTP server lost its authenticated API");
check(http.includes("templateCandidates(this.config)") && http.includes("panelUrlValue"), "plugin bundle template resolution and dynamic panel URL are missing");
check(http.includes("canvasSnapshot") && http.includes("notes: _legacyNotes"), "HTTP canvas API still exposes the retired message feed");
check(http.includes('"/api/board/batch"') && http.includes('"/api/board/replace"'), "HTTP board API lost batch or replacement operations");
check(http.includes("boardVisualDigest(board)") && http.includes("capabilities:"), "HTTP board API lost AI visual language");
check(http.includes('"/api/board/project"') && !http.includes('"/project"'), "project scan is outside the authenticated board API namespace");
check(!http.includes("/workbench") && !http.includes("/api/collab"), "board HTTP server still exposes workbench routes");
check(store.includes("AsyncMutex") && store.includes("replaceIfRevision") && store.includes("BoardRevisionConflictError"), "board store lost serialized revision-safe writes");
check(store.includes("new AsyncMutex(this.file)") && mutex.includes('fs.open(this.lockFile, "wx")'), "board store lost its cross-process write lock");
check(boardLibrary.includes("class BoardLibrary") && boardLibrary.includes('".doodle", "boards"'), "board library is missing its local snapshot directory");
check(tools.includes("libraryAction") && tools.includes("ctx.library.apply"), "draw_board lost board-library actions");
check(http.includes('"/api/board/library"') && boardTemplate.includes('id="libraryPanel"'), "board library HTTP or UI surface is missing");
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
check(await exists("docs/GOAL_EXPERIENCE.md") && (await read("docs/GOAL_EXPERIENCE.md")).includes("## Acceptance"), "native visual expression goal document is missing");
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
check(stdioExample.command === "npx" && stdioExample.args?.[0] === "-y" && stdioExample.args?.[1] === "doodle-mcp", "generic stdio example is not zero-configuration");
check(cursorExample.mcpServers?.doodle?.command === "npx" && !JSON.stringify(cursorExample).includes("absolute-path"), "Cursor stdio example is not zero-configuration");
check(codexExample.includes('args = ["-y", "doodle-mcp"]') && !codexExample.includes("absolute-path"), "Codex stdio example is not zero-configuration");
check(setupScript.includes('"plugin", "marketplace", "add"') && setupScript.includes('"plugin", "add", "doodle@doodle"') && setupScript.includes("--dry-run"), "setup script does not safely install the local plugin");
check(setupScript.includes('if (dryRun) return { status: 0 }') || setupScript.includes("if (dryRun) return { status: 0; }"), "setup dry-run can still execute commands");
check(await exists("plugins/doodle/skills/doodle/SKILL.md") && await exists("scripts/build-plugin.mjs") && await exists("scripts/plugin-check.mjs"), "plugin packaging files are incomplete");
check(totalSourceFiles.length === 19, `src has ${totalSourceFiles.length} TypeScript modules; expected the focused plugin-ready structure`);

if (failures.length) {
  console.error("❌ Offline repository checks failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("✅ Offline repository checks passed: simple-board source, docs, and metadata are aligned");
