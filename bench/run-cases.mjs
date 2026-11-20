#!/usr/bin/env node
/**
 * Execute cases against a real model and write traces.
 *
 * Usage:
 *   node bench/run-cases.mjs [--only <case-id>] [--out <dir>] [--concurrency <n>]
 *
 * Deliberately serial by default. Two concurrent runs would share a Codex
 * cache and make per-case cost and latency impossible to attribute; the run is
 * already minutes, not hours, at this scale.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { runCase, repoRoot } from "./executor.mjs";
import { assertTrace } from "./trace.mjs";

async function loadCases() {
  const dir = path.join(repoRoot, "bench", "cases");
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
  const cases = [];
  for (const file of files) {
    const value = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
    cases.push(...(Array.isArray(value) ? value : [value]));
  }
  return cases;
}

async function main() {
  const args = process.argv.slice(2);
  const onlyIndex = args.indexOf("--only");
  const outIndex = args.indexOf("--out");
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;
  const outDir = path.resolve(outIndex >= 0 ? args[outIndex + 1] : path.join(repoRoot, "bench", "runs", new Date().toISOString().replace(/[:.]/g, "-")));

  const cases = (await loadCases()).filter((testCase) => !only || testCase.id === only);
  if (cases.length === 0) {
    console.error(only ? `no case with id ${only}` : "no cases found");
    process.exit(2);
  }

  await fs.mkdir(outDir, { recursive: true });
  console.error(`running ${cases.length} case(s) → ${path.relative(repoRoot, outDir)}`);

  const failures = [];
  for (const testCase of cases) {
    process.stderr.write(`  ${testCase.id} … `);
    const startedAt = Date.now();
    try {
      const trace = assertTrace(await runCase(testCase));
      const file = path.join(outDir, `${testCase.id.replace(/[^a-z0-9]+/gi, "-")}.json`);
      await fs.writeFile(file, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
      process.stderr.write(`ok (${trace.turns.length} calls, ${Date.now() - startedAt} ms)\n`);
    } catch (error) {
      failures.push({ case: testCase.id, error: String(error.message ?? error) });
      process.stderr.write(`FAILED: ${error.message}\n`);
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} case(s) did not produce a trace:`);
    for (const failure of failures) console.error(`  ${failure.case}: ${failure.error}`);
    process.exitCode = 1;
  } else {
    console.error(`\nwrote traces to ${outDir}`);
    console.error(`report: node bench/run-report.mjs ${path.relative(process.cwd(), outDir)}`);
  }
}

await main();
