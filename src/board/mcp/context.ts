/**
 * What every MCP tool needs from the running server.
 *
 * Passing one context object keeps tool modules free of process globals and
 * makes each tool testable with a stub board, preview, and library.
 */

import type { AppConfig } from "../../infra/config.js";
import type { BoardHttpServer } from "../http.js";
import type { BoardLibrary } from "../library.js";
import type { BoardRevisionCache } from "../revision-cache.js";
import type { BoardStore } from "../store.js";

/**
 * The MCP App resource that renders the shared canvas.
 */
export const APP_RESOURCE_URI = "ui://doodle/board/excalidraw/v1.html";

/** Advertise the canvas beside the host conversation. */
export const CANVAS_UI_META = {
  ui: { resourceUri: APP_RESOURCE_URI, prefersBorder: true },
} as const;

/** Reading the board cannot mutate the workspace. */
export const READ_ONLY_LOCAL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

/** Writing can remove objects, so hosts should treat it as destructive. */
export const BOARD_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
} as const;

export interface BoardToolContext {
  board: BoardStore;
  preview: BoardHttpServer;
  config: AppConfig;
  library: BoardLibrary;
  revisions?: BoardRevisionCache;
}
