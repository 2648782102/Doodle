import { describe, expect, it } from "vitest";
import {
  boardAgentView,
  boardAgentDelta,
  stripCanvasFidelity,
} from "../dist/board/view/agent-view.js";
import { BoardRevisionCache } from "../dist/board/state/revision-cache.js";

function scene(overrides = {}) {
  return {
    element: { id: "a", type: "rectangle", version: 12, seed: 991, versionNonce: 7, boundElements: [{ id: "t", type: "text" }] },
    boundText: { id: "t", text: "草稿", originalText: "草稿", containerId: "a" },
    ...overrides,
  };
}

function item(overrides = {}) {
  return {
    id: "a",
    type: "note",
    x: 10,
    y: 20,
    w: 180,
    h: 120,
    text: "草稿",
    color: "#f6d365",
    author: "human",
    createdAt: "2026-11-12T00:00:00.000Z",
    updatedAt: "2026-11-12T00:00:00.000Z",
    ...overrides,
  };
}

function board(revision, items) {
  return {
    version: 1,
    id: "board_test",
    title: "和 AI 一起画",
    revision,
    updatedAt: `2026-11-12T00:00:0${revision}.000Z`,
    items,
  };
}

describe("agent view keeps canvas fidelity out of agent context", () => {
  it("drops scene metadata from every item", () => {
    const source = board(3, [item({ scene: scene() }), item({ id: "b", type: "rect", scene: scene({ element: { id: "b" } }) })]);
    const view = boardAgentView(source);

    expect(view.items.every((entry) => !("scene" in entry))).toBe(true);
    expect(JSON.stringify(view)).not.toContain("versionNonce");
  });

  it("keeps the persisted board untouched", () => {
    const original = board(3, [item({ scene: scene() })]);
    const before = JSON.stringify(original);

    boardAgentView(original);
    stripCanvasFidelity(original);

    expect(JSON.stringify(original)).toBe(before);
  });

  it("preserves everything the agent needs to draw", () => {
    const source = board(3, [
      item({ variant: "card", role: "step", emphasis: "focus", z: 4, groupId: "g1" }),
      item({ id: "l", type: "line", startItemId: "a", endItemId: "b", shape: "orthogonal" }),
    ]);
    const view = boardAgentView(source);

    expect(view.items[0]).toMatchObject({ variant: "card", role: "step", emphasis: "focus", z: 4, groupId: "g1" });
    expect(view.items[1]).toMatchObject({ startItemId: "a", endItemId: "b", shape: "orthogonal" });
  });

  it("marks that fidelity exists without repeating it", () => {
    const view = boardAgentView(board(3, [item({ scene: scene() })]));

    expect(view.items[0].canvasFidelity).toBe(true);
    expect(view.canvasFidelityItems).toBe(1);
  });

  it("is much smaller than the full board", () => {
    const heavy = board(3, Array.from({ length: 8 }, (_, index) =>
      item({ id: `n${index}`, scene: scene({ element: { id: `n${index}`, points: Array.from({ length: 40 }, (_, p) => [p, p]) } }) })));

    const full = JSON.stringify(heavy).length;
    const agent = JSON.stringify(boardAgentView(heavy)).length;

    expect(agent).toBeLessThan(full * 0.5);
  });
});

describe("agent delta reports only what changed", () => {
  it("returns nothing for an unchanged board", () => {
    const current = board(4, [item({ scene: scene() })]);
    const delta = boardAgentDelta(current, { ...current, revision: 3 });

    expect(delta.added).toEqual([]);
    expect(delta.updated).toEqual([]);
    expect(delta.removed).toEqual([]);
    expect(delta.unchanged).toBe(true);
  });

  it("ignores scene-only differences", () => {
    const current = board(4, [item({ scene: scene({ element: { id: "a", version: 99 } }) })]);
    const previous = board(3, [item({ scene: scene({ element: { id: "a", version: 1 } }) })]);

    expect(boardAgentDelta(current, previous).unchanged).toBe(true);
  });

  it("reports a real edit with final values", () => {
    const current = board(4, [item({ text: "改过了" })]);
    const previous = board(3, [item()]);
    const delta = boardAgentDelta(current, previous);

    expect(delta.unchanged).toBe(false);
    expect(delta.updated).toHaveLength(1);
    expect(delta.updated[0].text).toBe("改过了");
    expect(delta.updated[0]).not.toHaveProperty("scene");
  });

  it("reports additions and removals by id", () => {
    const current = board(4, [item({ id: "a" }), item({ id: "c" })]);
    const previous = board(3, [item({ id: "a" }), item({ id: "b" })]);
    const delta = boardAgentDelta(current, previous);

    expect(delta.added.map((entry) => entry.id)).toEqual(["c"]);
    expect(delta.removed).toEqual(["b"]);
  });

  it("treats a first read as all additions", () => {
    const current = board(1, [item({ id: "a" }), item({ id: "b" })]);
    const delta = boardAgentDelta(current, null);

    expect(delta.added).toHaveLength(2);
    expect(delta.baseRevision).toBe(0);
  });
});

describe("agent view summary", () => {
  it("builds a stable compact summary", () => {
    const view = boardAgentView(board(5, [
      item({ role: "step", text: "开始" }),
      item({ id: "l", type: "line", startItemId: "a", endItemId: "b", text: "" }),
    ]));

    expect(view.summary).toMatchObject({ itemCount: 2, revision: 5 });
    expect(view.summary.byType).toMatchObject({ note: 1, line: 1 });
  });
});

describe("revision cache backs incremental rereads", () => {
  it("returns the board for a revision it saw", () => {
    const cache = new BoardRevisionCache();
    const current = board(7, [item()]);

    cache.remember(current);

    expect(cache.get(7)).toBe(current);
    expect(cache.get(6)).toBeUndefined();
  });

  it("stays bounded and drops the oldest revision", () => {
    const cache = new BoardRevisionCache(3);
    for (let revision = 1; revision <= 5; revision += 1) cache.remember(board(revision, [item()]));

    expect(cache.get(5)).toBeDefined();
    expect(cache.get(4)).toBeDefined();
    expect(cache.get(3)).toBeDefined();
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(1)).toBeUndefined();
  });

  it("forgets everything on clear", () => {
    const cache = new BoardRevisionCache();
    cache.remember(board(2, [item()]));
    cache.clear();

    expect(cache.get(2)).toBeUndefined();
  });
});
