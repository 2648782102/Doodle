/**
 * Projection and camera for the live canvas.
 *
 * Kept out of `excalidraw-app.tsx` because both are pure enough to reason about
 * on their own: one turns a stored board into Excalidraw elements, the other
 * decides where the camera should be after a board switch. The React shell only
 * wires them to lifecycle events.
 */

import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import {
  boardToExcalidrawFiles,
  boardItemsToExcalidrawSkeleton,
  type ExcalidrawFileData,
  type ExcalidrawLikeElement,
} from "../../../board/excalidraw-adapter.js";
import {
  browserViewportStorage,
  isViewportNearContent,
  readStoredViewport,
} from "../../../board/viewport-memory.js";
import { canvasThemeFor, type DoodleTheme } from "./theme.js";
import { boardBounds, type BoardSnapshot, type ExcalidrawAPI } from "./types.js";

export function toElements(snapshot: BoardSnapshot, theme: DoodleTheme) {
  const skeletons = boardItemsToExcalidrawSkeleton(snapshot.items as never[], canvasThemeFor(theme));
  return convertToExcalidrawElements(skeletons as never[], { regenerateIds: false })
    .sort((left: ExcalidrawLikeElement, right: ExcalidrawLikeElement) => {
      const leftMeta = (left.customData?.doodle as { z?: number; role?: string; variant?: string } | undefined) ?? {};
      const rightMeta = (right.customData?.doodle as { z?: number; role?: string; variant?: string } | undefined) ?? {};
      const z = (leftMeta.z ?? 0) - (rightMeta.z ?? 0);
      if (z !== 0) return z;
      // A frame or column is a backdrop; drawing it last would cover its
      // contents, so equal z orders it behind everything else.
      const isBackdrop = (role?: string, variant?: string) => role === "frame" || role === "column" || variant === "frame";
      return Number(isBackdrop(rightMeta.role, rightMeta.variant)) - Number(isBackdrop(leftMeta.role, leftMeta.variant));
    });
}

export function toFiles(snapshot: BoardSnapshot): ExcalidrawFileData[] {
  return Object.values(boardToExcalidrawFiles(snapshot as never));
}

/** The remembered camera for a board, but only when it is plausibly on its content. */
export function usableViewport(snapshot: BoardSnapshot) {
  const storage = browserViewportStorage();
  const stored = storage ? readStoredViewport(storage, snapshot.id) : undefined;
  if (!stored) return undefined;
  return isViewportNearContent(stored, boardBounds(snapshot.items)) ? stored : undefined;
}

/**
 * Put a just-switched board's content in view.
 *
 * A remembered camera is used when it is trustworthy. When there is none — a
 * new board, or one never panned — the camera has to be re-framed instead of
 * left alone: the live canvas keeps the previous board's pan and zoom, so a
 * board whose content sits elsewhere would open looking blank. Doing nothing was
 * the bug, not a neutral default.
 */
export function frameNewBoard(api: ExcalidrawAPI, snapshot: BoardSnapshot): void {
  const stored = usableViewport(snapshot);
  /*
   * Next frame, because the caller has just replaced the elements and
   * Excalidraw recalculates its scroll bounds from them.
   */
  window.requestAnimationFrame(() => {
    if (!stored) {
      /*
       * Empty boards have nothing to frame. `scrollToContent` on an empty scene
       * is a no-op, which left a new board at the *previous* board's pan and
       * zoom — a blank canvas that looks scrolled-away rather than new. The
       * default camera is the right one here, so write it directly.
       */
      if (snapshot.items.length === 0) {
        api.updateScene({
          appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 as never } },
          captureUpdate: "NEVER",
        });
        return;
      }
      api.scrollToContent();
      return;
    }
    /*
     * `updateScene` with an appState, not a dedicated camera call: the
     * imperative API has no `scrollTo`, and a guard on one made this whole
     * restore a no-op. The failure was silent in the worst way — the new board
     * kept the outgoing camera and then remembered it as its own, so both boards
     * drifted to the same position.
     */
    api.updateScene({
      appState: {
        scrollX: stored.scrollX,
        scrollY: stored.scrollY,
        zoom: { value: stored.zoom as never },
      },
      captureUpdate: "NEVER",
    });
  });
}

/**
 * Re-measure text elements once the self-hosted fonts have actually loaded.
 *
 * The board is projected once at mount, and Excalidraw sizes a text element from
 * the face available at that moment. On a cold load the self-hosted Cascadia
 * face is only fetched the first time something draws text, so every caption is
 * measured against a fallback and then clipped by the box it was given: "you
 * edit" painted as "ou edit". Reloading the page fixed it, which is the tell —
 * the second load measures with the cached face.
 *
 * `document.fonts.status` is not a usable signal here: it reads "loaded" when
 * nothing is loading, including when the face has never been requested. The
 * faces are loaded explicitly instead, then only the text elements are
 * re-measured, so a stroke the person already started is never replaced.
 *
 * Returns a cancel hook for the effect cleanup.
 */
export function remeasureTextAfterFonts(
  api: ExcalidrawAPI,
  getSnapshot: () => BoardSnapshot | null,
  theme: DoodleTheme,
  beforeApply: () => void,
  afterApply: () => void,
): () => void {
  if (typeof document === "undefined" || !document.fonts) return () => {};
  let cancelled = false;
  const faces = ["16px Cascadia", "20px Cascadia", "16px Assistant", "16px Excalifont"];
  void Promise.all(faces.map((face) => document.fonts.load(face).catch(() => {})))
    .then(() => document.fonts.ready)
    .then(() => {
      const snapshot = getSnapshot();
      if (cancelled || !snapshot) return;
      const projected = new Map(
        toElements(snapshot, theme).map((element: ExcalidrawLikeElement) => [element.id, element]),
      );
      const patched = api.getSceneElements().map((element: ExcalidrawLikeElement) => (
        element.type === "text" && projected.has(element.id) ? projected.get(element.id) as never : element
      ));
      beforeApply();
      api.updateScene({ elements: patched, captureUpdate: "NEVER" });
      afterApply();
    })
    .catch(() => {});
  return () => { cancelled = true; };
}
