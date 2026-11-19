import { describe, expect, it } from "vitest";
import { changedIds, diffBoardItems, isEmptyDiff, touchedIds } from "../dist/board/item-diff.js";

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
});
