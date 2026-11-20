/**
 * The human loop is graded by comparing the model's own words against the
 * HANDOFF the server computed. That means the grader must be right about what
 * the server says before it can judge a model.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { applyHumanEdit, expectedHandoff, gradeHumanReport } from "./human-loop.mjs";

/*
 * `dist/` is not built when CI runs `npm test`, so the compiled modules are
 * loaded inside the test body rather than at import time — the same reason
 * `human-loop.mjs` defers its own import.
 */
async function server() {
  // Absolute URLs: the runner rewrites a bare relative dynamic import into a
  // path from the filesystem root, where `dist` does not live.
  const types = await import(new URL("../dist/board/types.js", import.meta.url).href);
  const recipe = await import(new URL("../dist/board/diagram/recipe.js", import.meta.url).href);
  return {
    createEmptyBoard: types.createEmptyBoard,
    diagramToBoardItems: types.diagramToBoardItems,
    touchBoard: types.touchBoard,
    expandRecipe: recipe.expandRecipe,
  };
}

async function flowBoard(steps) {
  const { createEmptyBoard, diagramToBoardItems, touchBoard, expandRecipe } = await server();
  return touchBoard({ ...createEmptyBoard(), items: diagramToBoardItems(expandRecipe({ recipe: "flow", steps }), "ai") });
}

describe("scripted human edits", () => {
  it("moves the named object and marks it human", async () => {
    const before = await flowBoard(["A", "B"]);
    const after = applyHumanEdit(before, { type: "move", label: "B", dx: 120, dy: 0 });
    const moved = after.items.find((item) => (item.title || item.text) === "B");
    const original = before.items.find((item) => (item.title || item.text) === "B");
    expect(moved.x).toBe(original.x + 120);
    expect(moved.author).toBe("human");
    expect(after.revision).toBe(before.revision + 1);
  });

  it("leaves every other object untouched", async () => {
    const before = await flowBoard(["A", "B"]);
    const after = applyHumanEdit(before, { type: "move", label: "B", dx: 50 });
    const a = after.items.find((item) => (item.title || item.text) === "A");
    const aBefore = before.items.find((item) => (item.title || item.text) === "A");
    expect(a).toBe(aBefore);
  });
});

describe("the handoff the server computes", () => {
  it("reports a move, attributed to the person", async () => {
    const before = await flowBoard(["A", "B"]);
    const after = applyHumanEdit(before, { type: "move", label: "B", dx: 120 });
    const handoff = await expectedHandoff(before, after);
    expect(handoff.needsAttention).toBe(true);
    expect(handoff.humanEdits).toHaveLength(1);
    expect(handoff.readings[0].kind).toBe("move");
  });

  it("says nothing when the AI's own write is the only change", async () => {
    // Telling the agent to review itself is pure noise.
    const before = await flowBoard(["A", "B"]);
    const { touchBoard } = await server();
    const aiOnly = touchBoard({ ...before, items: before.items.map((item) => ({ ...item, x: item.x + 5 })) });
    expect((await expectedHandoff(before, aiOnly)).needsAttention).toBe(false);
  });
});

describe("grading what the model understood", () => {
  let before;
  let after;
  let handoff;
  /*
   * `beforeAll` rather than module scope: the compiled board modules are
   * async-loaded, so nothing here may run at describe time.
   */
  beforeAll(async () => {
    before = await flowBoard(["A", "B"]);
    after = applyHumanEdit(before, { type: "move", label: "B", dx: 120 });
    handoff = await expectedHandoff(before, after);
  });

  it("passes an answer that names the object and the kind of change", () => {
    const result = gradeHumanReport({
      answer: "我注意到你把「B」移动了，我保持这个新位置。",
      handoff, before, after,
    });
    expect(result.detected).toBe(1);
    expect(result.kindOk).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("fails an answer that never mentions the changed object", () => {
    const result = gradeHumanReport({
      answer: "画板看起来没什么变化，我继续画。",
      handoff, before, after,
    });
    expect(result.missed).toEqual(["B"]);
    expect(result.ok).toBe(false);
  });

  it("fails an answer that invents objects not on the board", () => {
    /*
     * Hallucinating the board is worse than missing a detail: the model would
     * then draw against objects that do not exist.
     */
    const result = gradeHumanReport({
      answer: "你把「B」和「登录流程」都移动了。",
      handoff, before, after,
    });
    expect(result.invented).toContain("登录流程");
    expect(result.ok).toBe(false);
  });

  it("accepts a paraphrase — comprehension is not phrasing", () => {
    const result = gradeHumanReport({
      answer: "B 现在换了个位置，我按新布局继续。",
      handoff, before, after,
    });
    expect(result.ok).toBe(true);
  });
});
