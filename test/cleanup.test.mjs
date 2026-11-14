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
    expect(source.filter((name) => name.endsWith(".ts"))).toHaveLength(19);
    expect(scripts.filter((name) => name.endsWith(".mjs")).sort()).toEqual([
      "scripts/build-plugin.mjs",
      "scripts/build-submission.mjs",
      "scripts/build.mjs",
      "scripts/doctor.mjs",
      "scripts/plugin-check.mjs",
      "scripts/preview-board.mjs",
      "scripts/repo-check.mjs",
      "scripts/setup-codex.mjs",
    ]);
    expect(tests.filter((name) => name.endsWith(".test.mjs"))).toHaveLength(7);
    const compiled = await listFiles(path.join(root, "dist"));
    expect(compiled.some((name) => /^dist\/(domain|tools)\//.test(name))).toBe(false);
    expect(compiled.some((name) => name === "dist/infra/templates/index.html")).toBe(false);
    expect(compiled.some((name) => /^dist\/infra\/(agent-context|ide-opener|preview-server|project-scanner|renderer|session-store|simple-board-store|store|visual-sync-service)\./.test(name))).toBe(false);
  });

  it("keeps current docs free of deleted tool catalogues and stale active paths", async () => {
    const files = [
      "README.md", "README.en.md", "AGENTS.md", "CHANGELOG.md", "CONTRIBUTING.md",
      "SECURITY.md", "ROADMAP.md", "docs/PRODUCT_DIRECTION.md", "docs/ARCHITECTURE.md",
      "docs/DECISIONS.md", "docs/GOAL_PLUGIN.md", "docs/README.md", "docs/TROUBLESHOOTING.md",
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
    expect(packageJson.version).toBe("0.7.0");
    expect(packageJson.bin["doodle-mcp"]).toBe("dist/index.js");
    expect(packageJson.repository.url).toContain("/Doodle.git");
    const strictFiles = [
      "AGENTS.md", "CONTRIBUTING.md",
      "SECURITY.md", "ROADMAP.md", "docs/PRODUCT_DIRECTION.md",
      "docs/DECISIONS.md", "docs/GOAL_PLUGIN.md", "src/board/instructions.ts", "src/server.ts",
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

  it("links only existing current documentation targets", async () => {
    const files = [
      "README.md", "README.en.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md",
      "ROADMAP.md", "RELEASING.md", "VERSIONING.md", "CHANGELOG.md",
      "docs/README.md", "docs/PRODUCT_DIRECTION.md", "docs/ARCHITECTURE.md",
      "docs/DECISIONS.md", "docs/TROUBLESHOOTING.md", "docs/GOAL_MODE.md",
      "docs/GOAL_PLUGIN.md", "docs/GOAL_EXPERIENCE.md", "docs/GOAL_EXCALIDRAW.md", "docs/EXCALIDRAW_COMPARISON.md",
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
    expect(manifest.version).toBe("0.7.0");
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
