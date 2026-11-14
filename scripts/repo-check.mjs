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
const appContext = await read("src/board/app-context.ts");
const excalidrawApp = await read("src/infra/templates/excalidraw-app.tsx");
const boardIndex = await read("src/board/index.ts");
const tools = await read("src/board/tools.ts");
const boardTypes = await read("src/board/types.ts");
const excalidrawTemplate = await read("src/infra/templates/excalidraw.html");
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
const hoverGeometry = [...excalidrawTemplate.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, selectors]) => selectors.includes(":hover") || selectors.includes(":active"))
  .flatMap(([, selectors, body]) => {
    const geometry = body.match(/(?:^|;)\s*(?:transform|translate|scale|rotate|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|width|height|min-width|max-width|min-height|max-height|top|right|bottom|left|gap|border-width|font-size|line-height)\s*:/i);
    return geometry ? [`${selectors.trim()} → ${geometry[0].trim()}`] : [];
  });

check(packageJson.version === "0.8.0", "package.json is not version 0.8.0");
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
check(ci.includes("resolveDiagramLayout") && ci.includes("diagramToBoardItems"), "CI does not verify deterministic semantic diagrams");
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
check(Object.keys(packageJson.dependencies).sort().join(",") === "@excalidraw/excalidraw,@modelcontextprotocol/ext-apps,@modelcontextprotocol/sdk,express,react,react-dom,ws,zod", "runtime dependencies do not match the Excalidraw-only experiment");
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
check(instructions.includes("draw_board.diagram") && instructions.includes("never combines diagram"), "MCP instructions do not describe the exclusive semantic diagram path");
check(sourceFiles.length === 15, `src/board has ${sourceFiles.length} TypeScript modules; expected the focused fourteen-module structure`);
check(!boardIndex.includes("preview-server") && !boardIndex.includes("session-store"), "board index re-exports legacy infrastructure");
check((tools.match(/server\.registerTool\(/g) ?? []).length === 4 && !tools.includes("server.tool("), "tools.ts does not register exactly four annotated MCP tools");
check(tools.includes("readOnlyHint: true") && tools.includes("destructiveHint: true") && tools.includes("openWorldHint: false"), "tool annotations are incomplete");
check(tools.includes("registerAppResource") && tools.includes('"ui://doodle/board/excalidraw/v1.html"'), "Excalidraw MCP App canvas resource is missing");
check(tools.includes('"show_board"') && tools.includes('"get_board"'), "canvas render and data tools are not separated");
check(tools.includes("CANVAS_UI_META") && tools.includes("_meta: CANVAS_UI_META"), "draw_board does not advertise the canvas for automatic post-draw rendering");
check(tools.includes("getAppHtml()") && tools.includes("PANEL_URL"), "Excalidraw MCP App resource is not plugin-safe and the panel URL is missing");
check(tools.includes("FIRST_USE:") && tools.includes("NEXT_STEPS:") && tools.includes("NEXT:"), "get_board does not use progressive first-use and next-step guidance");
check(tools.includes("structuredContent: boardAgentPayload(board, libraryIndex)"), "board tools do not return an authoritative agent-view snapshot");
check(tools.includes("function boardAgentPayload") && tools.includes("canvasFidelityItems") && tools.includes("function boardJson("), "agent payload and full canvas payload are not separated");
check(tools.includes("since_revision") && tools.includes("boardAgentDelta") && tools.includes("BoardRevisionCache"), "incremental rereads or their revision cache are missing");
check(tools.includes("describeHandoff") && tools.includes("handoff") && tools.includes("needsAttention"), "delta reads do not attribute human edits");
check(buildScript.includes("excalidraw-app.tsx"), "build is missing the canvas client");
check(tools.includes("guideSent") && tools.includes("include_guide"), "the guide is not sent once with an explicit opt-in");
check(tools.includes("boardCapabilities()") && tools.includes("visualDigest: boardVisualDigest(board)") && tools.includes("boardRecipes()"), "board tools lost AI visual language");
check(tools.includes('startItemId: z.string()') && tools.includes('mode: z.enum(["grid", "row", "column", "timeline", "cluster", "architecture"])') && tools.includes("diagram: diagramInput.optional()"), "draw_board lost connector bindings, expanded layouts, or semantic diagram recipe");
check(tools.includes('mode: z.enum(["flow", "timeline", "compare", "matrix"])') && tools.includes("diagramModes"), "draw_board.diagram lost its semantic layout modes");
check(boardTypes.includes("resolveDiagramLayout") && boardTypes.includes("diagramToBoardItems") && !boardTypes.includes("diagramToExcalidrawScene"), "semantic diagrams are not generated through one deterministic Board v1 layout");
check(!http.includes('"/api/board/scene"') && !excalidrawApp.includes("loadScene()"), "a second persisted Excalidraw scene source remains");
check(tools.includes('"scan_project"') && tools.includes("Use draw_board to visualize"), "scan_project is not a read-only board-context tool");
check(boardTypes.includes("signedWidth") && boardTypes.includes("signedHeight"), "board types lost signed directed-arrow deltas");
check(boardTypes.includes("boardVisualDigest") && boardTypes.includes("startItemId") && boardTypes.includes("variant"), "board types lost visual-expression fields or deterministic visual digest");
check(boardTypes.includes("createStarterBoard") && boardTypes.includes("createEmptyBoard"), "board types lost the compatibility starter or empty board");
check(boardStore.includes("createEmptyBoard") && !boardStore.includes("createStarterBoard()"), "new board state is not empty-first");
check(excalidrawTemplate.includes("Doodle · Excalidraw Canvas") && excalidrawTemplate.includes('id="excalidrawRoot"'), "Excalidraw-only board template is missing");
check(excalidrawTemplate.includes("/excalidraw/excalidraw-app.js") && excalidrawTemplate.includes("const PANEL_TOKEN"), "Excalidraw template lost its local entry or panel token");
check(excalidrawTemplate.includes('id="doodleLibraryPanel"') && !excalidrawTemplate.includes('id="toast"'), "Excalidraw template lost the library overlay or kept an obsolete toast");
check(excalidrawTemplate.includes('data-library-action="duplicate">另存为') && excalidrawTemplate.includes('id="doodleLibraryStatus"'), "Excalidraw template lost save-as feedback or turned it into a rename");
check(excalidrawApp.includes('if (action.type === "duplicate")') && excalidrawApp.includes("selectedBoardId"), "canvas library Save As does not duplicate the active or selected snapshot");
check(excalidrawApp.includes("exportToBlob") && excalidrawApp.includes("exportToSvg") && excalidrawTemplate.includes('data-snapshot-export="png"') && excalidrawTemplate.includes('data-snapshot-export="jpg"') && excalidrawTemplate.includes('data-snapshot-export="svg"'), "static PNG/JPG/SVG snapshot exports are missing");
check(excalidrawTemplate.includes("--doodle-accent") && excalidrawTemplate.includes('data-doodle-theme="dark"') && excalidrawTemplate.includes("background-image: radial-gradient(circle, var(--doodle-dot)") && excalidrawApp.includes('view: "transparent"'), "unified theme tokens or native Excalidraw dot grid are missing");
check(excalidrawTemplate.includes(".excalidraw {\n      --color-primary: #2f6b5c") && excalidrawTemplate.includes(".excalidraw.theme--dark {\n      --color-primary: #8fcbb4"), "Excalidraw controls are not mapped to the Doodle pine-green palette");
check(!/--color-primary:\s*#6965db/.test(excalidrawTemplate) && excalidrawTemplate.includes("--color-surface-primary-container: #dcebe4"), "Excalidraw purple defaults remain visible in the canvas theme");
check(excalidrawTemplate.includes('id="doodleThemeToggle"') && excalidrawApp.includes("initThemeToggle") && excalidrawApp.includes("THEME_STORAGE_KEY"), "light/dark theme toggle is missing");
check(excalidrawTemplate.includes("--doodle-drawer-width") && excalidrawTemplate.includes("doodle-drawer-scrim") && excalidrawApp.includes("doodle-drawer-open"), "library drawer lost its bounded width or accessible scrim");
check(excalidrawTemplate.includes("body.doodle-drawer-open .doodle-topbar") && !excalidrawTemplate.includes("body.doodle-drawer-open .excalidraw-host > .excalidraw"), "library drawer squeezes or collides with the canvas toolbar");
check(excalidrawTemplate.includes("body:has(.excalidraw .dropdown-menu) .doodle-topbar") && excalidrawTemplate.includes("body:has(.excalidraw .Modal) .doodle-topbar"), "Doodle toolbar does not yield to Excalidraw menus and modal overlays");
check(excalidrawTemplate.includes(".doodle-library-section--boards") && excalidrawTemplate.includes(".doodle-library-section--shares") && excalidrawTemplate.indexOf(".doodle-library-section--boards") < excalidrawTemplate.indexOf('data-library-action="duplicate"'), "library drawer does not separate its scrollable list from fixed actions");
check(hoverGeometry.length === 0, `hover or active feedback changes layout geometry: ${hoverGeometry.join(", ")}`);
check(excalidrawApp.includes("scrim.hidden = false") && excalidrawApp.includes("scrim?.addEventListener(\"click\", closePanel)") && excalidrawApp.includes("event.key === \"Escape\""), "library drawer lost its scrim, outside-click, or Escape dismissal");
check(excalidrawApp.includes("https://github.com/2648782102/Doodle") && excalidrawApp.includes("MainMenu.ItemLink") && excalidrawApp.includes("group.querySelector(\"a[href]\")"), "canvas menu does not replace upstream social links with the Doodle repository");
check(excalidrawApp.includes("DoodleMainMenu") && excalidrawApp.includes("MainMenu.DefaultItems.SearchMenu") && excalidrawApp.includes("MainMenu.DefaultItems.Help"), "custom canvas menu lost its local search or help entries");
check(excalidrawApp.includes("isDoodleProjectLink") && excalidrawApp.includes("onLinkOpen") && excalidrawApp.includes("blockExternalCanvasLinks"), "canvas link policy does not allow only the Doodle repository");
check(excalidrawApp.includes("HelpDialog__header") === false && excalidrawTemplate.includes(".excalidraw .HelpDialog__header { display: none; }"), "native help dialog still exposes upstream external links");
check(excalidrawApp.includes("library-menu-browse-button") && excalidrawApp.includes("toolbar-embeddable") && excalidrawApp.includes("dropdown-menu-container"), "external embed or library-browse entries are not removed");
check(excalidrawApp.includes("aiEnabled: false"), "Excalidraw AI generation entries are enabled");
check(excalidrawTemplate.indexOf('href="/excalidraw/index.css"') < excalidrawTemplate.indexOf("<style>"), "Doodle overrides load before Excalidraw CSS and lose specificity");
check(!await exists("src/infra/templates/board.html") && !await exists("src/infra/templates/board-app.js"), "legacy DOM canvas template or bundle still exists");
check(!tools.includes("engine=dom") && !http.includes("engine=dom"), "legacy DOM engine fallback still exists");
check(buildScript.includes("excalidraw-app.tsx") && buildScript.includes("minify: true"), "build does not bundle the Excalidraw canvas client");
check(excalidrawApp.includes("buildBoardModelContext") && appContext.includes("finalStateNotOperationLog"), "Excalidraw MCP App context is not a final-state delta");
check(excalidrawApp.includes("sendMessage") && excalidrawTemplate.includes('id="doodleNotifyAgent"'), "embedded Excalidraw canvas lost the host notification button");
check(appContext.includes("structuredContent") && !appContext.includes("operationLog"), "board model context lost its complete structured snapshot or added an operation log");
check(instructions.includes("conversation") && !instructions.includes("reply_on_board"), "MCP instructions duplicate the host conversation");
check(http.includes('"/api/board"') && http.includes("X-AI-Draw-Token"), "board HTTP server lost its authenticated API");
check(http.includes("excalidrawTemplateCandidates(this.config)") && http.includes("panelUrlValue"), "plugin bundle Excalidraw template resolution and dynamic panel URL are missing");
check(http.includes("canvasSnapshot") && http.includes("notes: _legacyNotes"), "HTTP canvas API still exposes the retired message feed");
check(http.includes('"/api/board/batch"') && http.includes('"/api/board/replace"'), "HTTP board API lost batch or replacement operations");
check(http.includes("boardVisualDigest(board)") && http.includes("capabilities:"), "HTTP board API lost AI visual language");
check(http.includes('"/api/board/project"') && !http.includes('"/project"'), "project scan is outside the authenticated board API namespace");
check(!http.includes("/workbench") && !http.includes("/api/collab"), "board HTTP server still exposes workbench routes");
check(store.includes("AsyncMutex") && store.includes("replaceIfRevision") && store.includes("BoardRevisionConflictError"), "board store lost serialized revision-safe writes");
check(store.includes("new AsyncMutex(this.file)") && mutex.includes('fs.open(this.lockFile, "wx")'), "board store lost its cross-process write lock");
check(boardLibrary.includes("class BoardLibrary") && boardLibrary.includes('".doodle", "boards"'), "board library is missing its local snapshot directory");
check(tools.includes("libraryAction") && tools.includes("ctx.library.apply"), "draw_board lost board-library actions");
check(http.includes('"/api/board/library"') && excalidrawTemplate.includes("Doodle · Excalidraw Canvas"), "board library HTTP or Excalidraw-only UI surface is missing");
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
check(await exists("docs/GOAL_EXCALIDRAW.md") && (await read("docs/GOAL_EXCALIDRAW.md")).includes("## Acceptance"), "Excalidraw engine goal document is missing");
check(await exists("docs/GOAL_BASIC.md") && (await read("docs/GOAL_BASIC.md")).includes("## Acceptance") && (await read("docs/README.md")).includes("GOAL_BASIC.md"), "active basic-loop goal document or documentation-map link is missing");
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
check(totalSourceFiles.length === 22, `src has ${totalSourceFiles.length} TypeScript modules; expected the focused plugin-ready structure`);

if (failures.length) {
  console.error("❌ Offline repository checks failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("✅ Offline repository checks passed: simple-board source, docs, and metadata are aligned");
