import { describe, expect, it } from "vitest";
import {
  boardItemsFromExcalidrawBoard,
  boardItemsToExcalidrawSkeleton,
  boardToExcalidrawFiles,
  boardToExcalidrawInitialData,
} from "../dist/board/excalidraw-adapter.js";
import { addBoardItems, createEmptyBoard, parseBoard } from "../dist/board/types.js";

const png = "data:image/png;base64,iVBORw0KGgo=";

describe("Doodle to Excalidraw adapter", () => {
  it("keeps an unfilled shape unfilled across a round trip", () => {
    // Regression: an outline-only rectangle used to come back as a solid block.
    // `elementColor` fell back to `strokeColor` whenever `backgroundColor` was
    // `transparent`, so the stored `color` became the ink colour and the next
    // render filled the shape with it — the black box on a light board.
    const outlineOnly = {
      id: "outline", type: "rectangle", x: 10, y: 10, width: 180, height: 100, angle: 0,
      strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
      strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100,
      groupIds: [], roundness: { type: 3 }, frameId: null, boundElements: null,
      version: 1, versionNonce: 1, seed: 1, updated: 1, isDeleted: false,
    };
    const board = boardItemsFromExcalidrawBoard(createEmptyBoard(), [outlineOnly]);
    expect(board.items).toHaveLength(1);
    expect(board.items[0].color).toBe("transparent");
    // The stroke colour must still survive on the style, not be lost with it.
    expect(board.items[0].style?.borderColor).toBe("#1e1e1e");

    const back = boardItemsToExcalidrawSkeleton(board.items, "light");
    const rect = back.find((element) => element.type === "rectangle");
    expect(rect?.backgroundColor).toBe("transparent");
    expect(rect?.strokeColor).toBe("#1e1e1e");
  });

  it("still fills a shape that has a real background colour", () => {
    // The guard above must not turn every filled shape transparent.
    const filled = {
      id: "filled", type: "rectangle", x: 10, y: 10, width: 180, height: 100, angle: 0,
      strokeColor: "#1e1e1e", backgroundColor: "#f6d365", fillStyle: "solid",
      strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100,
      groupIds: [], roundness: { type: 3 }, frameId: null, boundElements: null,
      version: 1, versionNonce: 1, seed: 1, updated: 1, isDeleted: false,
    };
    const board = boardItemsFromExcalidrawBoard(createEmptyBoard(), [filled]);
    expect(board.items[0].color).toBe("#f6d365");
  });

  it("projects common Board v1 objects with official skeleton labels", () => {
    const board = addBoardItems(createEmptyBoard(), [
      { type: "rect", x: 10, y: 20, w: 180, h: 100, text: "输入", title: "开始", role: "step", variant: "card", author: "ai" },
      { type: "ellipse", x: 260, y: 20, w: 120, h: 100, text: "判断", author: "human" },
      { type: "stroke", x: 20, y: 160, w: 100, h: 40, points: [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 10 }], author: "human" },
      { type: "line", x: 190, y: 70, w: 70, h: 0, text: "下一步", startItemId: "item_a", endItemId: "item_b", author: "ai" },
    ]);
    const skeletons = boardItemsToExcalidrawSkeleton(board.items);
    expect(skeletons.map((element) => element.type)).toEqual([
      "rectangle", "text", "ellipse", "text", "freedraw", "arrow",
    ]);
    expect(skeletons[0].id).toBe(board.items[0].id);
    expect(skeletons[1]).toMatchObject({ containerId: board.items[0].id, text: "开始\n输入", x: 100, y: 70, width: 164, height: 84, verticalAlign: "middle" });
    const standalone = boardItemsToExcalidrawSkeleton([{
      id: "standalone", type: "text", x: 20, y: 40, w: 200, h: 32,
      text: "独立文字", color: "#ffffff", author: "ai",
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    }]);
    expect(standalone[0]).toMatchObject({ type: "text", verticalAlign: "top" });
    expect(skeletons[0].customData?.doodle).toMatchObject({ role: "step", variant: "card", author: "ai" });
    expect(skeletons[4].points).toHaveLength(3);
    expect(skeletons[5]).toMatchObject({ start: { id: "item_a" }, end: { id: "item_b" }, label: { text: "下一步" } });
    const roundTrip = boardItemsFromExcalidrawBoard(board, skeletons.map((skeleton, index) => ({
      ...skeleton,
      x: skeleton.x,
      y: skeleton.y,
      width: skeleton.width ?? 100,
      height: skeleton.height ?? 60,
      customData: index === 0 ? skeleton.customData : undefined,
    })));
    expect(roundTrip.items[0]).toMatchObject({ id: board.items[0].id, title: "开始", text: "输入", x: 10, y: 20 });
    const initial = boardToExcalidrawInitialData(board);
    expect(initial.elements).toHaveLength(6);
    expect(initial.files).toEqual({});
  });

  it("folds bound text back into one Board v1 object", () => {
    const board = createEmptyBoard();
    const elements = [
      { id: "ex_rect", type: "rectangle", x: 5, y: 10, width: 100, height: 60, backgroundColor: "#f6d365", groupIds: ["group_a"], customData: { doodle: { author: "ai", role: "step", z: 2 } }, boundElements: [{ type: "text", id: "ex_rect_text" }] },
      { id: "ex_rect_text", type: "text", x: 13, y: 18, width: 84, height: 44, text: "标题\n正文", originalText: "标题\n正文", containerId: "ex_rect", fontSize: 16, fontFamily: 3 },
      { id: "ex_draw", type: "freedraw", x: 0, y: 100, width: 30, height: 20, points: [[0, 0], [10, 20], [30, 5]], strokeColor: "#1f2937" },
      { id: "ex_arrow", type: "arrow", x: 100, y: 100, width: 80, height: 0, points: [[0, 0], [80, 0]], text: "next", startBinding: { elementId: "ex_rect" }, endBinding: { elementId: "ex_draw" } },
    ];
    const projected = boardItemsFromExcalidrawBoard(board, elements);
    expect(projected.items).toHaveLength(3);
    expect(() => parseBoard(projected)).not.toThrow();
    expect(projected.items[0]).toMatchObject({ id: "ex_rect", title: "标题", text: "正文", groupId: "group_a", role: "step", z: 2 });
    expect(projected.items[0].scene).toMatchObject({ element: { id: "ex_rect" }, boundText: { id: "ex_rect_text" } });
    expect(projected.items[1]).toMatchObject({ id: "ex_draw", type: "stroke" });
    expect(projected.items[2]).toMatchObject({ id: "ex_arrow", type: "line", startItemId: "ex_rect", endItemId: "ex_draw" });
  });

  it("keeps image file data and scene fidelity inside version 1 state", () => {
    const board = addBoardItems(createEmptyBoard(), [
      {
        type: "image", x: 0, y: 0, w: 120, h: 80, text: "截图", src: png,
        mime: "image/png", author: "human",
        scene: { fileId: "file_1", fileMime: "image/png", fileCreated: 123 },
      },
    ]);
    expect(() => parseBoard(JSON.parse(JSON.stringify(board)))).not.toThrow();
    const files = boardToExcalidrawFiles(board);
    expect(files.file_1).toMatchObject({ id: "file_1", mimeType: "image/png", dataURL: png, created: 123 });
    const elements = [
      { id: board.items[0].id, type: "image", x: 0, y: 0, width: 120, height: 80, fileId: "file_1", backgroundColor: "transparent" },
    ];
    const projected = boardItemsFromExcalidrawBoard(board, elements, files);
    expect(projected.items[0]).toMatchObject({ src: png, mime: "image/png" });
    expect(projected.items[0].scene).toMatchObject({ fileId: "file_1", fileMime: "image/png", fileCreated: 123 });
  });

  it("keeps a short text element inside the stored size floor", () => {
    // A single line of Excalidraw text measures ~15px tall. Writing that
    // verbatim failed the whole board write (the server requires 16px), so one
    // new label erased everything the person had just drawn.
    const board = createEmptyBoard();
    const projected = boardItemsFromExcalidrawBoard(board, [
      { id: "tiny", type: "text", x: 10, y: 10, width: 48, height: 15, text: "小" },
    ]);
    expect(projected.items[0].h).toBeGreaterThanOrEqual(16);
    expect(() => parseBoard(JSON.parse(JSON.stringify(projected)))).not.toThrow();
  });

  it("does not shrink a text box to its glyphs on the way back", () => {
    // Excalidraw re-measures text from its content, so a centred caption stored
    // at the card's width came back as the width of its two characters, and the
    // caption drifted left. The stored box must survive the round trip.
    const board = addBoardItems(createEmptyBoard(), [
      { type: "rect", id: "card", x: 40, y: 120, w: 190, h: 90, text: "开始", author: "ai" },
    ]);
    const withCaption = addBoardItems(board, [
      { type: "text", id: "cap", x: 40, y: 216, w: 190, h: 16, text: "需求冻结", author: "ai", style: { textAlign: "center" } },
    ]);
    const projected = boardItemsFromExcalidrawBoard(withCaption, [
      { id: "card", type: "rectangle", x: 40, y: 120, width: 190, height: 90 },
      // Excalidraw reports the shrunk width and nudged x for a text element.
      { id: "cap", type: "text", x: 16, y: 216, width: 48, height: 16, text: "需求冻结" },
    ]);
    const caption = projected.items.find((item) => item.id === "cap");

    expect(caption.w).toBe(190);
    expect(caption.x).toBe(40);
  });

  it("produces a board the server accepts after a human edit", () => {
    // End-to-end guard for the "drawing disappears" regression: project a real
    // scene and parse it the way `/api/board/replace` does.
    const board = createEmptyBoard();
    const projected = boardItemsFromExcalidrawBoard(board, [
      { id: "r1", type: "rectangle", x: 40, y: 40, width: 190, height: 90 },
      { id: "t1", type: "text", x: 60, y: 150, width: 48, height: 15, text: "需求冻结" },
      { id: "l1", type: "arrow", x: 20, y: 20, width: 0, height: 0, points: [[0, 0], [80, 40]] },
    ]);
    expect(projected.items.map((item) => item.type)).toEqual(["rect", "text", "line"]);
    expect(() => parseBoard(JSON.parse(JSON.stringify(projected)))).not.toThrow();
  });
});

