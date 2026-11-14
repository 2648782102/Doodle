# Goal: Doodle Basic Experience

This document records the active "basic盘" objective for `codex/excalidraw-spike`. It is a maintained acceptance record, not an automation directive.

## Objective

Make Doodle's core loop boringly reliable: AI can generate a readable complex diagram from one semantic request; a person sees and edits the same Excalidraw canvas; AI reads the final board state and continues; the local board library saves and switches editable snapshots; and the embedded MCP App keeps final-state context sync plus one short `通知 Agent` notification. Board v1 remains the only authoritative state.

```text
get_board → draw_board.diagram → Board v1 → Excalidraw projection
  → human edit → revision-safe Board v1 → get_board / model context → draw again
```

## Scope

1. Keep exactly four MCP tools and one version 1 board format.
2. `draw_board.diagram` accepts bounded semantic nodes/edges and adds one complete deterministic diagram beside existing objects; `replace: true` intentionally clears the active board first. It rejects mixed mutations, duplicate node IDs, and unknown edge endpoints.
3. `layout.mode: "architecture"` reflows existing connected objects with bounded labels and stable line coordinates.
4. Excalidraw is derived from Board v1 on every render; no separate scene file or native scene endpoint is authoritative. Optional `scene` metadata only preserves human editing fidelity.
5. Text in shapes, independent text, arrow labels, z-order, image files, and bound arrows survive AI draw → human edit → AI read without overlap or clipping.
6. Embedded MCP Apps hosts receive final-state context through `updateModelContext`; `通知 Agent` appears only when `message.text` is also available and sends exactly one short host-chat message.
7. The local library saves, switches, renames, duplicates, deletes, imports, and exports editable version 1 snapshots; switching refreshes the canvas and AI state.
8. Documentation, tests, CI, and offline repository/plugin guards describe and verify the same contract.

## Acceptance

- `npm run check` passes: TypeScript, build, plugin build, 54 tests, examples, repo guard, plugin guard, setup dry-run, submission ZIP, doctor, and `npm pack --dry-run`.
- `test/mcp.test.mjs` proves semantic diagram generation and rejects mixed mutation fields; `test/http.test.mjs` proves the human diagram endpoint and absence of a scene source; `test/board.test.mjs` proves deterministic layout, bounded labels, duplicate/unknown ID rejection, and parseable version 1 output.
- `test/excalidraw-adapter.test.mjs` proves stable Board v1 ↔ Excalidraw projection for bound text, arrows, strokes, and images.
- CI verifies `resolveDiagramLayout`, `diagramToBoardItems`, final-state context, and the Excalidraw adapter.
- A local preview serves the self-hosted Excalidraw canvas, and the generated plugin package contains the same templates, assets, and bundled server.
- The branch is committed and pushed; `master` and npm publication are unchanged.

## Authority and red lines

- Allowed: normal commits and pushes to `codex/excalidraw-spike`, dependency-free source changes, docs, tests, CI, guards, local validation, and explicit local preview commands.
- Forbidden: force push, history rewrite, tag movement, deleting user board data, committing secrets/generated `dist`/`output`, npm publish, merging into `master`, adding a fifth MCP tool, project writes triggered by board objects, hosted sync, CDN assets, or a second persisted board/scene format.

## Evidence

Record the exact `npm run check` result, test count, MCP four-tool list, local preview URL, generated plugin check, exact diff, commit hashes, and any remaining host-side limitations. Keep this document synchronized when the basic loop changes.
