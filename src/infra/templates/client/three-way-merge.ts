/**
 * Re-applying the person's offline edits onto a board that moved without them.
 *
 * The board already merges opposite edits — `reportConflicts` rebases a pinned
 * write onto the current revision when the touched ids did not move. That works
 * while both revisions are in the serving process's `BoardRevisionCache`. It
 * cannot work after an outage: the revision the person was on is long gone from
 * that cache, so the server has nothing to diff against and answers
 * `REVISION_NOT_CACHED`. Only the client still holds that base.
 *
 * So the merge happens here, from three boards the client actually has:
 *
 *   base    what the person was looking at when they started editing
 *   mine    what they drew, projected onto base
 *   theirs  what the board is now
 *
 * Per object, that is the standard three-way rule, and the only interesting
 * cell is "both sides changed it": that is a genuine conflict, it cannot be
 * guessed, and it is reported so the person can choose. Everything else is
 * mechanical. Nothing here invents merge semantics — it decides *which*
 * requests to send, and the server's existing path validates and applies them.
 *
 * Pure: no clock, no I/O, no ids minted. `mergeBoardEdits` returns the request
 * body plus the ids that could not be merged.
 */

import { stableItemFingerprint } from "../../../board/model/fingerprint.js";

export interface MergeBoard {
  id: string;
  revision: number;
  items: Array<Record<string, unknown>>;
}

export interface MergeResult {
  /** A request body the server already understands: `items` / `updates` / `remove_ids`. */
  change: {
    items: Array<Record<string, unknown>>;
    updates: Array<{ id: string; patch: Record<string, unknown> }>;
    remove_ids: string[];
  };
  /** Ids both sides changed. Neither version is sent; a person has to choose. */
  conflicts: string[];
  /** Ids the merge dropped because the item was already exactly what they drew. */
  noop: number;
  /** True when the merged request changes nothing at all. */
  empty: boolean;
}

const byId = (board: MergeBoard): Map<string, Record<string, unknown>> =>
  new Map(board.items.map((item) => [String(item.id), item]));

/**
 * The fields a patch may carry.
 *
 * `id` names the target and `createdAt` is immutable, so neither belongs in a
 * patch. Everything else is sent whole — a partial patch cannot express "this
 * field is gone", which is the same reason `diffBoardItems` sends full items.
 */
function patchOf(item: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, createdAt: _createdAt, ...patch } = item;
  return patch;
}

/** Added items carry no id and no timestamps; the server mints them. */
function inputOf(item: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...input } = item;
  return input;
}

/**
 * Merge the person's edits onto the current board.
 *
 * A board whose id differs from `base` is not merged at all: the person's
 * edits belong to the board they were drawing on, and applying them to another
 * board would be a data migration, not a rebase. The caller treats that as a
 * conflict to resolve by choosing.
 */
export function mergeBoardEdits(base: MergeBoard, mine: MergeBoard, theirs: MergeBoard): MergeResult {
  const change: MergeResult["change"] = { items: [], updates: [], remove_ids: [] };
  const conflicts: string[] = [];
  let noop = 0;

  if (base.id !== theirs.id || mine.id !== theirs.id) {
    return { change, conflicts: ["__board__"], noop, empty: true };
  }

  const baseItems = byId(base);
  const theirsItems = byId(theirs);
  const mineItems = byId(mine);
  const ids = new Set([...baseItems.keys(), ...mineItems.keys(), ...theirsItems.keys()]);

  for (const id of ids) {
    const original = baseItems.get(id);
    const theirsItem = theirsItems.get(id);
    const mineItem = mineItems.get(id);

    const basePrint = original ? stableItemFingerprint(original) : null;
    const theirsPrint = theirsItem ? stableItemFingerprint(theirsItem) : null;
    const minePrint = mineItem ? stableItemFingerprint(mineItem) : null;

    const mineChanged = minePrint !== basePrint;
    const theirsChanged = theirsPrint !== basePrint;

    if (!mineChanged) continue; // Nothing the person did to this object.

    if (!theirsChanged) {
      // Only the person touched it: their version wins, in whatever shape the
      // board needs — an add, an update, or a removal.
      if (!theirsItem && mineItem) {
        // It did not exist before and still does not; it is a new object.
        change.items.push(inputOf(mineItem));
      } else if (theirsItem && !mineItem) {
        change.remove_ids.push(id);
      } else if (mineItem) {
        change.updates.push({ id, patch: patchOf(mineItem) });
      }
      continue;
    }

    // Both sides changed it. Identical results are not a conflict.
    if (minePrint === theirsPrint) {
      noop += 1;
      continue;
    }
    conflicts.push(id);
  }

  const empty = change.items.length === 0 && change.updates.length === 0 && change.remove_ids.length === 0;
  return { change, conflicts, noop, empty };
}
