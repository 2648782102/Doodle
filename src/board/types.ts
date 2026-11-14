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
  nodes: DiagramNodeInput[];
  edges: DiagramEdgeInput[];
  origin?: BoardPoint;
  columnGap?: number;
  rowGap?: number;
  nodeWidth?: number;
  nodeHeight?: number;
}

export interface DiagramLayout {
  origin: BoardPoint;
  width: number;
  height: number;
  columnGap: number;
  rowGap: number;
  positions: Map<string, BoardPoint>;
  rows: Map<number, number>;
}

const ITEM_TYPES: BoardItemType[] = ["note", "text", "rect", "ellipse", "line", "stroke", "image"];
const LINE_SHAPES: BoardLineShape[] = ["straight", "curve", "orthogonal"];
const EMPHASES: BoardEmphasis[] = ["normal", "focus"];
const VARIANTS: BoardVariant[] = ["plain", "card", "frame", "pill", "diamond", "callout", "heading"];
const ROLES: BoardRole[] = ["normal", "label", "frame", "column", "step", "decision", "annotation"];
const TEXT_ALIGNS: BoardTextAlign[] = ["left", "center", "right"];
const LAYOUT_MODES: BoardLayoutMode[] = ["grid", "row", "column", "timeline", "cluster", "architecture"];
const COLORS = ["#f6d365", "#b8e0d2", "#c7d8ff", "#ffd1dc", "#e8e8e8", "#ffffff"];
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/bmp", "image/avif", "image/svg+xml"];
const MAX_ITEMS = 400;
const MAX_NOTES = 200;
const MAX_TEXT = 1200;
const MAX_TITLE = 120;
const MAX_GROUP_ID = 80;
const MAX_IMAGE_SRC = 700_000;
const MAX_SCENE_JSON = 40_000;
const MAX_FILE_ID = 120;
const MAX_STROKE_POINTS = 500;
const MIN_SHAPE_SIZE = 16;
const MIN_STROKE_SPAN = 1;
const MAX_SHAPE_WIDTH = 2000;
const MAX_SHAPE_HEIGHT = 1200;
const MAX_LINE_DELTA_X = 2000;
const MAX_LINE_DELTA_Y = 1200;
const MAX_COORDINATE = 100000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAuthor(value: unknown): value is BoardAuthor {
  return value === "human" || value === "ai";
}

function isLineShape(value: unknown): value is BoardLineShape {
  return LINE_SHAPES.includes(value as BoardLineShape);
}

function isEmphasis(value: unknown): value is BoardEmphasis {
  return EMPHASES.includes(value as BoardEmphasis);
}

function isVariant(value: unknown): value is BoardVariant {
  return VARIANTS.includes(value as BoardVariant);
}

function isRole(value: unknown): value is BoardRole {
  return ROLES.includes(value as BoardRole);
}

function isTextAlign(value: unknown): value is BoardTextAlign {
  return TEXT_ALIGNS.includes(value as BoardTextAlign);
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function normalizeStyle(value: unknown): BoardItemStyle | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("Invalid board item style");
  const candidate = value as Partial<BoardItemStyle>;
  const style: BoardItemStyle = {};
  if (candidate.borderColor !== undefined) {
    if (!isColor(candidate.borderColor)) throw new Error("Invalid board item border color");
    style.borderColor = candidate.borderColor;
  }
  for (const [key, minimum, maximum] of [
    ["borderWidth", 0, 12], ["fontSize", 8, 72], ["strokeWidth", 0.5, 24],
    ["opacity", 0.1, 1], ["radius", 0, 64], ["fillOpacity", 0, 1],
  ] as const) {
    const raw = candidate[key];
    if (raw === undefined) continue;
    if (!isFiniteNumber(raw) || raw < minimum || raw > maximum) throw new Error(`Invalid board item ${key}`);
    style[key] = raw;
  }
  if (candidate.textColor !== undefined) {
    if (!isColor(candidate.textColor)) throw new Error("Invalid board item text color");
    style.textColor = candidate.textColor;
  }
  if (candidate.fontWeight !== undefined) {
    if (candidate.fontWeight !== "normal" && candidate.fontWeight !== "bold") throw new Error("Invalid board item font weight");
    style.fontWeight = candidate.fontWeight;
  }
  if (candidate.textAlign !== undefined) {
    if (!isTextAlign(candidate.textAlign)) throw new Error("Invalid board item text align");
    style.textAlign = candidate.textAlign;
  }
  return Object.keys(style).length ? style : undefined;
}

function isPoint(value: unknown): value is BoardPoint {
  return Boolean(value) && typeof value === "object"
    && isFiniteNumber((value as BoardPoint).x)
    && isFiniteNumber((value as BoardPoint).y);
}

function isImageSource(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= MAX_IMAGE_SRC
    && /^data:image\/(png|jpeg|jpg|gif|webp|bmp|avif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value);
}

function cloneSceneRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid board scene record");
  let cloned: Record<string, unknown>;
  try {
    cloned = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    throw new Error("Board scene record must be JSON serializable");
  }
  if (JSON.stringify(cloned).length > MAX_SCENE_JSON) throw new Error("Board scene record is too large");
  return cloned;
}

