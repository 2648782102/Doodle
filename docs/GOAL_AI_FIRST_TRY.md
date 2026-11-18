# Goal — AI first-try success

## Why this exists

Doodle's value is that an AI can express intent on a board without a person
correcting its syntax. Every rejected call the model cannot repair from the
reply is a round trip the person pays for. This goal makes a first-try write
succeed, and makes a failed write self-correcting.

## Evidence that started it

Driving the server as a naive model surfaced two distinct failures:

1. **Schema rejections bypass `ERROR_JSON` entirely.** A call that violates the
   Zod schema — text over 1200 characters, more than 100 items, an unknown
   `author` — returns a raw `MCP error -32602: Input validation error` with no
   code, path, or fix. `AGENTS.md` promises every rejected write carries
   `ERROR_JSON` with `code/path/expected/fix`, so the contract and the behaviour
   disagree on exactly the path a new model hits first.
2. **Most domain rejections are prose.** 79 `throw new Error(...)` sites against
   8 `BoardValidationError` sites. Messages like "Stroke needs bounded points"
   name the problem but not the field or the repair.

## Goal

Every rejected write returns a machine-repair-capable error:

```json
{ "code": "...", "message": "...", "path": "items[2].w", "expected": "...", "fix": "..." }
```

Measured by a first-try suite that asserts, for each realistic mistake, that the
reply names the field and the repair.

One exception is part of the contract rather than a gap. A **wrong JSON type**
(`text: 42`, `x: "abc"`) is rejected by the MCP SDK before any handler runs and
cannot be re-serialised, so it reports the SDK message — which already names the
field and the expected type (`expected string, received number at
items[0].text`). That is repairable without source, so it stays as-is rather
than duplicating the whole schema in the model layer. *Bounds* are different:
they are knowable up front, so they live in `model/` and always carry
`ERROR_JSON`.

## Plan

1. Schema rejections carry the same contract as domain rejections.
2. Convert bare throws in the write path to `BoardValidationError`, most-hit
   first: item fields, stroke points, connector bindings, diagram input.
3. Draw-guide text tells the model the bounds it will be checked against.
4. A first-try suite freezes the contract; the repo guard fails if a new
   schema-level rejection appears without a repair path.

## Out of scope

New tools, new board state, UI changes, and anything that changes what a valid
write produces. This goal only changes how a rejected write is reported.
