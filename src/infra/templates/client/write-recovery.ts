/**
 * What the canvas offers when a write is rejected.
 *
 * A conflict is not an error to apologise for; it is a decision only the person
 * can make, because both writers meant their edit. This module owns that
 * decision surface — naming the objects and offering exactly two exits — so the
 * entrypoint does not have to hold UI copy next to its rendering logic.
 *
 * Split from `canvas-sync` (which detects the conflict) because this is about
 * *presenting* the choice, and from the entrypoint because the two exits are a
 * stable contract that deserves its own tests.
 */

import { clearConflictNotice, showConflictNotice, showError } from "./banner.js";
import { BoardWriteError } from "./transport.js";
import type { BoardSnapshot } from "./types.js";
import type { SyncChip } from "./sync-state.js";

export interface WriteRecoveryDeps {
  status: SyncChip;
  /** Re-read the board from whichever surface this canvas is on. */
  loadLatest(): Promise<BoardSnapshot | null>;
  /** Adopt a board that arrived from elsewhere. */
  applyRemote(snapshot: BoardSnapshot): void;
  /** Re-send the rejected change against the newest board. */
  retry(): Promise<unknown>;
}

/** The object ids a rejection named, when it is specifically a conflict. */
export function conflictIdsOf(error: unknown): string[] | null {
  if (!(error instanceof BoardWriteError)) return null;
  if (error.code !== "REVISION_CONFLICT_OBJECTS") return null;
  return error.conflicts ?? [];
}

/** The sentence the notice leads with, naming what actually collided. */
export function conflictMessage(ids: string[]): string {
  if (ids.length === 0) return "有对象在此同时被别处改动，这次改动还没保存。";
  const named = ids.slice(0, 3).join("、");
  const more = ids.length > 3 ? " 等" : "";
  return `有 ${ids.length} 个对象在此同时被别处改动：${named}${more}。这次改动还没保存。`;
}

/**
 * Present the rejection, or report it plainly when it is not a conflict.
 *
 * A non-conflict failure keeps the "local-edit" phase rather than claiming
 * progress: the change did not land, and the next successful write is what will
 * move the chip forward.
 */
export function presentWriteFailure(error: unknown, deps: WriteRecoveryDeps): void {
  const ids = conflictIdsOf(error);
  if (ids === null) {
    deps.status.send("local-edit");
    showError(error);
    return;
  }
  deps.status.send("conflict");
  showConflictNotice(conflictMessage(ids), [
    {
      label: "载入最新",
      tone: "primary",
      run: async () => {
        const latest = await deps.loadLatest().catch(() => null);
        if (latest) deps.applyRemote(latest);
        clearConflictNotice();
        deps.status.send("saved");
      },
    },
    { label: "保留我的", tone: "danger", run: async () => { await deps.retry(); } },
  ]);
}

/**
 * Report a conflict that was found *after* the fact — by offline recovery,
 * not by a rejected write.
 *
 * The two cases differ in what has already happened. A rejected write means
 * nothing was saved, so it offers "reload" and "keep mine". A recovery conflict
 * means the person's version is already kept on disk and simply could not be
 * merged; there is nothing to retry yet, so this states the fact and dismisses.
 * Keeping both here means one module owns every conflict surface.
 */
export function presentRecoveredConflict(conflicts: string[], status: SyncChip, dismiss: () => void): void {
  status.send("conflict");
  showConflictNotice(
    `有 ${conflicts.length} 个对象在离线期间被两边同时改动，已保留你的版本待你决定。`,
    [{ label: "知道了", tone: "primary", run: async () => { dismiss(); } }],
  );
}
