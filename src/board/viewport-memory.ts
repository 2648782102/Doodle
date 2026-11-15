/**
 * Remember where a person was looking on each board.
 *
 * A board you have to re-find is not the board beside you. This stores only the
 * camera (scroll and zoom) per board in browser storage: never board state,
 * never permissions. Bad or hostile values are dropped rather than applied,
 * because a broken camera would make the canvas look empty.
 */

export interface StoredViewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

/** The narrow slice of Web Storage this needs; injectable for tests. */
export interface ViewportStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

const KEY_PREFIX = "doodle-viewport:";
const MAX_ENTRIES = 8;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const MAX_COORDINATE = 1_000_000;

function storageKey(boardId: string): string {
  return `${KEY_PREFIX}${boardId}`;
}

function isFiniteWithin(value: unknown, limit: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}

function usable(value: unknown): value is StoredViewport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredViewport>;
  return isFiniteWithin(candidate.scrollX, MAX_COORDINATE)
    && isFiniteWithin(candidate.scrollY, MAX_COORDINATE)
    && typeof candidate.zoom === "number"
    && Number.isFinite(candidate.zoom)
    && candidate.zoom >= MIN_ZOOM
    && candidate.zoom <= MAX_ZOOM;
}

/** Keep the most recent boards without needing a separate index key. */
function pruneOldest(storage: ViewportStorage, keep: string): void {
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
  } catch {
    return;
  }
  const excess = keys.length - MAX_ENTRIES;
  for (const key of keys.filter((candidate) => candidate !== keep).slice(0, Math.max(0, excess))) {
    try {
      storage.removeItem(key);
    } catch {}
  }
}

export function readStoredViewport(
  storage: ViewportStorage,
  boardId: string,
): StoredViewport | undefined {
  try {
    const raw = storage.getItem(storageKey(boardId));
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return usable(parsed) ? { scrollX: parsed.scrollX, scrollY: parsed.scrollY, zoom: parsed.zoom } : undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredViewport(
  storage: ViewportStorage,
  boardId: string,
  viewport: StoredViewport,
): void {
  try {
    if (!usable(viewport)) {
      storage.removeItem(storageKey(boardId));
      return;
    }
    storage.setItem(storageKey(boardId), JSON.stringify({
      scrollX: Math.round(viewport.scrollX),
      scrollY: Math.round(viewport.scrollY),
      zoom: Number(viewport.zoom.toFixed(3)),
    }));
    pruneOldest(storage, storageKey(boardId));
  } catch {}
}

/**
 * Whether a remembered camera is worth restoring.
 *
 * People do pan into empty space, but restoring a camera that is far from
 * everything makes a full board look blank. A remembered view is only used when
 * it is plausibly looking at the content, judged by the board's own bounds with
 * a generous margin for intentional whitespace.
 */
export function isViewportNearContent(
  viewport: StoredViewport,
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | undefined,
): boolean {
  if (!bounds) return true;
  const margin = 1200;
  const visibleX = -viewport.scrollX / viewport.zoom;
  const visibleY = -viewport.scrollY / viewport.zoom;
  return visibleX >= bounds.minX - margin
    && visibleX <= bounds.maxX + margin
    && visibleY >= bounds.minY - margin
    && visibleY <= bounds.maxY + margin;
}

/** Browser storage, or undefined when it is unavailable or blocked. */
export function browserViewportStorage(): ViewportStorage | undefined {
  try {
    const probe = "__doodle_viewport_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return undefined;
  }
}
