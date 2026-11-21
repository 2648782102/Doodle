/**
 * The report path is what turns a run into a decision, so its failure modes
 * matter as much as its happy path: a trace without a board must not silently
 * read as "the model drew nothing", and a comparison across changed prompts
 * must refuse rather than print a confident number.
 */
import { describe, expect, it } from "vitest";
/*
 * Import the model from `src`, not `dist`.
 *
 * These tests build their fixtures with the real diagram generator, which the
 * product code owns. Reading `dist` made `npm test` fail on a clean checkout —
 * `dist` is gitignored and only exists after a build — and it silently tested
 * the last build rather than the code being edited. Vitest transforms
 * TypeScript, and the repository already reads `src` this way in
 * `test/write-pipeline-and-loop.test.mjs`, so the only thing the build artifact
 * was adding here was a stale copy.
 *
 * The end-to-end matrix run still goes through `dist/index.js`: that one is
 * deliberate, because it measures the artifact a person installs.
 */
import { createEmptyBoard, diagramToBoardItems, touchBoard } from "../src/board/types.ts";
import { expandRecipe } from "../src/board/diagram/recipe.ts";
import { assertTrace, makeTrace, shortHash } from "./trace.mjs";
import {
  clusterFailures, compareRuns, gradeTraces, renderMarkdown,
  summarizeByCase, summarizeByKind, summarizeByModel, wilsonInterval,
} from "./report.mjs";

function flowBoard(steps) {
  return touchBoard({ ...createEmptyBoard(), items: diagramToBoardItems(expandRecipe({ recipe: "flow", steps }), "ai") });
}

const CASES = new Map([
  ["flow/ok", { id: "flow/ok", expect: { kind: "sequence", ordered: true, nodes: ["A", "B", "C"] } }],
  ["flow/short", { id: "flow/short", expect: { kind: "sequence", ordered: true, nodes: ["A", "B", "C"] } }],
]);

const PROMPT = shortHash("p1");
const TOOLS = shortHash("t1");

function trace(id, board, overrides = {}) {
  return makeTrace({
    case: id,
    model: "test",
    prompt_hash: PROMPT,
    tool_desc_hash: TOOLS,
    duration_ms: 1000,
    turns: [{ tool: "get_board", ok: true, bytes: 100 }],
    final_board: board,
    ...overrides,
  });
}

describe("trace shape", () => {
  it("refuses a trace with no board instead of grading it as empty", () => {
    // This is the difference between "the model drew nothing" and "the
    // recorder lost the board"; conflating them would poison the averages.
    expect(() => assertTrace({ version: 1, case: "x", turns: [], final_board: undefined }))
      .toThrow(/final_board/);
    expect(() => assertTrace({ version: 1, case: "x", turns: [] })).toThrow(/final_board/);
  });

  it("refuses an unknown trace version", () => {
    expect(() => assertTrace({ version: 99, case: "x", turns: [], final_board: { items: [] } }))
      .toThrow(/version/);
  });

  it("hashes prompt and tool descriptions so an experiment change is visible", () => {
    expect(shortHash("a")).not.toBe(shortHash("b"));
    expect(shortHash("same")).toBe(shortHash("same"));
  });
});

describe("grading a run", () => {
  it("grades each trace and carries the failed check names", () => {
    const { rows } = gradeTraces([
      trace("flow/ok", flowBoard(["A", "B", "C"])),
      trace("flow/short", flowBoard(["A", "B"])),
    ], CASES);
    expect(rows).toHaveLength(2);
    expect(rows[0].pass).toBe(true);
    expect(rows[1].pass).toBe(false);
    expect(rows[1].failed).toContain("node_recall");
  });

  it("keeps a trace whose case is unknown, so a broken case file is visible", () => {
    const { rows, unknown } = gradeTraces([trace("flow/missing", flowBoard(["A"]))], CASES);
    expect(rows).toHaveLength(0);
    expect(unknown).toEqual(["flow/missing"]);
  });

  it("counts a rejection as a retry, not as a failure by itself", () => {
    const withRetry = trace("flow/ok", flowBoard(["A", "B", "C"]), {
      turns: [
        { tool: "draw_board", ok: false, error: { code: "BATCH_TOO_LARGE" } },
        { tool: "draw_board", ok: true, bytes: 500 },
      ],
    });
    const { rows } = gradeTraces([withRetry], CASES);
    expect(rows[0].retries).toBe(1);
    expect(rows[0].pass).toBe(true);
  });
});

