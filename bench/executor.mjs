/**
 * Run one case against a real model and record a trace.
 *
 * The executor is deliberately thin. It spawns `codex exec` with the Doodle MCP
 * server attached, reads the JSONL event stream, and turns it into a trace. All
 * interpretation happens later, in pure graders, so a grader fix never costs
 * another model call.
 *
 * Three things are isolated because they would otherwise contaminate the
 * measurement, and each was observed in a smoke run:
 *
 *  - the repository's own `AGENTS.md` (48 KB) is larger than Codex's 32 KB
 *    project-instruction budget, so the model receives a truncated copy and
 *    spends a turn noticing. Runs use an empty working directory instead.
 *
 *  - an unrelated `doodle` plugin installed in the user's Codex config
 *    registered its own skill, and the model tried to read that skill's files
 *    before calling a tool. `--ignore-user-config` keeps the run to exactly the
 *    server under test.
 *
 *  - board state. Every run gets its own OUTPUT_DIR, or the library's seeded
 *    board leaks between cases.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeTrace, shortHash } from "./trace.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..");

/** Where the Codex CLI lives on this machine; overridable for other setups. */
export function codexBinary() {
  return process.env.DOODLE_BENCH_CODEX
    ?? "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
}

/**
 * The instruction the model gets.
 *
 * Kept short on purpose: a long prompt would let the benchmark measure prompt
 * engineering instead of the drawing contract. It names the tools and forbids
 * the browser, which is what the product promises.
 */
export function buildPrompt(testCase) {
  return [
    "You are testing a drawing tool. Use only the doodle MCP tools.",
    "Do not read, write, or list files. Do not run shell commands.",
    `Draw this on the board: ${testCase.prompt}`,
    "Prefer the diagram tool with semantic nodes and edges over hand-computed coordinates.",
    "When the drawing is complete, reply with one short sentence and stop.",
  ].join(" ");
}

/** Hash of everything that would change the experiment if edited. */
export function experimentHash(testCase) {
  return {
    prompt_hash: shortHash(buildPrompt(testCase)),
    tool_desc_hash: shortHash(process.env.DOODLE_BENCH_TOOL_HASH ?? "tools-default"),
  };
}

async function runProcess(command, args, { timeoutMs, cwd }) {
  return new Promise((resolve, reject) => {
    /*
     * stdin must be closed, not ignored.
     *
     * `codex exec` reads stdin to decide whether a prompt was piped in, and
     * prints "Reading additional input from stdin…" before sending anything. With
     * `stdio: "ignore"` the descriptor stays open and the call hangs until the
     * timeout, which produced a trace with zero tool calls and no usage — it
     * looked like "the model refused to draw" rather than "the harness never
     * asked".
     */
    // `pipe` (then closed) rather than `ignore`: the CLI waits for stdin EOF
    // before it sends the prompt, and an ignored descriptor never reaches EOF.
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`codex exec timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Parse the JSONL event stream into turns.
 *
 * `codex exec --json` emits one JSON object per line. MCP tool calls arrive as
 * `item.completed` with `type: "mcp_tool_call"`; anything else is ignored rather
 * than fuzzily matched, so a CLI format change fails loudly instead of silently
 * recording zero tool calls.
 */
export function parseEvents(stdout) {
  const turns = [];
  let usage;
  let sawEvent = false;
  for (const line of stdout.split("\n")) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      continue;
    }
    sawEvent = true;
    if (event.type === "turn.completed" && event.usage) usage = event.usage;
    const item = event.item;
    if (!item || item.type !== "mcp_tool_call" || item.status !== "completed") continue;
    const isError = Boolean(item.error) || Boolean(item.result?.isError);
    turns.push({
      tool: item.tool,
      args: item.arguments,
      ok: !isError,
      bytes: JSON.stringify(item.result ?? "").length,
      ...(isError
        ? { error: { code: item.error?.code ?? "TOOL_ERROR", message: String(item.error?.message ?? "").slice(0, 300) } }
        : {}),
    });
  }
  return { turns, usage, sawEvent };
}

/**
 * Run one case.
 *
 * @returns {Promise<object>} a trace, ready for `assertTrace`
 */
export async function runCase(testCase, options = {}) {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const workDir = options.workDir ?? await fs.mkdtemp(path.join(os.tmpdir(), "doodle-bench-run-"));
  const stateDir = path.join(workDir, "state");
  await fs.mkdir(stateDir, { recursive: true });

  const startedAt = Date.now();
  /*
   * `-c` values are parsed as TOML. A JSON string parses as a string, and the
   * CLI then rejects it for `env` ("expected a map") — so the array and the
   * inline table are written in TOML, with the two paths JSON-stringified so a
   * quote or backslash in a temp path cannot break the table.
   */
  const serverArgs = `[${JSON.stringify(path.join(repoRoot, "dist/index.js"))}]`;
  const env = `{ OUTPUT_DIR = ${JSON.stringify(stateDir)}, LOG_LEVEL = "error" }`;

  const { code, stdout, stderr } = await runProcess(codexBinary(), [
    "exec",
    "--skip-git-repo-check",
    // Keep the run to exactly the server under test: no user plugins, no skills.
    "--ignore-user-config",
    "--sandbox", "read-only",
    "--json",
    "-C", workDir,
    "-c", 'mcp_servers.doodle.command="node"',
    "-c", `mcp_servers.doodle.args=${serverArgs}`,
    "-c", `mcp_servers.doodle.env=${env}`,
    buildPrompt(testCase),
  ], { timeoutMs, cwd: workDir });

  const { turns, usage, sawEvent } = parseEvents(stdout);
  if (!sawEvent) {
    throw new Error(`codex exec produced no parseable events (exit ${code}); stderr: ${stderr.slice(-400)}`);
  }

  /*
   * A session with no tool calls and no usage did not reach the model.
   *
   * This is the shape of every failure that is not the model's fault: no
   * network, an expired login, a rejected prompt. Recording it as a trace would
   * put "the model drew nothing" into the benchmark, which is both wrong and
   * invisible in an average. Fail the case instead, with the reason.
   */
  if (turns.length === 0 && !usage) {
    const hint = /timed out|disconnected|ECONN|ENOTFOUND|Reconnecting/i.test(stderr)
      ? "the request never reached the model (network or auth)"
      : "the model ran but called no tool";
    throw new Error(`no tool calls recorded — ${hint}; stderr: ${stderr.slice(-400)}`);
  }

  /*
   * Read the board from the state directory the server wrote, not from a tool
   * call: a model that never calls `get_board` still leaves a board on disk, and
   * that is the thing being graded.
   */
  const boardFile = path.join(stateDir, ".doodle", "board.json");
  const finalBoard = JSON.parse(await fs.readFile(boardFile, "utf8"));

  return makeTrace({
    case: testCase.id,
    model: options.model ?? "codex-default",
    ...experimentHash(testCase),
    started_at: startedAt,
    duration_ms: Date.now() - startedAt,
    turns,
    ...(usage ? { usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } } : {}),
    final_board: finalBoard,
    ...(code !== 0 ? { budget_exceeded: true } : {}),
  });
}