function normalizeScene(value: unknown): BoardSceneMeta | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid board scene metadata");
  const candidate = value as Partial<BoardSceneMeta>;
  const scene: BoardSceneMeta = {};
  if (candidate.element !== undefined) scene.element = cloneSceneRecord(candidate.element);
  if (candidate.boundText !== undefined) scene.boundText = cloneSceneRecord(candidate.boundText);
  if (candidate.fileId !== undefined) {
    if (typeof candidate.fileId !== "string" || !candidate.fileId.trim() || candidate.fileId.length > MAX_FILE_ID)
      throw new Error("Invalid board scene file ID");
    scene.fileId = candidate.fileId;
  }
  if (candidate.fileMime !== undefined) {
    if (typeof candidate.fileMime !== "string" || !IMAGE_MIMES.includes(candidate.fileMime))
      throw new Error("Invalid board scene file mime");
    scene.fileMime = candidate.fileMime;
  }
  if (candidate.fileCreated !== undefined) {
    if (!isFiniteNumber(candidate.fileCreated)) throw new Error("Invalid board scene file timestamp");
    scene.fileCreated = candidate.fileCreated;
  }
  return Object.keys(scene).length ? scene : undefined;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function now(): string {
  return new Date().toISOString();
}

export function resolveDiagramLayout(diagram: DiagramInput): DiagramLayout {
  if (diagram.nodes.length > 48 || diagram.edges.length > 96) throw new Error("Diagram is too large");
  const nodeIds = new Set<string>();
  const reserved = new Set(["diagram_title", "diagram_subtitle", "diagram_legend", "diagram_frame"]);
  for (const node of diagram.nodes) {
    const id = node.id?.trim();
    if (!id || nodeIds.has(id) || reserved.has(id) || id.endsWith("_detail") || /^diagram_edge_\d+$/.test(id)) {
      throw new Error("Diagram node IDs must be unique and must not use generated object IDs");
    }
    nodeIds.add(id);
  }
  const generatedIds = new Set<string>();
  generatedIds.add("diagram_frame");
  for (const node of diagram.nodes) {
    for (const suffix of ["", "_detail"]) {
      const id = `${node.id}${suffix}`;
      if (generatedIds.has(id)) throw new Error("Diagram generates duplicate object IDs");
      generatedIds.add(id);
    }
  }
  diagram.edges.forEach((_edge, index) => {
    const id = `diagram_edge_${index + 1}`;
    if (generatedIds.has(id)) throw new Error("Diagram generates duplicate object IDs");
    generatedIds.add(id);
  });
  const origin = diagram.origin ?? { x: 40, y: 120 };
  if (Math.abs(origin.x) > 20_000 || Math.abs(origin.y) > 20_000) throw new Error("Diagram origin is out of range");
  const width = Math.max(160, Math.min(260, diagram.nodeWidth ?? 190));
  const height = Math.max(72, Math.min(130, diagram.nodeHeight ?? 90));
  const columnGap = Math.max(36, Math.min(160, diagram.columnGap ?? 70));
  const rowGap = Math.max(24, Math.min(120, diagram.rowGap ?? 44));
  const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
  const incoming = new Map(diagram.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(diagram.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of diagram.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) throw new Error("Diagram edge references an unknown node");
    outgoing.get(edge.from)!.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const layer = new Map(diagram.nodes.map((node) => [node.id, node.column ?? -1]));
  const indegree = new Map(incoming);
  const queue = diagram.nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  if (!queue.length && diagram.nodes.length) queue.push(diagram.nodes[0].id);
  for (const id of queue) if ((layer.get(id) ?? -1) < 0) layer.set(id, 0);
  const processed = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (processed.has(id)) continue;
    processed.add(id);
    for (const target of outgoing.get(id) ?? []) {
      if (nodes.get(target)?.column === undefined) layer.set(target, Math.max(layer.get(target) ?? 0, (layer.get(id) ?? 0) + 1));
      indegree.set(target, Math.max(0, (indegree.get(target) ?? 1) - 1));
      if ((indegree.get(target) ?? 0) === 0 && !processed.has(target)) queue.push(target);
    }
  }
  let fallbackColumn = Math.max(0, ...layer.values()) + 1;
  for (const node of diagram.nodes) {
    if ((layer.get(node.id) ?? -1) < 0) layer.set(node.id, fallbackColumn++);
  }
  const positions = new Map<string, BoardPoint>();
  const rows = new Map<number, number>();
  for (const node of diagram.nodes) {
    const column = Math.min(12, Math.max(0, layer.get(node.id) ?? 0));
    const row = node.row ?? rows.get(column) ?? 0;
    rows.set(column, Math.max(rows.get(column) ?? 0, row + 1));
    positions.set(node.id, {
      x: Math.round(origin.x + column * (width + columnGap)),
      y: Math.round(origin.y + row * (height + rowGap)),
    });
  }
  return { origin, width, height, columnGap, rowGap, positions, rows };
}

export function touchBoard(board: SimpleBoard): SimpleBoard {
  return { ...board, revision: board.revision + 1, updatedAt: now() };
}

export function createEmptyBoard(): SimpleBoard {
  const timestamp = now();
  return {
    version: 1,
    id: makeId("board"),
    title: "和 AI 一起画",
    revision: 0,
    updatedAt: timestamp,
    items: [],
    notes: [],
  };
}

