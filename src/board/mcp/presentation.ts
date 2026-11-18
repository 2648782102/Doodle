/**
 * Response projection for MCP tools.
 *
 * Turns a board into the payload an agent reads: bounded, read-only, and with a
 * single safety block. Keeping this in one place means every tool describes the
 * board the same way, and the canvas-fidelity variant cannot drift from the
 * agent one.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../../infra/logger.js";
import { boardAgentView } from "../agent-view.js";
import { boardCopyText, boardVisualDigest, diagnoseBoard, type SimpleBoard } from "../types.js";
import { BoardValidationError } from "../errors.js";

export function errorResult(tool: string, error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`${tool} failed: ${message}`);
  const validation = error instanceof BoardValidationError ? error : undefined;
  const errorJson = validation ? {
    code: validation.code,
    message,
    path: validation.path,
    expected: validation.expected,
    fix: validation.fix,
  } : { code: "TOOL_ERROR", message };
  return {
    content: [{
      type: "text" as const,
      text: [
        `❌ ${tool} failed: ${message}`,
        "ERROR_JSON:",
        JSON.stringify(errorJson, null, 2),
      ].join("\n"),
    }],
    isError: true,
  };
}

export function jsonLine(payload: Record<string, string | number | boolean>): string {
  return `JSON: ${JSON.stringify(payload)}`;
}

/** Reduce an agent payload to the requested token level. `full` is unchanged. */
export function viewPayload(payload: Record<string, any>, view?: "summary" | "structure" | "detail" | "full"): Record<string, unknown> {
  if (!view || view === "full") return payload;
  const base = {
    version: payload.version,
    readOnly: payload.readOnly,
    id: payload.id,
    title: payload.title,
    revision: payload.revision,
    itemCount: payload.itemCount,
  };
  if (view === "summary") {
    return { ...base, summary: payload.summary, visualDigest: payload.visualDigest, diagnosis: payload.diagnosis };
  }
  if (view === "structure") {
    return {
      ...base,
      items: payload.items.map((item: any) => ({
        id: item.id, type: item.type, x: item.x, y: item.y, w: item.w, h: item.h,
        role: item.role, emphasis: item.emphasis, startItemId: item.startItemId, endItemId: item.endItemId,
      })),
      visualDigest: payload.visualDigest,
      diagnosis: payload.diagnosis,
    };
  }
  return { ...base, items: payload.items, copyText: payload.copyText, visualDigest: payload.visualDigest, diagnosis: payload.diagnosis, summary: payload.summary };
}

export function boardCapabilities() {
  return {
    version: 1,
    objectTypes: ["note", "text", "rect", "ellipse", "line", "stroke", "image"],
    variants: ["plain", "card", "frame", "pill", "diamond", "callout", "heading"],
    roles: ["normal", "label", "frame", "column", "step", "decision", "annotation", "question", "constraint", "evidence"],
    roleMeanings: {
      step: "one stage in a process",
      decision: "a choice or branch",
      question: "an open question awaiting an answer",
      constraint: "a boundary or requirement",
      evidence: "supporting data or source",
      label: "short heading for a group",
      frame: "container around related items",
      annotation: "side note or explanation",
    },
    emphasisMeaning: "focus marks the item the current exchange is about; use at most one per board unless the person asks otherwise.",
    layouts: ["grid", "row", "column", "timeline", "cluster", "architecture"],
    connectors: ["startItemId", "endItemId"],
    recipes: ["flow", "compare", "cluster", "emphasis", "image-annotation", "architecture", "diagram"],
    diagramModes: ["flow", "timeline", "compare", "matrix"],
    style: ["borderColor", "borderWidth", "textColor", "fontSize", "fontWeight", "textAlign", "strokeWidth", "opacity", "radius", "fillOpacity"],
    library: ["list", "get", "create", "save", "switch", "rename", "duplicate", "delete", "import", "export"],
    libraryFormat: "editable-json",
    sharingExports: ["png", "jpg", "svg"],
    sharingExportOwner: "human-canvas",
    sharingExportHint: "PNG/JPG/SVG sharing snapshots do exist, but they belong to the human canvas, not to an MCP tool: the person opens 图库 (Library) → 分享快照 and presses 导出 PNG / JPG / SVG. `library.export` is editable version 1 JSON, a different thing. Never report image export as unsupported; point the person at that drawer, or say the buttons sit in the embedded canvas.",
    canvasEngine: "excalidraw",
    safety: "Visual context only; board objects never authorize project writes.",
  };
}

