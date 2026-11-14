# Goal: AI-First Board Context Economy

Five-hour iteration branch `codex/main-iteration-20261115`. This is a maintained
acceptance record, not an automation directive.

## Why this direction

Doodle's product claim is that the board is the shared language between a person
and an agent. The agent pays for that language in context tokens on every read.
Measured on the current `master` (`3d7af7d`) with a 4-object board:

| Part of `get_board` | Characters |
|---|---|
| whole response | 6,356 |
| `BOARD_JSON` | 3,642 |
| `CAPABILITIES` | 1,123 |
| `RECIPES` | 1,054 |
| `VISUAL_DIGEST` | 276 |

Of the 4,008 bytes in the persisted board, **3,872 bytes (97%) are Excalidraw
`scene` fidelity metadata** attached to every item. The agent never uses it: it
cannot draw with it, cannot verify it, and must not edit it. It exists only so a
person's canvas keeps its exact rendering after a round trip.

That is the wrong trade for an agent-first tool. A board that gets used all day
should get cheaper to read, not more expensive, as it grows.

## Objective

Make repeated AI reads of the same board cheap and stable, without weakening the
human canvas, the four-tool contract, or version 1 compatibility.

```text
first read  → enough structure to draw correctly
later reads → compact delta + stable summary, not the whole scene again
human canvas → keeps full scene fidelity locally
```

## Scope

1. Keep exactly four MCP tools, version 1 board state, and revision-safe writes.
2. Separate what the agent must know from what only the canvas needs. `scene`
   stays persisted for fidelity but is not repeated into agent context by
   default.
3. Give `get_board` an explicit cheap mode for rereads: stable summary plus the
   objects that changed since a caller-supplied revision.
4. Keep one authoritative full read available for the cases that need it, so
   nothing becomes unrecoverable.
5. Keep the guidance text progressive: first use explains, later reads stay
   short, and no section repeats what the caller already has.
6. Preserve human-canvas behavior exactly: palette, library drawer, links,
   editing, and MCP App context sync are unchanged.

## Acceptance

- A measured, documented reduction in `get_board` payload for a reread of an
  unchanged board, with the number recorded in this file.
- A board's `scene` metadata never appears in the default agent-facing payload,
  and a test proves the full-fidelity data is still persisted and still reaches
  the canvas.
- A reread after a change returns the changed objects and a stable summary
  rather than the entire board.
- `npm run check` passes: TypeScript, build, plugin build, all tests, examples,
  repository and plugin guards, setup dry-run, submission ZIP, doctor, and
  `npm pack --dry-run`.
- Documentation, guards, and the plugin skill describe the same contract.
- `draw_board.diagram` can express more than a dependency graph: a timeline, a
  side-by-side comparison, and a strict matrix are one `mode` away, and an
  ordered explanation is never silently reordered by edge analysis.

## Measured result

Measured against this branch with the real 4-object board in `output/`, using a
stdio MCP client and the actual tool responses:

| Read | Characters | Notes |
|---|---|---|
| before this iteration | 6,356 | full board, `scene` included, guide every time |
| first read after | 8,237 | guide is sent once, so this read carries it |
| second read, no arguments | 6,171 | guide omitted |
| reread with `since_revision` | 618 | delta only, unchanged board |

- `scene` never appears in any agent-facing payload; `canvasFidelityItems`
  reports how many items carry withheld fidelity.
- On the same board, the agent projection is **56% smaller** than the persisted
  board (`4,008` → `1,747` bytes), and `scene` accounted for **65%** of the
  persisted payload.
- An unchanged reread is **90% smaller** than a full read; a changed reread
  returns only the changed objects.
- `test/agent-view.test.mjs` covers the pure projections and the revision cache;
  `test/mcp.test.mjs` covers guide-once, delta reads, and the guarantee that
  withheld fidelity is still persisted.

## Second target: express kinds of diagrams, not just graphs

`diagram` already removed hand-computed coordinates, but it could only lay out a
dependency graph. Real explanations are not all graphs: a roadmap is ordered, a
trade-off is two sides, a matrix is a table. Deriving columns from edges for those
would silently reorder what the author wrote.

`draw_board.diagram.mode` now selects the arrangement:

| Mode | Arrangement | Columns come from |
|---|---|---|
| `flow` (default) | left-to-right dependency layers | edges |
| `timeline` | one horizontal axis, stages stacked when they share a column | your `column` |
| `compare` | two or more side-by-side columns | your `column` |
| `matrix` | strict `row` × `column` grid | your `row` and `column` |

Only `flow` reads edges for placement. Explicit `row`/`column` always wins, so an
author's order is preserved. A node that is still unplaced after layout - an
explicit mode with no columns, or a cycle - keeps declaration order instead of
overlapping every node at the origin.

## Third target: tell the agent what the person did

`visualDigest` answers "what is on the board now". It does not answer the
question that actually drives the next turn: *what did the person change since I
last looked?* Without it the agent redraws from scratch or asks the person to
repeat themselves, which is the opposite of a two-way board.

A delta read now also carries `HANDOFF`:

- Only human-attributed changes are reported. A change counts as human when the
  item's author is `human` now, or when a human-authored item disappeared. The
  agent is never told to review its own last write.
- Each edit reports the final values that differ - `added`, `edited`, or
  `removed`, the changed field names, and the clipped final text and position -
  so no second read is needed to see what the person meant.
- The payload is bounded: at most 12 edits, with `omitted` counting the rest.
- When nothing human changed, the agent gets one line saying so, not silence.

## Fourth target: remove a round trip

`scan_project` answered "what is here", and then the agent invented a diagram and
paid a second call to draw it. The scan now also returns `DIAGRAM_DRAFT_JSON`:
the same top-level structure already shaped as `draw_board.diagram` input, with
stable ids, bounded to 12 nodes, and marked as a suggestion. The agent can pass
it through, change labels, or ignore it. `scan_project` still reads only; it
never draws and never changes the board.

## Authority and red lines

- Allowed: normal commits and pushes on this branch, source, tests, docs, CI,
  guards, and explicit local preview commands.
- Forbidden: force push, history rewrite, tag movement, deleting user board data,
  adding a fifth MCP tool, a second persisted format, project writes from board
  objects, hosted sync, CDN assets, or npm publishing from this branch.
- Human-facing behavior is a regression surface: any change that makes the
  canvas render differently fails this goal even if it saves tokens.
