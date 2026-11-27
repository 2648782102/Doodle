#!/usr/bin/env node
/**
 * What the model pays for before it has read anything.
 *
 * The benchmark records `input_tokens` per run, but that number is mostly not
 * Doodle's: the Codex CLI ships roughly 40k tokens of its own system prompt, and
 * every tool the server advertises adds to it. A run that "costs 294k input
 * tokens" reads as expensive until it is split, and optimising the wrong half
 * wastes effort.
 *
 * This measures the part Doodle controls — the tool list and the server
 * instructions — against a live model, one variable at a time, so a change to a
 * schema or a description can be costed before it is merged.
 *
 * Usage: node bench/measure-context.mjs [--model c]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { repoRoot } from "./executor.mjs";

const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const model = arg("--model", "e").startsWith("workbuddy/")
  ? arg("--model", "e")
  : `workbuddy/blind-model-${arg("--model", "e")}`;

async function toolsFromServer() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(repoRoot, "dist/index.js")],
    env: { ...process.env, OUTPUT_DIR: "/tmp/measure-context-state", LOG_LEVEL: "error", PREVIEW_PORT: "0" },
  });
  const client = new Client({ name: "measure", version: "1" }, { capabilities: {} });
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  await client.close();
  return tools;
}

/**
 * Send a trivial prompt with a given tool set and read back the input tokens.
 *
 * Calling the provider directly rather than through `codex exec` keeps this to
 * one request per measurement: the question is "how many tokens does this tool
 * list cost", and the CLI's own overhead would be a constant we cannot vary.
 */
async function measure(label, tools) {
  const body = {
    model,
    input: "reply with OK",
    max_output_tokens: 16,
    tools: tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: false,
    })),
  };
  const response = await fetch("http://127.0.0.1:3425/v1/responses", {
    method: "POST",
    headers: {
      authorization: "Bearer magpie",
      "x-openai-actor-authorization": "magpie",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (json.error?.message) throw new Error(json.error.message);
  return { label, input: json.usage.input_tokens, cached: json.usage.cached_input_tokens ?? 0 };
}

const tools = await toolsFromServer();
const byName = new Map(tools.map((tool) => [tool.name, tool]));

/*
 * The bare request is the floor: it is the model's own framing plus the prompt.
 * Every number below is relative to it.
 */
const rows = [];
rows.push(await measure("(no tools)", []));
for (const name of ["get_board", "show_board", "draw_board"]) {
  if (byName.has(name)) rows.push(await measure(name, [byName.get(name)]));
}
rows.push(await measure("all four", tools));

const floor = rows[0].input;
console.log(`model: ${model}\n`);
console.log("tool set                        input   delta   bytes");
for (const row of rows) {
  const list = row.label === "(no tools)" ? [] : row.label === "all four" ? tools : [byName.get(row.label)];
  console.log(`${row.label.padEnd(30)} ${String(row.input).padStart(6)} ${String(row.input - floor).padStart(7)}   ${(Buffer.byteLength(JSON.stringify(list)) / 1024).toFixed(1)} KB`);
}
const total = rows[rows.length - 1].input - floor;
console.log(`\nDoodle's share of every request: ${total} tokens`);

const schemaBytes = Buffer.byteLength(JSON.stringify(byName.get("draw_board")?.inputSchema ?? {}));
console.log(`draw_board schema: ${(schemaBytes / 1024).toFixed(1)} KB`);

await fs.mkdir(path.join(repoRoot, "bench", "runs"), { recursive: true });
const out = path.join(repoRoot, "bench", "runs", `context-${Date.now()}.json`);
await fs.writeFile(out, `${JSON.stringify({ model, floor, rows }, null, 2)}\n`, "utf8");
console.log(`wrote ${path.relative(repoRoot, out)}`);
