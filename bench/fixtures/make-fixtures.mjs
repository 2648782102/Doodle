#!/usr/bin/env node
/**
 * Build a recorded run from boards the real generator produces.
 *
 * This is a fixture, not an executor: no model is called. Its job is to give the
 * report path realistic input — including the awkward cases, a rejected call
 * that the model recovered from, and one outright failure — so the report can be
 * checked before any money is spent on models.
 *
 * Run: node bench/fixtures/make-fixtures.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const dist = path.join(repoRoot, "dist/board");

const { createEmptyBoard, diagramToBoardItems, touchBoard } = await import(path.join(dist, "types.js"));
const { expandRecipe } = await import(path.join(dist, "diagram/recipe.js"));
const { makeTrace, shortHash } = await import(path.join(repoRoot, "bench/trace.mjs"));

const PROMPT_HASH = shortHash("prompt-v1");
const TOOL_HASH = shortHash("tools-v1");
const MODEL = "fixture/deterministic";

function flow(steps) {
  return touchBoard({ ...createEmptyBoard(), items: diagramToBoardItems(expandRecipe({ recipe: "flow", steps }), "ai") });
}

/** Sever one link, as a model that misread the chain might. */
function severed(board) {
  const copy = structuredClone(board);
  const line = copy.items.find((item) => item.type === "line");
  if (line) line.endItemId = undefined;
  return touchBoard(copy);
}

/** Drop a step, as a model that skipped content might. */
function without(board, label) {
  const copy = structuredClone(board);
  const target = copy.items.find((item) => (item.title || item.text) === label);
  if (!target) return copy;
  copy.items = copy.items
    .filter((item) => item.id !== target.id)
    .map((item) => {
      if (item.startItemId === target.id) delete item.startItemId;
      if (item.endItemId === target.id) delete item.endItemId;
      return item;
    });
  return touchBoard(copy);
}

const runs = [
  {
    file: "flow-order-fulfilment.json",
    trace: makeTrace({
      case: "flow/order-fulfilment",
      model: MODEL,
      prompt_hash: PROMPT_HASH,
      tool_desc_hash: TOOL_HASH,
      duration_ms: 18400,
      turns: [
        { tool: "get_board", ok: true, ms: 11, bytes: 1200 },
        { tool: "draw_board", ok: false, ms: 8, bytes: 340, error: { code: "BATCH_TOO_LARGE", path: "items" } },
        { tool: "draw_board", ok: true, ms: 34, bytes: 5200 },
        { tool: "get_board", ok: true, ms: 9, bytes: 4300 },
      ],
      final_board: flow(["下单", "校验", "拣货", "发货", "签收"]),
    }),
  },
  {
    file: "flow-review-loop.json",
    trace: makeTrace({
      case: "flow/review-loop",
      model: MODEL,
      prompt_hash: PROMPT_HASH,
      tool_desc_hash: TOOL_HASH,
      duration_ms: 9200,
      turns: [
        { tool: "get_board", ok: true, ms: 10, bytes: 900 },
        // The model drew the chain but forgot to bind the middle connector.
        { tool: "draw_board", ok: true, ms: 28, bytes: 4100 },
      ],
      final_board: severed(flow(["草稿", "反馈", "修改"])),
    }),
  },
  {
    file: "flow-onboarding.json",
    trace: makeTrace({
      case: "flow/onboarding",
      model: MODEL,
      prompt_hash: PROMPT_HASH,
      tool_desc_hash: TOOL_HASH,
      duration_ms: 7500,
      turns: [
        { tool: "get_board", ok: true, ms: 9, bytes: 880 },
        { tool: "draw_board", ok: true, ms: 22, bytes: 3600 },
      ],
      // It dropped the last stage.
      final_board: without(flow(["注册", "验证", "引导", "首次使用"]), "首次使用"),
    }),
  },
];

const outDir = path.join(here, "traces");
await fs.mkdir(outDir, { recursive: true });
for (const run of runs) {
  await fs.writeFile(path.join(outDir, run.file), `${JSON.stringify(run.trace, null, 2)}\n`, "utf8");
}
console.log(`wrote ${runs.length} fixture traces to ${path.relative(repoRoot, outDir)}`);
