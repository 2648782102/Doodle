/**
 * Shared types and pure viewport helpers for the Excalidraw canvas client.
 */

import type { ExcalidrawFileData, ExcalidrawLikeElement } from "../../../board/excalidraw-adapter.js";
import { browserViewportStorage, writeStoredViewport } from "../../../board/client/viewport-memory.js";

export type BoardSnapshot = {
  version: 1;
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  items: unknown[];
  library?: unknown;
  capabilities?: unknown;
  visualDigest?: unknown;
  [key: string]: unknown;
};

export type ExcalidrawAPI = {
  updateScene: (scene: { elements?: unknown[]; appState?: Record<string, unknown>; captureUpdate?: string }) => void;
  getSceneElements: () => ExcalidrawLikeElement[];
  /**
   * `fitToContent` frames the whole board inside the viewport; without it the
   * camera stays at 100% and simply pans, which put a phone's first paint on
   * the top-right corner of a board that is wider than the screen.
   */
  scrollToContent: (elements?: unknown[], options?: { fitToContent?: boolean; animate?: boolean }) => void;
  addFiles: (files: ExcalidrawFileData[]) => void;
  getAppState?: () => Record<string, unknown>;
  getFiles?: () => Record<string, ExcalidrawFileData>;
};

export type ExcalidrawAppState = {
  editingTextElement?: unknown;
  editingLinearElement?: unknown;
  editingGroupId?: unknown;
  scrollX?: number;
  scrollY?: number;
  zoom?: { value?: number } | number;
};

export type McpAppFallback = {
  drawBoard?: (args: Record<string, unknown>) => Promise<unknown>;
};

let viewportSaveTimer: number | null = null;
/** The newest camera waiting to be written, and the board it belongs to. */
let pendingViewport: { boardId: string; viewport: { scrollX: number; scrollY: number; zoom: number } } | null = null;

/** Bounding box of the board's objects, used to judge a remembered camera. */
export function boardBounds(items: unknown[]): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const raw of items) {
    const item = raw as { x?: number; y?: number; w?: number; h?: number };
    if (typeof item.x !== "number" || typeof item.y !== "number") continue;
    const width = typeof item.w === "number" ? item.w : 0;
    const height = typeof item.h === "number" ? item.h : 0;
    minX = Math.min(minX, item.x, item.x + width);
    minY = Math.min(minY, item.y, item.y + height);
    maxX = Math.max(maxX, item.x, item.x + width);
    maxY = Math.max(maxY, item.y, item.y + height);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : undefined;
}

/**
 * The camera that shows a whole board inside a viewport.
 *
 * Pure, and deliberately independent of the live scene: Excalidraw's own
 * `fitToContent` reads whatever the scene holds at that instant, which on a
 * cold mount can still be empty. It then divides a zero-width bound and writes
 * `NaN` into the camera, and the canvas stops painting everything — the board
 * appears to vanish. Computing from the board's own bounds cannot fail that
 * way.
 *
 * The formula is Excalidraw's: a scene point `p` lands at `(p + scroll) * zoom`,
 * so centring content at `centre` means `scroll = viewport / 2 - centre * zoom`.
 */
export function fitCamera(
  items: unknown[],
  viewport: { width: number; height: number },
  padding = 48,
): { scrollX: number; scrollY: number; zoom: number } | undefined {
  const bounds = boardBounds(items);
  if (!bounds || viewport.width <= 0 || viewport.height <= 0) return undefined;
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX + padding * 2);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY + padding * 2);
  // Never zoom past 1:1 on an opened board, and never below Excalidraw's floor.
  const zoom = Math.min(2, Math.max(0.1, Math.min(viewport.width / contentWidth, viewport.height / contentHeight, 1)));
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  return {
    scrollX: viewport.width / 2 - centreX * zoom,
    scrollY: viewport.height / 2 - centreY * zoom,
    zoom,
  };
}

/** Save the camera at most a few times a second; it changes on every pan frame. */
export function rememberViewport(boardId: string | undefined, appState: ExcalidrawAppState): void {
  if (!boardId) return;
  const zoom = typeof appState.zoom === "number" ? appState.zoom : appState.zoom?.value;
  if (typeof appState.scrollX !== "number" || typeof appState.scrollY !== "number" || typeof zoom !== "number") return;
  const storage = browserViewportStorage();
  if (!storage) return;
  /*
   * Snapshot the values, not the app state object, and coalesce instead of
   * dropping.
   *
   * The timer used to read `appState` when it fired, 600 ms later. Switching
   * boards inside that window rewrote the new board's entry with the camera of
   * the board being left — both boards then remembered the wrong place. Capturing
   * now ties the values to the id that was active when they were observed.
   *
   * It also returned early while a write was pending, so the *latest* camera in
   * a burst was the one that got lost. That mattered beyond throttling: the
   * camera restored on a board switch arrived while a stale entry was still
   * queued, was discarded, and the board kept the outgoing camera.
   */
  const viewport = { scrollX: appState.scrollX!, scrollY: appState.scrollY!, zoom };
  pendingViewport = { boardId, viewport };
  if (viewportSaveTimer !== null) return;
  viewportSaveTimer = window.setTimeout(() => {
    viewportSaveTimer = null;
    const pending = pendingViewport;
    pendingViewport = null;
    if (pending) writeStoredViewport(storage, pending.boardId, pending.viewport);
  }, 600);
}

export function isEditing(appState: ExcalidrawAppState | undefined): boolean {
  return Boolean(appState?.editingTextElement || appState?.editingLinearElement || appState?.editingGroupId);
}
