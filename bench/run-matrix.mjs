#!/usr/bin/env node
/**
 * Run the case set against several models, in parallel, and compare them.
 *
 * Two axes of parallelism:
 *   - across models, so a comparison finishes in the time of its slowest model
 *   - across cases within a model, bounded by `--concurrency`
 *
 * Safety comes from isolation that already existed for the serial runner: every
 * run gets its own temp working directory and its own `OUTPUT_DIR`, so two
 * models drawing at once cannot see each other's boards. Nothing else is shared
 * except the model gateway, which is designed for concurrent requests.
 *
 * Usage:
 *   node bench/run-matrix.mjs --models m1,m2,m3 [--only <case-id>] [--concurrency 3] [--out <dir>]
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

/**
 * Run tasks with a concurrency limit, preserving input order in the result.
 *
 * Written out rather than pulled from a dependency: it is twelve lines and the
 * repository keeps its runtime surface small.
 */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** A per-model directory name that is safe on every filesystem. */
function slug(model) {
  return model.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function main() {
  const args = process.argv.slice(2);
  const valueOf = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const models = (valueOf("--models") ?? process.env.DOODLE_BENCH_MODEL ?? "workbuddy/blind-model-c")
    .split(",").map((model) => model.trim()).filter(Boolean);
  const concurrency = Number(valueOf("--concurrency") ?? 3);
  const only = valueOf("--only");
  const outDir = path.resolve(valueOf("--out") ?? path.join(repoRoot, "bench", "runs", `matrix-${Date.now()}`));

  const cases = (await loadCases()).filter((testCase) => !only || testCase.id === only);
  if (cases.length === 0) {
    console.error(only ? `no case with id ${only}` : "no cases found");
    process.exit(2);
  }
  if (models.length === 0) {
    console.error("no models given");
    process.exit(2);
  }

  await fs.mkdir(outDir, { recursive: true });
  const started = Date.now();
  console.error(`${models.length} model(s) × ${cases.length} case(s), concurrency ${concurrency}`);
  console.error(`models: ${models.join(", ")}`);

  /*
   * Models run as separate tasks, each with its own case-level pool. Running
   * everything through one global pool would mix models in the output and make a
   * single model's failure look like the whole run's.
   */
  const perModel = await Promise.all(models.map(async (model) => {
    const modelDir = path.join(outDir, slug(model));
    await fs.mkdir(modelDir, { recursive: true });
    const results = await pool(cases, concurrency, async (testCase) => {
      const label = `${slug(model)} ${testCase.id}`;
      const caseStartedAt = Date.now();
      try {
        const trace = assertTrace(await runCase(testCase, { model }));
        const file = path.join(modelDir, `${testCase.id.replace(/[^a-z0-9]+/gi, "-")}.json`);
        await fs.writeFile(file, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
        process.stderr.write(`  ✓ ${label} (${trace.turns.length} calls, ${Date.now() - caseStartedAt} ms)\n`);
        return { case: testCase.id, ok: true };
      } catch (error) {
        process.stderr.write(`  ✗ ${label}: ${error.message?.slice(0, 120)}\n`);
        return { case: testCase.id, ok: false, error: String(error.message ?? error) };
      }
    });
    return { model, dir: modelDir, results };
  }));

  const failures = perModel.flatMap((entry) => entry.results
    .filter((result) => !result.ok)
    .map((result) => ({ model: entry.model, ...result })));

  console.error(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  if (failures.length) {
    console.error(`${failures.length} run(s) produced no trace:`);
    for (const failure of failures) console.error(`  ${failure.model} · ${failure.case}: ${failure.error.slice(0, 160)}`);
    process.exitCode = 1;
  }
  console.error(`\ncompare: node bench/run-report.mjs ${path.relative(process.cwd(), outDir)} --per-model`);
}

await main();
