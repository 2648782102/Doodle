/**
 * The canvas' write path: debounce a human gesture, then write *what they did*
 * against whatever board exists when the write lands.
 *
 * Two shipped behaviours this replaces:
 *
 * `0.8.0` read `activeSnapshot` when the timer fired and, if a remote write had
 * arrived in the 450 ms window, `return`ed — silently. The person watched their
 * own drag disappear from a board that still looked saved. A write is not
 * invalid just because someone else landed first.
 *
 * The naive fix (write the stale projection anyway) resurrects objects the agent
 * deleted in the meantime, because the local scene still contains them. So a
 * rebase compares the scene's *provenance* board with the newest one and drops
 * exactly the elements that disappeared, keeping everything else the person did.
 *
 * Pure of DOM and timers: the caller injects both, so Node can drive it.
 */

import type { BoardSnapshot } from "./types.js";
import type { SyncEvent } from "./sync-state.js";
import { stableStringify } from "../../../board/model/fingerprint.js";

/** The parts of an Excalidraw element this module reads. */
export type SceneElement = { id: string; containerId?: string | null };

export interface CanvasWriteTransport {
  syncBoard(next: unknown[], base: BoardSnapshot): Promise<BoardSnapshot>;
}

interface SceneFrame {
  elements: SceneElement[];
  files: Record<string, unknown>;
  /** The board the caller's scene was projected from, not the newest board. */
  base: BoardSnapshot;
}

export interface CanvasSyncDeps {
  transport: CanvasWriteTransport;
  /** The newest board this client knows about; the write target. */
  getSnapshot(): BoardSnapshot | null;
  /** The board the live scene was painted from; the rebase reference. */
  getSceneBase(): BoardSnapshot | null;
  project(base: BoardSnapshot, elements: SceneElement[], files: Record<string, unknown>): BoardSnapshot;
  applySaved(snapshot: BoardSnapshot, info: { rebased: boolean; dropped: number }): void;
  report(event: SyncEvent): void;
  onError(error: unknown, retry: () => Promise<CanvasSyncOutcome>): void;
  debounceMs?: number;
  setTimer?(run: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export type CanvasSyncOutcome = "idle" | "unchanged" | "saved" | "failed";

export interface CanvasSync {
  /** Record the scene the person just finished editing. */
  schedule(elements: SceneElement[], files: Record<string, unknown>): void;
  /** Write now, cancelling the pending timer. */
  flush(): Promise<CanvasSyncOutcome>;
  /** True while a debounced write is still waiting. */
  hasPending(): boolean;
  /** Drop the pending write, e.g. when the board is about to be replaced. */
  cancel(): void;
}

const DEFAULT_DEBOUNCE_MS = 450;

/** Scene ids a snapshot can be addressed by, including legacy id-equals-id boards. */
function sceneIdsOf(snapshot: BoardSnapshot): Set<string> {
  const ids = new Set<string>();
  for (const raw of snapshot.items) {
    const item = raw as { id?: unknown; scene?: { element?: { id?: unknown } } };
    if (typeof item.id === "string") ids.add(item.id);
    const sceneId = item.scene?.element?.id;
    if (typeof sceneId === "string") ids.add(sceneId);
  }
  return ids;
}

/**
 * Keep the person's new elements, drop the ones a concurrent write deleted.
 *
 * Without this, re-basing a stale scene against a newer board re-projects the
 * agent's deletion as an addition: the object the person removed from their
 * board came back on the next save. Anything the person created themselves is
 * never in `scheduledBase`, so it always survives.
 */
export function rebaseScene(
  elements: SceneElement[],
  scheduledBase: BoardSnapshot,
  latest: BoardSnapshot,
): { elements: SceneElement[]; dropped: number } {
  const known = sceneIdsOf(scheduledBase);
  const alive = sceneIdsOf(latest);
  const kept = elements.filter((element) => !(known.has(element.id) && !alive.has(element.id)));
  return { elements: kept, dropped: elements.length - kept.length };
}

function sameItems(left: unknown[], right: unknown[]): boolean {
  /*
   * Key order is not a change.
   *
   * `project` rebuilds every item, so its key order differs from the board
   * that came back through JSON even when every value matches. Comparing the
   * raw strings reported that as an edit, which is what made a pan — a gesture
   * that touches no board object — schedule a whole-board write. Values are
   * what the caller means.
   */
  return stableStringify(left) === stableStringify(right);
}

export function createCanvasSync(deps: CanvasSyncDeps): CanvasSync {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const setTimer = deps.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as never));
  let timer: unknown = null;
  let pendingFrame: SceneFrame | null = null;
  /** The frame whose write was rejected, kept so a retry needs no new gesture. */
  let retryFrame: SceneFrame | null = null;

  const cancelTimer = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  const attempt = async (frame: SceneFrame, latest: BoardSnapshot): Promise<CanvasSyncOutcome> => {
    const rebased = frame.base.revision !== latest.revision;
    const { elements, dropped } = rebaseScene(frame.elements, frame.base, latest);
    const projected = deps.project(latest, elements, frame.files);
    if (sameItems(projected.items, latest.items)) {
      retryFrame = null;
      deps.report("saved");
      return "unchanged";
    }
    deps.report("saving");
    try {
      const updated = await deps.transport.syncBoard(projected.items, latest);
      retryFrame = null;
      deps.applySaved(updated, { rebased, dropped });
      deps.report("saved");
      return "saved";
    } catch (error) {
      /*
       * Keep the *rebased* frame: retrying it drops anything deleted since, so
       * "keep mine" cannot bring a deleted object back to life.
       */
      retryFrame = { elements, files: frame.files, base: latest };
      deps.onError(error, () => retry());
      return "failed";
    }
  };

  const flush = async (): Promise<CanvasSyncOutcome> => {
    cancelTimer();
    const frame = pendingFrame;
    pendingFrame = null;
    if (!frame) return "idle";
    const latest = deps.getSnapshot();
    if (!latest) return "idle";
    return attempt(frame, latest);
  };

  /** Re-send a rejected change against the newest board, on the person's word. */
  const retry = async (): Promise<CanvasSyncOutcome> => {
    const frame = retryFrame;
    if (!frame) return "idle";
    const latest = deps.getSnapshot();
    if (!latest) return "idle";
    return attempt(frame, latest);
  };

  return {
    schedule(elements, files) {
      const base = deps.getSceneBase() ?? deps.getSnapshot();
      if (!base) return;
      pendingFrame = { elements, files, base };
      deps.report("local-edit");
      cancelTimer();
      timer = setTimer(() => {
        timer = null;
        void flush();
      }, debounceMs);
    },
    flush,
    hasPending: () => pendingFrame !== null,
    cancel() {
      cancelTimer();
      pendingFrame = null;
    },
  };
}
