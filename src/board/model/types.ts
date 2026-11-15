/**
 * Board v1 data model: the shapes that are persisted and exchanged.
 *
 * Types only. Runtime validation lives in `model/validate.ts`, construction in
 * `model/board.ts`, and diagram geometry in `diagram/layout.ts`.
 */

export type BoardAuthor = "human" | "ai";
export type BoardItemType = "note" | "text" | "rect" | "ellipse" | "line" | "stroke" | "image";
export type BoardLineShape = "straight" | "curve" | "orthogonal";
export type BoardEmphasis = "normal" | "focus";
export type BoardVariant = "plain" | "card" | "frame" | "pill" | "diamond" | "callout" | "heading";
export type BoardRole = "normal" | "label" | "frame" | "column" | "step" | "decision" | "annotation";
export type BoardTextAlign = "left" | "center" | "right";
export type BoardLayoutMode = "grid" | "row" | "column" | "timeline" | "cluster" | "architecture";

export interface BoardSceneMeta {
  element?: Record<string, unknown>;
  boundText?: Record<string, unknown>;
  fileId?: string;
  fileMime?: string;
  fileCreated?: number;
}

export interface BoardItemStyle {
  borderColor?: string;
  borderWidth?: number;
  textColor?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  textAlign?: BoardTextAlign;
  strokeWidth?: number;
  opacity?: number;
  radius?: number;
  fillOpacity?: number;
}

export interface BoardPoint {
  x: number;
  y: number;
}

export interface BoardItem {
  id: string;
  type: BoardItemType;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  author: BoardAuthor;
  createdAt: string;
  updatedAt: string;
  title?: string;
  shape?: BoardLineShape;
  points?: BoardPoint[];
  src?: string;
  mime?: string;
  groupId?: string;
  emphasis?: BoardEmphasis;
  variant?: BoardVariant;
  role?: BoardRole;
  z?: number;
  style?: BoardItemStyle;
  startItemId?: string;
  endItemId?: string;
  scene?: BoardSceneMeta;
}

export interface BoardNote {
  id: string;
  author: BoardAuthor;
  body: string;
  itemId?: string;
  createdAt: string;
}

export interface SimpleBoard {
  version: 1;
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  items: BoardItem[];
  notes: BoardNote[];
}

export interface BoardItemInput {
  id?: string;
  type: BoardItemType;
  x: number;
  y: number;
  w?: number;
  h?: number;
  text?: string;
  color?: string;
  author?: BoardAuthor;
  title?: string;
  shape?: BoardLineShape;
  points?: BoardPoint[];
  src?: string;
  mime?: string;
  groupId?: string;
  emphasis?: BoardEmphasis;
  variant?: BoardVariant;
  role?: BoardRole;
  z?: number;
  style?: BoardItemStyle;
  startItemId?: string;
  endItemId?: string;
  scene?: BoardSceneMeta;
}

export interface BoardItemPatch {
  id: string;
  patch: Partial<BoardItemInput>;
}

export interface BoardLayoutInput {
  ids?: string[];
  origin?: BoardPoint;
  columns?: number;
  gap?: number;
  mode?: BoardLayoutMode;
}

export interface DiagramNodeInput {
  id: string;
  label: string;
  detail?: string;
  type?: "rect" | "ellipse";
  color?: string;
  column?: number;
  row?: number;
}

export interface DiagramEdgeInput {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramInput {
  title?: string;
  subtitle?: string;
  replace?: boolean;
  mode?: DiagramMode;
  nodes: DiagramNodeInput[];
  edges: DiagramEdgeInput[];
  origin?: BoardPoint;
  columnGap?: number;
  rowGap?: number;
  nodeWidth?: number;
  nodeHeight?: number;
}

/**
 * Semantic arrangements for `draw_board.diagram`.
 *
 * `flow` is a left-to-right dependency graph. The others exist because real
 * explanations are not all graphs: `timeline` orders stages, `compare` puts two
 * sides next to each other, and `matrix` is a strict grid. Each mode only
 * changes coordinates, so the agent keeps expressing meaning, not geometry.
 */
export type DiagramMode = "flow" | "timeline" | "compare" | "matrix";

/**
 * Semantic arrangements for `draw_board.diagram`.
 *
 * `flow` is a left-to-right dependency graph. The others exist because real
 * explanations are not all graphs: `timeline` orders stages, `compare` puts two
 * sides next to each other, and `matrix` is a strict grid. Each mode only
 * changes coordinates, so the agent keeps expressing meaning, not geometry.
 */

export interface DiagramLayout {
  origin: BoardPoint;
  width: number;
  height: number;
  columnGap: number;
  rowGap: number;
  positions: Map<string, BoardPoint>;
  rows: Map<number, number>;
}
