import { describe, expect, it } from "vitest";
import {
  isViewportNearContent,
  readStoredViewport,
  writeStoredViewport,
} from "../dist/board/client/viewport-memory.js";
import { fitCamera } from "../dist/infra/templates/client/types.js";

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
    size: () => data.size,
  };
}

describe("viewport memory", () => {
  it("returns nothing when the board has never been opened", () => {
    expect(readStoredViewport(storage(), "board_a")).toBeUndefined();
  });

  it("remembers a viewport per board", () => {
    const store = storage();
    writeStoredViewport(store, "board_a", { scrollX: 120, scrollY: -80, zoom: 1.5 });

    expect(readStoredViewport(store, "board_a")).toEqual({ scrollX: 120, scrollY: -80, zoom: 1.5 });
    expect(readStoredViewport(store, "board_b")).toBeUndefined();
  });

  it("ignores values that are not usable numbers", () => {
    const store = storage();
    writeStoredViewport(store, "board_a", { scrollX: 10, scrollY: 10, zoom: 1 });
    store.setItem("doodle-viewport:board_a", JSON.stringify({ scrollX: "x", scrollY: null, zoom: 1 }));

    expect(readStoredViewport(store, "board_a")).toBeUndefined();
  });

  it("refuses an absurd zoom so a bad value cannot strand the canvas", () => {
    const store = storage();
    writeStoredViewport(store, "board_a", { scrollX: 0, scrollY: 0, zoom: 500 });

    expect(readStoredViewport(store, "board_a")).toBeUndefined();
  });

  it("survives a storage that throws", () => {
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
      get length() { throw new Error("blocked"); },
      key: () => { throw new Error("blocked"); },
    };

    expect(() => writeStoredViewport(broken, "board_a", { scrollX: 0, scrollY: 0, zoom: 1 })).not.toThrow();
    expect(readStoredViewport(broken, "board_a")).toBeUndefined();
  });

  it("does not grow without bound as boards change", () => {
    const store = storage();
    for (let index = 0; index < 40; index += 1) {
      writeStoredViewport(store, `board_${index}`, { scrollX: index, scrollY: 0, zoom: 1 });
    }

    expect(store.size()).toBeLessThanOrEqual(8);
    expect(readStoredViewport(store, "board_39")).toEqual({ scrollX: 39, scrollY: 0, zoom: 1 });
  });
});

describe("the first-paint camera", () => {
  it("centres the board and never scales past 1:1", () => {
    const camera = fitCamera([{ x: 100, y: 100, w: 200, h: 100 }], { width: 900, height: 650 });
    // The content is small, so it stays life-size and sits in the middle.
    expect(camera.zoom).toBe(1);
    expect(camera.scrollX + 200 * 1).toBeCloseTo(450, 5);
    expect(camera.scrollY + 150 * 1).toBeCloseTo(325, 5);
  });

  it("scales a wide diagram down until all of it fits", () => {
    // 1200x420 on a phone: the previous behaviour panned at 100% and showed a
    // fragment, which reads as a broken board on the first look.
    const camera = fitCamera([{ x: 0, y: 0, w: 1200, h: 420 }], { width: 390, height: 700 });
    expect(camera.zoom).toBeLessThan(1);
    expect(camera.zoom * (1200 + 96)).toBeLessThanOrEqual(390 + 0.001);
  });

  /*
   * This is the failure the old code produced: `fitToContent` on an empty
   * scene divided by a zero-width bound and stored `NaN`, and the canvas then
   * painted nothing at all — the board looked like it had vanished.
   */
  it("refuses to produce a camera without content or a measured viewport", () => {
    expect(fitCamera([], { width: 900, height: 650 })).toBeUndefined();
    expect(fitCamera([{ x: 0, y: 0, w: 100, h: 100 }], { width: 0, height: 0 })).toBeUndefined();
  });

  it("keeps every number finite for a board with negative coordinates", () => {
    const camera = fitCamera([{ x: -400, y: -250, w: 300, h: 200 }], { width: 800, height: 600 });
    for (const value of Object.values(camera)) expect(Number.isFinite(value)).toBe(true);
  });
});

describe("restoring a view only when it can show the content", () => {
  const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 600 };

  it("accepts a view that looks at the content", () => {
    expect(isViewportNearContent({ scrollX: 0, scrollY: 0, zoom: 1 }, bounds)).toBe(true);
    expect(isViewportNearContent({ scrollX: -200, scrollY: -100, zoom: 1 }, bounds)).toBe(true);
  });

  it("rejects a view panned far away from everything", () => {
    expect(isViewportNearContent({ scrollX: -20_000, scrollY: -20_000, zoom: 1 }, bounds)).toBe(false);
  });

  it("allows intentional whitespace near the edge", () => {
    expect(isViewportNearContent({ scrollX: -1_500, scrollY: -1_200, zoom: 1 }, bounds)).toBe(true);
  });

  it("accepts any view when the board has no bounds yet", () => {
    expect(isViewportNearContent({ scrollX: 50_000, scrollY: 50_000, zoom: 1 }, undefined)).toBe(true);
  });
});
