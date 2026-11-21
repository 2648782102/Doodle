#!/usr/bin/env node
/**
 * Cross-review: every model's drawing is read by every other model.
 *
 * This is the "several reviewers" layer. Structural grading stays the primary
 * verdict — it is deterministic and free to rerun — and the reviews exist to
 * answer a question it structurally cannot: does a reader agree that this is
 * what was asked for?
 *
 * The rotation is the point. A single judge has its own blind spots, and a
 * judge reviewing its own drawing is the least trustworthy combination
 * available (it will defend what it drew). With N models this produces
 * N × (N−1) reviews per case, which is where the real signal is: a drawing that
 * eight peers accept and one rejects is different from one that splits down the
 * middle.
 *
 * Usage:
 *   node bench/run-cross-review.mjs --runs <matrix-dir> [--reviewers c,e,f] [--limit 3] [--out <dir>]
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { codexBinary, modelConfig, repoRoot } from "./executor.mjs";
import { judgePrompt, parseVerdict, reconcile } from "./human-judge.mjs";
import { gradeBoard } from "./graders/index.mjs";

async function loadCases() {
  const dir = path.join(repoRoot, "bench", "cases");
  const cases = new Map();
  for (const file of (await fs.readdir(dir)).filter((n) => n.endsWith(".json"))) {
    const value = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
    for (const item of Array.isArray(value) ? value : [value]) cases.set(item.id, item);
  }
  return cases;
}

/**
 * Load traces from a matrix run, keeping the producing model.
 *
 * The directory name is the model that ran, so the producer is derived from the
 * path rather than trusted from the trace — a trace recorded by an older
 * executor may carry a placeholder model string.
 */
async function loadRuns(dir) {
  const runs = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const producer = entry.name.replace(/^workbuddy-blind-model-/, "");
    for (const file of (await fs.readdir(path.join(dir, entry.name))).filter((n) => n.endsWith(".json"))) {
      const trace = JSON.parse(await fs.readFile(path.join(dir, entry.name, file), "utf8"));
      runs.push({ producer, case: trace.case, trace });
    }
  }
  return runs;
}

