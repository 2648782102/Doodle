/**
 * The graders are the benchmark's measuring instrument, so they get the same
 * treatment as product code: known-good drawings must score 1, and each known
 * failure mode must be detected by name.
 *
 * Boards are built through the real diagram generator rather than hand-written
 * coordinates, so the tests exercise the shape a model actually produces.
 */
import { describe, expect, it } from "vitest";
import { createEmptyBoard, diagramToBoardItems, touchBoard } from "../../dist/board/types.js";
import { expandRecipe } from "../../dist/board/diagram/recipe.js";
import { gradeBoard, gradeBudget } from "./index.mjs";
import { labelsMatch, normalizeLabel } from "./normalize.mjs";
import { countCrossings, countEdgesThroughNodes, segmentsIntersect } from "./geometry.mjs";

function boardFrom(items) {
  return touchBoard({ ...createEmptyBoard(), items });
}

/** The generator expects an expanded diagram; the tool calls `expandRecipe` first. */
function generate(diagram) {
  return diagramToBoardItems(expandRecipe(diagram), "ai");
}

/** A five-step flow drawn by the real generator. */
function flowBoard(steps = ["下单", "校验", "拣货", "发货", "签收"]) {
  const items = generate({ recipe: "flow", steps });
  return boardFrom(items);
}

describe("label matching", () => {
  it("normalises whitespace, case, and punctuation", () => {
    expect(normalizeLabel("  校验订单。 ")).toBe("校验订单");
    expect(normalizeLabel("Order OK!")).toBe("orderok");
  });

  it("accepts a longer label that extends the expected one", () => {
    // A model writing 校验订单 for 校验 is still drawing the right step.
    expect(labelsMatch("校验", "校验订单")).toBe(true);
  });

  it("accepts a numbered, explained node, which is what models actually draw", () => {
    /*
     * Live runs produced "1 注册 / 登录：创建账号，完成身份验证" for the expected
     * "注册". Prefix-only matching scored that drawing zero — a false negative
     * far more damaging than the collision it was guarding against.
     */
    expect(labelsMatch("注册", "1 注册 / 登录：创建账号，完成身份验证")).toBe(true);
    expect(labelsMatch("发货", "确认发货")).toBe(true);
  });

  it("still refuses a one-character overlap", () => {
    // The containment rule needs a length floor or 会 would match 会议.
    expect(labelsMatch("会", "会议")).toBe(false);
    expect(labelsMatch("是", "是否迁移")).toBe(false);
  });

  it("accepts a one-character label that is a whole delimited part", () => {
    /*
     * A decision branch is named "是" and a model writes "是·迁移" — the branch
     * plus what choosing it means. Without this, five correct runs failed with
     * "missing: 是, 否". The separator on the longer side is what makes the
     * single character a name rather than a fragment.
     */
    expect(labelsMatch("是", "是·迁移")).toBe(true);
    expect(labelsMatch("否", "否·不迁移")).toBe(true);
  });

  it("never matches blank labels", () => {
    expect(labelsMatch("", "")).toBe(false);
    expect(labelsMatch("a", "  ")).toBe(false);
  });
});

describe("grading a correct drawing", () => {
  const board = flowBoard();
  const expectSpec = {
    kind: "sequence",
    ordered: true,
    nodes: ["下单", "校验", "拣货", "发货", "签收"],
  };

  it("scores a generator-produced flow as complete", () => {
    const result = gradeBoard(board, expectSpec);
    expect(result.structure.nodes.recall).toBe(1);
    expect(result.structure.nodes.precision).toBe(1);
    expect(result.structure.edges.f1).toBe(1);
    expect(result.structure.sequence.ok).toBe(true);
    expect(result.pass).toBe(true);
    expect(result.score).toBeCloseTo(1, 5);
  });

  it("reports no structural or geometric defects", () => {
    const result = gradeBoard(board, expectSpec);
    expect(result.geometry.crossings).toBe(0);
    expect(result.geometry.edgesThroughNodes).toBe(0);
    expect(result.geometry.danglingConnectors).toBe(0);
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });

  it("does not count the generator's own frame, title, and subtitle as nodes", () => {
    /*
     * `draw_board.diagram` emits a frame, a title with role "label", and a
     * subtitle repeating the prompt ("草稿 → 反馈 → 修改"). The first live run
     * counted all three, so a perfectly correct drawing reported precision 0.6
     * and failed. Furniture is not content.
     */
    const result = gradeBoard(board, { kind: "sequence", ordered: true, nodes: ["下单", "校验", "拣货", "发货", "签收"] });
    expect(result.structure.nodes.precision).toBe(1);
    expect(result.structure.nodes.extra).toEqual([]);
  });
});

