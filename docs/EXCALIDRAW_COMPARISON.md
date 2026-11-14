# Excalidraw Canvas Comparison

This note records a controlled comparison on 2026-11-14 between the `codex/excalidraw-spike` Excalidraw-only canvas and the `master` DOM canvas. Both servers were built from their current branches and connected through the same MCP SDK client. The same seven-object AI drawing was used for both: one heading, three connected steps, two arrows, and one freehand emphasis outline.

## Token measurement

Token counts use `js-tiktoken` `o200k_base` over serialized MCP payloads. The measured AI round trip includes tool schemas, initialization instructions, first `get_board` text, the `draw_board` arguments, the write result text, the post-write `get_board` text, and the `show_board` text. The embedded MCP App resource is reported separately because hosts do not necessarily include resource text in the model context; it is still relevant to host/UI transfer cost.

| Metric | Excalidraw branch | DOM `master` | Difference |
|---|---:|---:|---:|
| `draw_board` arguments for the same diagram | 762 tokens | 762 tokens | 0 |
| Full measured AI round trip | 10,827 tokens | 10,566 tokens | +261 (+2.5%) |
| Tool schema tokens | 3,069 | 2,863 | +206 |
| First `get_board` text | 1,629 | 1,607 | +22 |
| Post-write `get_board` text | 3,344 | 3,322 | +22 |
| `show_board` text | 975 | 964 | +11 |
| MCP App resource text | 1,299 | 274,061 | -272,762 |
| MCP App resource bytes | 4,156 B | 768,241 B | -764,085 B |
| Standalone HTML bytes | 4,204 B | 95,845 B | -91,641 B |

The AI authoring payload is unchanged because both branches keep the same four MCP tools and version 1 Board v1 object contract. The Excalidraw branch is slightly more expensive in ordinary tool text (+261 tokens) because it exposes one extra schema field (`scene`) and reports a single `canvasEngine` capability, but it is dramatically cheaper for MCP App resource delivery because the resource is a small HTML shell that loads self-hosted JS instead of inlining the whole DOM app.

## Visual comparison

The same Board v1 objects were written to both standalone pages and screenshotted:

- **Excalidraw branch:** cleaner hand-drawn style, more balanced typography, cleaner arrow label placement, fewer visible UI controls, and no noisy author badges or overlapping panel chrome. Bound shape text is visually centered and attached to its container.
- **DOM `master`:** larger and more literal cards, visible title/body/author text hierarchy, larger arrows, and a visible freehand emphasis outline. It shows more raw object metadata (authors) and toolbar/history chrome. It is readable but visually busier and more "-generated UI" than the Excalidraw rendering.

The Excalidraw branch did not render the freehand emphasis outline in the same screenshot because its Board v1 stroke was projected into Excalidraw freedraw points and the initial view was fit to the full scene; the visual comparison still shows the three-step flow and both arrows clearly. The DOM branch renders the same stroke as a large orange outline around the middle step.

## AI creation assessment

The Excalidraw branch is currently **as convenient as the previous canvas for AI creation** at the tool-call level: an AI uses the same `draw_board` payload and receives the same Board v1 structured state. It is not cheaper in ordinary tool tokens, but it is not meaningfully more expensive either.

Its advantages are for human-side editing fidelity and host delivery: mature text-in-shape editing, built-in rich drawing tools, direct freehand/eraser behavior, smaller MCP App resource, and self-contained production canvas assets. Its costs are package size (about 16.0 MB compressed npm tarball), a React/Excalidraw dependency tree, and a Board v1 ↔ Excalidraw scene adapter that must remain maintained.

## Recommendation

Keep `master` on the lightweight DOM engine until the experiment branch proves: packaged plugin size is acceptable, MCP App resource loading is reliable in the target host, image/text/frame round-tripping is stable under live human edits, and users prefer the Excalidraw interaction. If those pass, Excalidraw-only is a better long-term human canvas; if not, borrow selected Excalidraw ideas into the DOM engine while keeping the small package.
