/**
 * The human loop is graded by comparing the model's own words against the
 * HANDOFF the server computed. That means the grader must be right about what
 * the server says before it can judge a model.
 *
 * These tests inject a handoff implementation instead of importing the built
 * one. The real entry point does the same thing with the server's own module
 * (see `run-human-loop.mjs`); here a stand-in with the same contract keeps the
 * suite independent of build output and of the runner's module rewriting,
 * which is what broke three CI rounds.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { applyHumanEdit, expectedHandoff, gradeHumanReport, setHandoffImplementation } from "./human-loop.mjs";

/* ---------------------------------------------------------------- fixtures */

/**
 * A minimal handoff with the real contract: human-attributed edits only, one
 * reading per edit, and nothing reported for a change the AI itself made.
 */
function describeHandoffForTest(current, previous) {
  const before = new Map((previous?.items ?? []).map((item) => [item.id, item]));
  const humanEdits = [];
  const readings = [];
  const currentIds = new Set(current.items.map((item) => item.id));
  /*
   * A removal has no surviving item to inspect, so it is detected from the
   * previous board. The real handoff does the same, and attributes the
   * disappearance to the person unless the AI removed its own object.
   */
  for (const [id, old] of before) {
    if (currentIds.has(id)) continue;
    if (old.author !== "human" && old.author !== "ai") continue;
    humanEdits.push({ id, change: "removed", author: "human", fields: ["__removed"] });
    readings.push({ id, kind: "remove" });
  }
  for (const item of current.items) {
    const old = before.get(item.id);
    const changed = !old
      || old.x !== item.x || old.y !== item.y || old.text !== item.text
      || old.w !== item.w || old.h !== item.h || old.color !== item.color;
    if (!changed) continue;
    if (item.author !== "human") continue;
    const kind = !old ? "add-note"
      : old.text !== item.text ? "relabel"
        : old.x !== item.x || old.y !== item.y ? "move"
          : "edit";
    humanEdits.push({ id: item.id, change: old ? "edited" : "added", author: "human" });
    readings.push({ id: item.id, kind });
  }
  return {
    baseRevision: previous?.revision ?? 0,
    revision: current.revision,
    needsAttention: readings.length > 0,
    humanEdits,
    omitted: 0,
    summary: `人改动了 ${readings.length} 处`,
    readings,
    note: "test double",
  };
}

setHandoffImplementation(describeHandoffForTest);

