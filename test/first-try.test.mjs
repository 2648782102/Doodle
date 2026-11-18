/**
 * First-try repair contract.
 *
 * A model that has just read the tool descriptions will guess wrong in
 * predictable ways. Every one of those guesses must come back with a field
 * path and a concrete fix, not just prose, because a bare message forces a
 * second round trip the person pays for.
 *
 * The cases below are the mistakes a naive drive of the server actually made,
 * not invented ones. The last test asserts the shared shape so a future
 * rejection cannot quietly land outside the contract.
 */

import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-first-try-"));

afterAll(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

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
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: {
      ...process.env,
      PREVIEW_PORT: String(await freePort()),
      LOG_LEVEL: "error",
      OUTPUT_DIR: tempDir,
      DOODLE_WORKSPACE_ROOT: process.cwd(),
    },
  });
  const client = new Client({ name: "doodle-first-try", version: "1.0.0" });
  try {
    await client.connect(transport);
    await callback(client);
  } finally {
    await client.close();
  }
}

/** Pull the `ERROR_JSON` block out of a tool result's text. */
function errorJsonOf(result) {
  const text = (result.content ?? []).map((part) => part.text ?? "").join("\n");
  const match = text.match(/ERROR_JSON:\n(\{[\s\S]*\})/);
  return match ? JSON.parse(match[1]) : undefined;
}

const WRONG_GUESSES = [
  {
    name: "text over the character limit",
    arguments: { author: "ai", items: [{ type: "text", x: 0, y: 0, w: 300, h: 40, text: "y".repeat(1300) }] },
    code: "TEXT_TOO_LONG",
    path: "items[].text",
  },
  {
    name: "far more objects than one call accepts",
    arguments: {
      author: "ai",
      items: Array.from({ length: 101 }, () => ({ type: "note", x: 0, y: 0, w: 20, h: 20, text: "n" })),
    },
    code: "BATCH_TOO_LARGE",
    path: "items",
  },
  {
    name: "author set to a custom name",
    arguments: { author: "architect", items: [{ type: "note", x: 0, y: 0, w: 20, h: 20, text: "n" }] },
    code: "INVALID_AUTHOR",
    path: "author",
  },
  {
    name: "colour named instead of hex",
    arguments: { author: "ai", items: [{ type: "rect", x: 0, y: 0, w: 100, h: 100, text: "x", color: "blue" }] },
    code: "INVALID_COLOR",
    path: "items[].color",
  },
  {
    name: "stroke with no points",
    arguments: { author: "ai", items: [{ type: "stroke", x: 0, y: 0, w: 50, h: 50 }] },
    code: "STROKE_POINTS_INVALID",
    path: "items[].points",
  },
  {
    name: "line with no direction",
    arguments: { author: "ai", items: [{ type: "line", x: 0, y: 0, w: 0, h: 0 }] },
    code: "LINE_WITHOUT_DIRECTION",
    path: "items[].w",
  },
  {
    name: "image with no source",
    arguments: { author: "ai", items: [{ type: "image", x: 0, y: 0, w: 100, h: 100 }] },
    code: "IMAGE_SOURCE_MISSING",
    path: "items[].src",
  },
  {
    name: "connector bound on a rectangle",
    arguments: { author: "ai", items: [{ type: "rect", x: 0, y: 0, w: 100, h: 100, text: "r", startItemId: "a" }] },
    code: "CONNECTOR_ON_NON_LINE",
    path: "items[].startItemId",
  },
  {
    name: "variant outside the set",
    arguments: { author: "ai", items: [{ type: "rect", x: 0, y: 0, w: 100, h: 100, text: "r", variant: "blob" }] },
    code: "INVALID_VARIANT",
    path: "items[].variant",
  },
  {
    name: "z-order outside the range",
    arguments: { author: "ai", items: [{ type: "rect", x: 0, y: 0, w: 100, h: 100, text: "r", z: 5000 }] },
    code: "INVALID_Z",
    path: "items[].z",
  },
  {
    name: "size below the floor",
    arguments: { author: "ai", items: [{ type: "rect", x: 0, y: 0, w: 12, h: 12, text: "tiny" }] },
    code: "SIZE_OUT_OF_RANGE",
    path: "items[].w",
  },
  {
    name: "coordinates beyond the canvas",
    arguments: { author: "ai", items: [{ type: "rect", x: 500000, y: 0, w: 100, h: 100, text: "far" }] },
    code: "COORDINATE_OUT_OF_RANGE",
    path: "items[].x",
  },
  {
    name: "diagram edge pointing at an unknown node",
    arguments: { author: "ai", diagram: { nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "zzz" }] } },
    code: "UNKNOWN_EDGE_NODE",
    path: "diagram.edges",
  },
  {
    // The bound moved out of the Zod schema so the rejection names a repair;
    // it has to survive the move.
    name: "diagram row past the ceiling",
    arguments: { author: "ai", diagram: { mode: "timeline", nodes: [{ id: "a", label: "A", row: 60 }] } },
    code: "DIAGRAM_ROW_OUT_OF_RANGE",
    path: "diagram.nodes[].row",
  },
  {
    name: "diagram column past the ceiling",
    arguments: { author: "ai", diagram: { mode: "compare", nodes: [{ id: "a", label: "A", column: 20 }] } },
    code: "DIAGRAM_COLUMN_OUT_OF_RANGE",
    path: "diagram.nodes[].column",
  },
];

