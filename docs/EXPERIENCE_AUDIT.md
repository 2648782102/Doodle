# Experience Audit — 2026-11-11

This is a maintained, task-scoped audit of the complete Doodle experience chain: install the plugin, open a new agent session, let the AI read and draw, let a person edit the same canvas, and let the AI read it again. It is based on a live local session where the assistant acted as both the MCP-side AI and the browser-side human. The board was started with a temporary `OUTPUT_DIR` and `PANEL_URL=http://127.0.0.1:3411/`; no private board state was written to the repository.

## Product direction

Doodle remains one simple shared infinite board for people and AI. It is not a chat product, project workbench, approval system, or diagram library. The complete experience path is:

```text
one-command install → new agent session → one first prompt
  → AI reads shared board → canvas visible → AI draws
  → person sees and edits → AI rereads → person sees the AI response
```

Any fix below must reduce friction in that loop without adding a fifth MCP tool, a second state model, a chat surface, a browser-opening side effect, or project-write authority.

## Evidence from the live session

Verified working:

- `get_board`, `show_board`, `draw_board`, and the standalone human API all used the same version 1 board state.
- The first AI drawing appeared in the browser; a human text edit, a click-placed rectangle, a directed arrow, a newly created note, and a deletion were each read back by the AI.
- `FIRST_USE` / `NEXT_STEPS`, the `?` help popover, `?` shortcut, tool shortcuts, zoom controls, fit-to-content, and reload recovery were reachable.
- Stale browser writes correctly returned HTTP 409 with a board revision conflict.
- A fresh server created a new isolated board and reported a loopback `PANEL_URL`.

Observed friction, ordered by user harm:

| ID | Priority | Status | Problem | Evidence | Acceptance |
|---|---|---|---|---|---|
| E1 | P0 | fixed | Standalone canvas does not reliably follow AI writes in real time. | AI drew from revision 4 to 7 while the open browser reached each revision with `AI 已更新` and no manual reload; `test/http.test.mjs` covers the WebSocket broadcast. | Every successful `draw_board` broadcast reaches the active standalone page; the UI reaches the same revision without a manual reload. A regression test covers the broadcast path. |
| E2 | P0 | fixed | Human edits to an AI-created object keep `author: "ai"`. | A human PATCH changed the AI rectangle to 「人改过了：这张便签变短」 and the AI readback showed `author: "human"` plus the `人` badge; `test/http.test.mjs` and `test/mcp.test.mjs` cover both authors. | A human PATCH changes `author` to `human`; AI updates use `ai`; the canvas badge and `copyText` agree. A unit test covers both paths. |
| E3 | P1 | fixed | Creating an object has a confusing default-text and conflict-toast sequence. | A fresh click-placed note started blank, returned to the select tool, and saved at `已保存 · rev 5` with no conflict toast; 409 recovery is retried once and guarded in `scripts/repo-check.mjs`. | New visual objects start with blank visible text; entering edit mode does not create a false conflict; one click-place produces one revision increment and one clear save state. |
| E4 | P1 | fixed | Double-click text editing is not reliable. | Double-click now re-renders the selected object and queues the same editor; an explicit `编辑` button and `Enter` shortcut provide a deterministic edit path even in hosts that coalesce pointer events. HTML guards and embedded-app tests cover both paths. | Double-clicking any note/rect/ellipse/text enters the same editor as create-time; `Escape` cancels and blur saves. A browser-level test or deterministic DOM contract covers it. |
| E5 | P1 | fixed | Help and keyboard shortcuts interfere with each other. | `?` opens help while focus stays on the canvas; pressing `r` still selects the rectangle tool; `Escape` closes help without resetting the tool or selection. | Help never steals persistent focus; closing it restores the canvas or prior focus. When help handles `Escape`, other tool state remains unchanged. |
| E6 | P1 | fixed | `get_board` repeats the full first-use guide and drawing guide on every read. | The first read returned `FIRST_USE`, `NEXT_STEPS`, and the drawing guide; after AI drawing, the second read returned `NEXT` with `BOARD_JSON` and no repeated guide. `test/mcp.test.mjs` covers both modes. | First read remains guided; later reads put a short status and revision first and keep the drawing guide available through initialization instructions or a concise `GUIDE` marker. Structured board content remains unchanged. |
| E7 | P1 | fixed | The starter board plus the first prompt creates a crowded first screen. | A clean temporary server started at revision 1 with zero objects and one unobtrusive empty-state hint; `test/board.test.mjs` verifies `createEmptyBoard()` and starter-state compatibility. | A clean board is empty with an unobtrusive empty-state hint; the first AI drawing is the first meaningful object. Existing version 1 starter state remains readable for compatibility. |
| E8 | P2 | fixed | Status feedback does not explain the shared loop. | Local creation kept `已保存 · rev 5`; a later AI draw changed the open page to `AI 已更新 · rev 7`; same-revision broadcasts no longer mislabel local saves. `scripts/repo-check.mjs` guards the source distinction. | The standalone page shows concise, non-chatty revision/source feedback for local saves and remote board updates. Errors are consistent with the final state. |
| E9 | P2 | fixed | Overlapping objects and floating arrows make the board hard to read. | `findFreeSpot()` placed a new note away from the AI diagram without adding a layout engine; the drawing guide still tells AI to put arrow endpoints outside shapes. | Keep drawing free-form, but provide a minimal visual convention: new objects avoid the current viewport center or exposed object bounds; connector endpoints remain outside shapes. Do not introduce a layout engine. |
| E10 | P2 | fixed | The one-command install is still checkout-centric. | README and English README present `npm run setup:codex` and zero-configuration `npx -y doodle-mcp` side by side; isolated `CODEX_HOME` smoke installed `doodle@doodle 0.6.3` without touching the active user config. | Document one first-class npm direct-MCP path and one plugin path in the 30-second start; do not claim public directory availability. |
| E11 | P2 | external | Agent-internal use still depends on host support. | `show_board` and post-draw `_meta` are guarded in `scripts/plugin-check.mjs`; README, FAQ, product direction, and architecture explain that MCP Apps hosts render the canvas and text-only hosts use `PANEL_URL` as fallback. | `show_board` and post-draw `_meta` remain the agent-first render path; standalone is explicitly fallback. A guide explains what to do when the host does not render MCP Apps. |

