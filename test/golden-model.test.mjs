/**
 * Golden model test.
 *
 * The board model is the contract every surface depends on: MCP tools, the HTTP
 * API, the canvas adapter, and the agent projection all read the same objects.
 * A refactor that keeps types compiling can still change a coordinate, a
 * default, or a label order.
 *
 * This test freezes that contract. It exercises every public model entry point
 * and compares against a committed snapshot, so an intended change shows up as
 * a reviewable diff instead of an undetected drift.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  addBoardItems,
  addBoardNote,
  boardCopyText,
  boardVisualDigest,
  createEmptyBoard,
  diagramToBoardItems,
  layoutBoardItems,
} from "../dist/board/types.js";
import { boardAgentView } from "../dist/board/view/agent-view.js";
import {
  boardItemsFromExcalidrawBoard,
  boardItemsToExcalidrawSkeleton,
} from "../dist/board/excalidraw-adapter.js";

/** Generated ids and timestamps vary per run; only structure is compared. */
function stable(value) {
  const json = JSON.stringify(value, (key, entry) => {
    if (["id", "createdAt", "updatedAt", "generatedAt", "revision"].includes(key)) return undefined;
    if (typeof entry === "string") {
      return entry
        .replace(/\b(item|board|note)_[a-z0-9]{5,}_[a-z0-9]+/g, "$1_GEN")
        .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "TIMESTAMP");
    }
    return entry;
  });
  return createHash("sha256").update(json).digest("hex");
}

function sampleBoard() {
  let board = createEmptyBoard();
  board = addBoardItems(board, [
    { type: "rect", x: 10, y: 20, w: 180, h: 100, text: "输入", title: "开始", role: "step", variant: "card", author: "ai" },
    { type: "ellipse", x: 260, y: 20, w: 120, h: 100, text: "判断", author: "human" },
    { type: "stroke", x: 20, y: 160, w: 100, h: 40, points: [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 10 }], author: "human" },
    { type: "text", x: 20, y: 240, w: 200, h: 32, text: "独立文字", author: "ai" },
  ]);
  const [first, second] = board.items;
  board = addBoardItems(board, [
    { type: "line", x: 190, y: 70, w: 70, h: 0, text: "下一步", startItemId: first.id, endItemId: second.id, author: "ai" },
  ]);
  return addBoardNote(board, { body: "hello", author: "human" });
}

describe("board model golden contract", () => {
  it("produces stable projections for a representative board", () => {
    const board = sampleBoard();
    const fingerprint = {
      digest: stable(boardVisualDigest(board)),
      agentView: stable(boardAgentView(board)),
      skeleton: stable(boardItemsToExcalidrawSkeleton(board.items)),
      roundTrip: stable(boardItemsFromExcalidrawBoard(board, boardItemsToExcalidrawSkeleton(board.items))),
      copyText: stable(boardCopyText(board)),
    };

    // One hash per projection. If a change is intentional, update these values
    // in the same commit so the diff documents the new contract.
    expect(fingerprint).toMatchSnapshot();
  });

  it("lays out every arrangement mode deterministically", () => {
    const board = sampleBoard();
    const positions = {};
    for (const mode of ["grid", "row", "column", "timeline", "cluster", "architecture"]) {
      positions[mode] = layoutBoardItems(board, { mode, origin: { x: 0, y: 0 } }, "ai")
        .items.map((item) => [item.type, item.x, item.y]);
    }
    expect(positions).toMatchSnapshot();
  });

  it("generates every diagram mode deterministically", () => {
    const output = {};
    for (const mode of ["flow", "timeline", "compare", "matrix"]) {
      const nodes = Array.from({ length: 7 }, (_, index) => ({
        id: `n${index}`,
        label: `S${index}`,
        ...(mode === "matrix" ? { column: index % 3, row: Math.floor(index / 3) } : {}),
        ...(mode === "compare" ? { column: index % 2 } : {}),
        ...(mode === "timeline" ? { column: 0, row: index } : {}),
      }));
      const edges = nodes.slice(1).map((node, index) => ({ from: `n${index}`, to: node.id, label: `e${index}` }));
      output[mode] = diagramToBoardItems({ mode, nodes, edges })
        .map((item) => [item.type, item.x, item.y, item.w, item.h, item.startItemId ?? null, item.endItemId ?? null]);
    }
    expect(output).toMatchSnapshot();
  });

  it("keeps a long flow narrow and fully connected", () => {
    // The property that regressed twice: a 16-step chain must not become one
    // wide strip, and must not silently drop edges.
    const nodes = Array.from({ length: 16 }, (_, index) => ({ id: `n${index}`, label: `S${index + 1}` }));
    const edges = Array.from({ length: 15 }, (_, index) => ({ from: `n${index}`, to: `n${index + 1}` }));
    const items = diagramToBoardItems({ mode: "flow", nodes, edges });
    const cards = items.filter((item) => item.role === "step");
    const xs = cards.map((item) => item.x);

    expect(items.filter((item) => item.type === "line")).toHaveLength(15);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(6 * 260);
  });

  it("packs a long flow into full passes instead of drifting down the page", () => {
    // A snaked pass owns its row. The row counter used to add the pass index on
    // top of the running column count, so each pass pushed the base further
    // down: an 18-step chain (three passes of six) laid out as eight rows and a
    // 48-step chain as thirty-eight — 14,740px of height, past any usable
    // canvas. Packing within a pass is what the snake is supposed to draw.
    const rowsFor = (count) => {
      const nodes = Array.from({ length: count }, (_, index) => ({ id: `n${index}`, label: `S${index}` }));
      const edges = Array.from({ length: count - 1 }, (_, index) => ({ from: `n${index}`, to: `n${index + 1}` }));
      const cards = diagramToBoardItems({ mode: "flow", nodes, edges }).filter((item) => item.role === "step");
      return new Set(cards.map((item) => item.y)).size;
    };

    // Six columns per pass, so the row count is ceil(n / 6).
    expect(rowsFor(12)).toBe(2);
    expect(rowsFor(18)).toBe(3);
    expect(rowsFor(24)).toBe(4);
    expect(rowsFor(48)).toBe(8);
  });
});
