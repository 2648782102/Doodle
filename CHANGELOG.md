## Unreleased — Easier to reach

### Changed

- The library drawer groups actions by intent instead of laying every verb on one grid. The old panel had six equal buttons plus two more under the list: "另存为" and "复制所选" were literally the same duplicate call under two labels, "重命名" read the name field from rows away, and "删除" always applied to the active board even though the list let you pick any board. Now the name field and its rename action share a row, "新建 / 另存一份 / 导入" sit beside the list title, each board row carries its own "导出 / 删除", and clicking a row opens that board — which removed the separate "切换到选中" button and the select/double-click/switch triple path.
- Doodle chrome uses a real liquid-glass material, not a frosted panel. Each pane gets its own SVG backdrop filter built at device resolution: a bevelled displacement map bends the page near the rim, a specular map lights the rim from the upper left, its shadow side darkens the opposite bevel, and a light blur plus saturation finish the surface. The fill is a ~12% white wash: enough to read as glass rather than a clear sheet, still under the ~16% point where the dot grid disappeared. Maps rebuild on resize and theme change, and the filter stays on the shell only, never the canvas surface or dialogs. Engines without an SVG backdrop filter (Firefox, Safari) fall back to blur and saturation.
- The canvas carries a low-amplitude warm/cool colour field at its edges plus a slightly stronger dot grid. A near-white page gave the bevel nothing to bend, which made the first two material attempts read as a white card; the dots now visibly magnify inside a pane and stay the same size outside it. The field fades before the middle of the canvas, so drawing stays untinted.
- The glass now meets a consistent pane language. Every floating surface is inset 12px, rounded 14–18px, and shares one rim/shadow recipe: the Doodle capsule sits where Excalidraw's wordmark menu used to, the library drawer became a floating card instead of a square docked sheet, the right-hand library sidebar is inset and rounded, the selected-object style panel is a rounded glass popover that clears the zoom controls, and the bottom zoom/undo/help islands share the toolbar radius.
- Excalidraw's wordmark menu is removed rather than restyled. It only held Search, Help, and an outbound GitHub link: search stays in the toolbar's palette action, help is the `?` button, and a local board ships no external links. Its removal also freed the top-left cell for the Doodle capsule and let the shape toolbar keep its optical centring.
- Doodle's dark page now re-themes Excalidraw's chrome tokens instead of only its `theme--dark` class. Excalidraw is pinned to the light theme so board colours stay literal, so before this the zoom group, help button, and library trigger rendered as white panes on a black canvas.
- Fixed drawings disappearing right after they were made. Excalidraw reports a single line of text as ~15px tall, and the stored-item floor is 16px, so one new label made the server reject the *whole* board replacement with a 400. The canvas then reloaded the previous revision, silently erasing the drawing. Canvas projection now clamps width and height to the stored floor after rounding, and a rejected save no longer repaints the canvas from the server: it keeps what the person drew, refreshes only the revision for a retry, and shows a visible banner instead of a console warning.
- The mobile chrome is on the same material and geometry as the desktop panes. Below Excalidraw's mobile breakpoint the right-hand library strip was an opaque square-cornered sheet hanging off the window edge, and the bottom bar was a bare full-width 8px plate; both are now inset, rounded glass with the shared rim and shadow. The extra-tools sheet is rounded glass too, and hides the right-hand strip while it is open. Excalidraw's rotating hint strip (`.HintViewer`) is hidden: it is upstream tutorial copy that overlapped the Doodle capsule on narrow screens.
- The expanded property sheet (selecting an object on a phone) is now a real panel rather than a translucent full-screen layer. It inherited the 16% glass fill, so the board showed through the swatch labels while 913px of fields overflowed a 794px card. It now uses the solid panel surface with no backdrop filter, is capped at 62vh and scrolls internally, lays its sections out in two columns so it fills the card instead of using the left half, and keeps the colour pickers and opacity slider full width. Rows, section spacing, and swatch sizes were rebalanced for touch.
- The right-hand mobile tool strip has even 40px rows with a real inset. Upstream sized each child by its content, so the library trigger rendered 44px beside 32px buttons and sat flush against the rim.
- The bottom-left zoom/undo cluster and the top-right library trigger are now glass. They are the only chrome that is not an `.Island`: plain buttons painted with an opaque `--button-gray-1` on an `--island-bg-color` container, so none of the pane rules reached them and they stayed flat solid pills. Their containers now carry the refraction filter and the shared rim/shadow, and the opaque button fills are cleared so the page shows through. Hover and selected states keep their own colour, and the help button uses a slightly denser fill because a bare icon on 16% glass disappeared against a near-white page.
- Removed the inset highlight that made every pane look like it had a second rectangle underneath. `inset 0 0 22px -14px` uses a negative spread, which shrinks the inner shadow into a smaller rounded rect instead of lighting the edge; on 44px chrome it drew a visible box ~8px inside the outline. The bevel highlight now comes only from the specular map, which follows the rim exactly, and the pane reads as one continuous surface.
- The bevel displacement now tapers to zero at the inner edge of the band. It previously stopped at 0.68 amplitude, so the backdrop was sampled from two different places across a one-pixel line, leaving a seam across the inside of the pane.
- Excalidraw's rotating `HintViewer` strip ("press Enter to add text…") is hidden at every width, not only on phones. It is upstream tutorial copy that mixed English and Chinese over the board and collided with the Doodle capsule.
- Fixed four defects in `draw_board.diagram` that surfaced while drawing a 16-step process:
  - connectors may now reference a node declared later in the array; `parseBoard` validates bindings after collecting every item, so "line first, then its endpoints" no longer fails with `Invalid line start item`;
  - every requested edge is routed. Only same-row adjacent hops used to be drawn, so a long chain silently lost 5 of 15 arrows while the tool still reported success. Skip, cross-row, and snaked links are drawn now;
  - a `flow` with no explicit coordinates snakes after six columns instead of becoming one unreadable strip (16 steps: 3160 → 1340 wide);
  - appending a diagram whose generated ids already exist (`n1`, `diagram_frame`) suffixes them and rewrites the connector bindings, instead of failing the whole call with `Duplicate board item ID`.
