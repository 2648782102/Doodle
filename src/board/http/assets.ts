/**
 * Static delivery: the Excalidraw bundle, and the board-as-picture routes.
 *
 * Kept apart from the route table in `http.ts` for two reasons: the route file
 * is near its line budget, and this is the only place that decides how a build
 * artifact — or a derived SVG — may be cached.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type express from "express";
import type { AppConfig } from "../../infra/config.js";
import { assetCandidates, findExisting } from "./templates.js";
import type { BoardLibrary } from "../library.js";
import type { BoardStore } from "../state/store.js";
import { boardToSvg } from "../svg/render.js";
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

export interface SvgRouteDeps {
  board: BoardStore;
  library: BoardLibrary;
}

/**
 * `/api/board.svg` — the board on screen.
 *
 * A README screenshot goes stale the moment the board changes, and a CI job that
 * wants to attach "what the board looked like" has nowhere else to get it.
 */
export function registerActiveBoardSvg(app: express.Express, deps: SvgRouteDeps): void {
  app.get("/api/board.svg", async (req, res) => {
    const current = await deps.board.snapshot();
    const maxSize = Number(req.query.max);
    const svg = boardToSvg(current, {
      maxSize: Number.isFinite(maxSize) && maxSize > 0 ? maxSize : undefined,
      background: req.query.background !== "false",
    });
    res.type("image/svg+xml");
    // The board changes on every edit, so the preview must not be cached
    // beyond the response like the content-hashed client assets are.
    res.setHeader("Cache-Control", "no-cache");
    res.send(svg);
  });
}

/**
 * `/api/board/library/:id.svg` — a saved board's picture, for a library row.
 *
 * Rows used to be text only — a name, a count, a time — so picking between
 * twenty boards meant guessing from names alone. `id` is required: defaulting to
 * the active board would make a row's picture depend on which row happened to be
 * active when the request fired, and a `<img>` whose src silently changes meaning
 * shows the wrong board.
 */
export function registerLibrarySvg(app: express.Express, deps: SvgRouteDeps): void {
  app.get("/api/board/library/:id.svg", async (req, res) => {
    try {
      const board = await deps.library.readForPreview(String(req.params.id), await deps.board.snapshot());
      const maxSize = Number(req.query.max);
      const svg = boardToSvg(board, {
        maxSize: Number.isFinite(maxSize) && maxSize > 0 ? maxSize : 320,
        // A thumbnail sits on the panel's own paper; a white box behind every
        // small board would read as a card on a card.
        background: false,
        padding: 12,
      });
      res.type("image/svg+xml");
      res.setHeader("Cache-Control", "no-cache");
      res.send(svg);
    } catch {
      // An unknown or unreadable board is a missing picture, not a server fault:
      // the row stays text-only instead of the panel showing an error.
      res.status(404).json({ error: "Board not found" });
    }
  });
}
