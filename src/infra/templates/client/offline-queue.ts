/**
 * Changes a person made while the board was unreachable, kept until they can
 * be sent.
 *
 * Today a disconnected canvas says "重连前的新改动不会保存" and means it: the
 * debounced write fails, `retryFrame` holds only the *last* one, and a reload
 * loses everything. Telling someone their work is gone is honest but it is not
 * a product. The board is a local file; being unable to reach it for thirty
 * seconds should not cost a drawing.
 *
 * What is queued is the *projected board*, not the gesture: the queue is
 * already the result of `project()`, so replaying it is one `syncBoard` against
 * the revision it was based on, and the existing conflict path decides whether
 * it still applies. Nothing here invents merge semantics.
 *
 * Only the newest frame per board is kept. Two queued writes for one board are
 * always superseded by the later one — replaying both would apply an
 * intermediate state nobody asked to see.
 */

export interface QueuedChange {
  boardId: string;
  /** The revision this change was projected against. */
  baseRevision: number;
  items: unknown[];
  queuedAt: string;
  /** Failed attempts so far, used to back off and to cap a hopeless change. */
  attempts: number;
}

export interface OfflineQueueStorage {
  get(): Promise<unknown>;
  put(value: unknown): Promise<void>;
}

export interface OfflineQueue {
  /** Remember the newest unsent change for a board, replacing any earlier one. */
  enqueue(change: Omit<QueuedChange, "queuedAt" | "attempts">): Promise<void>;
  /** Everything waiting, newest board first. */
  list(): Promise<QueuedChange[]>;
  /** Drop one board's pending change (sent, or abandoned by the person). */
  drop(boardId: string): Promise<void>;
  clear(): Promise<void>;
  isEmpty(): Promise<boolean>;
}

function isQueued(value: unknown): value is QueuedChange {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<QueuedChange>;
  return typeof candidate.boardId === "string"
    && typeof candidate.baseRevision === "number"
    && Array.isArray(candidate.items);
}

export function createOfflineQueue(storage: OfflineQueueStorage): OfflineQueue {
  const read = async (): Promise<QueuedChange[]> => {
    const raw = await storage.get();
    return Array.isArray(raw) ? raw.filter(isQueued) : [];
  };
  const write = (changes: QueuedChange[]) => storage.put(changes);

  return {
    async enqueue(change) {
      const existing = await read();
      const next: QueuedChange = {
        ...change,
        queuedAt: new Date().toISOString(),
        attempts: existing.find((item) => item.boardId === change.boardId)?.attempts ?? 0,
      };
      await write([next, ...existing.filter((item) => item.boardId !== change.boardId)]);
    },
    async list() {
      return read();
    },
    async drop(boardId) {
      await write((await read()).filter((item) => item.boardId !== boardId));
    },
    async clear() {
      await write([]);
    },
    async isEmpty() {
      return (await read()).length === 0;
    },
  };
}

/** localStorage-backed: small, synchronous, and survives a reload. */
export function localOfflineQueue(key = "doodle.offlineQueue.v1"): OfflineQueueStorage {
  return {
    async get() {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    },
    async put(value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Quota or private mode: the queue degrades to in-memory for this load.
        memory.set(key, value);
      }
    },
  };
}

const memory = new Map<string, unknown>();

/**
 * Replay a queued change.
 *
 * Returns what happened so the caller can decide the next state: `sent` clears
 * it, `stale` means the board moved on and the change has to be re-projected
 * rather than force-written, and `retry` keeps it with one more attempt.
 */
export type ReplayOutcome = "sent" | "stale" | "retry";

/**
 * Decide what replaying a queued change means right now.
 *
 * Pure, and deliberately conservative: a board whose revision moved is *not*
 * overwritten. Sending a queued projection on top of a newer board would undo
 * whatever happened during the outage, and this queue exists to protect work,
 * not to win races.
 */
export function replayDecision(change: QueuedChange, current: { id: string; revision: number } | null): ReplayOutcome {
  if (!current || current.id !== change.boardId) return "stale";
  if (current.revision === change.baseRevision) return "sent";
  return "stale";
}
