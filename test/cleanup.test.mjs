import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBoard } from "../dist/board/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function listFiles(directory) {
  return (await fs.readdir(directory, { recursive: true }))
    .filter((name) => typeof name === "string")
    .map((name) => path.join(directory, name).slice(root.length + 1).split(path.sep).join("/"));
}

describe("post-cleanup repository shape", () => {
  it("keeps the current human board state compatible with strict parsing", async () => {
    const statePath = path.join(root, "output", ".doodle", "board.json");
    const legacyPath = path.join(root, "output", ".ai-draw", "board.json");
    let raw;
    try {
      raw = await fs.readFile(statePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      try {
        raw = await fs.readFile(legacyPath, "utf8");
      } catch (legacyError) {
        if (legacyError.code === "ENOENT") return;
        throw legacyError;
      }
    }
    const board = parseBoard(JSON.parse(raw));
    expect(board.version).toBe(1);
    expect(board.items.length).toBeGreaterThanOrEqual(0);
    expect(board.notes.every((note) => !note.itemId || board.items.some((item) => item.id === note.itemId))).toBe(true);
    expect(board.revision).toBe(JSON.parse(raw).revision);
    const readablePath = await fs.access(statePath).then(() => statePath).catch(() => legacyPath);
    expect((await fs.stat(readablePath)).size).toBeGreaterThan(0);
  });

  it("does not retain legacy source, extension, generated asset, or screenshot modules", async () => {
    const [source, scripts, tests, examples, docs, extensions] = await Promise.all([
      listFiles(path.join(root, "src")),
      listFiles(path.join(root, "scripts")),
      listFiles(path.join(root, "test")),
      listFiles(path.join(root, "examples")),
      listFiles(path.join(root, "docs")),
      fs.access(path.join(root, "extensions")).then(() => true).catch(() => false),
    ]);
    const current = [...source, ...scripts, ...tests, ...examples, ...docs.filter((name) => !name.includes("docs/archive/"))];
    const forbidden = [
      /src\/domain\//, /src\/tools\//, /session-store/, /preview-server/, /renderer/,
      /render-/, /capture-panel/, /generate-doc-assets/, /github-maintenance/,
      /\.vsix$/, /\.png$/, /\.mmd$/, /collaboration-workflow/,
    ];
    for (const pattern of forbidden) {
      expect(current.some((name) => pattern.test(name)), `unexpected legacy path matching ${pattern}`).toBe(false);
    }
    expect(extensions).toBe(false);
    /*
     * Assert the *shape* of the source tree, not a file count.
     *
     * A hard-coded total (previously 25) breaks on every legitimate split and
     * says nothing about whether the structure is healthy. These checks encode
     * the layering the refactor established: one concern per directory, no
     * module that grows back into a monolith, and no duplicated implementation.
     */
    const tsFiles = source.filter((name) => name.endsWith(".ts"));
    for (const directory of [
      "src/board/model/",
      "src/board/diagram/",
      "src/board/layout/",
      "src/board/mcp/",
      "src/board/mcp/tools/",
    ]) {
      expect(tsFiles.some((name) => name.startsWith(directory)), `missing module group ${directory}`).toBe(true);
    }
    // No single board or template module may grow back into a 1000-line dump.
    const checkedModules = source.filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"));
    const oversized = [];
    for (const name of checkedModules) {
      const { size } = await fs.stat(path.join(root, name));
      const lines = (await fs.readFile(path.join(root, name), "utf8")).split("\n").length;
      if (lines > 450) oversized.push(`${name} (${lines} lines, ${size} bytes)`);
    }
    expect(oversized, `modules over the 450-line budget: ${oversized.join(", ")}`).toEqual([]);
    // The old monolith must not return as a second source of truth.
    expect(tsFiles).not.toContain("src/board/tools.ts");
    expect(await fs.stat(path.join(root, "src/board/types.ts")).then((s) => s.size)).toBeLessThan(6_000);
    expect(scripts.filter((name) => name.endsWith(".mjs")).sort()).toEqual([
      "scripts/build-plugin.mjs",
      "scripts/build-submission.mjs",
      "scripts/build.mjs",
      "scripts/doctor.mjs",
      "scripts/open-board.mjs",
      "scripts/plugin-check.mjs",
      "scripts/preview-board.mjs",
      "scripts/repo-check.mjs",
      "scripts/setup-codex.mjs",
    ]);
    /*
     * Assert test *coverage shape*, not a file count.
     *
     * Every layer the refactor introduced needs its own test file, and the
     * cross-cutting contract needs a golden snapshot so a refactor cannot drift
     * silently. A hard-coded total only ever needed updating.
     */
    const testFiles = tests.filter((name) => name.endsWith(".test.mjs"));
    for (const suite of [
      "test/board.test.mjs",
      "test/diagram-modes.test.mjs",
      "test/excalidraw-adapter.test.mjs",
      "test/http.test.mjs",
      "test/library.test.mjs",
      "test/mcp.test.mjs",
      "test/empty-board-guard.test.mjs",
      "test/golden-model.test.mjs",
    ]) {
      expect(testFiles, `missing test suite ${suite}`).toContain(suite);
    }
    expect(testFiles.length).toBeGreaterThanOrEqual(18);
    const compiled = await listFiles(path.join(root, "dist"));
    expect(compiled.some((name) => /^dist\/(domain|tools)\//.test(name))).toBe(false);
    expect(compiled.some((name) => name === "dist/infra/templates/index.html")).toBe(false);
    expect(compiled.some((name) => /^dist\/infra\/(agent-context|ide-opener|preview-server|project-scanner|renderer|session-store|simple-board-store|store|visual-sync-service)\./.test(name))).toBe(false);
    /*
     * The compiled canvas client must survive the build.
     *
     * `scripts/build.mjs` prunes `dist/infra/templates` by top-level entry name,
     * and an exact-name check deleted the whole compiled `client/` directory
     * after `tsc` wrote it. The browser bundle hid that — esbuild reads `src` —
     * until a test imported a compiled client module and found an empty path.
     * Skipped when `npm test` runs without a build.
     */
    const compiledCanvas = compiled.filter((name) => name.startsWith("dist/infra/templates/"));
    if (compiledCanvas.length > 0) {
      for (const module of ["client/canvas-sync.js", "client/sync-state.js", "client/transport.js"]) {
        expect(compiledCanvas, `build pruned the compiled canvas client: dist/infra/templates/${module}`)
          .toContain(`dist/infra/templates/${module}`);
      }
    }
  });

  it("keeps current docs free of deleted tool catalogues and stale active paths", async () => {
    const files = [
      "README.md", "README.en.md", "AGENTS.md", "CHANGELOG.md", "CONTRIBUTING.md",
      "SECURITY.md", "ROADMAP.md", "docs/PRODUCT_DIRECTION.md", "docs/ARCHITECTURE.md",
      "docs/DECISIONS.md", "docs/GOALS.md", "docs/README.md", "docs/TROUBLESHOOTING.md",
    ];
    for (const relative of files) {
      const text = await fs.readFile(path.join(root, relative), "utf8");
      expect(text, relative).not.toMatch(/29 个 MCP 工具|26 个 MCP 工具|29 tools|26 tools/);
      expect(text, relative).not.toContain("/workbench");
      expect(text, relative).not.toContain("/api/collab");
      expect(text, relative).not.toContain("open_preview");
      expect(text, relative).not.toContain("apply_visual_proposal");
      expect(text, relative).not.toContain("SessionStore.applyProposal");
    }
  });

  it("uses one product name and one npm package name", async () => {
    const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    expect(packageJson.name).toBe("doodle-mcp");
    expect(packageJson.version).toBe("0.9.0");
    expect(packageJson.bin["doodle-mcp"]).toBe("dist/index.js");
    expect(packageJson.repository.url).toContain("/Doodle.git");
    const strictFiles = [
      "AGENTS.md", "CONTRIBUTING.md",
      "SECURITY.md", "ROADMAP.md", "docs/PRODUCT_DIRECTION.md",
      "docs/DECISIONS.md", "docs/GOALS.md", "src/board/mcp/instructions.ts", "src/server.ts",
    ];
    for (const relative of strictFiles) {
      const text = await fs.readFile(path.join(root, relative), "utf8");
      expect(text, relative).not.toMatch(/AI Draw MCP|ai-draw-mcp|AI_DRAW_WORKSPACE_ROOT/);
    }
    const compatibilityFiles = ["README.md", "README.en.md", "docs/ARCHITECTURE.md", "docs/TROUBLESHOOTING.md", "CHANGELOG.md"];
    for (const relative of compatibilityFiles) {
      const text = await fs.readFile(path.join(root, relative), "utf8");
      expect(text, relative).not.toContain("AI Draw MCP");
      expect(text, relative).not.toContain("ai-draw-mcp");
    }
  });

  it("keeps current user-facing surfaces on the Doodle name and current endpoints", async () => {
    const template = await fs.readFile(path.join(root, "src", "infra", "templates", "excalidraw.html"), "utf8");
    expect(template).toContain("Doodle · Excalidraw Canvas");
    expect(template).toContain('id="excalidrawRoot"');
    const architecture = await fs.readFile(path.join(root, "docs", "ARCHITECTURE.md"), "utf8");
    expect(architecture).toContain("GET /api/board/project");
    expect(architecture).not.toContain("GET /project");
    expect(architecture).toContain("mutex.ts");
    expect(architecture).toContain("errors.ts");
    const stdioExample = JSON.parse(await fs.readFile(path.join(root, "examples", "mcp-config", "stdio.json"), "utf8"));
    expect(stdioExample.command).toBe("npx");
    expect(stdioExample.args).toEqual(["-y", "doodle-mcp"]);
  });

  /*
   * The documented source tree must be the real one.
   *
   * The architecture doc carries a hand-maintained tree and a hand-maintained
   * ring table. Both are the map an agent reads before adding a file, so a path
   * that moved without the doc moving is worse than no doc: it teaches the
   * wrong home. Rather than assert the whole tree — which would fail on every
   * new file — assert that every `src/board` path the doc names actually exists.
   */
  it("keeps every src/board path named in the architecture doc real", async () => {
    const architecture = await fs.readFile(path.join(root, "docs", "ARCHITECTURE.md"), "utf8");
    const named = new Set();
    for (const match of architecture.matchAll(/(?:^|[\s`(])((?:src\/)?board\/[\w./-]+\.(?:ts|tsx))/g)) {
      named.add(match[1].replace(/^board\//, "src/board/"));
    }
    const missing = [];
    for (const namedPath of named) {
      if (!namedPath.startsWith("src/board/")) continue;
      const exists = await fs.access(path.join(root, namedPath)).then(() => true, () => false);
      if (!exists) missing.push(namedPath);
    }
    expect(named.size, "the architecture doc names no src/board source path").toBeGreaterThan(0);
    expect(missing, `the architecture doc names src/board paths that do not exist: ${missing.join(", ")}`).toEqual([]);
  });

  it("links only existing current documentation targets", async () => {
    const files = [
      "README.md", "README.en.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md",
      "ROADMAP.md", "RELEASING.md", "VERSIONING.md", "CHANGELOG.md",
      "docs/README.md", "docs/PRODUCT_DIRECTION.md", "docs/ARCHITECTURE.md",
      "docs/DECISIONS.md", "docs/TROUBLESHOOTING.md", "docs/GOALS.md",
      "docs/EXCALIDRAW_COMPARISON.md",
      "docs/GOVERNANCE.md", "docs/COMPETITIVE_RESEARCH.md",
      "docs/DEPENDENCY_MAINTENANCE.md", "docs/LAUNCH_KIT.md",
    ];
    const missing = [];
    for (const relative of files) {
      const text = await fs.readFile(path.join(root, relative), "utf8");
      for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
        const target = match[1].trim();
        if (/^(https?:|mailto:)/.test(target)) continue;
        const resolved = path.resolve(path.dirname(path.join(root, relative)), target);
        await fs.access(resolved).catch(() => missing.push(`${relative} → ${target}`));
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps one Codex plugin layout and its generated artifacts ignored", async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(root, "plugins", "doodle", ".codex-plugin", "plugin.json"), "utf8"));
    const mcp = JSON.parse(await fs.readFile(path.join(root, "plugins", "doodle", ".mcp.json"), "utf8"));
    const marketplace = JSON.parse(await fs.readFile(path.join(root, ".agents", "plugins", "marketplace.json"), "utf8"));
    const gitignore = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    expect(manifest.version).toBe("0.9.0");
    expect(manifest.requires_local_executor).toBe(true);
    expect(manifest.mcpServers).toBe("./.mcp.json");
    expect(mcp.mcpServers.doodle.type).toBe("stdio");
    expect(mcp.mcpServers.doodle.args[0]).toBe("${PLUGIN_ROOT}/server/index.mjs");
    expect(marketplace.plugins[0].source.path).toBe("./.doodle-plugin/doodle");
    expect(await fs.access(path.join(root, "plugins", "doodle", "plugin.json")).then(() => true).catch(() => false)).toBe(false);
    expect(await fs.access(path.join(root, "plugins", "doodle", "mcp.json")).then(() => true).catch(() => false)).toBe(false);
    expect(gitignore).toContain(".doodle-plugin/");
    expect(gitignore).toContain(".doodle-data/");
  });
});

/**
 * Budgets, not measurements.
 *
 * The Excalidraw engine and fonts dominate every artifact. Now that unused
 * Mermaid/locale chunks are stubbed and the plugin ships a single copy of the
 * template assets under `server/infra/templates/`, these tighter ceilings fail
 * immediately if a duplicate copy or the Mermaid/locale tree creeps back in.
 */
const ARTIFACT_BUDGETS_MB = { dist: 18, plugin: 22, submissionZip: 16 };

async function directorySize(dir) {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(target);
    else total += (await fs.stat(target)).size;
  }
  return total;
}

describe("shipped artifact size", () => {
  it("keeps dist, the plugin package and the submission ZIP inside their budgets", async () => {
    const measured = {};
    for (const [label, relative] of [
      ["dist", "dist"],
      ["plugin", path.join(".doodle-plugin", "doodle")],
    ]) {
      const present = await fs.access(path.join(root, relative)).then(() => true, () => false);
      if (present) measured[label] = await directorySize(path.join(root, relative));
    }
    const submissionDir = path.join(root, "doodle-plugin-submission");
    const zips = await fs.readdir(submissionDir).catch(() => []);
    const zip = zips.find((name) => name.endsWith(".zip"));
    if (zip) measured.submissionZip = (await fs.stat(path.join(submissionDir, zip))).size;

    // `npm test` on its own runs without a build; only judge what exists.
    const oversized = Object.entries(measured)
      .map(([label, bytes]) => [label, bytes / (1024 * 1024)])
      .filter(([label, mb]) => mb > ARTIFACT_BUDGETS_MB[label])
      .map(([label, mb]) => `${label} ${mb.toFixed(1)}MB > ${ARTIFACT_BUDGETS_MB[label]}MB`);

    expect(oversized, `artifacts over budget: ${oversized.join(", ")}`).toEqual([]);
  });
});
