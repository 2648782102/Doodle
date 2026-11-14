import { describe, expect, it } from "vitest";
import { describeHandoff, handoffNextStep } from "../dist/board/handoff.js";

function item(overrides = {}) {
  return {
    id: "a",
    type: "note",
    x: 0,
    y: 0,
    w: 160,
    h: 90,
    text: "开始",
    color: "#f6d365",
    author: "ai",
    createdAt: "2026-11-12T00:00:00.000Z",
    updatedAt: "2026-11-12T00:00:00.000Z",
    ...overrides,
  };
}

function board(revision, items) {
  return {
    version: 1,
    id: "b",
    title: "t",
    revision,
    updatedAt: "2026-11-12T00:00:00.000Z",
    items,
  };
}

describe("handoff describes who changed what", () => {
  it("reports nothing to review when the human has not touched anything", () => {
    const handoff = describeHandoff(board(2, [item()]), null);

    expect(handoff.needsAttention).toBe(false);
    expect(handoff.humanEdits).toEqual([]);
    expect(handoff.summary).toContain("没有");
  });

  it("reports objects the human edited", () => {
    const previous = board(1, [item({ text: "开始", author: "ai" })]);
    const current = board(2, [item({ text: "从需求开始", author: "human" })]);
    const handoff = describeHandoff(current, previous);

    expect(handoff.needsAttention).toBe(true);
    expect(handoff.humanEdits).toHaveLength(1);
    expect(handoff.humanEdits[0]).toMatchObject({ id: "a", change: "edited" });
    expect(handoff.humanEdits[0].now.text).toBe("从需求开始");
  });

  it("reports objects the human added and removed", () => {
    const previous = board(1, [item({ id: "a" })]);
    const current = board(2, [item({ id: "a" }), item({ id: "b", author: "human", text: "人的补充" })]);
    const added = describeHandoff(current, previous);

    expect(added.humanEdits.map((entry) => [entry.id, entry.change])).toContainEqual(["b", "added"]);

    const removed = describeHandoff(board(3, []), current);
    expect(removed.humanEdits.map((entry) => [entry.id, entry.change])).toContainEqual(["b", "removed"]);
  });

  it("ignores AI-only changes so the agent is not told to review itself", () => {
    const previous = board(1, [item({ text: "开始" })]);
    const current = board(2, [item({ text: "开始 → 设计", author: "ai" })]);
    const handoff = describeHandoff(current, previous);

    expect(handoff.humanEdits).toEqual([]);
    expect(handoff.needsAttention).toBe(false);
  });

  it("reports a human change that flips an AI object to human", () => {
    const previous = board(1, [item({ author: "ai", x: 0 })]);
    const current = board(2, [item({ author: "human", x: 240 })]);
    const handoff = describeHandoff(current, previous);

    expect(handoff.humanEdits[0].change).toBe("edited");
    expect(handoff.humanEdits[0].fields).toContain("x");
  });

  it("keeps the payload small and readable", () => {
    const previous = board(1, []);
    const current = board(2, Array.from({ length: 40 }, (_, index) =>
      item({ id: `n${index}`, author: "human", text: `人工节点 ${index}` })));
    const handoff = describeHandoff(current, previous);

    expect(handoff.humanEdits.length).toBeLessThanOrEqual(12);
    expect(handoff.omitted).toBeGreaterThan(0);
    expect(JSON.stringify(handoff).length).toBeLessThan(3000);
  });
});

describe("handoff suggests the next move", () => {
  it("tells the agent not to redraw when nothing human changed", () => {
    const next = handoffNextStep(describeHandoff(board(2, [item()]), null));

    expect(next).toContain("不必重画");
    expect(next).toContain("2");
  });

  it("names what the person changed", () => {
    const previous = board(1, [item({ text: "开始" })]);
    const current = board(2, [item({ text: "从需求开始", author: "human" })]);
    const next = handoffNextStep(describeHandoff(current, previous));

    expect(next).toContain("先回应");
    expect(next).toContain("1 处修改");
  });

  it("counts removals and additions separately", () => {
    const previous = board(1, [item({ id: "a", author: "human" })]);
    const current = board(2, [item({ id: "b", author: "human", text: "新" })]);
    const next = handoffNextStep(describeHandoff(current, previous));

    expect(next).toContain("1 处新增");
    expect(next).toContain("1 处删除");
  });
});
