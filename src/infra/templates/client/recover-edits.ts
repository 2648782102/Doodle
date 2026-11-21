/**
 * Putting the person's unsent edits back, once the board is reachable again.
 *
 * Runs on boot and whenever the live channel comes back. For each board with a
 * stored edit it asks three questions with `mergeBoardEdits`:
 *
 *   nothing to send      → drop the copy, the board already matches
 *   clean merge          → send the merged request, drop the copy on success
 *   a genuine overlap    → keep the copy and tell the person which objects
 *                          collided; an automatic choice would overwrite one of
 *                          two edits that both meant something
 *
 * The recovery is deliberately silent on the happy path. A person who closed
 * their laptop mid-stroke should find their work merged back, not a dialog
 * asking them to approve it.
 *
 * Pure decision + injected effects, so the whole matrix is testable in Node.
 */

import { mergeBoardEdits, type MergeBoard, type MergeResult } from "./three-way-merge.js";
import type { PendingEdit } from "./pending-edits.js";

export interface RecoverDeps {
  /** The board as it is now, or null when this board no longer exists. */
  load(boardId: string): Promise<MergeBoard | null>;
  /** Send a merged request. Resolves with the new board, or throws. */
  send(boardId: string, change: MergeResult["change"], expectedRevision: number): Promise<unknown>;
  drop(boardId: string): Promise<void>;
}

export type RecoveryOutcome =
  /** The board already contains everything they drew. */
  | { kind: "already-merged"; boardId: string }
  /** The merged request landed. */
  | { kind: "merged"; boardId: string; sent: number }
  /** Some objects collided; the stored copy is kept for the person to resolve. */
  | { kind: "conflict"; boardId: string; conflicts: string[] }
  /** The board is gone (deleted, or a different board now owns that id). */
  | { kind: "board-missing"; boardId: string }
  /** The send failed; the copy is kept and will be retried. */
  | { kind: "failed"; boardId: string };

export async function recoverPendingEdit(edit: PendingEdit, deps: RecoverDeps): Promise<RecoveryOutcome> {
  const theirBoard = await deps.load(edit.boardId).catch(() => null);
  if (!theirBoard) return { kind: "board-missing", boardId: edit.boardId };

  const base: MergeBoard = { id: edit.base.id, revision: edit.base.revision, items: edit.base.items };
  const mine: MergeBoard = { id: edit.mine.id, revision: edit.mine.revision, items: edit.mine.items };
  const merged = mergeBoardEdits(base, mine, theirBoard);

  if (merged.conflicts.length > 0) {
    // Kept, not resolved: both edits were meant, and only the person knows which.
    return { kind: "conflict", boardId: edit.boardId, conflicts: merged.conflicts };
  }
  if (merged.empty) {
    await deps.drop(edit.boardId).catch(() => {});
    return { kind: "already-merged", boardId: edit.boardId };
  }

  const sent = merged.change.items.length + merged.change.updates.length + merged.change.remove_ids.length;
  try {
    await deps.send(edit.boardId, merged.change, theirBoard.revision);
  } catch {
    // Left on disk on purpose: the next reconnect tries again.
    return { kind: "failed", boardId: edit.boardId };
  }
  await deps.drop(edit.boardId).catch(() => {});
  return { kind: "merged", boardId: edit.boardId, sent };
}

export async function recoverAll(
  edits: PendingEdit[],
  deps: RecoverDeps,
): Promise<RecoveryOutcome[]> {
  const outcomes: RecoveryOutcome[] = [];
  for (const edit of edits) {
    outcomes.push(await recoverPendingEdit(edit, deps));
  }
  return outcomes;
}

/**
 * Wire recovery to the canvas' own surfaces.
 *
 * Kept here rather than in the entrypoint so the ~40 lines of plumbing (which
 * board is current, how a merge is sent, what to tell the person) live beside
 * the decisions they serve. The entrypoint only calls it and reacts to the
 * summary.
 */
export interface RecoverIntoCanvasOptions {
  pending: PendingEditsSource;
  /** The board currently painted, or a fresh read when it is another board. */
  currentBoard(boardId: string): Promise<MergeBoard | null>;
  send(change: MergeResult["change"], expectedRevision: number): Promise<MergeBoard>;
  onMerged(): void;
}

/** The narrow read/drop surface `recoverAll` needs from the pending store. */
export interface PendingEditsSource {
  all(): Promise<PendingEdit[]>;
  drop(boardId: string): Promise<void>;
}