export function createStarterBoard(): SimpleBoard {
  const timestamp = now();
  const authorStamp = `starter_${timestamp}`;
  const title = "Doodle · 和 AI 一起画";
  const items: BoardItem[] = [
    {
      id: "starter_title", type: "text", x: 40, y: 36, w: 560, h: 44,
      text: "Doodle · 人和 AI 的共享画板", color: "#ffffff", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_hint", type: "text", x: 40, y: 82, w: 680, h: 32,
      text: "画一个对象或写一句短标签，AI 会从同一张画布继续", color: "#ffffff", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_human", type: "note", x: 40, y: 150, w: 210, h: 120,
      text: "人\n在这里随手画", color: "#f6d365", author: "human",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_board", type: "rect", x: 330, y: 150, w: 230, h: 120,
      text: "同一张无限画布", color: "#c7d8ff", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_ai", type: "note", x: 640, y: 150, w: 210, h: 120,
      text: "AI\n用 MCP 读 / 画", color: "#b8e0d2", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_arrow_human", type: "line", x: 250, y: 210, w: 70, h: 0,
      text: "画", color: "#64748b", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_arrow_ai", type: "line", x: 560, y: 210, w: 70, h: 0,
      text: "读 / 画", color: "#64748b", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_loop", type: "text", x: 40, y: 320, w: 810, h: 32,
      text: "get_board  →  show_board / draw_board  →  人继续画", color: "#ffffff", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "starter_boundary", type: "text", x: 40, y: 370, w: 810, h: 32,
      text: "项目结构只是可画的主题之一；画板不写项目文件", color: "#ffffff", author: "ai",
      createdAt: timestamp, updatedAt: timestamp,
    },
  ];
  const notes: BoardNote[] = [{
    id: `note_${authorStamp}`,
    author: "ai",
    body: "欢迎来到 Doodle。随手画，AI 会从同一张画布继续。",
    createdAt: timestamp,
  }];
  return { version: 1, id: `board_${authorStamp}`, title, revision: 0, updatedAt: timestamp, items, notes };
}

