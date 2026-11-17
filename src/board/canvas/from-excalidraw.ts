/**
 * Projection: an Excalidraw scene back to Board v1 objects.
 *
 * This is the direction a person edits through, so it preserves identity: ids,
 * author, and creation time carry over from the previous board, and the stored
 * size floor is applied here instead of being rejected downstream.
 */

import type { BoardItem, BoardItemType, SimpleBoard } from "../model/types.js";
import type {
  CanvasTheme,
  ExcalidrawFileData,
  ExcalidrawLikeElement,
} from "./types.js";
import { MIN_STORED_SIZE } from "./types.js";
import { finite, round, splitText } from "./primitives.js";
import { boardItemsToExcalidrawSkeleton, boardToExcalidrawFiles } from "./to-excalidraw.js";

function elementType(element: ExcalidrawLikeElement): BoardItemType {
  if (element.type === "freedraw") return "stroke";
  if (element.type === "image") return "image";
  if (element.type === "text") return "text";
  if (element.type === "arrow" || element.type === "line") return "line";
  if (element.type === "ellipse") return "ellipse";
  return "rect";
}

function elementPoints(element: ExcalidrawLikeElement): Array<{ x: number; y: number }> {
  return (element.points ?? []).map((point) => Array.isArray(point)
    ? { x: finite(point[0]), y: finite(point[1]) }
    : { x: finite(point.x), y: finite(point.y) });
}

function itemText(element: ExcalidrawLikeElement): { title?: string; text: string } {
  return splitText(element.text ?? element.originalText ?? "");
}

function itemStyle(element: ExcalidrawLikeElement): NonNullable<BoardItem["style"]> {
  return {
    ...(typeof element.opacity === "number" ? { opacity: Math.max(0.1, Math.min(1, element.opacity / 100)) } : {}),
    ...(typeof element.strokeWidth === "number" ? { strokeWidth: element.strokeWidth } : {}),
    ...(typeof element.fontSize === "number" ? { fontSize: element.fontSize } : {}),
    ...(typeof element.strokeColor === "string" ? { borderColor: element.strokeColor } : {}),
    ...(typeof element.textAlign === "string" && ["left", "center", "right"].includes(element.textAlign)
      ? { textAlign: element.textAlign as "left" | "center" | "right" } : {}),
  };
}

/**
 * The colour a Board v1 item should remember.
 *
 * `color` is the *fill* for shapes and the ink for text, so an unfilled shape
 * must not borrow its stroke colour: doing so round-tripped an outline-only
 * rectangle into a solid block on the next render. The stroke lives in
 * `style.borderColor`, so falling back to it here silently turned a frame into
 * a black card. `transparent` is preserved so the canvas keeps drawing the
 * shape as an outline.
 */
function elementColor(element: ExcalidrawLikeElement): string {
  if (element.backgroundColor === "transparent") return "transparent";
  const color = element.backgroundColor && element.backgroundColor !== "transparent"
    ? element.backgroundColor : element.strokeColor ?? "#f6d365";
  return /^#[0-9a-fA-F]{6}$/i.test(color) ? color : "#f6d365";
}

function cloneElement(element: ExcalidrawLikeElement): Record<string, unknown> {
  const clone = { ...element } as Record<string, unknown>;
  delete clone.isDeleted;
  delete clone.index;
  delete clone.version;
  delete clone.versionNonce;
  delete clone.seed;
  delete clone.updated;
  return clone;
}

