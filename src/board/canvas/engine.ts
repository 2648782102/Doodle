/**
 * The seam between Board v1 and whichever canvas draws it.
 *
 * Board v1 is the product; Excalidraw is the editor. That has been true since
 * 0.8.0, but the boundary was implicit: the canvas client imports the adapter's
 * functions directly, so a second engine would mean editing the client. This
 * interface names what an engine must provide, and `excalidrawEngine` is the
 * only implementation today.
 *
 * It exists to make a future swap a matter of writing a second implementation,
 * not a rewrite — see issue #43. Do not add a second implementation "for
 * symmetry": 0.8.0 already proved that two engines means two maintenance
 * paths, and `docs/DECISIONS.md` records that as a rejected alternative.
 */

import type { BoardItem, SimpleBoard } from "../model/types.js";
import type { CanvasTheme, ExcalidrawFileData, ExcalidrawLikeElement, ExcalidrawSkeleton } from "./types.js";
import {
  boardItemsFromExcalidrawBoard,
  excalidrawElementsToBoardItems,
} from "./from-excalidraw.js";
import {
  boardItemsToExcalidrawSkeleton,
  boardToExcalidrawFiles,
  boardToExcalidrawInitialData,
} from "./to-excalidraw.js";

/** What the board looks like as a scene the engine can render. */
export interface CanvasScene {
  /** Plain skeletons; the client converts these into engine elements. */
  elements: ExcalidrawSkeleton[];
  initialData: unknown;
  /** Keyed by file id, which is the shape Excalidraw's `addFiles` expects. */
  files: Record<string, ExcalidrawFileData>;
}

/**
 * A canvas implementation.
 *
 * Both directions are required. A projection that can only render is a viewer,
 * not an editor, and the board is two-way: whatever draws it must also be able
 * to hand a person's edit back as Board v1.
 */
export interface CanvasEngine {
  /** Stable id, recorded in `capabilities.canvasEngine`. */
  readonly id: string;
  /** Board v1 → the scene the engine renders. */
  toScene(board: SimpleBoard, theme: CanvasTheme): CanvasScene;
  /** The engine's elements → Board v1 items, keeping ids and authorship. */
  fromElements(
    previous: SimpleBoard,
    elements: ExcalidrawLikeElement[],
    files: Record<string, ExcalidrawFileData>,
  ): { items: BoardItem[] };
  /** Plain skeletons, used by tests and by the SVG preview's geometry. */
  toSkeletons(items: BoardItem[], theme: CanvasTheme): ExcalidrawSkeleton[];
}

/**
 * The one engine Doodle ships.
 *
 * A thin object over the existing adapters: behaviour is unchanged, and the
 * client keeps working through the same functions. The value is the named
 * contract — `CanvasEngine` is what a second implementation would satisfy.
 */
export const excalidrawEngine: CanvasEngine = {
  id: "excalidraw",
  toScene(board, theme) {
    return {
      elements: boardItemsToExcalidrawSkeleton(board.items, theme),
      initialData: boardToExcalidrawInitialData(board, theme),
      files: boardToExcalidrawFiles(board),
    };
  },
  fromElements(previous, elements, files) {
    return boardItemsFromExcalidrawBoard(previous, elements, files);
  },
  toSkeletons(items, theme) {
    return boardItemsToExcalidrawSkeleton(items, theme);
  },
};

/** Returned for an id this build does not implement. */
export function canvasEngineById(id: string): CanvasEngine | undefined {
  return id === excalidrawEngine.id ? excalidrawEngine : undefined;
}
