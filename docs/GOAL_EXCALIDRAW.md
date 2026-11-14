# Goal: Excalidraw Canvas Engine Spike

This branch evaluates and implements a complete Excalidraw-based canvas engine without changing Doodle's product kernel. It is an experimental distribution, not a decision to replace the default `master` experience.

## Objective

Use `@excalidraw/excalidraw` as the human-facing infinite canvas while keeping Doodle's four MCP tools, version 1 `BOARD_JSON`, local editable board library, final-state context sync, and standalone/MCP App fallback contract intact.

```text
BoardStore / MCP tools / HTTP API / BoardLibrary
  → authoritative version 1 board.json
  → Doodle ↔ Excalidraw adapter
  → Excalidraw React canvas
  → onChange projection back to Board v1
  → get_board / model context / library snapshots
```

## Rules

1. `get_board` is authoritative and still returns Doodle Board v1 plus `capabilities`, `visualDigest`, `library`, and `PANEL_URL`.
2. `draw_board` keeps exactly the same four-tool MCP surface. `library` actions remain available through `draw_board`.
3. Excalidraw elements and `appState` are UI-only state. They are not persisted as the board library format.
4. All canvas edits by a person must be projected into Board v1 through the existing human-confirmed HTTP or MCP bridge path.
5. All AI writes and library switches must update the Excalidraw scene through `updateScene` without losing Board v1 revision safety.
6. Excalidraw assets, CSS, fonts, and locales must be self-hosted from the local preview/plugin package. No CDN or hosted endpoint is used.
7. Conversation stays in the host chat. Doodle does not add Excalidraw collaboration, accounts, chat, or hosted state.
8. Static PNG/SVG export remains a non-goal, even though Excalidraw can do it.
9. The DOM canvas engine from `master` remains available as a fallback. The experimental engine is selected by `?engine=excalidraw` or an explicit environment flag.

## Acceptance

1. `@excalidraw/excalidraw`, React, ReactDOM, and `perfect-freehand` are pinned and built locally with esbuild; no CDN references exist.
2. Excalidraw production CSS and fonts are copied into `dist/infra/templates/excalidraw/` and the generated plugin package.
3. `GET /?engine=excalidraw` serves an Excalidraw-based canvas, while the default path continues to serve the DOM canvas.
4. Board v1 objects project into Excalidraw elements with stable IDs and `customData.doodle` metadata.
5. Human edits project back into Board v1 objects; common rectangle, ellipse, diamond, text, arrow, line, freedraw, image, frame, and grouped elements have deterministic mappings.
6. AI writes from `draw_board`, HTTP batch/replace, and board-library switch refresh the Excalidraw scene.
7. MCP App context sync and the `通知 Agent` button still work when the Excalidraw engine is active.
8. Tests cover the pure adapter functions, engine selection, self-hosted assets, library switching, and four-tool safety.
9. `npm run check` passes on the experiment branch; a local preview is visually verified.
10. The experiment branch is pushed. `master` is not changed and npm is not published.

## Observed cost

With Excalidraw production assets copied into `dist/` and the generated plugin package, `npm pack --dry-run` grows from roughly 260 KB to about 17.3 MB compressed and 27.2 MB unpacked, with 582 files. The Excalidraw engine bundle itself is about 8.4 MB before compression. This confirms the experiment must remain isolated from the stable default distribution until product value outweighs packaging cost.

To use the experimental engine locally, append `?engine=excalidraw` to the active `PANEL_URL`; the default URL continues to serve the DOM canvas.

## Red lines

- No fifth MCP tool.
- No Excalidraw scene as the persisted board format.
- No project writes from board objects.
- No hosted sync, telemetry, CDN assets, or external fonts.
- No merge into `master` from this goal.
- No npm publish.