- `diagram.nodes[].row` now accepts 0-47 to match the 48-node limit; it was capped at 12, so a 17-step timeline was rejected. Nodes that carry only a `row` continue the last explicit column instead of being pushed into a second column.
- Added `docs/DIAGRAM_GUIDE.md` with the field table (`label` not `title`, `author` at the top level), the verified `replace` semantics, layout limits, and when hand-placed coordinates are the better choice.
- The empty-board guard no longer depends on an optional header. It previously ran only when `If-Match-Revision` was present, so a client that does not track revisions — a stale canvas after reload — could replace a full board with zero items and erase it. Both commit paths now build the candidate first and refuse a suspicious clear with 409.
- A corrupt `board.json` no longer prevents the MCP server from starting. Invalid JSON threw out of `init()`, the plugin registered zero tools, and the board could not be recovered from the app. The damaged file is now moved to `board.json.corrupt-<timestamp>`, an empty board is created, and the reason is logged on stderr.
- Out-of-range drawing input is rejected instead of clamped. Coordinates, sizes, line deltas, text length, colour, and author were previously coerced to a default or a bound and then reported as success, so a caller asking for `x: 999999` silently got `x: 100000` and a 99999-wide box came back 2000 wide. Missing values still get defaults; invalid explicit values now raise a descriptive error.
- Browser edits are recorded in the shared revision cache. `BoardHttpServer` never wrote to it, so a canvas edit produced a revision `get_board(since_revision)` had never seen and the delta path degraded to a full board on exactly the changes a person had just made.
- Restructured the logic layer by responsibility, with no behaviour change. `types.ts` was a 1191-line module mixing types, limits, validation, construction, layout, diagram generation, and summarisation; it is now a thin barrel over `model/` (types, limits, validate, board, digest, clock), `diagram/` (layout, generate), and `layout/` (arrange). `tools.ts` became `mcp/` with one module per tool plus context, schemas, and presentation. `excalidraw-adapter.ts` split by direction into `canvas/` (types, theme, primitives, to-excalidraw, from-excalidraw). `library.ts` split into `library/schema.ts` and `library/store.ts`. `http.ts` moved template lookup into `http/templates.ts`, which also fixed the relative paths after the move and cut the file from 411 to 365 lines. Every existing import path still works.
- Added a golden model test that freezes the contract across projections, all six layout modes, all four diagram modes, and the long-flow property, so a future refactor cannot drift silently.
- Replaced brittle module-count guards with structural ones: the check now asserts each layer exists, no module exceeds 450 lines, barrels stay under 120 lines, and the monolithic `tools.ts` cannot return.
- AI experience pass 1: `get_board` now returns `VISUAL_DIAGNOSIS` / `VISUAL_DIAGNOSIS_JSON`, a bounded advisory view of isolated nodes, overlapping objects, focus points, unresolved connectors, overall bounds, and candidate empty areas. It is derived from final Board v1 objects and grants no write authority.
- AI experience pass 2: validation failures in `normalizeItem` now raise `BoardValidationError` with a stable code, field path, expected contract, and concrete fix. `errorResult` serialises that as `ERROR_JSON` so a model can repair a rejected call without reading source.
- AI experience pass 3: `diagram.recipe` accepts `flow`, `review`, `decision`, `timeline`, and `architecture` plus `steps`/`options`, expanding them into the same semantic nodes/edges the deterministic layout already understands. A recipe is authoring sugar; it does not add a second rendering path.
- AI experience pass 4: `draw_board` replies now include `CHANGE_JSON` / `CHANGED` and a `change` field in structured content, computed from the before/after board with the same delta logic as `get_board`.
- AI experience pass 5: added `test/ai-experience.test.mjs` as the first prompt-contract suite, asserting the model-visible facts: diagnosis, recipe expansion, change report, and repairable errors.
- AI experience pass 6: `capabilities` now documents `roleMeanings` and `emphasisMeaning`; roles include `question`, `constraint`, and `evidence` so human and AI can annotate intent, not just appearance.
- AI experience pass 7: `get_board` accepts `view: summary | structure | detail | full`. Default remains `full`; lower levels drop text blobs, capabilities, or items while keeping authoritative revision and diagnosis.
- Fixed drawing silently not saving. The canvas accepted an edit only after `elements.length` reached `activeSnapshot.items.length`, but Excalidraw does not expose one element per board object: a board of ten objects can render nine elements, so the count never satisfied the gate, `sceneReady` stayed false, and every human edit was dropped while the save endpoint still returned 200. Readiness is now a one-way latch on the first non-empty scene.
- Fixed centred captions drifting left. Excalidraw re-measures a text element from its own content, so a caption stored at the card's width (190px) came back as the width of its two characters (24–48px) and 24px to the left. `textAlign: center` then centred the caption inside that narrow box instead of under the card. The projection now keeps the stored x and width for text elements; the canvas still decides how the glyphs render inside the box.

### Fixed