export function parseBoard(value: unknown): SimpleBoard {
  if (!value || typeof value !== "object") throw new Error("Board must be an object");
  const raw = value as Partial<SimpleBoard>;
  if (raw.version !== 1) throw new Error("Unsupported board version");
  if (typeof raw.id !== "string" || typeof raw.title !== "string") throw new Error("Invalid board identity");
  if (!isFiniteNumber(raw.revision) || raw.revision < 0) throw new Error("Invalid board revision");
  if (!Array.isArray(raw.items) || !Array.isArray(raw.notes)) throw new Error("Invalid board collections");
  if (raw.items.length > MAX_ITEMS || raw.notes.length > MAX_NOTES) throw new Error("Board is too large");
  const itemIds = new Set<string>();
  const items = raw.items.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid board item");
    const candidate = item as Partial<BoardItem>;
    if (typeof candidate.id !== "string" || !ITEM_TYPES.includes(candidate.type as BoardItemType))
      throw new Error("Invalid board item type");
    if (![candidate.x, candidate.y, candidate.w, candidate.h].every(isFiniteNumber))
      throw new Error("Board item coordinates must be finite");
    const x = candidate.x as number;
    const y = candidate.y as number;
    const width = candidate.w as number;
    const height = candidate.h as number;
    if (typeof candidate.text !== "string" || typeof candidate.color !== "string")
      throw new Error("Invalid board item fields");
    if (!isAuthor(candidate.author)) throw new Error("Invalid board item author");
    if (itemIds.has(candidate.id)) throw new Error("Duplicate board item ID");
    itemIds.add(candidate.id);
    if (x < -MAX_COORDINATE || x > MAX_COORDINATE
      || y < -MAX_COORDINATE || y > MAX_COORDINATE)
      throw new Error("Board item coordinates are out of range");
    if (candidate.type !== "line" && candidate.type !== "stroke" && candidate.type !== "image"
      && (width < MIN_SHAPE_SIZE || width > MAX_SHAPE_WIDTH
        || height < MIN_SHAPE_SIZE || height > MAX_SHAPE_HEIGHT)) {
      throw new Error("Board item size is out of range");
    }
    if (candidate.type === "stroke"
      && (width < MIN_STROKE_SPAN || width > MAX_SHAPE_WIDTH
        || height < MIN_STROKE_SPAN || height > MAX_SHAPE_HEIGHT)) {
      throw new Error("Stroke size is out of range");
    }
    if (candidate.type === "image"
      && (width < MIN_SHAPE_SIZE || width > MAX_SHAPE_WIDTH
        || height < MIN_SHAPE_SIZE || height > MAX_SHAPE_HEIGHT)) {
      throw new Error("Image size is out of range");
    }
    if (candidate.type === "line") {
      if (width === 0 && height === 0) throw new Error("Line needs a direction");
      if (width < -MAX_LINE_DELTA_X || width > MAX_LINE_DELTA_X
        || height < -MAX_LINE_DELTA_Y || height > MAX_LINE_DELTA_Y)
        throw new Error("Line endpoint deltas are out of range");
    }
    if (candidate.type === "image" && !isImageSource(candidate.src)) throw new Error("Invalid image source");
    if (candidate.type === "stroke") {
      if (!Array.isArray(candidate.points) || candidate.points.length < 2 || candidate.points.length > MAX_STROKE_POINTS)
        throw new Error("Stroke needs bounded points");
      if (!candidate.points.every((point) => isPoint(point)
        && (point as BoardPoint).x >= 0 && (point as BoardPoint).x <= width
        && (point as BoardPoint).y >= 0 && (point as BoardPoint).y <= height))
        throw new Error("Stroke point is out of range");
    }
    if (candidate.title !== undefined && (typeof candidate.title !== "string" || candidate.title.length > MAX_TITLE))
      throw new Error("Invalid board item title");
    if (candidate.shape !== undefined && !isLineShape(candidate.shape)) throw new Error("Invalid line shape");
    if (candidate.emphasis !== undefined && !isEmphasis(candidate.emphasis)) throw new Error("Invalid item emphasis");
    if (candidate.groupId !== undefined && (typeof candidate.groupId !== "string" || candidate.groupId.length > MAX_GROUP_ID))
      throw new Error("Invalid board item group");
    if (candidate.mime !== undefined && !IMAGE_MIMES.includes(candidate.mime as string))
      throw new Error("Invalid image mime type");
    const style = normalizeStyle(candidate.style);
    const scene = normalizeScene(candidate.scene);
    if (candidate.variant !== undefined && !isVariant(candidate.variant)) throw new Error("Invalid board item variant");
    if (candidate.role !== undefined && !isRole(candidate.role)) throw new Error("Invalid board item role");
    if (candidate.z !== undefined && !isFiniteNumber(candidate.z)) throw new Error("Invalid board item z-order");
    if (candidate.startItemId !== undefined && (typeof candidate.startItemId !== "string" || !itemIds.has(candidate.startItemId)))
      throw new Error("Invalid line start item");
    if (candidate.endItemId !== undefined && (typeof candidate.endItemId !== "string" || !itemIds.has(candidate.endItemId)))
      throw new Error("Invalid line end item");
    if ((candidate.startItemId || candidate.endItemId) && candidate.type !== "line")
      throw new Error("Only line items can bind connectors");
    return {
      id: candidate.id,
      type: candidate.type as BoardItemType,
      x,
      y,
      w: width,
      h: height,
      text: candidate.text,
      color: candidate.color,
      author: candidate.author,
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : now(),
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : now(),
      ...(candidate.title ? { title: candidate.title } : {}),
      ...(candidate.shape ? { shape: candidate.shape } : {}),
      ...(candidate.points ? { points: candidate.points.map((point) => ({ x: point.x, y: point.y })) } : {}),
      ...(candidate.src ? { src: candidate.src } : {}),
      ...(candidate.mime ? { mime: candidate.mime } : {}),
      ...(candidate.groupId ? { groupId: candidate.groupId } : {}),
      ...(candidate.emphasis ? { emphasis: candidate.emphasis } : {}),
      ...(candidate.variant ? { variant: candidate.variant } : {}),
      ...(candidate.role ? { role: candidate.role } : {}),
      ...(isFiniteNumber(candidate.z) ? { z: candidate.z } : {}),
      ...(style ? { style } : {}),
      ...(candidate.startItemId ? { startItemId: candidate.startItemId } : {}),
      ...(candidate.endItemId ? { endItemId: candidate.endItemId } : {}),
      ...(scene ? { scene } : {}),
    };
  });
  const allItemIds = new Set(items.map((item) => item.id));
  for (const item of items) {
    if (item.startItemId && !allItemIds.has(item.startItemId)) throw new Error("Invalid line start item");
    if (item.endItemId && !allItemIds.has(item.endItemId)) throw new Error("Invalid line end item");
  }
  const itemIdSet = new Set(items.map((item) => item.id));
  const noteIds = new Set<string>();
  const notes = raw.notes.map((note) => {
    if (!note || typeof note !== "object") throw new Error("Invalid board note");
    const candidate = note as Partial<BoardNote>;
    if (typeof candidate.id !== "string" || typeof candidate.body !== "string" || !isAuthor(candidate.author))
      throw new Error("Invalid board note fields");
    if (noteIds.has(candidate.id)) throw new Error("Duplicate board note ID");
    noteIds.add(candidate.id);
    if (candidate.itemId !== undefined && !itemIdSet.has(candidate.itemId))
      throw new Error("Board note references an unknown item");
    return {
      id: candidate.id,
      author: candidate.author,
      body: candidate.body,
      itemId: typeof candidate.itemId === "string" ? candidate.itemId : undefined,
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : now(),
    };
  });
  return {
    version: 1,
    id: raw.id,
    title: raw.title,
    revision: raw.revision,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now(),
    items,
    notes,
  };
}

