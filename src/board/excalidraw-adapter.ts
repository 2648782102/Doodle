import type { BoardItem, BoardItemType, SimpleBoard } from "./types.js";

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

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function textOf(item: BoardItem): string {
  return item.title ? `${item.title}\n${item.text}` : item.text;
}

function splitText(raw: string): { title?: string; text: string } {
  const lines = raw.split("\n");
  if (lines.length > 1) return { title: lines[0], text: lines.slice(1).join("\n") };
  return { text: raw };
}

function isTextContainer(item: BoardItem): boolean {
  return item.type === "note" || item.type === "rect" || item.type === "ellipse";
}

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

function styleFor(item: BoardItem): Partial<ExcalidrawSkeleton> {
  const style = item.style || {};
  return {
    strokeColor: style.borderColor ?? (item.type === "line" ? item.color : "#1f2937"),
    backgroundColor: item.type === "line" || item.type === "stroke" || item.type === "image" ? "transparent" : item.color,
    strokeWidth: style.strokeWidth ?? (item.type === "stroke" ? 3 : 2),
    strokeStyle: item.variant === "frame" ? "dashed" : "solid",
    roughness: item.variant === "frame" || item.role === "step" ? 0 : 1,
    roundness: item.variant === "pill" ? { type: 3 } : item.variant === "card" ? { type: 3 } : null,
    opacity: style.opacity ?? 100,
    fontSize: style.fontSize ?? (item.variant === "heading" ? 28 : item.type === "text" ? 20 : 16),
    fontFamily: 1,
    textAlign: style.textAlign ?? (item.type === "text" ? "left" : "center"),
    verticalAlign: "middle",
    groupIds: item.groupId ? [item.groupId] : [],
    customData: { doodle: { id: item.id, author: item.author, role: item.role, variant: item.variant, z: item.z, emphasis: item.emphasis } },
    ...(item.scene?.element ?? {}),
  };
}

function baseSkeleton(item: BoardItem): ExcalidrawSkeleton {
  return {
    id: item.id,
    type: skeletonType(item),
    x: item.x,
    y: item.y,
    width: item.type === "line" ? Math.abs(item.w) : item.w,
    height: item.type === "line" ? Math.abs(item.h) : item.h,
    ...styleFor(item),
  };
}

function boundTextSkeleton(item: BoardItem, parent: ExcalidrawSkeleton): ExcalidrawSkeleton {
  const raw = textOf(item);
  const fontSize = item.style?.fontSize ?? 16;
  return {
    id: `${item.id}_text`,
    type: "text",
    x: parent.x + (parent.width ?? 0) / 2,
    y: parent.y + (parent.height ?? 0) / 2,
    width: Math.max(1, (parent.width ?? 0) - 16),
    height: Math.max(1, (parent.height ?? 0) - 16),
    text: raw,
    originalText: raw,
    fontSize,
    fontFamily: 1,
    textAlign: item.style?.textAlign ?? "center",
    verticalAlign: "middle",
    strokeColor: item.style?.textColor ?? "#1f2937",
    backgroundColor: "transparent",
    containerId: item.id,
    autoResize: false,
    lineHeight: 1.25,
    opacity: item.style?.opacity ?? 100,
    groupIds: item.groupId ? [item.groupId] : [],
    customData: { doodle: { id: `${item.id}_text`, author: item.author, role: "label" } },
    ...(item.scene?.boundText ?? {}),
  };
}

export function boardItemsToExcalidrawSkeleton(items: BoardItem[]): ExcalidrawSkeleton[] {
  return items.flatMap((item) => {
    const base = baseSkeleton(item);
    if (item.type === "line") {
      const endX = item.w;
      const endY = item.h;
      base.points = [[0, 0], [endX, endY]];
      if (item.text && !item.scene?.boundText) base.label = { text: item.text, fontSize: item.style?.fontSize ?? 14 };
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
      return [base];
    }
    if (item.type === "image") {
      base.fileId = item.scene?.fileId ?? item.id;
    } else if (isTextContainer(item) && textOf(item)) {
      base.boundElements = [{ type: "text", id: `${item.id}_text` }];
      return [base, boundTextSkeleton(item, base)];
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

function elementColor(element: ExcalidrawLikeElement): string {
  const color = element.backgroundColor && element.backgroundColor !== "transparent"
    ? element.backgroundColor : element.strokeColor ?? "#f6d365";
  return /^#[0-9a-fA-F]{6}$/i.test(color) ? color : "#f6d365";
}

function cloneElement(element: ExcalidrawLikeElement): Record<string, unknown> {
  const clone = { ...element } as Record<string, unknown>;
  delete clone.isDeleted;
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
  const visible = elements.filter((element) => !element.isDeleted);
  const textByContainer = new Map(visible.filter((element) => element.type === "text" && element.containerId)
    .map((element) => [String(element.containerId), element]));
  return visible.filter((element) => !(element.type === "text" && element.containerId)).map((element) => {
    const custom = element.customData?.doodle as Record<string, unknown> | undefined;
    const type = elementType(element);
    const bound = textByContainer.get(element.id);
    const labels = itemText(bound ?? element);
    const previous = bySceneId.get(element.id) ?? byId.get(element.id);
    const width = Math.max(1, finite(element.width, 1));
    const height = Math.max(1, finite(element.height, 1));
    const points = elementPoints(element);
    const file = element.fileId ? files[element.fileId] : undefined;
    const item: BoardItem = {
      id: element.id,
      type,
      x: round(finite(element.x)),
      y: round(finite(element.y)),
      w: type === "line" ? round(points.at(-1)?.x ?? width) : round(width),
      h: type === "line" ? round(points.at(-1)?.y ?? height) : round(height),
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
      ...(type === "line" && element.startBinding?.elementId ? { startItemId: element.startBinding.elementId } : {}),
      ...(type === "line" && element.endBinding?.elementId ? { endItemId: element.endBinding.elementId } : {}),
      ...(typeof element.opacity === "number" || typeof element.strokeWidth === "number" || typeof element.fontSize === "number"
        ? { style: {
          ...(typeof element.opacity === "number" ? { opacity: Math.max(0.1, Math.min(1, element.opacity / 100)) } : {}),
          ...(typeof element.strokeWidth === "number" ? { strokeWidth: element.strokeWidth } : {}),
          ...(typeof element.fontSize === "number" ? { fontSize: element.fontSize } : {}),
          ...(typeof element.textAlign === "string" && ["left", "center", "right"].includes(element.textAlign)
            ? { textAlign: element.textAlign as "left" | "center" | "right" } : {}),
        } } : {}),
      scene: {
        element: cloneElement(element),
        ...(bound ? { boundText: cloneElement(bound) } : {}),
        ...(type === "image" && element.fileId ? { fileId: String(element.fileId) } : {}),
        ...(type === "image" && file ? { fileMime: file.mimeType, fileCreated: file.created } : {}),
      },
    };
    return item;
  });
}

export function boardToExcalidrawInitialData(board: SimpleBoard): Record<string, unknown> {
  return {
    elements: boardItemsToExcalidrawSkeleton(board.items),
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