- `layout` refuses what it cannot honour instead of arranging something else. An unknown id left an empty selection, which the filter read as "no filter" and arranged the *whole* board — a tidy-up that moved everything. `columns: 0` became 1 and stacked every object on one spot; `gap: 500` was quietly reduced to 200; `mode: "spiral"` fell back to grid. All four are now `ITEM_NOT_FOUND`, `LAYOUT_COLUMNS_OUT_OF_RANGE`, `LAYOUT_GAP_OUT_OF_RANGE`, and `INVALID_LAYOUT_MODE`, each with the index or the range, and nothing moves. `architecture` keeps its own tighter 2-6 / 24-120 range.
- A batch update or removal either lands completely or not at all. `updateBoardItems` looped over the *board* and looked each item up in the patch map, so an update for an id that did not exist was silently dropped while the call reported success — a model revising five labels and mistyping one id was told all five landed. Removals had the same shape: only "at least one id matched" was checked. Both now validate the request first and refuse the whole batch with `ITEM_NOT_FOUND` plus the index.
- An overlong title or group id is now rejected instead of truncated. `slice(0, MAX_TITLE)` dropped the tail of a 121-character heading and still reported success, so the caller believed the whole title landed. Turning that and `groupId` into bounds also removed the last silent clamps in `normalizeItem`: coordinates are validated by `resolveGeometry` before they reach the record, so they no longer pass through `Math.max`/`Math.min` on the way in.
- A long flow now packs into full passes instead of drifting down the page. The snake's row counter added the pass index on top of the running column count, so every pass pushed the base further down: an 18-step chain (three passes of six) laid out as eight rows and a 48-step chain as thirty-eight — 14,740px of height, past any usable canvas. The same chart is now 8 rows and 938px. The derived layer was also capped at column 12, which collapsed passes three and four onto each other.
- A board switch is no longer reported as an edit. The revision cache is keyed by revision alone, so asking for a delta after a library switch compared the new board against the previous board's revision: every object of the new board read as "added" and every object of the old one as "removed", which describes a change nobody made. A revision from a different board now falls back to a full read that says it did.
- A board at the object ceiling tells the model how to get out. "Board item limit reached" carried no current count, no limit, and no route forward; it is now `BOARD_ITEM_LIMIT` with the numbers and the suggestion to put the rest on a second board. A missing update target is likewise `ITEM_NOT_FOUND` with the re-read instruction instead of "Board item not found".
- `get_board` names the cheaper reads once a board gets expensive. A 400-object board is 152 KB for a full read and 6 KB at `view: "summary"`, but nothing in the reply said so; boards above 80 objects now report their size and list `summary` / `structure` / `since_revision`. Small boards stay quiet.
- `draw_board` now describes itself. Its 171-character blurb never mentioned `diagram`, `updates`, or the top-level `author`, so a model had to discover a nine-field tool by failing. The description states the three mutually exclusive uses, says that a complex diagram should prefer `diagram` over hand-computed coordinates, and that an existing board should be revised with `updates` rather than rebuilt.
- `replace_board` now rejects a payload the write path would reject. It used to check only that `color` was a *string*, so a hand-built board with `color: "nope"` was persisted and the canvas had no usable fill. The persisted-state and write paths now share one set of predicates, so they cannot disagree again.
- Every `replace_board` rejection names the offending item. A bad colour three levels into a 200-object payload used to surface as "Invalid board collections"; it now reports `items[7].color` with the expected form and a fix, because a whole-board payload is unrepairable without the index.
- Validation split into `model/predicates.ts` (shared shape rules), `model/parse-board.ts` (persisted state), and `model/validate.ts` (write path). `validate.ts` had crossed the 450-line budget, and the split is what makes the two paths share rules instead of drifting.
- Two agents drawing at the same moment no longer fail each other. A write without `expected_revision` used to read the board *outside* the store lock and then persist with that revision, so the loser got `expected N, found N+1` — a failure it could neither explain nor act on. Unpinned writes now go through `store.mutate`, which re-reads inside the lock; both writes land. A caller that pins a revision still gets the strict rejection, because that number is a claim about what it last saw.
- The library's `switchTo` default is documented instead of implicit. `create`, `save`, `duplicate`, and `import` make the result active when the field is omitted — correct for the canvas, dangerous for an agent tidying the library, because the person's view moves under them. Each field now states its default, and the `library` description tells the model to pass `switchTo: false` for housekeeping.
- A rejected write now names the field and the repair on every path a model actually hits. Bounds used to live in the MCP input schema, but the SDK validates that *before* the handler runs and answers with bare `MCP error -32602` prose — so a 1,300-character text or a 200-item batch gave the model nothing to correct, while a bad colour gave it a full `ERROR_JSON`. Bounds now live in `model/` and every rejection reaches one serialiser:
  - `BATCH_TOO_LARGE` (over 100 items in one call, with the number of calls to split into)
  - `LINE_WITHOUT_DIRECTION`, `STROKE_POINTS_INVALID`, `IMAGE_SOURCE_MISSING`
  - `CONNECTOR_ON_NON_LINE`, `INVALID_VARIANT`, `INVALID_ROLE`, `INVALID_EMPHASIS`, `INVALID_LINE_SHAPE`, `INVALID_Z`
  - `DIAGRAM_TOO_LARGE`, `INVALID_DIAGRAM_MODE`, `INVALID_NODE_ID`, `UNKNOWN_EDGE_NODE`, `DIAGRAM_ROW_OUT_OF_RANGE`, `DIAGRAM_COLUMN_OUT_OF_RANGE`, `DIAGRAM_ORIGIN_OUT_OF_RANGE`
