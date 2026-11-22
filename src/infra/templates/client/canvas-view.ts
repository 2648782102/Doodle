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
} from "../../../board/client/viewport-memory.js";
import { canvasColors, canvasThemeFor, type DoodleTheme } from "./theme.js";
import { boardBounds, fitCamera, type BoardSnapshot, type ExcalidrawAPI } from "./types.js";

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
  const frame = (attempt: number) => window.requestAnimationFrame(() => {
    /*
     * A camera fit needs a measured container.
     *
     * On a cold mount the API exists before Excalidraw has read its own
     * `clientWidth`/`clientHeight`, and `fitToContent` divides by those
     * dimensions. Zero gave `0/0`, which the app wrote back as
     * `zoom.value = NaN`, `scrollX = NaN`, `scrollY = NaN`: the canvas painted
     * nothing and the footer read `NaN%`. Waiting for a non-zero viewport is
     * the difference between "frame the board" and "erase the camera".
     */
    const state = api.getAppState?.() as { width?: number; height?: number } | undefined;
    const measured = typeof state?.width === "number" && typeof state?.height === "number"
      && state.width > 0 && state.height > 0;
    const viewportWidth = state?.width ?? 0;
    const viewportHeight = state?.height ?? 0;
    /*
     * `fitToContent` also needs the elements, not only the container.
     *
     * The scene is applied through `updateScene`, which is a React state
     * update, so one animation frame after the effect is not a guarantee that
     * Excalidraw sees the objects. Fitting an empty scene divides by a
     * zero-width bound and stores `NaN` in the camera, which is worse than
     * leaving it alone: nothing paints at all. Wait for both.
     */
    const hasScene = snapshot.items.length === 0 || (api.getSceneElements?.() ?? []).length > 0;
    if (!measured || !hasScene) {
      if (attempt < 20) frame(attempt + 1);
      return;
    }
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
      /*
       * Fit the content the board *has*, not the scene Excalidraw may not have
       * committed yet.
       *
       * `scrollToContent(undefined, { fitToContent: true })` reads the live
       * scene. Called one frame after `updateScene`, that scene is still empty
       * often enough to matter: `fitToContent` then divides a zero-width bound
       * and writes `zoom.value = NaN`, `scrollX = NaN`, `scrollY = NaN`. The
       * canvas stops painting *everything* — the board looks like it vanished a
       * moment after it appeared, and the zoom chip reads `NaN%`.
       *
       * The bounds are already known from `snapshot`, so compute the camera
       * from them directly. The formula is Excalidraw's own: a scene point maps
       * to `(x + scrollX) * zoom` on the canvas, so centring the content means
       * `scroll = viewport/2 - centre * zoom`.
       */
      const camera = fitCamera(snapshot.items, { width: viewportWidth, height: viewportHeight });
      if (camera) {
        api.updateScene({
          appState: {
            scrollX: camera.scrollX,
            scrollY: camera.scrollY,
            zoom: { value: camera.zoom as never },
          },
          captureUpdate: "NEVER",
        });
      }
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
  frame(0);
}

/**
 * Frame the board the very first time the canvas mounts.
 *
 * `frameNewBoard` only ran on a board *switch*, and a cold boot sets the
 * painted-board id before the first render — so the opening camera was whatever
 * `initialData.scrollToContent` produced, which pans at 100% zoom. On a 390px
 * phone that opened a 980px diagram with its top-left corner off-screen and
 * only a fragment of the title visible; the person's first impression of a
 * healthy board was that it was broken.
 *
 * The guard is a separate flag rather than the painted-board id: switching
 * appearance re-runs the repaint effect, and re-framing there would yank the
 * camera away from wherever the person had panned to.
 */
export function frameFirstPaint(api: ExcalidrawAPI | null, snapshot: BoardSnapshot | null, framed: { current: boolean }): void {
  if (!api || !snapshot || framed.current) return;
  framed.current = true;
  frameNewBoard(api, snapshot);
}

/**
 * The process-wide "the first paint has been framed" flag.
 *
 * Kept here rather than in the entrypoint so the guard lives beside the rule it
 * protects, and so `excalidraw-app.tsx` gains only the one call site.
 */
export const firstPaint = { current: false };

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

/**
 * The scene Excalidraw mounts with.
 *
 * Extracted from the entrypoint because it is a pure function of a board and a
 * theme: the camera comes from `usableViewport` (a remembered position when it
 * still frames the content, otherwise fit-to-content), and the files are the
 * same projection the live canvas uses. Keeping it here means a change to how a
 * board becomes a scene lands next to the code that owns that projection.
 */
export function buildInitialScene(snapshot: BoardSnapshot, theme: DoodleTheme) {
  const files = toFiles(snapshot);
  const fileMap = Object.fromEntries(files.map((file) => [file.id, file]));
  const remembered = snapshot.items.length > 0 ? usableViewport(snapshot) : undefined;
  return {
    files: fileMap,
    data: {
      elements: toElements(snapshot, theme),
      files: fileMap,
      appState: {
        viewBackgroundColor: canvasColors[theme].view,
        exportBackground: true,
        exportWithDarkMode: false,
        ...(remembered
          ? { scrollX: remembered.scrollX, scrollY: remembered.scrollY, zoom: { value: remembered.zoom as never } }
          : {}),
      },
      scrollToContent: !remembered,
    },
  };
}
