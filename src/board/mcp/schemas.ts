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
    .describe("Do NOT set this per item. Put author once at the draw_board top level; setting it here is rejected so two authors never get mixed in one call."),
  type: z.enum(["note", "text", "rect", "ellipse", "line", "stroke", "image"]).describe("Visual object type"),
  x: z.number().finite().describe("Canvas X coordinate"),
  y: z.number().finite().describe("Canvas Y coordinate"),
  w: z.number().finite().optional().describe("Shape width, line endpoint delta X, or stroke/image bounds width"),
  h: z.number().finite().optional().describe("Shape height, line endpoint delta Y, or stroke/image bounds height"),
  text: z.string().optional().describe("Visible text on the object, at most 1200 characters"),
  color: z.string().optional().describe("Six-digit hex colour; invalid values return ERROR_JSON with a fix"),
  title: z.string().optional().describe("Short heading above the object text, at most 120 characters"),
  shape: z.string().optional().describe("Line routing style: straight, curve, or orthogonal"),
  points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).optional()
    .describe("Local stroke points relative to the item bounds; use for freehand marks"),
  src: z.string().optional().describe("data:image/*;base64 source for image items, at most 700000 characters"),
  mime: z.string().optional().describe("Image mime type: image/png, image/jpeg, image/gif, or image/webp"),
  groupId: z.string().optional().describe("Optional group marker for moving related objects together, at most 80 characters"),
  emphasis: z.string().optional().describe("Visual emphasis marker: normal or focus"),
  variant: z.string().optional().describe("Visual variant: plain, card, frame, pill, diamond, callout, or heading"),
  role: z.string().optional().describe("Semantic role: step, decision, question, constraint, evidence, label, frame, column, annotation, or normal"),
  z: z.number().finite().optional().describe("Stacking order between -1000 and 1000; higher renders above lower"),
  style: z.object({
    borderColor: z.string().optional(),
    borderWidth: z.number().finite().optional(),
    textColor: z.string().optional(),
    fontSize: z.number().finite().optional(),
    fontWeight: z.enum(["normal", "bold"]).optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    strokeWidth: z.number().finite().optional(),
    opacity: z.number().finite().optional(),
    radius: z.number().finite().optional(),
    fillOpacity: z.number().finite().optional(),
  }).optional().describe("Optional bounded visual styling"),
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

export const libraryAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }),
  z.object({ type: z.literal("get"), id: z.string().optional() }),
  z.object({
    type: z.literal("create"),
    name: z.string().optional(),
    switchTo: z.boolean().optional()
      .describe("Defaults to true and makes the new board active. Pass false to keep the person on the board they are looking at."),
  }),
  z.object({
    type: z.literal("save"),
    name: z.string().optional(),
    id: z.string().optional(),
    switchTo: z.boolean().optional()
      .describe("Defaults to true and makes the saved board active. Pass false to save without changing what the person sees."),
    board: z.unknown().optional(),
  }),
  z.object({ type: z.literal("switch"), id: z.string() }),
  z.object({ type: z.literal("rename"), id: z.string(), name: z.string() }),
  z.object({
    type: z.literal("duplicate"),
    id: z.string(),
    name: z.string().optional(),
    switchTo: z.boolean().optional()
      .describe("Defaults to true and makes the copy active. Pass false to duplicate in the background."),
  }),
  z.object({ type: z.literal("delete"), id: z.string() }),
  z.object({
    type: z.literal("import"),
    name: z.string().optional(),
    board: z.unknown(),
    switchTo: z.boolean().optional()
      .describe("Defaults to true and makes the imported board active. Pass false to add it to the library only."),
  }),
  z.object({ type: z.literal("export"), id: z.string().optional() }),
]);

export const diagramInput = z.object({
  title: z.string().optional(),
  replace: z.boolean().optional().describe("Replace all existing board objects; defaults to false and adds the generated diagram beside existing objects"),
  subtitle: z.string().optional(),
  recipe: z.enum(["flow", "review", "decision", "timeline", "architecture"]).optional()
    .describe("High-level authoring intent. When set, `steps` supplies the content and nodes/edges are generated; use this instead of hand-computing coordinates. flow: ordered steps; review: draft → feedback → revise; decision: options converging on an outcome; timeline: dated milestones; architecture: layers with dependencies."),
  steps: z.array(z.string()).optional()
    .describe("Step captions for `recipe`. Each becomes one node connected to the next in order."),
  options: z.array(z.string()).optional()
    .describe("Candidate choices for `recipe: decision`; they fan into the final step/outcome."),
  mode: z.string().optional()
    .describe("Semantic arrangement, default flow. flow derives columns from edges and snakes after six columns so a 16-step chain is not one 3k-wide strip. timeline/compare/matrix place nodes only where you give `column`/`row` - nodes without them are appended in declaration order below the explicit grid, so set both for a timed sequence."),
  nodes: z.array(z.object({
    id: z.string(),
    label: z.string().describe("Node caption; this is the field to fill, not `title`. Keep it to about 24 characters - the card renders it at one line, and anything longer is cut, so put the rest in `detail`."),
    detail: z.string().optional().describe("One-line note under the caption, about 40 characters before it is cut."),
    type: z.enum(["rect", "ellipse"]).optional(),
    color: z.string().optional().describe("Six-digit hex colour; invalid values return ERROR_JSON with a fix"),
    role: z.enum(["normal", "label", "frame", "column", "step", "decision", "annotation", "question", "constraint", "evidence"]).optional()
      .describe("Visual semantics: step, decision, question, constraint, evidence, or annotation"),
    emphasis: z.enum(["normal", "focus"]).optional().describe("Use focus for the current discussion focus"),
    column: z.number().int().optional()
      .describe("Explicit column, 0-12. In timeline/compare/matrix this is the axis step: 17 steps in one row means column 0-16 is NOT available, so use row for the sequence instead."),
    row: z.number().int().optional()
      .describe("Explicit row, 0-47. In timeline the sequence usually advances down the page, so increment `row` per step and keep `column` fixed."),
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

