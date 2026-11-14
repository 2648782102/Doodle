import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadConfig, loadRuntimeConfig } from "../dist/infra/config.js";
import { projectWorkspace } from "../dist/infra/project-workspace.js";

const EXPECTED_TOOLS = ["get_board", "show_board", "draw_board", "scan_project"];
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-mcp-test-"));

afterAll(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function withClient(port, callback) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: {
      ...process.env,
      PREVIEW_PORT: String(port),
      LOG_LEVEL: "error",
      OUTPUT_DIR: tempDir,
      DOODLE_WORKSPACE_ROOT: process.cwd(),
    },
  });
  const client = new Client({ name: "doodle-board-tests", version: "1.0.0" });
  try {
    await client.connect(transport);
    await callback(client);
  } finally {
    await client.close();
  }
}

function textOf(result) {
  return result.content.map((item) => item.text ?? "").join("\n");
}

async function withClientIn(outputDir, port, callback) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: {
      ...process.env,
      PREVIEW_PORT: String(port),
      LOG_LEVEL: "error",
      OUTPUT_DIR: outputDir,
      DOODLE_WORKSPACE_ROOT: process.cwd(),
    },
  });
  const client = new Client({ name: "doodle-board-tests", version: "1.0.0" });
  try {
    await client.connect(transport);
    await callback(client);
  } finally {
    await client.close();
  }
}

function jsonAfter(text, marker) {
  const start = text.indexOf(marker) + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, index + 1));
    }
  }
  throw new Error(`No complete JSON object after ${marker}`);
}