- `capabilities.limits` now publishes the bounds a model is checked against — objects per board and per call, shape size, coordinates, text and title length, stroke points, image size, line deltas, diagram node/edge/column/row ceilings, and `z`. The drawing guide restates the ones that shape a first attempt, so the cheapest repair is not needing one.
- A write now returns only what the canvas reads. `draw_board` was handing back the full agent payload on every call — on a 26-object board, a 13.5 KB result for a single-note edit, of which the canvas used 6.7 KB. `applyRemoteSnapshot` reads exactly `id`, `revision`, `items`, and `library`, so `copyText`, `visualDigest`, `diagnosis`, `capabilities`, and `safety` were dead weight on every brush stroke. The result is 9.9 KB (−36%), and `get_board` still carries the complete agent contract.
- Fixed every library action costing a second round trip. `libraryRequest` reads the returned snapshot to repaint the canvas, but the library branch returned only the agent payload, so that snapshot was always missing and the canvas silently fell back to `fetch("/api/board")`. Save, switch, create, rename, duplicate, delete, import, and export each paid for it. The branch now returns the same flat `boardWriteSnapshot` as a normal write, which also trims 3.2 KB down to 2.7 KB for an export.
- `CHANGE_JSON` in the write reply is compact instead of two-space indented. It duplicates `structuredContent.change`, so it only needs to parse.
- Agent-facing board items no longer repeat `createdAt` / `updatedAt`. Change detection already ignored them, so they never affected a delta — they were 28% of the agent item payload for data no reader used. Board-level `updatedAt` still reports when anything moved.
- Graded `get_board` views return the board once instead of twice. The `BOARD_JSON` text copy is byte-identical to `structuredContent`, and every graded view shipped both: `detail` cost 28.6 KB on a 25-object board against 11 KB of payload. Graded views now emit `BOARD_VIEW_<LEVEL>` plus a byte count and leave the data to `structuredContent`. `view: "full"` keeps the complete text copy for hosts that only read text. Measured: `detail` 28.6 → 14.0 KB, `structure` 15.6 → 9.9 KB, `summary` 8.4 → 4.5 KB.
- Five defects found by driving the MCP server as a model would, plus three token-cost fixes on the read path:
  - `draw_board.diagram` no longer crashes when `edges` is omitted. `edges` is optional in the schema, so a standalone card or a plain sequence reached the generator as `undefined` and surfaced as `Cannot read properties of undefined (reading 'length')` — a message that named no field. `expandRecipe` now normalises it to `[]`.
  - A timeline advanced only with `row` stacks on one axis. When no node declared a `column`, each row-only step took its own column, so six steps fanned out diagonally across 2030 units instead of forming a readable vertical column — the opposite of what `AGENTS.md` tells an agent to draw.
  - The `draw_board.diagram` description no longer contradicts its own schema. It claimed `row` was not accepted and told the caller to advance a timeline with `column`; `row` has been in the schema all along, and `column` is what produced the wide horizontal band.
  - A per-item `author` is rejected with `AUTHOR_ON_ITEM` instead of being silently overwritten. The write path stamps every item with the top-level author, so a model marking a person's words as `human` stored them as `ai` and nothing said so — the one field that makes the board two-way was quietly wrong.
  - An explicit `w`/`h` below the minimum size is rejected with `SIZE_OUT_OF_RANGE` instead of being raised by `Math.max`. `w: 12` was stored as 16 and reported as success, which is the same silent disagreement the coordinate ceiling already refused. Geometry bounds moved to `model/size.ts`, shared by `normalizeItem` and `parseBoard`.
- `get_board` no longer resends the drawing guide on every empty read. `firstUse || !state.guideSent` kept it permanently true on an empty board, so four consecutive reads each cost the same 10,989 bytes; an empty board is the state an agent rereads most. Repeated empty reads now cost 4,786 bytes.
- `get_board` text blocks use compact JSON and the delta path dropped its two-space indentation, so the same board is not paid for twice at indent cost.
- `view: "summary"` now trims the text block too. It previously dropped `items` from structured content while the text half still carried the guide and recipes, so the cheap view cost nearly as much as a full read.
- Native Excalidraw islands follow Excalidraw's own surface tokens rather than the page theme. Doodle keeps Excalidraw on its light theme so board colours stay literal, so a dark page-tinted glass made the dark toolbar icons disappear.
- Dark mode rendered board content almost invisibly. Three separate causes: ink was a hardcoded dark grey on a dark page, a frame's white fill became a glaring block, and Excalidraw's own dark theme inverted the colours a person had chosen. Ink and paper fills are now chosen per theme, text ink is chosen against the surface it actually sits on (dark ink inside a light card), and Excalidraw stays on its light theme so stored colours render literally while Doodle paints the dark page.
- Equal-z backdrops (frames, columns) could be drawn above their contents after a redraw; ordering now keeps them behind.

### Added

- The appearances were reorganised around paper: **浅色 (light)** is the light paper desk, **深色 (dark)** is the same paper at night (charcoal stock, pale ink), and **液态玻璃 (glass)** is the original warm-white lens with pine green. The switcher shows all three. Paper is opaque card stock rather than glass, because a lens you can read through is the opposite of paper.
- Paper is generated, not shipped. Two `feTurbulence` fields — one for fibre, one for tooth — are desaturated to alpha and multiplied into the sheet, so the stock has texture at 6× and still reads as a flat sheet at 1×. Adding a fourth appearance is one entry in the `THEMES` table plus a token block.
- The paper appearances are the cheapest, not the most expensive: they set lens scale, blur, and frost to zero, and the glass engine skips building a filter entirely, so they run with no refraction passes at all.
- Delta reads now explain *what the human change means*, not just which fields moved. `HANDOFF_READINGS` names the intent — a rename is read as a correction of meaning, a move as a layout preference, a resize as emphasis, a new note as something to respond to — with one bounded suggestion each. `NEXT` leads with the most meaningful change.
- Each board remembers its own camera (scroll and zoom) in browser storage, so reopening lands where you left off instead of at the origin. An empty board never restores a camera, and a remembered view panned away from the content is discarded so a full board cannot look blank.
- Writes that would clear every object from a non-empty board are refused with a 409. A deliberate per-object delete is unaffected, as is the first write to a new board.
- `npm run doodle` is a one-action on-ramp: it starts the local board and opens the default browser, printing the URL and a few gestures for a machine that cannot open one. `--print` forces the terminal-only path.
- An empty board shows a dismissible first-run card explaining note creation, drawing, panning, and zooming. The dismissal is remembered locally and the card never covers a board that already has content.
- Running the MCP server directly now prints the board URL with one short instruction, so `npx -y doodle-mcp` is legible to a person and not only to a host.

## Unreleased — Cheaper agent reads

### Added

- `get_board` accepts `since_revision`. A reread returns only objects added, updated, or removed since that revision, plus a compact summary, instead of the whole board again.
- Delta reads include `HANDOFF`: human-attributed `added` / `edited` / `removed` changes with the final values that differ, bounded to 12 entries. The agent's own writes are excluded so it is never told to review itself.
- `scan_project` also returns `DIAGRAM_DRAFT_JSON`, a ready-to-draw `draw_board.diagram` draft of the top-level structure, so visualizing a scan no longer needs a separate authoring step.
- `draw_board.diagram.mode` adds `timeline`, `compare`, and `matrix` beside the default `flow`. Non-flow modes honour explicit `column` / `row`, so an ordered explanation is never reordered by edge analysis.

### Fixed