describe("detecting failures", () => {
  it("reports a missing node by name", () => {
    const board = flowBoard(["下单", "校验", "拣货", "发货"]); // 签收 dropped
    const result = gradeBoard(board, {
      kind: "sequence", ordered: true,
      nodes: ["下单", "校验", "拣货", "发货", "签收"],
    });
    expect(result.structure.nodes.recall).toBeCloseTo(0.8, 5);
    expect(result.structure.nodes.missing).toEqual(["签收"]);
    expect(result.pass).toBe(false);
  });

  it("reports invented nodes as a precision loss", () => {
    const items = generate({ recipe: "flow", steps: ["下单", "校验"] });
    items.push({
      id: "stray", type: "rect", x: 900, y: 900, w: 120, h: 80,
      text: "无关的便签", color: "#ffffff", author: "ai",
    });
    const result = gradeBoard(boardFrom(items), {
      kind: "sequence", ordered: true, nodes: ["下单", "校验"],
    });
    expect(result.structure.nodes.precision).toBeLessThan(1);
    expect(result.structure.nodes.extra).toContain("无关的便签");
  });

  it("catches a broken chain even when every node is present", () => {
    const items = generate({ recipe: "flow", steps: ["A", "B", "C"] });
    // Sever the middle link: nodes right, graph wrong.
    const line = items.find((item) => item.type === "line");
    line.endItemId = undefined;
    const result = gradeBoard(boardFrom(items), {
      kind: "sequence", ordered: true, nodes: ["A", "B", "C"],
    });
    expect(result.structure.nodes.recall).toBe(1);
    expect(result.structure.sequence.ok).toBe(false);
    expect(result.pass).toBe(false);
  });

  it("flags a connector bound to nothing", () => {
    const items = generate({ recipe: "flow", steps: ["A", "B"] });
    const line = items.find((item) => item.type === "line");
    line.endItemId = "ghost";
    const result = gradeBoard(boardFrom(items), {
      kind: "sequence", ordered: true, nodes: ["A", "B"],
    });
    expect(result.geometry.danglingConnectors).toBe(1);
    expect(result.checks.find((check) => check.name === "dangling").ok).toBe(false);
  });
});