export interface RecoverIntoCanvasSummary {
  merged: number;
  conflicts: string[];
  failed: number;
}

export async function recoverIntoCanvas(options: RecoverIntoCanvasOptions): Promise<RecoverIntoCanvasSummary> {
  const edits = await options.pending.all().catch(() => [] as PendingEdit[]);
  if (edits.length === 0) return { merged: 0, conflicts: [], failed: 0 };
  const outcomes = await recoverAll(edits, {
    load: (boardId) => options.currentBoard(boardId),
    send: (_boardId, change, expectedRevision) => options.send(change, expectedRevision),
    drop: (boardId) => options.pending.drop(boardId),
  });
  const summary: RecoverIntoCanvasSummary = { merged: 0, conflicts: [], failed: 0 };
  for (const outcome of outcomes) {
    if (outcome.kind === "merged") summary.merged += 1;
    if (outcome.kind === "failed") summary.failed += 1;
    if (outcome.kind === "conflict") summary.conflicts.push(...outcome.conflicts);
  }
  if (summary.merged > 0) options.onMerged();
  return summary;
}

/**
 * Recover, then tell the person only what they need to act on.
 *
 * The entrypoint calls this and nothing else. Announcing a decision here rather
 * than returning a summary keeps the recovery contract in one place: a clean
 * merge is silent, a genuine overlap becomes the same conflict surface the live
 * path uses, and a failure says nothing because the copy is still on disk and
 * the next boot retries it.
 */
export interface RecoverOnBootDeps {
  pending: PendingEditsSource;
  /** Read the current board, or reuse the one already painted. */
  currentBoard(boardId: string): Promise<MergeBoard | null>;
  /** Send a merged request through whichever channel this canvas is on. */
  send(change: MergeResult["change"], expectedRevision: number): Promise<MergeBoard>;
  /** Repaint from the board as it is now, after a merge landed. */
  refresh(): void;
  /** Report a conflict to the person, naming what collided. */
  onConflict(conflicts: string[]): void;
}

export async function recoverOnBoot(deps: RecoverOnBootDeps): Promise<RecoverIntoCanvasSummary> {
  return recoverIntoCanvas({
    pending: deps.pending,
    currentBoard: deps.currentBoard,
    send: deps.send,
    onMerged: deps.refresh,
  }).then((summary) => {
    if (summary.conflicts.length > 0) deps.onConflict(summary.conflicts);
    return summary;
  });
}

/**
 * Recover with the canvas' own surfaces already filled in.
 *
 * The entrypoint knows how to read the active board, send through whichever
 * channel it is on, repaint, and report a conflict. Everything else about
 * recovery is policy, and lives above. Separating the two is what keeps the
 * entrypoint from holding a second copy of the recovery rules.
 */
export interface RecoverFromCanvasDeps {
  pending: PendingEditsSource;
  /** The board already painted, if it is the one being recovered. */
  activeBoard: { id: string; revision: number; items: Array<Record<string, unknown>> } | null;
  /** Read the board when the pending edit belongs to another one. */
  readBoard(): Promise<{ id: string; revision: number; items: Array<Record<string, unknown>> } | null>;
  applyMerged(
    change: MergeResult["change"],
    expectedRevision: number,
  ): Promise<{ id: string; revision: number; items: Array<Record<string, unknown>> }>;
  refresh(): void;
  onConflict(conflicts: string[]): void;
}

export async function recoverFromCanvas(deps: RecoverFromCanvasDeps): Promise<RecoverIntoCanvasSummary> {
  return recoverOnBoot({
    pending: deps.pending,
    currentBoard: async (boardId) => {
      if (deps.activeBoard?.id === boardId) return deps.activeBoard;
      const board = await deps.readBoard().catch(() => null);
      return board?.id === boardId ? board : null;
    },
    send: (change, expectedRevision) => deps.applyMerged(change, expectedRevision),
    refresh: deps.refresh,
    onConflict: deps.onConflict,
  });
}

/**
 * The shape recovery needs from a board, and nothing else.
 *
 * The canvas holds `BoardSnapshot`s whose `items` are `unknown[]`; recovery only
 * ever reads ids and revisions. Projecting in one place keeps the three call
 * sites from each inventing a slightly different cast.
 */
export function mergeBoardView(snapshot: {
  id: string;
  revision: number;
  items: unknown[];
} | null): MergeBoard | null {
  if (!snapshot) return null;
  return {
    id: snapshot.id,
    revision: snapshot.revision,
    items: snapshot.items as Array<Record<string, unknown>>,
  };
}