describe("degenerate canvas elements", () => {
  /*
   * A click without a drag left a zero-size shape, which the stored size floor
   * clamped to 16x16 and persisted. Reported as a stray small rectangle
   * appearing during a normal first use.
   */
  it("drops a click that never became a drag", () => {
    const board = boardItemsFromExcalidrawBoard(createEmptyBoard(), [
      { id: "ghost", type: "rectangle", x: 120, y: 120, width: 0, height: 0 },
      { id: "real", type: "rectangle", x: 40, y: 40, width: 190, height: 90 },
    ]);
    expect(board.items.map((item) => item.id)).toEqual(["real"]);
  });

  it("keeps shapes whose extent is at or above the floor", () => {
    const board = boardItemsFromExcalidrawBoard(createEmptyBoard(), [
      { id: "small", type: "rectangle", x: 10, y: 10, width: 16, height: 16 },
      { id: "flat", type: "rectangle", x: 10, y: 60, width: 300, height: 1 },
    ]);
    expect(board.items.map((item) => item.id)).toEqual(["small", "flat"]);
  });

  it("keeps a perfectly horizontal or vertical arrow", () => {
    // `h === 0` is a real horizontal arrow, not a degenerate element.
    const board = boardItemsFromExcalidrawBoard(createEmptyBoard(), [
      { id: "h", type: "arrow", x: 0, y: 0, width: 120, height: 0, points: [[0, 0], [120, 0]] },
      { id: "v", type: "arrow", x: 0, y: 0, width: 0, height: 120, points: [[0, 0], [0, 120]] },
      { id: "dot", type: "arrow", x: 0, y: 0, width: 0, height: 0, points: [[0, 0], [0, 0]] },
    ]);
    expect(board.items.map((item) => item.id)).toEqual(["h", "v"]);
  });

  it("drops a freedraw that only registered one point", () => {
    const board = boardItemsFromExcalidrawBoard(createEmptyBoard(), [
      { id: "tap", type: "freedraw", x: 5, y: 5, width: 0, height: 0, points: [[0, 0]] },
      { id: "ink", type: "freedraw", x: 5, y: 5, width: 40, height: 10, points: [[0, 0], [20, 5], [40, 10]] },
    ]);
    expect(board.items.map((item) => item.id)).toEqual(["ink"]);
  });

  it("keeps an arrow whose bound shape was dropped, minus the dangling endpoint", () => {
    const board = boardItemsFromExcalidrawBoard(createEmptyBoard(), [
      { id: "ghost", type: "rectangle", x: 0, y: 0, width: 0, height: 0 },
      {
        id: "arrow", type: "arrow", x: 0, y: 0, width: 80, height: 0, points: [[0, 0], [80, 0]],
        startBinding: { elementId: "ghost" }, endBinding: { elementId: "ghost" },
      },
    ]);
    expect(board.items).toHaveLength(1);
    expect(board.items[0].id).toBe("arrow");
    expect(board.items[0].startItemId).toBeUndefined();
    expect(board.items[0].endItemId).toBeUndefined();
    expect(() => parseBoard(JSON.parse(JSON.stringify(board)))).not.toThrow();
  });
});
