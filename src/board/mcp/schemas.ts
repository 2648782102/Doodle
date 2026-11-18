/**
 * Input schemas for the four MCP tools.
 *
 * Descriptions are written for a model, not a human: each field says when to
 * use it and which sibling field to use instead. Bounds mirror `model/limits`
 * so a schema rejection and a validation error agree.
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
  text: z.string().max(1200).optional().describe("Visible text on the object"),
  color: z.string().max(40).optional().describe("Six-digit hex colour; invalid values return ERROR_JSON with a fix"),
  title: z.string().max(120).optional().describe("Short heading rendered above the object text"),
  shape: z.enum(["straight", "curve", "orthogonal"]).optional().describe("Line routing style"),
  points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).max(500).optional()
    .describe("Local stroke points relative to the item bounds; use for freehand marks"),
  src: z.string().max(700000).optional().describe("data:image/*;base64 source for image items"),
  mime: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]).optional().describe("Image mime type"),
  groupId: z.string().max(80).optional().describe("Optional group marker for moving related objects together"),
  emphasis: z.enum(["normal", "focus"]).optional().describe("Visual emphasis marker"),
  variant: z.enum(["plain", "card", "frame", "pill", "diamond", "callout", "heading"]).optional().describe("Visual variant for shapes and notes"),
  role: z.enum(["normal", "label", "frame", "column", "step", "decision", "annotation"]).optional().describe("Semantic role for visualDigest and recipes"),
  z: z.number().finite().min(-1000).max(1000).optional().describe("Stacking order; higher values render above lower values"),
  style: z.object({
    borderColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    borderWidth: z.number().finite().min(0).max(12).optional(),
    textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    fontSize: z.number().finite().min(8).max(72).optional(),
    fontWeight: z.enum(["normal", "bold"]).optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    strokeWidth: z.number().finite().min(0.5).max(24).optional(),
    opacity: z.number().finite().min(0.1).max(1).optional(),
    radius: z.number().finite().min(0).max(64).optional(),
    fillOpacity: z.number().finite().min(0).max(1).optional(),
  }).optional().describe("Optional bounded visual styling"),
  startItemId: z.string().optional().describe("Source object ID for a connected line"),
  endItemId: z.string().optional().describe("Target object ID for a connected line"),
  scene: z.object({
    element: z.record(z.string(), z.unknown()).optional(),
    boundText: z.record(z.string(), z.unknown()).optional(),
    fileId: z.string().max(120).optional(),
    fileMime: z.string().max(40).optional(),
    fileCreated: z.number().finite().optional(),
  }).optional().describe("Optional Excalidraw scene fidelity metadata; Board v1 remains authoritative"),
});

export const updateInput = z.object({
  id: z.string().describe("Existing item ID to update"),
  patch: itemInput.omit({ id: true }).partial().describe("Fields to change on the existing item"),
});

export const layoutInput = z.object({
  ids: z.array(z.string()).max(400).optional().describe("Objects to arrange; omit to arrange all non-arrow objects"),
  origin: z.object({ x: z.number().finite(), y: z.number().finite() }).optional().describe("Top-left grid origin"),
  columns: z.number().int().min(1).max(12).optional().describe("Grid columns, 1-12; defaults to 3"),
  gap: z.number().int().min(8).max(200).optional().describe("Gap in canvas units, 8-200; defaults to 24"),
  mode: z.enum(["grid", "row", "column", "timeline", "cluster", "architecture"]).optional().describe("Arrangement mode; architecture derives layers from connected line IDs"),
});

export const libraryAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }),
  z.object({ type: z.literal("get"), id: z.string().optional() }),
  z.object({ type: z.literal("create"), name: z.string().max(80).optional(), switchTo: z.boolean().optional() }),
  z.object({ type: z.literal("save"), name: z.string().max(80).optional(), id: z.string().optional(), switchTo: z.boolean().optional(), board: z.unknown().optional() }),
  z.object({ type: z.literal("switch"), id: z.string() }),
  z.object({ type: z.literal("rename"), id: z.string(), name: z.string().max(80) }),
  z.object({ type: z.literal("duplicate"), id: z.string(), name: z.string().max(80).optional(), switchTo: z.boolean().optional() }),
  z.object({ type: z.literal("delete"), id: z.string() }),
  z.object({ type: z.literal("import"), name: z.string().max(80).optional(), board: z.unknown(), switchTo: z.boolean().optional() }),
  z.object({ type: z.literal("export"), id: z.string().optional() }),
]);

export const diagramInput = z.object({
  title: z.string().max(120).optional(),
  replace: z.boolean().optional().describe("Replace all existing board objects; defaults to false and adds the generated diagram beside existing objects"),
  subtitle: z.string().max(200).optional(),
  recipe: z.enum(["flow", "review", "decision", "timeline", "architecture"]).optional()
    .describe("High-level authoring intent. When set, `steps` supplies the content and nodes/edges are generated; use this instead of hand-computing coordinates. flow: ordered steps; review: draft → feedback → revise; decision: options converging on an outcome; timeline: dated milestones; architecture: layers with dependencies."),
  steps: z.array(z.string().min(1).max(120)).max(48).optional()
    .describe("Step captions for `recipe`. Each becomes one node connected to the next in order."),
  options: z.array(z.string().min(1).max(120)).max(8).optional()
    .describe("Candidate choices for `recipe: decision`; they fan into the final step/outcome."),
  mode: z.enum(["flow", "timeline", "compare", "matrix"]).optional()
    .describe("Semantic arrangement, default flow. flow derives columns from edges and snakes after six columns so a 16-step chain is not one 3k-wide strip. timeline/compare/matrix place nodes only where you give `column`/`row` - nodes without them are appended in declaration order below the explicit grid, so set both for a timed sequence."),
  nodes: z.array(z.object({
    id: z.string().max(80),
    label: z.string().max(80).describe("Node caption; this is the field to fill, not `title`"),
    detail: z.string().max(120).optional(),
    type: z.enum(["rect", "ellipse"]).optional(),
    color: z.string().max(40).optional().describe("Six-digit hex colour; invalid values return ERROR_JSON with a fix"),
    role: z.enum(["normal", "label", "frame", "column", "step", "decision", "annotation", "question", "constraint", "evidence"]).optional()
      .describe("Visual semantics: step, decision, question, constraint, evidence, or annotation"),
    emphasis: z.enum(["normal", "focus"]).optional().describe("Use focus for the current discussion focus"),
    column: z.number().int().min(0).max(12).optional()
      .describe("Explicit column, 0-12. In timeline/compare/matrix this is the axis step: 17 steps in one row means column 0-16 is NOT available, so use row for the sequence instead."),
    row: z.number().int().min(0).max(47).optional()
      .describe("Explicit row, 0-47. In timeline the sequence usually advances down the page, so increment `row` per step and keep `column` fixed."),
  })).max(48).optional(),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    label: z.string().max(40).optional(),
  })).max(96).optional(),
  origin: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
  columnGap: z.number().finite().min(20).max(200).optional(),
  rowGap: z.number().finite().min(12).max(160).optional(),
  nodeWidth: z.number().finite().min(120).max(320).optional(),
  nodeHeight: z.number().finite().min(60).max(180).optional(),
});

