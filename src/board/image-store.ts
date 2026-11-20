/**
 * Image externalisation for Board v1.
 *
 * The model, MCP tools and Excalidraw adapters always see full `data:` URLs —
 * only the on-disk form is split: image bytes live in `.doodle/images/`, and
 * the board JSON keeps a short `doodle-image:<file>` reference. Boards with
 * inline data URLs (the pre-migration format) stay readable and are migrated
 * on their next write.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { logger } from "../infra/logger.js";
import { renameWithRetry } from "../infra/atomic-write.js";
import type { SimpleBoard } from "./types.js";

const REF_PREFIX = "doodle-image:";
const HASH_LENGTH = 24;
const DEFAULT_STALE_TMP_MS = 60_000;

const EXT_BY_MIME: Record<string, string> = {
  png: "png", jpeg: "jpg", jpg: "jpg", gif: "gif", webp: "webp",
  bmp: "bmp", avif: "avif", "svg+xml": "svg",
};
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  svg: "image/svg+xml",
};
const VALID_EXT = [...new Set(Object.values(EXT_BY_MIME))];
const FILE_NAME = new RegExp(`^[0-9a-f]{${HASH_LENGTH}}\\.(?:${VALID_EXT.join("|")})$`);

const DATA_URL = /^data:image\/(png|jpeg|jpg|gif|webp|bmp|avif|svg\+xml);base64,([A-Za-z0-9+/=]+)$/;

export function isImageRef(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(REF_PREFIX);
}

function parseDataUrl(src: unknown): { ext: string; base64: string } | undefined {
  if (typeof src !== "string") return undefined;
  const match = DATA_URL.exec(src);
  return match ? { ext: EXT_BY_MIME[match[1]], base64: match[2] } : undefined;
}

/**
 * Content-addressed file name, cached by a fixed-size fingerprint.
 *
 * Hashing the whole data URL on every write would make each stroke
 * O(total image bytes) even when no image changed. A cache hit avoids that;
 * a miss still hashes the full source once. Collisions would require identical
 * length *and* identical head/middle/tail samples, which is negligible for
 * locally generated board images.
 */
const REF_CACHE = new Map<string, string>();
const REF_CACHE_LIMIT = 2048;

function fingerprint(src: string): string {
  const middle = Math.floor(src.length / 2);
  return `${src.length}:${src.slice(0, 80)}:${src.slice(middle, middle + 80)}:${src.slice(-80)}`;
}

function referenceFor(src: string): string {
  const { ext } = parseDataUrl(src)!;
  const key = fingerprint(src);
  let name = REF_CACHE.get(key);
  if (!name) {
    name = `${crypto.createHash("sha256").update(src).digest("hex").slice(0, HASH_LENGTH)}.${ext}`;
    if (REF_CACHE.size >= REF_CACHE_LIMIT) REF_CACHE.clear();
    REF_CACHE.set(key, name);
  }
  return name;
}

function fileNameOf(ref: string): string | undefined {
  const name = ref.slice(REF_PREFIX.length);
  return FILE_NAME.test(name) ? name : undefined;
}

/**
 * Return a board safe to serialise: every image data URL is written to
 * `imagesDir` (content-addressed, so duplicates share one file) and replaced by
 * a short reference. The input board is never mutated and still holds the full
 * data URLs for the caller.
 */
