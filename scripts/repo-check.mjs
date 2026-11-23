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
const serverJson = JSON.parse(await read("server.json"));
const server = await read("src/server.ts");
const buildScript = await read("scripts/build.mjs");
const instructions = await read("src/board/mcp/instructions.ts");
const appContext = await read("src/board/view/app-context.ts");
const excalidrawApp = (await Promise.all([
  read("src/infra/templates/excalidraw-app.tsx"),
  read("src/infra/templates/client/types.ts"),
  read("src/infra/templates/client/theme.ts"),
  read("src/infra/templates/client/link-policy.ts"),
  read("src/infra/templates/client/banner.ts"),
  read("src/infra/templates/client/transport.ts"),
  read("src/infra/templates/client/library-ui.ts"),
  read("src/infra/templates/client/library-list.ts"),
  read("src/infra/templates/client/sync-state.ts"),
  read("src/infra/templates/client/canvas-sync.ts"),
])).join("\n");
const canvasTransport = await read("src/infra/templates/client/transport.ts");
const writeRecovery = await read("src/infra/templates/client/write-recovery.ts");
const writePipeline = await read("src/board/write/commit.ts");
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
  read("src/board/model/board-shape.ts"),
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
/*
 * The HTTP surface is two files now: `server.ts` owns lifecycle (listen, adopt,
 * single-instance record) and `http/routes.ts` owns the route table. A guard that
 * inspected only one of them would pass while the other lost its contract, so
 * every check below reads both.
 */
const http = [
  await read("src/board/http/server.ts"),
  await read("src/board/http/routes.ts"),
].join("\n");
const scanner = await read("src/board/project/scan.ts");
const boardStore = await read("src/board/state/store.ts");
const mutex = await read("src/board/state/mutex.ts");
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
const store = await read("src/board/state/store.ts");
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

/*
 * The released version, asserted from three places that must agree.
 *
 * A release edits this line; that is the point. Leaving it at the previous
 * version would let a tag ship with a package whose manifests disagree, and
 * the registry reads all three.
 */
const RELEASE_VERSION = "0.9.1";
check(packageJson.version === RELEASE_VERSION, `package.json is not version ${RELEASE_VERSION}`);
check(serverJson.version === RELEASE_VERSION, `server.json is not version ${RELEASE_VERSION}`);
check(
  serverJson.packages?.[0]?.version === RELEASE_VERSION,
  `server.json package entry is not version ${RELEASE_VERSION}`,
);
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
/*
 * The private-DOM dependency is bounded, not shrinking.
 *
 * Issue #43 asked to replace the .excalidraw selectors with official extension
 * points. On 0.18 that surface is exhausted — UIOptions has canvasActions,
 * tools.image and dockedSidebarBreakpoint only, all already set — so the
 * remaining selectors have no API equivalent. Decision 34 records that. This
 * check exists so a future upgrade that *does* add chrome theming is noticed:
 * an unexpected growth in the extension surface is the signal to re-open it.
 */
const excalidrawTypes = await read("node_modules/@excalidraw/excalidraw/dist/types/excalidraw/types.d.ts");
/*
 * Top-level keys only, indented four spaces. `tools` holds `image` one level
 * deeper, and counting a nested field as a sibling would make the ceiling
 * meaningless — the check exists to notice a *new* chrome-theming surface.
 */
const uiOptionsStart = excalidrawTypes.indexOf("export type UIOptions = Partial<{");
const uiOptionsEnd = excalidrawTypes.indexOf("export type AppProps", uiOptionsStart);
const uiOptionKeys = excalidrawTypes
  .slice(uiOptionsStart, uiOptionsEnd)
  .split("\n")
  .filter((line) => /^ {4}[A-Za-z][A-Za-z]*\??:/.test(line))
  .map((line) => line.trim().split("?")[0].split(":")[0].trim());
check(
  uiOptionKeys.length <= 4,
  `Excalidraw's UIOptions grew to ${uiOptionKeys.length} keys (${uiOptionKeys.join(", ")}). Re-read decision 34: new chrome-theming options may make the 24 upstream selectors reducible.`,
);

