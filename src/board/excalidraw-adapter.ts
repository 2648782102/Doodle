import type { BoardItem, BoardItemType, SimpleBoard } from "./types.js";

/**
 * Smallest width/height a stored object may have.
 *
 * `parseBoard` rejects anything below this, and the canvas writes back whatever
 * Excalidraw reports. A single short text line is about 15–16px tall, so
 * letting a 15px value through failed the *entire* board write rather than one
 * item: the server answered 400, the client reloaded the previous revision, and
 * the human's new drawing vanished. Clamping here keeps the round trip lossless
 * for real content instead of rejecting it downstream.
 */
const MIN_STORED_SIZE = 16;

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
  return item.text;
}

function labelOf(item: BoardItem): string {
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

/**
 * Board v1 stores opacity as a 0-1 fraction; Excalidraw stores it as 0-100.
 *
 * Treating the fraction as a percentage is not a rounding error: `1` becomes
 * 1% opacity, which renders nearly invisible, and that is how an entire board
 * can look empty while the data is correct.
 */
function boardOpacityToExcalidraw(opacity: number | undefined): number {
  if (typeof opacity !== "number" || !Number.isFinite(opacity)) return 100;
  return Math.round(Math.max(0.01, Math.min(1, opacity)) * 100);
}

/**
 * Canvas ink for each theme.
 *
 * Board v1 stores an object's own colour, but not the page it sits on. The
 * adapter always emitted one dark ink, which is invisible on the dark canvas -
 * the text was there, just unreadable. Ink is therefore chosen by theme, and an
 * explicit `style.textColor` / `style.borderColor` still wins.
 */
const CANVAS_INK: Record<CanvasTheme, string> = {
  light: "#1f2937",
  dark: "#e8eeea",
};

export type CanvasTheme = "light" | "dark";

const CANVAS_BACKGROUND: Record<CanvasTheme, string> = {
  light: "#f5f6f0",
  dark: "#131a18",
};

/** A frame is a page-like backdrop; pure white is wrong in dark mode. */
const CANVAS_PANEL: Record<CanvasTheme, string> = {
  light: "#ffffff",
  dark: "#1d2521",
};

/**
 * Board v1 records literal colours, but a colour that means "paper" has to
 * follow the theme. Pure white/near-white fills are mapped so a frame or card
 * does not turn into a glaring block - or hide its contents - in dark mode.
 */
function themedFill(color: string | undefined, theme: CanvasTheme): string | undefined {
  if (!color) return color;
  // Judge by luminance, not by a hex prefix: `#f6d365` is a yellow card, while
  // `#fbfbfc` is paper. A prefix rule silently erased saturated fills.
  if (theme === "dark" && /^#[0-9a-fA-F]{6}$/.test(color) && isNearWhite(color)) return CANVAS_PANEL.dark;
  return color;
}

/** True for colours that read as paper rather than as a deliberate fill. */
function isNearWhite(hex: string): boolean {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return Math.min(r, g, b) >= 230 && spread <= 12;
}

function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  if (value.length !== 6) return 0;
  const channels = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const left = relativeLuminance(a);
  const right = relativeLuminance(b);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

/**
 * Keep an object's own colour when it reads against the page, otherwise fall
 * back to the theme's ink. A line with `color: #ffffff` on a white canvas is the
 * same bug as dark ink on a dark canvas.
 */
function readableStroke(color: string | undefined, theme: CanvasTheme): string {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color) && contrast(color, CANVAS_BACKGROUND[theme]) >= 3) return color;
  return CANVAS_INK[theme];
}

/**
 * Ink that reads against the surface it actually sits on.
 *
 * Text inside a yellow card must be dark even when the page is dark; choosing
 * ink by page background painted light text on a light card. When an object has
 * its own fill, that fill decides.
 */
function inkOn(fill: string | undefined, theme: CanvasTheme): string {
  const surface = fill && /^#[0-9a-fA-F]{6}$/.test(fill) && !isNearWhite(fill) ? fill : CANVAS_BACKGROUND[theme];
  return contrast(CANVAS_INK[theme], surface) >= 4.5 ? CANVAS_INK[theme] : CANVAS_INK.light;
}

function styleFor(item: BoardItem, theme: CanvasTheme): Partial<ExcalidrawSkeleton> {
  const style = item.style || {};
  // A standalone text object paints with its stroke, so `textColor` must reach
  // strokeColor; shapes keep their border colour for the outline.
  const textInk = item.type === "text" ? style.textColor : undefined;
  /*
   * An explicit border colour still has to be visible on the page it lands on.
   *
   * Board v1 stores the ink a person chose, and on a dark page a stored
   * `#1e1e1e` outline is invisible — the shape is there, just unreadable. The
   * stored value is kept when it clears the contrast floor and replaced with
   * the theme's ink when it does not, the same rule `readableStroke` already
   * applied to arrows. Nothing is written back to the board: this is a render
   * decision, so switching themes never mutates someone's drawing.
   */
  const borderInk = style.borderColor && readableStroke(style.borderColor, theme) !== style.borderColor
    ? CANVAS_INK[theme]
    : style.borderColor;
  return {
    strokeColor: textInk
      ?? borderInk
      ?? (item.type === "line" ? readableStroke(item.color, theme) : CANVAS_INK[theme]),
    backgroundColor: item.type === "line" || item.type === "stroke" || item.type === "image" ? "transparent" : (themedFill(item.color, theme) ?? "transparent"),
    strokeWidth: style.strokeWidth ?? (item.type === "stroke" ? 3 : 2),
    strokeStyle: item.variant === "frame" ? "dashed" : "solid",
    roughness: item.variant === "frame" || item.role === "step" ? 0 : 1,
    roundness: item.variant === "pill" ? { type: 3 } : item.variant === "card" ? { type: 3 } : null,
    opacity: boardOpacityToExcalidraw(style.opacity),
    fontSize: style.fontSize ?? (item.variant === "heading" ? 28 : item.type === "text" ? 20 : 16),
    fontFamily: 3,
    textAlign: style.textAlign ?? (item.type === "text" ? "left" : "center"),
    groupIds: item.groupId ? [item.groupId] : [],
    customData: { doodle: { id: item.id, author: item.author, role: item.role, variant: item.variant, z: item.z, emphasis: item.emphasis, textAlign: style.textAlign, lineHeight: 1.25, color: item.color, textColor: style.textColor, borderColor: style.borderColor } },
  };
}

function baseSkeleton(item: BoardItem, theme: CanvasTheme): ExcalidrawSkeleton {
  return {
    id: item.id,
    type: skeletonType(item),
    x: item.x,
    y: item.y,
    width: item.type === "line" ? Math.abs(item.w) : item.w,
    height: item.type === "line" ? Math.abs(item.h) : item.h,
    verticalAlign: item.type === "text" ? "top" : "middle",
    ...styleFor(item, theme),
  };
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
 * a black card. `transparent` is preserved so the canvas can keep drawing the
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
