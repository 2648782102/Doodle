/**
 * What every MCP tool needs from the running server.
 *
 * Passing one context object keeps tool modules free of process globals and
 * makes each tool testable with a stub board, preview, and library.
 */

import type { AppConfig } from "../../infra/config.js";
import type { BoardLibrary } from "../library.js";
import type { BoardRevisionCache } from "../state/revision-cache.js";
import type { BoardStore } from "../state/store.js";

/**
 * What the tools need from the human-facing canvas.
 *
 * `mcp/` must not know `BoardHttpServer` exists — it is the transport that owns
 * the WebSocket fan-out and the template bundle, and importing it would put a
 * type dependency on the outer transport layer in the inner tool layer. The
 * tools only ever broadcast a revision, report the panel address, and read the
 * app HTML, so the port is declared here by its consumer and the server
 * satisfies it structurally. A transport swap stays a composition-root change.
 */
export interface BoardPreviewPort {
  /** Fan a board revision out to any connected canvas. */
  broadcast(message: Record<string, unknown>): void;
  /** Address of the standalone canvas, or null when no preview is running. */
  readonly panelUrl: string | null;
  /** The MCP App HTML for the embedded canvas resource. */
  getAppHtml(bundle?: string): Promise<string>;
}

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
  preview: BoardPreviewPort;
  config: AppConfig;
  library: BoardLibrary;
  revisions?: BoardRevisionCache;
}
