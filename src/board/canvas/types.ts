/**
 * Shapes exchanged with Excalidraw.
 *
 * These mirror the subset of the Excalidraw scene the adapter reads and writes.
 * They are deliberately structural rather than imported from the package so the
 * projection can be unit-tested without a browser.
 */

import type { BoardItem, BoardItemType, SimpleBoard } from "../model/types.js";

export const MIN_STORED_SIZE = 16;

/** The canvas can be light or dark independently of stored object colours. */
export type CanvasTheme = "light" | "dark";

export interface ExcalidrawFileData {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
}

export interface ExcalidrawSkeleton {
  id?: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: Array<[number, number]>;
  text?: string;
  originalText?: string;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  roundness?: null | { type: number };
  opacity?: number;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: string;
  verticalAlign?: string;
  autoResize?: boolean;
  lineHeight?: number;
  groupIds?: string[];
  customData?: Record<string, unknown>;
  containerId?: string | null;
  boundElements?: Array<Record<string, unknown>> | null;
  frameId?: string | null;
  index?: string;
  version?: number;
  versionNonce?: number;
  seed?: number;
  start?: { id?: string; type?: string };
  end?: { id?: string; type?: string };
  label?: { text: string; fontSize?: number };
  [key: string]: unknown;
}

export interface ExcalidrawLikeElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: Array<[number, number]> | Array<{ x: number; y: number }>;
  text?: string;
  originalText?: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: string;
  verticalAlign?: string;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  roundness?: null | { type: number };
  opacity?: number;
  groupIds?: string[];
  customData?: Record<string, unknown>;
  containerId?: string | null;
  boundElements?: Array<Record<string, unknown>> | null;
  frameId?: string | null;
  index?: string;
  version?: number;
  versionNonce?: number;
  seed?: number;
  isDeleted?: boolean;
  startBinding?: { elementId?: string } | null;
  endBinding?: { elementId?: string } | null;
  fileId?: string;
  [key: string]: unknown;
}