/** A three-step flow, built locally so no build output is needed. */
let boardSeq = 0;
function flowBoard(steps) {
  const items = steps.map((step, index) => ({
    id: `n${boardSeq += 1}`,
    type: "rect",
    x: index * 240,
    y: 0,
    w: 180,
    h: 90,
    text: step,
    color: "#dbeafe",
    author: "ai",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
  return { version: 1, id: "board_test", title: "t", revision: 1, updatedAt: "2026-01-01T00:00:00.000Z", notes: [], items };
}

function touchBoard(board) {
  return { ...board, revision: board.revision + 1, updatedAt: new Date().toISOString() };
}

/* ------------------------------------------------------------------- tests */

describe("scripted human edits", () => {
  it("moves the named object and marks it human", () => {
    const before = flowBoard(["A", "B"]);
    const after = applyHumanEdit(before, { type: "move", label: "B", dx: 120, dy: 0 });
    const moved = after.items.find((item) => item.text === "B");
    const original = before.items.find((item) => item.text === "B");
    expect(moved.x).toBe(original.x + 120);
    expect(moved.author).toBe("human");
    expect(after.revision).toBe(before.revision + 1);
  });

  it("removes a connector along with the node it pointed at", () => {
    /*
     * Leaving the line behind made `parseBoard` reject the whole board, and the
     * server quarantined it and started empty. The model then truthfully said
     * "zero objects" while the grader called it a comprehension failure — the
     * harness had corrupted the board.
     */
    const before = {
      ...flowBoard(["A", "B"]),
      items: [
        ...flowBoard(["A", "B"]).items,
      ],
    };
    const [a, b] = before.items;
    before.items.push({
      id: "e1", type: "line", x: 0, y: 0, w: 240, h: 0, text: "",
      color: "#000", author: "ai",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      startItemId: a.id, endItemId: b.id,
    });
    const after = applyHumanEdit(before, { type: "delete", label: "B" });
    expect(after.items.some((item) => item.type === "line")).toBe(false);
    expect(after.items.every((item) => !item.startItemId && !item.endItemId)).toBe(true);
  });

  it("leaves every other object untouched", () => {
    const before = flowBoard(["A", "B"]);
    const after = applyHumanEdit(before, { type: "move", label: "B", dx: 50 });
    expect(after.items.find((item) => item.text === "A")).toBe(before.items.find((item) => item.text === "A"));
  });
});

describe("the handoff the server computes", () => {
  it("reports a move, attributed to the person", () => {
    const before = flowBoard(["A", "B"]);
    const after = applyHumanEdit(before, { type: "move", label: "B", dx: 120 });
    const handoff = expectedHandoff(before, after);
    expect(handoff.needsAttention).toBe(true);
    expect(handoff.humanEdits).toHaveLength(1);
    expect(handoff.readings[0].kind).toBe("move");
  });

  it("says nothing when the AI's own write is the only change", () => {
    // Telling the agent to review itself is pure noise.
    const before = flowBoard(["A", "B"]);
    const aiOnly = touchBoard({ ...before, items: before.items.map((item) => ({ ...item, x: item.x + 5 })) });
    expect(expectedHandoff(before, aiOnly).needsAttention).toBe(false);
  });
});

describe("grading what the model understood", () => {
  let before;
  let after;
  let handoff;
  beforeAll(() => {
    before = flowBoard(["A", "B"]);
    after = applyHumanEdit(before, { type: "move", label: "B", dx: 120 });
    handoff = expectedHandoff(before, after);
  });

  it("passes an answer that names the object and the kind of change", () => {
    const result = gradeHumanReport({ answer: "我注意到你把「B」移动了，我保持这个新位置。", handoff, before, after });
    expect(result.detected).toBe(1);
    expect(result.kindOk).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("fails an answer that never mentions the changed object", () => {
    const result = gradeHumanReport({ answer: "画板看起来没什么变化，我继续画。", handoff, before, after });
    expect(result.missed).toEqual(["B"]);
    expect(result.ok).toBe(false);
  });

  it("fails an answer that invents objects not on the board", () => {
    /*
     * Hallucinating the board is worse than missing a detail: the model would
     * then draw against objects that do not exist.
     */
    const result = gradeHumanReport({ answer: "你把「B」和「登录流程」都移动了。", handoff, before, after });
    expect(result.invented).toContain("登录流程");
    expect(result.ok).toBe(false);
  });

  it("accepts a paraphrase — comprehension is not phrasing", () => {
    const result = gradeHumanReport({ answer: "B 现在换了个位置，我按新布局继续。", handoff, before, after });
    expect(result.ok).toBe(true);
  });
});

describe("grading a deletion", () => {
  /*
   * A deleted object is gone from the board, so the grader must look it up in
   * the *previous* board. Without that the hardest edit kind could never be
   * recognised, and a correct answer would score zero.
   */
  let before;
  let after;
  let handoff;
  beforeAll(() => {
    before = flowBoard(["A", "B", "C"]);
    after = applyHumanEdit(before, { type: "delete", label: "B" });
    handoff = expectedHandoff(before, after);
  });

  it("reports the removal at all", () => {
    expect(handoff.needsAttention).toBe(true);
    expect(after.items).toHaveLength(2);
  });

  it("passes an answer that names the removed object", () => {
    const result = gradeHumanReport({ answer: "你把「B」删掉了。", handoff, before, after });
    expect(result.detected).toBe(1);
    expect(result.ok).toBe(true);
  });

  it("does not treat the removed label as invented", () => {
    // The label is legitimately absent from the current board.
    const result = gradeHumanReport({ answer: "「B」这张卡被我删除了。", handoff, before, after });
    expect(result.invented).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("grading a relabel", () => {
  let before;
  let after;
  let handoff;
  beforeAll(() => {
    before = flowBoard(["A", "B"]);
    after = applyHumanEdit(before, { type: "relabel", label: "B", to: "B（已调整）" });
    handoff = expectedHandoff(before, after);
  });

  it("passes an answer that quotes the new label", () => {
    const result = gradeHumanReport({ answer: "你把 B 改名了，现在是「B（已调整）」。", handoff, before, after });
    expect(result.ok).toBe(true);
  });
});