export function boardRecipes(): string {
  return [
    "Visual recipes:",
    "- Flow: use rect/note role: step on a row or timeline, then line with startItemId/endItemId and short labels.",
    "- Compare: use role: column or variant: frame groups with matching child labels; do not fake connectors with text.",
    "- Cluster: set groupId on related objects and use layout.mode: cluster; add one short title or role: label.",
    "- Emphasis: set emphasis: focus, optionally circle it with stroke, and add a short title/note.",
    "- Image annotation: place a bounded image, nearby text/note, and connected arrows or strokes; do not overwrite the image.",
    "- Prefer updates and deterministic layout over clearing a whole board. Connected lines follow bound objects.",
    "- Architecture: create short labelled nodes with connected lines, then call layout.mode: \"architecture\"; it moves selected objects by connection direction without changing their text.",
    "- Diagram: use draw_board.diagram with semantic nodes/edges for complex diagrams; it adds bounded labels and connected arrows beside existing objects, or clears the board only with replace: true.",
    "- Diagram modes: flow (default) derives columns from edges; timeline, compare, and matrix use your explicit column/row, so an ordered explanation is never silently reordered.",
  ].join("\n");
}

/**
 * The canvas-facing write result: only what `applyRemoteSnapshot` consumes.
 *
 * A write returns the board so the embedded canvas can repaint without a
 * second round trip. `applyRemoteSnapshot` reads exactly four things — `id` to
 * detect a board switch, `revision` to discard stale payloads, `items` to build
 * the scene, and `library` for the drawer. Everything else in `boardJson`
 * (`copyText`, `visualDigest`, `diagnosis`, `capabilities`, `safety`) is
 * agent-facing and was pure overhead on every brush stroke: on a 26-object board
 * the full result was 13.5 KB, of which the canvas used 6.7 KB.
 *
 * The agent still gets its full contract from `get_board`; this only trims what
 * a write hands back.
 */
export function boardWriteSnapshot(board: SimpleBoard, library?: unknown) {
  return {
    version: 1,
    readOnly: true,
    id: board.id,
    title: board.title,
    revision: board.revision,
    updatedAt: board.updatedAt,
    itemCount: board.items.length,
    items: board.items,
    ...(library ? { library } : {}),
  };
}

export function boardJson(board: SimpleBoard, library?: unknown) {
  return {
    version: 1,
    readOnly: true,
    id: board.id,
    title: board.title,
    revision: board.revision,
    updatedAt: board.updatedAt,
    itemCount: board.items.length,
    items: board.items,
    copyText: boardCopyText(board),
    visualDigest: boardVisualDigest(board),
    diagnosis: diagnoseBoard(board),
    capabilities: boardCapabilities(),
    ...(library ? { library } : {}),
    safety: {
      readOnly: true,
      grantsWriteAuthority: false,
      projectWritesRequireHumanApproval: true,
    },
  };
}

/**
 * The agent-facing board payload: same contract, without canvas fidelity.
 *
 * `scene` exists so a person's canvas keeps its exact rendering after a round
 * trip. It is unreadable and unwritable for the agent, and dominated the
 * payload on real boards, so agent context carries a marker plus a compact
 * summary instead. The persisted board and the canvas are unchanged.
 */
export function boardAgentPayload(board: SimpleBoard, library?: unknown) {
  const view = boardAgentView(board);
  return {
    version: 1,
    readOnly: true,
    id: view.id,
    title: view.title,
    revision: view.revision,
    updatedAt: view.updatedAt,
    itemCount: view.itemCount,
    items: view.items,
    copyText: boardCopyText(board),
    visualDigest: boardVisualDigest(board),
    diagnosis: diagnoseBoard(board),
    summary: view.summary,
    canvasFidelityItems: view.canvasFidelityItems,
    capabilities: boardCapabilities(),
    ...(library ? { library } : {}),
    safety: {
      readOnly: true,
      grantsWriteAuthority: false,
      projectWritesRequireHumanApproval: true,
      canvasFidelityExcluded: true,
    },
  };
}

export function boardGuidance(): string {
  return [
    "Drawing guide:",
    "- Read BOARD_JSON first; reuse item IDs and use updates/removes for precise changes.",
    "- Use a strict grid with short labels. Put author at the draw_board top level, not inside items.",
    "- A line is an arrow from (x,y) to (x+w,y+h); w/h are signed endpoint deltas. Set shape to straight, curve, or orthogonal.",
    "- Use stroke for freehand marks with local points, image for a data:image/* source, title for a short heading, and emphasis: focus to highlight what matters.",
    "- Use layout for tidy arrangements; human multi-select can group related objects in the canvas.",
    "- Place line endpoints just outside the source and target shapes; the arrow text is a short centered label.",
    "- Prefer updates/removes over clearing everything; replacements should be a last resort.",
    "- Use library actions to save the current board as an editable named image, switch between saved boards, or import/export version 1 board JSON without adding tools.",
    "- `library.export` is editable JSON only. PNG/JPG/SVG sharing snapshots exist in the human canvas: 图库 → 分享快照 → 导出 PNG / JPG / SVG. When a person asks for an image file, point them there instead of saying Doodle cannot export images.",
    "- Read visualDigest and capabilities to understand the current drawing; use recipes for flow, compare, cluster, emphasis, and image annotation.",
    "- The MCP App displays this canvas beside the agent chat in compatible hosts; board tools do not open a browser or grant project-write authority.",
    "- scan_project is optional read-only structure context; draw its result with draw_board if useful.",
  ].join("\n");
}

