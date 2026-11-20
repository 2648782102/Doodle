/**
 * The canvas-facing board projection.
 *
 * One shape, used by every HTTP response that hands a board to the browser, so
 * the canvas and the AI never disagree about what the board contains.
 */

import { boardVisualDigest, type SimpleBoard } from "../types.js";

export function canvasSnapshotOf(board: SimpleBoard) {
  const { notes: _legacyNotes, ...snapshot } = board;
  return {
    ...snapshot,
    visualDigest: boardVisualDigest(board),
    capabilities: {
      version: 1,
      canvasEngine: "excalidraw",
      layouts: ["grid", "row", "column", "timeline", "cluster", "architecture"],
      connectors: ["startItemId", "endItemId"],
      variants: ["plain", "card", "frame", "pill", "diamond", "callout", "heading"],
      roles: ["normal", "label", "frame", "column", "step", "decision", "annotation"],
      recipes: ["flow", "compare", "cluster", "emphasis", "image-annotation", "architecture", "diagram"],
      sharingExports: ["png", "jpg", "svg"],
      sharingExportOwner: "human-canvas",
    },
  };
}