describe("first-try repair contract", () => {
  it("answers every predictable wrong guess with a field path and a fix", async () => {
    await withClient(async (client) => {
      const misses = [];
      for (const guess of WRONG_GUESSES) {
        const result = await client.callTool({ name: "draw_board", arguments: guess.arguments });
        const payload = errorJsonOf(result);
        if (!result.isError) {
          misses.push(`${guess.name}: was accepted`);
          continue;
        }
        if (!payload) {
          misses.push(`${guess.name}: no ERROR_JSON`);
          continue;
        }
        if (payload.code !== guess.code) {
          misses.push(`${guess.name}: code ${payload.code} != ${guess.code}`);
        }
        if (guess.path !== undefined && payload.path !== guess.path) {
          misses.push(`${guess.name}: path ${payload.path} != ${guess.path}`);
        }
        if (typeof payload.fix !== "string" || payload.fix.length < 10) {
          misses.push(`${guess.name}: fix missing or too terse`);
        }
        if (typeof payload.expected !== "string" || payload.expected.length === 0) {
          misses.push(`${guess.name}: expected missing`);
        }
      }
      expect(misses).toEqual([]);
    });
  }, 60_000);

  it("keeps the repair contract inside ERROR_JSON, not in bare prose", async () => {
    // The MCP SDK rejects `inputSchema` before the handler runs and reports a
    // bare `MCP error -32602`. Bounds therefore live in `model/`, so every
    // rejection reaches the same serialiser. This test fails if a bound moves
    // back into the schema.
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "text", x: 0, y: 0, w: 300, h: 40, text: "y".repeat(2000) }] },
      });
      const text = (result.content ?? []).map((part) => part.text ?? "").join("\n");

      expect(text).not.toContain("-32602");
      expect(text).toContain("ERROR_JSON:");
      expect(errorJsonOf(result)).toMatchObject({
        code: "TEXT_TOO_LONG",
        path: "items[].text",
      });
    });
  }, 30_000);

  it("still accepts the call the model was trying to make", async () => {
    // A repair path is only useful if the corrected call works. Each case fixes
    // its own mistake the way the `fix` text says to.
    await withClient(async (client) => {
      const corrected = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          items: [
            { type: "text", x: 0, y: 0, w: 300, h: 40, text: "y".repeat(1200) },
            { type: "rect", x: 0, y: 60, w: 16, h: 16, text: "ok", color: "#f6d365", variant: "card" },
            { type: "stroke", x: 0, y: 100, w: 40, h: 40, points: [{ x: 0, y: 0 }, { x: 40, y: 20 }] },
            { type: "line", x: 60, y: 100, w: 120, h: 0 },
          ],
        },
      });
      // A successful call omits `isError` rather than setting it false.
      expect(corrected.isError).toBeFalsy();
      expect(corrected.structuredContent.items.length).toBe(4);
    });
  }, 30_000);

  it("publishes the bounds a model is checked against", async () => {
    // Knowing a bound up front is cheaper than any repair: it turns a rejected
    // write into a correct one. The table must match what model/ enforces.
    // A fresh client on a fresh state dir, so the drawing guide is still due:
    // it is sent once per process, and the earlier cases consumed it.
    const outputDir = path.join(tempDir, "limits");
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
    const client = new Client({ name: "doodle-limits", version: "1.0.0" });
    try {
      await client.connect(transport);
      const first = await client.callTool({ name: "get_board", arguments: {} });
      const { limits } = first.structuredContent.capabilities;

      expect(limits).toMatchObject({
        objectsPerBoard: 400,
        objectsPerCall: 100,
        coordinate: 100000,
        textLength: 1200,
        titleLength: 120,
        strokePoints: 500,
      });
      expect(limits.shapeSize.min).toBe(16);
      expect(limits.diagram).toMatchObject({ nodes: 48, edges: 96, column: 12, row: 48 });

      // The guide restates what shapes a first attempt, not just the table.
      const text = (first.content ?? []).map((part) => part.text ?? "").join("\n");
      expect(text).toContain("100 items per call");
    } finally {
      await client.close();
    }
  }, 30_000);
});
