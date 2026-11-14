import { describe, expect, it } from "vitest";
import {
  boardItemsFromExcalidrawBoard,
  boardItemsToExcalidrawSkeleton,
  boardToExcalidrawInitialData,
} from "../dist/board/excalidraw-adapter.js";
import { addBoardItems, createEmptyBoard, parseBoard } from "../dist/board/types.js";

describe("Doodle to Excalidraw adapter", () => {
  it("projects common Board v1 objects into stable Excalidraw skeletons", () => {
    const board = addBoardItems(createEmptyBoard(), [
      { type: "rect", x: 10, y: 20, w: 180, h: 100, text: "输入", title: "开始", role: "step", variant: "card", author: "ai" },
      { type: "ellipse", x: 260, y: 20, w: 120, h: 100, text: "判断", author: "human" },
      { type: "stroke", x: 20, y: 160, w: 100, h: 40, points: [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 10 }], author: "human" },
      { type: "line", x: 190, y: 70, w: 70, h: 0, text: "下一步", startItemId: "item_a", endItemId: "item_b", author: "ai" },
    ]);
    const skeletons = boardItemsToExcalidrawSkeleton(board.items);
    expect(skeletons.map((element) => element.type)).toEqual(["rectangle", "ellipse", "freedraw", "arrow"]);
    expect(skeletons[0].id).toBe(board.items[0].id);
    expect(skeletons[0].label?.text).toContain("开始");
    expect(skeletons[0].customData?.doodle).toMatchObject({ role: "step", variant: "card", author: "ai" });
    expect(skeletons[2].points).toHaveLength(3);
    expect(skeletons[3]).toMatchObject({ start: { id: "item_a" }, end: { id: "item_b" } });
    const initial = boardToExcalidrawInitialData(board);
    expect(initial.elements).toHaveLength(4);
  });

  it("projects common Excalidraw elements back into valid Board v1 objects", () => {
    const board = createEmptyBoard();
    const projected = boardItemsFromExcalidrawBoard(board, [
      {
        id: "ex_rect", type: "rectangle", x: 5, y: 10, width: 100, height: 60,
        backgroundColor: "#f6d365", text: "标题\n正文", groupIds: ["group_a"],
        customData: { doodle: { author: "ai", role: "step", z: 2 } }, roundness: { type: 3 },
      },
      {
        id: "ex_draw", type: "freedraw", x: 0, y: 100, width: 30, height: 20,
        points: [[0, 0], [10, 20], [30, 5]], strokeColor: "#1f2937",
      },
      {
        id: "ex_arrow", type: "arrow", x: 100, y: 100, width: 80, height: 0,
        points: [[0, 0], [80, 0]], text: "next", startBinding: { elementId: "ex_rect" }, endBinding: { elementId: "ex_draw" },
      },
    ]);
    expect(() => parseBoard(projected)).not.toThrow();
    expect(projected.items[0]).toMatchObject({ id: "ex_rect", title: "标题", text: "正文", groupId: "group_a", role: "step", z: 2 });
    expect(projected.items[1]).toMatchObject({ id: "ex_draw", type: "stroke" });
    expect(projected.items[1].points).toHaveLength(3);
    expect(projected.items[2]).toMatchObject({ id: "ex_arrow", type: "line", startItemId: "ex_rect", endItemId: "ex_draw" });
  });
});
