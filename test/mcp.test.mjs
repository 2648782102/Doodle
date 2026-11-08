import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED_TOOLS = ["get_board", "draw_board", "reply_on_board", "scan_project"];
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
  it("registers exactly four agent-first tools and no browser-opening tool", async () => {
    await withClient(3421, async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
      expect(client.getInstructions()).toContain("Start with get_board");
      expect(client.getInstructions()).toContain("scan_project is optional");
    });
  }, 30_000);

  it("returns the shared board and drawing guide through get_board", async () => {
    await withClient(3441, async (client) => {
      const text = textOf(await client.callTool({ name: "get_board", arguments: {} }));
      expect(text).toContain("BOARD_JSON:");
      expect(text).toContain("Drawing guide:");
      expect(text).toContain("(x,y) to (x+w,y+h)");
      const board = jsonAfter(text, "BOARD_JSON:");
      expect(board).toMatchObject({ version: 1, readOnly: true });
      expect(Array.isArray(board.items)).toBe(true);
      expect(board.safety).toMatchObject({ projectWritesRequireHumanApproval: true });
    });
  }, 30_000);

  it("draws a directed board arrow and replies on the same canvas", async () => {
    await withClient(3422, async (client) => {
      const before = jsonAfter(textOf(await client.callTool({ name: "get_board", arguments: {} })), "BOARD_JSON:");
      const drawn = textOf(await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          items: [
            { type: "note", x: 0, y: 0, w: 180, h: 100, text: "MCP test", color: "#f6d365" },
            { type: "line", x: 180, y: 50, w: 120, h: 0, text: "→", color: "#64748b" },
          ],
        },
      }));
      expect(drawn).toContain("新增 2");
      const reply = textOf(await client.callTool({
        name: "reply_on_board",
        arguments: { body: "这是同一张画板上的一句回应" },
      }));
      expect(reply).toContain("AI 回应已放到画板旁");
      const after = jsonAfter(textOf(await client.callTool({ name: "get_board", arguments: {} })), "BOARD_JSON:");
      expect(after.items.filter((item) => item.text === "MCP test")).toHaveLength(1);
      expect(after.notes.at(-1).body).toContain("同一张画板");
      await client.callTool({
        name: "draw_board",
        arguments: {
          remove_ids: after.items.filter((item) => item.text === "MCP test" || item.text === "→").map((item) => item.id),
        },
      });
      expect(before.revision).toBeLessThan(after.revision);
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
      expect(text).toContain("Use draw_board to visualize this read-only context");
    });
  }, 30_000);
});