function normalizeItem(input: BoardItemInput): Omit<BoardItem, "createdAt" | "updatedAt"> {
  if (!input || typeof input !== "object") throw new Error("Invalid item input");
  if (!ITEM_TYPES.includes(input.type)) throw new Error("Unknown item type");
  if (![input.x, input.y].every(isFiniteNumber)) throw new Error("Item coordinates must be finite");
  if (input.w !== undefined && !isFiniteNumber(input.w)) throw new Error("Item width must be finite");
  if (input.h !== undefined && !isFiniteNumber(input.h)) throw new Error("Item height must be finite");
  if (input.type === "line") {
    if (input.w === undefined && input.h === undefined) {
      throw new Error("Line requires w or h as its endpoint delta");
    }
    if (input.w !== undefined && !isFiniteNumber(input.w)) throw new Error("Line width must be finite");
    if (input.h !== undefined && !isFiniteNumber(input.h)) throw new Error("Line height must be finite");
  }
  const width = input.type === "line" ? 1
    : input.type === "stroke" ? Math.max(MIN_STROKE_SPAN, Math.min(MAX_SHAPE_WIDTH, input.w ?? 1))
      : Math.max(MIN_SHAPE_SIZE, Math.min(MAX_SHAPE_WIDTH, input.w ?? 180));
  const height = input.type === "line" ? 1
    : input.type === "stroke" ? Math.max(MIN_STROKE_SPAN, Math.min(MAX_SHAPE_HEIGHT, input.h ?? 1))
      : Math.max(MIN_SHAPE_SIZE, Math.min(MAX_SHAPE_HEIGHT, input.h ?? 120));
  const signedWidth = input.w !== undefined
    ? (input.type === "line" ? Math.max(-MAX_LINE_DELTA_X, Math.min(MAX_LINE_DELTA_X, input.w)) : width)
    : (input.type === "line" ? 0 : width);
  const signedHeight = input.h !== undefined
    ? (input.type === "line" ? Math.max(-MAX_LINE_DELTA_Y, Math.min(MAX_LINE_DELTA_Y, input.h)) : height)
    : (input.type === "line" ? 0 : height);
  const text = (input.text ?? "").slice(0, MAX_TEXT);
  if (text.length > MAX_TEXT) throw new Error("Item text is too long");
  const color = input.color && /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : COLORS[0];
  const author = isAuthor(input.author) ? input.author : "human";
  if (input.type === "line" && signedWidth === 0 && signedHeight === 0) throw new Error("Line needs a direction");
  if (input.type === "image" && !isImageSource(input.src)) throw new Error("Image source is required");
  if (input.type === "line" && input.shape !== undefined && !isLineShape(input.shape)) throw new Error("Invalid line shape");
  if (input.emphasis !== undefined && !isEmphasis(input.emphasis)) throw new Error("Invalid item emphasis");
  const style = normalizeStyle(input.style);
  const scene = normalizeScene(input.scene);
  if (input.variant !== undefined && !isVariant(input.variant)) throw new Error("Invalid item variant");
  if (input.role !== undefined && !isRole(input.role)) throw new Error("Invalid item role");
  if (input.z !== undefined && (!isFiniteNumber(input.z) || input.z < -1000 || input.z > 1000))
    throw new Error("Invalid item z-order");
  if ((input.startItemId || input.endItemId) && input.type !== "line") throw new Error("Only line items can bind connectors");
  if (input.type === "stroke") {
    if (!Array.isArray(input.points) || input.points.length < 2 || input.points.length > MAX_STROKE_POINTS)
      throw new Error("Stroke needs bounded points");
  }
  const points = input.type === "stroke"
    ? (input.points ?? []).map((point) => ({
      x: Math.max(0, Math.min(width, point.x)),
      y: Math.max(0, Math.min(height, point.y)),
    }))
    : undefined;
  const title = input.title?.trim().slice(0, MAX_TITLE) || undefined;
  const groupId = input.groupId?.trim().slice(0, MAX_GROUP_ID) || undefined;
  return {
    id: input.id?.trim() || makeId("item"),
    type: input.type,
    x: Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, input.x)),
    y: Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, input.y)),
    w: signedWidth,
    h: signedHeight,
    text,
    color,
    author,
    ...(title ? { title } : {}),
    ...(input.type === "line" ? { shape: isLineShape(input.shape) ? input.shape : "straight" as BoardLineShape } : {}),
    ...(points ? { points } : {}),
    ...(input.src ? { src: input.src } : {}),
    ...(input.mime && IMAGE_MIMES.includes(input.mime) ? { mime: input.mime } : {}),
    ...(groupId ? { groupId } : {}),
    ...(isEmphasis(input.emphasis) ? { emphasis: input.emphasis } : {}),
    ...(isVariant(input.variant) ? { variant: input.variant } : {}),
    ...(isRole(input.role) ? { role: input.role } : {}),
    ...(isFiniteNumber(input.z) ? { z: input.z } : {}),
    ...(style ? { style } : {}),
    ...(input.startItemId ? { startItemId: input.startItemId } : {}),
    ...(input.endItemId ? { endItemId: input.endItemId } : {}),
    ...(scene ? { scene } : {}),
  };
}

export function addBoardItem(board: SimpleBoard, input: BoardItemInput): SimpleBoard {
  const normalized = normalizeItem(input);
  if (board.items.length >= MAX_ITEMS) throw new Error("Board item limit reached");
  const timestamp = now();
  const item: BoardItem = { ...normalized, createdAt: timestamp, updatedAt: timestamp };
  return touchBoard({ ...board, items: [...board.items, item] });
}

export function updateBoardItem(
  board: SimpleBoard,
  id: string,
  patch: Partial<BoardItemInput>,
  author: BoardAuthor = "human",
): SimpleBoard {
  const existing = board.items.find((item) => item.id === id);
  if (!existing) throw new Error("Board item not found");
  const normalized = normalizeItem({ ...existing, ...patch, id, author });
  const timestamp = now();
  return touchBoard({
    ...board,
    items: board.items.map((item) => item.id === id
      ? { ...normalized, createdAt: existing.createdAt, updatedAt: timestamp }
      : item),
  });
}

export function addBoardItems(board: SimpleBoard, inputs: BoardItemInput[]): SimpleBoard {
  if (board.items.length + inputs.length > MAX_ITEMS) throw new Error("Board item limit reached");
  const timestamp = now();
  const items = inputs.map((input) => {
    const normalized = normalizeItem(input);
    return { ...normalized, createdAt: timestamp, updatedAt: timestamp } satisfies BoardItem;
  });
  return touchBoard({ ...board, items: [...board.items, ...items] });
}

