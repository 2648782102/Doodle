/**
 * Bounded limits and the enum members that guard them.
 *
 * Kept in one file so a limit changes in exactly one place: the validator, the
 * item normaliser, and both layout engines read these values.
 */

import type {
  BoardEmphasis,
  BoardItemType,
  BoardLayoutMode,
  BoardLineShape,
  BoardRole,
  BoardTextAlign,
  BoardVariant,
  DiagramMode,
} from "./types.js";

export const DIAGRAM_MODES: DiagramMode[] = ["flow", "timeline", "compare", "matrix"];

export const ITEM_TYPES: BoardItemType[] = ["note", "text", "rect", "ellipse", "line", "stroke", "image"];
export const LINE_SHAPES: BoardLineShape[] = ["straight", "curve", "orthogonal"];
export const EMPHASES: BoardEmphasis[] = ["normal", "focus"];
export const VARIANTS: BoardVariant[] = ["plain", "card", "frame", "pill", "diamond", "callout", "heading"];
export const ROLES: BoardRole[] = ["normal", "label", "frame", "column", "step", "decision", "annotation", "question", "constraint", "evidence"];
export const TEXT_ALIGNS: BoardTextAlign[] = ["left", "center", "right"];
export const LAYOUT_MODES: BoardLayoutMode[] = ["grid", "row", "column", "timeline", "cluster", "architecture"];
export const COLORS = ["#f6d365", "#b8e0d2", "#c7d8ff", "#ffd1dc", "#e8e8e8", "#ffffff"];
export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/bmp", "image/avif", "image/svg+xml"];
export const MAX_ITEMS = 400;
export const MAX_NOTES = 200;
export const MAX_TEXT = 1200;
export const MAX_TITLE = 120;
export const MAX_GROUP_ID = 80;
export const MAX_IMAGE_SRC = 700_000;
export const MAX_SCENE_JSON = 40_000;
export const MAX_FILE_ID = 120;
export const MAX_STROKE_POINTS = 500;
export const MIN_SHAPE_SIZE = 16;
export const MIN_STROKE_SPAN = 1;
export const MAX_SHAPE_WIDTH = 2000;
export const MAX_SHAPE_HEIGHT = 1200;
export const MAX_LINE_DELTA_X = 2000;
export const MAX_LINE_DELTA_Y = 1200;
export const MAX_COORDINATE = 100000;
