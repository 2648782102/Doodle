/**
 * Board-level shape checks for Board v1.
 *
 * Split from `parse-board.ts` because these run once per board, before the
 * per-item loop, and `parseBoard` had grown past the module budget. Every
 * rejection names the field a caller has to fix; a whole-board payload is
 * unrepairable without that.
 */

import { MAX_ITEMS, MAX_NOTES } from "./limits.js";
import type { SimpleBoard } from "./types.js";
import { BoardValidationError } from "../errors.js";
import { isFiniteNumber } from "./predicates.js";

export function assertBoardHeader(
  value: unknown,
): Pick<SimpleBoard, "version" | "id" | "title" | "revision" | "items" | "notes"> & Partial<SimpleBoard> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BoardValidationError(
      `A board must be an object, got ${Array.isArray(value) ? "an array" : JSON.stringify(value)}`,
      "INVALID_BOARD",
      "replace_board",
      "a version 1 board object",
      `Send the object you read from get_board, or omit replace_board and use items/updates instead.`,
    );
  }
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
  return raw as Pick<SimpleBoard, "version" | "id" | "title" | "revision" | "items" | "notes"> & Partial<SimpleBoard>;
}
