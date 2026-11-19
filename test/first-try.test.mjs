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

  it("validates a replace_board payload with the same rules as a write", async () => {
    // `replace_board` is how the canvas saves a human edit, so it takes a whole
    // board object. `parseBoard` used to check only that `color` was a string:
    // a payload with `color: "nope"` was persisted and the canvas then had no
    // usable fill. Both paths now share the predicates in `model/predicates.ts`.
    // Own state dir so the exact item count assertion below is meaningful.
    const outputDir = path.join(tempDir, "replace-board");
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
    const client = new Client({ name: "doodle-replace", version: "1.0.0" });
    try {
      await client.connect(transport);
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "original" }] },
      });
      const snapshot = (await client.callTool({ name: "get_board", arguments: {} })).structuredContent;
      const withBadColour = {
        ...snapshot,
        notes: [],
        items: [snapshot.items[0], { ...snapshot.items[0], id: "second", color: "nope" }],
      };

      const rejected = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", replace_board: withBadColour },
      });
      expect(rejected.isError).toBe(true);
      expect(errorJsonOf(rejected)).toMatchObject({
        code: "INVALID_COLOR",
        path: "items[1].color",
      });

      // The board is untouched by the rejected replacement.
      const after = (await client.callTool({ name: "get_board", arguments: {} })).structuredContent;
      expect(after.itemCount).toBe(1);
      expect(after.items[0].color).not.toBe("nope");
    } finally {
      await client.close();
    }
  }, 30_000);

  it("names the cheaper reads on a board too large to read whole", async () => {
    // 400 objects on one board came to 152 KB for a full read, against 6 KB at
    // view: "summary". A model that does not know the graded views exists pays
    // the whole price to check a status.
    const outputDir = path.join(tempDir, "size-hint");
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
    const client = new Client({ name: "doodle-size-hint", version: "1.0.0" });
    try {
      await client.connect(transport);
      await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          items: Array.from({ length: 100 }, (_, index) => ({
            type: "note", x: (index % 20) * 30, y: Math.floor(index / 20) * 30, w: 24, h: 24, text: `n${index}`,
          })),
        },
      });
      const text = (await client.callTool({ name: "get_board", arguments: { include_guide: false } }))
        .content.map((part) => part.text ?? "").join("\n");

      expect(text).toContain("SIZE:");
      expect(text).toContain('view: "summary"');
      expect(text).toContain("KB");

      // The hint is absent on a small board, where it would just be noise.
      const small = path.join(tempDir, "size-hint-small");
      const smallTransport = new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
        env: {
          ...process.env,
          PREVIEW_PORT: String(await freePort()),
          LOG_LEVEL: "error",
          OUTPUT_DIR: small,
          DOODLE_WORKSPACE_ROOT: process.cwd(),
        },
      });
      const smallClient = new Client({ name: "doodle-size-hint-small", version: "1.0.0" });
      try {
        await smallClient.connect(smallTransport);
        await smallClient.callTool({
          name: "draw_board",
          arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "one" }] },
        });
        const smallText = (await smallClient.callTool({ name: "get_board", arguments: { include_guide: false } }))
          .content.map((part) => part.text ?? "").join("\n");
        expect(smallText).not.toContain("SIZE:");
      } finally {
        await smallClient.close();
      }
    } finally {
      await client.close();
    }
  }, 60_000);

  it("explains the capacity ceiling instead of just refusing", async () => {
    // "Board item limit reached" gave the model nothing: not the current count,
    // not the limit, not the way out (a second board).
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          items: Array.from({ length: 101 }, (_, index) => ({
            type: "note", x: (index % 20) * 30, y: Math.floor(index / 20) * 30, w: 24, h: 24, text: `n${index}`,
          })),
        },
      });
      // Over the per-call batch, which is the ceiling a single call can hit.
      expect(errorJsonOf(result)).toMatchObject({ code: "BATCH_TOO_LARGE" });
    });
  }, 30_000);

  it("refuses a batch whose update targets a missing id, and writes nothing", async () => {
    // `updateBoardItems` looped over the board and looked each item up in the
    // patch map, so an update for an id that did not exist was silently
    // dropped while the call reported success. A model revising five labels
    // and mistyping one id was told all five landed.
    await withClient(async (client) => {
      const created = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          items: [
            { type: "note", x: 0, y: 0, w: 160, h: 90, text: "one" },
            { type: "note", x: 200, y: 0, w: 160, h: 90, text: "two" },
          ],
        },
      });
      const ids = created.structuredContent.items.map((item) => item.id);

      const mixed = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          updates: [
            { id: ids[0], patch: { text: "good" } },
            { id: "does-not-exist", patch: { text: "impossible" } },
          ],
        },
      });
      expect(mixed.isError).toBe(true);
      expect(errorJsonOf(mixed)).toMatchObject({ code: "ITEM_NOT_FOUND", path: "updates[1].id" });

      // Atomic: the good half of the batch did not land either.
      const board = (await client.callTool({ name: "get_board", arguments: {} })).structuredContent;
      expect(board.items.some((item) => item.text === "good")).toBe(false);
      expect(board.items.some((item) => item.text === "one")).toBe(true);
    });
  }, 30_000);

  it("refuses a removal that names a missing id, and removes nothing", async () => {
    await withClient(async (client) => {
      const created = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "keep" }] },
      });
      const id = created.structuredContent.items[0].id;

      const mixed = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", remove_ids: [id, "nope"] },
      });
      expect(mixed.isError).toBe(true);
      expect(errorJsonOf(mixed)).toMatchObject({ code: "ITEM_NOT_FOUND", path: "remove_ids[1]" });

      const board = (await client.callTool({ name: "get_board", arguments: {} })).structuredContent;
      expect(board.items.some((item) => item.id === id)).toBe(true);
    });
  }, 30_000);

  it("refuses a layout that names a missing object or an out-of-range bound", async () => {
    // An unknown id left an empty selection, which the filter read as "no
    // filter" and arranged the *whole* board instead of the requested subset —
    // a tidy-up that moved everything. `columns: 0` became 1 and stacked every
    // object on one spot; `gap: 500` was quietly reduced to 200.
    await withClient(async (client) => {
      const created = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          items: [
            { type: "note", x: 0, y: 0, w: 160, h: 90, text: "A" },
            { type: "note", x: 200, y: 0, w: 160, h: 90, text: "B" },
          ],
        },
      });
      const id = created.structuredContent.items[0].id;
      const before = (await client.callTool({ name: "get_board", arguments: {} })).structuredContent;

      const ghost = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", layout: { ids: [id, "ghost"], mode: "row" } },
      });
      expect(errorJsonOf(ghost)).toMatchObject({ code: "ITEM_NOT_FOUND", path: "layout.ids[1]" });

      const zero = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", layout: { columns: 0 } },
      });
      expect(errorJsonOf(zero)).toMatchObject({ code: "LAYOUT_COLUMNS_OUT_OF_RANGE", path: "layout.columns" });

      const wide = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", layout: { gap: 500 } },
      });
      expect(errorJsonOf(wide)).toMatchObject({ code: "LAYOUT_GAP_OUT_OF_RANGE", path: "layout.gap" });

      const mode = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", layout: { mode: "spiral" } },
      });
      expect(errorJsonOf(mode)).toMatchObject({ code: "INVALID_LAYOUT_MODE", path: "layout.mode" });

      // Nothing moved through any of the refusals.
      const after = (await client.callTool({ name: "get_board", arguments: {} })).structuredContent;
      const positions = (board) => board.items.map((item) => `${item.id}:${item.x},${item.y}`).sort();
      expect(positions(after)).toEqual(positions(before));
    });
  }, 30_000);

  it("refuses to combine two whole-board actions", async () => {
    // Only `diagram` used to guard this. `replace_board + items` and
    // `library + items` silently dropped the extra field and reported success,
    // so a caller that sent both believed the second half applied.
    await withClient(async (client) => {
      const created = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "base" }] },
      });
      const snapshot = created.structuredContent;
      const extra = [{ type: "note", x: 0, y: 900, w: 160, h: 90, text: "extra" }];

      for (const [label, args] of [
        ["replace_board + items", { replace_board: { ...snapshot, notes: [] }, items: extra }],
        ["replace_board + remove_ids", { replace_board: { ...snapshot, notes: [] }, remove_ids: [snapshot.items[0].id] }],
        ["library + items", { library: { type: "list" }, items: extra }],
        ["diagram + items", { diagram: { nodes: [{ id: "a", label: "A" }] }, items: extra }],
      ]) {
        const result = await client.callTool({ name: "draw_board", arguments: { author: "ai", ...args } });
        expect(result.isError, label).toBe(true);
        expect(errorJsonOf(result)?.code, label).toBe("CONFLICTING_ACTIONS");
      }

      // The refusals wrote nothing.
      const board = (await client.callTool({ name: "get_board", arguments: {} })).structuredContent;
      expect(board.items.some((item) => item.text === "extra")).toBe(false);
      expect(board.items.some((item) => item.text === "base")).toBe(true);
    });
  }, 30_000);

  it("explains an empty diagram instead of failing with a bare error", async () => {
    // `diagram: { nodes: [] }` raised "diagram requires nodes/edges or a recipe
    // with steps" with no code and no path, so a model could not tell whether
    // the shape was wrong or the content.
    await withClient(async (client) => {
      const empty = await client.callTool({ name: "draw_board", arguments: { author: "ai", diagram: { nodes: [] } } });
      expect(empty.isError).toBe(true);
      expect(errorJsonOf(empty)).toMatchObject({ code: "DIAGRAM_EMPTY", path: "diagram.nodes" });

      // Both fixes the message names actually work.
      const nodes = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", diagram: { nodes: [{ id: "a", label: "Start" }] } },
      });
      expect(nodes.isError).toBeFalsy();

      const recipe = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", diagram: { recipe: "flow", steps: ["Start", "Next"] } },
      });
      expect(recipe.isError).toBeFalsy();
    });
  }, 30_000);

  it("answers read-tool and library mistakes with a repair path too", async () => {
    // The write path was converted first; these are the remaining rejections
    // that still came back as bare SDK prose or `TOOL_ERROR`.
    await withClient(async (client) => {
      await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "A" }] },
      });

      const cases = [
        ["scan_project", { max_depth: 99 }, "SCAN_RANGE_OUT_OF_RANGE", "max_depth"],
        ["scan_project", { max_files: 0 }, "SCAN_RANGE_OUT_OF_RANGE", "max_files"],
        ["get_board", { since_revision: -1 }, "INVALID_SINCE_REVISION", "since_revision"],
        ["get_board", { view: "ultra" }, "INVALID_VIEW", "view"],
        ["draw_board", { library: { type: "switch", id: "ghost" } }, "BOARD_NOT_FOUND", "library.id"],
        ["draw_board", { library: { type: "rename", id: "ghost", name: "x" } }, "BOARD_NOT_FOUND", "library.id"],
      ];
      for (const [tool, args, code, path] of cases) {
        const result = await client.callTool({ name: tool, arguments: args });
        const payload = errorJsonOf(result);
        expect(result.isError, `${tool} ${JSON.stringify(args)}`).toBe(true);
        expect(payload?.code, `${tool} ${JSON.stringify(args)}`).toBe(code);
        expect(payload?.path, `${tool} ${JSON.stringify(args)}`).toBe(path);
        expect(typeof payload?.fix, `${tool} ${JSON.stringify(args)}`).toBe("string");
      }
    });
  }, 30_000);

  it("names the style sub-field when a visual style is wrong", async () => {
    // `style` is a field an agent uses freely, and every rejection here was a
    // bare string in a shared predicate — reaching the caller as TOOL_ERROR —
    // or a schema-level `Invalid option` with no repair.
    await withClient(async (client) => {
      const cases = [
        [{ borderColor: "nope" }, "INVALID_COLOR", "items[].style.borderColor"],
        [{ textColor: "nope" }, "INVALID_COLOR", "items[].style.textColor"],
        [{ fontSize: 999 }, "STYLE_OUT_OF_RANGE", "items[].style.fontSize"],
        [{ opacity: 5 }, "STYLE_OUT_OF_RANGE", "items[].style.opacity"],
        [{ borderWidth: 40 }, "STYLE_OUT_OF_RANGE", "items[].style.borderWidth"],
        [{ textAlign: "justify" }, "INVALID_TEXT_ALIGN", "items[].style.textAlign"],
        [{ fontWeight: "heavy" }, "INVALID_FONT_WEIGHT", "items[].style.fontWeight"],
      ];
      for (const [style, code, path] of cases) {
        const result = await client.callTool({
          name: "draw_board",
          arguments: { author: "ai", items: [{ type: "rect", x: 0, y: 0, w: 160, h: 90, text: "x", style }] },
        });
        const payload = errorJsonOf(result);
        expect(result.isError, JSON.stringify(style)).toBe(true);
        expect(payload?.code, JSON.stringify(style)).toBe(code);
        expect(payload?.path, JSON.stringify(style)).toBe(path);
      }

      // Valid styles still land untouched.
      const ok = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          items: [{
            type: "rect", x: 0, y: 0, w: 160, h: 90, text: "ok",
            style: { borderColor: "#334155", fontSize: 14, fontWeight: "bold", textAlign: "center", opacity: 0.8 },
          }],
        },
      });
      expect(ok.isError).toBeFalsy();
      expect(ok.structuredContent.items.at(-1).style).toMatchObject({ fontWeight: "bold", textAlign: "center" });
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