describe("MCP board server", () => {
  it("prefers plugin-safe workspace and output paths without placeholders", async () => {
    const tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-workspace-config-"));
    const tempPluginData = path.join(tempWorkspace, "plugin-data");
    const previous = { ...process.env };
    try {
      delete process.env.OUTPUT_DIR;
      delete process.env.DOODLE_WORKSPACE_ROOT;
      delete process.env.AI_DRAW_WORKSPACE_ROOT;
      process.env.CODEX_PROJECT_ROOT = tempWorkspace;
      process.env.PLUGIN_DATA = tempPluginData;
      const config = loadConfig();
      expect(projectWorkspace()).toBe(tempWorkspace);
      expect(config.outputDir).toBe(path.join(tempPluginData, "doodle"));
      expect(config.workspaceRoot).toBe(tempWorkspace);
      expect(config.previewPort).toBeNull();
      const runtime = await loadRuntimeConfig();
      expect(runtime.previewPort).toBeNull();
    } finally {
      for (const key of ["OUTPUT_DIR", "DOODLE_WORKSPACE_ROOT", "AI_DRAW_WORKSPACE_ROOT", "CODEX_PROJECT_ROOT", "PLUGIN_DATA", "CLAUDE_PLUGIN_DATA"]) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    }
  });

  it("registers four agent-first tools and an embedded board app", async () => {
    await withClient(3421, async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
      expect(tools.find((tool) => tool.name === "get_board")._meta).toBeUndefined();
      expect(tools.find((tool) => tool.name === "show_board")._meta.ui.resourceUri).toBe("ui://doodle/board/excalidraw/v1.html");
      expect(tools.find((tool) => tool.name === "draw_board")._meta.ui.resourceUri).toBe("ui://doodle/board/excalidraw/v1.html");
      const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
      expect(tools.find((tool) => tool.name === "get_board").annotations).toEqual(readOnly);
      expect(tools.find((tool) => tool.name === "show_board").annotations).toEqual(readOnly);
      expect(tools.find((tool) => tool.name === "draw_board").annotations).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
      expect(tools.find((tool) => tool.name === "scan_project").annotations).toEqual(readOnly);
      expect(client.getInstructions()).toContain("Use get_board");
      expect(client.getInstructions()).toContain("show_board");
      expect(client.getInstructions()).toContain("scan_project is optional");
      expect(client.getInstructions()).toContain("First use");
    });
  }, 30_000);

  it("serves the embedded board app and advertises it after drawing", async () => {
    await withClient(3442, async (client) => {
      const appResource = await client.readResource({ uri: "ui://doodle/board/excalidraw/v1.html" });
      expect(appResource.contents[0].mimeType).toBe("text/html;profile=mcp-app");
      expect(appResource.contents[0].text).toContain("Doodle · Excalidraw Canvas");
      expect(appResource.contents[0].text).not.toContain('id="noteInput"');
      expect(appResource.contents[0].text).toContain("/excalidraw/excalidraw-app.js");
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "embedded app" }] },
      });
      const shown = await client.callTool({ name: "show_board", arguments: {} });
      expect(shown.structuredContent).toMatchObject({ version: 1 });
      expect(shown.structuredContent.capabilities.layouts).toContain("timeline");
      expect(shown.structuredContent.itemCount).toBeGreaterThan(0);
    });
  }, 30_000);

  it("returns the shared board and drawing guide through get_board", async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: {
        ...process.env,
        PREVIEW_PORT: "3441",
        LOG_LEVEL: "error",
        OUTPUT_DIR: path.join(tempDir, "first-use"),
        DOODLE_WORKSPACE_ROOT: process.cwd(),
      },
    });
    const client = new Client({ name: "doodle-first-use-tests", version: "1.0.0" });
    try {
      await client.connect(transport);
      const text = textOf(await client.callTool({ name: "get_board", arguments: {} }));
      expect(text).toContain("BOARD_JSON:");
      expect(text).toContain("FIRST_USE:");
      expect(text).toContain("NEXT_STEPS:");
      expect(text).toContain("Drawing guide:");
      expect(text).toMatch(/PANEL_URL: http:\/\/127\.0\.0\.1:\d+\//);
      expect(text).toContain("CAPABILITIES:");
      expect(text).toContain("VISUAL_DIGEST:");
      expect(text).toContain("Visual recipes:");
      expect(text).toContain("(x,y) to (x+w,y+h)");
      const board = jsonAfter(text, "BOARD_JSON:");
      expect(board).toMatchObject({ version: 1, readOnly: true });
      expect(board.capabilities.objectTypes).toContain("stroke");
      expect(board.visualDigest).toMatchObject({ version: 1, itemCount: 0 });
      expect(Array.isArray(board.items)).toBe(true);
      expect(board.safety).toMatchObject({ projectWritesRequireHumanApproval: true });
    } finally {
      await client.close();
    }
  }, 30_000);

  it("uses concise guidance after a board has visual context", async () => {
    await withClient(3443, async (client) => {
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "context" }] },
      });
      const text = textOf(await client.callTool({ name: "get_board", arguments: {} }));
      expect(text).toContain("NEXT:");
      expect(text).not.toContain("FIRST_USE:");
      expect(text).not.toContain("BOARD_JSON is the read-only shared state");
      expect(text).toContain("BOARD_JSON:");
      expect(text).toContain('"text": "context"');
    });
  }, 30_000);

  it("sends the guide once per process and rereads compactly", async () => {
    await withClient(3444, async (client) => {
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "plan" }] },
      });

      const first = textOf(await client.callTool({ name: "get_board", arguments: {} }));
      expect(first).toContain("CAPABILITIES:");
      expect(first).toContain("Visual recipes:");

      const second = textOf(await client.callTool({ name: "get_board", arguments: {} }));
      expect(second).not.toContain("CAPABILITIES:");
      expect(second).not.toContain("Visual recipes:");
      expect(second).toContain("GUIDE:");
      expect(second.length).toBeLessThan(first.length);

      const guided = textOf(await client.callTool({ name: "get_board", arguments: { include_guide: true } }));
      expect(guided).toContain("CAPABILITIES:");
    });
  }, 30_000);

  it("returns only changed objects for a reread since a revision", async () => {
    await withClient(3445, async (client) => {
      await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          items: [
            { type: "note", x: 0, y: 0, w: 160, h: 90, text: "a" },
            { type: "note", x: 200, y: 0, w: 160, h: 90, text: "b" },
          ],
        },
      });
      const full = await client.callTool({ name: "get_board", arguments: {} });
      const base = full.structuredContent.revision;
      const fullText = textOf(full);

      const unchanged = await client.callTool({ name: "get_board", arguments: { since_revision: base } });
      const unchangedText = textOf(unchanged);
      expect(unchanged.structuredContent.mode).toBe("delta");
      expect(unchanged.structuredContent.unchanged).toBe(true);
      expect(unchangedText).toContain("无变化");
      expect(unchangedText).not.toContain("BOARD_JSON:");
      expect(unchangedText.length).toBeLessThan(fullText.length / 4);

      const note = full.structuredContent.items.find((entry) => entry.text === "a");
      await client.callTool({
        name: "draw_board",
        arguments: { author: "human", updates: [{ id: note.id, patch: { text: "a 改过了" } }] },
      });
      const changed = await client.callTool({ name: "get_board", arguments: { since_revision: base } });
      expect(changed.structuredContent.unchanged).toBe(false);
      expect(changed.structuredContent.updated).toHaveLength(1);
      expect(changed.structuredContent.updated[0].text).toBe("a 改过了");
      expect(changed.structuredContent.added).toEqual([]);
      expect(changed.structuredContent.removed).toEqual([]);
    });
  }, 30_000);

  it("never sends canvas fidelity to the agent but keeps the canvas board intact", async () => {
    const outputDir = path.join(tempDir, "fidelity");
    await withClientIn(outputDir, 3446, async (client) => {
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "kept" }] },
      });

      // Simulate what the human canvas writes back: full Excalidraw fidelity per item.
      const statePath = path.join(outputDir, ".doodle", "board.json");
      const persisted = JSON.parse(await fs.readFile(statePath, "utf8"));
      persisted.items = persisted.items.map((entry) => ({
        ...entry,
        scene: { element: { id: entry.id, version: 9, versionNonce: 4242, seed: 7 }, boundText: { id: `${entry.id}_t`, text: entry.text } },
      }));
      persisted.revision += 1;
      await fs.writeFile(statePath, JSON.stringify(persisted, null, 2));

      const fresh = await client.callTool({ name: "get_board", arguments: {} });
      const text = textOf(fresh);
      expect(text).not.toContain("versionNonce");
      expect(text).not.toContain('"scene"');
      expect(text).not.toContain("boundText");
      expect(fresh.structuredContent.canvasFidelityItems).toBe(persisted.items.length);
      expect(fresh.structuredContent.items.every((entry) => entry.canvasFidelity === true)).toBe(true);
      expect(fresh.structuredContent.safety.canvasFidelityExcluded).toBe(true);

      const stillPersisted = JSON.parse(await fs.readFile(statePath, "utf8"));
      expect(stillPersisted.items.every((entry) => entry.scene?.element?.versionNonce === 4242)).toBe(true);
    });
  }, 30_000);

  it("tells the agent what the person changed since its last read", async () => {
    await withClient(3447, async (client) => {
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "开始" }] },
      });
      const first = await client.callTool({ name: "get_board", arguments: {} });
      const base = first.structuredContent.revision;
      const note = first.structuredContent.items[0];

      // The person edits that object on the canvas.
      await client.callTool({
        name: "draw_board",
        arguments: { author: "human", updates: [{ id: note.id, patch: { text: "从需求开始" } }] },
      });

      const reread = await client.callTool({ name: "get_board", arguments: { since_revision: base } });
      const text = textOf(reread);
      expect(reread.structuredContent.handoff.needsAttention).toBe(true);
      expect(reread.structuredContent.handoff.humanEdits).toHaveLength(1);
      expect(reread.structuredContent.handoff.humanEdits[0]).toMatchObject({ id: note.id, change: "edited" });
      expect(reread.structuredContent.handoff.humanEdits[0].now.text).toBe("从需求开始");
      expect(text).toContain("HANDOFF:");
      expect(text).toContain("HANDOFF_JSON:");

      // An AI-only follow-up must not claim the person did anything.
      const afterAi = await client.callTool({ name: "get_board", arguments: { since_revision: reread.structuredContent.revision } });
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 240, y: 0, w: 160, h: 90, text: "AI 补充" }] },
      });
      const aiOnly = await client.callTool({ name: "get_board", arguments: { since_revision: afterAi.structuredContent.revision } });
      expect(aiOnly.structuredContent.handoff.needsAttention).toBe(false);
      expect(textOf(aiOnly)).toContain("没有改动");
    });
  }, 30_000);

  it("treats PREVIEW_PORT=0 as automatic port selection", async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: {
        ...process.env,
        PREVIEW_PORT: "0",
        LOG_LEVEL: "error",
        OUTPUT_DIR: path.join(tempDir, "auto-zero"),
        DOODLE_WORKSPACE_ROOT: process.cwd(),
      },
    });
    const client = new Client({ name: "doodle-auto-port-tests", version: "1.0.0" });
    try {
      await client.connect(transport);
      const text = textOf(await client.callTool({ name: "get_board", arguments: {} }));
      const panel = text.match(/PANEL_URL: (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
      expect(panel).toBeTruthy();
      expect(Number.parseInt(new URL(panel).port, 10)).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("starts with a free loopback port when PREVIEW_PORT is unset", async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: {
        ...process.env,
        PREVIEW_PORT: "",
        LOG_LEVEL: "error",
        OUTPUT_DIR: path.join(tempDir, "dynamic"),
        DOODLE_WORKSPACE_ROOT: process.cwd(),
      },
    });
    const client = new Client({ name: "doodle-dynamic-port-tests", version: "1.0.0" });
    try {
      await client.connect(transport);
      const text = textOf(await client.callTool({ name: "get_board", arguments: {} }));
      const panel = text.match(/PANEL_URL: (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
      expect(panel).toBeTruthy();
      expect(Number.parseInt(new URL(panel).port, 10)).toBeGreaterThan(0);
      expect(await fetch(panel).then((response) => response.status)).toBe(200);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("draws a directed board arrow and returns an authoritative canvas snapshot", async () => {
    await withClient(3422, async (client) => {
      const before = jsonAfter(textOf(await client.callTool({ name: "get_board", arguments: {} })), "BOARD_JSON:");
      const drawnResult = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          items: [
            { type: "note", x: 0, y: 0, w: 180, h: 100, text: "MCP test", color: "#f6d365" },
            { type: "line", x: 180, y: 50, w: 120, h: 0, text: "→", color: "#64748b" },
          ],
        },
      });
      const drawn = textOf(drawnResult);
      expect(drawn).toContain("新增 2");
      expect(drawn).toContain("NEXT: 保持画布可见");
      const updated = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          updates: [{
            id: drawnResult.structuredContent.items.find((item) => item.text === "MCP test")?.id,
            patch: { type: "note", x: 0, y: 0, w: 180, h: 100, text: "AI revised" },
          }],
        },
      });
      expect(updated.structuredContent.items.find((item) => item.text === "AI revised")).toMatchObject({ author: "ai" });
      const snapshot = (await client.callTool({
        name: "draw_board",
        arguments: { items: [{ type: "text", x: 320, y: 0, text: "共享画布" }] },
      })).structuredContent;
      expect(snapshot.items.some((item) => item.text === "共享画布")).toBe(true);
      const stale = await client.callTool({
        name: "draw_board",
        arguments: { expected_revision: before.revision, items: [{ type: "text", x: 500, y: 0, text: "stale" }] },
      });
      expect(stale.isError).toBe(true);
      const after = jsonAfter(textOf(await client.callTool({ name: "get_board", arguments: {} })), "BOARD_JSON:");
      expect(after.items.filter((item) => item.text === "AI revised")).toHaveLength(1);
      expect(after.items.some((item) => item.text === "共享画布")).toBe(true);
      await client.callTool({
        name: "draw_board",
        arguments: {
          remove_ids: after.items.filter((item) => item.text === "AI revised" || item.text === "→" || item.text === "共享画布").map((item) => item.id),
        },
      });
      expect(before.revision).toBeLessThan(after.revision);
    });
  }, 30_000);

  it("saves and switches editable board snapshots through draw_board library actions", async () => {
    await withClient(3424, async (client) => {
      const initial = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, text: "library original" }] },
      });
      const firstId = initial.structuredContent.id;
      expect(initial.structuredContent.library.boards).toHaveLength(1);
      const created = await client.callTool({
        name: "draw_board",
        arguments: { library: { type: "create", name: "Library B", switchTo: true } },
      });
      expect(created.structuredContent.id).not.toBe(firstId);
      expect(created.structuredContent.items).toHaveLength(0);
      expect(created.structuredContent.library.activeId).toBe(created.structuredContent.id);
      const switched = await client.callTool({
        name: "draw_board",
        arguments: { library: { type: "switch", id: firstId } },
      });
      expect(switched.structuredContent.id).toBe(firstId);
      expect(switched.structuredContent.items.some((item) => item.text === "library original")).toBe(true);
    });
  }, 30_000);

  it("generates a complex diagram from semantic nodes and edges", async () => {
    await withClient(3427, async (client) => {
      const existing = await client.callTool({
        name: "draw_board",
        arguments: { author: "human", items: [{ type: "note", x: 20, y: 20, w: 180, h: 100, text: "person note" }] },
      });
      expect(existing.isError).toBeFalsy();
      const result = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          diagram: {
            title: "Semantic Architecture",
            subtitle: "Generated without manual coordinates",
            nodes: [
              { id: "entry", label: "入口", detail: "Codex 插件" },
              { id: "core", label: "内核", detail: "Board v1" },
              { id: "canvas", label: "画布", detail: "Excalidraw" },
            ],
            edges: [
              { from: "entry", to: "core", label: "stdio" },
              { from: "core", to: "canvas", label: "render" },
            ],
          },
        },
      });
      expect(textOf(result)).toContain("图已生成");
      expect(result.structuredContent.title).toBe("Semantic Architecture");
      expect(result.structuredContent.items.some((item) => item.id === "entry")).toBe(true);
      expect(result.structuredContent.items.some((item) => item.type === "line" && item.startItemId === "entry" && item.endItemId === "core")).toBe(true);
      expect(result.structuredContent.items.some((item) => item.text === "person note")).toBe(true);
      const rejected = await client.callTool({
        name: "draw_board",
        arguments: {
          diagram: { nodes: [{ id: "only", label: "Only" }], edges: [] },
          items: [{ type: "text", x: 0, y: 0, w: 100, h: 24, text: "extra" }],
        },
      });
      expect(rejected.isError).toBe(true);
      const replaced = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          diagram: { replace: true, nodes: [{ id: "only", label: "Only" }], edges: [] },
        },
      });
      expect(replaced.isError).toBeFalsy();
      expect(replaced.structuredContent.items.some((item) => item.text === "person note")).toBe(false);
    });
  }, 30_000);

  it("scans the project read-only as optional board context", async () => {
    await withClient(3423, async (client) => {
      const text = textOf(await client.callTool({
        name: "scan_project",
        arguments: { max_depth: 1, max_files: 12, include_evidence: false },
      }));
      expect(text).toContain("PROJECT_JSON:");
      const snapshot = jsonAfter(text, "PROJECT_JSON:");
      expect(snapshot).toMatchObject({ version: 1, readOnly: true, writes: "none" });
      expect(snapshot.files.length).toBeGreaterThan(0);
      expect(snapshot).not.toHaveProperty("workspaceRoot");
      expect(JSON.stringify(snapshot)).not.toContain(process.cwd());
      expect(text).not.toContain("Use draw_board to visualize this read-only context");
      expect(text).not.toContain("PROJECT_TEXT:");
      expect(text.length).toBeLessThan(14_000);
    });
  }, 30_000);
});
