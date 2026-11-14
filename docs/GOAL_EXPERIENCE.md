# Goal: Native Visual Expression

This document defines a maintained target for Doodle's current experience work. It is a design record, not an active automation instruction.

## Objective

Move Doodle from "an AI can place objects" to "an AI can express and revise visual ideas with the four MCP tools, and a person can naturally understand and reshape those ideas." Keep one shared version 1 board, exactly four MCP tools, and the local editable board library. Do not add a fifth tool, a second session model, a static image exporter, chat in Doodle, or project-write authority.

## Problem

The previous board state exposes geometric primitives but not a stable visual language. AI callers receive object coordinates and fields, but no concise reading of what the drawing means. Lines are absolute arrows, so moving a shape does not preserve meaning. Objects render as generic DOM cards, with weak text fitting, variant rendering, selection affordances, layering, and style control. Saving and switching editable snapshots is complete, but the visual experience remains closer to a form than a whiteboard.

## Direction

1. Give agents a compact visual contract: capabilities, short recipes, deterministic layout modes, and a bounded `visualDigest` derived from the final board state.
2. Extend version 1 objects with optional fields for variants, styles, z-order, grouping, emphasis, and connector bindings. Existing boards remain valid without migration.
3. Make connected arrows follow their source and target objects, and make group/layout behavior preserve that visual meaning.
4. Improve canvas rendering and ergonomics: variant shapes, text fitting, styling, selection bounds, resize feedback, weak author/highlight cues, and reliable re-render after board-library switches.
5. Synchronize every product-facing document, test, example, CI check, and offline guard; verify the complete experience chain and local running board.

## Visual recipes

- **Flow:** labelled rectangles or notes in a row/grid, `line` with `startItemId` / `endItemId`, short edge labels, and `layout.mode: "timeline"` or `"grid"`.
- **Compare:** two or three `role: "column"` frames with matching child labels, `groupId` per column, and no fake connector text.
- **Cluster:** `groupId` plus `layout.mode: "cluster"` for related objects, with one short `title` object or `role: "label"`.
- **Emphasis:** `emphasis: "focus"` on one object, a freehand `stroke` around it, and a short `title` or `note` explaining why.
- **Image annotation:** bounded `image`, nearby `text`/`note`, and connected arrows or strokes that point without replacing the picture.

These recipes are guidance for using primitives. They are not a diagram template library, a Mermaid renderer, or a new persisted object model.

## Acceptance

1. `get_board` and `show_board` expose `capabilities`, `visualDigest`, and the local library index in structured content; text-only hosts can use the same workflow.
2. `draw_board` accepts optional `variant`, `style`, `z`, `role`, `startItemId`, and `endItemId`; all fields are version 1 compatible and validated.
3. Connected arrows resolve from object bounds and remain meaningful after a person or AI moves an endpoint object; stale connections are safely disconnected.
4. Deterministic layout supports `grid`, `row`, `column`, `timeline`, and `cluster` without a new tool or dependency.
5. The canvas renders variants, styles, z-order, connected arrows, and selection bounds without reintroducing a crowded toolbar.
6. Board-library save/switch continues to use one active board; context sync and `get_board` follow the newly active snapshot.
7. READMEs, agent handbook, product direction, architecture, decisions, plugin goal, experience audit, privacy, changelog, plugin skill, examples, tests, CI, and repository/plugin guards are synchronized.
8. `npm run check` passes, the local preview serves the updated template, and a saved board can be switched from both HTTP and MCP paths.

## Red lines

- No fifth MCP tool and no duplicate conversation surface.
- No required version 2 migration; no breaking change to old version 1 boards.
- Static PNG/JPG/SVG exports are sharing snapshots only; saved “图” remain editable JSON snapshots.
- No project file writes or approval semantics from board content.
- No normal MCP call that opens a browser, IDE, editor, or external app.
- No npm publish.
