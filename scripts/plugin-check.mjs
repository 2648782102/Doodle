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
const sizeOf = async (relative) => (await fs.stat(path.join(root, relative))).size;

const packageJson = JSON.parse(await read("package.json"));
const manifest = JSON.parse(await read("plugins/doodle/.codex-plugin/plugin.json"));
const mcp = JSON.parse(await read("plugins/doodle/.mcp.json"));
const marketplace = JSON.parse(await read(".agents/plugins/marketplace.json"));
const skill = await read("plugins/doodle/skills/doodle/SKILL.md");
const buildScript = await read("scripts/build-plugin.mjs");
const pluginCheckScript = await read("scripts/plugin-check.mjs");
const httpSource = await read("src/board/http.ts");
const toolsSource = await read("src/board/tools.ts");
const configSource = await read("src/infra/config.ts");
const versionSource = await read("src/infra/version.ts");
const indexSource = await read("src/index.ts");
const instructions = await read("src/board/instructions.ts");
const ci = await read(".github/workflows/ci.yml");
const gitignore = await read(".gitignore");
const goal = await read("docs/GOAL_PLUGIN.md");
const privacy = await read("PRIVACY.md");
const support = await read("SUPPORT.md");
const terms = await read("TERMS.md");
const submission = await read("docs/SUBMISSION.md");
const submissionScript = await read("scripts/build-submission.mjs");

