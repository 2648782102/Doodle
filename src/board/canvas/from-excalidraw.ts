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
import { stableItemFingerprint } from "../model/fingerprint.js";

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

/**
 * A click that never became a drag leaves Excalidraw holding a zero-size shape.
 *
 * The size floor below clamps such an element up to 16x16, which turned a
 * mis-click into a real board object: invisible at the moment it is created,
 * impossible to select meaningfully afterwards, and persisted forever. Reported
 * as a stray 16x16 rectangle appearing during a normal first use, so drop the
 * element instead of inventing a size for it.
 *
 * The test is "has no extent at all", not "is smaller than the floor": a
 * deliberate 16px square, a perfectly horizontal arrow (`h === 0`) and a thick
 * short stroke are all legitimate and must survive.
 */
/**
 * True when two projections of one object differ only by `updatedAt`.
 *
 * Key order is stable because both sides come out of the same builder, so a
 * string comparison is enough and cheaper than a deep equal.
 */
function sameItemApartFromTimestamp(a: BoardItem, b: BoardItem): boolean {
  /*
   * Key order must not matter.
   *
   * `updatedAt` sits before `title` and `scene` in the builder below but after
   * them in a board that came back through JSON, so spreading it last preserved
   * whatever order the input had and the two strings rarely matched. The
   * projection then looked like a change on every call, which is what made a
   * pan (no object touched) rewrite the board.
   */
  return stableItemFingerprint(a) === stableItemFingerprint(b);
}

function isDegenerate(element: ExcalidrawLikeElement): boolean {  const type = elementType(element);
  if (type === "image") return false;
  if (type === "stroke") return (element.points?.length ?? 0) < 2;
  if (type === "line") {
    const last = elementPoints(element).at(-1);
    return !last || (Math.abs(last.x) < 1 && Math.abs(last.y) < 1);
  }
  return Math.abs(finite(element.width, 0)) < 1 && Math.abs(finite(element.height, 0)) < 1;
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
    && !(element.type === "rectangle" && frameRole(element))
    && !isDegenerate(element));
  const frameElements = elements.filter((element) => !element.isDeleted && element.type === "rectangle" && frameRole(element));
  const textByContainer = new Map(visible.filter((element) => element.type === "text" && element.containerId)
    .map((element) => [String(element.containerId), element]));
  const items = visible.filter((element) => !(element.type === "text" && element.containerId)).map((element) => {
    const custom = element.customData?.doodle as Record<string, unknown> | undefined;
    const type = elementType(element);
    const bound = textByContainer.get(element.id);
    const labels = itemText(bound ?? element);
    const previous = bySceneId.get(element.id) ?? byId.get(element.id);
    const id = previous?.id ?? element.id;
    /*
     * A text box must not shrink to its glyphs, yet the person must still be
     * able to drag an existing text horizontally.
     *
     * Excalidraw re-measures text from its content and nudges `x` by the shrink
     * delta (left-aligned stays at `previous.x`, centred shifts toward
     * `previous.x + (previous.w - element.width) / 2`, right-aligned shifts by
     * `previous.w - element.width`). Only when the element sits at that
     * expected re-measured anchor (within a small tolerance) do we keep
     * `previous.x`; any larger shift is a real horizontal drag and moves the
     * box by the exact delta.
     */
    const elementWidth = finite(element.width, 1);
    const reportedWidth = type === "text" && previous
      ? Math.max(elementWidth, previous.w)
      : elementWidth;
    const reportedX = (() => {
      const currentX = finite(element.x);
      if (type !== "text" || !previous) return currentX;
      const previousSceneX = finite(previous.scene?.element?.x, NaN);
      if (Number.isFinite(previousSceneX)) {
        return previous.x + (currentX - previousSceneX);
      }
      const align = (element.textAlign ?? previous.style?.textAlign ?? "left") as string;
      const shrink = Math.max(0, previous.w - elementWidth);
      if (shrink === 0) return currentX;
      const expectedMin = previous.x - shrink;
      const expectedMax = align === "left" ? previous.x : previous.x + shrink;
      if (currentX >= expectedMin - 2 && currentX <= expectedMax + 2) return previous.x;
      return currentX;
    })();
    // Text and thin lines can legitimately be shorter than the stored minimum;
    // clamp rather than emit a board the server will reject wholesale.
    const width = Math.max(MIN_STORED_SIZE, reportedWidth);
    const height = Math.max(MIN_STORED_SIZE, finite(element.height, 1));
    const points = elementPoints(element);
    const file = element.fileId ? files[element.fileId] : undefined;
    const item: BoardItem = {
      id,
      type,
      x: round(reportedX),
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
        /*
         * `boundText` is deliberately not stored.
         *
         * It is a full Excalidraw text element — 475 B on a labelled card,
         * roughly half the item's scene payload and a third of the whole saved
         * board at 400 objects — and nothing reads it back:
         * `boardItemsToExcalidrawSkeleton` rebuilds the label from `title`,
         * `text`, `style`, and the theme. Storing it made every write, every
         * read, and the delta projection carry a copy of data the board
         * already had in `text`. A round trip through the skeleton reproduces
         * it field for field (verified), so the canvas still renders identically.
         */
        ...(type === "image" && element.fileId ? { fileId: String(element.fileId) } : {}),
        ...(type === "image" && file ? { fileMime: file.mimeType, fileCreated: file.created } : {}),
      },
    };
    /*
     * Only a real change earns a new timestamp.
     *
     * This used to stamp every item with `now` on every projection, so a board
     * with nothing touched came back "different" from what the canvas already
     * had. The canvas compares the projection with its last known board before
     * saving, and that comparison could never succeed — every pointer move
     * rewrote the whole document. Keeping the previous timestamp when the rest
     * of the item is identical makes "nothing changed" detectable, which is the
     * precondition for saving nothing.
     */
    if (previous && sameItemApartFromTimestamp(previous, item)) item.updatedAt = previous.updatedAt;
    return item;
  });
  /*
   * A dropped degenerate element can still be an arrow endpoint. Leaving the
   * binding behind fails the whole board on the connector check, so strip only
   * the dangling endpoint and keep the arrow itself.
   */
  const keptIds = new Set(items.map((item) => item.id));
  const sceneToBoardId = new Map(items.flatMap((item) => item.scene?.element?.id
    ? [[String(item.scene.element.id), item.id] as [string, string]] : []));
  for (const item of items) {
    if (item.startItemId) {
      item.startItemId = sceneToBoardId.get(item.startItemId) ?? item.startItemId;
      if (!keptIds.has(item.startItemId)) delete item.startItemId;
    }
    if (item.endItemId) {
      item.endItemId = sceneToBoardId.get(item.endItemId) ?? item.endItemId;
      if (!keptIds.has(item.endItemId)) delete item.endItemId;
    }
  }
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