- Loading the canvas could erase a board: Excalidraw emits an `onChange` while mounting, before the initial scene is applied, and that empty scene was written back as a human edit. Mutations now wait until the mounted scene actually contains the board's items.
- Board v1 opacity (a 0-1 fraction) was passed to Excalidraw as if it were a 0-100 percentage, so any item with `opacity: 1` rendered at 1% and looked missing. Opacity is now converted in both directions, and a test covers the round trip.
- The MCP integration tests no longer pin ports 3421–3448. Each spawned server asks the OS for a free loopback port, so two worktrees can run `npm test` at the same time without one run binding the other's preview server and silently asserting against the wrong board. `scripts/repo-check.mjs` fails if a pinned port returns.
- The glass no longer paints a rectangle inside the pane. Three separate causes, all fixed: the specular map negated the light vector's `y` term even though `edgeField` already returns outward normals, so the bright band landed on the bottom edge and read as a slab shifted toward the lower left; `feImage` was sized `100%` while `feDisplacementMap` reads offsets in user space, so on a pane whose width is not an integer device pixel (the 90.25px capsule) the two grids drifted apart and smeared the bevel into a hard-edged box; and displacement peaked at twice the bevel width, dragging the band's own surroundings into the pane as a plastic strip.

### Changed

- Controls inside the glass are lit by the material, not painted on top of it. The toolbar had been switching to upstream's opaque `--button-hover-bg` on hover — invisible on an opaque bar, but a solid sticker over a lens. Hover now thickens the glass with a translucent wash and an inner rim that follows the button's own radius; selected tools get a low accent tint plus a lit edge, staying weak enough that the dot grid still shows through.
- The zoom and undo groups have hover and active feedback again. Clearing their fills to `transparent !important` so the glass could show through had also erased the hover state those buttons relied on, so they looked dead. Disabled undo/redo now fades the glyph instead of the whole box, which had left an empty-looking capsule.
- Pane fill comes from one token family (`--glass-surface-float` / `-panel` / `-solid`) instead of three drifting inline `color-mix` percentages, which had made some panes read as glass and others as white cards.
- The glass carries two sheen layers with different jobs: `::before` is a tight specular highlight, `::after` is the hairline under the top rim plus a soft shade along the bottom. That pair is what makes the surface look like it bulges toward the viewer rather than lying flat.
- The material no longer leaks into descendants. `--glass-refraction` is a custom property, so every icon, 13px radio input, and 1×1 visually-hidden anchor inside a pane inherited the filter and sampled the backdrop through a bevel sized for the parent's box. The mobile library trigger — a 40px row whose 12px radius spent 60% of its height on the band — painted the "tray inside the strip" that survived the earlier light-direction fix. Rows in the mobile strip now inherit the strip's material instead of becoming panes themselves.
- The mobile bottom bar is anchored to its content instead of the viewport. Upstream stretches it with `inset: 0`; opening the property sheet resized that flex container and re-laid-out the palette, which is the jitter on every open and close. The bar also drops upstream's `margin: 0 14px 14px`, which stacked with our 12px padding into a 26px inset and made the palette float lower than every other surface.
- `--glass-surface-*` is declared next to `--island-bg-color` rather than on `:root`. Declared at the root, the `color-mix()` referenced a variable that only existed on `.excalidraw`, so the whole family resolved to nothing and panes using it painted no fill at all.
- The glass is frosted in the centre and sharp at the rim. A single gaussian cannot serve both: enough blur to read as frosted glass erased the 1px dot grid, while keeping the grid left the middle looking like clear acetate. A second, wider blur now runs on a fresh copy of the backdrop and is masked to the flat middle, so the bevel keeps its refraction while the centre gets a diffuse haze. The frost blend is deliberately partial so the dot grid survives through it.
- An unfilled shape no longer turns into a solid block. `elementColor` fell back to `strokeColor` whenever `backgroundColor` was `transparent`, so an outline-only rectangle stored its ink colour as its fill; the next render then painted a black box. Fill and stroke are separate fields — `transparent` is now preserved as a real fill value, in both the adapter and `addBoardItems`.
- The glass no longer rasterises pixels it cannot use. The bevel band is a few pixels along each edge, but `paintEdgeMap` looped every pixel of the flat middle and threw the results away — about 320k `edgeField` calls across six panes at DPR 2. The scan is now limited to the four edge bands (verified pixel-identical against the exhaustive version on six geometries), which took a forced rebuild from ~32ms to a few milliseconds.
- The pane observer no longer watches `class`. Excalidraw rewrites classes on every hover and selection change, so the document scan woke dozens of times a second for no benefit; only `hidden` and subtree insertion matter.
- Canvas fidelity metadata (`scene`) no longer appears in agent-facing payloads. It stays persisted, and `canvasFidelityItems` reports how many items carry it. The canvas is a separate consumer: it asks for fidelity with `include_canvas_fidelity: true`, and `draw_board` still returns the authoritative snapshot the canvas rebuilds from.
- Delta reads end with a state-derived `NEXT` line: no-change reads discourage a redraw, and human-edit reads name what changed and ask for a response first.
- The capabilities, recipes, and drawing guide are sent once per server process; later reads carry a one-line pointer, and `include_guide: true` asks for them again.
- On a real 4-object board the agent projection is 56% smaller than the persisted board, and an unchanged reread is about 90% smaller than a full read.

## 0.8.0 — Excalidraw canvas and richer board

### Added

