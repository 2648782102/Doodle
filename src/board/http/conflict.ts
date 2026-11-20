/**
 * Object-level conflict resolution for board writes.
 *
 * The board revision is board-wide, so a person nudging one object and an agent
 * drawing somewhere else used to reject each other even though nothing
 * overlapped. These helpers answer the only question that matters: does this
 * request touch anything that moved since the revision its author saw?
 */
import type { SimpleBoard } from "../types.js";
import { changedIds } from "../item-diff.js";

/**
 * Ids a request targets.
 *
 * Added items carry no id (the server mints one), so they cannot collide with
 * anything; only updates and removals name objects that already exist.
 */
export function touchedIdsOf(body: unknown, base?: SimpleBoard): Set<string> {
  const ids = new Set<string>();
  const record = body as {
    id?: unknown;
    updates?: Array<{ id?: unknown }>;
    remove_ids?: unknown;
    layout?: { ids?: unknown };
  } | undefined;
  if (typeof record?.id === "string") ids.add(record.id);
  for (const update of record?.updates ?? []) {
    if (typeof update?.id === "string") ids.add(update.id);
  }
  if (Array.isArray(record?.remove_ids)) {
    for (const id of record.remove_ids) if (typeof id === "string") ids.add(id);
  }
  if (record?.layout && typeof record.layout === "object") {
    if (Array.isArray(record.layout.ids) && record.layout.ids.length > 0) {
      for (const id of record.layout.ids) if (typeof id === "string") ids.add(id);
    } else if (base) {
      for (const item of base.items) {
        if (item.type !== "line" && item.type !== "stroke") ids.add(item.id);
      }
    }
  }
  return ids;
}

export interface ConflictReport {
  touched: Set<string>;
  /** Ids this request touches that also changed after the base revision. */
  conflicts: string[];
}

export function reportConflicts(base: SimpleBoard, current: SimpleBoard, body: unknown): ConflictReport {
  const touched = touchedIdsOf(body, base);
  if (touched.size === 0) return { touched, conflicts: [] };
  const changed = changedIds(base.items, current.items);
  return { touched, conflicts: [...touched].filter((id) => changed.has(id)) };
}

/** The 409 body. Naming the objects is the whole point: a retry needs to know what to re-apply. */
export function conflictPayload(baseRevision: number, currentRevision: number, conflicts: string[]): Record<string, unknown> {
  const named = conflicts.slice(0, 10);
  return {
    error: `Revision ${baseRevision} is behind ${currentRevision}, and this change touches objects that moved meanwhile: ${named.join(", ")}`,
    code: "REVISION_CONFLICT_OBJECTS",
    conflicts: named,
    expectedRevision: currentRevision,
    fix: "Re-read the board, re-apply your change to those specific objects, and send it again. Objects you did not touch need not be re-sent.",
  };
}
