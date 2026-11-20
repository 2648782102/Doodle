/**
 * Turn graded traces into a report a person can act on.
 *
 * A single average score is close to useless: 0.87 could mean "usually right",
 * or "always one node short", and those need opposite fixes. The report is
 * therefore built around **failure clusters** — which check failed, on how many
 * cases, in which category — because that is the part that says what to change
 * next.
 *
 * Pure: traces in, report out. No model, no I/O, no clock beyond the traces.
 */

import { gradeBoard } from "./graders/index.mjs";

/**
 * Grade every trace against its case and collect the rows.
 *
 * A trace whose case is unknown is reported, not skipped: silently dropping it
 * would make a broken case list look like a clean run.
 */
export function gradeTraces(traces, casesById) {
  const rows = [];
  const unknown = [];
  for (const trace of traces) {
    const testCase = casesById.get(trace.case);
    if (!testCase) {
      unknown.push(trace.case);
      continue;
    }
    const result = gradeBoard(trace.final_board, testCase.expect, { trace });
    rows.push({
      case: trace.case,
      kind: testCase.expect?.kind ?? "freeform",
      model: trace.model,
      score: result.score,
      pass: result.pass,
      failed: result.checks.filter((check) => !check.ok).map((check) => check.name),
      structure: result.structure,
      geometry: result.geometry,
      budget: result.budget,
      durationMs: trace.duration_ms,
      turns: trace.turns.length,
      retries: trace.turns.filter((turn) => turn.ok === false).length,
      promptHash: trace.prompt_hash,
      toolDescHash: trace.tool_desc_hash,
    });
  }
  return { rows, unknown };
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

/** Aggregate rows by case category. */
export function summarizeByKind(rows) {
  const groups = new Map();
  for (const row of rows) {
    const list = groups.get(row.kind) ?? [];
    list.push(row);
    groups.set(row.kind, list);
  }
  return [...groups.entries()].map(([kind, list]) => ({
    kind,
    count: list.length,
    score: mean(list.map((row) => row.score)),
    passRate: mean(list.map((row) => (row.pass ? 1 : 0))),
    medianMs: median(list.map((row) => row.durationMs ?? 0)),
    crossingsPerCase: mean(list.map((row) => row.geometry.crossings)),
    nodesRecall: mean(list.map((row) => row.structure.nodes.recall)),
    edgeF1: mean(list.map((row) => row.structure.edges.f1)),
  }));
}

/**
 * Aggregate rows per model, so a comparison is one table instead of two reports
 * a person has to line up by hand.
 */
export function summarizeByModel(rows) {
  const groups = new Map();
  for (const row of rows) {
    const list = groups.get(row.model) ?? [];
    list.push(row);
    groups.set(row.model, list);
  }
  return [...groups.entries()]
    .map(([model, list]) => ({
      model,
      count: list.length,
      score: mean(list.map((row) => row.score)),
      passRate: mean(list.map((row) => (row.pass ? 1 : 0))),
      nodeRecall: mean(list.map((row) => row.structure.nodes.recall)),
      edgeF1: mean(list.map((row) => row.structure.edges.f1)),
      crossings: mean(list.map((row) => row.geometry.crossings)),
      medianMs: median(list.map((row) => row.durationMs ?? 0)),
      calls: mean(list.map((row) => row.turns)),
      retries: list.reduce((sum, row) => sum + row.retries, 0),
    }))
    .sort((left, right) => right.score - left.score);
}

/**
 * Which checks fail most often, and where.
 *
 * This is the actionable part: "edge_f1 failed in 5 of 12 sequence cases" tells
 * you the connector generation is the problem, while "average score 0.87" does
 * not.
 */
export function clusterFailures(rows, minCount = 1) {
  const counts = new Map();
  for (const row of rows) {
    for (const name of row.failed) {
      const entry = counts.get(name) ?? { name, count: 0, kinds: new Map(), cases: [] };
      entry.count += 1;
      entry.kinds.set(row.kind, (entry.kinds.get(row.kind) ?? 0) + 1);
      if (entry.cases.length < 3) entry.cases.push(row.case);
      counts.set(name, entry);
    }
  }
  return [...counts.values()]
    .filter((entry) => entry.count >= minCount)
    .sort((left, right) => right.count - left.count)
    .map((entry) => ({
      check: entry.name,
      count: entry.count,
      of: rows.length,
      byKind: Object.fromEntries(entry.kinds),
      examples: entry.cases,
    }));
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Compare two runs.
 *
 * Only called a comparison when the experiment was held constant: a different
 * prompt hash or tool-description hash makes the two runs incomparable, and the
 * caller must say so instead of printing a misleading delta. That check lives
 * here so every caller gets it.
 */
export function compareRuns(baselineRows, currentRows) {
  const keys = (rows) => [...new Set(rows.map((row) => `${row.promptHash}:${row.toolDescHash}`))];
  const baselineKeys = keys(baselineRows);
  const currentKeys = keys(currentRows);
  const comparable = baselineKeys.length === 1 && currentKeys.length === 1
    && baselineKeys[0] === currentKeys[0];
  if (!comparable) {
    return {
      comparable: false,
      reason: "prompt or tool descriptions changed between runs; treat this as a new baseline",
      baselineKeys,
      currentKeys,
    };
  }
  const metric = (rows, pick) => mean(rows.map(pick));
  return {
    comparable: true,
    score: metric(currentRows, (row) => row.score) - metric(baselineRows, (row) => row.score),
    passRate: metric(currentRows, (row) => (row.pass ? 1 : 0)) - metric(baselineRows, (row) => (row.pass ? 1 : 0)),
    medianMs: median(currentRows.map((row) => row.durationMs ?? 0)) - median(baselineRows.map((row) => row.durationMs ?? 0)),
    crossingsPerCase: metric(currentRows, (row) => row.geometry.crossings) - metric(baselineRows, (row) => row.geometry.crossings),
  };
}

/** The Markdown report. */
export function renderMarkdown({ rows, unknown, comparison, perModel = false }) {
  const lines = [];
  lines.push("# Doodle drawing benchmark");
  lines.push("");
  if (rows.length === 0) {
    lines.push("No graded cases.");
    return `${lines.join("\n")}\n`;
  }

  const total = rows.length;
  const passRate = mean(rows.map((row) => (row.pass ? 1 : 0)));
  const models = [...new Set(rows.map((row) => row.model))];
  lines.push(`Cases: ${total} · pass ${formatPercent(passRate)} · mean score ${mean(rows.map((row) => row.score)).toFixed(2)}`
    + (models.length > 1 ? ` · models: ${models.length}` : ""));
  lines.push("");

  if (perModel || models.length > 1) {
    lines.push("## By model");
    lines.push("");
    lines.push("| model | cases | score | pass | node recall | edge F1 | crossings | median ms | calls | retries |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const group of summarizeByModel(rows)) {
      lines.push(`| ${group.model} | ${group.count} | ${group.score.toFixed(2)} | ${formatPercent(group.passRate)} `
        + `| ${group.nodeRecall.toFixed(2)} | ${group.edgeF1.toFixed(2)} | ${group.crossings.toFixed(1)} `
        + `| ${group.medianMs} | ${group.calls.toFixed(1)} | ${group.retries} |`);
    }
    lines.push("");

    /*
     * Per-case matrix. A model-level average hides the shape of a difference:
     * one model may fail all the hard cases while another fails all the long
     * ones, and both average the same.
     */
    const caseIds = [...new Set(rows.map((row) => row.case))];
    lines.push("### Per case");
    lines.push("");
    lines.push(`| case | ${models.join(" | ")} |`);
    lines.push(`|---|${models.map(() => "---").join("|")}|`);
    for (const caseId of caseIds) {
      const cells = models.map((model) => {
        const row = rows.find((candidate) => candidate.case === caseId && candidate.model === model);
        if (!row) return "—";
        return `${row.pass ? "✅" : "❌"} ${row.score.toFixed(2)}`;
      });
      lines.push(`| ${caseId} | ${cells.join(" | ")} |`);
    }
    lines.push("");
  }

  lines.push("## By category");
  lines.push("");
  lines.push("| category | n | score | pass | node recall | edge F1 | crossings/case | median ms |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const group of summarizeByKind(rows)) {
    lines.push(`| ${group.kind} | ${group.count} | ${group.score.toFixed(2)} | ${formatPercent(group.passRate)} `
      + `| ${group.nodesRecall.toFixed(2)} | ${group.edgeF1.toFixed(2)} | ${group.crossingsPerCase.toFixed(1)} | ${group.medianMs} |`);
  }
  lines.push("");

  const clusters = clusterFailures(rows);
  lines.push("## Failure clusters");
  lines.push("");
  if (clusters.length === 0) {
    lines.push("Every case passed. Consider adding harder cases rather than celebrating.");
  } else {
    for (const cluster of clusters) {
      const kinds = Object.entries(cluster.byKind).map(([kind, count]) => `${kind} ${count}`).join(", ");
      lines.push(`- **${cluster.check}** — ${cluster.count}/${cluster.of} cases (${kinds})`);
      if (cluster.examples.length) lines.push(`  - e.g. ${cluster.examples.join(", ")}`);
    }
  }
  lines.push("");

  const retried = rows.filter((row) => row.retries > 0);
  lines.push("## Repair behaviour");
  lines.push("");
  lines.push(retried.length === 0
    ? "No case needed a retry — every first call was accepted."
    : `${retried.length}/${total} cases saw at least one rejected call and continued. `
      + `These are repair successes, not failures: they show the error was actionable. `
      + `Worst: ${retried.sort((a, b) => b.retries - a.retries)[0].case} (${retried[0].retries} rejections).`);
  lines.push("");

  if (unknown.length) {
    lines.push("## Unmatched traces");
    lines.push("");
    lines.push(`These traces named a case that is not in the case set, so they were not graded: ${[...new Set(unknown)].join(", ")}`);
    lines.push("");
  }

  if (comparison) {
    lines.push("## Versus baseline");
    lines.push("");
    if (!comparison.comparable) {
      lines.push(`Not comparable. ${comparison.reason}.`);
    } else {
      const sign = (value, digits = 2) => `${value >= 0 ? "↑" : "↓"}${Math.abs(value).toFixed(digits)}`;
      lines.push(`- score ${sign(comparison.score)}`);
      lines.push(`- pass rate ${sign(comparison.passRate * 100, 0)}pp`);
      lines.push(`- median time ${sign(comparison.medianMs, 0)} ms`);
      lines.push(`- crossings per case ${sign(comparison.crossingsPerCase, 1)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