describe("failure clustering", () => {
  it("ranks checks by how often they fail, which is what tells you what to fix", () => {
    const { rows } = gradeTraces([
      trace("flow/ok", flowBoard(["A", "B", "C"])),
      trace("flow/short", flowBoard(["A", "B"])),
      trace("flow/short", flowBoard(["A"])),
    ], CASES);
    const clusters = clusterFailures(rows);
    expect(clusters[0].check).toBe("node_recall");
    expect(clusters[0].count).toBe(2);
    expect(clusters[0].of).toBe(3);
  });
});

describe("comparing runs", () => {
  const baseline = gradeTraces([trace("flow/ok", flowBoard(["A", "B"]))], CASES).rows;
  const improved = gradeTraces([trace("flow/ok", flowBoard(["A", "B", "C"]))], CASES).rows;

  it("reports a delta when the experiment held constant", () => {
    const result = compareRuns(baseline, improved);
    expect(result.comparable).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.passRate).toBeGreaterThan(0);
  });

  it("refuses to compare across a prompt change", () => {
    const changed = gradeTraces([trace("flow/ok", flowBoard(["A", "B", "C"]), { prompt_hash: "other" })], CASES).rows;
    const result = compareRuns(baseline, changed);
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/prompt or tool descriptions/);
  });

  it("refuses to compare across a tool-description change", () => {
    const changed = gradeTraces([trace("flow/ok", flowBoard(["A", "B", "C"]), { tool_desc_hash: "other" })], CASES).rows;
    expect(compareRuns(baseline, changed).comparable).toBe(false);
  });
});

describe("markdown report", () => {
  const { rows, unknown } = gradeTraces([
    trace("flow/ok", flowBoard(["A", "B", "C"])),
    trace("flow/short", flowBoard(["A", "B"]), { duration_ms: 2000 }),
  ], CASES);

  it("states what to fix rather than only an average", () => {
    const markdown = renderMarkdown({ rows, unknown });
    expect(markdown).toContain("Failure clusters");
    expect(markdown).toContain("node_recall");
    expect(markdown).toContain("sequence");
  });

  it("reports repair behaviour separately from failure", () => {
    const withRetry = gradeTraces([
      trace("flow/ok", flowBoard(["A", "B", "C"]), { turns: [{ tool: "draw_board", ok: false }, { tool: "draw_board", ok: true }] }),
    ], CASES);
    const markdown = renderMarkdown(withRetry);
    expect(markdown).toContain("repair successes");
  });

  it("lists unmatched traces instead of silently dropping them", () => {
    const markdown = renderMarkdown({ rows, unknown: ["ghost/case"] });
    expect(markdown).toContain("Unmatched traces");
    expect(markdown).toContain("ghost/case");
  });

  it("says so when everything passed, without congratulating itself", () => {
    const allPass = gradeTraces([trace("flow/ok", flowBoard(["A", "B", "C"]))], CASES);
    expect(renderMarkdown(allPass)).toContain("Consider adding harder cases");
  });

  it("summarises by category with the metrics a person actually reads", () => {
    const groups = summarizeByKind(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "sequence", count: 2 });
    expect(groups[0].passRate).toBe(0.5);
  });
});

describe("multi-model comparison", () => {
  /*
   * A model-level average hides the shape of a difference: one model can fail
   * every hard case while another fails every long one, and both average the
   * same. The per-case matrix is what makes the comparison actionable, so it is
   * asserted separately from the summary.
   */
  const rows = [
    { case: "a", kind: "sequence", model: "m1", score: 1, pass: true, failed: [],
      structure: { nodes: { recall: 1 }, edges: { f1: 1 } }, geometry: { crossings: 0 },
      budget: {}, durationMs: 1000, turns: 2, retries: 0, promptHash: "p", toolDescHash: "t" },
    { case: "b", kind: "tree", model: "m1", score: 0.5, pass: false, failed: ["edge_f1"],
      structure: { nodes: { recall: 1 }, edges: { f1: 0.5 } }, geometry: { crossings: 1 },
      budget: {}, durationMs: 3000, turns: 3, retries: 0, promptHash: "p", toolDescHash: "t" },
    { case: "a", kind: "sequence", model: "m2", score: 1, pass: true, failed: [],
      structure: { nodes: { recall: 1 }, edges: { f1: 1 } }, geometry: { crossings: 0 },
      budget: {}, durationMs: 2000, turns: 2, retries: 0, promptHash: "p", toolDescHash: "t" },
    { case: "b", kind: "tree", model: "m2", score: 1, pass: true, failed: [],
      structure: { nodes: { recall: 1 }, edges: { f1: 1 } }, geometry: { crossings: 0 },
      budget: {}, durationMs: 2000, turns: 2, retries: 0, promptHash: "p", toolDescHash: "t" },
  ];

  it("ranks models by score", () => {
    const summary = summarizeByModel(rows);
    expect(summary.map((entry) => entry.model)).toEqual(["m2", "m1"]);
    expect(summary[0].passRate).toBe(1);
    expect(summary[1].passRate).toBe(0.5);
  });

  it("prints a per-case matrix, not only the average", () => {
    const markdown = renderMarkdown({ rows, unknown: [] });
    expect(markdown).toContain("## By model");
    expect(markdown).toContain("### Per case");
    // m1 fails case b while passing a — the matrix must show both.
    expect(markdown).toMatch(/\| b \|.*✅ 1\.00.*\|/);
    expect(markdown).toMatch(/\| b \|.*❌ 0\.50.*\|/);
  });
});