- Excalidraw is now the only human-facing canvas engine on this line. `@excalidraw/excalidraw` is bundled and self-hosted, a Board v1 ↔ Excalidraw adapter keeps version 1 as the single persisted state, and the legacy DOM canvas template and bundle are removed from source, build, plugin package, and guards. See `docs/GOAL_EXCALIDRAW.md`.
- Added `docs/GOAL_BASIC.md` as the maintained acceptance record for the core two-way loop and `docs/EXCALIDRAW_COMPARISON.md` for the measured canvas comparison.
- Added a `图库` drawer library UI on the Excalidraw branch: save, switch, create, rename, duplicate, delete, import, and export editable version 1 snapshots, sharing one action vocabulary with `draw_board.library`.
- Added human-canvas static sharing snapshots for PNG, JPG, and SVG. These are download-only views; editable library save/import/export remains version 1 JSON.
- Added layout regression coverage for the human canvas: the `图库` drawer must overlay rather than resize Excalidraw, keep one independently scrollable board list with fixed action rows, and hide its launcher while open; hover/active rules may change only color, border, and shadow.
- The human canvas now uses a Doodle-owned main menu: local search, local help, and one GitHub link to the current Doodle repository. Upstream social links, help-header external links, the materials-library browse destination, arbitrary web embedding, and Excalidraw AI/Mermaid generation entries are removed.
- Unified Doodle and Excalidraw under one palette: warm paper with pine green in light mode and green-tinted charcoal with pale mint in dark mode. Native Excalidraw primary, surface, island, input, border, button, and shadow variables now follow those tokens instead of the upstream violet defaults.
- Extended version 1 board objects with freehand `stroke`, bounded local `image`, `title`, `shape`, `groupId`, and `emphasis: focus`; older boards remain valid without migration.
- `draw_board` now supports precise `updates`, batch `items`, `remove_ids`, and deterministic `layout` while keeping exactly four MCP tools.
- Human canvas adds marquee multi-select, batch move/delete/group/layout, undo/redo, double-click-to-create notes, arrow-key nudging, alignment snapping, and bounded `Ctrl/⌘+V` image paste.
- The pen now lays down ink immediately on pointer-down, tracks the full path while dragging, stays active for continuous strokes, and commits one stroke object on pointer-up. The eraser removes only touched freehand ink segments in one undoable batch and never deletes notes, shapes, arrows, or images.
- Added a local editable board library: save the current image under a name, switch between saved boards, create/rename/duplicate/delete boards, and import/export version 1 JSON. `draw_board.library`, HTTP `/api/board/library`, the standalone `图库` panel, and the MCP App share the same action vocabulary without adding a fifth tool.
- Added AI-facing visual expression: `capabilities`, deterministic `visualDigest`, recipes, variant/role/z/style fields, connector bindings, and deterministic layout modes. Connected arrows follow bound object edges; the canvas renders variants, styles, z-order, and multi-selection bounds.
- Added `draw_board.diagram` and `/api/board/diagram` for semantic architecture diagrams. One bounded nodes/edges request adds a deterministic version 1 drawing beside existing objects by default; `replace: true` performs an intentional full redraw. Mixed mutations, duplicate node IDs, generated-ID collisions, unknown edge endpoints, and invalid Board v1 candidates are rejected. `layout.mode: "architecture"` reflows existing connected objects without erasing labels. Excalidraw renders only the Board v1 projection, with the embedded `通知 Agent` shortcut restored.
- Added `docs/GOAL_EXPERIENCE.md` as the maintained objective for native visual expression and updated the documentation map and link checks.
- Stabilized the Excalidraw canvas: fixed bound-text duplication/overlay, preserved image files and element scene metadata, paused persistence during text editing, added standalone live refresh plus the board-library overlay, and removed duplicate production assets from generated bundles.
- New local HTTP batch/replacement endpoints support these canvas operations with human confirmation and revision checks.

### Changed

- The `图库` drawer no longer adds padding to the Excalidraw host, so its three-column top toolbar stays inside the viewport and controls no longer overlap. Its board list is the only scroll region; action and share rows remain pinned and fully visible at desktop and narrow widths.
- Doodle's top bar now yields to Excalidraw's own dropdown menus and modals instead of stacking above them, so native menu items such as “Find on canvas” remain fully visible and clickable.
- Replaced geometry-changing hover/active transforms with color, border, background, and shadow feedback, and added an offline guard that rejects transform, spacing, size, and font geometry in hover/active blocks.
- Canvas links are restricted to the Doodle repository. Object links and anchor clicks to any other destination are prevented; the local help, search, library, and board actions remain available.
- MCP guidance, READMEs, agent handbook, architecture, decisions, product direction, experience audit, and guards now describe the richer two-way canvas.
- Text projection for AI and model context includes titles and marks freehand/image/focus semantics without turning them into a message feed or project-write authority.
- The Doodle and Excalidraw chrome now share one palette and one set of surface tokens; the canvas no longer ships two competing accents.

### Compatibility

- The four MCP tools, their schemas and annotations, version 1 persisted board state, `BOARD_JSON`, `PANEL_URL`, HTTP authorization, and revision-safe writes are unchanged from `0.7.0`.
- Existing `0.7.0` board files and library snapshots load without migration; boards written on this version keep optional `scene` fidelity metadata that older readers ignore.

## 0.7.0 — Current-session board context sync

### Added

- The embedded MCP App now detects `updateModelContext` after connecting to a compatible host. Each newly observed board revision publishes the complete current final board snapshot plus `added` / `updated` / `removed` differences from the last successfully published snapshot. The delta contains final object values or removed IDs, never click, drag, text-input, or tool-call operations.
- `structuredContent` preserves the untruncated current board, final-state delta, and fixed read-only flags; the text projection is bounded for model context size and points the agent back to `get_board` as the authoritative reread tool.
- A `通知 Agent` button appears only in embedded hosts that support both model context updates and `sendMessage`. It ensures the latest context has been published, then sends one short message into the existing host conversation: 「我改了 Doodle 画板，你看下图。」 It does not add a Doodle chat, session, message feed, or automatic model turn.
- Added `src/board/app-context.ts` and `test/app-context.test.mjs` for pure final-state deltas, complete structured snapshots, updates, removals, and bounded text projections.

### Changed

- Documented the current-session loop in Chinese and English READMEs, the agent handbook, product direction, architecture, decisions, plugin goal, MCP instructions, skill, privacy, FAQ, troubleshooting, examples, launch copy, roadmap, and release notes.
- Repository and plugin guards now verify capability detection, `updateModelContext` / `sendMessage`, final-state delta language, the notification button, and the bundled MCP App bridge. MCP integration and HTTP tests check the embedded template surface.
- Bumped the package, lockfile, and plugin manifest to `0.7.0`; the published `0.6.3` npm package and GitHub Release remain immutable.

