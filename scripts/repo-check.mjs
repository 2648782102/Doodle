#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
/*
 * Normalise line endings: this script matches multi-line source fragments with
 * `\n` literals, and a Windows checkout with `core.autocrlf=true` writes CRLF,
 * which made the guard fail locally while passing on Linux CI.
 */
const read = async (relative) => (await fs.readFile(path.join(root, relative), "utf8")).replace(/\r\n/g, "\n");
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
/*
 * Tools are registered from one module per tool. Read them together so guards
 * can still assert the four-tool contract without knowing the file split.
 */
const toolModules = ["getBoard", "showBoard", "drawBoard", "scanProject"].map(
  (name) => `src/board/mcp/tools/register${name[0].toUpperCase()}${name.slice(1)}Tool.ts`,
);
const tools = (await Promise.all([
  read("src/board/mcp/tools.ts"),
  read("src/board/mcp/schemas.ts"),
  read("src/board/mcp/presentation.ts"),
  read("src/board/mcp/context.ts"),
  ...toolModules.map((file) => read(file)),
])).join("\n");
/*
 * `types.ts` is a barrel after the refactor. Guards assert behaviour, so they
 * read the modules that actually implement it plus the barrel's exports.
 */
const boardTypes = (await Promise.all([
  read("src/board/types.ts"),
  read("src/board/model/types.ts"),
  read("src/board/model/limits.ts"),
  read("src/board/model/validate.ts"),
  read("src/board/model/size.ts"),
  read("src/board/model/parse-board.ts"),
  read("src/board/model/predicates.ts"),
  read("src/board/model/board.ts"),
  read("src/board/model/digest.ts"),
  read("src/board/layout/arrange.ts"),
  read("src/board/diagram/layout.ts"),
  read("src/board/diagram/generate.ts"),
])).join("\n");
const canvasAdapter = (await Promise.all([
  read("src/board/excalidraw-adapter.ts"),
  read("src/board/canvas/types.ts"),
  read("src/board/canvas/theme.ts"),
  read("src/board/canvas/primitives.ts"),
  read("src/board/canvas/to-excalidraw.ts"),
  read("src/board/canvas/from-excalidraw.ts"),
])).join("\n");
const boardLibrary = (await Promise.all([
  read("src/board/library.ts"),
  read("src/board/library/schema.ts"),
  read("src/board/library/store.ts"),
])).join("\n");
const excalidrawTemplate = await read("src/infra/templates/excalidraw.html");
const liquidGlass = [
  await read("src/infra/templates/liquid-glass.ts"),
  await read("src/infra/templates/liquid-glass-maps.ts"),
].join("\n");
const http = await read("src/board/http.ts");
const scanner = await read("src/board/project-scan.ts");
const boardStore = await read("src/board/store.ts");
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
const goals = await read("docs/GOALS.md");
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
check(goals.includes("### 目标") && goals.includes("### 验收") && goals.includes("Codex 插件") && goals.includes("MCP Apps"), "the consolidated goal record is missing or stale");
check(packageJson.scripts.build.includes("build-plugin.mjs") && packageJson.scripts.check.includes("repo:plugin-check"), "npm scripts do not build and check the plugin");
check(packageJson.scripts["setup:codex"] === "node scripts/setup-codex.mjs", "one-command Codex setup is missing");
check(packageJson.scripts["preview:board"] === "node scripts/preview-board.mjs", "explicit local preview command is missing");
check(await exists("scripts/preview-board.mjs"), "local preview script is missing");
check(await exists("scripts/open-board.mjs") && packageJson.scripts.doodle === "node scripts/open-board.mjs", "the one-action board open command is missing");
check(excalidrawTemplate.includes('id="doodleWelcome"') && excalidrawApp.includes("WELCOME_STORAGE_KEY") && excalidrawApp.includes("initWelcome"), "the first-run board guidance is missing or not dismissible");
check((await read("src/board/viewport-memory.ts")).includes("isViewportNearContent") && excalidrawApp.includes("readStoredViewport"), "the canvas no longer remembers a sane viewport per board");
check(tools.includes("isSuspiciousEmptyWrite") || http.includes("isSuspiciousEmptyWrite"), "writes are not guarded against accidentally clearing a full board");
check(
  (http.match(/isSuspiciousEmptyWrite\(/g) ?? []).length >= 2 &&
  http.includes("EmptyWriteRefusedError"),
  "the empty-write guard only runs on the revision-checked path",
);
check(boardStore.includes("quarantineCorruptState"), "a corrupt board file still prevents startup");
check(boardTypes.includes("COORDINATE_OUT_OF_RANGE") && !boardTypes.includes("maxWidth, input.w ?? 180") && !boardTypes.includes("Math.min(MAX_SHAPE_WIDTH, input.w ?? 180)"), "drawing input is silently clamped instead of rejected");
check(
  boardTypes.includes("must be at least") && boardTypes.includes("SIZE_OUT_OF_RANGE"),
  "the size floor is not rejected: an explicit w/h below the minimum must fail, not be raised",
);
check(
  tools.includes("AUTHOR_ON_ITEM") && tools.includes("author must not be set per item"),
  "a per-item author is accepted: the write path overwrites it instead of rejecting it",
);
check(
  (await read("src/board/diagram/recipe.ts")).includes("edges: diagram.edges ?? []"),
  "diagram edges are not normalised: an omitted `edges` field crashes the generator",
);
check(http.includes("this.revisions?.remember(board)") && (await read("src/server.ts")).includes("new BoardHttpServer(board, config, revisions)"), "browser writes are not recorded in the shared revision cache");
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
check(experienceAudit.includes("| E15 | P1 | fixed |") && experienceAudit.includes("npm `latest`") && experienceAudit.includes("dist-tags.latest"), "experience audit does not record the closed npm publication gate");
check(experienceAudit.includes("| E19 | P1 | fixed |") && experienceAudit.includes("terminal-owned preview command"), "experience audit does not record PANEL_URL lifecycle clarification");
check(!readme.includes("尚未更新") && !readmeEn.includes("until `npm view doodle-mcp version`"), "READMEs still warn about a resolved npm version gap");
check(gitignore.includes(".doodle-plugin/") && gitignore.includes(".doodle-data/") && gitignore.includes("doodle-plugin-submission/"), "generated plugin output, data, or submission ZIP is not ignored");
check(index.indexOf("await mcp.connect(transport);") < index.indexOf("await preview.start();"), "MCP stdio is not connected before optional preview startup");
check(index.includes("Preview unavailable"), "preview failure does not keep the MCP server alive");
check(config.includes("previewPort: rawPort ? parsePort(rawPort) : null") && config.includes("PLUGIN_DATA"), "runtime config is not plugin-safe");
check(
  (await read("test/mcp.test.mjs")).includes("function freePort()")
    && !/withClient(In)?\(\s*(outputDir\s*,\s*)?\d{4,5}\b/.test(await read("test/mcp.test.mjs")),
  "MCP tests pin a preview port instead of asking the OS for a free one, so parallel checkouts collide",
);
check(
  !/PREVIEW_PORT:\s*"[1-9]\d*"/.test(await read("examples/board-client.mjs")),
  "the board client example pins a preview port instead of asking the OS for a free one",
);
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
/*
 * Assert the layering, not a module count.
 *
 * A fixed total (previously 17 and 25) fights every legitimate split and says
 * nothing about health. These checks encode what the structure must provide:
 * each concern has a home, no module regrows into a monolith, and the public
 * barrels stay thin.
 */
for (const group of ["model", "diagram", "layout", "mcp", "canvas", "http"]) {
  check(
    sourceFiles.some((name) => name.startsWith(`${group}${path.sep}`) || name.startsWith(`${group}/`)),
    `src/board is missing the ${group} module group`,
  );
}
for (const barrel of ["types.ts", "tools.ts", "library.ts"]) {
  const file = path.join(root, "src", "board", barrel);
  const lines = await fs.readFile(file, "utf8").then((text) => text.split("\n").length, () => 0);
  if (lines === 0) continue;
  check(lines <= 120, `${barrel} is a barrel again, not a module (${lines} lines)`);
}
check(
  !(await fs.access(path.join(root, "src", "board", "tools.ts")).then(() => true, () => false)),
  "the monolithic tools.ts is back; tools must stay in mcp/tools/",
);
check(!boardIndex.includes("preview-server") && !boardIndex.includes("session-store"), "board index re-exports legacy infrastructure");
check((tools.match(/server\.registerTool\(/g) ?? []).length === 4 && !tools.includes("server.tool("), "tools.ts does not register exactly four annotated MCP tools");
check(tools.includes("readOnlyHint: true") && tools.includes("destructiveHint: true") && tools.includes("openWorldHint: false"), "tool annotations are incomplete");
check(tools.includes("registerAppResource") && tools.includes('"ui://doodle/board/excalidraw/v1.html"'), "Excalidraw MCP App canvas resource is missing");
check(tools.includes('"show_board"') && tools.includes('"get_board"'), "canvas render and data tools are not separated");
/*
 * A tool description is the model's only map of a nine-field tool.
 *
 * `draw_board` carried a 171-character blurb that never mentioned `diagram`,
 * `updates`, or the top-level `author`, so a model had to discover the shape by
 * failing. The description must name the three mutually exclusive uses and the
 * prefer-updates rule.
 */
check(
  tools.includes("三个互斥的用法") && tools.includes("复杂图优先用它") && tools.includes("改已有内容用 updates"),
  "draw_board's description no longer explains its three mutually exclusive uses or the prefer-updates rule",
);
check(tools.includes("CANVAS_UI_META") && tools.includes("_meta: CANVAS_UI_META"), "draw_board does not advertise the canvas for automatic post-draw rendering");
check(tools.includes("getAppHtml()") && tools.includes("PANEL_URL"), "Excalidraw MCP App resource is not plugin-safe and the panel URL is missing");
check(tools.includes("FIRST_USE:") && tools.includes("NEXT_STEPS:") && tools.includes("NEXT:"), "get_board does not use progressive first-use and next-step guidance");
/*
 * Repair over prose.
 *
 * The MCP SDK validates `inputSchema` before the tool handler and reports a
 * failure as a bare `MCP error -32602`, which carries no code, path, or fix.
 * Bounds therefore live in `model/` so every rejection reaches `errorResult`.
 * These guards fail if a length or range constraint creeps back into the schema
 * and starts answering a model with prose on the path it hits first.
 */
check(
  // Only the write path matters: a rejected read is cheap to retry, while a
  // rejected write is the round trip this contract exists to remove.
  !/z\.string\(\)\.max\(/.test((await read("src/board/mcp/schemas.ts"))) &&
    !/z\.array\([^)]*\)\.max\(/.test((await read("src/board/mcp/schemas.ts"))),
  "a length or range bound moved back into the MCP input schema: the SDK rejects it with bare prose instead of ERROR_JSON",
);
check(
  tools.includes("BATCH_TOO_LARGE") && tools.includes("MUTATION_BATCH_LIMIT"),
  "the per-call batch ceiling is missing from the handler, so an oversized draw is rejected without a repair path",
);
check(
  (await read("src/board/diagram/layout.ts")).includes("UNKNOWN_EDGE_NODE"),
  "diagram layout rejects input with bare prose instead of a repairable error",
);
check(
  tools.includes("ctx.board.mutate((current) => change(current))"),
  "an unpinned draw_board write is back to snapshot-then-replace, so two simultaneous agents fail each other",
);
check(
  (await read("src/board/mcp/schemas.ts")).includes("Defaults to true and makes the new board active"),
  "the library switchTo default is undocumented again; a model cannot tell that create/save/duplicate/import move the person off their board",
);
check(
  (await read("src/board/model/parse-board.ts")).includes("isFillColor(candidate.color)")
    && (await read("src/board/model/predicates.ts")).includes("export function isFillColor"),
  "parseBoard no longer validates colour: replace_board would accept a fill the canvas cannot paint",
);
check(
  (await read("src/board/model/parse-board.ts")).includes("items[${index}]"),
  "parseBoard rejections stopped naming the item index, so a whole-board payload is unrepairable",
);
check(
  boardTypes.includes("BOARD_ITEM_LIMIT") && boardTypes.includes("ITEM_NOT_FOUND"),
  "the capacity ceiling or a missing update target rejects with bare prose again",
);
check(
  tools.includes("SIZE: ${payload.itemCount}") && tools.includes('view: "summary"'),
  "a large board no longer advertises the cheaper graded reads",
);
check(
  tools.includes("cached && cached.id === current.id ? cached : undefined"),
  "since_revision is compared across boards again: a library switch would be reported as every object added and removed",
);
check(
  (await read("src/board/diagram/layout.ts")).includes("const row = node.row ?? (wrap ? wrappedRow :"),
  "the flow snake adds the pass index to the running row count again, so long chains drift down the page",
);
check(
  boardTypes.includes("TITLE_TOO_LONG") && boardTypes.includes("GROUP_ID_TOO_LONG"),
  "a title or group id is truncated again instead of rejected, so the stored board disagrees with the request",
);
check(
  boardTypes.includes("Update ${index} targets") && boardTypes.includes("remove_ids[${index}] names"),
  "a batch update or removal is best-effort again: a missing id is skipped and the reply claims success",
);
check(
  (await read("src/board/layout/arrange.ts")).includes("layout.ids[${index}] names")
    && (await read("src/board/layout/arrange.ts")).includes("LAYOUT_COLUMNS_OUT_OF_RANGE"),
  "layout silently repairs its own input again: an unknown id arranges the whole board and an out-of-range bound is clamped",
);
check(
  !/x: Math\.max\(-MAX_COORDINATE/.test((await read("src/board/model/validate.ts"))),
  "normalizeItem clamps coordinates again; resolveGeometry is the only place that may bound them",
);
check(
  tools.includes('BOARD_VIEW_${view.toUpperCase()}') && tools.includes('["BOARD_JSON:", JSON.stringify(visiblePayload)]'),
  "graded views send the board twice: only `full` may carry the full BOARD_JSON text copy",
);
check(
  tools.includes("structuredContent: { ...boardWriteSnapshot(board, libraryIndex), change: changeReport"),
  "draw_board no longer returns the authoritative canvas snapshot plus change report",
);
check(tools.includes("function boardAgentPayload") && tools.includes("canvasFidelityItems") && tools.includes("function boardJson(") && tools.includes("function boardWriteSnapshot("), "agent payload, full canvas payload, and write snapshot are not separated");
check(
  !tools.includes("structuredContent: { ...boardJson(board"),
  "draw_board is back to returning the full agent payload on every write; a write needs only id/revision/items/library",
);
check(
  (tools.match(/boardWriteSnapshot\(active, result\.index\)/g) ?? []).length === 1
    && excalidrawApp.includes("Array.isArray(result.items)"),
  "the library branch no longer returns a flat snapshot the canvas can repaint from, so every library action falls back to an extra fetch",
);
check(tools.includes("since_revision") && tools.includes("boardAgentDelta") && tools.includes("BoardRevisionCache"), "incremental rereads or their revision cache are missing");
check(tools.includes("include_canvas_fidelity") && excalidrawApp.includes("include_canvas_fidelity: true"), "the canvas cannot request the fidelity that agent reads omit");
check(tools.includes("describeHandoff") && tools.includes("handoff") && tools.includes("needsAttention"), "delta reads do not attribute human edits");
check((await read("src/board/handoff.ts")).includes("HANDOFF_READINGS") === false && (await read("src/board/handoff.ts")).includes("readings") && tools.includes("HANDOFF_READINGS"), "handoff no longer explains what the human change means");
check(buildScript.includes("excalidraw-app.tsx"), "build is missing the canvas client");
check(tools.includes("guideSent") && tools.includes("include_guide"), "the guide is not sent once with an explicit opt-in");
check(tools.includes("boardCapabilities()") && tools.includes("visualDigest: boardVisualDigest(board)") && tools.includes("boardRecipes()"), "board tools lost AI visual language");
check(
  tools.includes("startItemId: z.string()")
    // `mode` is a string in the schema so the domain layer reports the repair;
    // the accepted values live in `model/limits.ts` and in the description.
    && tools.includes("Arrangement mode: grid, row, column, timeline, cluster, or architecture")
    && tools.includes("diagram: diagramInput.optional()"),
  "draw_board lost connector bindings, expanded layouts, or semantic diagram recipe",
);
check(
  tools.includes("Semantic arrangement, default flow") && tools.includes("diagramModes"),
  "draw_board.diagram lost its semantic layout modes",
);
check(boardTypes.includes("resolveDiagramLayout") && boardTypes.includes("diagramToBoardItems") && !boardTypes.includes("diagramToExcalidrawScene"), "semantic diagrams are not generated through one deterministic Board v1 layout");
check(
  boardTypes.includes("const flowWrap = 6;") &&
  !boardTypes.includes("omittedEdgeCount") &&
  boardTypes.includes("if (deltaX === 0 && deltaY === 0) return;"),
  "diagram layout lost its flow wrapping or silently drops edges again",
);
check(
  boardTypes.includes("reservedIds: Iterable<string> = []") &&
  boardTypes.includes("startItemId: renames.get(edge.from) ?? edge.from"),
  "appending a diagram can no longer suffix colliding ids or rebind its connectors",
);
check(
  !boardTypes.includes("!itemIds.has(candidate.startItemId)") &&
  boardTypes.includes("if (item.startItemId && !allItemIds.has(item.startItemId))"),
  "connector bindings are validated before all items are known, rejecting forward references",
);
check(
  (await read("src/board/diagram/layout.ts")).includes("DIAGRAM_ROW_OUT_OF_RANGE")
    && await exists("docs/DIAGRAM_GUIDE.md"),
  "diagram row limit is too small for a long sequence, or the diagram guide is missing",
);
check(!http.includes('"/api/board/scene"') && !excalidrawApp.includes("loadScene()"), "a second persisted Excalidraw scene source remains");
check(tools.includes('"scan_project"') && tools.includes("Use draw_board to visualize"), "scan_project is not a read-only board-context tool");
check(boardTypes.includes("signedWidth") && boardTypes.includes("signedHeight"), "board types lost signed directed-arrow deltas");
check(boardTypes.includes("boardVisualDigest") && boardTypes.includes("startItemId") && boardTypes.includes("variant"), "board types lost visual-expression fields or deterministic visual digest");
check(excalidrawApp.includes("excalidraw") && canvasAdapter.includes("boardOpacityToExcalidraw"), "canvas opacity is not converted between Board v1 (0-1) and Excalidraw (0-100)");
check(canvasAdapter.includes("inkOn(") && canvasAdapter.includes("themedFill("), "canvas ink or fill is no longer adapted to the theme");
check(excalidrawApp.includes("EXCALIDRAW_THEME"), "Excalidraw may invert board colours again in dark mode");
check(excalidrawTemplate.includes("--glass-bg") && excalidrawTemplate.includes(".doodle-glass") && excalidrawTemplate.includes("var(--glass-refraction, blur(var(--glass-blur))"), "the liquid-glass material or its refraction fallback is missing");
check(excalidrawTemplate.includes("--glass-shade") && liquidGlass.includes("feDisplacementMap") && liquidGlass.includes("bevelAmplitude") && liquidGlass.includes("paintEdgeMap"), "the liquid-glass lens lost its bevelled displacement maps");
check(excalidrawTemplate.includes("--doodle-wash-c") && liquidGlass.includes("MutationObserver") && liquidGlass.includes("ResizeObserver"), "the glass lost its refraction backdrop or its observer lifecycle");
check(excalidrawTemplate.includes("color-mix(in srgb, var(--island-bg-color)") && !/\.excalidraw \.Island \{[^}]*background/.test(excalidrawTemplate), "native islands no longer follow Excalidraw surface tokens, so icons can vanish");
check(
  excalidrawApp.includes("sceneReady") &&
  excalidrawApp.includes("if (elements.length === 0) return;") &&
  !excalidrawApp.includes("elements.length < activeSnapshot.items.length"),
  "canvas can write an empty mount-time scene over a loaded board, or rejects real edits by comparing element counts",
);
check(boardTypes.includes("createStarterBoard") && boardTypes.includes("createEmptyBoard"), "board types lost the compatibility starter or empty board");
check(boardStore.includes("createEmptyBoard") && !boardStore.includes("createStarterBoard()"), "new board state is not empty-first");
check(excalidrawTemplate.includes("Doodle · Excalidraw Canvas") && excalidrawTemplate.includes('id="excalidrawRoot"'), "Excalidraw-only board template is missing");
check(excalidrawTemplate.includes("/excalidraw/excalidraw-app.js") && excalidrawTemplate.includes("const PANEL_TOKEN"), "Excalidraw template lost its local entry or panel token");
check(excalidrawTemplate.includes('id="doodleLibraryPanel"') && !excalidrawTemplate.includes('id="toast"'), "Excalidraw template lost the library overlay or kept an obsolete toast");
check(excalidrawTemplate.includes('data-library-action="duplicate">另存一份') && excalidrawTemplate.includes('id="doodleLibraryStatus"'), "Excalidraw template lost save-as feedback or turned it into a rename");
/*
 * "另存一份" must copy the board the person is looking at. Clicking a row
 * switches to it, so the active snapshot *is* the source; the guard now binds
 * to that contract instead of to the removed `selectedBoardId` variable.
 */
check(excalidrawApp.includes('if (action.type === "duplicate")') && excalidrawApp.includes('id: activeSnapshot?.id'), "canvas library Save As does not duplicate the active snapshot");
check(excalidrawApp.includes("exportToBlob") && excalidrawApp.includes("exportToSvg") && excalidrawTemplate.includes('data-snapshot-export="png"') && excalidrawTemplate.includes('data-snapshot-export="jpg"') && excalidrawTemplate.includes('data-snapshot-export="svg"'), "static PNG/JPG/SVG snapshot exports are missing");
check(excalidrawTemplate.includes("--doodle-accent") && excalidrawTemplate.includes('data-doodle-theme="dark"') && excalidrawTemplate.includes("radial-gradient(circle, var(--doodle-dot)") && excalidrawApp.includes('view: "transparent"'), "unified theme tokens or native Excalidraw dot grid are missing");
check(excalidrawTemplate.includes(".excalidraw {\n      --color-primary: #4a6785") && excalidrawTemplate.includes(':root[data-doodle-theme="glass"] .excalidraw {\n      --color-primary: #2f6b5c') && excalidrawTemplate.includes('.excalidraw.theme--dark,\n    :root[data-doodle-theme="dark"] .excalidraw {\n      --color-primary: #8fcbb4'), "Excalidraw controls are not mapped across the paper, glass, and dark palettes");
check(excalidrawTemplate.includes(':root[data-doodle-theme="dark"] .excalidraw {') && excalidrawTemplate.includes("--button-gray-1: #2a342f"), "the dark page does not retheme Excalidraw's chrome, so controls stay white");
check(!/--color-primary:\s*#6965db/.test(excalidrawTemplate) && excalidrawTemplate.includes("--color-surface-primary-container: #dcebe4"), "Excalidraw purple defaults remain visible in the canvas theme");
check(excalidrawTemplate.includes('id="doodleThemeToggle"') && excalidrawApp.includes("initThemeToggle") && excalidrawApp.includes("THEME_STORAGE_KEY"), "appearance theme switcher is missing");
check(
  ['{ id: "light"', '{ id: "dark"', '{ id: "glass"'].every((entry) => excalidrawApp.includes(entry)) &&
    ['data-theme-option="light"', 'data-theme-option="dark"', 'data-theme-option="glass"'].every((option) => excalidrawTemplate.includes(option)) &&
    excalidrawApp.includes('theme === "glass" ? "glass" : "paper"'),
  "the three appearances or the paper/glass material split are incomplete",
);
check(excalidrawTemplate.includes("--doodle-drawer-width") && excalidrawTemplate.includes("doodle-drawer-scrim") && excalidrawApp.includes("doodle-drawer-open"), "library drawer lost its bounded width or accessible scrim");
check(excalidrawTemplate.includes("body.doodle-drawer-open .doodle-topbar") && !excalidrawTemplate.includes("body.doodle-drawer-open .excalidraw-host > .excalidraw"), "library drawer squeezes or collides with the canvas toolbar");
check(excalidrawTemplate.includes("body:has(.excalidraw .dropdown-menu) .doodle-topbar") && excalidrawTemplate.includes("body:has(.excalidraw .Modal) .doodle-topbar"), "Doodle toolbar does not yield to Excalidraw menus and modal overlays");
check(excalidrawTemplate.includes(".doodle-library-section--boards") && excalidrawTemplate.includes(".doodle-library-section--shares") && excalidrawTemplate.indexOf(".doodle-library-section--boards") < excalidrawTemplate.indexOf('data-library-action="duplicate"'), "library drawer does not separate its scrollable list from fixed actions");
check(hoverGeometry.length === 0, `hover or active feedback changes layout geometry: ${hoverGeometry.join(", ")}`);
check(excalidrawApp.includes("scrim.hidden = false") && excalidrawApp.includes("scrim?.addEventListener(\"click\", closePanel)") && excalidrawApp.includes("event.key === \"Escape\""), "library drawer lost its scrim, outside-click, or Escape dismissal");
check(excalidrawApp.includes("https://github.com/2648782102/Doodle") && excalidrawApp.includes("isDoodleProjectLink") && excalidrawApp.includes("group.querySelector(\"a[href]\")"), "canvas link policy no longer allows only the Doodle repository or hides upstream link groups");
check(excalidrawTemplate.includes('.main-menu-trigger') && excalidrawTemplate.includes(".App-menu_top__left") && !excalidrawApp.includes("MainMenu"), "the upstream wordmark menu is still mounted or is not suppressed in CSS");
check(excalidrawTemplate.includes(".excalidraw .Island.sidebar {") && excalidrawTemplate.includes("border-radius: var(--doodle-radius-lg)") && excalidrawTemplate.includes("top: 72px") && excalidrawTemplate.includes("right: 12px"), "the library sidebar is not inset and rounded like the other panes");
check(excalidrawTemplate.includes(".excalidraw .zoom-actions .zoom-button:first-child .ToolIcon__icon") && excalidrawTemplate.includes("border-radius: 12px 0 0 12px"), "bottom control islands do not share the pane corner radius");
check(
  excalidrawTemplate.includes(".excalidraw .undo-redo-buttons,\n    .excalidraw .help-icon,\n    .excalidraw .sidebar-trigger,") &&
  excalidrawTemplate.includes(".excalidraw .undo-redo-buttons button,") &&
  excalidrawTemplate.includes(".excalidraw .sidebar-trigger__label-element { background-color: transparent !important; }") &&
  liquidGlass.includes('".excalidraw .zoom-actions",') &&
  liquidGlass.includes('".excalidraw .undo-redo-buttons",'),
  "bottom zoom/undo and the library trigger are not on the glass material, or their opaque button fills were not cleared",
);
check(excalidrawTemplate.includes(".excalidraw .mobile-misc-tools-container {") && excalidrawTemplate.includes(".excalidraw .App-bottom-bar > .Island {") && excalidrawTemplate.includes("--glass-refraction"), "mobile chrome is not on the shared glass material");
check(excalidrawTemplate.includes("body:has(.excalidraw .dropdown-menu) .excalidraw .mobile-misc-tools-container") && excalidrawTemplate.includes(".excalidraw .dropdown-menu .dropdown-menu-container"), "mobile menus do not yield the right-hand tool strip or lack the menu surface");
check(excalidrawTemplate.includes(".excalidraw .App-bottom-bar .App-mobile-menu {") && excalidrawTemplate.includes("background-color: var(--doodle-surface-solid)") && excalidrawTemplate.includes("backdrop-filter: none"), "the expanded property sheet is translucent, so board content ghosts through its controls");
check(excalidrawTemplate.includes("grid-template-columns: repeat(2, minmax(0, 1fr))") && excalidrawTemplate.includes("grid-column: 1 / -1"), "the mobile property sheet is a single narrow column instead of a two-column grid");
check(excalidrawTemplate.includes(".excalidraw .mobile-misc-tools-container { display: flex; flex-direction: column; gap: 6px; }") && excalidrawTemplate.includes("width: 40px; height: 40px; border-radius: 10px"), "the mobile right-hand tool strip lost its even rows or padding");
check(excalidrawTemplate.includes(".excalidraw .HintViewer { display: none !important; }"), "upstream hint strip still overlaps the Doodle capsule on narrow screens");
check(!/inset 0 0 \d+px -\d+px var\(--glass/.test(excalidrawTemplate), "a negative-spread inner glow is back, which paints an inset box inside the pane");
check(liquidGlass.includes("const clamped = Math.min(Math.max(t, 0), 1);") && liquidGlass.includes("const fall = 1 - Math.pow(clamped, 3);"), "the bevel displacement no longer tapers to zero at the inner edge");
check(excalidrawApp.includes("doodleSyncBanner") && excalidrawApp.includes("clearError") && !excalidrawApp.includes("api.updateScene({ elements: toElements(refreshed)"), "a rejected save still repaints the canvas from the server or fails silently");
check(canvasAdapter.includes("MIN_STORED_SIZE"), "canvas projection can emit items below the stored minimum size");
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
check((await read("src/board/http/templates.ts")).includes("excalidrawTemplateCandidates") && http.includes("panelUrlValue"), "plugin bundle Excalidraw template resolution and dynamic panel URL are missing");
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
check(tools.includes("projectDiagramDraft") && tools.includes("DIAGRAM_DRAFT_JSON"), "scan_project does not return a ready-to-draw diagram draft");
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
/*
 * One consolidated goal record replaced nine per-goal documents. The contract
 * still holds: every shipped goal keeps an 目标/验收 pair, the shared red lines
 * stay stated once, and the documentation map must point at the file.
 */
check(
  await exists("docs/GOALS.md")
    && (goals.match(/### 验收/g) ?? []).length >= 6
    && goals.includes("## 通用红线")
    && (await read("docs/README.md")).includes("GOALS.md"),
  "consolidated goal record or its documentation-map link is missing",
);
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
check(
  totalSourceFiles.length >= 25 && totalSourceFiles.length <= 80,
  `src has ${totalSourceFiles.length} TypeScript modules; expected a modular but bounded tree`,
);
check(
  boardTypes.includes("diagnoseBoard") &&
  tools.includes("VISUAL_DIAGNOSIS") &&
  tools.includes("VISUAL_DIAGNOSIS_JSON"),
  "get_board no longer exposes the AI visual diagnosis",
);
check(
  (await read("src/board/errors.ts")).includes("BoardValidationError") &&
  (await read("src/board/mcp/presentation.ts")).includes("ERROR_JSON") &&
  (await read("src/board/model/validate.ts")).includes("INVALID_COLOR"),
  "validation errors are not structured for self-repair",
);
check(
  await exists("src/board/diagram/recipe.ts") &&
  tools.includes("changeReportText") &&
  tools.includes("viewPayload") &&
  (await read("src/board/mcp/presentation.ts")).includes("roleMeanings"),
  "high-level recipes, change reports, graded reads, or visual semantics are missing",
);
check(await exists("docs/GOALS.md") && goals.includes("AI 视觉体验") && await exists("test/ai-experience.test.mjs"), "AI experience goal or prompt-contract suite is missing");

if (failures.length) {
  console.error("❌ Offline repository checks failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("✅ Offline repository checks passed: simple-board source, docs, and metadata are aligned");
