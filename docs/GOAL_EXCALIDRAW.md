# Goal: Excalidraw Canvas Engine Spike

Since `0.8.0` this is the shipped canvas engine. It replaced the earlier DOM canvas without changing Doodle's product kernel: the four tools, version 1 board state, library, and safety boundaries are unchanged.

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
3. Excalidraw elements and `appState` are UI-only state. They are derived from Board v1 on every render and are not persisted as the board library format or a second scene file.
4. All canvas edits by a person must be projected into Board v1 through the existing human-confirmed HTTP or MCP bridge path.
5. All AI writes and library switches must update the Excalidraw scene through `updateScene` without losing Board v1 revision safety.
6. Excalidraw assets, CSS, fonts, and locales must be self-hosted from the local preview/plugin package. No CDN or hosted endpoint is used.
7. Conversation stays in the host chat. Doodle does not add Excalidraw collaboration, accounts, chat, or hosted state.
8. Static PNG/JPG/SVG sharing snapshots are derived from the canvas and never become board-library state; the editable library remains version 1 JSON only.
9. Excalidraw is the only human-facing canvas engine. The legacy DOM canvas and `board-app.js` bundle are removed from source, build, plugin package, and guards.

## Acceptance

1. `@excalidraw/excalidraw`, React, and ReactDOM are pinned and built locally with esbuild; no CDN references exist. `perfect-freehand` and the old `board-app.js` bridge were removed as redundant because Excalidraw bundles its own freehand implementation and the context bridge now lives in `excalidraw-app.tsx`.
2. Excalidraw production CSS and fonts are copied into `dist/infra/templates/excalidraw/` and the generated plugin package.
3. `GET /` serves the Excalidraw-based canvas; there is no DOM-engine fallback.
4. Board v1 objects project into Excalidraw elements with stable IDs and `customData.doodle` metadata.
5. Human edits project back into Board v1 objects; common rectangle, ellipse, diamond, text, arrow, line, freedraw, image, frame, and grouped elements have deterministic mappings.
6. AI writes from `draw_board`, HTTP batch/replace, and board-library switch refresh the Excalidraw scene.
7. MCP App context sync and the `通知 Agent` button still work when the Excalidraw engine is active.
8. Tests cover the pure adapter functions, engine selection, self-hosted assets, library switching, and four-tool safety.
9. `npm run check` passes and a local preview is visually verified.
10. The release is merged to `master`, tagged, and published to npm; `master` carries only the Excalidraw canvas.
11. Semantic diagram generation stays within Board v1, with one authoritative layout resolver and no separate Excalidraw scene endpoint.

## Observed cost

After removing duplicate Excalidraw production JS/locales from the generated assets, `npm pack --dry-run` reports about 16.0 MB compressed and 22.9 MB unpacked, with roughly 512 files. Most of the weight is Excalidraw's self-hosted fonts, locales, and lazily loaded Mermaid chunks. This is the accepted packaging cost of shipping the full canvas locally with no CDN, hosted font, or license key; `0.8.0` records it rather than claiming a small package.

The active `PANEL_URL` opens the Excalidraw canvas directly. There is no separate stable DOM-engine branch to fall back to.

## Stabilization fixes

- Text typed into a shape is represented as one Board v1 object with an Excalidraw bound text element; it no longer duplicates into a second board object or creates visible overlay/stacking artifacts.
- `onChange(elements, appState, files)` now preserves image file data, pauses persistence while text/line/group editing is active, and resumes after editing finishes.
- Excalidraw scene fidelity is kept in optional `scene` metadata inside version 1 board state: bound text, container/frame/group IDs, element ordering, bindings, and image file metadata. Old boards without `scene` remain valid.
- Standalone pages listen to WebSocket `board_updated` / `board_library_updated`; remote changes refresh the scene only when the person is not actively editing.
- The Excalidraw-only page keeps a lightweight board-library overlay for save/switch/create/rename/duplicate/delete/import/export.
- Generated assets copy only self-hosted CSS/fonts plus esbuild chunks, not the duplicate Excalidraw production bundle and locale tree.
- The embedded canvas restores one `通知 Agent` button that appears only when the host advertises both `updateModelContext.text` and `message.text`.
- Semantic diagrams are generated as ordinary version 1 objects with bounded labels and z-order; a prior native-scene experiment was removed to avoid board/scene divergence.

## Red lines

- No fifth MCP tool.
- No Excalidraw scene as the persisted board format.
- No project writes from board objects.
- No hosted sync, telemetry, CDN assets, or external fonts.
- No second persisted canvas engine or DOM fallback.
- No unreviewed merge: the release goes through `master`, the tag workflow, and `npm run check`.
