/**
 * Locating and filling the canvas template.
 *
 * The server runs from `src` (tsx), `dist` (built), or a bundled plugin, so the
 * same template lives at several relative paths. Candidate order is centralised
 * here rather than repeated per call site, and token substitution is one
 * function so the standalone page and the embedded app cannot drift apart.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../../infra/config.js";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));

export function excalidrawTemplateCandidates(config: AppConfig): string[] {
  return [
    path.resolve(config.cwd, "server", "infra", "templates", "excalidraw.html"),
    path.resolve(config.cwd, "infra", "templates", "excalidraw.html"),
    path.resolve(sourceDir, "infra", "templates", "excalidraw.html"),
    path.resolve(sourceDir, "../../../../infra/templates/excalidraw.html"),
    path.resolve(sourceDir, "../../../../src/infra/templates/excalidraw.html"),
    path.resolve(sourceDir, "../infra/templates/excalidraw.html"),
    path.resolve(sourceDir, "../templates/excalidraw.html"),
    path.resolve(sourceDir, "../../../dist/infra/templates/excalidraw.html"),
  ];
}

export function assetCandidates(config: AppConfig): string[] {
  return [
    path.resolve(config.cwd, "server", "infra", "templates", "excalidraw"),
    path.resolve(config.cwd, "infra", "templates", "excalidraw"),
    path.resolve(sourceDir, "infra", "templates", "excalidraw"),
    path.resolve(sourceDir, "../../../../infra/templates/excalidraw"),
    path.resolve(sourceDir, "../../../../src/infra/templates/excalidraw"),
    path.resolve(sourceDir, "../infra/templates/excalidraw"),
    path.resolve(sourceDir, "../templates/excalidraw"),
    path.resolve(sourceDir, "../../../dist/infra/templates/excalidraw"),
  ];
}

export async function readTemplate(config: AppConfig): Promise<string | undefined> {
  /*
   * Revalidate the template with one `stat`, then reuse the text.
   *
   * The page is 106 KB and was re-read from disk on every load: the candidate
   * lookup *read* each path until one succeeded, so a normal load paid several
   * failed reads plus the real one. The mtime+size key keeps the development
   * loop intact — editing the template still shows up on the next request —
   * while removing the redundant I/O from the steady state.
   */
  const resolved = await resolveTemplate(config);
  if (!resolved) return undefined;
  const cached = templateCache.get(resolved.path);
  if (cached && cached.mtimeMs === resolved.mtimeMs && cached.size === resolved.size) {
    return cached.text;
  }
  const text = await fs.readFile(resolved.path, "utf8");
  templateCache.set(resolved.path, { mtimeMs: resolved.mtimeMs, size: resolved.size, text });
  return text;
}

interface ResolvedTemplate {
  path: string;
  mtimeMs: number;
  size: number;
}

const templateCache = new Map<string, { mtimeMs: number; size: number; text: string }>();

async function resolveTemplate(config: AppConfig): Promise<ResolvedTemplate | undefined> {
  const candidates = excalidrawTemplateCandidates(config);
  /*
   * Remember which candidate won, so the steady state costs one `stat`
   * instead of one per candidate (seven at the time of writing). The memory is
   * keyed by the candidate list, and a miss falls back to the full walk.
   */
  const key = candidates.join("\n");
  const remembered = templatePathCache.get(key);
  if (remembered) {
    try {
      const stats = await fs.stat(remembered);
      if (stats.isFile()) return { path: remembered, mtimeMs: stats.mtimeMs, size: stats.size };
    } catch {}
    templatePathCache.delete(key);
  }
  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) {
        templatePathCache.set(key, candidate);
        return { path: candidate, mtimeMs: stats.mtimeMs, size: stats.size };
      }
    } catch {}
  }
  return undefined;
}

const templatePathCache = new Map<string, string>();

export async function findExisting(candidates: string[]): Promise<string | null> {
  /*
   * The asset root is one directory; resolving it walked up to seven
   * candidates with `fs.access` on *every* static file request — 184 files on
   * a cold load. Remember the winner. A stale hit is still safe: the caller
   * reads the file and falls through to `next()` on ENOENT, and a build that
   * moves the directory invalidates on that read.
   */
  const key = candidates.join("\n");
  const remembered = assetRootCache.get(key);
  if (remembered !== undefined) return remembered;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      assetRootCache.set(key, candidate);
      return candidate;
    } catch {}
  }
  return null;
}

const assetRootCache = new Map<string, string>();

/**
 * Fill a template for standalone use (a real token, app mode off) or for the
 * embedded MCP App (no token, app mode on).
 */
export function fillTemplate(
  template: string,
  options: { assetVersion: string; token: string; embedded: boolean },
): string {
  return template
    .replace('"__DOODLE_MCP_APP__"', options.embedded ? '"1"' : '"0"')
    .replace("__DOODLE_ASSET_VERSION__", options.assetVersion)
    .replace("__DOODLE_PANEL_TOKEN__", options.embedded ? "" : options.token)
    .replace("__AI_DRAW_PANEL_TOKEN__", options.embedded ? "" : options.token);
}
