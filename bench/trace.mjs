/**
 * The trace: one recorded run of one case.
 *
 * A trace is the benchmark's unit of evidence. It is written by the executor
 * (which needs a model) and read by everything else (which does not). Keeping
 * the split strict means a report can be regenerated, a grader can be
 * corrected, and a past run can be compared against a new one — all without
 * paying for another model call.
 *
 * The shape is validated rather than assumed: a trace missing `final_board`
 * would silently grade as an empty board, and "the model drew nothing" is a
 * very different finding from "the recorder dropped the board".
 */

export const TRACE_VERSION = 1;

/**
 * @typedef {object} TraceTurn
 * @property {string} tool
 * @property {object} [args]
 * @property {boolean} ok
 * @property {number} [ms]
 * @property {number} [bytes]
 * @property {object} [error]   { code, path } when ok is false
 */

/**
 * @typedef {object} Trace
 * @property {number} version
 * @property {string} case
 * @property {string} model
 * @property {string} prompt_hash      changes here change the experiment
 * @property {string} tool_desc_hash   ditto for tool descriptions
 * @property {number} started_at       epoch ms
 * @property {number} duration_ms
 * @property {TraceTurn[]} turns
 * @property {{input_tokens?: number, output_tokens?: number}} [usage]
 * @property {object} final_board      Board v1
 * @property {boolean} [budget_exceeded]
 */

/** Build a trace, filling the fields a recorder can be trusted to derive. */
export function makeTrace(input) {
  if (!input || typeof input !== "object") throw new Error("trace input must be an object");
  if (typeof input.case !== "string" || !input.case) throw new Error("trace needs a case id");
  if (!Array.isArray(input.turns)) throw new Error("trace needs a turns array");
  if (!input.final_board || typeof input.final_board !== "object") {
    throw new Error("trace needs final_board; an absent board is not an empty board");
  }
  const startedAt = input.started_at ?? Date.now();
  return {
    version: TRACE_VERSION,
    case: input.case,
    model: input.model ?? "unknown",
    prompt_hash: input.prompt_hash ?? "",
    tool_desc_hash: input.tool_desc_hash ?? "",
    started_at: startedAt,
    duration_ms: input.duration_ms ?? (Date.now() - startedAt),
    turns: input.turns.map((turn) => ({
      tool: turn.tool,
      ok: Boolean(turn.ok),
      ...(turn.args !== undefined ? { args: turn.args } : {}),
      ...(turn.ms !== undefined ? { ms: turn.ms } : {}),
      ...(turn.bytes !== undefined ? { bytes: turn.bytes } : {}),
      ...(turn.error ? { error: turn.error } : {}),
    })),
    ...(input.usage ? { usage: input.usage } : {}),
    final_board: input.final_board,
    ...(input.budget_exceeded ? { budget_exceeded: true } : {}),
  };
}

/** Reject a trace that would silently grade as "the model drew nothing". */
export function assertTrace(value) {
  if (!value || typeof value !== "object") throw new Error("trace must be an object");
  if (value.version !== TRACE_VERSION) {
    throw new Error(`trace version ${JSON.stringify(value.version)}; expected ${TRACE_VERSION}`);
  }
  if (typeof value.case !== "string" || !value.case) throw new Error("trace has no case id");
  if (!Array.isArray(value.turns)) throw new Error("trace has no turns array");
  if (!value.final_board || !Array.isArray(value.final_board.items)) {
    throw new Error("trace has no final_board.items");
  }
  return value;
}

/** Hash a string for the "did the experiment change" fields. Stable, non-crypto. */
export function shortHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
