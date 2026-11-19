/**
 * Projection: Board v1 objects to an Excalidraw scene.
 *
 * Pure and deterministic. Used for the initial mount, for remote updates, and
 * for snapshot export; the canvas never invents its own representation.
 */

import type { BoardItem, SimpleBoard } from "../model/types.js";
import type {
  CanvasTheme,
  ExcalidrawFileData,
  ExcalidrawLikeElement,
  ExcalidrawSkeleton,
} from "./types.js";
import { MIN_STORED_SIZE } from "./types.js";
import {
  boardOpacityToExcalidraw,
  inkOn,
  readableStroke,
  styleFor,
  themedFill,
} from "./theme.js";
import {
  finite,
  isTextContainer,
  labelOf,
  round,
  splitText,
  textOf,
} from "./primitives.js";

function skeletonType(item: BoardItem): string {
  if (item.type === "note" || item.type === "rect") {
    if (item.variant === "diamond" || item.role === "decision") return "diamond";
    return "rectangle";
  }
  if (item.type === "ellipse") return "ellipse";
  if (item.type === "text") return "text";
  if (item.type === "line") return "arrow";
  if (item.type === "stroke") return "freedraw";
  if (item.type === "image") return "image";
  return "rectangle";
}

/**
 * Board v1 stores opacity as a 0-1 fraction; Excalidraw stores it as 0-100.
 *
 * Treating the fraction as a percentage is not a rounding error: `1` becomes
 * 1% opacity, which renders nearly invisible, and that is how an entire board
 * can look empty while the data is correct.
 */

function baseSkeleton(item: BoardItem, theme: CanvasTheme): ExcalidrawSkeleton {
  return {
    id: item.id,
    type: skeletonType(item),
    x: skeletonTextX(item),
    y: item.y,
    width: item.type === "line" ? Math.abs(item.w) : item.w,
    height: item.type === "line" ? Math.abs(item.h) : item.h,
    verticalAlign: item.type === "text" ? "top" : "middle",
    ...styleFor(item, theme),
  };
}

/**
 * Standalone text: `x` means left edge in Board v1, but the centre for
 * `convertToExcalidrawElements` once the text is not left-aligned.
 *
 * Board v1 stores a text box as (x, w) with an alignment inside it. Excalidraw's
 * skeleton API reads `x` as the *centre* of the run for centre-aligned text, so
 * passing the box's left edge shifted every caption left by half its measured
 * width — a caption under a card sat over the card's left border, and the
 * leftmost column's captions escaped the frame. Three samples made it exact:
 * x=40 with a 141px caption landed at -30, x=560 → 481, x=820 → 760.
 */
function skeletonTextX(item: BoardItem): number {
  if (item.type !== "text") return item.x;
  const align = item.style?.textAlign ?? "left";
  if (align === "center") return item.x + item.w / 2;
  if (align === "right") return item.x + item.w;
  return item.x;
}

function boundTextSkeleton(item: BoardItem, parent: ExcalidrawSkeleton, theme: CanvasTheme): ExcalidrawSkeleton {
  const raw = labelOf(item);
  const fontSize = item.style?.fontSize ?? 16;
  const align = item.style?.textAlign ?? "center";
  const parentWidth = parent.width ?? 0;
  const parentHeight = parent.height ?? 0;
  const padding = 8;
  const x = align === "center" ? parent.x + parentWidth / 2
    : align === "right" ? parent.x + parentWidth - padding
      : parent.x + padding;
  return {
    id: `${item.id}_text`,
    type: "text",
    x,
    y: parent.y + parentHeight / 2,
    width: Math.max(1, parentWidth - padding * 2),
    height: Math.max(1, parentHeight - padding * 2),
    text: raw,
    originalText: raw,
    fontSize,
    fontFamily: 3,
    textAlign: item.style?.textAlign ?? "center",
    verticalAlign: "middle",
    strokeColor: item.style?.textColor ?? inkOn(item.color, theme),
    backgroundColor: "transparent",
    containerId: item.id,
    autoResize: false,
    lineHeight: 1.25,
    opacity: boardOpacityToExcalidraw(item.style?.opacity),
    groupIds: item.groupId ? [item.groupId] : [],
    customData: { doodle: { id: `${item.id}_text`, author: item.author, role: "label", z: item.z, color: item.color } },
  };
}

export function boardItemsToExcalidrawSkeleton(items: BoardItem[], theme: CanvasTheme = "light"): ExcalidrawSkeleton[] {
  return items.flatMap((item) => {
    const base = baseSkeleton(item, theme);
    if (item.type === "line") {
      const endX = item.w;
      const endY = item.h;
      base.points = [[0, 0], [endX, endY]];
      if (item.text) base.label = { text: item.text, fontSize: item.style?.fontSize ?? 14 };
      if (item.startItemId) base.start = { id: item.startItemId };
      if (item.endItemId) base.end = { id: item.endItemId };
      if (item.shape === "orthogonal") base.arrowType = "elbowed";
      if (item.shape === "curve") base.arrowType = "round";
      return [base];
    }
    if (item.type === "stroke") {
      base.points = (item.points ?? []).map((point) => [point.x, point.y] as [number, number]);
      base.width = item.w;
      base.height = item.h;
      return [base];
    }
    if (item.type === "text") {
      base.text = textOf(item);
      base.originalText = base.text;
      base.width = item.w;
      base.height = item.h;
      base.autoResize = false;
      base.lineHeight = 1.25;
      return [base];
    }
    if (item.type === "image") {
      base.fileId = item.scene?.fileId ?? item.id;
    } else if (isTextContainer(item) && textOf(item)) {
      base.boundElements = [{ type: "text", id: `${item.id}_text` }];
      return [base, boundTextSkeleton(item, base, theme)];
    }
    return [base];
  });
}

export function boardToExcalidrawFiles(board: SimpleBoard): Record<string, ExcalidrawFileData> {
  const files: Record<string, ExcalidrawFileData> = {};
  for (const item of board.items) {
    if (item.type !== "image" || !item.src) continue;
    const fileId = item.scene?.fileId ?? item.id;
    files[fileId] = {
      id: fileId,
      mimeType: item.scene?.fileMime ?? item.mime ?? "image/png",
      dataURL: item.src,
      created: item.scene?.fileCreated ?? Date.parse(item.createdAt) ?? Date.now(),
    };
  }
  return files;
}

export function boardToExcalidrawInitialData(board: SimpleBoard, theme: CanvasTheme = "light"): Record<string, unknown> {
  return {
    elements: boardItemsToExcalidrawSkeleton(board.items, theme),
    files: boardToExcalidrawFiles(board),
    appState: {
      viewBackgroundColor: "#fbfbfc",
      currentItemFontFamily: 1,
      currentItemRoughness: 1,
      currentItemStrokeSharpness: "round",
      gridSize: null,
      zenModeEnabled: false,
      viewModeEnabled: false,
    },
    scrollToContent: true,
  };
}