### Compatibility

- The four MCP tools, their schemas and annotations, version 1 persisted board state, `BOARD_JSON`, `PANEL_URL`, HTTP authorization, and revision-safe writes are unchanged.
- Hosts without MCP Apps context capabilities and the standalone `PANEL_URL` page continue to use `get_board` rereading; the notification button remains hidden there and never claims a host-session bridge.

### Validation

- `npm run check` covers the new pure-function tests, TypeScript, build, plugin build, example syntax, repository and plugin guards, setup dry-run, submission ZIP, doctor, and npm package dry-run. Live host-context delivery remains an MCP Apps host capability and is documented as an external surface.
- Remote CI and Publish Release pass; GitHub Release `v0.7.0` contains `doodle-0.7.0.zip`. npm direct-MCP publication remains a separate maintainer-authenticated action; see `docs/EXPERIENCE_AUDIT.md` E15.

## 0.6.3 — Complete install-to-use experience

### Added

- Added `npm run setup:codex`: one command installs dependencies when needed, builds the self-contained plugin, registers the repository marketplace, installs `doodle@doodle`, and prints one first-use prompt. `--dry-run` previews every command without changing Codex configuration.
- Added a short `FIRST_USE` / `NEXT_STEPS` preamble to `get_board`, a next-step line to `draw_board`, and matching initialization/skill guidance. The structured version 1 board snapshot is unchanged.
- Added a dismissible `?` help button and `?` keyboard shortcut to the shared standalone and embedded canvas, with three concise human gestures. Help state is browser localStorage only.

### Changed

- Replaced the multi-command Codex plugin quickstart with a 30-second path: install once, start a new session, use one first prompt, see or edit the canvas, then ask the AI to read it again. README and English README now lead with this complete chain.
- Replaced placeholder direct MCP examples with zero-configuration `npx -y doodle-mcp` snippets. `DOODLE_WORKSPACE_ROOT`, `OUTPUT_DIR`, `PREVIEW_HOST`, `PREVIEW_PORT`, and `LOG_LEVEL` are now clearly optional overrides.
- Updated `doctor` to present user-facing first-use steps and avoid treating the submission ZIP as a routine installation warning.
- Fixed the bundled plugin's standalone canvas template lookup so `PANEL_URL` returns a usable page even when the MCP host starts `server/index.mjs` from a project root.
- Added [`docs/EXPERIENCE_AUDIT.md`](docs/EXPERIENCE_AUDIT.md) with live AI/human findings, priorities, and closure criteria. Fixed the first batch: new boards start empty, `get_board` becomes concise after content exists, human edits and AI updates now record the current author, and the standalone canvas refreshes on WebSocket open with a single reconnect loop and remote-update status.
- Simplified human creation: blank default text, no editor for arrows, one automatic retry for revision conflicts, and a small free-placement search that avoids dropping a new shape on top of existing objects.
- Made help focus reversible and limited `Escape` to closing help when help is open; double-click editing now re-renders and focuses the selected object before editing.
- Added an explicit `编辑` button and `Enter` shortcut for selected objects, so text editing stays reliable in hosts that coalesce double-click events. Creating an object now returns to the select tool and clicking an existing object never starts a new drawing.
- Distinguished local saves from remote AI updates in the standalone status using broadcast revisions, and aligned the MCP Apps write bridge with the shared board snapshot shape.
- Closed every locally actionable item in [`docs/EXPERIENCE_AUDIT.md`](docs/EXPERIENCE_AUDIT.md); MCP Apps host support remains an external limitation with the documented `PANEL_URL` fallback.
- Documented the direct `npx -y doodle-mcp` path next to the Codex plugin path so the 30-second start no longer requires a repository clone for every MCP host.
- Synchronized the product handbook, product direction, architecture, decisions, plugin goal, roadmap, launch copy, examples, guards, tests, and CI with the new install/first-use experience.
- Closed `E12` in [`docs/EXPERIENCE_AUDIT.md`](docs/EXPERIENCE_AUDIT.md): after maintainer security-key confirmation, npm `latest` now serves `doodle-mcp@0.6.3`, the staged queue is empty, and a clean `npm exec --yes doodle-mcp` startup exposed the four MCP tools with `FIRST_USE`, `BOARD_JSON`, and a loopback `PANEL_URL`.

### Compatibility

- The four MCP tools, their schemas and annotations, version 1 persisted board state, HTTP authorization, and revision-safe writes are unchanged.
- The setup script is user-invoked only; `npm run check` and CI never modify the active user's Codex configuration.

### Validation

- `npm test` passes with 31 tests; `npm run check` covers the repository and plugin guards, setup dry-run, submission ZIP, doctor, and npm package dry-run.
- An isolated `CODEX_HOME` marketplace/installation smoke test discovers and enables `doodle@doodle` version `0.6.3`.
- A fresh AI/human/AI loop reached revision 7 with browser auto-refresh, human author changes, concise `get_board`, and distinct local/remote status; see `docs/EXPERIENCE_AUDIT.md`.
- The WebSocket regression test uses the project's `ws` client so the Node 20 CI matrix does not depend on a global `WebSocket`, and the release workflow creates its version tag before publishing a verified release.

## 0.6.2 — Automatic canvas presentation

### Changed

- Successful `draw_board` results now advertise the shared MCP App canvas so compatible hosts automatically show or refresh the canvas after an AI drawing.
- Updated agent instructions and the Doodle plugin skill to keep the canvas visible after drawing, with `show_board` as the fallback for hosts that do not render the draw result.
- Made submission ZIP generation work on Windows by using the built-in `tar.exe` archive command when Unix `zip` is unavailable.

### Validation

- `npm run check` passes with 27 tests, repository and plugin guards, the Windows submission ZIP, doctor, and npm package dry-run.

## 0.6.0 — Codex plugin distribution

### Added