export function updateBoardItems(
  board: SimpleBoard,
  updates: BoardItemPatch[],
  author: BoardAuthor = "human",
): SimpleBoard {
  const patches = new Map(updates.map((update) => [update.id, update.patch]));
  const timestamp = now();
  const items = board.items.map((item) => {
    const patch = patches.get(item.id);
    if (!patch) return item;
    const normalized = normalizeItem({ ...item, ...patch, id: item.id, author });
    return { ...normalized, createdAt: item.createdAt, updatedAt: timestamp };
  });
  return touchBoard({ ...board, items });
}

export function removeBoardItems(board: SimpleBoard, ids: string[]): SimpleBoard {
  const removeSet = new Set(ids);
  const found = board.items.some((item) => removeSet.has(item.id));
  if (!found) throw new Error("Board item not found");
  return touchBoard({
    ...board,
    items: board.items.filter((item) => !removeSet.has(item.id)),
    notes: board.notes.map((note) => note.itemId && removeSet.has(note.itemId) ? { ...note, itemId: undefined } : note),
  });
}

export function replaceBoardContent(current: SimpleBoard, incoming: unknown): SimpleBoard {
  const parsed = parseBoard(incoming);
  return touchBoard({ ...parsed, id: current.id, title: current.title, revision: current.revision });
}

export function layoutBoardItems(
  board: SimpleBoard,
  layout: BoardLayoutInput,
  author: BoardAuthor = "human",
): SimpleBoard {
  if (layout.mode === "architecture") return layoutArchitectureBoard(board, layout, author);
  const selected = new Set(layout.ids ?? []);
  const candidates = board.items.filter((item) =>
    item.type !== "line" && (!selected.size || selected.has(item.id)));
  if (candidates.length < 2) return board;
  const sorted = [...candidates].sort((left, right) => left.y - right.y || left.x - right.x);
  const mode = layout.mode && LAYOUT_MODES.includes(layout.mode) ? layout.mode : "grid";
  const columns = Math.max(1, Math.min(12, Math.floor(layout.columns ?? (mode === "timeline" ? sorted.length : 3))));
  const gap = Math.max(8, Math.min(200, layout.gap ?? 24));
  const origin = layout.origin ?? {
    x: Math.min(...sorted.map((item) => item.x)),
    y: Math.min(...sorted.map((item) => item.y)),
  };
  const maxWidth = Math.max(...sorted.map((item) => item.w));
  const maxHeight = Math.max(...sorted.map((item) => item.h));
  const cellX = (column: number) => origin.x + column * (maxWidth + gap);
  const cellY = (row: number) => origin.y + row * (maxHeight + gap);
  const updates = sorted.map((item, index) => ({
    id: item.id,
    patch: {
      x: Math.round(mode === "row" || mode === "timeline" ? cellX(index)
        : mode === "column" || mode === "cluster" ? origin.x : cellX(index % columns)),
      y: Math.round(mode === "row" || mode === "timeline" ? origin.y
        : mode === "column" ? cellY(index)
          : mode === "cluster" ? cellY(Math.floor(index / Math.max(1, Math.ceil(Math.sqrt(sorted.length)))))
            : cellY(Math.floor(index / columns))),
    },
  }));
  return updateBoardItems(board, updates, author);
}

function layoutArchitectureBoard(
  board: SimpleBoard,
  layout: BoardLayoutInput,
  author: BoardAuthor,
): SimpleBoard {
  const selected = new Set(layout.ids ?? []);
  const nodes = board.items.filter((item) =>
    item.type !== "line" && item.type !== "stroke" && item.type !== "image"
    && (!selected.size || selected.has(item.id)));
  const connections = board.items.filter((item) => item.type === "line");
  if (!nodes.length) return board;
  const origin = layout.origin ?? { x: 40, y: 120 };
  const gap = Math.max(24, Math.min(120, layout.gap ?? 48));
  const columns = Math.max(2, Math.min(6, Math.floor(layout.columns ?? 4)));
  const maxWidth = Math.max(...nodes.map((item) => item.w), 160);
  const maxHeight = Math.max(...nodes.map((item) => item.h), 80);
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const indegree = new Map(nodes.map((item) => [item.id, 0]));
  const outgoing = new Map(nodes.map((item) => [item.id, [] as string[]]));
  for (const line of connections) {
    if (line.startItemId && line.endItemId && byId.has(line.startItemId) && byId.has(line.endItemId)) {
      outgoing.get(line.startItemId)!.push(line.endItemId);
      indegree.set(line.endItemId, (indegree.get(line.endItemId) ?? 0) + 1);
    }
  }
  const layer = new Map<string, number>(nodes.map((item) => [item.id, 0]));
  const residual = new Map(indegree);
  const queue = nodes.filter((item) => (residual.get(item.id) ?? 0) === 0).map((item) => item.id);
  if (!queue.length && nodes.length) queue.push(nodes[0].id);
  const processed = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (processed.has(id)) continue;
    processed.add(id);
    for (const target of outgoing.get(id) ?? []) {
      layer.set(target, Math.max(layer.get(target) ?? 0, (layer.get(id) ?? 0) + 1));
      residual.set(target, Math.max(0, (residual.get(target) ?? 1) - 1));
      if ((residual.get(target) ?? 0) === 0) queue.push(target);
    }
  }
  const maxLayer = Math.max(1, ...layer.values());
  const groups = new Map<number, BoardItem[]>();
  for (const node of nodes) {
    const level = Math.min(maxLayer, layer.get(node.id) ?? 0);
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level)!.push(node);
  }
  const positions = new Map<string, BoardPoint>();
  for (const [level, group] of groups) {
    group.sort((left, right) => left.y - right.y || left.x - right.x);
    group.forEach((item, index) => {
      const row = Math.floor(index / Math.min(columns, maxLayer + 1));
      const column = index % Math.min(columns, maxLayer + 1);
      positions.set(item.id, {
        x: origin.x + level * (maxWidth + gap) + column * 24,
        y: origin.y + row * (maxHeight + gap),
      });
    });
  }
  const updates: BoardItemPatch[] = [];
  for (const node of nodes) {
    const position = positions.get(node.id)!;
    updates.push({ id: node.id, patch: { x: Math.round(position.x), y: Math.round(position.y) } });
  }
  for (const line of connections) {
    const source = line.startItemId ? positions.get(line.startItemId) : undefined;
    const target = line.endItemId ? positions.get(line.endItemId) : undefined;
    if (!source || !target) continue;
    updates.push({
      id: line.id,
      patch: {
        x: Math.round(source.x + maxWidth),
        y: Math.round(source.y + maxHeight / 2),
        w: Math.max(-MAX_LINE_DELTA_X, Math.min(MAX_LINE_DELTA_X, Math.round(target.x - source.x - maxWidth))),
        h: Math.max(-MAX_LINE_DELTA_Y, Math.min(MAX_LINE_DELTA_Y, Math.round(target.y - source.y))),
      },
    });
  }
  return updateBoardItems(board, updates, author);
}

