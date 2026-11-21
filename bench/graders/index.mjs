/**
 * Grade one board against one expectation.
 *
 * Layers, heaviest first:
 *   structure  did it hold the graph the case asked for (the score that matters)
 *   geometry   is it readable (crossings, arrows through cards, density)
 *   budget     was it produced within the call/time/byte limits
 *
 * A case passes on structure alone. Geometry failures are reported but only
 * fail a case when the case says they matter (`expect.forbid`), because a
 * perfectly correct flow can still be drawn with one crossing and shipping
 * that as a hard failure would make the benchmark noisy.
 */

import { gradeBranchConstraints, gradeEdges, gradeNodes, gradeSequence, gradeTree, nodesOf } from "./structure.mjs";
import { gradeGeometry } from "./geometry.mjs";

export const DEFAULT_WEIGHTS = {
  nodeRecall: 0.25,
  nodePrecision: 0.1,
  edgeF1: 0.45,
  sequence: 0.2,
};

/**
 * @param {object} board      Board v1 (from `get_board`, view: full)
 * @param {object} expect     the case's `expect` block
 * @param {object} [options]
 * @param {object} [options.trace]  recorded turns, for budget checks
 * @param {object} [options.weights]
 */
export function gradeBoard(board, expect, options = {}) {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const nodes = gradeNodes(board, expect);
  const edges = gradeEdges(board, expect);
  const sequence = expect.kind === "sequence" || expect.ordered ? gradeSequence(board, expect) : { ok: true };
  const tree = expect.depth ? gradeTree(board, expect) : { ok: true };
  const edgeLabels = gradeBranchConstraints(board, expect);
  const geometry = gradeGeometry(board);

  const checks = [];
  const fail = (name, detail) => checks.push({ name, ok: false, detail });
  const pass = (name, detail) => checks.push({ name, ok: true, detail });

  nodes.missing.length ? fail("node_recall", `missing: ${nodes.missing.join(", ")}`) : pass("node_recall");
  nodes.extra.length && expect.nodes ? fail("node_precision", `extra: ${nodes.extra.join(", ")}`) : pass("node_precision");
  edges.f1 < 1 ? fail("edge_f1", `f1=${edges.f1.toFixed(2)}, missing ${edges.missing.length} edge(s)`) : pass("edge_f1");
  sequence.ok ? pass("sequence") : fail("sequence", sequence.reason);
  tree.ok ? pass("tree") : fail("tree", `${tree.wrong?.length ?? 0} node(s) at the wrong depth`);
  edgeLabels.ok ? pass("edge_labels") : fail("edge_labels", `missing on connector: ${edgeLabels.missing.join(", ")}`);
  geometry.danglingConnectors ? fail("dangling", `${geometry.danglingConnectors} connector(s) bound to nothing`) : pass("dangling");

  const forbid = new Set(expect.forbid ?? []);
  if (forbid.has("crossing")) {
    geometry.crossings ? fail("no_crossing", `${geometry.crossings} crossing(s)`) : pass("no_crossing");
  }
  if (forbid.has("overlap")) {
    // Overlap is already computed by the board's own diagnosis; grade it from
    // geometry so a recorded board can be re-graded without the server.
    const overlapping = countOverlappingNodes(board);
    overlapping ? fail("no_overlap", `${overlapping} overlapping pair(s)`) : pass("no_overlap");
  }
  if (forbid.has("through_node")) {
    geometry.edgesThroughNodes ? fail("no_through", `${geometry.edgesThroughNodes} arrow(s) cross a card`) : pass("no_through");
  }
  if (expect.max_crossings !== undefined) {
    geometry.crossings > expect.max_crossings
      ? fail("max_crossings", `${geometry.crossings} > ${expect.max_crossings}`)
      : pass("max_crossings");
  }

  const budget = gradeBudget(options.trace, expect.budget);
  if (budget.exceeded) fail("budget", budget.reasons.join("; "));
  else pass("budget");

  /*
   * Structure score. `sequence` and `tree` fold into the same 0-1 scale rather
   * than being separate multipliers, so one broken shape cannot drag a case to
   * zero while its nodes and edges are otherwise right — the report needs to say
   * *what* is wrong, not just that the total is low.
   */
  const structureScore = clamp01(
    nodes.recall * weights.nodeRecall
    + nodes.precision * weights.nodePrecision
    + edges.f1 * weights.edgeF1
    + (sequence.ok && tree.ok ? 1 : 0) * weights.sequence,
  );

  const structuralPass = nodes.recall === 1 && nodes.precision === 1 && edges.f1 === 1
    && sequence.ok && tree.ok && edgeLabels.ok;
  const hardFailure = checks.some((check) => !check.ok && !["node_precision", "edge_f1"].includes(check.name));

  return {
    score: structureScore,
    // `pass` is the CI gate: the graph was right and nothing hard failed.
    pass: structuralPass && !hardFailure,
    structure: { nodes, edges, sequence, tree },
    geometry,
    budget,
    checks,
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function countOverlappingNodes(board) {
  /*
   * Use the same node set the structure grader uses.
   *
   * This had its own filter, which kept the generator's frame, title, and
   * subtitle. A correct branch diagram then "overlapped" because its legend sat
   * on top of a card — the score said 1.00 and the case still failed, which is
   * the most confusing possible output.
   */
  const nodes = nodesOf(board);
  const padding = 2;
  let count = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.x < b.x + b.w - padding && a.x + a.w > b.x + padding
        && a.y < b.y + b.h - padding && a.y + a.h > b.y + padding) count += 1;
    }
  }
  return count;
}

/**
 * Budget check over a recorded trace.
 *
 * Retries are counted as calls but not as failures: a model that hits
 * `SIZE_OUT_OF_RANGE`, reads `ERROR_JSON`, and fixes it demonstrated the repair
 * contract working, which is a product goal rather than a defect.
 */
export function gradeBudget(trace, budget) {
  if (!trace || !budget) return { exceeded: false, reasons: [] };
  const reasons = [];
  const calls = trace.turns?.length ?? 0;
  const durationMs = trace.duration_ms ?? 0;
  const bytes = (trace.turns ?? []).reduce((sum, turn) => sum + (turn.bytes ?? 0), 0);
  if (budget.max_tool_calls !== undefined && calls > budget.max_tool_calls) {
    reasons.push(`${calls} tool calls > ${budget.max_tool_calls}`);
  }
  if (budget.max_seconds !== undefined && durationMs > budget.max_seconds * 1000) {
    reasons.push(`${(durationMs / 1000).toFixed(1)}s > ${budget.max_seconds}s`);
  }
  if (budget.max_bytes !== undefined && bytes > budget.max_bytes) {
    reasons.push(`${bytes} B > ${budget.max_bytes} B`);
  }
  return { exceeded: reasons.length > 0, reasons, calls, durationMs, bytes };
}

export { gradeEdges, gradeGeometry, gradeNodes, gradeSequence, gradeTree };
