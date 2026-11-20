/**
 * The executor connects the benchmark to a real model, so its parsing and its
 * isolation choices get tests of their own. These do not call a model: they feed
 * recorded event streams through the same parser the live path uses.
 *
 * The bug that motivated the parser tests: a missing stdin EOF made `codex exec`
 * hang until timeout, producing a trace with zero tool calls and no usage. Read
 * naively, that trace says "the model refused to draw" — the harness was the
 * problem. The parser now reports whether it saw any event at all, so the
 * executor can fail loudly instead of recording a fake result.
 */
import { describe, expect, it } from "vitest";
import { buildPrompt, experimentHash, parseEvents } from "./executor.mjs";

const event = (value) => `${JSON.stringify(value)}\n`;

/** A minimal but realistic `codex exec --json` stream. */
const STREAM = [
  event({ type: "thread.started", thread_id: "t1" }),
  event({ type: "turn.started" }),
  event({
    type: "item.completed",
    item: {
      id: "i1", type: "mcp_tool_call", server: "doodle", tool: "get_board",
      arguments: { view: "summary" }, status: "completed",
      result: { content: [{ type: "text", text: "…" }] }, error: null,
    },
  }),
  event({
    type: "item.completed",
    item: {
      id: "i2", type: "mcp_tool_call", server: "doodle", tool: "draw_board",
      arguments: { items: [] }, status: "completed",
      result: { isError: true, content: [{ type: "text", text: "bad colour" }] },
      error: { code: "INVALID_COLOR" },
    },
  }),
  event({ type: "item.completed", item: { id: "i3", type: "agent_message", text: "done" } }),
  event({ type: "turn.completed", usage: { input_tokens: 1000, output_tokens: 50 } }),
].join("");

describe("event parsing", () => {
  it("records only tool calls, in order, with success state", () => {
    const { turns } = parseEvents(STREAM);
    expect(turns.map((turn) => turn.tool)).toEqual(["get_board", "draw_board"]);
    expect(turns[0].ok).toBe(true);
    expect(turns[1].ok).toBe(false);
    expect(turns[1].error.code).toBe("INVALID_COLOR");
  });

  it("carries token usage, which is the cost half of the report", () => {
    const { usage } = parseEvents(STREAM);
    expect(usage).toMatchObject({ input_tokens: 1000, output_tokens: 50 });
  });

  it("reports whether any event parsed, so a hung run is not recorded as 'drew nothing'", () => {
    expect(parseEvents(STREAM).sawEvent).toBe(true);
    expect(parseEvents("").sawEvent).toBe(false);
    // A stream that only contains non-JSON (a CLI change, a crash banner) is
    // not evidence of a completed run either.
    expect(parseEvents("Reading additional input from stdin...\n").sawEvent).toBe(false);
  });

  it("skips malformed lines instead of throwing on one bad record", () => {
    const damaged = `${event({ type: "turn.started" })}{not json}\n${event({ type: "turn.completed" })}`;
    expect(() => parseEvents(damaged)).not.toThrow();
    expect(parseEvents(damaged).sawEvent).toBe(true);
  });

  it("ignores tool-call events that never completed", () => {
    const inFlight = event({
      type: "item.started",
      item: { type: "mcp_tool_call", tool: "draw_board", status: "in_progress" },
    });
    expect(parseEvents(inFlight).turns).toHaveLength(0);
  });
});

describe("the experiment definition", () => {
  const testCase = { id: "flow/x", prompt: "draw A then B" };

  it("tells the model not to touch files or the shell", () => {
    // A tool run that wanders into the repository would measure the codebase,
    // not the drawing contract.
    const prompt = buildPrompt(testCase);
    expect(prompt).toMatch(/only the doodle MCP tools/i);
    expect(prompt).toMatch(/Do not read, write, or list files/i);
    expect(prompt).toContain(testCase.prompt);
  });

  it("hashes the prompt so a change makes runs incomparable", () => {
    const a = experimentHash(testCase);
    const b = experimentHash({ ...testCase, prompt: "draw A then B then C" });
    expect(a.prompt_hash).not.toBe(b.prompt_hash);
    expect(a.tool_desc_hash).toBe(b.tool_desc_hash);
  });
});