export function diagramToBoardItems(diagram: DiagramInput, author: BoardAuthor = "ai"): BoardItem[] {
  const timestamp = now();
  const { origin, width, height, columnGap, rowGap, positions, rows } = resolveDiagramLayout(diagram);
  const maxRows = Math.max(...rows.values());
  const allPositions = [...positions.values()];
  const maxY = Math.max(...allPositions.map((position) => position.y));
  const leftmostX = Math.min(...allPositions.map((position) => position.x));
  const rightmostX = Math.max(...allPositions.map((position) => position.x));
  const bottom = Math.max(maxY + height + (diagram.edges.some((edge) => edge.label) ? rowGap + 28 : 0), origin.y + (maxRows + 1) * (height + rowGap) + 28);
  const bounds = { left: leftmostX, top: origin.y - 94, right: rightmostX + width, bottom };
  const items: BoardItem[] = [];
  const base = (id: string): Pick<BoardItem, "id" | "author" | "createdAt" | "updatedAt"> => ({
    id, author, createdAt: timestamp, updatedAt: timestamp,
  });
  const frameTop = bounds.top - 12;
  const frame = {
    ...base("diagram_frame"), type: "rect" as const, x: bounds.left - 20, y: frameTop,
    w: bounds.right - bounds.left + 40, h: bounds.bottom - frameTop + 24,
    text: "", color: "#ffffff", variant: "frame" as const, role: "frame" as const, z: 0,
  };
  items.push(frame);
  if (diagram.title) items.push({
    ...base("diagram_title"), type: "text", x: origin.x, y: origin.y - 94, w: 760, h: 44,
    text: diagram.title, color: "#ffffff", variant: "heading", role: "label", z: 3,
    style: { fontSize: 28, fontWeight: "bold", textAlign: "left" },
  });
  if (diagram.subtitle) items.push({
    ...base("diagram_subtitle"), type: "text", x: origin.x, y: origin.y - 48, w: 900, h: 28,
    text: diagram.subtitle, color: "#ffffff", z: 3, style: { fontSize: 14, textAlign: "left" },
  });
  for (const node of diagram.nodes) {
    const position = positions.get(node.id)!;
    items.push({
      ...base(node.id), type: node.type ?? "rect", x: position.x, y: position.y, w: width, h: height,
      text: node.label.slice(0, 24), color: node.color ?? "#f6d365", variant: "card", role: "step", z: 2,
      style: { fontSize: 15, textAlign: "center" },
    });
    if (node.detail) items.push({
      ...base(`${node.id}_detail`), type: "text", x: position.x, y: position.y + height + 6, w: width, h: 24,
      text: node.detail.slice(0, 40), color: "#ffffff", z: 3, style: { fontSize: 12, textAlign: "center" },
    });
  }
  let omittedEdgeCount = 0;
  let edgeIndex = 0;
  diagram.edges.forEach((edge) => {
    const from = positions.get(edge.from)!;
    const to = positions.get(edge.to)!;
    const layerDistance = Math.abs(to.x - from.x) / (width + columnGap);
    const deltaRow = Math.round(to.y - from.y);
    const shortEdge = layerDistance <= 1.01 && deltaRow === 0;
    if (!shortEdge) {
      omittedEdgeCount += 1;
      return;
    }
    const startX = from.x + width + 8;
    const startY = from.y + height / 2;
    const endX = to.x - 8;
    const endY = to.y + height / 2;
    const deltaX = Math.max(-MAX_LINE_DELTA_X, Math.min(MAX_LINE_DELTA_X, Math.round(endX - startX)));
    const deltaY = Math.max(-MAX_LINE_DELTA_Y, Math.min(MAX_LINE_DELTA_Y, Math.round(endY - startY)));
    edgeIndex += 1;
    items.push({
      ...base(`diagram_edge_${edgeIndex}`), type: "line",
      x: Math.round(startX), y: Math.round(startY), w: deltaX, h: deltaY,
      text: "", color: "#64748b", shape: "straight",
      startItemId: edge.from, endItemId: edge.to, z: 1,
    });
  });
  const legendLabels = diagram.edges.filter((edge) => edge.label).map((edge) => edge.label).join(" · ");
  if (legendLabels || omittedEdgeCount) {
    const parts = [
      legendLabels ? `连接：${legendLabels}` : "",
      omittedEdgeCount ? `未绘制远连接：${omittedEdgeCount} 条` : "",
    ].filter(Boolean);
    const legendWidth = Math.max(MIN_SHAPE_SIZE, Math.min(MAX_SHAPE_WIDTH, bounds.right - bounds.left));
    items.push({
      ...base("diagram_legend"), type: "text", x: origin.x, y: bottom - 28,
      w: legendWidth, h: 28, text: parts.join(" · ").slice(0, 120), color: "#ffffff", z: 3, style: { fontSize: 12, textAlign: "left" },
    });
  }
  const frameItem = items.find((item) => item.id === "diagram_frame")!;
  frameItem.w = Math.max(MIN_SHAPE_SIZE, Math.min(MAX_SHAPE_WIDTH, frameItem.w));
  frameItem.h = Math.max(MIN_SHAPE_SIZE, Math.min(MAX_SHAPE_HEIGHT, frameItem.h));
  const candidate = { version: 1 as const, id: "diagram_validation", title: diagram.title ?? "diagram", revision: 0, updatedAt: timestamp, items, notes: [] };
  parseBoard(candidate);
  return items;
}

