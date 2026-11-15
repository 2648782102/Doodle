import { describe, expect, it } from "vitest";
import { diagramToBoardItems, parseBoard, resolveDiagramLayout } from "../dist/board/types.js";

function diagram(overrides = {}) {
  return {
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    edges: [],
    ...overrides,
  };
}

describe("diagram layout modes", () => {
  it("defaults to top-down flow for a plain graph", () => {
    const layout = resolveDiagramLayout(diagram({ edges: [{ from: "a", to: "b" }] }));

    expect(layout.positions.get("a").x).toBeLessThan(layout.positions.get("b").x);
    expect(layout.positions.get("a").y).toBe(layout.positions.get("b").y);
  });

  it("lays a timeline out along one horizontal axis", () => {
    const layout = resolveDiagramLayout(diagram({
      mode: "timeline",
      nodes: [
        { id: "a", label: "需求", column: 0 },
        { id: "b", label: "设计", column: 1 },
        { id: "c", label: "上线", column: 2 },
      ],
    }));

    const y = new Set([...layout.positions.values()].map((point) => point.y));
    expect(y.size).toBe(1);
    expect(layout.positions.get("a").x).toBeLessThan(layout.positions.get("b").x);
    expect(layout.positions.get("b").x).toBeLessThan(layout.positions.get("c").x);
  });

  it("lays a compare view out as two columns", () => {
    const layout = resolveDiagramLayout(diagram({
      mode: "compare",
      nodes: [
        { id: "a1", label: "现状 1", column: 0 },
        { id: "a2", label: "现状 2", column: 0 },
        { id: "b1", label: "方案 1", column: 1 },
        { id: "b2", label: "方案 2", column: 1 },
      ],
    }));

    const left = [layout.positions.get("a1"), layout.positions.get("a2")];
    const right = [layout.positions.get("b1"), layout.positions.get("b2")];
    expect(new Set(left.map((point) => point.x)).size).toBe(1);
    expect(new Set(right.map((point) => point.x)).size).toBe(1);
    expect(left[0].x).toBeLessThan(right[0].x);
  });

  it("lays a matrix out on a strict grid", () => {
    const layout = resolveDiagramLayout(diagram({
      mode: "matrix",
      nodes: [
        { id: "a", label: "r0c0", row: 0, column: 0 },
        { id: "b", label: "r0c1", row: 0, column: 1 },
        { id: "c", label: "r1c0", row: 1, column: 0 },
        { id: "d", label: "r1c1", row: 1, column: 1 },
      ],
    }));

    expect(layout.positions.get("a").y).toBe(layout.positions.get("b").y);
    expect(layout.positions.get("a").x).toBe(layout.positions.get("c").x);
    expect(layout.positions.get("c").y).toBeGreaterThan(layout.positions.get("a").y);
    expect(layout.positions.get("d").x).toBeGreaterThan(layout.positions.get("c").x);
  });

  it("gives explicit positions strict precedence over a mode", () => {
    const layout = resolveDiagramLayout(diagram({
      mode: "timeline",
      nodes: [{ id: "a", label: "A", row: 3, column: 2 }, { id: "b", label: "B" }],
    }));

    expect(layout.positions.get("a").x).toBeGreaterThan(layout.positions.get("b").x);
  });

  it("keeps nodes that form a cycle layoutable in every mode", () => {
    for (const mode of ["flow", "timeline", "compare", "matrix"]) {
      const layout = resolveDiagramLayout(diagram({
        mode,
        nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
        edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }],
      }));
      expect(layout.positions.size).toBe(3);
      for (const point of layout.positions.values()) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      }
    }
  });

  it("stacks a timeline series vertically when several nodes share a column", () => {
    const layout = resolveDiagramLayout(diagram({
      mode: "timeline",
      nodes: [
        { id: "a", label: "T1", column: 0 },
        { id: "a2", label: "T1 备注", column: 0 },
        { id: "b", label: "T2", column: 1 },
      ],
    }));

    expect(layout.positions.get("a").x).toBe(layout.positions.get("a2").x);
    expect(layout.positions.get("a2").y).toBeGreaterThan(layout.positions.get("a").y);
  });

  it("snakes a long flow instead of emitting one unreadable strip", () => {
    const nodes = Array.from({ length: 16 }, (_, index) => ({ id: `n${index}`, label: `Step ${index + 1}` }));
    const edges = Array.from({ length: 15 }, (_, index) => ({ from: `n${index}`, to: `n${index + 1}` }));
    const layout = resolveDiagramLayout(diagram({ mode: "flow", nodes, edges }));
    const xs = [...layout.positions.values()].map((point) => point.x);
    const ys = [...layout.positions.values()].map((point) => point.y);

    // Six columns of 190px + 70px gap, not sixteen.
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(6 * 260);
    expect(new Set(ys).size).toBeGreaterThan(1);
  });

  it("draws every edge, including skip and vertical links", () => {
    const items = diagramToBoardItems({
      mode: "flow",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
        { id: "d", label: "D" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "d" },
        { from: "b", to: "c" },
      ],
    });
    const lines = items.filter((item) => item.type === "line");

    expect(lines).toHaveLength(3);
    expect(lines.map((line) => [line.startItemId, line.endItemId])).toEqual([
      ["a", "b"],
      ["a", "d"],
      ["b", "c"],
    ]);
  });

  it("continues the sequence in one column when only rows are given", () => {
    // A timeline author states the axis once (`column: 0`) and then advances
    // `row`; nodes that carry only a row must stay on that axis instead of
    // being pushed into a second column at x = 300.
    const nodes = [
      { id: "a", label: "1", column: 0, row: 0 },
      { id: "b", label: "2", row: 1 },
      { id: "c", label: "3", row: 2 },
    ];
    const layout = resolveDiagramLayout(diagram({ mode: "timeline", nodes }));
    const xs = new Set([...layout.positions.values()].map((point) => point.x));
    const ys = [...layout.positions.values()].map((point) => point.y);

    expect(xs.size).toBe(1);
    expect(new Set(ys).size).toBe(3);
  });

  it("suffixes generated ids that already exist on the board", () => {
    // A second iteration commonly reuses `n1`; that used to fail the whole call
    // with `Duplicate board item ID`.
    const first = diagramToBoardItems({
      nodes: [{ id: "n1", label: "First" }],
      edges: [],
    });
    const second = diagramToBoardItems(
      { nodes: [{ id: "n1", label: "Second" }], edges: [] },
      "ai",
      first.map((item) => item.id),
    );
    const board = { version: 1, id: "b", title: "t", revision: 0, updatedAt: new Date().toISOString(), items: [...first, ...second], notes: [] };

    expect(second.some((item) => item.id === "n1_2")).toBe(true);
    expect(() => parseBoard(board)).not.toThrow();
  });

  it("accepts a connector that appears before its endpoints", () => {
    // Models often emit the line first and the shapes after it.
    const board = {
      version: 1, id: "b", title: "t", revision: 0, updatedAt: new Date().toISOString(),
      notes: [],
      items: [
        { id: "l", type: "line", x: 10, y: 10, w: 80, h: 0, text: "", color: "#64748b", author: "ai", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), startItemId: "s", endItemId: "e" },
        { id: "s", type: "rect", x: 10, y: 10, w: 80, h: 40, text: "S", color: "#ffffff", author: "ai", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "e", type: "rect", x: 200, y: 10, w: 80, h: 40, text: "E", color: "#ffffff", author: "ai", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ],
    };
    expect(() => parseBoard(board)).not.toThrow();
  });
});
