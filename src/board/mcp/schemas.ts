/**
 * Input schemas for the four MCP tools.
 *
 * Descriptions are written for a model, not a human: each field says when to
 * use it and which sibling field to use instead.
 *
 * These schemas describe *shape only* - the field exists and has the right
 * type - and leave every numeric and length bound to `model/`. The MCP SDK
 * validates `inputSchema` before the tool handler runs and turns a failure into
 * a bare `MCP error -32602: Input validation error` with no code, path, or fix.
 * `AGENTS.md` promises every rejected write includes `ERROR_JSON`, and the
 * schema path was the one a fresh model hit first: a 1,300-character text or a
 * 200-item batch produced prose while a bad colour produced a repairable error.
 * `model/` already enforces all of these bounds, and `model/limits.ts` stays the
 * single source, so both layers cannot drift.
 */

import { z } from "zod";

export const itemInput = z.object({
  id: z.string().optional().describe("Existing item ID to update; omit to create a new item"),
  author: z.string().optional()
    .describe("Rejected per item; put author at the draw_board top level"),
  type: z.enum(["note", "text", "rect", "ellipse", "line", "stroke", "image"]).describe("Visual object type"),
  x: z.number().finite().describe("Canvas X coordinate"),
  y: z.number().finite().describe("Canvas Y coordinate"),
  w: z.number().finite().optional().describe("Shape width, line endpoint delta X, or stroke/image bounds width"),
  h: z.number().finite().optional().describe("Shape height, line endpoint delta Y, or stroke/image bounds height"),
  text: z.string().optional().describe("Visible text"),
  color: z.string().optional().describe("Six-digit hex colour; invalid values return ERROR_JSON with a fix"),
  title: z.string().optional().describe("Heading above `text`"),
  shape: z.string().optional().describe("Line routing style: straight, curve, or orthogonal"),
  points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).optional()
    .describe("Freehand points, local to the item bounds"),
  src: z.string().optional().describe("data:image/*;base64 source"),
  mime: z.string().optional().describe("Image mime type"),
  groupId: z.string().optional().describe("Group marker; grouped objects move together"),
  emphasis: z.string().optional().describe("Visual emphasis marker: normal or focus"),
  variant: z.string().optional().describe("Visual variant: plain, card, frame, pill, diamond, callout, or heading"),
  role: z.string().optional().describe("Semantic role: step, decision, question, constraint, evidence, label, frame, column, annotation, or normal"),
  z: z.number().finite().optional().describe("Stacking order; higher renders above"),
  style: z.object({
    borderColor: z.string().optional(),
    borderWidth: z.number().finite().optional(),
    textColor: z.string().optional(),
    fontSize: z.number().finite().optional(),
    fontWeight: z.string().optional(),
    textAlign: z.string().optional(),
    strokeWidth: z.number().finite().optional(),
    opacity: z.number().finite().optional(),
    radius: z.number().finite().optional(),
    fillOpacity: z.number().finite().optional(),
  }).optional().describe("Visual styling"),
  startItemId: z.string().optional().describe("Source object ID for a connected line"),
  endItemId: z.string().optional().describe("Target object ID for a connected line"),
  scene: z.object({
    element: z.record(z.string(), z.unknown()).optional(),
    boundText: z.record(z.string(), z.unknown()).optional(),
    fileId: z.string().optional(),
    fileMime: z.string().optional(),
    fileCreated: z.number().finite().optional(),
  }).optional().describe("Optional Excalidraw scene fidelity metadata; Board v1 remains authoritative"),
});

export const updateInput = z.object({
  id: z.string().describe("Existing item ID to update"),
  patch: itemInput.omit({ id: true }).partial().describe("Fields to change on the existing item"),
});

export const layoutInput = z.object({
  ids: z.array(z.string()).optional().describe("Objects to arrange; omit to arrange all non-arrow objects"),
  origin: z.object({ x: z.number().finite(), y: z.number().finite() }).optional().describe("Top-left grid origin"),
  columns: z.number().int().optional().describe("Grid columns, 1-12; defaults to 3"),
  gap: z.number().int().optional().describe("Gap in canvas units, 8-200; defaults to 24"),
  mode: z.string().optional().describe("Arrangement mode: grid, row, column, timeline, cluster, or architecture. architecture derives layers from connected line IDs"),
});