export async function externalizeImages(board: SimpleBoard, imagesDir: string): Promise<SimpleBoard> {
  const refs = new Map<string, string>();
  for (const item of board.items) {
    if (item.type !== "image" || !parseDataUrl(item.src)) continue;
    refs.set(item.src!, referenceFor(item.src!));
  }
  if (refs.size === 0) return board;

  await fs.mkdir(imagesDir, { recursive: true });
  await Promise.all([...refs].map(async ([src, name]) => {
    const target = path.join(imagesDir, name);
    try {
      await fs.access(target);
      return;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    const { base64 } = parseDataUrl(src)!;
    const temp = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
      await fs.writeFile(temp, Buffer.from(base64, "base64"));
      await renameWithRetry(temp, target);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }));

  return {
    ...board,
    items: board.items.map((item) => {
      const name = item.type === "image" ? refs.get(item.src ?? "") : undefined;
      return name ? { ...item, src: `${REF_PREFIX}${name}` } : item;
    }),
  };
}

/**
 * Inverse of `externalizeImages`: restore references to data URLs before the
 * board reaches `parseBoard`. A missing or malformed image file drops only its
 * own item instead of bricking the whole board.
 */
export async function hydrateImages(raw: unknown, imagesDir: string): Promise<unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const board = raw as Record<string, unknown>;
  if (!Array.isArray(board.items)) return raw;

  const items: unknown[] = [];
  for (const item of board.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      items.push(item);
      continue;
    }
    const record = item as Record<string, unknown>;
    if (!isImageRef(record.src)) {
      items.push(item);
      continue;
    }
    const name = fileNameOf(record.src);
    if (!name) {
      logger.warn(`Invalid image reference (${record.src}); dropped from board.`);
      continue;
    }
    try {
      const bytes = await fs.readFile(path.join(imagesDir, name));
      const mime = MIME_BY_EXT[name.slice(name.lastIndexOf(".") + 1)];
      items.push({ ...record, src: `data:${mime};base64,${bytes.toString("base64")}` });
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      logger.warn(`Image file missing (${name}); dropped from board.`);
    }
  }
  return { ...board, items };
}

/** Names of the external files referenced by a board (live data URLs or on-disk refs). */
export function imageRefsOf(board: SimpleBoard): string[] {
  const names: string[] = [];
  for (const item of board.items) {
    if (item.type !== "image") continue;
    if (isImageRef(item.src)) {
      const name = fileNameOf(item.src);
      if (name) names.push(name);
    } else if (parseDataUrl(item.src)) {
      names.push(referenceFor(item.src!));
    }
  }
  return names;
}

/** Collect references from library snapshots (`.doodle/boards/*.json`). */
export async function collectRefsFromBoards(boardsDir: string): Promise<Set<string>> {
  const refs = new Set<string>();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(boardsDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) return refs;
    throw error;
  }
  const snapshots = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "index.json",
  );
  await Promise.all(snapshots.map(async (entry) => {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(boardsDir, entry.name), "utf8")) as {
        items?: unknown[];
      };
      for (const item of raw.items ?? []) {
        if (!item || typeof item !== "object") continue;
        const src = (item as Record<string, unknown>).src;
        if (!isImageRef(src)) continue;
        const name = fileNameOf(src);
        if (name) refs.add(name);
      }
    } catch {
      // A damaged snapshot must not block startup; its own reader reports it.
    }
  }));
  return refs;
}

/**
 * Delete image files no longer referenced by any board. Called once at startup
 * so writes stay write-only: a deleted image leaves its file until the next
 * launch, which is a safe trade for never racing a concurrent snapshot save.
 */
export async function pruneOrphanImages(
  imagesDir: string,
  referenced: Set<string>,
  options: { staleTmpMs?: number } = {},
): Promise<number> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(imagesDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) return 0;
    throw error;
  }
  const staleTmpMs = options.staleTmpMs ?? DEFAULT_STALE_TMP_MS;
  let removed = 0;
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) return;
    const target = path.join(imagesDir, entry.name);
    if (FILE_NAME.test(entry.name) && !referenced.has(entry.name)) {
      await fs.unlink(target).catch((error) => { if (!isMissingFile(error)) throw error; });
      removed += 1;
      return;
    }
    if (entry.name.includes(".tmp-")) {
      try {
        const stats = await fs.stat(target);
        if (staleTmpMs > 0 && Date.now() - stats.mtimeMs < staleTmpMs) return;
        await fs.unlink(target);
        removed += 1;
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }
  }));
  return removed;
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
