# Goal: Paper and Glass Appearances

This document records the target for Doodle's three canvas appearances. It is
a design record, not an active automation instruction.

## Objective

Offer three selectable appearances from the canvas — **浅色 / light**,
**深色 / dark**, and **液态玻璃 / glass** — with a single three-way switcher.
Light and dark are one paper desk at two luminances; glass is the original
refracting lens. Changing the appearance changes the chrome and the page,
never the board.

Keep exactly one shared version 1 board, four MCP tools, and the local board
library. Do not introduce a second canvas, a skin engine, per-object theme
fields, or a persisted appearance in board state.

## Why paper is the default

The canvas is a place to think and doodle, not a glass control panel. Paper
reads as a surface you can mark up: warm uncoated stock, graphite ink, a quiet
pencil-blue accent, and a visible card edge. Dark mode is the same material
after the lights go down — charcoal stock and pale ink, not green-tinted glass.
Glass stays available for people who want the original lens, but it is no
longer the default language of the product.

The difference has to survive at a glance. An appearance that only changes hue
does not earn a third slot in the switcher.

## Direction

1. **Three appearances, one mechanism.** `THEMES` is the single source of
   truth; its ids are `light`, `dark`, and `glass`. The type, persistence
   validation, and switcher all derive from it. Adding a fourth appearance is
   one `THEMES` entry plus a token block, never a new `if (theme === …)`
   branch.
2. **Separate palette from material.** `data-doodle-theme` selects the palette;
   `data-doodle-material` selects the build (`paper` for light and dark,
   `glass` for glass). All material rules key off `data-doodle-material`, so a
   new paper tone does not need a new set of selectors.
3. **Paper is opaque stock, not tinted glass.** It has no refraction:
   `--glass-lens-scale`, `--glass-lens-blur`, and `--glass-frost` are `0`, and
   `liquid-glass.ts` skips filter generation when all three are zero. Panes
   have a bright top bevel, a darker lip, and a two-tier shadow so the toolbar
   rests on the desk and the drawer sits above it.
4. **Texture is generated.** Two isotropic `feTurbulence` fields — fibre and
   tooth — are desaturated and blended into the sheet. On light paper they
   multiply; on dark paper they screen, because multiplying into charcoal
   removes luminance that is not there and the grain vanishes.
5. **Typography stays legible.** The shipped handwriting faces cover Latin
   only. The interface is Chinese, so paper uses the UI font with slightly
   larger headings; it does not pull in hundreds of `unicode-range` shards to
   fake handwriting.
6. **Board colours are literal.** Excalidraw stays pinned to its light theme.
   An appearance switch repaints the chrome and the page, never a person's
   object colours, and never writes to board state.

## Scope

In scope:

- The `THEMES` table, token blocks, and switcher in `excalidraw.html` /
  `excalidraw-app.tsx`.
- Chrome tokens: surface, panel, ink, muted, border, accent, danger, canvas
  background, dot grid, washes, and shadow.
- Glass/material tokens and the Excalidraw variables mirrored for each palette.
- Persistence and the accessible `aria-pressed` switcher state.
- Tests, offline guards, the agent handbook, changelog, and this record.

Out of scope:

- Per-object themes, board-level appearance storage, or theme fields in Board v1.
- A theme editor, user-defined palettes, or import/export of appearances.
- Animated transitions, new font dependencies, or raster texture assets.
- Any change to the four MCP tools, their schemas, or their output shapes.

## Acceptance

1. Three appearances are selectable, persist across reloads, and apply before
   first paint without flashing another palette.
2. Light and dark use `data-doodle-material="paper"` with no generated glass
   filters; glass uses the lens and keeps its translucency.
3. The default Excalidraw token block matches the default light paper palette;
   glass and dark are explicit overrides.
4. A theme switch recolours scene ink through `doodle-theme-change` for all
   three ids and performs zero board writes.
5. The switcher is reachable by keyboard, exposes the current appearance with
   `aria-*`, and does not overflow at 420px.
6. Body text and icons meet at least 4.5:1 against their own surface in all
   three appearances.
7. `npm run check` passes, including guards for the three ids, the material
   split, and the absence of upstream violet in Excalidraw's tokens.

## Evidence

- Screenshots of all three appearances at desktop and 420px widths.
- A computed-style check proving paper panes have no refraction filter and
  glass panes do.
- Confirmation that a switch performs no board write and creates no revision.
- `npm run check` output.

## Red lines

- No fifth MCP tool, second canvas engine, or second persisted state model.
- No appearance field in Board v1 or in the board library index.
- No appearance switch that mutates `board.json`, the library, or object colours.
- No normal MCP call that opens a browser, IDE, or editor.
- No npm publish, force push, history rewrite, or tag movement.
