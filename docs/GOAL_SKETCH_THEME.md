# Goal: Hand-Drawn Sketch Theme

This document defines a maintained target for adding a third appearance to
Doodle. It is a design record, not an active automation instruction.

## Objective

Add a **sketch** appearance — a hand-drawn, notebook-paper look — as a
third selectable theme beside the existing light and dark ones, and let a
person switch between all three from the canvas. The theme changes the
*chrome* (capsule, toolbar islands, drawer, menus, status, welcome card) and
the *page* it sits on. Board content keeps its own literal colours.

Keep exactly one shared version 1 board, four MCP tools, the local board
library, and the existing glass material. Do not introduce a second canvas,
a skin engine, per-object theme fields, or a persisted theme in board state.

## Why a third theme, not a restyle

Light and dark are the same design language at two luminances: warm paper and
pine green. A sketch theme is a different *language* — it should read like a
page from a field notebook rather than the same panel in different colours.
That is why it is an addition rather than a replacement: someone drafting a
diagram in a meeting wants calm glass; someone doodling an idea wants paper.

The distinction has to survive at a glance. A theme that only changes hue
does not earn a third slot in the switcher.

## Direction

1. **Three themes, one mechanism.** Introduce `ThemeName = "light" | "dark" |
   "sketch"` and drive every surface from one token table. Shape the token
   groups so a fourth theme is a data addition, not a code change threaded
   through `if (theme === …)` branches.
2. **Sketch is paper, not brown.** Off-white paper with a faint dot grid, ink
   that reads as graphite rather than black, and one warm accent used
   sparingly. No parchment texture, no torn edges, no skeuomorphic binder.
3. **Handwriting where it earns its place.** Headings and the theme/action
   labels may use a handwriting face; dense lists, board names, revision
   numbers, and any string a person scans quickly stay in the UI font. A
   handwritten 11px label is a legibility bug, not a style choice.
4. **Change the material, not just the palette.** This is the point the first
   pass got wrong: recolouring the panes still left a glass lens, and a lens
   that you can read through is the opposite of paper. The sketch theme
   therefore switches `data-doodle-material` from `glass` to `paper`, and every
   pane becomes an opaque sheet:

   - no refraction: `--glass-lens-scale`, `--glass-lens-blur`, and
     `--glass-frost` are all `0`, and `liquid-glass.ts` skips building a filter
     entirely when all three are zero, so the theme also costs less than the
     glass themes rather than more;
   - thickness: a darker lip under the bottom edge and a bright 1px top bevel,
     so a pane has a visible side like card stock;
   - contact: a short, comparatively dark shadow. Glass floats; paper rests;
   - interaction inverts: on glass a hover adds light, on paper a control
     presses into the sheet, so hover darkens and the inner shadow moves to the
     top lip.

   The page itself becomes stock too — a warm cream ground with a very low-alpha
   grain and a graphite dot grid — because a paper-themed chrome on a
   gradient-lit background reads as a skin over a renderer.
5. **The switcher must scale.** Replace the two-state toggle with a control
   that shows three options and the current one, works at 420px, and keeps
   the existing keyboard/screen-reader contract.
6. **Excalidraw stays pinned to its light theme.** Board colours are literal;
   changing the app theme must never repaint a person's drawing. Only the
   surrounding chrome and the page change.

## Scope

In scope:

- `ThemeName` type, token tables, and the switcher in `excalidraw.html` /
  `excalidraw-app.tsx`.
- Chrome tokens: surface, panel, ink, muted, border, accent, danger, canvas
  background, dot grid, edge washes, shadow.
- Glass tokens: fill, edge, highlight, shade, lens scale, hover/selected
  states.
- Excalidraw's remapped variables for the sketch theme (primary, surface,
  island, border, input, button, selection, shadow), so native toolbars do
  not render in the wrong palette.
- Type: one handwriting face for headings and short labels, chosen from the
  fonts already shipped with Excalidraw (`Virgil` for Latin, `Xiaolai` for
  Chinese) so no new dependency is added.
- The switcher control, its persistence, and its accessible name.
- Tests, offline guards, READMEs, agent handbook, architecture, decisions,
  changelog, and this document.

Out of scope:

- Per-object themes, board-level theme storage, or theme fields in Board v1.
- A theme editor, user-defined palettes, or import/export of themes.
- Animated transitions between themes.
- Any change to the four MCP tools, their schemas, or their output shapes.
- Raster textures, external image assets, or web fonts fetched at runtime.

## Acceptance

1. Three appearances are selectable from the canvas: light, dark, sketch.
   The choice persists across reloads and applies before first paint, so the
   page never flashes the wrong palette.
2. The sketch theme is visually distinct in kind, not only hue: paper ground,
   graphite ink, a drawn grid, and a restrained accent. Side-by-side captures
   of all three themes at 1280×860 and 420×820 are recorded as evidence.
   Mechanically: `data-doodle-material="paper"`, `backdrop-filter: none` on
   every pane, and **zero** generated `doodle-liquid-glass-*` filters, while
   light and dark keep both the filters and their translucency.
3. Handwriting is applied only to headings and short control labels; every
   string that a person reads to make a decision stays in the UI font at a
   legible size. Verified by inspecting computed `font-family` per surface.
4. Board content is untouched by a theme switch: the same board renders the
   same item colours in all three themes, and Excalidraw's own `theme` prop
   never changes.
5. The switcher is reachable by keyboard, exposes the current theme through
   `aria-*`, and does not overflow at 420px.
6. Contrast holds: body text and icons meet at least 4.5:1 against their own
   surface in all three themes; muted text meets 4.5:1 where it carries
   information and 3:1 where it is decorative.
7. `npm run check` passes, including new guards that fail if a fourth theme
   is added without a token table, if the sketch theme loses its type stack,
   or if a theme switch can write to board state.
8. An audit record lists every surface checked, with the method used and the
   observed value — not just "looks fine".

## Evidence required before merge

- Screenshots of all three themes at desktop and 420px widths, covering:
  empty board, toolbar, hover and selected states, library drawer, dropdown
  menu, welcome card, and sync banner.
- Computed-style table proving the type stack per surface.
- Contrast measurements for the sketch theme's text pairs.
- Confirmation that a theme switch performs zero board writes and produces
  no new revision.
- `npm run check` output.

## Red lines

- No fifth MCP tool, no second canvas engine, no second persisted state model.
- No theme field in Board v1 or in the board library index.
- No dependency added for fonts or textures; use what Excalidraw already
  ships.
- No theme switch that mutates `board.json`, the library, or object colours.
- No normal MCP call that opens a browser, IDE, or editor.
- No npm publish, force push, history rewrite, or tag movement.