check(packageJson.version === "0.6.0" && manifest.version === packageJson.version, "plugin version does not match package.json 0.6.0");
check(packageJson.scripts.build.includes("build-plugin.mjs"), "npm build does not produce the plugin package");
check(packageJson.scripts.check.includes("repo:plugin-check"), "npm check does not run the plugin guard");
check(manifest.name === "doodle", "plugin identity is not doodle");
check(manifest.mcpServers === "./.mcp.json" && manifest.skills === "./skills/", "compatibility manifest does not reference MCP and skills");
check(manifest.requires_local_executor === true, "compatibility manifest is not desktop-only");
check(manifest.interface.displayName === "Doodle Shared Board", "display name is too generic for directory review");
check(manifest.author.url === "https://github.com/2648782102/Doodle", "publisher identity is not tied to the repository");
for (const [field, expected] of [
  ["supportURL", "SUPPORT.md"],
  ["privacyPolicyURL", "PRIVACY.md"],
  ["termsOfServiceURL", "TERMS.md"],
]) {
  check(manifest.interface[field] === `https://github.com/2648782102/Doodle/blob/master/${expected}`, `${field} does not point at the published ${expected}`);
}
check(manifest.interface.shortDescription.length <= 30, "short description exceeds directory limit");
check(manifest.interface.longDescription.length <= 4000, "long description exceeds directory limit");
check(manifest.interface.defaultPrompt.length <= 3 && manifest.interface.defaultPrompt.every((prompt) => prompt.length <= 128), "starter prompts exceed directory limits");
check(!await exists("plugins/doodle/plugin.json") && !await exists("plugins/doodle/mcp.json"), "portable manifests conflict with the single compatibility layout");
check(mcp.mcpServers.doodle?.type === "stdio", "MCP transport type is not stdio");
check(mcp.mcpServers.doodle?.command === "node", "MCP stdio command is missing");
check(mcp.mcpServers.doodle?.args?.[0] === "${PLUGIN_ROOT}/server/index.mjs", "MCP entrypoint does not use PLUGIN_ROOT");
check(!mcp.mcpServers.doodle?.cwd?.includes("${PLUGIN_ROOT}"), "MCP cwd uses PLUGIN_ROOT where the host resolves it as a relative path");
check(!JSON.stringify(mcp).includes("${PLUGIN_DATA}"), "MCP env uses an unsupported PLUGIN_DATA placeholder");
check(mcp.mcpServers.doodle?.env_vars?.includes("PLUGIN_DATA") === true, "MCP env does not allow PLUGIN_DATA");
check(marketplace.plugins?.[0]?.name === "doodle", "marketplace does not expose doodle");
check(marketplace.plugins?.[0]?.source?.path === "./.doodle-plugin/doodle", "marketplace does not point at the generated plugin package");
check(skill.includes("get_board") && skill.includes("show_board") && skill.includes("draw_board") && skill.includes("scan_project"), "Doodle skill lacks the four-tool workflow");
check(!skill.includes("reply_on_board"), "Doodle skill references the removed reply tool");
check(skill.includes("PANEL_URL") && !skill.includes("Open a browser"), "Doodle skill mishandles the human panel URL");
check(buildScript.includes("bundle: true") && buildScript.includes("board.html") && buildScript.includes("board-app.js"), "plugin build is not self-contained");
check(buildScript.includes("__DOODLE_PLUGIN_VERSION__"), "plugin build does not inject the package version");
check(pluginCheckScript.includes("requires_local_executor"), "plugin guard does not verify desktop-only status");
check(httpSource.includes("templateCandidates(this.config)") && httpSource.includes('"server", "infra", "templates", "board.html"'), "bundled server cannot resolve plugin board templates");
check(toolsSource.includes("appBundleCandidates(ctx.config)") && toolsSource.includes('"server", "infra", "templates", "board-app.js"'), "bundled server cannot resolve the MCP App bundle");
check(toolsSource.includes("PANEL_URL") && instructions.includes("PANEL_URL"), "active local panel URL is not exposed to the agent");
check(!instructions.includes("reply_on_board"), "MCP instructions reference the removed reply tool");
check(configSource.includes("previewPort: rawPort ? parsePort(rawPort) : null") && configSource.includes("PLUGIN_DATA"), "runtime config is not plugin-safe");
check(versionSource.includes("__DOODLE_PLUGIN_VERSION__"), "bundled server cannot report the injected version");
check(indexSource.indexOf("await mcp.connect(transport);") < indexSource.indexOf("await preview.start();"), "MCP stdio is not connected before optional preview startup");
check(indexSource.includes("Preview unavailable"), "preview failure does not keep the MCP server alive");
check(ci.includes("npm run repo:plugin-check"), "CI does not run the plugin guard");
check(ci.includes("npm run build:submission"), "CI does not build the submission ZIP");
check(gitignore.includes(".doodle-plugin/") && gitignore.includes(".doodle-data/") && gitignore.includes("doodle-plugin-submission/"), "generated plugin output, plugin data, or submission ZIP is not ignored");
check(goal.includes("## Objective") && goal.includes("show_board") && goal.includes("plugin"), "plugin goal document is incomplete");
check(await exists("src/infra/project-workspace.ts"), "plugin-safe workspace resolution is missing");
for (const [name, content, phrase] of [
  ["PRIVACY.md", privacy, "Data categories"],
  ["SUPPORT.md", support, "GitHub Issue"],
  ["TERMS.md", terms, "MIT License"],
  ["SUBMISSION.md", submission, "Required outside this repository"],
]) {
  check(content.includes(phrase), `${name} is missing the expected publication guidance`);
}
check(privacy.includes("Retention") && privacy.includes("User controls"), "privacy policy is missing retention or user controls");
check(submissionScript.includes("doodle-${packageJson.version}.zip"), "submission ZIP does not use the package version");
check(toolsSource.includes("READ_ONLY_LOCAL_ANNOTATIONS") && toolsSource.includes("BOARD_WRITE_ANNOTATIONS"), "tool annotations are missing");
check((toolsSource.match(/server\.registerTool\(/g) ?? []).length === 4, "tools are not all registered through the annotated config API");

const generatedFiles = [
  ".doodle-plugin/doodle/.codex-plugin/plugin.json",
  ".doodle-plugin/doodle/.mcp.json",
  ".doodle-plugin/doodle/skills/doodle/SKILL.md",
  ".doodle-plugin/doodle/assets/doodle.svg",
  ".doodle-plugin/doodle/assets/doodle-dark.svg",
  ".doodle-plugin/doodle/server/index.mjs",
  ".doodle-plugin/doodle/server/infra/templates/board.html",
  ".doodle-plugin/doodle/server/infra/templates/board-app.js",
  ".doodle-plugin/doodle/infra/templates/board.html",
  ".doodle-plugin/doodle/infra/templates/board-app.js",
];
for (const relative of generatedFiles) {
  check(await exists(relative), `generated plugin file is missing: ${relative}`);
}
check(await exists(".doodle-plugin/doodle/server/index.mjs") && await sizeOf(".doodle-plugin/doodle/server/index.mjs") > 100_000, "generated plugin server is unexpectedly small");
check(await exists(".doodle-plugin/doodle/infra/templates/board-app.js") && await sizeOf(".doodle-plugin/doodle/infra/templates/board-app.js") > 1_000, "generated MCP App bundle is unexpectedly small");

if (failures.length) {
  console.error("❌ Plugin checks failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("✅ Plugin checks passed: manifests, skill, marketplace, and self-contained server are aligned");