describe("geometry graders", () => {
  it("counts a crossing between two unconnected arrows", () => {
    const items = [
      { id: "l1", type: "line", x: 0, y: 0, w: 100, h: 100, text: "", color: "#000000", author: "ai" },
      { id: "l2", type: "line", x: 0, y: 100, w: 100, h: -100, text: "", color: "#000000", author: "ai" },
    ];
    expect(segmentsIntersect(
      { a: { x: 0, y: 0 }, b: { x: 100, y: 100 } },
      { a: { x: 0, y: 100 }, b: { x: 100, y: 0 } },
    )).toBe(true);
    expect(countCrossings(boardFrom(items))).toHaveLength(1);
  });

  it("does not count arrows that share an endpoint as crossing", () => {
    const items = [
      { id: "l1", type: "line", x: 0, y: 0, w: 100, h: 100, text: "", color: "#000000", author: "ai", startItemId: "n1", endItemId: "n2" },
      { id: "l2", type: "line", x: 0, y: 0, w: 100, h: -100, text: "", color: "#000000", author: "ai", startItemId: "n1", endItemId: "n3" },
    ];
    expect(countCrossings(boardFrom(items))).toHaveLength(0);
  });

  it("catches an arrow drawn straight through an unrelated card", () => {
    const items = [
      { id: "a", type: "rect", x: 0, y: 40, w: 80, h: 60, text: "A", color: "#ffffff", author: "ai" },
      { id: "mid", type: "rect", x: 200, y: 20, w: 120, h: 100, text: "挡在中间", color: "#ffffff", author: "ai" },
      { id: "b", type: "rect", x: 440, y: 40, w: 80, h: 60, text: "B", color: "#ffffff", author: "ai" },
      { id: "l", type: "line", x: 80, y: 70, w: 360, h: 0, text: "", color: "#000000", author: "ai", startItemId: "a", endItemId: "b" },
    ];
    const hits = countEdgesThroughNodes(boardFrom(items));
    expect(hits).toHaveLength(1);
    expect(hits[0].label).toBe("挡在中间");
  });

  it("does not flag an arrow that only touches its own endpoints", () => {
    const items = [
      { id: "a", type: "rect", x: 0, y: 40, w: 80, h: 60, text: "A", color: "#ffffff", author: "ai" },
      { id: "b", type: "rect", x: 300, y: 40, w: 80, h: 60, text: "B", color: "#ffffff", author: "ai" },
      { id: "l", type: "line", x: 80, y: 70, w: 220, h: 0, text: "", color: "#000000", author: "ai", startItemId: "a", endItemId: "b" },
    ];
    expect(countEdgesThroughNodes(boardFrom(items))).toHaveLength(0);
  });
});

describe("budget grading", () => {
  const trace = {
    duration_ms: 5000,
    turns: [
      { tool: "get_board", bytes: 4000 },
      { tool: "draw_board", bytes: 6000 },
    ],
  };

  it("passes a run inside the limits", () => {
    expect(gradeBudget(trace, { max_tool_calls: 3, max_seconds: 10, max_bytes: 20000 }).exceeded).toBe(false);
  });

  it("names which limit was exceeded", () => {
    const result = gradeBudget(trace, { max_tool_calls: 1 });
    expect(result.exceeded).toBe(true);
    expect(result.reasons[0]).toContain("tool calls");
  });

  it("counts a retry as a call but never as a defect by itself", () => {
    const retried = {
      duration_ms: 6000,
      turns: [
        { tool: "draw_board", ok: false, bytes: 900 },
        { tool: "draw_board", ok: true, bytes: 6000 },
      ],
    };
    const result = gradeBudget(retried, { max_tool_calls: 3 });
    expect(result.exceeded).toBe(false);
    expect(result.calls).toBe(2);
  });
});