/*
 * Every Excalidraw internal Doodle styles must be declared in
 * `upstream-contract.ts`. The table is what makes the dependency auditable: an
 * upgrade that renames `.App-toolbar` can be triaged from 24 entries instead of
 * 110 KB of CSS. A new undeclared selector is a new dependency nobody agreed to.
 */
const upstream = await import("../dist/infra/templates/upstream-contract.js");
const declaredUpstream = upstream.UPSTREAM_DEPENDENCIES.map((entry) => entry.selector);
const usedUpstream = upstream.upstreamSelectorsUsed(excalidrawTemplate);
const undeclaredUpstream = usedUpstream.filter((selector) => !declaredUpstream.includes(selector));
const staleUpstream = declaredUpstream.filter((selector) => !usedUpstream.includes(selector));
check(
  undeclaredUpstream.length === 0,
  `excalidraw.html styles undeclared Excalidraw internals: ${undeclaredUpstream.join(", ")}. Add them to src/infra/templates/upstream-contract.ts with what they are used for.`,
);
check(
  staleUpstream.length === 0,
  `upstream-contract.ts declares internals the stylesheet no longer uses: ${staleUpstream.join(", ")}. Remove them so the table stays honest.`,
);

/*
 * A rejected save must tell the person why.
 *
 * The canvas threw a bare "Board update failed" and discarded the
 * `ERROR_JSON` the tool had already produced, so the banner could not
 * distinguish a bad colour from a revision conflict — the person had no idea
 * what to change. Both the sync path and the library path must go through
 * `toolErrorMessage`.
 */
