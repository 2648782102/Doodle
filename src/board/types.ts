/**
 * Board v1 public surface.
 *
 * This file used to be a 1191-line module that mixed types, limits, validation,
 * construction, layout, diagram generation, and summarisation. It is now a thin
 * barrel so existing imports keep working while each concern lives in its own
 * module:
 *
 *   model/types.ts     persisted shapes and inputs (types only)
 *   model/limits.ts    bounded limits and enum members
 *   model/validate.ts  parseBoard, normalizeItem, predicates
 *   model/board.ts     construction and item-level mutation
 *   model/digest.ts    deterministic visual summary for agents
 *   layout/arrange.ts  arranging existing objects on the board
 *   diagram/layout.ts  deterministic diagram placement
 *   diagram/generate.ts materialising a diagram into items
 *
 * New code should import from the specific module; this barrel exists for
 * compatibility and for consumers that genuinely need the whole model.
 */

export type {
  BoardAuthor,
  BoardEmphasis,
  BoardItem,
  BoardItemInput,
  BoardItemPatch,
  BoardItemStyle,
  BoardItemType,
  BoardLayoutInput,
  BoardLayoutMode,
  BoardLineShape,
  BoardNote,
  BoardPoint,
  BoardRole,
  BoardSceneMeta,
  BoardTextAlign,
  BoardVariant,
  DiagramEdgeInput,
  DiagramInput,
  DiagramLayout,
  DiagramMode,
  DiagramNodeInput,
  SimpleBoard,
} from "./model/types.js";

export {
  COLORS,
  DIAGRAM_MODES,
  EMPHASES,
  IMAGE_MIMES,
  ITEM_TYPES,
  LAYOUT_MODES,
  LINE_SHAPES,
  MAX_COORDINATE,
  MAX_FILE_ID,
  MAX_GROUP_ID,
  MAX_IMAGE_SRC,
  MAX_ITEMS,
  MAX_LINE_DELTA_X,
  MAX_LINE_DELTA_Y,
  MAX_NOTES,
  MAX_SCENE_JSON,
  MAX_SHAPE_HEIGHT,
  MAX_SHAPE_WIDTH,
  MAX_STROKE_POINTS,
  MAX_TEXT,
  MAX_TITLE,
  MIN_SHAPE_SIZE,
  MIN_STROKE_SPAN,
  ROLES,
  TEXT_ALIGNS,
  VARIANTS,
} from "./model/limits.js";

export { makeId, now } from "./model/clock.js";

export { normalizeItem, parseBoard } from "./model/validate.js";

export {
  addBoardItem,
  addBoardItems,
  addBoardNote,
  boardCopyText,
  createEmptyBoard,
  createStarterBoard,
  removeBoardItem,
  removeBoardItems,
  replaceBoardContent,
  touchBoard,
  updateBoardItem,
  updateBoardItems,
} from "./model/board.js";

export { boardVisualDigest } from "./model/digest.js";

export { layoutBoardItems } from "./layout/arrange.js";

export { resolveDiagramLayout } from "./diagram/layout.js";

export { diagramToBoardItems } from "./diagram/generate.js";