## Execution plan

1. Write this audit and link it from the documentation map.
2. Fix P0 data correctness and real-time synchronization with focused tests.
3. Fix P1 first-loop ergonomics: creation, double-click editing, help focus, progressive `get_board`, and empty first board.
4. Fix P2 feedback and visual clutter without adding product surface.
5. Re-run the same AI/human loop from a clean temporary board, update each row's status, then run `npm run check`, isolated plugin install smoke, direct-MCP smoke, and `git diff --check`.
6. Commit and push only after the audit rows are either closed or explicitly marked as an external host limitation.

## Closure log

- 2026-11-11: Rebuilt from the current source, restarted a clean temporary `OUTPUT_DIR`, and repeated the loop: `get_board` first-use guidance → `draw_board` → open browser auto-refresh → human create/edit/PATCH → `get_board` concise readback → `draw_board` response → second AI write. The open browser reached revision 7 without reload.
- 2026-11-11: `npm run check` passed: TypeScript, build, 31 tests, examples, repository/plugin guards, setup dry-run, submission ZIP, doctor, and npm package dry-run. `git diff --check` also passed.
- 2026-11-11: Isolated `CODEX_HOME` smoke ran `npm run setup:codex`, `codex plugin list --marketplace doodle --available --json`, and installed/enabled `doodle@doodle 0.6.3` without modifying the user's active `~/.codex` configuration.
- E11 is external because MCP Apps rendering is a host capability. It is closed as a documented fallback rather than a code change; the product does not add a fifth tool, browser-opening side effect, or second canvas session.

## Boundaries

- Keep exactly four MCP tools and the version 1 board schema.
- Keep stdout reserved for MCP JSON-RPC and logs on stderr.
- Never open a browser, IDE, or editor as a side effect of a normal MCP tool call.
- Keep human view/help state in browser localStorage only.
- Keep board objects as visual context; they never authorize project writes.
- Preserve `show_board` as an explicit optional render tool and successful `draw_board` results as the automatic canvas advertisement in compatible hosts.
