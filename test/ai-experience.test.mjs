import { describe, expect, it } from "vitest";
import {
  addBoardItems,
  createEmptyBoard,
  diagnoseBoard,
  diagramToBoardItems,
} from "../dist/board/types.js";
import { expandRecipe } from "../dist/board/diagram/recipe.js";
import { changeReport, changeReportText } from "../dist/board/mcp/change-report.js";
import { errorResult } from "../dist/board/mcp/presentation.js";
import { BoardValidationError } from "../dist/board/errors.js";

describe("AI experience contract", () => {
  it("diagnoses isolated nodes, overlaps, focus and free space", () => {
    let board = createEmptyBoard();
    board = addBoardItems(board, [
      { type: "rect", id: "a", x: 40, y: 40, w: 100, h: 60, text: "A", author: "ai" },
      { type: "rect", id: "b", x: 60, y: 60, w: 100, h: 60, text: "B", author: "human", emphasis: "focus" },
      { type: "rect", id: "c", x: 400, y: 40, w: 100, h: 60, text: "C", author: "ai" },
    ]);
    const report = diagnoseBoard(board);

    expect(report.isolated.map((item) => item.id)).toEqual(expect.arrayContaining(["a", "b", "c"]));
    expect(report.overlapping.some((pair) => pair.a.id === "a" && pair.b.id === "b")).toBe(true);
    expect(report.focus.map((item) => item.id)).toContain("b");
    expect(report.freeSpace.below.y).toBeGreaterThan(report.bounds.maxY);
  });

  it("expands a review recipe into connected steps", () => {
    const expanded = expandRecipe({ recipe: "review", steps: ["需求"] });
    expect(expanded.mode).toBe("flow");
    expect(expanded.nodes.map((node) => node.label)).toEqual(["需求", "收集反馈", "修订并完成"]);
    expect(expanded.edges).toHaveLength(2);
    const items = diagramToBoardItems(expanded);
    expect(items.filter((item) => item.type === "line")).toHaveLength(2);
  });

  it("expands a decision recipe with options converging on an outcome", () => {
    const expanded = expandRecipe({
      recipe: "decision",
      steps: ["背景", "选择方案"],
      options: ["自建", "开源"],
    });
    expect(expanded.nodes.some((node) => node.role === "decision")).toBe(true);
    expect(expanded.nodes.some((node) => node.emphasis === "focus")).toBe(true);
    expect(expanded.edges).toHaveLength(3);
  });

  it("returns a readable change report", () => {
    const before = createEmptyBoard();
    const after = addBoardItems(before, [
      { type: "note", x: 10, y: 10, w: 100, h: 60, text: "决定" },
    ]);
    const report = changeReport(before, after);

    expect(report.added).toHaveLength(1);
    expect(changeReportText(report)).toContain("CHANGE_JSON");
  });

  it("returns repairable error JSON", () => {
    const result = errorResult("draw_board", new BoardValidationError(
      "Item color must be a six-digit hex value",
      "INVALID_COLOR",
      "items[].color",
      "#rrggbb",
      "Use a six-digit hex value.",
    ));
    const text = result.content[0].text;
    expect(text).toContain("ERROR_JSON");
    expect(text).toContain('"path": "items[].color"');
    expect(text).toContain('"fix"');
  });
});

describe("generated diagram frame", () => {
  /*
   * The frame used to reserve a whole extra row at the bottom: `maxRows` counts
   * rows per column and the formula read it as a row index, and detail captions
   * that hang below the last card were never included. Measured margins were
   * 20 / 12 / 20 / 200.
   */
  it("hugs its content on all four sides", () => {
    const expanded = expandRecipe({
      title: "Frame fit",
      nodes: [
        { id: "a", label: "A", detail: "first", column: 0, row: 0 },
        { id: "b", label: "B", detail: "second", column: 0, row: 1 },
        { id: "c", label: "C", detail: "third", column: 1, row: 0 },
      ],
      edges: [{ from: "a", to: "c" }],
    });
    const items = diagramToBoardItems(expanded);
    const frame = items.find((item) => item.id === "diagram_frame");
    const content = items.filter((item) => item !== frame);

    const left = Math.min(...content.map((item) => item.x));
    const top = Math.min(...content.map((item) => item.y));
    const right = Math.max(...content.map((item) => item.x + item.w));
    const bottom = Math.max(...content.map((item) => item.y + item.h));

    expect(left - frame.x).toBe(20);
    expect(top - frame.y).toBe(12);
    expect(frame.x + frame.w - right).toBe(20);
    expect(frame.y + frame.h - bottom).toBe(20);
  });
});
