/**
 * Unified write pipeline shared by both the MCP tool surface and the local HTTP
 * surface.
 *
 * Historically `registerDrawBoardTool` and `BoardHttpServer.commit` maintained
 * two separate copies of "snapshot → conflict-check/merge → guard empty write →
 * persist → remember revision → mark writer". Every guard or conflict fix had
 * to be landed twice and regularly drifted. This module is the single
 * authority for committing a board change.
 */

import {
  BoardRevisionConflictError,
  BoardValidationError,
  EmptyWriteRefusedError,
  ObjectConflictError,
} from "../errors.js";
import { reportConflicts } from "./conflict.js";
import type { BoardRevisionCache } from "../state/revision-cache.js";
import { isSuspiciousEmptyWrite, type BoardStore } from "../state/store.js";
import type { BoardAuthor, SimpleBoard } from "../types.js";

export interface CommitBoardWriteOptions {
  store: BoardStore;
  revisions?: BoardRevisionCache;
  author: BoardAuthor;
  expectedRevision?: number;
  /** Refuse accidental empty-board overwrites (default false; true for HTTP). */
  guardEmptyWrite?: boolean;
  /** Explicit deletions may empty the board even when `guardEmptyWrite` is true. */
  allowEmpty?: boolean;
  /** Whole-board replacements cannot be merged against a stale base. */
  wholeBoard?: boolean;
  /** Request shape inspected by `reportConflicts` when rebasing a stale write. */
  conflictScope?: unknown;
  /**
   * When a pinned revision is absent from the in-process cache, MCP returns a
   * repairable `REVISION_NOT_CACHED` validation error while HTTP returns 409.
   */
  uncachedMode?: "validation-error" | "conflict-error";
  /** Pure transform producing the candidate board from the latest committed state. */
  change: (current: SimpleBoard) => SimpleBoard;
}

export interface CommitBoardWriteResult {
  before: SimpleBoard;
  board: SimpleBoard;
  mergedFrom?: number;
}

export async function commitBoardWrite(options: CommitBoardWriteOptions): Promise<CommitBoardWriteResult> {
  const {
    store,
    revisions,
    author,
    expectedRevision,
    guardEmptyWrite = false,
    allowEmpty = false,
    wholeBoard = false,
    conflictScope,
    uncachedMode = "conflict-error",
    change,
  } = options;

  const candidateFor = (current: SimpleBoard): SimpleBoard => {
    const candidate = change(current);
    if (guardEmptyWrite && !allowEmpty && isSuspiciousEmptyWrite(current, candidate)) {
      throw new EmptyWriteRefusedError();
    }
    return candidate;
  };

  let before: SimpleBoard;
  let board: SimpleBoard;
  let mergedFrom: number | undefined;

  if (expectedRevision === undefined) {
    before = await store.snapshot();
    board = await store.mutate((current) => {
      before = current;
      return candidateFor(current);
    });
  } else {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new BoardRevisionConflictError(-1, expectedRevision);
    }
    /*
     * Perform snapshot, conflict check, rebase, and persist inside a single
     * mutex acquisition so another writer cannot slip in between snapshot and
     * replaceIfRevision (eliminating the TOCTOU window).
     */
    const locked = await store.runLockedWrite((current) => {
      if (current.revision === expectedRevision) {
        return { next: candidateFor(current), expectedRevision };
      }
      if (wholeBoard) {
        throw new BoardRevisionConflictError(expectedRevision, current.revision);
      }
      const base = revisions?.get(expectedRevision);
      if (!base || base.id !== current.id) {
        if (uncachedMode === "validation-error") {
          throw new BoardValidationError(
            `Revision ${expectedRevision} is not this session's; the board is now at ${current.revision}`,
            "REVISION_NOT_CACHED",
            "expected_revision",
            `expected_revision: ${current.revision}`,
            `Call get_board to read the current board and re-send your change with the new revision. A revision is only known to the process that wrote it.`,
          );
        }
        throw new BoardRevisionConflictError(expectedRevision, current.revision);
      }
      const { conflicts } = reportConflicts(base, current, conflictScope);
      if (conflicts.length > 0) {
        throw new ObjectConflictError(expectedRevision, current.revision, conflicts);
      }
      mergedFrom = expectedRevision;
      return { next: candidateFor(current), expectedRevision: current.revision };
    });
    before = locked.before;
    board = locked.board;
  }

  revisions?.remember(board);
  revisions?.markWriter(board.revision, author);
  return { before, board, ...(mergedFrom === undefined ? {} : { mergedFrom }) };
}
