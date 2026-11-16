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
