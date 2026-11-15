import { describe, expect, it } from "vitest";
import {
  boardItemsFromExcalidrawBoard,
  boardItemsToExcalidrawSkeleton,
} from "../dist/board/excalidraw-adapter.js";

function item(overrides = {}) {
  return {
    id: "a",
    type: "rect",
    x: 0,
    y: 0,
    w: 160,
    h: 90,
    text: "卡片",
    color: "#f6d365",
    author: "ai",
    createdAt: "2026-11-12T00:00:00.000Z",
    updatedAt: "2026-11-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("board opacity and Excalidraw opacity are separate scales", () => {
  it("renders a fully opaque item when Board v1 opacity is 1", () => {
    const [skeleton] = boardItemsToExcalidrawSkeleton([item({ style: { opacity: 1 } })]);

    expect(skeleton.opacity).toBe(100);
  });

  it("renders a half-transparent item when Board v1 opacity is 0.5", () => {
    const [skeleton] = boardItemsToExcalidrawSkeleton([item({ style: { opacity: 0.5 } })]);

    expect(skeleton.opacity).toBe(50);
  });

  it("defaults to fully opaque when no opacity is set", () => {
    const [skeleton] = boardItemsToExcalidrawSkeleton([item()]);

    expect(skeleton.opacity).toBe(100);
  });

  it("never makes an item invisible by treating 1 as a percentage", () => {
    const skeletons = boardItemsToExcalidrawSkeleton([
      item({ id: "a", style: { opacity: 1 } }),
      item({ id: "b", type: "ellipse", style: { opacity: 1 } }),
      item({ id: "t", type: "text", style: { opacity: 1 } }),
      item({ id: "l", type: "line", style: { opacity: 1 } }),
    ]);

    for (const skeleton of skeletons) expect(skeleton.opacity).toBe(100);
  });

  it("round-trips Board v1 opacity through Excalidraw", () => {
    const board = {
      version: 1,
      id: "b",
      title: "t",
      revision: 1,
      updatedAt: "2026-11-12T00:00:00.000Z",
      items: [item({ style: { opacity: 0.4 } })],
      notes: [],
    };
    const skeleton = boardItemsToExcalidrawSkeleton(board.items)[0];
    const projected = boardItemsFromExcalidrawBoard(board, [{
      ...skeleton,
      id: "a",
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      updated: 1,
      seed: 1,
      groupIds: [],
      boundElements: null,
      link: null,
      locked: false,
      angle: 0,
    }], {});

    expect(projected.items[0].style?.opacity).toBeCloseTo(0.4, 5);
  });
});
