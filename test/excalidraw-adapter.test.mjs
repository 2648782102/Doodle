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
    /*
     * The label is folded into `title`/`text`; the Excalidraw text element is
     * not stored. It was ~half the item's scene bytes and nothing read it back
     * — the canvas rebuilds the label from the board object — so keeping it
     * duplicated data the board already had. Rendering is unchanged, which the
     * round-trip below pins.
     */
    expect(projected.items[0].scene).toMatchObject({ element: { id: "ex_rect" } });
    expect(projected.items[0].scene).not.toHaveProperty("boundText");
    const rebuilt = boardItemsToExcalidrawSkeleton(projected.items, "light");
    const label = rebuilt.find((element) => element.id === "ex_rect_text");
    expect(label).toMatchObject({ type: "text", containerId: "ex_rect", text: "标题\n正文" });
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

  it("allows dragging an existing text element horizontally without snapping back", () => {
    const board = addBoardItems(createEmptyBoard(), [
      {
        type: "text", id: "cap", x: 40, y: 216, w: 190, h: 16, text: "需求冻结", author: "ai",
        style: { textAlign: "center" },
        scene: { element: { id: "cap", type: "text", x: 111, y: 216, width: 48, height: 16 } },
      },
    ]);
    const dragged = boardItemsFromExcalidrawBoard(board, [
      { id: "cap", type: "text", x: 311, y: 216, width: 48, height: 16, text: "需求冻结" },
    ]);
    expect(dragged.items[0].x).toBe(240);
  });

  it("preserves server-assigned item ids via scene.element.id mapping on subsequent edits", () => {
    const serverBoard = addBoardItems(createEmptyBoard(), [
      {
        type: "rect", id: "item_server_1", x: 10, y: 10, w: 120, h: 60, text: "新框", author: "human",
        scene: { element: { id: "excalidraw_local_1", type: "rectangle", x: 10, y: 10, width: 120, height: 60 } },
      },
    ]);
    const moved = boardItemsFromExcalidrawBoard(serverBoard, [
      { id: "excalidraw_local_1", type: "rectangle", x: 150, y: 40, width: 120, height: 60 },
      {
        id: "excalidraw_arrow_1", type: "arrow", x: 150, y: 70, width: 80, height: 0,
        points: [[0, 0], [80, 0]], startBinding: { elementId: "excalidraw_local_1" },
      },
    ]);
    expect(moved.items[0].id).toBe("item_server_1");
    expect(moved.items[0].x).toBe(150);
    expect(moved.items[1].startItemId).toBe("item_server_1");
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

describe("projection timestamps", () => {
  /*
   * The canvas skips a save when its projection equals the board it already
   * has. That comparison could never succeed while every projection stamped a
   * fresh `updatedAt` on every object, so every pointer move rewrote the whole
   * document.
   */
  it("keeps updatedAt when nothing about the object changed", () => {
    const stamp = "2020-01-01T00:00:00.000Z";
    const first = boardItemsFromExcalidrawBoard(createEmptyBoard(), [
      { id: "r1", type: "rectangle", x: 40, y: 40, width: 190, height: 90 },
    ]);
    first.items[0].updatedAt = stamp;

    const second = boardItemsFromExcalidrawBoard(first, [
      { id: "r1", type: "rectangle", x: 40, y: 40, width: 190, height: 90 },
    ]);

    expect(second.items[0].updatedAt).toBe(stamp);
    expect(JSON.stringify(second.items)).toBe(JSON.stringify(first.items));
  });

  it("stamps updatedAt when the object actually moved", () => {
    const stamp = "2020-01-01T00:00:00.000Z";
    const first = boardItemsFromExcalidrawBoard(createEmptyBoard(), [
      { id: "r1", type: "rectangle", x: 40, y: 40, width: 190, height: 90 },
    ]);
    first.items[0].updatedAt = stamp;

    const second = boardItemsFromExcalidrawBoard(first, [
      { id: "r1", type: "rectangle", x: 60, y: 40, width: 190, height: 90 },
    ]);

    expect(second.items[0].updatedAt).not.toBe(stamp);
  });
});

describe("standalone text placement", () => {
  /*
   * `convertToExcalidrawElements` reads `x` as the centre of the run once the
   * text is not left-aligned, while Board v1 stores the box's left edge. Passing
   * the edge shifted every caption left by half its measured width: a caption
   * under a card sat over the card's border and the leftmost column's captions
   * escaped the diagram frame.
   */
  it("gives a centred caption the box centre, not its left edge", () => {
    const board = createEmptyBoard();
    const items = [
      { id: "a", type: "text", x: 40, y: 0, w: 190, h: 24, text: "centred", color: "#ffffff", style: { fontSize: 12, textAlign: "center" } },
      { id: "b", type: "text", x: 40, y: 40, w: 190, h: 24, text: "left", color: "#ffffff", style: { fontSize: 12, textAlign: "left" } },
    ];
    const skeleton = boardItemsToExcalidrawSkeleton(items, "light");
    expect(skeleton.find((element) => element.id === "a").x).toBe(135);
    expect(skeleton.find((element) => element.id === "b").x).toBe(40);
    expect(board.items).toHaveLength(0);
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

describe("freehand ink", () => {
  const stroke = (color) => ({
    id: "ink", type: "stroke", x: 0, y: 0, w: 120, h: 60, color,
    author: "ai",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    points: [{ x: 0, y: 60 }, { x: 60, y: 0 }, { x: 120, y: 60 }],
  });

  /*
   * A brush stroke paints with the colour it was given.
   *
   * It used to fall through to the theme ink, so every freehand colour rendered
   * as `#1f2937` on a light page: the person picked red, drew, and watched
   * black appear. The board stored the right value and nothing rejected the
   * write, so only the rendered pixels were wrong — which is exactly the kind of
   * defect a round-trip assertion misses and a colour assertion catches.
   */
  it("renders the stored colour as the stroke colour", () => {
    const [light] = boardItemsToExcalidrawSkeleton([stroke("#e04a4a")], "light");
    expect(light.strokeColor).toBe("#e04a4a");
    // Freehand is never filled, whatever the colour.
    expect(light.backgroundColor).toBe("transparent");
  });

  it("still replaces an ink the page cannot show", () => {
    // The readability floor is not waived: near-white on a light page is
    // unreadable, so the theme ink takes over rather than painting nothing.
    const [light] = boardItemsToExcalidrawSkeleton([stroke("#ffffff")], "light");
    expect(light.strokeColor).not.toBe("#ffffff");
    const [dark] = boardItemsToExcalidrawSkeleton([stroke("#ffffff")], "dark");
    expect(dark.strokeColor).toBe("#ffffff");
  });

  /*
   * A freedraw element has to declare how pressure is derived.
   *
   * Excalidraw's stroke projection indexes `pressures` per point unless
   * `simulatePressure` is set, and the skeleton set neither. The first brush
   * stroke therefore threw inside the renderer and the entire scene painted
   * blank — every rectangle on the board with it — while the stored board was
   * perfectly valid. Asserting the field is what turns a blank canvas into a
   * failing test.
   */
  it("declares simulated pressure so the stroke projection can run", () => {
    const [element] = boardItemsToExcalidrawSkeleton([stroke("#e04a4a")], "light");
    expect(element.simulatePressure).toBe(true);
  });
});

describe("camera and change detection", () => {
  const brush = (color) => ({
    id: "ink", type: "stroke", x: 0, y: 0, w: 120, h: 60, color,
    author: "ai",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    points: [{ x: 0, y: 60 }, { x: 60, y: 0 }, { x: 120, y: 60 }],
  });

  /*
   * A brush stroke drawn on the canvas must keep its ink in `color`.
   *
   * `elementColor` reads "no background" as "this is an outline, remember
   * transparent" — correct for a shape, wrong for a stroke. A person drew,
   * the saved board re-projected the ink as transparent, and the stroke
   * disappeared a moment later. The canvas passing its own scene through this
   * adapter is exactly the path that lost it.
   */
  it("keeps a freehand stroke's ink when the canvas writes it back", () => {
    const drawn = {
      id: "brush", type: "freedraw", x: 120, y: 90, width: 260, height: 140,
      angle: 0, strokeColor: "#c62828", backgroundColor: "transparent", strokeWidth: 3,
      strokeStyle: "solid", roughness: 1, roundness: null, opacity: 100, fontSize: 16,
      fontFamily: 3, textAlign: "center", groupIds: [],
      points: [[0, 140], [52, 12], [104, 130], [156, 4], [208, 120], [260, 30]],
      pressures: [], simulatePressure: true,
      customData: { doodle: { author: "human" } },
    };
    const [item] = boardItemsFromExcalidrawBoard(createEmptyBoard("rt"), [drawn]).items;
    expect(item.color).toBe("#c62828");
    // And the stored item still paints that ink after a reload.
    const [reprojected] = boardItemsToExcalidrawSkeleton([item], "light");
    expect(reprojected.strokeColor).toBe("#c62828");
  });

  /*
   * Projecting a stored board must not look like an edit.
   *
   * Excalidraw materialises `angle`, `fillStyle`, `frameId`, `boundElements`,
   * `link`, `locked` and `lastCommittedPoint`. A skeleton that omits them
   * produced a scene differing from the stored snapshot on every read, so each
   * reload wrote the board back and bumped the revision for a change nobody
   * made. Declaring the defaults is what makes read -> write -> read a no-op.
   */
  it("declares the scene fields Excalidraw would otherwise invent", () => {
    const [element] = boardItemsToExcalidrawSkeleton([brush("#e04a4a")], "light");
    expect(element).toMatchObject({
      angle: 0,
      fillStyle: "solid",
      frameId: null,
      boundElements: [],
      link: null,
      locked: false,
      lastCommittedPoint: null,
    });
    const [item] = boardItemsFromExcalidrawBoard(createEmptyBoard("fields"), [{
      ...element, id: "fields", type: "freedraw", x: 0, y: 0, width: 40, height: 40,
      strokeColor: "#e04a4a", backgroundColor: "transparent", opacity: 100,
      points: [[0, 40], [20, 0], [40, 40]],
    }]).items;
    const [again] = boardItemsToExcalidrawSkeleton([item], "light");
    for (const field of ["angle", "frameId", "link", "locked", "lastCommittedPoint"]) {
      expect(again[field]).toEqual(element[field]);
    }
  });
});
