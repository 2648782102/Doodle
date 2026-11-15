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
    path.resolve(sourceDir, "../../../../infra/templates/excalidraw"),
    path.resolve(sourceDir, "../../../../src/infra/templates/excalidraw"),
    path.resolve(sourceDir, "../infra/templates/excalidraw"),
    path.resolve(sourceDir, "../templates/excalidraw"),
    path.resolve(sourceDir, "../../../dist/infra/templates/excalidraw"),
  ];
}

export async function readTemplate(config: AppConfig): Promise<string | undefined> {
  for (const candidate of excalidrawTemplateCandidates(config)) {
    try {
      return await fs.readFile(candidate, "utf8");
    } catch {}
  }
  return undefined;
}

export async function findExisting(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

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
