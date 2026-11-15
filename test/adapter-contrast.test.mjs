import { describe, expect, it } from "vitest";
import { boardItemsToExcalidrawSkeleton } from "../dist/board/excalidraw-adapter.js";

function lum(hex) {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((left, right) => right - left);
  return (x + 0.05) / (y + 0.05);
}

function item(overrides = {}) {
  return {
    id: "a",
    type: "text",
    x: 0, y: 0, w: 160, h: 24,
    text: "内测",
    color: "#ffffff",
    author: "ai",
    createdAt: "2026-11-15T00:00:00.000Z",
    updatedAt: "2026-11-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("canvas text stays readable in both themes", () => {
  it("uses light ink on a dark canvas", () => {
    const [skeleton] = boardItemsToExcalidrawSkeleton([item()], "dark");

    expect(ratio(skeleton.strokeColor, "#131a18")).toBeGreaterThan(4.5);
  });

  it("uses dark ink on a light canvas", () => {
    const [skeleton] = boardItemsToExcalidrawSkeleton([item()], "light");

    expect(ratio(skeleton.strokeColor, "#f5f6f0")).toBeGreaterThan(4.5);
  });

  it("still honours an explicit text colour", () => {
    const [skeleton] = boardItemsToExcalidrawSkeleton([item({ style: { textColor: "#b4463d" } })], "dark");

    expect(skeleton.strokeColor).toBe("#b4463d");
  });

  it("keeps shape borders visible against the page", () => {
    const [skeleton] = boardItemsToExcalidrawSkeleton([
      item({ id: "rect", type: "rect", text: "开始", color: "#f6d365" }),
    ], "dark");

    expect(ratio(skeleton.strokeColor, "#131a18")).toBeGreaterThan(4.5);
  });

  it("leaves arrows readable too", () => {
    const [skeleton] = boardItemsToExcalidrawSkeleton([
      item({ id: "l", type: "line", w: 80, h: 0, color: "#ffffff" }),
    ], "dark");

    expect(ratio(skeleton.strokeColor, "#131a18")).toBeGreaterThan(4.5);
  });

  it("defaults to the light palette for old callers", () => {
    const [skeleton] = boardItemsToExcalidrawSkeleton([item()]);

    expect(ratio(skeleton.strokeColor, "#f5f6f0")).toBeGreaterThan(4.5);
  });

  it("does not repaint a saturated fill when switching to dark", () => {
    const [skeleton] = boardItemsToExcalidrawSkeleton([
      item({ id: "card", type: "rect", text: "开始", color: "#f6d365" }),
    ], "dark");

    expect(skeleton.backgroundColor).toBe("#f6d365");
  });

  it("maps paper-like fills to the dark page colour", () => {
    const [skeleton] = boardItemsToExcalidrawSkeleton([
      item({ id: "frame", type: "rect", color: "#ffffff", role: "frame", variant: "frame" }),
    ], "dark");

    expect(skeleton.backgroundColor).toBe("#1d2521");
  });

  it("keeps a near-white fill untouched in light mode", () => {
    const [skeleton] = boardItemsToExcalidrawSkeleton([
      item({ id: "frame", type: "rect", color: "#fbfbfc", role: "frame" }),
    ], "light");

    expect(skeleton.backgroundColor).toBe("#fbfbfc");
  });

  it("paints dark ink inside a light card even on a dark page", () => {
    const [, boundText] = boardItemsToExcalidrawSkeleton([
      item({ id: "card", type: "rect", text: "开始", color: "#f6d365" }),
    ], "dark");

    expect(ratio(boundText.strokeColor, "#f6d365")).toBeGreaterThan(4.5);
  });

  it("paints light ink inside a dark card on a dark page", () => {
    const [, boundText] = boardItemsToExcalidrawSkeleton([
      item({ id: "card", type: "rect", text: "开始", color: "#2c4a3f" }),
    ], "dark");

    expect(ratio(boundText.strokeColor, "#2c4a3f")).toBeGreaterThan(4.5);
  });
});
