/**
 * Geometry bounds for Board v1 items.
 *
 * Split out of `validate.ts` because this is the part that decides whether a
 * caller's coordinates and sizes survive into the persisted board. It is
 * deliberately separate from text, colour, and semantic-field checks: those
 * describe meaning, while these describe where the ink lands.
 *
 * The rule across the whole file is *reject, do not clamp*. Only an omitted
 * value earns a default; an explicit value outside the bounds fails with the
 * bound spelled out, so the caller's request and the stored board never
 * silently disagree.
 */

import {
  MAX_COORDINATE, MAX_LINE_DELTA_X, MAX_LINE_DELTA_Y,
  MAX_SHAPE_HEIGHT, MAX_SHAPE_WIDTH, MIN_SHAPE_SIZE, MIN_STROKE_SPAN,
} from "./limits.js";
import { BoardValidationError } from "../errors.js";

export interface GeometryBounds {
  signedWidth: number;
  signedHeight: number;
}

/**
 * Validate `x`, `y`, `w`, `h` for one item and return the signed sizes the
 * board should store.
 *
 * A `line` uses `w`/`h` as endpoint deltas and may go negative; every other
 * type uses them as positive box dimensions.
 */
export function resolveGeometry(
  type: string,
  x: number,
  y: number,
  w: number | undefined,
  h: number | undefined,
): GeometryBounds {
  if (x < -MAX_COORDINATE || x > MAX_COORDINATE
    || y < -MAX_COORDINATE || y > MAX_COORDINATE) {
    const axis = Math.abs(x) > MAX_COORDINATE ? "x" : "y";
    throw new BoardValidationError(
      `Item ${axis} must be within ±${MAX_COORDINATE}`,
      "COORDINATE_OUT_OF_RANGE",
      `items[].${axis}`,
      `a finite number between -${MAX_COORDINATE} and ${MAX_COORDINATE}`,
      `Move the object inside the bounded canvas and retry.`,
    );
  }
  if (w !== undefined && !Number.isFinite(w)) throw new Error("Item width must be finite");
  if (h !== undefined && !Number.isFinite(h)) throw new Error("Item height must be finite");
  if (type === "line") {
    if (w === undefined && h === undefined) {
      throw new Error("Line requires w or h as its endpoint delta");
    }
  }

  const width = type === "line" ? 1
    : type === "stroke" ? Math.max(MIN_STROKE_SPAN, w ?? 1)
      : Math.max(MIN_SHAPE_SIZE, w ?? 180);
  const height = type === "line" ? 1
    : type === "stroke" ? Math.max(MIN_STROKE_SPAN, h ?? 1)
      : Math.max(MIN_SHAPE_SIZE, h ?? 120);

  /*
   * The floor is a bound, not a suggestion.
   *
   * `Math.max(MIN_SHAPE_SIZE, w)` let an explicit `w: 12` through and stored
   * 16, so the caller's request and the board disagreed and nothing reported
   * it - the same failure the coordinate ceiling already rejects.
   */
  const spatialMin = type === "stroke" ? MIN_STROKE_SPAN : MIN_SHAPE_SIZE;
  if (type !== "line" && w !== undefined && Math.abs(w) < spatialMin) {
    throw new BoardValidationError(
      `Item w must be at least ${spatialMin}`,
      "SIZE_OUT_OF_RANGE",
      "items[].w",
      `a number between ${spatialMin} and ${MAX_SHAPE_WIDTH}`,
      `Increase w to ${spatialMin} or more; omit w to use the default width.`,
    );
  }
  if (type !== "line" && h !== undefined && Math.abs(h) < spatialMin) {
    throw new BoardValidationError(
      `Item h must be at least ${spatialMin}`,
      "SIZE_OUT_OF_RANGE",
      "items[].h",
      `a number between ${spatialMin} and ${MAX_SHAPE_HEIGHT}`,
      `Increase h to ${spatialMin} or more; omit h to use the default height.`,
    );
  }
  if (type !== "line" && (width > MAX_SHAPE_WIDTH || height > MAX_SHAPE_HEIGHT)) {
    const axis = width > MAX_SHAPE_WIDTH ? "w" : "h";
    const maximum = axis === "w" ? MAX_SHAPE_WIDTH : MAX_SHAPE_HEIGHT;
    throw new BoardValidationError(
      `Item ${axis} must not exceed ${maximum}`,
      "SIZE_OUT_OF_RANGE",
      `items[].${axis}`,
      `a number between ${spatialMin} and ${maximum}`,
      `Split the content into smaller objects instead of oversizing one shape.`,
    );
  }

  const signedWidth = w !== undefined
    ? (type === "line" ? w : width)
    : (type === "line" ? 0 : width);
  const signedHeight = h !== undefined
    ? (type === "line" ? h : height)
    : (type === "line" ? 0 : height);

  if (type === "line"
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

  return { signedWidth, signedHeight };
}
