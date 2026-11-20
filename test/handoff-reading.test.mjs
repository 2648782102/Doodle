import { describe, expect, it } from "vitest";
import { describeHandoff } from "../dist/board/view/handoff.js";

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
    createdAt: "2026-11-15T00:00:00.000Z",
    updatedAt: "2026-11-15T00:00:00.000Z",
    ...overrides,
  };
}

function board(revision, items) {
  return {
    version: 1,
    id: "b",
    title: "t",
    revision,
    updatedAt: "2026-11-15T00:00:00.000Z",
    items,
  };
}

describe("handoff reads what the change means", () => {
  it("reads a text change as a relabel", () => {
    const handoff = describeHandoff(
      board(2, [item({ text: "从需求开始", author: "human" })]),
      board(1, [item({ text: "开始" })]),
    );

    expect(handoff.readings).toHaveLength(1);
    expect(handoff.readings[0].kind).toBe("relabel");
    expect(handoff.readings[0].reading).toContain("开始");
    expect(handoff.readings[0].reading).toContain("从需求开始");
  });

  it("reads a position change as a move, with the direction", () => {
    const handoff = describeHandoff(
      board(2, [item({ x: 400, y: 300, author: "human" })]),
      board(1, [item({ x: 0, y: 0 })]),
    );

    expect(handoff.readings[0].kind).toBe("move");
    expect(handoff.readings[0].reading).toMatch(/右下|右|下/);
  });

  it("reads a size change as a resize", () => {
    const handoff = describeHandoff(
      board(2, [item({ w: 320, h: 90, author: "human" })]),
      board(1, [item()]),
    );

    expect(handoff.readings[0].kind).toBe("resize");
  });

  it("reads a colour change as a restyle", () => {
    const handoff = describeHandoff(
      board(2, [item({ color: "#b8e0d2", author: "human" })]),
      board(1, [item()]),
    );

    expect(handoff.readings[0].kind).toBe("restyle");
  });

  it("reads a new human note as an addition to discuss", () => {
    const handoff = describeHandoff(
      board(2, [item({ id: "n", author: "human", text: "这里要加缓存" })]),
      board(1, []),
    );

    expect(handoff.readings[0].kind).toBe("add-note");
    expect(handoff.readings[0].reading).toContain("这里要加缓存");
  });

  it("reads a deletion as a removal", () => {
    const handoff = describeHandoff(
      board(2, []),
      board(1, [item({ author: "human" })]),
    );

    expect(handoff.readings[0].kind).toBe("remove");
  });

  it("prefers the most meaningful change when several apply", () => {
    const handoff = describeHandoff(
      board(2, [item({ text: "新标签", x: 40, color: "#b8e0d2", author: "human" })]),
      board(1, [item()]),
    );

    expect(handoff.readings[0].kind).toBe("relabel");
  });

  it("says nothing when the human changed nothing", () => {
    const handoff = describeHandoff(board(2, [item()]), board(1, [item()]));

    expect(handoff.readings).toEqual([]);
  });

  it("stays bounded on a large handoff", () => {
    const many = Array.from({ length: 40 }, (_, index) => item({ id: `n${index}`, author: "human", text: `改 ${index}` }));
    const handoff = describeHandoff(board(2, many), board(1, many.map((entry) => ({ ...entry, text: "旧" }))));

    expect(handoff.readings.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(handoff.readings).length).toBeLessThan(4000);
  });
});
