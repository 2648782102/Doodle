# Goal: A Board You Reach For

Direction after `0.8.0`. This is a maintained product objective, not an
automation directive.

## The question

Not "what else can the board do", but: **why would someone open Doodle instead
of a sticky note, a napkin, or the agent's own text reply?**

The product is already feature-complete for a shared canvas: four tools, a
library, diagram authoring, exports, two themes, a working MCP App. What it is
not yet is *handy*. A board you have to set up is not the board sitting next to
you.

## Measured friction today

Opening a blank board for the first time currently takes seven steps:

```text
clone → npm install → npm run build → start a preview or an MCP host
→ find the port in terminal output → copy the URL → open a browser
```

And the shortest path has no on-ramp at all:

```text
$ npx -y doodle-mcp
[INFO] 4 MCP tools registered
[INFO] Board preview at http://127.0.0.1:55793/
[INFO] doodle-mcp is running (stdio + preview server)
```

A person who just wants to sketch something learns nothing from that: no
prompt, no "open this", no indication that a canvas exists or what to do with
it. The server is speaking to an MCP host, and only incidentally to a human.

That is the gap this objective closes. Everything else is secondary.

## Objective

Make the board reachable in one action and obvious on first sight, without
turning Doodle into a different product.

```text
one command  → canvas opens, already focused and ready to draw
no setup     → a person can draw without an agent, and an agent can draw without a person
resume       → the board you used last is the board you get back
```

## Scope

1. **One-action open.** A single command starts the local board and puts it in
   front of the person. No port reading, no URL copying. It must degrade
   gracefully on a headless machine (print the URL instead of failing).
2. **A first screen that teaches itself.** A first-time visitor should know how
   to draw within a few seconds without reading documentation: what to click,
   how to make a note, how to pan, and how to get the agent involved.
3. **Person-first, not agent-first.** Drawing must not require an MCP host. The
   board works standalone; the agent joins the same board when a session exists.
4. **Resume what you had.** Reopening returns to the board you were on, at a
   sane viewport, with unsaved local work never silently lost.
5. **Zero-surprise state.** No action may delete board content without an
   explicit human intent; loading the canvas must never write an empty scene.
6. **Small surface.** Four tools, version 1 state, one canvas. Improvements are
   ergonomics, not new product categories.

## Acceptance

- One documented command opens the board in the default browser from a clean
  checkout, and the same command prints a usable URL when no browser can open.
- A first-time person can create a note, draw a shape, pan, and zoom without
  consulting documentation; the first screen states these gestures and can be
  dismissed permanently.
- Standalone drawing works with no MCP host running, and the same board is what
  an agent reads afterwards.
- Reopening the page restores the active board and does not reset the library.
- Loading, refreshing, or losing the agent session never removes objects.
- `npm run check` passes, docs and guards match, and each change is verified in
  the real canvas rather than only in unit tests.

## Non-goals

- No hosted accounts, sharing links, or multi-user editing.
- No second chat surface, session model, or message feed.
- No project dashboard, template gallery, or diagram catalogue.
- No new MCP tool and no new persisted format.

## Order of work

1. One-action open and the standalone on-ramp; this unblocks everything else.
2. First-screen teaching and resumable viewport.
3. State-safety hardening around load, refresh, and concurrent writers.
4. Ergonomics pass on the gestures people actually use most.

Each step is verified in the running canvas and recorded here with the measured
before and after.

## Progress log

### 2026-11-15 — one-action open, first-run guidance

**Before:** seven steps, ending with "copy a port out of terminal output".
`npx -y doodle-mcp` printed three log lines and no human instruction.

**After:**

- `npm run doodle` starts the board and opens the default browser. On a machine
  with no browser it prints the URL and the same short guidance instead of
  failing (`--print` forces that path).
- Running the server directly now prints a human-facing two-line hint with the
  board URL, separate from MCP JSON-RPC on stdout.
- An empty board shows a dismissible card on first visit: double-click for a
  note, drag to draw, space/wheel to pan, modifier+wheel to zoom. Dismissal is
  remembered in localStorage, and the card never appears on a board with content.

Both were verified in the live canvas, not only in tests.

### 2026-11-15 — resume, state safety, and gesture audit

**Resume.** Each board now remembers its own camera (scroll and zoom) in browser
storage, capped at eight boards. Two rules keep it from being a trap: an empty
board never restores a camera, and a remembered camera panned far from the
content is discarded so a full board cannot look blank. Verified by panning,
reloading, and confirming the view held.

**State safety.** Writes that would clear every object from a non-empty board
are now refused with a 409 instead of being applied, because "the board went
blank" is almost always a client bug — today it was a canvas writing its
pre-mount empty scene. A deliberate delete by id still works, and a first write
to a new board is unaffected. Covered by a unit test plus an HTTP test that
proves the objects survive.

**Gesture audit.** Checked the four high-frequency paths in the real canvas:
note creation, shape drag, arrow drag, and freehand ink. The one defect found was
the restored camera stranding the view; it is fixed above.
