/**
 * Persisted-state validation for Board v1.
 *
 * `parseBoard` guards anything read from disk or handed to `replace_board`,
 * so it must fail on exactly the rules a fresh write fails on, and with the
 * same specificity: a caller that hand-built a board needs to know *which*
 * object and *which* field, not "Invalid board collections".
 */

import {
  IMAGE_MIMES, ITEM_TYPES, MAX_GROUP_ID, MAX_ITEMS, MAX_NOTES,
  MAX_STROKE_POINTS, MAX_TITLE, ROLES, VARIANTS,
} from "./limits.js";
import type {
  BoardItem, BoardItemType, BoardNote, BoardPoint, SimpleBoard,
} from "./types.js";
import { now } from "./clock.js";
import { resolveGeometry } from "./size.js";
import { BoardValidationError } from "../errors.js";
import {
  isAuthor, isEmphasis, isFillColor, isFiniteNumber, isImageSource, isLineShape,
  isPoint, isRole, isVariant, normalizeScene, normalizeStyle,
} from "./predicates.js";

export function parseBoard(value: unknown): SimpleBoard {
  if (!value || typeof value !== "object") throw new Error("Board must be an object");
  const raw = value as Partial<SimpleBoard>;
  /*
   * Every rejection here names the field it came from.
   *
   * `replace_board` accepts a whole board object, and a model that hand-built
   * one got "Invalid board collections" for a bad colour three levels down —
   * no index, no field, no repair. The write path already reports structured
   * errors; the persisted-state path has to be just as specific or the caller
   * cannot tell which of two hundred objects it got wrong.
   */
  if (raw.version !== 1) {
    throw new BoardValidationError(
      `Board version must be 1, got ${JSON.stringify(raw.version)}`,
      "INVALID_BOARD_VERSION",
      "version",
      "1",
      `Send version: 1. Version 1 is the only persisted shape; omit the field rather than inventing a new one.`,
    );
  }
  if (typeof raw.id !== "string" || typeof raw.title !== "string") {
    throw new BoardValidationError(
      "Board id and title must be strings",
      "INVALID_BOARD_IDENTITY",
      typeof raw.id !== "string" ? "id" : "title",
      "a string",
      `Keep the id and title you read from get_board; both are plain strings.`,
    );
  }
  if (!isFiniteNumber(raw.revision) || raw.revision < 0) {
    throw new BoardValidationError(
      `Board revision must be a non-negative number, got ${JSON.stringify(raw.revision)}`,
      "INVALID_BOARD_REVISION",
      "revision",
      "a non-negative integer",
      `Send the revision you read from get_board. Do not compute or decrement it; the store assigns the next one.`,
    );
  }
  if (!Array.isArray(raw.items) || !Array.isArray(raw.notes)) {
    throw new BoardValidationError(
      `Board ${Array.isArray(raw.items) ? "notes" : "items"} must be an array`,
      "INVALID_BOARD_COLLECTIONS",
      Array.isArray(raw.items) ? "notes" : "items",
      "an array (empty is fine)",
      `Send both items and notes as arrays. A board snapshot with notes: [] and its items unchanged is the usual shape.`,
    );
  }
  if (raw.items.length > MAX_ITEMS || raw.notes.length > MAX_NOTES) {
    throw new BoardValidationError(
      `Board holds ${raw.items.length} items and ${raw.notes.length} notes; the limits are ${MAX_ITEMS} and ${MAX_NOTES}`,
      "BOARD_TOO_LARGE",
      raw.items.length > MAX_ITEMS ? "items" : "notes",
      `at most ${MAX_ITEMS} items and ${MAX_NOTES} notes`,
      `Split the content across two boards in the library instead of one oversized board.`,
    );
  }
  const itemIds = new Set<string>();
  const items = raw.items.map((item, index) => {
    const at = `items[${index}]`;
    if (!item || typeof item !== "object") {
      throw new BoardValidationError(
        `Item ${index} is not an object`,
        "INVALID_ITEM",
        at,
        "a board object",
        `Remove the entry or send a complete object with id, type, x, y, w, h, text, and color.`,
      );
    }
    const candidate = item as Partial<BoardItem>;
    if (typeof candidate.id !== "string" || !ITEM_TYPES.includes(candidate.type as BoardItemType)) {
      throw new BoardValidationError(
        `Item ${index} has no usable id or type`,
        "INVALID_ITEM_TYPE",
        typeof candidate.id !== "string" ? `${at}.id` : `${at}.type`,
        typeof candidate.id !== "string" ? "a string id" : `one of ${ITEM_TYPES.join(", ")}`,
        `Every item needs a string id and a type from the list. Reuse the ids you read from get_board rather than inventing them.`,
      );
    }
    if (![candidate.x, candidate.y, candidate.w, candidate.h].every(isFiniteNumber)) {
      const bad = ["x", "y", "w", "h"].find((key) => !isFiniteNumber((candidate as Record<string, unknown>)[key]));
      throw new BoardValidationError(
        `Item ${index} has a non-numeric ${bad}`,
        "INVALID_ITEM_GEOMETRY",
        `${at}.${bad}`,
        "a finite number",
        `Send x, y, w, and h as numbers. A line uses signed w/h as endpoint deltas; other types use positive sizes.`,
      );
    }
    const x = candidate.x as number;
    const y = candidate.y as number;
    const width = candidate.w as number;
    const height = candidate.h as number;
    if (typeof candidate.text !== "string" || typeof candidate.color !== "string") {
      const bad = typeof candidate.text !== "string" ? "text" : "color";
      throw new BoardValidationError(
        `Item ${index} has a non-string ${bad}`,
        "INVALID_ITEM_FIELD",
        `${at}.${bad}`,
        "a string",
        `Send text as a string, even when empty, and color as a six-digit hex value or transparent.`,
      );
    }
    /*
     * A string is not enough: the colour has to be one the canvas can paint.
     *
     * `parseBoard` used to accept any string here while the write path required
     * `#rrggbb` or `transparent`. A `replace_board` payload with `color: "nope"`
     * was therefore persisted, and the canvas then rendered an object with no
     * usable fill. The two paths have to agree, which is the whole point of
     * routing both through the same predicates.
     */
    if (!isFillColor(candidate.color)) {
      throw new BoardValidationError(
        `Item ${index} has color ${JSON.stringify(candidate.color)}, which is not a fill colour`,
        "INVALID_COLOR",
        `${at}.color`,
        "#rrggbb or transparent",
        `Use a six-digit hex value such as #f6d365, or transparent for no fill.`,
      );
    }
    if (!isAuthor(candidate.author)) {
      throw new BoardValidationError(
        `Item ${index} has author ${JSON.stringify(candidate.author)}`,
        "INVALID_AUTHOR",
        `${at}.author`,
        `"human" or "ai"`,
        `Keep the author you read from get_board; a custom name is refused rather than coerced.`,
      );
    }
    if (itemIds.has(candidate.id)) {
      throw new BoardValidationError(
        `Item ${index} repeats the id ${JSON.stringify(candidate.id)}`,
        "DUPLICATE_ITEM_ID",
        `${at}.id`,
        "an id used by no other item",
        `Give every item its own id, or remove the duplicate. Re-read the board if you are unsure which ids exist.`,
      );
    }
    itemIds.add(candidate.id);
    /*
     * Reuse the same bounds the write path enforces. `parseBoard` guards
     * persisted state, so a board written before a limit existed, or one edited
     * by hand, must fail on exactly the rules a fresh write fails on.
     */
    try {
      resolveGeometry(String(candidate.type), x, y, width, height);
    } catch (error) {
      // `size.ts` already built a repairable error; only the index is missing,
      // and losing it is what made "Invalid board collections" useless on a
      // 200-object replacement.
      if (error instanceof BoardValidationError) {
        throw new BoardValidationError(
          `Item ${index}: ${error.message}`,
          error.code,
          `${at}.${error.path.split(".").pop()}`,
          error.expected,
          error.fix,
        );
      }
      throw error;
    }
    if (candidate.type === "image" && !isImageSource(candidate.src)) {
      throw new BoardValidationError(
        `Item ${index} is an image without a data URL source`,
        "IMAGE_SOURCE_MISSING",
        `${at}.src`,
        "data:image/<png|jpeg|gif|webp|bmp|avif|svg+xml>;base64,...",
        `Send the bytes as a base64 data URL in src, with mime set to the same type.`,
      );
    }
    if (candidate.type === "stroke") {
      if (!Array.isArray(candidate.points) || candidate.points.length < 2 || candidate.points.length > MAX_STROKE_POINTS) {
        throw new BoardValidationError(
          `Item ${index} is a stroke with ${Array.isArray(candidate.points) ? candidate.points.length : "no"} points`,
          "STROKE_POINTS_INVALID",
          `${at}.points`,
          `an array of 2-${MAX_STROKE_POINTS} {x,y} points relative to the item bounds`,
          `Send at least two local points. For a straight arrow use type "line" instead.`,
        );
      }
      if (!candidate.points.every((point) => isPoint(point)
        && (point as BoardPoint).x >= 0 && (point as BoardPoint).x <= width
        && (point as BoardPoint).y >= 0 && (point as BoardPoint).y <= height))
        throw new BoardValidationError(
          `Item ${index} has a stroke point outside its bounds`,
          "STROKE_POINT_OUT_OF_RANGE",
          `${at}.points`,
          `each point between (0,0) and (${width},${height})`,
          `Stroke points are local to the item box. Enlarge w/h or move the outlier inside the box.`,
        );
    }
    if (candidate.title !== undefined && (typeof candidate.title !== "string" || candidate.title.length > MAX_TITLE)) {
      throw new BoardValidationError(
        `Item ${index} has a title that is not a string of at most ${MAX_TITLE} characters`,
        "INVALID_TITLE",
        `${at}.title`,
        `a string of at most ${MAX_TITLE} characters`,
        `Shorten the heading or drop it; long explanations belong in text or a note.`,
      );
    }
    if (candidate.shape !== undefined && !isLineShape(candidate.shape)) {
      throw new BoardValidationError(
        `Item ${index} has line shape ${JSON.stringify(candidate.shape)}`,
        "INVALID_LINE_SHAPE",
        `${at}.shape`,
        `"straight", "curve", or "orthogonal"`,
        `Use "straight" for a direct arrow, "curve" for a bowed one, or "orthogonal" for right-angled routing.`,
      );
    }
    if (candidate.emphasis !== undefined && !isEmphasis(candidate.emphasis)) {
      throw new BoardValidationError(
        `Item ${index} has emphasis ${JSON.stringify(candidate.emphasis)}`,
        "INVALID_EMPHASIS",
        `${at}.emphasis`,
        `"normal" or "focus"`,
        `Use emphasis: "focus" to mark the one item the current exchange is about, or omit the field.`,
      );
    }
    if (candidate.groupId !== undefined && (typeof candidate.groupId !== "string" || candidate.groupId.length > MAX_GROUP_ID)) {
      throw new BoardValidationError(
        `Item ${index} has a group id that is not a string of at most ${MAX_GROUP_ID} characters`,
        "INVALID_GROUP_ID",
        `${at}.groupId`,
        `a string of at most ${MAX_GROUP_ID} characters`,
        `Use one short shared marker such as "auth" on the objects that belong together.`,
      );
    }
    if (candidate.mime !== undefined && !IMAGE_MIMES.includes(candidate.mime as string)) {
      throw new BoardValidationError(
        `Item ${index} has image mime ${JSON.stringify(candidate.mime)}`,
        "INVALID_IMAGE_MIME",
        `${at}.mime`,
        IMAGE_MIMES.join(", "),
        `Use the same type as the data URL you put in src.`,
      );
    }
    const style = normalizeStyle(candidate.style);
    const scene = normalizeScene(candidate.scene);
    if (candidate.variant !== undefined && !isVariant(candidate.variant)) {
      throw new BoardValidationError(
        `Item ${index} has variant ${JSON.stringify(candidate.variant)}`,
        "INVALID_VARIANT",
        `${at}.variant`,
        VARIANTS.join(", "),
        `Pick a variant from get_board capabilities.variants; "card" is the usual choice for a labelled box.`,
      );
    }
    if (candidate.role !== undefined && !isRole(candidate.role)) {
      throw new BoardValidationError(
        `Item ${index} has role ${JSON.stringify(candidate.role)}`,
        "INVALID_ROLE",
        `${at}.role`,
        ROLES.join(", "),
        `Pick a role from get_board capabilities.roles; "step" is the usual choice in a flow.`,
      );
    }
    if (candidate.z !== undefined && !isFiniteNumber(candidate.z)) {
      throw new BoardValidationError(
        `Item ${index} has a non-numeric z`,
        "INVALID_Z",
        `${at}.z`,
        "a number between -1000 and 1000",
        `Leave z out unless you need explicit stacking; frames and columns already render behind their contents.`,
      );
    }
    // Only the type is checked here. Existence is verified after every item has
    // been visited, because a connector may legitimately point at a shape that
    // appears later in the array: checking the incrementally built `itemIds`
    // here rejected "line first, then its two endpoints", which is a normal way
    // for a model to emit a diagram and produced `Invalid line start item` for
    // otherwise valid boards.
    if (candidate.startItemId !== undefined && typeof candidate.startItemId !== "string") {
      throw new BoardValidationError(
        `Item ${index} has a non-string startItemId`,
        "INVALID_CONNECTOR",
        `${at}.startItemId`,
        "an item id string",
        `Point the connector at an existing object id, or omit the field for a free arrow.`,
      );
    }
    if (candidate.endItemId !== undefined && typeof candidate.endItemId !== "string") {
      throw new BoardValidationError(
        `Item ${index} has a non-string endItemId`,
        "INVALID_CONNECTOR",
        `${at}.endItemId`,
        "an item id string",
        `Point the connector at an existing object id, or omit the field for a free arrow.`,
      );
    }
    if ((candidate.startItemId || candidate.endItemId) && candidate.type !== "line") {
      throw new BoardValidationError(
        `Item ${index} binds a connector but is a ${candidate.type}`,
        "CONNECTOR_ON_NON_LINE",
        `${at}.startItemId`,
        "a line item, or omit both connector fields",
        `Draw the connector as its own type: "line" item with startItemId / endItemId.`,
      );
    }
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
  for (const [index, item] of items.entries()) {
    /*
     * Existence is checked here, after every item is known, because a connector
     * may legitimately point at a shape declared later in the array. The error
     * still names the index and the missing id so a caller can find it.
     */
    if (item.startItemId && !allItemIds.has(item.startItemId)) {
      throw new BoardValidationError(
        `Item ${index} is a line starting at ${JSON.stringify(item.startItemId)}, which no item declares`,
        "UNKNOWN_CONNECTOR_ITEM",
        `items[${index}].startItemId`,
        "the id of an item in this board",
        `Declare the shape first or correct the id. A connector may point at a later item, but that item must exist.`,
      );
    }
    if (item.endItemId && !allItemIds.has(item.endItemId)) {
      throw new BoardValidationError(
        `Item ${index} is a line ending at ${JSON.stringify(item.endItemId)}, which no item declares`,
        "UNKNOWN_CONNECTOR_ITEM",
        `items[${index}].endItemId`,
        "the id of an item in this board",
        `Declare the shape first or correct the id. A connector may point at a later item, but that item must exist.`,
      );
    }
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
    revision: raw.revision as number,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now(),
    items,
    notes,
  };
}
