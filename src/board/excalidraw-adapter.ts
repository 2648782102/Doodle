/**
 * Canvas adapter public surface.
 *
 * The projection used to be a single 510-line module. It is now split by
 * direction, because the two directions have different failure modes:
 *
 *   canvas/types.ts             structural Excalidraw shapes
 *   canvas/theme.ts             ink and fill chosen per canvas theme
 *   canvas/to-excalidraw.ts     Board v1 → Excalidraw scene
 *   canvas/from-excalidraw.ts   Excalidraw scene → Board v1
 *
 * Import from the specific module in new code; this barrel keeps the existing
 * import path working for the canvas client and the tests.
 */

export { MIN_STORED_SIZE } from "./canvas/types.js";

export type {
  CanvasTheme,
  ExcalidrawFileData,
  ExcalidrawLikeElement,
  ExcalidrawSkeleton,
} from "./canvas/types.js";

export {
  boardItemsToExcalidrawSkeleton,
  boardToExcalidrawFiles,
  boardToExcalidrawInitialData,
} from "./canvas/to-excalidraw.js";

export {
  boardItemsFromExcalidrawBoard,
  excalidrawElementsToBoardItems,
} from "./canvas/from-excalidraw.js";
