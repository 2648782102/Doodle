/**
 * Object-level diff between the board a person has and the board their canvas
 * now projects.
 *
 * The write path used to send the whole board on every change. A diff turns a
 * one-object edit into one object's worth of bytes, and — with the server able
 * to merge disjoint ids — lets a person and an agent edit different objects
 * without either being rejected.
 *
 * Pure: no I/O, no clock, no ids minted here.
 */
import type { BoardItem, BoardItemInput } from "./model/types.js";
import { stableItemFingerprint } from "./model/fingerprint.js";

/*
 * Change detection compares values, not key order.
 *
 * The keys of a board object depend on who built it — the canvas projection,
 * `parseBoard`, or a patch spread over a stored item — so a plain
 * `JSON.stringify` reports identical objects as different. See
 * `model/fingerprint.ts` for the failure that produced.
 */
export { stableStringify } from "./model/fingerprint.js";

export interface BoardItemsDiff {
  added: BoardItemInput[];
  updated: Array<{ id: string; patch: Partial<BoardItemInput> }>;
  removed: string[];
}

function comparable(item: BoardItem): string {
  return stableItemFingerprint(item);
}

export function diffBoardItems(previous: BoardItem[], next: BoardItem[]): BoardItemsDiff {
  const before = new Map(previous.map((item) => [item.id, item]));
  const after = new Set(next.map((item) => item.id));
  const added: BoardItemInput[] = [];
  const updated: Array<{ id: string; patch: Partial<BoardItemInput> }> = [];

  for (const item of next) {
    const old = before.get(item.id);
    if (!old) {
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...input } = item;
      added.push(input as BoardItemInput);
      continue;
    }
    if (comparable(old) === comparable(item)) continue;
    /*
     * Send the whole item as the patch, not a computed field delta. A partial
     * patch cannot express "this field is gone", so a removed label or a dropped
     * connector binding would silently survive the merge. `createdAt` is
     * immutable and `id` identifies the target, so neither belongs in a patch.
     */
    const { id: _id, createdAt: _createdAt, ...patch } = item;
    updated.push({ id: item.id, patch: patch as Partial<BoardItemInput> });
  }

  const removed = previous.filter((item) => !after.has(item.id)).map((item) => item.id);
  return { added, updated, removed };
}

export function isEmptyDiff(diff: BoardItemsDiff): boolean {
  return diff.added.length === 0 && diff.updated.length === 0 && diff.removed.length === 0;
}

/** Ids a diff will touch, for conflict checks that only care about overlap. */
export function touchedIds(diff: BoardItemsDiff): Set<string> {
  return new Set([
    ...diff.updated.map((entry) => entry.id),
    ...diff.removed,
  ]);
}

/**
 * Ids that differ between two boards, used to detect a concurrent edit.
 *
 * Computed directly rather than through `diffBoardItems`: that diff drops the id
 * of an added item (`addBoardItems` mints one), and here both sides are already
 * persisted boards where the id is known and matters.
 */
export function changedIds(before: BoardItem[], after: BoardItem[]): Set<string> {
  const previous = new Map(before.map((item) => [item.id, item]));
  const next = new Map(after.map((item) => [item.id, item]));
  const ids = new Set<string>();
  for (const [id, item] of next) {
    const old = previous.get(id);
    if (!old || comparable(old) !== comparable(item)) ids.add(id);
  }
  for (const id of previous.keys()) {
    if (!next.has(id)) ids.add(id);
  }
  return ids;
}
