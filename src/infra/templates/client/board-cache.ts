/**
 * A local copy of the board, so the canvas has something to draw when the
 * session that hosted it is gone.
 *
 * The board file is the authority, but it lives behind a process: the panel
 * page and its HTTP server are owned by whichever MCP session started them, and
 * when that session ends the page is unreachable — not empty, *gone*. That is
 * the failure a person experiences as "我的画板没了", even though
 * `board.json` never changed. A local-first tool cannot make its only view
 * depend on a process staying alive.
 *
 * So each successful read/write drops the final snapshot into IndexedDB. On
 * boot the cache is painted first and the network is asked second; a newer
 * remote revision still wins. The cache is a *copy*, never a second source of
 * truth: nothing is written to it that did not come back from the board.
 *
 * IndexedDB rather than localStorage because a full-fidelity board is easily
 * megabytes (embedded image bytes), and localStorage caps out at ~5 MB and is
 * synchronous. The API is wrapped so the canvas can run this in Node tests with
 * an injected in-memory store.
 */

import type { BoardSnapshot } from "./types.js";

const DB_NAME = "doodle-board-cache";
const DB_VERSION = 1;
const STORE = "snapshots";
/** Boards are the unit; one row each, keyed by board id. */
const META_KEY = "__meta__";

/** The narrow storage surface this needs, so Node can supply a fake. */
export interface CacheStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface BoardCacheMeta {
  /** The board a boot should restore before it knows anything else. */
  activeId: string | null;
  savedAt: string;
}

export interface BoardCache {
  /** The last snapshot for a board, or null when this browser has never seen it. */
  read(boardId: string): Promise<BoardSnapshot | null>;
  /** The board most recently written through this client, any board. */
  readActive(): Promise<BoardSnapshot | null>;
  /** Remember a snapshot. Ignores anything that is not a well-formed board. */
  write(snapshot: BoardSnapshot): Promise<void>;
  /** Forget one board (deleted in the library). */
  forget(boardId: string): Promise<void>;
  /** Every board id this browser holds a copy of. */
  boardIds(): Promise<string[]>;
}

function isSnapshot(value: unknown): value is BoardSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { id?: unknown; revision?: unknown; items?: unknown };
  return typeof candidate.id === "string"
    && typeof candidate.revision === "number"
    && Array.isArray(candidate.items);
}

/**
 * The cache logic, independent of where bytes live.
 *
 * Kept separate from IndexedDB so the policy — what counts as a restorable
 * snapshot, and which board "active" means — is testable without a browser.
 */
export function createBoardCache(store: CacheStore): BoardCache {
  return {
    async read(boardId) {
      const value = await store.get(boardId);
      return isSnapshot(value) ? value : null;
    },
    async readActive() {
      const meta = await store.get(META_KEY) as BoardCacheMeta | undefined;
      if (!meta?.activeId) return null;
      const value = await store.get(meta.activeId);
      return isSnapshot(value) ? value : null;
    },
    async write(snapshot) {
      if (!isSnapshot(snapshot)) return;
      await store.put(snapshot.id, snapshot);
      const meta: BoardCacheMeta = { activeId: snapshot.id, savedAt: new Date().toISOString() };
      await store.put(META_KEY, meta);
    },
    async forget(boardId) {
      await store.delete(boardId);
      const meta = await store.get(META_KEY) as BoardCacheMeta | undefined;
      if (meta?.activeId === boardId) await store.put(META_KEY, { activeId: null, savedAt: meta.savedAt });
    },
    async boardIds() {
      const keys = await store.keys();
      return keys.filter((key) => key !== META_KEY);
    },
  };
}

/** In-memory store: the Node test double, and the fallback when IndexedDB is denied. */
export function memoryCacheStore(): CacheStore {
  const rows = new Map<string, unknown>();
  return {
    async get(key) { return rows.get(key); },
    async put(key, value) { rows.set(key, value); },
    async delete(key) { rows.delete(key); },
    async keys() { return [...rows.keys()]; },
  };
}

/** An IndexedDB-backed store. `null` when this browser will not give us one. */
export function indexedDbCacheStore(factory: IDBFactory | undefined = globalThis.indexedDB): CacheStore | null {
  if (!factory) return null;
  let opening: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    if (opening) return opening;
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    });
    return opening;
  };

  /**
   * One transaction per call, resolved on `complete` rather than on the request.
   *
   * A request's `onsuccess` fires before the transaction commits, so resolving
   * there would let a reload land between "we said saved" and "it was saved" —
   * exactly the window this cache exists to survive.
   */
  const run = <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<T> =>
    open().then((db) => new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      let value: T;
      request.onsuccess = () => { value = request.result as T; };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    }));

  return {
    get: (key) => run<unknown>("readonly", (store) => store.get(key)),
    // `put`/`delete` resolve with a key we never read; the write is only
    // observable through the transaction completing.
    put: (key, value) => run<unknown>("readwrite", (store) => store.put(value, key)).then(() => undefined),
    delete: (key) => run<unknown>("readwrite", (store) => store.delete(key)).then(() => undefined),
    keys: () => run<IDBValidKey[]>("readonly", (store) => store.getAllKeys())
      .then((keys) => keys.map(String)),
  };
}

/** The cache for this browser, or an in-memory one when storage is unavailable (private mode, blocked). */
export function browserBoardCache(): BoardCache {
  const store = indexedDbCacheStore();
  return createBoardCache(store ?? memoryCacheStore());
}
