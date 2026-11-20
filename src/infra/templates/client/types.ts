/**
 * Shared types and pure viewport helpers for the Excalidraw canvas client.
 */

import type { ExcalidrawFileData, ExcalidrawLikeElement } from "../../../board/excalidraw-adapter.js";
import { browserViewportStorage, writeStoredViewport } from "../../../board/viewport-memory.js";

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
  scrollToContent: (elements?: unknown[]) => void;
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
