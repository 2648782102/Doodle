/**
 * The read-only SVG projection and the `CanvasEngine` seam.
 *
 * Both exist for readers who are not the browser: an agent, a README, a CI job.
 * Neither may become a second persisted format, so the assertions are about
 * purity (same board, same bytes), coverage (every item type renders), and the
 * seam (the one engine satisfies the interface, an unknown id does not).
 */

import { describe, expect, it } from "vitest";
import { boardToSvg } from "../dist/board/svg/render.js";
import { canvasEngineById, excalidrawEngine } from "../dist/board/canvas/engine.js";
import { addBoardItems, createEmptyBoard } from "../dist/board/types.js";

function sampleBoard() {
  let board = createEmptyBoard("Sample");
  board = addBoardItems(board, [
    { type: "rect", x: 40, y: 40, w: 200, h: 90, text: "MCP 工具面", color: "#a5d8ff", role: "step" },
    { type: "ellipse", x: 320, y: 40, w: 180, h: 90, text: "持久化", color: "#ffec99" },
    { type: "line", x: 240, y: 85, w: 80, h: 0, text: "call" },
    { type: "text", x: 40, y: 180, w: 300, h: 30, text: "只读投影" },
    { type: "stroke", x: 40, y: 240, w: 60, h: 40, points: [{ x: 0, y: 0 }, { x: 60, y: 40 }] },
  ]);
  return board;
}

describe("Board v1 → SVG", () => {
  it("renders every item type the board can hold", () => {
    const svg = boardToSvg(sampleBoard());

    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    // One element per item type that has geometry.
    expect(svg).toContain("<rect");
    expect(svg).toContain("<ellipse");
    expect(svg).toContain("<path");
    expect(svg).toContain("<text");
    // CJK survives the round trip into markup.
    expect(svg).toContain("MCP 工具面");
    expect(svg).toContain("持久化");
  });

  it("is pure: the same board produces the same bytes", () => {
    const board = sampleBoard();
    expect(boardToSvg(board)).toBe(boardToSvg(board));
  });

  it("gives a connector label a plate so the arrow does not cut it", () => {
    // First render had "call" sliced through by the stroke; the plate is what
    // makes the text readable, and it is easy to lose in a refactor.
    const svg = boardToSvg(sampleBoard());
    const labelAt = svg.indexOf("call");
    const plateBefore = svg.lastIndexOf("<rect", labelAt);
    expect(labelAt).toBeGreaterThan(-1);
    expect(plateBefore).toBeGreaterThan(-1);
    expect(svg.slice(plateBefore, labelAt)).toContain('fill="#ffffff"');
  });

  it("escapes text rather than emitting raw markup", () => {
    let board = createEmptyBoard("xss");
    board = addBoardItems(board, [
      { type: "note", x: 0, y: 0, w: 160, h: 80, text: '<script>alert("x")</script>' },
    ]);
    const svg = boardToSvg(board);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("paints a freehand stroke with the colour it stores", () => {
    /*
     * Width and colour are independent. The projection used to read
     * `style.strokeWidth ? borderInk : item.color`, so giving a brush stroke an
     * explicit width swapped its colour for the default ink: the canvas showed
     * red and the exported SVG black.
     */
    let board = createEmptyBoard("ink");
    board = addBoardItems(board, [
      {
        type: "stroke", x: 0, y: 0, w: 120, h: 60, color: "#e04a4a",
        points: [{ x: 0, y: 60 }, { x: 60, y: 0 }, { x: 120, y: 60 }],
      },
    ]);
    expect(boardToSvg(board)).toContain('stroke="#e04a4a"');

    let weighted = createEmptyBoard("ink-weight");
    weighted = addBoardItems(weighted, [
      {
        type: "stroke", x: 0, y: 0, w: 120, h: 60, color: "#e04a4a",
        style: { strokeWidth: 6 },
        points: [{ x: 0, y: 60 }, { x: 60, y: 0 }, { x: 120, y: 60 }],
      },
    ]);
    expect(boardToSvg(weighted)).toContain('stroke="#e04a4a" stroke-width="6"');
  });

  it("honours maxSize without distorting the aspect ratio", () => {
    const wide = boardToSvg(sampleBoard(), { maxSize: 400 });
    const width = Number(wide.match(/width="(\d+)"/)?.[1]);
    const height = Number(wide.match(/height="(\d+)"/)?.[1]);
    expect(width).toBeLessThanOrEqual(420);
    expect(height).toBeGreaterThan(0);
    // The viewBox keeps board units, so the scale is uniform.
    const box = wide.match(/viewBox="([^"]+)"/)?.[1].split(" ").map(Number);
    expect(box).toHaveLength(4);
    expect(Math.abs(box[2] / box[3] - width / height)).toBeLessThan(0.05);
  });
});

describe("CanvasEngine seam", () => {
  it("resolves the engine the capability block advertises", () => {
    expect(canvasEngineById("excalidraw")).toBe(excalidrawEngine);
    expect(excalidrawEngine.id).toBe("excalidraw");
  });

  it("does not invent an engine for an unknown id", () => {
    // A second implementation does not exist on purpose; the lookup must say so
    // rather than fall back to something that would silently mis-render.
    expect(canvasEngineById("tldraw")).toBeUndefined();
  });

  it("round-trips a board through the engine's own scene", () => {
    const board = sampleBoard();
    const scene = excalidrawEngine.toScene(board, "light");
    expect(scene.elements.length).toBeGreaterThan(0);
    // Skeletons carry the id, which is what keeps a person's card stable.
    expect(scene.elements.map((element) => element.id)).toContain(board.items[0].id);
  });
});