check(
  // A closed socket must announce itself. Silent reconnect left the person
  // drawing on a canvas whose every save would fail.
  excalidrawApp.includes("function showConnectionNotice(")
    && excalidrawApp.includes("connectionNoticeVisible")
    && excalidrawApp.includes('dataset.sticky === "true"'),
  "the canvas silently reconnects again, so a dead connection looks like a working board",
);
check(
  /*
   * A rejected write must keep its reason *and* its machine-readable code.
   *
   * `Error(message)` was enough for a toast, but conflict recovery needs
   * `REVISION_CONFLICT_OBJECTS` and the object ids to offer "载入最新 / 保留我的".
   */
  excalidrawApp.includes("function toolErrorPayload(")
    && (excalidrawApp.match(/throw new BoardWriteError\(/g) ?? []).length >= 2
    && excalidrawApp.includes("payload.code"),
  "the canvas discards the rejection reason again, so a failed save shows a message that names nothing",
);
check(excalidrawTemplate.includes('id="doodleWelcome"') && excalidrawApp.includes("WELCOME_STORAGE_KEY") && excalidrawApp.includes("initWelcome"), "the first-run board guidance is missing or not dismissible");
/*
 * Assert the behaviour, not the file it lives in.
 *
 * The canvas client was split into `client/` modules; this check kept pointing
 * at `excalidraw-app.tsx` and started failing on a working board. What matters
 * is that something calls the guard before trusting a stored viewport.
 */
const canvasView = await read("src/board/client/viewport-memory.ts");
const canvasViewCaller = [
  excalidrawApp,
  await read("src/infra/templates/client/canvas-view.ts"),
].join("\n");
check(
  canvasView.includes("isViewportNearContent") && canvasViewCaller.includes("readStoredViewport"),
  "the canvas no longer remembers a sane viewport per board",
);
check(tools.includes("isSuspiciousEmptyWrite") || http.includes("guardEmptyWrite: true"), "writes are not guarded against accidentally clearing a full board");
check(
  /*
   * One guard, reached by every path through the shared write pipeline.
   */
  http.includes("EmptyWriteRefusedError") &&
  http.includes("commitBoardWrite") &&
  http.includes("guardEmptyWrite: true") &&
  writePipeline.includes("isSuspiciousEmptyWrite(current, candidate)") &&
  (writePipeline.match(/candidateFor\(current\)/g) ?? []).length >= 3,
  "a commit path no longer runs the empty-write guard: a stale client could erase a full board",
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
check(
  (writePipeline.includes("revisions?.remember(board)") && http.includes("commitBoardWrite"))
    && (await read("src/server.ts")).includes("new BoardHttpServer(board, config, revisions)"),
  "browser writes are not recorded in the shared revision cache",
);
check(troubleshooting.includes("npm run preview:board") && troubleshooting.includes("current MCP server process"), "troubleshooting does not explain PANEL_URL lifetime");
check(packageJson.scripts.check.includes("setup:codex -- --dry-run"), "npm check does not dry-run the Codex setup");
check(ci.includes("npm run repo:plugin-check"), "CI does not run the plugin guard");
check(ci.includes("npm run setup:codex -- --dry-run"), "CI does not dry-run the Codex setup");
check(ci.includes("npm run build:submission"), "CI does not build the submission ZIP");
check(ci.includes("resolveDiagramLayout") && ci.includes("diagramToBoardItems"), "CI does not verify deterministic semantic diagrams");
check(ci.includes("BoardLibrary") && ci.includes("type: \"create\""), "CI does not verify the local board library");
check(ci.includes("Verify final-state board context projection") && ci.includes("buildBoardModelContext") && ci.includes("doodle_board_context"), "CI does not verify the final-state context projection");
/*
 * Every `dist/` path a workflow or script imports must exist after a build.
 *
 * Moving `app-context.ts` into `view/` left two `import ... from
 * "./dist/board/app-context.js"` lines in the CI workflow. `npm run check`
 * never runs those inline scripts, and the repo guard only inspected *source*
 * paths, so the failure surfaced for the first time in CI. This walks the
 * workflow heredocs and the repo scripts, and asserts each referenced compiled
 * module resolves to a real source file — so a move that forgets a consumer
 * fails locally instead of on the next push.
 */
const workflowFiles = (await fs.readdir(path.join(root, ".github", "workflows")))
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
const compiledRefs = new Set();
/*
 * A workflow heredoc runs from the repository root, so its `./dist/...` paths
 * are root-relative. A module script resolves relative to its own directory.
 */
const compiledConsumers = [
  ...workflowFiles.map((file) => ({ name: `.github/workflows/${file}`, fromRoot: true })),
  ...["scripts/open-board.mjs", "scripts/preview-board.mjs", "examples/board-client.mjs"].map((name) => ({ name, fromRoot: false })),
];
for (const { name, fromRoot } of compiledConsumers) {
  const text = await read(name);
  for (const match of text.matchAll(/["'](\.{1,2}\/[^"']*dist\/[\w./-]+\.js)["']/g)) {
    const base = fromRoot ? "" : path.posix.dirname(name);
    compiledRefs.add(path.posix.normalize(path.posix.join(base, match[1])));
  }
}
const brokenCompiledRefs = [];
for (const reference of compiledRefs) {
  const sourcePath = reference.replace(/^dist\//, "src/").replace(/\.js$/, ".ts");
  const exists = await fs.access(path.join(root, sourcePath)).then(() => true, () => false);
  if (!exists) brokenCompiledRefs.push(`${reference} (no ${sourcePath})`);
}
check(
  brokenCompiledRefs.length === 0,
  `a workflow or script imports a compiled module that no longer exists: ${brokenCompiledRefs.join(", ")}`,
);
check(publishWorkflow.includes("contents: write") && publishWorkflow.includes("gh release create"), "publish workflow cannot create a release");
check(publishWorkflow.includes("npm run check") && publishWorkflow.includes("--notes-file"), "publish workflow does not verify the package or use changelog notes");
check(publishWorkflow.includes('git tag -a "$tag"') && publishWorkflow.includes('git push origin "$tag"') && publishWorkflow.includes('--target "$GITHUB_SHA"'), "publish workflow does not create the matching tag before verifying it");
check(releasing.includes("publish workflow") && !releasing.includes("does not create a Release automatically"), "releasing guide does not describe release automation");
check(releasing.includes("npm stage approve") && releasing.includes("npm view doodle-mcp@<version> version"), "releasing guide does not describe the npm 2FA and version verification gates");
check(experienceAudit.includes("| E12 | P1 | fixed |") && experienceAudit.includes("doodle-mcp@0.6.3"), "experience audit does not record the closed npm publication");
check(experienceAudit.includes("| E13 | P0 | fixed |") && experienceAudit.includes("final-state delta"), "experience audit does not record host model context sync");
check(experienceAudit.includes("| E15 | P1 | fixed |") && experienceAudit.includes("npm `latest`") && experienceAudit.includes("dist-tags.latest"), "experience audit does not record the closed npm publication gate");
check(experienceAudit.includes("Current release gap — 0.9.1") && experienceAudit.includes("npm view doodle-mcp@0.9.1 version"), "experience audit does not record the current npm publication gate");
check(experienceAudit.includes("| E19 | P1 | fixed |") && experienceAudit.includes("terminal-owned preview command"), "experience audit does not record PANEL_URL lifecycle clarification");
check(!readme.includes("尚未更新") && !readmeEn.includes("until `npm view doodle-mcp version`"), "READMEs still warn about a resolved npm version gap");
check(readme.includes("npm 的 `latest` 仍是 `0.8.0`") && readmeEn.includes("npm's `latest` is still `0.8.0`"), "READMEs no longer disclose the current npm publication gap");
check(readme.includes(`截至 \`${RELEASE_VERSION}\``) && readmeEn.includes(`As of \`${RELEASE_VERSION}\``), "README npm-gap note names a different release than package.json");
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
check(packageJson.mcpName === serverJson.name && serverJson.name === "io.github.2648782102/doodle-mcp", "package.json mcpName and server.json name do not match");
check(serverJson.version === packageJson.version && serverJson.packages?.[0]?.version === packageJson.version && serverJson.packages?.[0]?.identifier === packageJson.name, "server.json version or package identifier is out of sync with package.json");
check(serverJson.description.length <= 100, "server.json description exceeds 100-character MCP Registry limit");
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
for (const group of ["model", "diagram", "layout", "mcp", "canvas", "http", "state", "write", "view", "project", "client"]) {
  check(
    sourceFiles.some((name) => name.startsWith(`${group}${path.sep}`) || name.startsWith(`${group}/`)),
    `src/board is missing the ${group} module group`,
  );
}
/*
 * Layering is a direction, not a file tree.
 *
 * The rule that was actually violated before the restructure: the core write
 * path imported `http/conflict.ts`, and the MCP tool surface imported the
 * concrete `BoardHttpServer`. Both put transport knowledge in a layer that must
 * not have any. This walks the real import graph and fails on the first edge
 * that points outward — a module may import from its own ring or inward,
 * never outward. Barrels (`types.ts`, `index.ts`, `library.ts`,
 * `excalidraw-adapter.ts`) re-export from anywhere and are exempt.
 */
const RINGS = [
  [/^errors\.ts$/, 0], [/^model\//, 0],
  [/^diagram\//, 1], [/^layout\//, 1], [/^canvas\//, 1], [/^svg\//, 1],
  [/^view\//, 1], [/^client\//, 1],
  [/^state\//, 2], [/^library\//, 2], [/^project\//, 2],
  [/^write\//, 3],
  [/^mcp\//, 4], [/^http\//, 4],
];
const BARRELS = new Set(["types.ts", "index.ts", "library.ts", "excalidraw-adapter.ts"]);
const RING_NAMES = ["kernel", "derive", "state", "app", "transport"];
const ringOf = (relative) => {
  for (const [pattern, ring] of RINGS) if (pattern.test(relative)) return ring;
  return -1;
};
const boardDir = path.join(root, "src", "board");
const outward = [];
for (const relative of sourceFiles) {
  const readable = relative.split(path.sep).join("/");
  if (BARRELS.has(readable)) continue;
  const fromRing = ringOf(readable);
  if (fromRing < 0) continue;
  const text = await fs.readFile(path.join(boardDir, relative), "utf8");
  for (const match of text.matchAll(/from\s+"(\.[^"]+)"/g)) {
    const target = path.normalize(path.join(path.dirname(relative), match[1]));
    const toRelative = target.split(path.sep).join("/").replace(/\.js$/, ".ts");
    if (BARRELS.has(toRelative)) continue;
    const toRing = ringOf(toRelative);
    if (toRing > fromRing) {
      outward.push(`${readable} (${RING_NAMES[fromRing]}) -> ${toRelative} (${RING_NAMES[toRing]})`);
    }
  }
}
check(outward.length === 0, `a layer imports outward, which is forbidden: ${outward.join("; ")}`);
check(
  !(await fs.access(path.join(root, "src", "board", "http", "conflict.ts")).then(() => true, () => false))
    && (await read("src/board/write/conflict.ts")).includes("reportConflicts"),
  "object-level conflict resolution moved back under http/; it is write-path logic, not transport",
);
check(
  // Match a type/import, not the comment that explains why the type is absent.
  !/import\s+type\s*\{[^}]*BoardHttpServer/.test(await read("src/board/mcp/context.ts"))
    && !/preview:\s*BoardHttpServer/.test(await read("src/board/mcp/context.ts")),
  "the MCP tool context depends on the concrete HTTP server again instead of its own preview port",
);
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
  tools.includes("commitBoardWrite") && writePipeline.includes("store.mutate("),
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
  // A delta read answers "what changed"; its diagnosis must be counts, not the
  // per-object enumeration that made a 1-edit reply cost 6.1 KB.
  tools.includes("compactDiagnosis(payload.diagnosis)"),
  "a delta read carries the full per-object diagnosis again instead of counts",
);

check(
  /*
   * `summary` must not carry per-object arrays. It shipped `readingOrder` and
   * `isolated` in full, so a status check grew linearly with the board — 13 KB
   * at 60 objects — which defeats the only reason the view exists.
   */
  (await read("src/board/mcp/presentation.ts")).includes("export function compactDigest")
    && (await read("src/board/mcp/presentation.ts")).includes("export function compactDiagnosis")
    // Neither projection may pass the enumerations through.
    && !/readingOrder:/.test(await read("src/board/mcp/presentation.ts"))
    && !/isolated: diagnosis\.isolated,/.test(await read("src/board/mcp/presentation.ts")),
  "a summary read enumerates every object again instead of reporting counts",
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
  tools.includes("CONFLICTING_ACTIONS") && tools.includes("primaryShapes.length === 1"),
  "draw_board accepts two whole-board actions again: the extra field is silently dropped and the reply claims success",
);
check(
  /*
   * A board-wide revision must not reject a write that touches nothing another
   * writer moved. Both MCP and HTTP now share `commitBoardWrite`, which runs
   * `reportConflicts`, raises `ObjectConflictError` on overlap, and answers
   * `REVISION_NOT_CACHED` when the base revision is outside this process.
   */
  tools.includes("commitBoardWrite")
    && writePipeline.includes("reportConflicts")
    && writePipeline.includes("ObjectConflictError")
    && writePipeline.includes("REVISION_NOT_CACHED"),
  "a pinned MCP write is back to rejecting every stale revision instead of merging disjoint edits and naming an overlap",
);
check(
  tools.includes("registerShowBoardTool(server, ctx, state)") && tools.includes("GUIDE: capabilities and recipes are omitted on repeat shows"),
  "show_board is back to resending the full guide on every call instead of sharing the get_board flag",
);
check(
  (await read("src/board/diagram/recipe.ts")).includes("DIAGRAM_EMPTY"),
  "an empty diagram rejects with bare prose again instead of naming both routes forward",
);
check(
  (await read("src/board/project/scan.ts")).includes("SCAN_RANGE_OUT_OF_RANGE")
    && !/Math\.max\(minimum, Math\.min\(maximum/.test(await read("src/board/project/scan.ts")),
  "scan_project clamps its range bounds again instead of rejecting an explicit out-of-range value",
);
check(
  (await read("src/board/library/store.ts")).includes("BOARD_NOT_FOUND")
    && (await read("src/board/library/store.ts")).includes("LAST_BOARD"),
  "a library action names no ids on an unknown board, or refuses the last board without saying why",
);
check(
  http.includes("error instanceof BoardValidationError")
    && http.indexOf("if (error instanceof BoardValidationError)") < http.indexOf("if ((error as NodeJS.ErrnoException).code)"),
  "the HTTP surface classifies a validation error as an errno again, so a bad canvas write answers 500 instead of 400",
);
check(
  (http.match(/error instanceof BoardValidationError/g) ?? []).length >= 2,
  "an HTTP route validates its action without a handler again, so a bad request answers 500 Internal server error",
);
check(
  (await read("src/board/model/predicates.ts")).includes("STYLE_OUT_OF_RANGE")
    && (await read("src/board/model/predicates.ts")).includes("INVALID_TEXT_ALIGN"),
  "a wrong style sub-field rejects with bare prose again instead of naming the field and the range",
);
check(
  !/textAlign: z\.enum|fontWeight: z\.enum/.test(await read("src/board/mcp/schemas.ts")),
  "style enums are back in the schema, so their rejection loses the repair path",
);
check(
  (await read("src/board/model/parse-board.ts")).includes("INVALID_NOTE")
    && (await read("src/board/model/parse-board.ts")).includes("UNKNOWN_NOTE_ITEM"),
  "a note inside replace_board rejects with bare prose again, so the caller cannot tell which note is wrong",
);
check(
  (await read("src/board/diagram/recipe.ts")).includes("RECIPE_STEPS_REQUIRED")
    && (await read("src/board/model/predicates.ts")).includes("INVALID_SCENE"),
  "a recipe with no steps or a malformed scene rejects with bare prose again",
);
check(
  (await read("src/board/model/validate.ts")).includes("INVALID_IMAGE_MIME")
    // Strip block comments first: the explanatory note quotes the old code.
    && !/IMAGE_MIMES\.includes\(input\.mime\)\s*\?/
      .test((await read("src/board/model/validate.ts")).replace(/\/\*[\s\S]*?\*\//g, "")),
  "an unknown image mime is silently dropped again instead of rejected",
);
check(
  (await read("src/board/model/board.ts")).includes("DUPLICATE_UPDATE"),
  "a repeated update id keeps only the last patch again while the reply claims the batch applied",
);
check(
  (await read("src/board/layout/arrange.ts")).includes("LAYOUT_ORIGIN_OUT_OF_RANGE"),
  "layout.origin is unbounded again, so an extreme value reports an item coordinate the caller never typed",
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
check((await read("src/board/view/handoff.ts")).includes("HANDOFF_READINGS") === false && (await read("src/board/view/handoff.ts")).includes("readings") && tools.includes("HANDOFF_READINGS"), "handoff no longer explains what the human change means");
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
/*
 * A debounced write must survive a remote write landing in its window.
 *
 * The canvas used to `return` when `activeSnapshot` had moved, so a drag that
 * raced an agent write vanished with no banner: the person saw a board that
 * looked saved. Re-basing has two halves that fail separately — dropping the
 * gesture, and resurrecting an object the other writer deleted — so both are
 * asserted, together with the event stream a person reads.
 */
check(
  excalidrawApp.includes("createCanvasSync") && excalidrawApp.includes("rebaseScene") && excalidrawApp.includes("getSceneBase"),
  "canvas writes lost the rebasing pipeline: a gesture that races a remote write can be dropped or can resurrect a deleted object",
);
check(
  !/if \(!base \|\| activeSnapshot !== base\) return;/.test(excalidrawApp),
  "the debounced canvas write silently returns when a remote write lands in its window, so the person's change disappears",
);
check(
  excalidrawTemplate.includes('id="doodleSyncState"') &&
  excalidrawTemplate.includes("data-sync-label") &&
  excalidrawApp.includes("createSyncChip") &&
  excalidrawApp.includes("awaiting-agent"),
  "the canvas no longer states its sync phase, so a person has to guess whether a change was saved or reached the agent",
);
check(
  excalidrawTemplate.includes('id="doodleConflictNotice"') &&
  // The recovery surface moved to `client/write-recovery.ts` when the
  // entrypoint was split; assert it where it is authored now.
  writeRecovery.includes("showConflictNotice") &&
  writeRecovery.includes("REVISION_CONFLICT_OBJECTS"),
  "a write conflict is back to a disappearing toast with no object-level summary and no recovery choice",
);
check(
  excalidrawApp.includes('status.send("published")') && canvasTransport.includes("Promise<boolean>"),
  "host context sync reports success it cannot observe: only a real publish may claim the board reached the model context",
);
check(
  !excalidrawApp.includes("applyRemoteSnapshot(pendingRemote.current))"),
  "a remote write that lands mid-gesture repaints over the gesture the person just finished",
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
/*
 * The library has to stay findable as it grows.
 *
 * Twenty boards that share a generated name could only be told apart by reading
 * `rev 586`, and the only way to rename one was to load it into the canvas
 * first. Search, in-place rename, and an inline delete confirmation are what
 * keep the drawer a library rather than a list. `window.confirm` in particular
 * must not come back: it is a page-blocking system alert inside a styled pane.
 */
check(
  excalidrawTemplate.includes('id="doodleLibrarySearch"') &&
    excalidrawTemplate.includes('id="doodleLibrarySort"') &&
    excalidrawTemplate.includes(".doodle-library-entry-confirm") &&
    excalidrawApp.includes("orderLibrary") &&
    excalidrawApp.includes("renderBoardRows"),
  "the library lost search, ordering, or its inline row actions",
);
/*
 * Match the call, not the prose: the comment explaining why `window.confirm`
 * was removed must not trip the guard that keeps it removed.
 */
check(
  !/^\s*(?:if\s*\([^)]*\)\s*)?window\.confirm\(/m.test(excalidrawApp) && !/rev \$\{entry\.revision\}/.test(excalidrawApp),
  "the library still asks with a system dialog or exposes the raw revision counter",
);
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
check(
  buildScript.includes("doodle-prune-unused-excalidraw-chunks")
    && buildScript.includes("@excalidraw\\/mermaid-to-excalidraw"),
  "build no longer strips unused Mermaid/locale chunks from the browser bundle",
);
check(excalidrawApp.includes("buildBoardModelContext") && appContext.includes("finalStateNotOperationLog"), "Excalidraw MCP App context is not a final-state delta");
check(excalidrawApp.includes("sendMessage") && excalidrawTemplate.includes('id="doodleNotifyAgent"'), "embedded Excalidraw canvas lost the host notification button");
const mcpToolsSource = await read("src/board/mcp/tools.ts");
check(mcpToolsSource.includes('import { APP_RESOURCE_URI } from "./context.js"') && !mcpToolsSource.includes('const APP_RESOURCE_URI = "ui://doodle/'), "MCP App resource URI is duplicated instead of imported from its single source");
const shortcutsSource = await read("src/infra/templates/client/shortcuts.ts");
check(shortcutsSource.includes('import { WELCOME_STORAGE_KEY } from "./banner.js"') && !shortcutsSource.includes('const WELCOME_STORAGE_KEY = "doodle-welcome-dismissed"'), "welcome storage key is duplicated instead of imported from the banner module");
const themeSource = await read("src/infra/templates/client/theme.ts");
check(themeSource.includes('export const THEME_CHANGE_EVENT = "doodle-theme-change"') && excalidrawApp.includes("THEME_CHANGE_EVENT") && !excalidrawApp.includes('addEventListener("doodle-theme-change"'), "theme change event name is duplicated instead of imported from the theme module");
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
/*
 * The browser contract suite is the only coverage of the page itself. Guard its
 * existence and its opt-in wiring: it must stay out of the default suite (a
 * machine without Chromium still has to pass `npm run check`) and keep the
 * selector list that catches an upstream rename.
 */
check(
  await exists("test/browser-contract.test.mjs")
    && (await read("package.json")).includes('"test:browser"')
    && (await read("vitest.config.ts")).includes("test/browser-contract.test.mjs"),
  "the browser contract suite is missing, or is no longer excluded from the default test run",
);
check(
  (await read("test/browser-contract.test.mjs")).includes('".App-toolbar"')
    && (await read("test/browser-contract.test.mjs")).includes('".ToolIcon"'),
  "the browser contract no longer asserts the Excalidraw internals the chrome styles",
);
check(await exists("plugins/doodle/skills/doodle/SKILL.md") && await exists("scripts/build-plugin.mjs") && await exists("scripts/plugin-check.mjs"), "plugin packaging files are incomplete");
check(
  /*
   * A ceiling, not a target.
   *
   * upstream ships 80 modules. The offline layer adds nine, each with a named
   * job: the route table split out of the server's lifecycle, the single-instance
   * endpoint record, the local board cache, boot reconciliation, pending-edit
   * storage, offline recovery, the three-way merge, the write-recovery surface,
   * and the service worker. 92 leaves room for three more before a reviewer has
   * to justify the growth — adding a module should be a decision, not a reflex.
   */
  totalSourceFiles.length >= 25 && totalSourceFiles.length <= 92,
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
