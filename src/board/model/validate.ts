/**
 * Write-path validation for Board v1.
 *
 * Every byte accepted from an MCP/HTTP caller passes through `normalizeItem`.
 * Validation is strict on purpose: an invalid value raises a descriptive,
 * repairable error instead of being coerced, so the persisted board always
 * matches what the caller asked for. The persisted-state rules live beside this
 * in `parse-board.ts`, and the shared predicates in `predicates.ts`, so the two
 * paths cannot drift.
 */

import {
  COLORS, IMAGE_MIMES, ITEM_TYPES, MAX_COORDINATE, MAX_GROUP_ID, MAX_IMAGE_SRC,
  MAX_STROKE_POINTS, MAX_TEXT, MAX_TITLE, ROLES, VARIANTS,
} from "./limits.js";
import type { BoardItem, BoardItemInput, BoardLineShape } from "./types.js";
import { makeId } from "./clock.js";
import { resolveGeometry } from "./size.js";
import { BoardValidationError } from "../errors.js";
import {
  isAuthor, isEmphasis, isFiniteNumber, isImageSource, isLineShape, isPoint,
  isRole, isVariant, isFillColor, normalizeScene, normalizeStyle,
} from "./predicates.js";

/*
 * Re-exported for compatibility: callers and tests reach `parseBoard` and the
 * author predicate through this module, and `types.ts` re-exports both.
 */
export { parseBoard } from "./parse-board.js";
export { isAuthor } from "./predicates.js";

export function normalizeItem(input: BoardItemInput): Omit<BoardItem, "createdAt" | "updatedAt"> {
  if (!input || typeof input !== "object") throw new Error("Invalid item input");
  if (!ITEM_TYPES.includes(input.type)) throw new Error("Unknown item type");
  if (![input.x, input.y].every(isFiniteNumber)) throw new Error("Item coordinates must be finite");
  const { signedWidth, signedHeight } = resolveGeometry(input.type, input.x, input.y, input.w, input.h);
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
  if (input.type === "line" && signedWidth === 0 && signedHeight === 0) {
    throw new BoardValidationError(
      "Line needs a direction",
      "LINE_WITHOUT_DIRECTION",
      "items[].w",
      "w or h non-zero",
      `Give the arrow an endpoint: set w (and/or h) to the delta from its start. A horizontal arrow 160px long uses w: 160, h: 0.`,
    );
  }
  if (input.type === "image" && !isImageSource(input.src)) {
    throw new BoardValidationError(
      "Image source is required",
      "IMAGE_SOURCE_MISSING",
      "items[].src",
      "data:image/<png|jpeg|gif|webp|bmp|avif|svg+xml>;base64,...",
      `Send the image bytes as a base64 data URL in src, with mime set to the same image type.`,
    );
  }
  if (input.type === "line" && input.shape !== undefined && !isLineShape(input.shape)) {
    throw new BoardValidationError(
      "Invalid line shape",
      "INVALID_LINE_SHAPE",
      "items[].shape",
      `"straight", "curve", or "orthogonal"`,
      `Use "straight" for a direct arrow, "curve" for a bowed one, or "orthogonal" for right-angled routing.`,
    );
  }
  if (input.emphasis !== undefined && !isEmphasis(input.emphasis)) {
    throw new BoardValidationError(
      "Invalid item emphasis",
      "INVALID_EMPHASIS",
      "items[].emphasis",
      `"normal" or "focus"`,
      `Use emphasis: "focus" to mark the one item the current exchange is about, or omit the field.`,
    );
  }
  const style = normalizeStyle(input.style);
  const scene = normalizeScene(input.scene);
  if (input.variant !== undefined && !isVariant(input.variant)) {
    throw new BoardValidationError(
      "Invalid item variant",
      "INVALID_VARIANT",
      "items[].variant",
      VARIANTS.join(", "),
      `Pick a variant from get_board capabilities.variants; "card" is the usual choice for a labelled box.`,
    );
  }
  if (input.role !== undefined && !isRole(input.role)) {
    throw new BoardValidationError(
      "Invalid item role",
      "INVALID_ROLE",
      "items[].role",
      ROLES.join(", "),
      `Pick a role from get_board capabilities.roles; "step" is the usual choice in a flow.`,
    );
  }
  if (input.z !== undefined && (!isFiniteNumber(input.z) || input.z < -1000 || input.z > 1000)) {
    throw new BoardValidationError(
      "Invalid item z-order",
      "INVALID_Z",
      "items[].z",
      "a number between -1000 and 1000",
      `Leave z out unless you need explicit stacking; frames and columns already render behind their contents.`,
    );
  }
  if ((input.startItemId || input.endItemId) && input.type !== "line") {
    throw new BoardValidationError(
      "Only line items can bind connectors",
      "CONNECTOR_ON_NON_LINE",
      "items[].startItemId",
      "a line item, or omit both connector fields",
      `Draw the connector as its own type: "line" item with startItemId / endItemId. The arrow follows the bound shapes.`,
    );
  }
  if (input.type === "stroke") {
    if (!Array.isArray(input.points) || input.points.length < 2 || input.points.length > MAX_STROKE_POINTS) {
      throw new BoardValidationError(
        "Stroke needs bounded points",
        "STROKE_POINTS_INVALID",
        "items[].points",
        `an array of 2-${MAX_STROKE_POINTS} {x,y} points relative to the item bounds`,
        `Send at least two local points, e.g. points: [{x:0,y:0},{x:40,y:20}]. For a straight arrow use type "line" instead.`,
      );
    }
  }
  const points = input.type === "stroke"
    ? (input.points ?? []).map((point) => ({
      x: Math.max(0, Math.min(signedWidth, point.x)),
      y: Math.max(0, Math.min(signedHeight, point.y)),
    }))
    : undefined;
  /*
   * A title and a group id are bounds too, so they are rejected, not truncated.
   *
   * `slice(0, MAX_TITLE)` silently dropped the tail of a 121-character heading
   * and still reported success — the same disagreement the size and coordinate
   * bounds already refuse. A caller that wrote a heading meant to keep all of
   * it.
   */
  if (input.title !== undefined && input.title.trim().length > MAX_TITLE) {
    throw new BoardValidationError(
      `Item title is ${input.title.trim().length} characters; the limit is ${MAX_TITLE}`,
      "TITLE_TOO_LONG",
      "items[].title",
      `at most ${MAX_TITLE} characters`,
      `Shorten the heading and move the rest into text or a note.`,
    );
  }
  if (input.groupId !== undefined && input.groupId.trim().length > MAX_GROUP_ID) {
    throw new BoardValidationError(
      `Item groupId is ${input.groupId.trim().length} characters; the limit is ${MAX_GROUP_ID}`,
      "GROUP_ID_TOO_LONG",
      "items[].groupId",
      `at most ${MAX_GROUP_ID} characters`,
      `Use one short shared marker such as "auth" on the objects that belong together.`,
    );
  }
  const title = input.title?.trim().slice(0, MAX_TITLE) || undefined;
  const groupId = input.groupId?.trim().slice(0, MAX_GROUP_ID) || undefined;
  return {
    id: input.id?.trim() || makeId("item"),
    type: input.type,
    // `resolveGeometry` already proved both are inside the bound.
    x: input.x,
    y: input.y,
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