export function removeBoardItem(board: SimpleBoard, id: string): SimpleBoard {
  if (!board.items.some((item) => item.id === id)) throw new Error("Board item not found");
  return touchBoard({
    ...board,
    items: board.items.filter((item) => item.id !== id),
    notes: board.notes.map((note) => note.itemId === id ? { ...note, itemId: undefined } : note),
  });
}

export function addBoardNote(
  board: SimpleBoard,
  input: { body: string; author: BoardAuthor; itemId?: string },
): SimpleBoard {
  const body = input.body.trim().slice(0, MAX_TEXT);
  if (!body) throw new Error("Note body is required");
  if (!isAuthor(input.author)) throw new Error("Invalid note author");
  if (input.itemId && !board.items.some((item) => item.id === input.itemId))
    throw new Error("Referenced board item not found");
  if (board.notes.length >= MAX_NOTES) throw new Error("Board note limit reached");
  const note: BoardNote = {
    id: makeId("note"),
    author: input.author,
    body,
    itemId: input.itemId,
    createdAt: now(),
  };
  return touchBoard({ ...board, notes: [...board.notes, note] });
}

export function boardCopyText(board: SimpleBoard): string {
  const items = board.items.map((item) => {
    const label = item.title ? `${item.title}：${item.text}` : item.text;
    const extra = item.type === "image" ? " · 图片" : item.type === "stroke" ? " · 手绘" : item.shape && item.type === "line" && item.shape !== "straight" ? ` · ${item.shape}` : "";
    return `- ${item.type} · ${label || "(空)"} · ${item.author} · ${Math.round(item.x)},${Math.round(item.y)}${extra}`;
  });
  const notes = board.notes.slice(-12).map((note) => `- ${note.author}: ${note.body}`);
  return [
    `Doodle · ${board.title} · revision ${board.revision}`,
    `画布对象 ${board.items.length}`,
    ...items,
    `最近留言 ${Math.min(board.notes.length, 12)}`,
    ...notes,
  ].join("\n");
}

function shortDigestText(text: string, limit = 60): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

export function boardVisualDigest(board: SimpleBoard): Record<string, unknown> {
  const byId = new Map(board.items.map((item) => [item.id, item]));
  const labels = board.items
    .filter((item) => item.text || item.title)
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .slice(0, 12)
    .map((item) => ({
      id: item.id,
      type: item.type,
      role: item.role ?? "normal",
      title: item.title ? shortDigestText(item.title, 40) : undefined,
      text: item.text ? shortDigestText(item.text, 80) : undefined,
      author: item.author,
    }));
  const groups = [...new Set(board.items.map((item) => item.groupId).filter((id): id is string => Boolean(id)))]
    .map((id) => ({ groupId: id, itemCount: board.items.filter((item) => item.groupId === id).length }));
  const connections = board.items.filter((item) => item.type === "line").slice(0, 40).map((line) => {
    const source = line.startItemId ? byId.get(line.startItemId) : undefined;
    const target = line.endItemId ? byId.get(line.endItemId) : undefined;
    return {
      id: line.id,
      label: shortDigestText(line.text, 40),
      from: source ? shortDigestText(source.title || source.text || source.id, 50) : undefined,
      to: target ? shortDigestText(target.title || target.text || target.id, 50) : undefined,
      coordinates: !source || !target ? {
        from: { x: Math.round(line.x), y: Math.round(line.y) },
        to: { x: Math.round(line.x + line.w), y: Math.round(line.y + line.h) },
      } : undefined,
    };
  });
  const focus = board.items.filter((item) => item.emphasis === "focus").map((item) => ({
    id: item.id,
    label: shortDigestText(item.title || item.text || item.type, 60),
  }));
  return {
    version: 1,
    itemCount: board.items.length,
    readingOrder: labels,
    groups,
    connections,
    focus,
    freehandCount: board.items.filter((item) => item.type === "stroke").length,
    imageCount: board.items.filter((item) => item.type === "image").length,
    note: "Deterministic visual summary derived from final board objects; not an operation log or project-write authority.",
  };
}