- Added a desktop-only Codex plugin package under `plugins/doodle/` using the supported `.codex-plugin/plugin.json` compatibility manifest, one `.mcp.json`, a concise Doodle skill, and local SVG assets.
- Added a repository-scoped marketplace at `.agents/plugins/marketplace.json` and a reproducible `scripts/build-plugin.mjs` that creates a self-contained `.doodle-plugin/doodle/server/index.mjs` with both canvas templates and the optional MCP App bundle.
- Added `scripts/plugin-check.mjs` and `npm run repo:plugin-check` to CI and `npm run check`, covering plugin identity, manifests, marketplace, skill, build output, dynamic preview runtime, and generated-artifact hygiene.
- Added plugin-safe runtime configuration: MCP stdio connects before the optional HTTP preview, preview failure leaves tools usable, `PREVIEW_PORT` is optional, `get_board` reports the active loopback `PANEL_URL`, and board state prefers explicit `OUTPUT_DIR`, plugin data, or workspace-local `.doodle-data`.
- Added publication materials for an approved local-MCP directory submission: `PRIVACY.md`, `SUPPORT.md`, `TERMS.md`, `docs/FAQ.md`, `docs/SUBMISSION.md`, a versioned submission ZIP build, and HTTPS listing URLs that identify the publisher.
- Added explicit `readOnlyHint`, `destructiveHint`, and `openWorldHint` annotations to every MCP tool, with integration and offline regression checks.
- Added an idempotent publish workflow that runs the full check on `master`, creates a GitHub Release for the current package version when missing, and attaches the versioned submission ZIP.

### Changed

- Reframed the product around one local-first shared infinite board: the plugin is the preferred Codex distribution layer, direct MCP stdio remains supported, and MCP Apps rendering is an optional host enhancement rather than the product definition.
- Kept the four tools `get_board`, `show_board`, `draw_board`, and `scan_project`, the version 1 board state, revision-safe writes, HTTP authorization, and the standalone canvas fallback.
- Bumped the package, plugin manifest, lockfile, security support, changelog, roadmap, docs map, launch copy, and offline guards together.
- Made the plugin display name `Doodle Shared Board` and tied the publisher metadata to the product repository, reducing generic-name review risk while preserving the `Doodle` product and package identity.

### Compatibility

- Existing version 1 board files remain readable. `AI_DRAW_WORKSPACE_ROOT` remains a legacy alias; `DOODLE_WORKSPACE_ROOT`, `OUTPUT_DIR`, `PREVIEW_HOST`, and `PREVIEW_PORT` remain explicit overrides.
- The generated `.doodle-plugin/` runtime, `doodle-plugin-submission/` ZIP output, and `.doodle-data/` board state are ignored and never committed.

### Validation

- `npm run check` passes: TypeScript, build, 27 tests, examples, repository/plugin guards, submission ZIP, doctor, and `npm pack --dry-run`.
- CI passes on Node 20, 22, and 24; the tag release workflow and publish workflow run the same full check.
- Direct and bundled stdio servers expose exactly four annotated tools, `BOARD_JSON`, an active loopback `PANEL_URL`, and the MCP App resource.
- An isolated `CODEX_HOME` marketplace/installation smoke test discovers and enables `doodle@doodle` version `0.6.0`.

### Public plugin directory

## 0.5.0 — Canvas embedded in the agent

### Added

- Added an optional MCP Apps canvas resource linked from `get_board` and `draw_board`. Its UI reads and edits the board through the host's normal MCP bridge.

### Changed

- Removed the duplicate canvas-side conversation pane and message composer. Agent discussion stays in the host conversation; the canvas fills the available surface.
- Split canvas data and UI rendering into `get_board` and `show_board`; the four tools are `get_board`, `show_board`, `draw_board`, and optional `scan_project`.
- Kept version 1 persisted notes readable for compatibility while excluding them from current tool output and canvas UI.
- Kept the standalone local HTTP canvas as a fallback for hosts that do not render MCP Apps.

### Removed

- Removed `reply_on_board` and the human message endpoint from the active workflow.
- Removed the MCP tool/UI pattern that presented Doodle as a separate chat product.

## 0.4.0 — Simple shared board cleanup

### Added

- Renamed the product to **Doodle**. The npm package and CLI are `doodle-mcp`; the GitHub repository is `Doodle`.
- `DOODLE_WORKSPACE_ROOT` is the preferred workspace variable. `AI_DRAW_WORKSPACE_ROOT` remains a legacy alias so existing MCP host configs keep working.
- Improved canvas gestures: click-to-place, drag-to-size shapes and draw directional arrows, Space/middle-button panning, wheel panning, modifier-wheel zoom, and cancellable pointer gestures.
- Cross-process serialized board mutations, revision-checked browser writes, project-scan secret filtering, and persisted-text validation.

### Changed

- Collapsed the product to one simple shared infinite canvas with four AI-first MCP tools: `get_board`, `draw_board`, `reply_on_board`, and an optional read-only `scan_project`.
- Reorganized source into a focused `src/board/` module plus small `src/infra/` primitives.
- Replaced the human surface with one restrained infinite canvas: toolbar, free placement, directed SVG arrows, short notes, and local viewport state.
- Rewrote `AGENTS.md`, architecture, product direction, decisions, troubleshooting, governance, launch copy, contribution docs, and offline repository guards around the simplified product.
- Reduced runtime dependencies to the MCP SDK, Express, WebSocket, and Zod.
- Made a clean-checkout build recreate the template directory after pruning stale compiled files.

### Removed

- The 0.3.x project-workbench frontend, Mermaid/SVG diagram library, image renderer, diagram store, and screenshot generator.
- The old session, graph, annotation, selection, proposal, preflight, approval, diff, capability-catalogue, workflow, decision-trail, and derived-projection contracts.
- Browser/IDE auto-opening tools, the VS Code extension package, metadata-sync automation, and associated large dependency chains.
- Historical ADRs from the active documentation path; they remain as read-only records in `docs/archive/adr-legacy/`.

### Compatibility

- Existing version 1 `output/.ai-draw/board.json` files remain readable; new state is written to `output/.doodle/board.json`.
- Removed 0.3.x tool schemas, REST endpoints, and approval workflows are intentionally not restored. Code changes remain ordinary, separately reviewed coding-agent work.

## 0.3.x and earlier
