import fs from "node:fs/promises";
import net from "node:net";
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

/**
 * Ask the OS for a loopback port that is free right now.
 *
 * Pinning a port made two checkouts of this repository collide: the second
 * `npm test` either failed to bind or, worse, silently attached its assertions
 * to the first run's preview server. Parallel worktrees only work if every
 * spawned server picks its own port, so tests bind port 0 and read back the
 * port the server actually received.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function withClient(callback) {
  const port = await freePort();
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

async function withClientIn(outputDir, callback) {
  const port = await freePort();
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
    await withClient(async (client) => {
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
    await withClient(async (client) => {
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
        PREVIEW_PORT: "0",
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
      // Image export exists on the human canvas, so an agent must never read
      // the capability list as "Doodle cannot produce a PNG/JPG/SVG".
      expect(board.capabilities.libraryFormat).toBe("editable-json");
      expect(board.capabilities.sharingExports).toEqual(["png", "jpg", "svg"]);
      expect(board.capabilities.sharingExportOwner).toBe("human-canvas");
      expect(board.capabilities.sharingExportHint).toContain("分享快照");
      expect(text).toContain("图库 → 分享快照");
      expect(board.visualDigest).toMatchObject({ version: 1, itemCount: 0 });
      expect(Array.isArray(board.items)).toBe(true);
      expect(board.safety).toMatchObject({ projectWritesRequireHumanApproval: true });
    } finally {
      await client.close();
    }
  }, 30_000);

  it("uses concise guidance after a board has visual context", async () => {
    await withClient(async (client) => {
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "context" }] },
      });
      const text = textOf(await client.callTool({ name: "get_board", arguments: {} }));
      expect(text).toContain("NEXT:");
      expect(text).not.toContain("FIRST_USE:");
      expect(text).not.toContain("BOARD_JSON is the read-only shared state");
      expect(text).toContain("BOARD_JSON:");
      expect(text).toContain('"text":"context"');
    });
  }, 30_000);

  it("sends the guide once per process and rereads compactly", async () => {
    await withClient(async (client) => {
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

  it("does not resend the guide on repeated empty reads", async () => {
    // `firstUse || !state.guideSent` kept the guide permanent on an empty
    // board, so four consecutive reads all cost the same 10,989 bytes. An empty
    // board is the most-reread state an agent has.
    await withClient(async (client) => {
      const first = textOf(await client.callTool({ name: "get_board", arguments: {} }));
      expect(first).toContain("CAPABILITIES:");
      expect(first).toContain("Visual recipes:");

      const second = textOf(await client.callTool({ name: "get_board", arguments: {} }));
      const third = textOf(await client.callTool({ name: "get_board", arguments: {} }));
      for (const reread of [second, third]) {
        expect(reread).not.toContain("CAPABILITIES:");
        expect(reread).not.toContain("Visual recipes:");
        expect(reread).not.toContain("Drawing guide:");
      }
      expect(second).toBe(third);
      expect(second.length).toBeLessThan(first.length * 0.75);
    });
  }, 30_000);

  it("trims the text block for a summary view", async () => {
    // `view: "summary"` dropped `items` from structured content while the text
    // block still carried the guide and recipes, so the cheap view cost almost
    // as much as a full read.
    await withClient(async (client) => {
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "context" }] },
      });
      const full = textOf(await client.callTool({ name: "get_board", arguments: {} }));
      const summary = textOf(await client.callTool({ name: "get_board", arguments: { view: "summary" } }));

      expect(summary).toContain("BOARD_VIEW_SUMMARY:");
      expect(summary).not.toContain("CAPABILITIES:");
      expect(summary).not.toContain("Visual recipes:");
      expect(summary).not.toContain('"items":');
      expect(summary).not.toContain('"copyText":');
      expect(summary.length).toBeLessThan(full.length);
    });
  }, 30_000);

  it("keeps a delta read's diagnosis flat too", async () => {
    // A delta answers "what changed", so the full per-object diagnosis is the
    // wrong shape: it enumerated every object and cost 1.4 KB at 80 objects on
    // a reply whose changed-objects array was 135 B.
    await withClientIn(path.join(tempDir, "delta-flat"), async (client) => {
      await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          items: Array.from({ length: 80 }, (_, index) => ({
            type: "note", x: (index % 20) * 30, y: Math.floor(index / 20) * 30, w: 24, h: 24, text: `n${index}`,
          })),
        },
      });
      const seen = (await client.callTool({ name: "get_board", arguments: { include_guide: false } })).structuredContent;
      const id = seen.items[0].id;
      await client.callTool({
        name: "draw_board",
        arguments: { author: "human", updates: [{ id, patch: { text: "human edit" } }] },
      });

      const delta = await client.callTool({ name: "get_board", arguments: { since_revision: seen.revision } });
      const sc = delta.structuredContent;

      expect(sc.mode).toBe("delta");
      expect(sc.updated).toHaveLength(1);
      // Counts, not the enumeration.
      expect(typeof sc.diagnosis.isolated).toBe("number");
      expect(typeof sc.diagnosis.overlapping).toBe("number");
      expect(sc.diagnosis.itemCount).toBe(80);
    });
  }, 60_000);

  it("keeps a summary read flat as the board grows", async () => {
    // `summary` is a status check. It used to carry the full
    // `visualDigest.readingOrder` and `diagnosis.isolated`, both of which
    // enumerate every object: 13 KB at 60 objects, growing linearly, for a view
    // whose only purpose is to be cheap.
    await withClientIn(path.join(tempDir, "summary-flat"), async (client) => {
      const fill = async (count) => {
        await client.callTool({
          name: "draw_board",
          arguments: {
            author: "ai",
            items: Array.from({ length: count }, (_, index) => ({
              type: "note",
              x: (index % 20) * 30,
              y: Math.floor(index / 20) * 30,
              w: 24,
              h: 24,
              text: `n${index}`,
            })),
          },
        });
      };
      const sizeOf = async () => {
        const result = await client.callTool({ name: "get_board", arguments: { view: "summary" } });
        return { sc: result.structuredContent, bytes: Buffer.byteLength(JSON.stringify(result)) };
      };

      await fill(10);
      const small = await sizeOf();
      await fill(60);
      const large = await sizeOf();

      // The whole point: 6x the objects must not mean 6x the payload.
      expect(large.bytes).toBeLessThan(small.bytes * 1.6);

      // Counts survive; the per-object enumerations do not.
      expect(large.sc.diagnosis.itemCount).toBe(70);
      expect(typeof large.sc.diagnosis.isolated).toBe("number");
      expect(typeof large.sc.visualDigest.readingOrder).toBe("undefined");
      expect(typeof large.sc.visualDigest.connections).toBe("number");
      expect(Array.isArray(large.sc.items)).toBe(false);
    });
  }, 60_000);

  it("does not send the board twice on a graded view", async () => {
    // The text copy is byte-identical to structuredContent, so `full` keeps it
    // for text-only hosts. A graded view exists to cut tokens, and it was still
    // shipping both channels in full: `detail` cost 24.5 KB on a 25-object
    // board. Graded views now name their payload and leave the data to
    // structuredContent, which every MCP client receives anyway.
    await withClient(async (client) => {
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "graded" }] },
      });
      const full = await client.callTool({ name: "get_board", arguments: {} });
      const detail = await client.callTool({ name: "get_board", arguments: { view: "detail" } });
      const detailText = textOf(detail);

      // The agent payload is still delivered, just once.
      expect(detail.structuredContent.items.some((item) => item.text === "graded")).toBe(true);
      expect(detailText).toContain("BOARD_VIEW_DETAIL:");
      expect(detailText).not.toContain("BOARD_JSON:");
      expect(detailText).not.toContain('"items":[');
      expect(Buffer.byteLength(detailText)).toBeLessThan(Buffer.byteLength(textOf(full)) / 2);

      // `full` keeps the complete text copy, per the documented contract.
      expect(textOf(full)).toContain("BOARD_JSON:");
      expect(textOf(full)).toContain('"items":[');
    });
  }, 30_000);

  it("rejects a per-item author instead of relabelling it", async () => {
    // The write path stamps every item with the top-level author. Accepting a
    // per-item `author` and overriding it let a model mark a person's words as
    // its own without any signal.
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "person words", author: "human" }],
        },
      });
      const text = textOf(result);

      expect(result.isError).toBe(true);
      expect(text).toContain("AUTHOR_ON_ITEM");
      expect(text).toContain("author must not be set per item");
    });
  }, 30_000);

  it("returns only changed objects for a reread since a revision", async () => {
    await withClient(async (client) => {
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
    await withClientIn(outputDir, async (client) => {
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

  it("returns canvas fidelity only when the canvas explicitly asks for it", async () => {
    const outputDir = path.join(tempDir, "fidelity-on-demand");
    await withClientIn(outputDir, async (client) => {
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "kept" }] },
      });
      const statePath = path.join(outputDir, ".doodle", "board.json");
      const persisted = JSON.parse(await fs.readFile(statePath, "utf8"));
      persisted.items = persisted.items.map((entry) => ({
        ...entry,
        scene: { element: { id: entry.id, version: 9, versionNonce: 777 }, boundText: { id: `${entry.id}_t`, text: entry.text } },
      }));
      persisted.revision += 1;
      await fs.writeFile(statePath, JSON.stringify(persisted, null, 2));

      const agentRead = await client.callTool({ name: "get_board", arguments: {} });
      expect(JSON.stringify(agentRead.structuredContent)).not.toContain("versionNonce");

      const canvasRead = await client.callTool({
        name: "get_board",
        arguments: { include_canvas_fidelity: true, include_guide: false },
      });
      expect(JSON.stringify(canvasRead.structuredContent)).toContain("777");
      expect(canvasRead.structuredContent.items.every((entry) => Boolean(entry.scene))).toBe(true);
      expect(canvasRead.structuredContent.safety.canvasFidelityExcluded).toBeUndefined();
    });
  }, 30_000);

  it("tells the agent what the person changed since its last read", async () => {
    await withClient(async (client) => {
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

  it("adopts one canvas server when a second session uses the same board", async () => {
    /*
     * PANEL_URL names a board directory's canvas, not a process. Two MCP
     * sessions against one OUTPUT_DIR must converge on one loopback address:
     * a second random port leaves the person with two different canvases and
     * a stale link in whichever session they opened first.
     */
    const outputDir = path.join(tempDir, "adopt");
    const startSession = async (name) => {
      const transport = new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
        env: {
          ...process.env,
          LOG_LEVEL: "error",
          OUTPUT_DIR: outputDir,
          DOODLE_WORKSPACE_ROOT: process.cwd(),
        },
      });
      const client = new Client({ name, version: "1.0.0" });
      await client.connect(transport);
      return { client, transport };
    };
    const first = await startSession("doodle-adopt-first");
    let second;
    try {
      const firstPanel = textOf(await first.client.callTool({ name: "get_board", arguments: {} }))
        .match(/PANEL_URL: (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
      expect(firstPanel).toBeTruthy();
      second = await startSession("doodle-adopt-second");
      const secondPanel = textOf(await second.client.callTool({ name: "get_board", arguments: {} }))
        .match(/PANEL_URL: (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
      expect(secondPanel).toBe(firstPanel);

      const live = JSON.parse(await fs.readFile(path.join(outputDir, ".doodle", "live.json"), "utf8"));
      expect(Number.parseInt(new URL(firstPanel).port, 10)).toBe(live.port);
    } finally {
      await first.transport.close();
      await second?.transport.close();
    }
  }, 30_000);

  it("draws a directed board arrow and returns an authoritative canvas snapshot", async () => {
    await withClient(async (client) => {
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
      // Adds an object nobody else touched, so it merges rather than failing.
      expect(stale.isError).toBeFalsy();
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

  it("returns only what the canvas needs from a write, not the whole agent payload", async () => {
    // A write hands the board back so the embedded canvas can repaint without a
    // second round trip. `applyRemoteSnapshot` reads exactly id, revision,
    // items, and library; copyText, visualDigest, diagnosis, capabilities, and
    // safety were dead weight on every brush stroke.
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "write cost" }] },
      });
      const sc = result.structuredContent;

      // The canvas contract is intact.
      expect(Array.isArray(sc.items)).toBe(true);
      expect(typeof sc.revision).toBe("number");
      expect(typeof sc.id).toBe("string");
      expect(Array.isArray(sc.library.boards)).toBe(true);

      // Agent-facing fields are gone from the write result.
      expect(sc.capabilities).toBeUndefined();
      expect(sc.copyText).toBeUndefined();
      expect(sc.visualDigest).toBeUndefined();
      expect(sc.diagnosis).toBeUndefined();
      expect(sc.safety).toBeUndefined();

      // The agent still gets them from get_board.
      const read = await client.callTool({ name: "get_board", arguments: {} });
      expect(read.structuredContent.capabilities).toBeDefined();
      expect(read.structuredContent.visualDigest).toBeDefined();

      // A canvas edit round-trips through replace_board without losing fields
      // the person's own copy depends on.
      const edited = sc.items.map((item) => item.text === "write cost" ? { ...item, text: "edited", x: 20 } : item);
      const replaced = await client.callTool({
        name: "draw_board",
        arguments: { replace_board: { ...sc, items: edited, notes: [] }, expected_revision: sc.revision },
      });
      const saved = replaced.structuredContent.items.find((item) => item.text === "edited");
      expect(saved?.createdAt).toBeTruthy();
      expect(saved?.author).toBe("ai");
    });
  }, 30_000);

  it("lets two unpinned writes land instead of failing one on a revision race", async () => {
    // A write without `expected_revision` means "append to whatever is there".
    // The handler used to read the board outside the store lock and then write
    // with that revision, so two agents drawing at the same moment produced
    // `expected N, found N+1` for the loser — a failure neither of them asked
    // for and neither could act on. `store.mutate` re-reads inside the lock.
    const outputDir = path.join(tempDir, "concurrent");
    // Two long-lived clients: `withClientIn` closes its client in `finally`,
    // which would tear down a connection the other half of the race still needs.
    const openClient = async (name) => {
      const transport = new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
        env: {
          ...process.env,
          PREVIEW_PORT: String(await freePort()),
          LOG_LEVEL: "error",
          OUTPUT_DIR: outputDir,
          DOODLE_WORKSPACE_ROOT: process.cwd(),
        },
      });
      const client = new Client({ name, version: "1.0.0" });
      await client.connect(transport);
      return client;
    };
    const left = await openClient("doodle-concurrent-left");
    const right = await openClient("doodle-concurrent-right");
    try {
      const [first, second] = await Promise.all([
        left.callTool({
          name: "draw_board",
          arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "conc-a" }] },
        }),
        right.callTool({
          name: "draw_board",
          arguments: { author: "ai", items: [{ type: "note", x: 200, y: 0, w: 160, h: 90, text: "conc-b" }] },
        }),
      ]);

      expect(first.isError).toBeFalsy();
      expect(second.isError).toBeFalsy();

      const board = (await left.callTool({ name: "get_board", arguments: {} })).structuredContent;
      expect(board.items.some((item) => item.text === "conc-a")).toBe(true);
      expect(board.items.some((item) => item.text === "conc-b")).toBe(true);
    } finally {
      await left.close();
      await right.close();
    }
  }, 60_000);

  it("merges a stale pinned write when it touches nothing that moved", async () => {
    // A pinned revision is board-wide, so the optimistic check alone rejected
    // two writers editing different objects. The HTTP surface already answered
    // the only question that matters — does this request overlap anything that
    // changed? — and merged when it did not. The MCP path now does the same,
    // and nothing is overwritten: this stale write only adds a new note.
    const outputDir = path.join(tempDir, "stale-pin");
    await withClientIn(outputDir, async (client) => {
      const seen = (await client.callTool({ name: "get_board", arguments: {} })).structuredContent;
      await client.callTool({
        name: "draw_board",
        arguments: { author: "human", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "human edit" }] },
      });
      const stale = await client.callTool({
        name: "draw_board",
        arguments: {
          expected_revision: seen.revision,
          author: "ai",
          items: [{ type: "note", x: 200, y: 0, w: 160, h: 90, text: "stale ai" }],
        },
      });

      expect(stale.isError).toBeFalsy();
      const board = (await client.callTool({ name: "get_board", arguments: {} })).structuredContent;
      expect(board.items.some((item) => item.text === "human edit")).toBe(true);
      expect(board.items.some((item) => item.text === "stale ai")).toBe(true);
    });
  });

  it("tells the caller when a pinned write was merged", async () => {
    // The write landed on a newer revision than the one it pinned. Nothing it
    // touched was overwritten, but hiding that the base moved would leave the
    // model reasoning about a board state it never saw.
    const outputDir = path.join(tempDir, "merged-notice");
    await withClientIn(outputDir, async (client) => {
      const seen = (await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "base" }] },
      })).structuredContent;
      await client.callTool({
        name: "draw_board",
        arguments: { author: "human", items: [{ type: "note", x: 300, y: 0, w: 160, h: 90, text: "human" }] },
      });
      const merged = await client.callTool({
        name: "draw_board",
        arguments: {
          expected_revision: seen.revision,
          author: "ai",
          items: [{ type: "note", x: 0, y: 300, w: 160, h: 90, text: "ai" }],
        },
      });

      expect(merged.isError).toBeFalsy();
      expect(merged.structuredContent.mergedFrom).toBe(seen.revision);
      expect(textOf(merged)).toContain("MERGED:");

      // A write that did not need merging must not claim it did.
      const plain = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 600, y: 0, w: 160, h: 90, text: "plain" }] },
      });
      expect(plain.structuredContent.mergedFrom).toBeUndefined();
    });
  }, 30_000);

  it("refuses a stale pinned write that overlaps an object someone else moved", async () => {
    // The merge is object-level, not a licence to overwrite. When the request
    // changes an object that moved since the caller's revision, it refuses —
    // and names the ids, so the caller can re-apply just those.
    const outputDir = path.join(tempDir, "stale-overlap");
    await withClientIn(outputDir, async (client) => {
      const created = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "shared" }] },
      });
      const seen = created.structuredContent;
      const id = seen.items[0].id;

      // Someone else edits the same object.
      await client.callTool({
        name: "draw_board",
        arguments: { author: "human", updates: [{ id, patch: { text: "human took it" } }] },
      });

      const stale = await client.callTool({
        name: "draw_board",
        arguments: {
          expected_revision: seen.revision,
          author: "ai",
          updates: [{ id, patch: { text: "stale ai" } }],
        },
      });

      expect(stale.isError).toBe(true);
      const staleText = textOf(stale);
      expect(staleText).toContain("REVISION_CONFLICT_OBJECTS");
      expect(jsonAfter(staleText, "ERROR_JSON:")).toMatchObject({ code: "REVISION_CONFLICT_OBJECTS" });
      expect(staleText).toContain(id);

      // The other writer's value survives.
      const board = (await client.callTool({ name: "get_board", arguments: {} })).structuredContent;
      expect(board.items.find((item) => item.id === id)?.text).toBe("human took it");
    });
  }, 30_000);

  it("returns a repaintable snapshot from library actions, not only the agent payload", async () => {
    // `libraryRequest` in the canvas reads the active snapshot to repaint
    // without a second fetch. This branch used to return the agent payload
    // only, so the canvas fell back to `/api/board` on every library action.
    await withClient(async (client) => {
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "lib snap" }] },
      });

      const listed = await client.callTool({ name: "draw_board", arguments: { library: { type: "list" } } });
      const sc = listed.structuredContent;
      expect(Array.isArray(sc.items)).toBe(true);
      expect(typeof sc.revision).toBe("number");
      expect(typeof sc.id).toBe("string");
      expect(Array.isArray(sc.library.boards)).toBe(true);
      expect(sc.capabilities).toBeUndefined();
      expect(sc.copyText).toBeUndefined();

      // Export still carries the requested board separately from the active one.
      const exported = await client.callTool({ name: "draw_board", arguments: { library: { type: "export" } } });
      expect(exported.structuredContent.exportBoard).toMatchObject({ version: 1 });
      expect(exported.structuredContent.exportBoard.items.length).toBeGreaterThan(0);
    });
  }, 30_000);

  it("sends the guide once across get_board and show_board", async () => {
    // Both tools carry CAPABILITIES and RECIPES, and `show_board` is called
    // repeatedly: once per view request, and after a draw in hosts that cannot
    // render the MCP App from the write result. The guide is the same bytes
    // every time, so the two tools share one flag.
    const outputDir = path.join(tempDir, "shared-guide");
    await withClientIn(outputDir, async (client) => {
      const first = textOf(await client.callTool({ name: "show_board", arguments: {} }));
      expect(first).toContain("CAPABILITIES:");
      expect(first).toContain("Visual recipes:");
      // A text-only host cannot render the MCP App; show_board must hand it
      // the panel URL directly instead of asking for another get_board call.
      expect(first).toMatch(/PANEL_URL: http:\/\/127\.0\.0\.1:\d+\//);

      const second = textOf(await client.callTool({ name: "show_board", arguments: {} }));
      expect(second).not.toContain("CAPABILITIES:");
      expect(second).not.toContain("Visual recipes:");
      expect(second.length).toBeLessThan(first.length);

      // The cross-tool half: get_board must know the guide already went out.
      const read = textOf(await client.callTool({ name: "get_board", arguments: {} }));
      expect(read).not.toContain("Visual recipes:");
      expect(read).toContain("GUIDE:");

      // The canvas still gets its board every time.
      const shown = await client.callTool({ name: "show_board", arguments: {} });
      expect(Array.isArray(shown.structuredContent.items)).toBe(true);
      expect(shown.structuredContent.capabilities).toBeDefined();
    });
  }, 30_000);

  it("does not report a board switch as an edit", async () => {
    // The revision cache is keyed by revision alone. Asking for a delta after a
    // library switch compared the new board against the old board's revision,
    // so every object of the new board read as "added" and every object of the
    // old one as "removed" — a change report for something nobody did.
    const outputDir = path.join(tempDir, "switch-delta");
    await withClientIn(outputDir, async (client) => {
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "A only" }] },
      });
      const boardA = (await client.callTool({ name: "get_board", arguments: {} })).structuredContent;

      await client.callTool({
        name: "draw_board",
        arguments: { library: { type: "create", name: "Other", switchTo: true } },
      });
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "B only" }] },
      });
      const boardB = (await client.callTool({ name: "get_board", arguments: {} })).structuredContent;
      expect(boardB.id).not.toBe(boardA.id);

      const delta = await client.callTool({ name: "get_board", arguments: { since_revision: boardA.revision } });
      const text = textOf(delta);

      // Falls back to a full read that explains why, instead of inventing edits.
      expect(delta.structuredContent.mode).toBeUndefined();
      expect(delta.structuredContent.added).toBeUndefined();
      expect(delta.structuredContent.removed).toBeUndefined();
      expect(text).toContain("另一张画板");
      expect(delta.structuredContent.itemCount).toBe(boardB.itemCount);
    });
  }, 30_000);

  it("keeps the person on their board when switchTo is false", async () => {
    // create/save/duplicate/import make the result active by default, which is
    // right for the canvas (you just made it, you want to see it) but wrong for
    // an agent tidying the library: the person's view would move under them.
    // The field was undocumented, so a model had no way to know either way.
    // Own state dir: the shared `tempDir` is reused by the library test below,
    // which asserts an exact board count.
    const outputDir = path.join(tempDir, "switch-to-false");
    await withClientIn(outputDir, async (client) => {
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "stay here" }] },
      });
      const before = (await client.callTool({ name: "get_board", arguments: {} })).structuredContent;

      const background = await client.callTool({
        name: "draw_board",
        arguments: { library: { type: "create", name: "Background", switchTo: false } },
      });
      expect(background.structuredContent.id).toBe(before.id);
      expect(background.structuredContent.library.boards.some((board) => board.name === "Background")).toBe(true);
      expect(background.structuredContent.library.boards.find((board) => board.id === before.id).active).toBe(true);

      // Omitting the field still switches, which is what the canvas relies on.
      const active = await client.callTool({
        name: "draw_board",
        arguments: { library: { type: "create", name: "Foreground" } },
      });
      expect(active.structuredContent.id).not.toBe(before.id);
      expect(active.structuredContent.title).toBe("Foreground");
    });
  }, 30_000);

  it("saves and switches editable board snapshots through draw_board library actions", async () => {
    await withClient(async (client) => {
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
    await withClient(async (client) => {
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
    await withClient(async (client) => {
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
      // Hidden entries (including .env) are private by construction: a scan
      // must return relative source paths, never a secret-bearing config.
      expect(snapshot.files.some((file) => String(file.path ?? file).split("/").some((segment) => segment.startsWith(".")))).toBe(false);
      expect(JSON.stringify(snapshot)).not.toContain(".env");
      expect(text).not.toContain("Use draw_board to visualize this read-only context");
      expect(text).not.toContain("PROJECT_TEXT:");
      expect(text.length).toBeLessThan(14_000);
    });
  }, 30_000);
});
