/**
 * Static delivery for the Excalidraw bundle.
 *
 * Kept apart from the route table in `http.ts` for two reasons: the route file
 * is near its line budget, and this is the only place that decides how a build
 * artifact may be cached.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type express from "express";
import type { AppConfig } from "../../infra/config.js";
import { assetCandidates, findExisting } from "./templates.js";
import { assetContentType, isPathWithinRoot } from "./security.js";

/**
 * A build emits `chunk-RLQ6AMSO.js` and `Excalifont-Regular-be310b9b….woff2`:
 * the digest is in the file name, so the URL changes when the bytes do and a
 * long immutable cache is safe. Excalidraw's own `index.css` and the locale
 * chunks are not hashed, so they revalidate.
 */
const HASHED_ASSET = /-[0-9A-Za-z]{8,}\.(?:js|mjs|css|woff2)$/;

export function cacheControlFor(relative: string): string {
  if (HASHED_ASSET.test(relative)) return "public, max-age=31536000, immutable";
  return "no-cache";
}

/**
 * Serve one file from the Excalidraw asset root.
 *
 * Every file used to be `no-store`, including the 1.4 MB app bundle and the
 * 1.8 MB engine chunk, so each page load and canvas reload re-downloaded the
 * whole client. Revalidation now answers a 304 instead, and content-hashed
 * files are cached outright.
 */
export async function serveAsset(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction,
  config: AppConfig,
): Promise<void> {
  const assetRoot = await findExisting(assetCandidates(config));
  if (!assetRoot) return void response.status(404).send("Excalidraw assets not found");
  const relative = request.path === "/" ? "index.html" : request.path.replace(/^\/+/, "");
  const target = path.resolve(assetRoot, relative);
  /*
   * The boundary check comes from `security.ts`, not from a prefix test here.
   * `startsWith` accepts a sibling directory that merely shares the prefix
   * (`…/excalidraw-evil`), which is how a traversal test around this route was
   * written; `isPathWithinRoot` compares resolved segments instead.
   */
  if (!isPathWithinRoot(assetRoot, target)) return void response.status(403).send("Forbidden");
  try {
    const stats = await fs.stat(target);
    const etag = `"${stats.size.toString(16)}-${Math.round(stats.mtimeMs).toString(16)}"`;
    response.set("Cache-Control", cacheControlFor(relative));
    response.set("ETag", etag);
    if (request.header("if-none-match") === etag) return void response.status(304).end();
    const data = await fs.readFile(target);
    response.type(assetContentType(target));
    response.send(data);
  } catch {
    next();
  }
}