describe("furniture that a real model produces", () => {
  /*
   * Every rule below came from a live run where a correct drawing scored wrong.
   * They are kept together because they are one lesson: the generator and the
   * model both add things that are not graph nodes, and a grader that counts
   * them punishes good drawings.
   */
  const board = (items) => touchBoard({ ...createEmptyBoard(), items });
  const text = (id, value, role) => ({
    id, type: "text", x: 0, y: -60, w: 300, h: 30, text: value, color: "#1e1e1e",
    author: "ai", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    ...(role ? { role } : {}),
  });
  const shape = (id, value, x) => ({
    id, type: "rect", x, y: 0, w: 180, h: 90, text: value, color: "#dbeafe", author: "ai",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  });

  it("ignores an edge annotation instead of counting it as a node", () => {
    // "选择上线" labels the arrow to 上线; it repeats a node's own words.
    const subject = board([
      shape("a", "是否上线", 0), shape("b", "上线", 300), shape("c", "暂缓", 600),
      text("t1", "选择上线", "annotation"),
    ]);
    const result = gradeBoard(subject, { kind: "tree", nodes: ["是否上线", "上线", "暂缓"] });
    expect(result.structure.nodes.extra).toEqual([]);
    expect(result.structure.nodes.precision).toBe(1);
  });

  it("ignores a short diagram heading that names no node", () => {
    // "方案对比" is the diagram's title, not content.
    const subject = board([shape("a", "方案A", 0), shape("b", "方案B", 300), text("t1", "方案对比")]);
    const result = gradeBoard(subject, { kind: "comparison", nodes: ["方案A", "方案B"] });
    expect(result.structure.nodes.extra).toEqual([]);
  });

  it("still counts an unlisted text as extra — the check keeps its teeth", () => {
    const subject = board([shape("a", "方案A", 0), shape("b", "方案B", 300), text("t1", "随手写的第三方说明内容")]);
    const result = gradeBoard(subject, { kind: "comparison", nodes: ["方案A", "方案B"] });
    expect(result.structure.nodes.extra.length).toBe(1);
  });

  it("accepts content the case explicitly allows", () => {
    /*
     * Annotating a branch with "需停机 2 小时" makes the diagram better, but
     * precision would call it an invented node. The case says it is welcome.
     */
    const subject = board([
      shape("a", "是否迁移", 0), shape("b", "是", 300), shape("c", "否", 600),
      text("t1", "需停机 2 小时", "annotation"),
      {
        id: "n1", type: "note", x: 300, y: 160, w: 160, h: 60, text: "需停机 2 小时",
        color: "#ffec99", author: "ai",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const withoutAllow = gradeBoard(subject, { kind: "tree", nodes: ["是否迁移", "是", "否"] });
    const withAllow = gradeBoard(subject, { kind: "tree", nodes: ["是否迁移", "是", "否"], allow: ["需停机"] });
    expect(withoutAllow.structure.nodes.extra.length).toBe(1);
    expect(withAllow.structure.nodes.extra).toEqual([]);
    expect(withAllow.structure.nodes.precision).toBe(1);
  });

  it("does not call a legend overlapping content", () => {
    /*
     * The overlap check had its own node filter and kept the title, so a correct
     * branch diagram scored 1.00 and still failed with "1 overlapping pair".
     */
    const subject = board([
      shape("a", "提交", 0), shape("b", "审批", 300),
      { ...text("t1", "审批分支流程", "label"), x: 0, y: 0, w: 480, h: 120 },
    ]);
    const result = gradeBoard(subject, { kind: "sequence", ordered: true, nodes: ["提交", "审批"], forbid: ["overlap"] });
    expect(result.geometry.danglingConnectors).toBe(0);
    expect(result.checks.find((check) => check.name === "no_overlap").ok).toBe(true);
  });

  /*
   * The four cases below came from re-grading 305 recorded runs. Each was a
   * correct drawing scored as wrong, which is the failure mode that matters
   * most: a benchmark that does this teaches you to optimize against a lie.
   */
  it("accepts a vendor label that expands the single-letter name", () => {
    /*
     * The case asked for "A" and "B"; every model drew "供应商 A ｜ 低成本".
     * A one-character expected label can never match under the length floor, so
     * that case was unpassable. The fix is in the case (name what is drawn), not
     * in the matching rule, whose floor is what stops 会 matching 会议.
     */
    const subject = board([
      shape("a", "供应商 A · 成本优先", 0), shape("b", "供应商 B · 速度优先", 300),
    ]);
    const result = gradeBoard(subject, { kind: "comparison", nodes: ["供应商A", "供应商B"] });
    expect(result.structure.nodes.missing).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it("ignores a VS badge sitting between two groups", () => {
    // A comparison split by a small "VS" ellipse: punctuation, not content.
    const subject = board([
      shape("a", "方案 A", 0), shape("b", "方案 B", 300),
      {
        id: "vs", type: "ellipse", role: "label", x: 230, y: 20, w: 54, h: 36,
        text: "VS", color: "#ffffff", author: "ai",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const result = gradeBoard(subject, { kind: "comparison", nodes: ["方案A", "方案B"] });
    expect(result.structure.nodes.extra).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it("keeps a card named 对比 that is not between two groups", () => {
    /*
     * The divider rule must not become "a node called 对比 is furniture". With
     * no box to its right, this is content the model invented.
     */
    const subject = board([
      shape("a", "方案 A", 0), shape("b", "方案 B", 300),
      {
        id: "note", type: "note", x: 0, y: 200, w: 180, h: 60,
        text: "对比", color: "#ffec99", author: "ai",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const result = gradeBoard(subject, { kind: "comparison", nodes: ["方案A", "方案B"] });
    expect(result.structure.nodes.extra).toEqual(["对比"]);
  });

  it("ignores a footer sentence under the shapes inside the frame", () => {
    /*
     * "两条路径最终都汇合到上线" restates one node, so the enumeration rule
     * (two hits) missed it and precision failed an otherwise correct tree.
     */
    const subject = board([
      { ...shape("f", "", -20), type: "rect", role: "frame", w: 800, h: 480 },
      shape("a", "评估需求", 0), shape("b", "自建", 250), shape("c", "采购", 250),
      { ...text("t1", "两条路径最终都汇合到上线"), x: 0, y: 400, w: 760, h: 28 },
    ]);
    const result = gradeBoard(subject, {
      kind: "tree", nodes: ["评估需求", "自建", "采购"], edges: [["评估需求", "自建"], ["评估需求", "采购"]],
    });
    expect(result.structure.nodes.extra).toEqual([]);
  });

  it("ignores a single-entry connector legend", () => {
    // "连接：对比" is the caption of a one-arrow board, not a node.
    const subject = board([
      shape("a", "方案 A", 0), shape("b", "方案 B", 300),
      // The legend restates the arrow's own label, which is what makes it a caption.
      {
        id: "e1", type: "line", x: 190, y: 45, w: 100, h: 0, text: "对比", color: "#1e1e1e", author: "ai",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      },
      { ...text("t1", "连接：对比"), x: 0, y: 400 },
    ]);
    const result = gradeBoard(subject, { kind: "comparison", nodes: ["方案A", "方案B"] });
    expect(result.structure.nodes.extra).toEqual([]);
  });
});

describe("a node named outside its box", () => {
  /*
   * Some models draw a layer as a blank card with its name placed on top, which
   * reads identically to a person. Excluding every `role: label` text scored
   * such a diagram zero on all its nodes — a correct three-layer architecture
   * drawing graded as if nothing had been drawn.
   */
  const box = (id, x, y, w, h) => ({
    id, type: "rect", x, y, w, h, text: "", color: "#dbeafe", author: "ai",
    role: "step", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const caption = (id, value, x, y, w, h, role = "label") => ({
    id, type: "text", x, y, w, h, text: value, color: "#1e1e1e", role,
    author: "ai", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const subject = () => touchBoard({ ...createEmptyBoard(), items: [
    box("b1", 150, 85, 500, 140), box("b2", 150, 305, 500, 140), box("b3", 150, 525, 500, 140),
    caption("l1", "接入层", 170, 104, 460, 42),
    caption("l2", "服务层", 170, 324, 460, 42),
    caption("l3", "存储层", 170, 544, 460, 42),
  ] });

  it("counts labels sitting on a card as that card's name", () => {
    const result = gradeBoard(subject(), { kind: "tree", nodes: ["接入层", "服务层", "存储层"] });
    expect(result.structure.nodes.recall).toBe(1);
    expect(result.structure.nodes.precision).toBe(1);
  });

  it("does not mistake a wide flat heading for a card name", () => {
    /*
     * A title can overlap several cards. It is wide and thin, while a card name
     * is contained by one card — that ratio is what keeps the heading out.
     */
    const board = touchBoard({ ...createEmptyBoard(), items: [
      box("b1", 0, 0, 200, 100), box("b2", 300, 0, 200, 100),
      caption("t", "整体架构", 0, 0, 500, 24),
    ] });
    const result = gradeBoard(board, { kind: "tree", nodes: ["A", "B"] });
    expect(result.structure.nodes.extra).toEqual([]);
  });
});

describe("a constraint on a branch", () => {
  /*
   * "在「是」的分支上标注「需停机 2 小时」" was declared as a node, which made
   * the case unpassable by the annotation it asked for. Recorded runs drew it
   * two legitimate ways; both must satisfy the declaration, and neither may be
   * satisfied by a constraint that is merely somewhere on the board.
   */
  const node = (id, value, x, y) => ({
    id, type: "rect", x, y, w: 200, h: 90, text: value, color: "#dbeafe", author: "ai",
    role: "step", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const arrow = (id, from, to, x, y, w, h, label = "") => ({
    id, type: "line", x, y, w, h, text: label, color: "#1e1e1e", author: "ai",
    startItemId: from, endItemId: to,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const expectSpec = {
    kind: "tree",
    nodes: ["是否迁移", "是", "否"],
    edges: [["是否迁移", "是"], ["是否迁移", "否"]],
    edge_labels: [{ from: "是否迁移", to: "是", text: "需停机 2 小时" }],
    allow_edges: [["是", "需停机 2 小时"]],
    /*
     * The case also allows the constraint *as a node*, because that is how a
     * downstream card reads. `allow` and `edge_labels` describe one thing from
     * two directions: whichever layout the model chose, it must be attached.
     */
    allow: ["需停机"],
  };

  it("accepts the constraint written into the connector's own text", () => {
    const subject = boardFrom([
      node("q", "是否迁移", 0, 0), node("y", "是", 250, 0), node("n", "否", 250, 200),
      arrow("e1", "q", "y", 200, 40, 50, 0, "需停机 2 小时"),
      arrow("e2", "q", "n", 200, 60, 50, 140),
    ]);
    const result = gradeBoard(subject, expectSpec);
    expect(result.structure.nodes.missing).toEqual([]);
    expect(result.checks.find((check) => check.name === "edge_labels").ok).toBe(true);
    expect(result.pass).toBe(true);
  });

  it("accepts the constraint drawn as a card hanging off the branch", () => {
    const subject = boardFrom([
      node("q", "是否迁移", 0, 0), node("y", "是", 400, 0), node("n", "否", 400, 220),
      node("c", "需停机 2 小时", 400, 110),
      arrow("e1", "q", "y", 200, 40, 50, 0),
      arrow("e2", "q", "n", 200, 60, 50, 140),
      arrow("e3", "y", "c", 500, 90, 0, 20),
    ]);
    const result = gradeBoard(subject, expectSpec);
    expect(result.structure.edges.f1).toBe(1);
    expect(result.checks.find((check) => check.name === "edge_labels").ok).toBe(true);
    expect(result.pass).toBe(true);
  });

  it("rejects a constraint that is not attached to its branch", () => {
    // Same board, but the constraint card floats with no arrow to it.
    const subject = boardFrom([
      node("q", "是否迁移", 0, 0), node("y", "是", 250, 0), node("n", "否", 250, 200),
      node("c", "需停机 2 小时", 600, 400),
      arrow("e1", "q", "y", 200, 40, 50, 0),
      arrow("e2", "q", "n", 200, 60, 50, 140),
    ]);
    const result = gradeBoard(subject, expectSpec);
    expect(result.checks.find((check) => check.name === "edge_labels").ok).toBe(false);
    expect(result.pass).toBe(false);
  });

  it("still fails when an expected edge is missing", () => {
    // allow_edges pardons extras only; a missing edge is still an error.
    const subject = boardFrom([
      node("q", "是否迁移", 0, 0), node("y", "是", 250, 0), node("n", "否", 250, 200),
      arrow("e1", "q", "y", 200, 40, 50, 0, "需停机 2 小时"),
    ]);
    const result = gradeBoard(subject, expectSpec);
    expect(result.structure.edges.f1).toBeLessThan(1);
    expect(result.pass).toBe(false);
  });
});
