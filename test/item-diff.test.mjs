import { describe, expect, it } from "vitest";
import { changedIds, diffBoardItems, isEmptyDiff, touchedIds } from "../dist/board/model/diff.js";

const item = (id, overrides = {}) => ({
  id,
  type: "rect",
  x: 0,
  y: 0,
  w: 100,
  h: 60,
  text: "",
  color: "#f6d365",
  author: "human",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("board item diff", () => {
  it("reports nothing when only updatedAt differs", () => {
    // The canvas projects the whole scene on every change; without this the
    // diff would report every object every time and save nothing.
    const diff = diffBoardItems(
      [item("a"), item("b")],
      [item("a", { updatedAt: "2026-02-02T00:00:00.000Z" }), item("b")],
    );
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it("splits one edit into one update, not the whole board", () => {
    const diff = diffBoardItems(
      [item("a"), item("b"), item("c")],
      [item("a"), item("b", { x: 40 }), item("c")],
    );
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.updated.map((entry) => entry.id)).toEqual(["b"]);
    // The patch is the whole item, so a dropped field cannot survive as a stale
    // value the way a computed field delta would leave it.
    expect(diff.updated[0].patch.x).toBe(40);
    expect(diff.updated[0].patch.id).toBeUndefined();
    expect(diff.updated[0].patch.createdAt).toBeUndefined();
  });

  it("separates additions and removals", () => {
    const diff = diffBoardItems([item("a"), item("b")], [item("a"), item("c")]);
    expect(diff.removed).toEqual(["b"]);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]).not.toHaveProperty("id");
    expect(diff.added[0]).not.toHaveProperty("createdAt");
    expect(diff.added[0].type).toBe("rect");
  });

  it("names the ids a diff touches, and nothing else", () => {
    const previous = [item("a"), item("b"), item("c")];
    const next = [item("a"), item("b", { x: 9 }), item("d")];
    // An added item has no id yet, so a client diff can only name edits and
    // removals; `changedIds` compares two persisted boards and knows all three.
    expect([...touchedIds(diffBoardItems(previous, next))].sort()).toEqual(["b", "c"]);
    expect([...changedIds(previous, next)].sort()).toEqual(["b", "c", "d"]);
  });

  it("ignores key order, so a pan is not an edit", () => {
    /*
     * The canvas projects objects in its own key order and the board comes back
     * from JSON in another. A plain `JSON.stringify` comparison measured that
     * difference as a change, so every pan produced a one-item "update" whose
     * values were identical: a whole-board write and a new revision for a
     * gesture that touched no object.
     */
    const stored = item("a", { scene: { element: { id: "a", type: "rectangle" } } });
    const reordered = Object.fromEntries(Object.entries(stored).reverse());
    expect(isEmptyDiff(diffBoardItems([stored], [{ ...reordered, updatedAt: "2026-03-03T00:00:00.000Z" }]))).toBe(true);
    // Values still matter: the same key order with one moved field is an edit.
    expect(isEmptyDiff(diffBoardItems([stored], [{ ...reordered, x: 5 }]))).toBe(false);
  });
});
