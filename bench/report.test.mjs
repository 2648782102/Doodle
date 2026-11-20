/**
 * The report path is what turns a run into a decision, so its failure modes
 * matter as much as its happy path: a trace without a board must not silently
 * read as "the model drew nothing", and a comparison across changed prompts
 * must refuse rather than print a confident number.
 */
import { describe, expect, it } from "vitest";
import { createEmptyBoard, diagramToBoardItems, touchBoard } from "../dist/board/types.js";
import { expandRecipe } from "../dist/board/diagram/recipe.js";
import { assertTrace, makeTrace, shortHash } from "./trace.mjs";
import { clusterFailures, compareRuns, gradeTraces, renderMarkdown, summarizeByKind } from "./report.mjs";

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