/** Ask one model to review one drawing. */
async function review({ reviewer, testCase, board, timeoutMs = 180_000 }) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-judge-"));
  const access = modelConfig({ model: reviewer });
  const args = [
    "exec", "--skip-git-repo-check", "--ignore-user-config",
    "--dangerously-bypass-approvals-and-sandbox", "--json",
    "-C", workDir, "-m", access.model,
    "-c", 'model_provider="magpie"',
    "-c", 'model_providers.magpie.name="magpie"',
    "-c", `model_providers.magpie.base_url="${access.baseUrl}"`,
    "-c", 'model_providers.magpie.wire_api="responses"',
    "-c", `model_providers.magpie.experimental_bearer_token="${access.bearer}"`,
    "-c", 'model_providers.magpie.http_headers={ "x-openai-actor-authorization" = "magpie" }',
    judgePrompt(testCase, board),
  ];
  const text = await new Promise((resolve, reject) => {
    const child = spawn(codexBinary(), args, { cwd: workDir, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.end();
    let out = "";
    let err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("reviewer timed out")); }, timeoutMs);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(timer);
      const messages = out.split("\n")
        .filter((line) => line.includes('"agent_message"'))
        .map((line) => { try { return JSON.parse(line).item?.text ?? ""; } catch { return ""; } })
        .filter(Boolean);
      if (!messages.length) return reject(new Error(`reviewer produced no reply: ${err.slice(-200)}`));
      resolve(messages[messages.length - 1]);
    });
  });
  return parseVerdict(text);
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const valueOf = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const runsDir = valueOf("--runs");
  if (!runsDir) {
    console.error("usage: node bench/run-cross-review.mjs --runs <matrix-dir> [--reviewers c,e,f] [--limit 3]");
    process.exit(2);
  }
  const reviewers = (valueOf("--reviewers") ?? "c")
    .split(",").map((m) => m.trim()).filter(Boolean)
    .map((m) => (m.startsWith("workbuddy/") ? m : `workbuddy/blind-model-${m}`));
  const limit = Number(valueOf("--limit") ?? 3);
  const concurrency = Number(valueOf("--concurrency") ?? 3);
  const outDir = path.resolve(valueOf("--out") ?? path.join(repoRoot, "bench", "runs", `cross-${Date.now()}`));

  const cases = await loadCases();
  const allRuns = await loadRuns(path.resolve(runsDir));

  /*
   * A judge reviewing its own drawing proves nothing, so those pairs are
   * dropped — and the count is reported, because a silently smaller matrix
   * would look like fewer disagreements.
   */
  const pairs = [];
  let selfSkipped = 0;
  for (const run of allRuns) {
    const testCase = cases.get(run.case);
    if (!testCase) continue;
    for (const reviewer of reviewers) {
      if (reviewer.replace("workbuddy/blind-model-", "") === run.producer) {
        selfSkipped += 1;
        continue;
      }
      pairs.push({ run, testCase, reviewer });
    }
  }

  /*
   * `--limit` caps how many reviews each producing model receives, and the
   * selection is *stratified*: structurally-failed drawings first.
   *
   * An unstratified slice of a good model's output is almost entirely passes,
   * and thirty `agree-pass` rows teach nothing — the first real run did exactly
   * that. The disagreements are where the benchmark learns something, so they
   * are reviewed first and the pass cases fill whatever budget remains.
   */
  const structuralPass = new Map();
  for (const pair of pairs) {
    const key = `${pair.run.producer}:${pair.run.case}`;
    if (structuralPass.has(key)) continue;
    structuralPass.set(key, gradeBoard(pair.run.trace.final_board, pair.testCase.expect, { trace: pair.run.trace }).pass);
  }
  const byCasePriority = [...pairs].sort((left, right) => {
    const leftFail = structuralPass.get(`${left.run.producer}:${left.run.case}`) ? 1 : 0;
    const rightFail = structuralPass.get(`${right.run.producer}:${right.run.case}`) ? 1 : 0;
    return leftFail - rightFail;
  });

  const perProducer = new Map();
  const selected = byCasePriority.filter((pair) => {
    const key = pair.run.producer;
    const used = perProducer.get(key) ?? 0;
    if (used >= limit * reviewers.length) return false;
    perProducer.set(key, used + 1);
    return true;
  });

  await fs.mkdir(outDir, { recursive: true });
  const started = Date.now();
  console.error(`${selected.length} review(s): ${allRuns.length} drawings × ${reviewers.length} reviewer(s), self-pairs skipped ${selfSkipped}`);

  const results = await pool(selected, concurrency, async (pair) => {
    const structural = gradeBoard(pair.run.trace.final_board, pair.testCase.expect, { trace: pair.run.trace });
    let judged;
    try {
      judged = await review({ reviewer: pair.reviewer, testCase: pair.testCase, board: pair.run.trace.final_board });
    } catch (error) {
      judged = { ok: false, reason: String(error.message ?? error) };
    }
    const relation = reconcile(structural, judged);
    process.stderr.write(`  ${pair.run.case} ${pair.run.producer}←${pair.reviewer.replace("workbuddy/blind-model-", "")} `
      + `${relation.category}\n`);
    return {
      case: pair.run.case,
      producer: pair.run.producer,
      reviewer: pair.reviewer.replace("workbuddy/blind-model-", ""),
      structural: { pass: structural.pass, score: structural.score },
      judged,
      relation,
    };
  });

  const summary = {};
  for (const row of results) {
    summary[row.relation.category] = (summary[row.relation.category] ?? 0) + 1;
  }
  const payload = {
    generated_at: new Date().toISOString(),
    reviewers: reviewers.map((r) => r.replace("workbuddy/blind-model-", "")),
    reviews: results.length,
    self_skipped: selfSkipped,
    summary,
    rows: results,
  };
  await fs.writeFile(path.join(outDir, "cross-review.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.error(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  console.error(`summary: ${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.error(`wrote ${path.relative(repoRoot, path.join(outDir, "cross-review.json"))}`);
}

await main();
