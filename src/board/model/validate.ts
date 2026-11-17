/**
 * Runtime validation for Board v1.
 *
 * Every byte written to disk or accepted from an MCP/HTTP caller passes through
 * here. Validation is strict on purpose: an invalid value raises a descriptive
 * error instead of being coerced, so the persisted board always matches what
 * the caller asked for. Connector bindings are checked only after every item is
 * collected, which is what lets a diagram declare a line before its endpoints.
 */

import {
  COLORS, DIAGRAM_MODES, EMPHASES, IMAGE_MIMES, ITEM_TYPES, LAYOUT_MODES,
  LINE_SHAPES, MAX_COORDINATE, MAX_FILE_ID, MAX_GROUP_ID, MAX_IMAGE_SRC,
  MAX_ITEMS, MAX_LINE_DELTA_X, MAX_LINE_DELTA_Y, MAX_NOTES, MAX_SCENE_JSON,
  MAX_SHAPE_HEIGHT, MAX_SHAPE_WIDTH, MAX_STROKE_POINTS, MAX_TEXT, MAX_TITLE,
  MIN_SHAPE_SIZE, MIN_STROKE_SPAN, ROLES, TEXT_ALIGNS, VARIANTS,
} from "./limits.js";
import type {
  BoardAuthor, BoardEmphasis, BoardItem, BoardItemInput, BoardItemStyle,
  BoardItemType, BoardLineShape, BoardNote, BoardPoint, BoardRole,
  BoardSceneMeta, BoardTextAlign, BoardVariant, SimpleBoard,
} from "./types.js";
import { makeId, now } from "./clock.js";
import { BoardValidationError } from "../errors.js";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isAuthor(value: unknown): value is BoardAuthor {
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

/**
 * Fill colour, where `transparent` is a real choice.
 *
 * A shape the person left unfilled must round-trip as unfilled. Treating
 * `transparent` as invalid made the adapter fall back to the stroke colour,
 * which painted an outline-only rectangle as a solid block on the next load.
 */
function isFillColor(value: unknown): value is string {
  return value === "transparent" || isColor(value);
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
    // Only the type is checked here. Existence is verified after every item has
    // been visited, because a connector may legitimately point at a shape that
    // appears later in the array: checking the incrementally built `itemIds`
    // here rejected "line first, then its two endpoints", which is a normal way
    // for a model to emit a diagram and produced `Invalid line start item` for
    // otherwise valid boards.
    if (candidate.startItemId !== undefined && typeof candidate.startItemId !== "string")
      throw new Error("Invalid line start item");
    if (candidate.endItemId !== undefined && typeof candidate.endItemId !== "string")
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


export function normalizeItem(input: BoardItemInput): Omit<BoardItem, "createdAt" | "updatedAt"> {
  if (!input || typeof input !== "object") throw new Error("Invalid item input");
  if (!ITEM_TYPES.includes(input.type)) throw new Error("Unknown item type");
  if (![input.x, input.y].every(isFiniteNumber)) throw new Error("Item coordinates must be finite");
  /*
   * Reject out-of-range input instead of clamping it.
   *
   * Clamping silently moved a shape from x=999999 to x=100000 and shrank a
   * 99999-wide box to 2000, then reported success. A caller that asked for a
   * specific position has no way to notice its drawing landed somewhere else,
   * and the next `get_board` looks like the tool ignored the request. Explicit
   * bounds keep the caller's coordinates and its expectations in sync; only
   * *defaults* (an omitted w/h) are filled in.
   */
  if (input.x < -MAX_COORDINATE || input.x > MAX_COORDINATE
    || input.y < -MAX_COORDINATE || input.y > MAX_COORDINATE) {
    const axis = Math.abs(input.x) > MAX_COORDINATE ? "x" : "y";
    throw new BoardValidationError(
      `Item ${axis} must be within ±${MAX_COORDINATE}`,
      "COORDINATE_OUT_OF_RANGE",
      `items[].${axis}`,
      `a finite number between -${MAX_COORDINATE} and ${MAX_COORDINATE}`,
      `Move the object inside the bounded canvas and retry.`,
    );
  }
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
    : input.type === "stroke" ? Math.max(MIN_STROKE_SPAN, input.w ?? 1)
      : Math.max(MIN_SHAPE_SIZE, input.w ?? 180);
  const height = input.type === "line" ? 1
    : input.type === "stroke" ? Math.max(MIN_STROKE_SPAN, input.h ?? 1)
      : Math.max(MIN_SHAPE_SIZE, input.h ?? 120);
  if (input.type !== "line" && (width > MAX_SHAPE_WIDTH || height > MAX_SHAPE_HEIGHT)) {
    const axis = width > MAX_SHAPE_WIDTH ? "w" : "h";
    const maximum = axis === "w" ? MAX_SHAPE_WIDTH : MAX_SHAPE_HEIGHT;
    throw new BoardValidationError(
      `Item ${axis} must not exceed ${maximum}`,
      "SIZE_OUT_OF_RANGE",
      `items[].${axis}`,
      `a number between ${axis === "w" ? 16 : 16} and ${maximum}`,
      `Split the content into smaller objects instead of oversizing one shape.`,
    );
  }
  const signedWidth = input.w !== undefined
    ? (input.type === "line" ? input.w : width)
    : (input.type === "line" ? 0 : width);
  const signedHeight = input.h !== undefined
    ? (input.type === "line" ? input.h : height)
    : (input.type === "line" ? 0 : height);
  if (input.type === "line"
    && (Math.abs(signedWidth) > MAX_LINE_DELTA_X || Math.abs(signedHeight) > MAX_LINE_DELTA_Y)) {
    const axis = Math.abs(signedWidth) > MAX_LINE_DELTA_X ? "w" : "h";
    const maximum = axis === "w" ? MAX_LINE_DELTA_X : MAX_LINE_DELTA_Y;
    throw new BoardValidationError(
      `Line endpoint delta ${axis} must not exceed ${maximum}`,
      "LINE_DELTA_OUT_OF_RANGE",
      `items[].${axis}`,
      `a signed number between -${maximum} and ${maximum}`,
      `Bind the line to nearby objects or shorten the endpoint delta.`,
    );
  }
  const text = (input.text ?? "").slice(0, MAX_TEXT);
  if ((input.text ?? "").length > MAX_TEXT) throw new BoardValidationError(
    `Item text must not exceed ${MAX_TEXT} characters`,
    "TEXT_TOO_LONG",
    "items[].text",
    `at most ${MAX_TEXT} characters`,
    `Shorten the label; put long explanations in a note or a separate text item.`,
  );
  if (input.color !== undefined && !isFillColor(input.color)) {
    throw new BoardValidationError(
      "Item color must be a six-digit hex value like #f6d365, or transparent for no fill",
      "INVALID_COLOR",
      "items[].color",
      "#rrggbb or transparent",
      `Use one of the palette colours from get_board capabilities, a six-digit hex value, or transparent.`,
    );
  }
  const color = input.color ?? COLORS[0];
  if (input.author !== undefined && !isAuthor(input.author)) {
    throw new BoardValidationError(
      "Item author must be human or ai",
      "INVALID_AUTHOR",
      "author",
      `"human" or "ai"`,
      `Set author once at the draw_board top level; do not put custom names inside items.`,
    );
  }
  const author = input.author ?? "human";
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