describe("repeated sampling", () => {
  /*
   * One attempt per case cannot separate a real difference from noise: a model
   * that scores 82% once may score 88% next time, and the model it is compared
   * with may genuinely be 85%. These tests are about reporting that honestly
   * rather than producing a confident ranking from three coin flips.
   */
  const row = (model, testCase, pass, score = pass ? 1 : 0.5) => ({
    case: testCase, kind: "sequence", model, score, pass, failed: pass ? [] : ["edge_f1"],
    structure: { nodes: { recall: 1 }, edges: { f1: pass ? 1 : 0.5 } },
    geometry: { crossings: 0 }, budget: {}, durationMs: 1000, turns: 2, retries: 0,
    promptHash: "p", toolDescHash: "t",
  });

  it("reports an interval that widens when the sample is small", () => {
    /*
     * The naive interval is unusable here: at 3/3 it collapses to zero width and
     * claims certainty, and near 1.0 it can extend past 100%. Wilson stays
     * inside [0,1] and keeps the uncertainty visible.
     */
    const tiny = wilsonInterval(3, 3);
    const large = wilsonInterval(300, 300);
    expect(tiny.low).toBeGreaterThan(0);
    expect(tiny.low).toBeLessThan(0.6);
    expect(large.low).toBeGreaterThan(0.98);
    expect(tiny.high).toBeLessThanOrEqual(1);
    expect(large.high).toBeLessThanOrEqual(1);
  });

  it("never reports an interval outside 0..1", () => {
    for (const [passes, total] of [[0, 3], [1, 3], [3, 3], [0, 1]]) {
      const interval = wilsonInterval(passes, total);
      expect(interval.low).toBeGreaterThanOrEqual(0);
      expect(interval.high).toBeLessThanOrEqual(1);
      expect(interval.low).toBeLessThanOrEqual(interval.high);
    }
  });

  it("treats a mixed pass/fail case as unstable, not as a verdict", () => {
    const rows = [row("m1", "a", true), row("m1", "a", false), row("m1", "a", true)];
    const summary = summarizeByCase(rows);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ attempts: 3, passes: 2, unstable: true });
  });

  it("does not call a case unstable when every attempt agrees", () => {
    const allPass = summarizeByCase([row("m1", "a", true), row("m1", "a", true)]);
    const allFail = summarizeByCase([row("m1", "b", false), row("m1", "b", false)]);
    expect(allPass[0].unstable).toBe(false);
    expect(allFail[0].unstable).toBe(false);
  });

  it("counts attempts separately from cases", () => {
    // A model with 2 cases × 3 attempts is 6 rows, not 6 cases.
    const rows = ["a", "b"].flatMap((testCase) => [1, 2, 3].map(() => row("m1", testCase, true)));
    const [summary] = summarizeByModel(rows);
    expect(summary.count).toBe(6);
    expect(summary.cases).toBe(2);
  });

  it("shows the ratio in the per-case matrix once a case is repeated", () => {
    const rows = [
      row("m1", "a", true), row("m1", "a", true), row("m1", "a", false),
      row("m2", "a", true), row("m2", "a", true), row("m2", "a", true),
    ];
    const markdown = renderMarkdown({ rows, unknown: [] });
    expect(markdown).toContain("⚠️ 2/3");
    expect(markdown).toContain("✅ 3/3");
  });

  it("names the unstable cases so a report cannot hide them behind an average", () => {
    const rows = [
      row("m1", "steady", true), row("m1", "steady", true),
      row("m1", "coin", true), row("m1", "coin", false),
    ];
    const markdown = renderMarkdown({ rows, unknown: [] });
    expect(markdown).toContain("### Stability");
    expect(markdown).toContain("coin");
    expect(markdown).not.toContain("steady — 2/2");
  });
});
