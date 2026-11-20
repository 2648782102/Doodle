#!/usr/bin/env node
/**
 * Run the two-way loop against a real model.
 *
 *   1. AI draws a flow (one model call).
 *   2. A scripted person moves one card on the same board.
 *   3. AI is asked what changed (a second model call).
 *
 * The second answer is graded against the HANDOFF the server computed, so the
 * question is not "did the model sound plausible" but "did it read the board
 * the same way the board reads itself".
 *
 * Usage: node bench/run-human-loop.mjs [--out <dir>] [--label <object label>] [--edit move|relabel|delete]
 *
 * Each edit kind exercises a different reading. A move is the easiest — the
 * board's own handoff names it plainly. A relabel is harder, because the object
 * keeps its position and only its meaning changed. A delete is the hardest: the
 * object is gone, so nothing on the board can be quoted, and a model that
 * describes "the card that used to say X" is doing real reading rather than
 * pattern-matching an id.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { codexBinary, modelConfig, repoRoot } from "./executor.mjs";
import { applyHumanEdit, expectedHandoff, gradeHumanReport, setHandoffImplementation } from "./human-loop.mjs";

const { createEmptyBoard, diagramToBoardItems, touchBoard } = await import(path.join(repoRoot, "dist/board/types.js"));
const { expandRecipe } = await import(path.join(repoRoot, "dist/board/diagram/recipe.js"));
/*
 * The real handoff, injected.
 *
 * This file runs under plain Node (not the test runner), so it can import the
 * build output directly — the loader problem that forced injection only exists
 * inside vitest. Injection keeps one code path for both.
 */
/*
 * The handoff module has moved once already (`board/handoff.ts` →
 * `board/view/handoff.ts`), so the loader tries both rather than depending on
 * the current layout. A benchmark that breaks whenever source is reorganised is
 * a benchmark nobody runs.
 */
async function loadDescribeHandoff() {
  const candidates = ["dist/board/view/handoff.js", "dist/board/handoff.js"];
  for (const candidate of candidates) {
    try {
      const module = await import(path.join(repoRoot, candidate));
      if (typeof module.describeHandoff === "function") return module.describeHandoff;
    } catch {
      // Try the next layout.
    }
  }
  throw new Error(`handoff module not found at ${candidates.join(" or ")}; run \`npm run build\``);
}
setHandoffImplementation(await loadDescribeHandoff());

const STEPS = ["计划", "执行", "复盘"];

function runCodex(args, cwd, timeoutMs = 240_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(codexBinary(), args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("timed out")); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.on("error", reject);
  });
}

function baseArgs(workDir, model) {
  const access = modelConfig({ model });
  return [
    "exec", "--skip-git-repo-check", "--ignore-user-config",
    "--dangerously-bypass-approvals-and-sandbox", "--json",
    "-C", workDir, "-m", access.model,
    "-c", 'model_provider="magpie"',
    "-c", 'model_providers.magpie.name="magpie"',
    "-c", `model_providers.magpie.base_url="${access.baseUrl}"`,
    "-c", 'model_providers.magpie.wire_api="responses"',
    "-c", `model_providers.magpie.experimental_bearer_token="${access.bearer}"`,
    "-c", 'model_providers.magpie.http_headers={ "x-openai-actor-authorization" = "magpie" }',
  ];
}

function lastAgentMessage(stdout) {
  const messages = stdout.split("\n")
    .filter((line) => line.includes('"agent_message"'))
    .map((line) => {
      try { return JSON.parse(line).item?.text ?? ""; } catch { return ""; }
    })
    .filter(Boolean);
  return messages[messages.length - 1] ?? "";
}

async function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const labelIndex = args.indexOf("--label");
  const editIndex = args.indexOf("--edit");
  const outDir = path.resolve(outIndex >= 0 ? args[outIndex + 1] : path.join(repoRoot, "bench", "runs", `human-${Date.now()}`));
  const movedLabel = labelIndex >= 0 ? args[labelIndex + 1] : "执行";
  const editKind = editIndex >= 0 ? args[editIndex + 1] : "move";
  await fs.mkdir(outDir, { recursive: true });

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-human-"));
  const stateDir = path.join(workDir, "state");
  await fs.mkdir(stateDir, { recursive: true });
  const boardFile = path.join(stateDir, ".doodle", "board.json");

  /*
   * Step 1: the board is drawn by the real generator rather than by a model.
   * The loop is about *reading* a change, not drawing; adding a drawing call
   * would double the cost and let a drawing failure masquerade as a
   * comprehension failure.
   */
  const drawn = touchBoard({
    ...createEmptyBoard(),
    items: diagramToBoardItems(expandRecipe({ recipe: "flow", steps: STEPS }), "ai"),
  });
  await fs.mkdir(path.dirname(boardFile), { recursive: true });
  await fs.writeFile(boardFile, JSON.stringify(drawn), "utf8");
  process.stderr.write(`  board drawn: ${STEPS.join(" → ")}\n`);

  const mcpArgs = [
    "-c", 'mcp_servers.doodle.command="node"',
    "-c", `mcp_servers.doodle.args=[${JSON.stringify(path.join(repoRoot, "dist/index.js"))}]`,
    "-c", `mcp_servers.doodle.env={ OUTPUT_DIR = ${JSON.stringify(stateDir)}, LOG_LEVEL = "error" }`,
  ];

  // Step 2: a scripted person moves one card.
  const before = JSON.parse(await fs.readFile(boardFile, "utf8"));
  const edit = editKind === "relabel"
    ? { type: "relabel", label: movedLabel, to: `${movedLabel}（已调整）` }
    : editKind === "delete"
      ? { type: "delete", label: movedLabel }
      : { type: "move", label: movedLabel, dx: 260, dy: 140 };
  const after = applyHumanEdit(before, edit);
  await fs.writeFile(boardFile, JSON.stringify(after), "utf8");
  const handoff = expectedHandoff(before, after);
  process.stderr.write(`  person ${editKind} 「${movedLabel}」\n`);

  // Step 3: ask the model what changed.
  const prompt = [
    "A person edited this shared board while you were away.",
    "Call get_board with since_revision to see what changed, then reply in one or two sentences:",
    "which object they changed and what they did. Quote object labels in 「」.",
  ].join(" ");
  const { code, stdout, stderr } = await runCodex([
    ...baseArgs(workDir, modelConfig().model),
    ...mcpArgs,
    prompt,
  ], workDir);

  const answer = lastAgentMessage(stdout);
  if (!answer) throw new Error(`model produced no reply (exit ${code}); stderr: ${stderr.slice(-300)}`);

  const result = gradeHumanReport({ answer, handoff, before, after });
  const record = {
    generated_at: new Date().toISOString(),
    model: modelConfig().model,
    moved: movedLabel,
    edit: editKind,
    handoff: { summary: handoff.summary, kinds: handoff.readings.map((reading) => reading.kind) },
    answer,
    grade: result,
  };
  await fs.writeFile(path.join(outDir, `human-loop-${editKind}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");

  process.stderr.write(`\n  HANDOFF: ${handoff.summary}\n`);
  process.stderr.write(`  answer : ${answer}\n`);
  process.stderr.write(`  grade  : ${result.ok ? "PASS" : "FAIL"} `
    + `(detected ${result.detected}, missed ${result.missed.length}, invented ${result.invented.length})\n`);
  process.stderr.write(`\nwrote ${path.relative(repoRoot, path.join(outDir, `human-loop-${editKind}.json`))}\n`);

  if (!result.ok) process.exitCode = 1;
}

await main();