/*
 * One sentence, referenced four times.
 *
 * The same default was explained separately under `create`, `save`, `duplicate`,
 * and `import` — about 400 characters of near-identical prose on every request.
 * A shared constant keeps the wording in one place and the budget down; the
 * four variants differed only in which board they moved to, which the action
 * name already says.
 */
const SWITCH_TO = "Defaults to true and makes the new board active. Pass false to keep the person on the board they are looking at.";

export const libraryAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }),
  z.object({ type: z.literal("get"), id: z.string().optional() }),
  z.object({
    type: z.literal("create"),
    name: z.string().optional(),
    switchTo: z.boolean().optional().describe(SWITCH_TO),
  }),
  z.object({
    type: z.literal("save"),
    name: z.string().optional(),
    id: z.string().optional(),
    switchTo: z.boolean().optional().describe(SWITCH_TO),
    board: z.unknown().optional(),
  }),
  z.object({ type: z.literal("switch"), id: z.string() }),
  z.object({ type: z.literal("rename"), id: z.string(), name: z.string() }),
  z.object({
    type: z.literal("duplicate"),
    id: z.string(),
    name: z.string().optional(),
    switchTo: z.boolean().optional().describe(SWITCH_TO),
  }),
  z.object({ type: z.literal("delete"), id: z.string() }),
  z.object({
    type: z.literal("import"),
    name: z.string().optional(),
    board: z.unknown(),
    switchTo: z.boolean().optional().describe(SWITCH_TO),
  }),
  z.object({ type: z.literal("export"), id: z.string().optional() }),
]);

/*
 * Schema descriptions are prompt budget, spent on every request.
 *
 * Measured against a live model, the four tool definitions cost 5,103 tokens
 * before the model reads anything, and `draw_board` alone is 4,344 of that —
 * 85%. The cost is not the field names, it is the prose: the same `switchTo`
 * sentence appeared four times, and `diagram` restated guidance that the tool
 * description and the drawing guide already carry.
 *
 * The rule here: keep what a field *means* and what it does *instead* of a
 * sibling field, drop what repeats another field or another document. Anything
 * a model genuinely needs to size a call belongs in `capabilities.limits`,
 * which is sent once per process rather than once per tool definition.
 */
export const diagramInput = z.object({
  title: z.string().optional(),
  replace: z.boolean().optional().describe("Replace existing objects; default false adds beside them"),
  subtitle: z.string().optional(),
  recipe: z.enum(["flow", "review", "decision", "timeline", "architecture"]).optional()
    .describe("Shortcut: generate nodes/edges from `steps` (or `options` for decision) instead of computing coordinates"),
  steps: z.array(z.string()).optional().describe("Captions for `recipe`, chained in order"),
  options: z.array(z.string()).optional().describe("Choices for `recipe: decision`"),
  mode: z.string().optional()
    .describe("Semantic arrangement, default flow. flow derives columns from edges and snakes after six columns so a 16-step chain is not one 3k-wide strip; timeline/compare/matrix place nodes only where you give `column`/`row`"),
  nodes: z.array(z.object({
    id: z.string(),
    label: z.string().describe("Card caption, about 24 chars; use `detail` for the rest"),
    detail: z.string().optional().describe("Note under the caption, about 40 chars"),
    type: z.enum(["rect", "ellipse"]).optional(),
    color: z.string().optional().describe("Six-digit hex"),
    role: z.enum(["normal", "label", "frame", "column", "step", "decision", "annotation", "question", "constraint", "evidence"]).optional(),
    emphasis: z.enum(["normal", "focus"]).optional(),
    column: z.number().int().optional().describe("Explicit column, 0-12"),
    row: z.number().int().optional().describe("Explicit row, 0-47; advance this for a vertical timeline"),
  })).optional(),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    label: z.string().optional(),
  })).optional(),
  origin: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
  columnGap: z.number().finite().optional(),
  rowGap: z.number().finite().optional(),
  nodeWidth: z.number().finite().optional(),
  nodeHeight: z.number().finite().optional(),
});

