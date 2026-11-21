/**
 * The judge layer exists to catch a specific failure: the graph is right but
 * the case was written too literally. Its tests therefore care most about the
 * disagreement cases, and about never inventing a verdict from unusable output.
 */
import { describe, expect, it } from "vitest";
import { judgePrompt, parseVerdict, reconcile, renderForJudge } from "./human-judge.mjs";

const rect = (id, text, extra = {}) => ({
  id, type: "rect", x: 0, y: 0, w: 100, h: 60, text, color: "#dbeafe", author: "ai",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...extra,
});
const line = (id, from, to, text = "") => ({
  id, type: "line", x: 0, y: 0, w: 100, h: 0, text, color: "#000", author: "ai",
  startItemId: from, endItemId: to,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});
const board = (items) => ({ version: 1, id: "b", title: "t", revision: 1, updatedAt: "2026-01-01T00:00:00.000Z", notes: [], items });

describe("rendering a board for review", () => {
  it("shows nodes and edges with their labels", () => {
    const text = renderForJudge(board([
      rect("a", "是否迁移数据库"),
      rect("b", "是"),
      line("l1", "a", "b", "需停机 2 小时"),
    ]));
    expect(text).toContain("是否迁移数据库");
    expect(text).toContain("是否迁移数据库 → 是");
    expect(text).toContain("标签:需停机 2 小时");
  });

  it("keeps the constraint that lives in an edge label visible", () => {
    /*
     * This is the exact drawing that made the judge layer worth building: the
     * constraint was on the connector, the structural grader could not see it,
     * and a reader could.
     */
    const text = renderForJudge(board([
      rect("a", "是否迁移数据库"), rect("b", "是：迁移数据库"),
      line("l1", "a", "b", "是 · 约束：需停机 2 小时"),
    ]));
    expect(text).toContain("需停机 2 小时");
  });

  it("omits coordinates so the reviewer judges meaning, not numbers", () => {
    const text = renderForJudge(board([rect("a", "A", { x: 1234, y: 567 }) ]));
    expect(text).not.toContain("1234");
    expect(text).not.toContain("567");
  });

  it("marks an unbound connector instead of hiding it", () => {
    // A dangling arrow looks connected to a reader; the reviewer must not be
    // told it points somewhere.
    const text = renderForJudge(board([line("l1", "ghost", "gone")]));
    expect(text).toContain("未绑定");
  });

  it("lists free text separately from nodes", () => {
    const text = renderForJudge(board([
      rect("a", "A"),
      { id: "n1", type: "text", x: 0, y: 90, w: 200, h: 20, text: "上层依赖下层，自上而下",
        color: "#000", author: "ai", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]));
    expect(text).toContain("其他文字");
    expect(text).toContain("上层依赖下层");
  });
});

describe("the judge prompt", () => {
  const testCase = { id: "x", prompt: "画一个二选一决策" };

  it("carries the request, the drawing, and the answer shape", () => {
    const prompt = judgePrompt(testCase, board([rect("a", "是否上线")]));
    expect(prompt).toContain(testCase.prompt);
    expect(prompt).toContain("是否上线");
    expect(prompt).toContain('"verdict"');
  });

  it("tells the reviewer that a connector label counts as expressed", () => {
    // Without this the judge repeats the structural grader's blind spot.
    expect(judgePrompt(testCase, board([]))).toMatch(/连接标签|说明文字/);
  });

  it("never reveals which model drew the board or what it scored", () => {
    const prompt = judgePrompt(testCase, board([rect("a", "A")]));
    expect(prompt).not.toMatch(/blind-model/);
    expect(prompt).not.toMatch(/score.*structural/i);
  });
});

describe("parsing a verdict", () => {
  it("reads a bare JSON object", () => {
    const parsed = parseVerdict('{"verdict":"pass","score":100,"issues":[]}');
    expect(parsed).toMatchObject({ ok: true, verdict: "pass", score: 100 });
  });

  it("reads JSON wrapped in a code fence", () => {
    const parsed = parseVerdict('评审如下：\n```json\n{"verdict":"fail","score":35,"issues":["缺少回退边"]}\n```');
    expect(parsed).toMatchObject({ ok: true, verdict: "fail", score: 35 });
    expect(parsed.issues).toEqual(["缺少回退边"]);
  });

  it("refuses to invent a verdict from prose", () => {
    // A fabricated score is worse than a missing one.
    const parsed = parseVerdict("这张图整体不错，我觉得可以通过。");
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toMatch(/no JSON/);
  });

  it("refuses malformed or incomplete JSON", () => {
    expect(parseVerdict('{"verdict":"pass"').ok).toBe(false);
    expect(parseVerdict('{"issues":[]}').ok).toBe(false);
  });

  it("clamps a score outside the range instead of trusting it", () => {
    expect(parseVerdict('{"verdict":"pass","score":140}').score).toBe(100);
    expect(parseVerdict('{"verdict":"fail","score":-20}').score).toBe(0);
  });

  it("caps the issue list so one reply cannot flood the report", () => {
    const issues = Array.from({ length: 9 }, (_, i) => `问题${i}`);
    const parsed = parseVerdict(JSON.stringify({ verdict: "fail", score: 10, issues }));
    expect(parsed.issues).toHaveLength(4);
  });
});

describe("reconciling two verdicts", () => {
  it("records agreement in both directions", () => {
    expect(reconcile({ pass: true }, { ok: true, verdict: "pass" }).category).toBe("agree-pass");
    expect(reconcile({ pass: false }, { ok: true, verdict: "fail" }).category).toBe("agree-fail");
  });

  it("names the case where a reader saves a structurally-failed drawing", () => {
    /*
     * The most valuable outcome: structure failed, a reader passed it. The case
     * is probably too literal, which is a benchmark bug rather than a model bug.
     */
    expect(reconcile({ pass: false }, { ok: true, verdict: "pass" }).category).toBe("judge-saves");
  });

  it("names the case where a reader is stricter than the graph", () => {
    // Structure passed but the reviewer found a semantic error no coordinate
    // check can see.
    expect(reconcile({ pass: true }, { ok: true, verdict: "fail" }).category).toBe("judge-stricter");
  });

  it("reports an unparseable reply instead of guessing", () => {
    expect(reconcile({ pass: true }, { ok: false, reason: "no JSON" }))
      .toMatchObject({ category: "unknown", reason: "no JSON" });
  });
});