export function excalidrawElementsToBoardItems(
  elements: ExcalidrawLikeElement[],
  files: Record<string, ExcalidrawFileData> = {},
  previousItems: BoardItem[] = [],
): BoardItem[] {
  const timestamp = new Date().toISOString();
  const bySceneId = new Map(previousItems.flatMap((item) => item.scene?.element?.id
    ? [[String(item.scene.element.id), item] as [string, BoardItem]] : []));
  const byId = new Map(previousItems.map((item) => [item.id, item]));
  const frameRole = (element: ExcalidrawLikeElement): boolean =>
    (element.customData?.doodle as Record<string, unknown> | undefined)?.role === "frame";
  const visible = elements.filter((element) => !element.isDeleted
    && !(element.type === "text" && !element.containerId && !element.text?.trim())
    && !(element.type === "rectangle" && frameRole(element)));
  const frameElements = elements.filter((element) => !element.isDeleted && element.type === "rectangle" && frameRole(element));
  const textByContainer = new Map(visible.filter((element) => element.type === "text" && element.containerId)
    .map((element) => [String(element.containerId), element]));
  const items = visible.filter((element) => !(element.type === "text" && element.containerId)).map((element) => {
    const custom = element.customData?.doodle as Record<string, unknown> | undefined;
    const type = elementType(element);
    const bound = textByContainer.get(element.id);
    const labels = itemText(bound ?? element);
    const previous = bySceneId.get(element.id) ?? byId.get(element.id);
    // Text and thin lines can legitimately be shorter than the stored minimum;
    // clamp rather than emit a board the server will reject wholesale.
    const width = Math.max(MIN_STORED_SIZE, finite(element.width, 1));
    const height = Math.max(MIN_STORED_SIZE, finite(element.height, 1));
    const points = elementPoints(element);
    const file = element.fileId ? files[element.fileId] : undefined;
    const item: BoardItem = {
      id: element.id,
      type,
      x: round(finite(element.x)),
      y: round(finite(element.y)),
    // `round` can land back under the minimum (15.98 → 16 is fine, 15.9 → 15.9
    // is not), so clamp the rounded value instead of the raw one.
    w: type === "line" ? round(points.at(-1)?.x ?? width) : Math.max(MIN_STORED_SIZE, round(width)),
    h: type === "line" ? round(points.at(-1)?.y ?? height) : Math.max(MIN_STORED_SIZE, round(height)),
      text: labels.text,
      color: elementColor(element),
      author: previous?.author ?? (custom?.author === "ai" ? "ai" : "human"),
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
      ...(labels.title ? { title: labels.title } : {}),
      ...(element.groupIds?.length ? { groupId: element.groupIds[0] } : {}),
      ...(element.roundness ? { variant: "card" as const } : {}),
      ...(element.strokeStyle === "dashed" ? { variant: "frame" as const } : {}),
      ...(custom?.role && typeof custom.role === "string" ? { role: custom.role as BoardItem["role"] } : {}),
      ...(custom?.z && typeof custom.z === "number" ? { z: custom.z } : {}),
      ...(custom?.emphasis ? { emphasis: custom.emphasis as BoardItem["emphasis"] } : {}),
      ...(type === "stroke" && points.length > 1 ? { points } : {}),
      ...(type === "image" && file ? { src: file.dataURL, mime: file.mimeType as BoardItem["mime"] } : {}),
      ...(custom?.color && typeof custom.color === "string" ? { color: custom.color } : {}),
      ...(type === "line" && element.startBinding?.elementId ? { startItemId: element.startBinding.elementId } : {}),
      ...(type === "line" && element.endBinding?.elementId ? { endItemId: element.endBinding.elementId } : {}),
      ...(custom?.variant && typeof custom.variant === "string" ? { variant: custom.variant as BoardItem["variant"] } : {}),
      ...((Object.keys(itemStyle(element)).length || custom?.textColor)
        ? { style: {
          ...itemStyle(element),
          ...(typeof custom?.textColor === "string" ? { textColor: custom.textColor } : {}),
        } }
        : {}),
      scene: {
        element: cloneElement(element),
        ...(bound ? { boundText: cloneElement(bound) } : {}),
        ...(type === "image" && element.fileId ? { fileId: String(element.fileId) } : {}),
        ...(type === "image" && file ? { fileMime: file.mimeType, fileCreated: file.created } : {}),
      },
    };
    return item;
  });
  for (const frame of frameElements) {
    const previous = bySceneId.get(frame.id) ?? byId.get(frame.id);
    if (!previous) continue;
    items.push({ ...previous, x: round(finite(frame.x)), y: round(finite(frame.y)), w: round(Math.max(1, finite(frame.width, previous.w))), h: round(Math.max(1, finite(frame.height, previous.h))), updatedAt: timestamp, scene: { ...previous.scene, element: cloneElement(frame) } });
  }
  return items;
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

export function boardItemsFromExcalidrawBoard(
  board: SimpleBoard,
  elements: ExcalidrawLikeElement[],
  files: Record<string, ExcalidrawFileData> = {},
): SimpleBoard {
  return {
    ...board,
    items: excalidrawElementsToBoardItems(elements, files, board.items),
  };
}
