#!/usr/bin/env node
/**
 * Regenerate a report from recorded traces.
 *
 * Usage:
 *   node bench/run-report.mjs <traces-dir> [--compare <baseline-dir>] [--json <out>]
 *
 * This is the no-cost half of the benchmark: it reads what an executor already
 * wrote, so a grader fix or a new report section never requires another model
 * call. `--compare` refuses to report a delta when the prompt or tool
 * descriptions changed, because that would be a different experiment.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTrace } from "./trace.mjs";
import { clusterFailures, compareRuns, gradeTraces, renderMarkdown, summarizeByKind } from "./report.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function loadCases() {
  const dir = path.join(repoRoot, "bench", "cases");
  const files = await fs.readdir(dir).catch(() => []);
  const cases = [];
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const value = await readJson(path.join(dir, file));
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!item.id) throw new Error(`${file}: case has no id`);
      cases.push(item);
    }
  }
  return new Map(cases.map((item) => [item.id, item]));
}

async function loadTraces(dir) {
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
  if (files.length === 0) throw new Error(`no trace files in ${dir}`);
  const traces = [];
  for (const file of files) {
    const trace = assertTrace(await readJson(path.join(dir, file)));
    traces.push(trace);
  }
  return traces;
}

async function main() {
  const args = process.argv.slice(2);
  const [traceDir, ...rest] = args;
  if (!traceDir) {
    console.error("usage: node bench/run-report.mjs <traces-dir> [--compare <dir>] [--json <out>]");
    process.exit(2);
  }
  const compareIndex = rest.indexOf("--compare");
  const jsonIndex = rest.indexOf("--json");
  const compareDir = compareIndex >= 0 ? rest[compareIndex + 1] : undefined;
  const jsonOut = jsonIndex >= 0 ? rest[jsonIndex + 1] : undefined;

  const cases = await loadCases();
  const traces = await loadTraces(path.resolve(traceDir));
  const { rows, unknown } = gradeTraces(traces, cases);

  let comparison;
  if (compareDir) {
    const baseline = await loadTraces(path.resolve(compareDir));
    comparison = compareRuns(gradeTraces(baseline, cases).rows, rows);
  }

  process.stdout.write(renderMarkdown({ rows, unknown, comparison }));

  if (jsonOut) {
    const payload = {
      generated_at: new Date().toISOString(),
      by_kind: summarizeByKind(rows),
      clusters: clusterFailures(rows),
      rows,
      unknown,
      ...(comparison ? { comparison } : {}),
    };
    await fs.mkdir(path.dirname(path.resolve(jsonOut)), { recursive: true });
    await fs.writeFile(path.resolve(jsonOut), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  // Exit non-zero only when something is genuinely broken, not on low scores:
  // a benchmark that fails on "the model is not good enough yet" gets disabled.
  if (unknown.length > 0) process.exitCode = 1;
}

await main();
