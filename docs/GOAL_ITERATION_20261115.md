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

## Authority and red lines

- Allowed: normal commits and pushes on this branch, source, tests, docs, CI,
  guards, and explicit local preview commands.
- Forbidden: force push, history rewrite, tag movement, deleting user board data,
  adding a fifth MCP tool, a second persisted format, project writes from board
  objects, hosted sync, CDN assets, or npm publishing from this branch.
- Human-facing behavior is a regression surface: any change that makes the
  canvas render differently fails this goal even if it saves tokens.
