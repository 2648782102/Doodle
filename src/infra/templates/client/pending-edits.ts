/**
 * The person's unsent edits, kept across a reload.
 *
 * What is stored is the *base* board and the *edited* board, not a ready-made
 * request. That is the whole point, and it is what the previous, deleted
 * attempt got wrong: it queued a projection and then could only replay it
 * verbatim, which is unsafe the moment anyone else touched the board.
 *
 * Keeping both boards means a reconnect can run a real three-way merge
 * (`three-way-merge.ts`) against whatever the board is *then*, so edits made
 * during an outage survive even when someone else drew in the meantime.
 *
 * One entry per board: a later edit supersedes an earlier one, because both
 * are expressed relative to a base and replaying an intermediate state would
 * show a board nobody asked to see.
 */

export interface PendingEdit {
  boardId: string;
  /** The revision the person was editing from. Used only for diagnostics. */
  baseRevision: number;
  base: { id: string; revision: number; items: Array<Record<string, unknown>> };
  mine: { id: string; revision: number; items: Array<Record<string, unknown>> };
  queuedAt: string;
}

export interface PendingStorage {
  read(): Promise<unknown>;
  write(value: unknown): Promise<void>;
}

export interface PendingEdits {
  /** Record the newest unsent edit for a board. */
  save(edit: Omit<PendingEdit, "queuedAt">): Promise<void>;
  all(): Promise<PendingEdit[]>;
  get(boardId: string): Promise<PendingEdit | null>;
  drop(boardId: string): Promise<void>;
  clear(): Promise<void>;
}

const MAX_ITEMS_PER_BOARD = 400;

function isPending(value: unknown): value is PendingEdit {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingEdit>;
  const okBoard = (board: unknown): boolean => {
    const record = board as { id?: unknown; items?: unknown } | undefined;
    return Boolean(record) && typeof record!.id === "string" && Array.isArray(record!.items);
  };
  return typeof candidate.boardId === "string"
    && typeof candidate.baseRevision === "number"
    && okBoard(candidate.base)
    && okBoard(candidate.mine);
}

/**
 * A board is not worth persisting past the item ceiling.
 *
 * Offline storage is a few megabytes; a board at the 400-object cap with
 * embedded image bytes can exceed it. Refusing the write keeps the failure
 * visible (`save` reports it) instead of leaving a truncated board to be
 * merged later, which would look like the person deleted things.
 */
const withinLimits = (edit: PendingEdit): boolean =>
  edit.base.items.length <= MAX_ITEMS_PER_BOARD && edit.mine.items.length <= MAX_ITEMS_PER_BOARD;

export function createPendingEdits(storage: PendingStorage): PendingEdits {
  const read = async (): Promise<PendingEdit[]> => {
    const raw = await storage.read();
    return Array.isArray(raw) ? raw.filter(isPending) : [];
  };
  const write = (edits: PendingEdit[]) => storage.write(edits);

  return {
    async save(edit) {
      const next: PendingEdit = { ...edit, queuedAt: new Date().toISOString() };
      if (!withinLimits(next)) return;
      const existing = await read();
      await write([next, ...existing.filter((entry) => entry.boardId !== edit.boardId)]);
    },
    all: read,
    async get(boardId) {
      return (await read()).find((entry) => entry.boardId === boardId) ?? null;
    },
    async drop(boardId) {
      await write((await read()).filter((entry) => entry.boardId !== boardId));
    },
    async clear() {
      await write([]);
    },
  };
}

/**
 * Build the record from the two boards a failed write already holds.
 *
 * The projection is mechanical and easy to get subtly wrong at the call site
 * (a missing `revision`, a `readonly` item array), so it lives here once.
 */
export function pendingEditOf(
  base: { id: string; revision: number; items: unknown[] },
  mine: { id: string; revision: number; items: unknown[] },
): Omit<PendingEdit, "queuedAt"> | null {
  if (base.id !== mine.id) return null;
  const asItems = (items: unknown[]) => items as Array<Record<string, unknown>>;
  return {
    boardId: base.id,
    baseRevision: base.revision,
    base: { id: base.id, revision: base.revision, items: asItems(base.items) },
    mine: { id: mine.id, revision: mine.revision, items: asItems(mine.items) },
  };
}

/** localStorage: small, synchronous, survives a reload and a browser restart. */
export function localPendingStorage(key = "doodle.pendingEdits.v2"): PendingStorage {
  return {
    async read() {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    },
    async write(value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Quota or private mode. The in-memory copy still serves this load.
      }
    },
  };
}
