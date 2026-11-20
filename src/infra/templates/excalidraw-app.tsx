/**
 * Excalidraw canvas entrypoint: wires the split client modules (`transport`,
 * `theme`, `link-policy`, `banner`, `library-ui`, `sync-state`, `canvas-sync`)
 * and mounts the React canvas.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import {
  boardToExcalidrawFiles,
  boardItemsFromExcalidrawBoard,
  boardItemsToExcalidrawSkeleton,
  type ExcalidrawFileData,
  type ExcalidrawLikeElement,
} from "../../board/excalidraw-adapter.js";
import {
  browserViewportStorage,
  isViewportNearContent,
  readStoredViewport,
} from "../../board/viewport-memory.js";
import { initLiquidGlass, type LiquidGlassController } from "./liquid-glass.js";
import {
  clearConflictNotice,
  clearError,
  initWelcome,
  showConflictNotice,
  showError,
} from "./client/banner.js";
import { createCanvasSync, type CanvasSync, type CanvasSyncOutcome, type SceneElement } from "./client/canvas-sync.js";
import { initLibraryUi, initSnapshotExports } from "./client/library-ui.js";
import { initExternalLinkPolicy, isDoodleProjectLink } from "./client/link-policy.js";
import { createSyncChip } from "./client/sync-state.js";
import {
  EXCALIDRAW_THEME,
  canvasColors,
  canvasThemeFor,
  initThemeToggle,
  isDoodleTheme,
  readTheme,
  type DoodleTheme,
} from "./client/theme.js";
import { BoardWriteError, createBoardTransport } from "./client/transport.js";
import {
  boardBounds,
  isEditing,
  rememberViewport,
  type BoardSnapshot,
  type ExcalidrawAPI,
  type ExcalidrawAppState,
  type McpAppFallback,
} from "./client/types.js";

declare global {
  interface Window {
    DOODLE_EXCALIDRAW_TOKEN?: string;
    DOODLE_THEME?: DoodleTheme;
    DoodleExcalidrawInit?: (snapshot: BoardSnapshot, mcpApp?: unknown) => void;
    DoodleExcalidrawUpdate?: (snapshot: BoardSnapshot) => void;
  }
}

const embedded = Boolean((window as unknown as { DOODLE_MCP_APP_EMBEDDED?: boolean }).DOODLE_MCP_APP_EMBEDDED);
const transport = createBoardTransport({
  embedded,
  panelToken: window.DOODLE_EXCALIDRAW_TOKEN ?? "",
});
/** The one visible answer to "is this saved, and did the agent see it?". */
const status = createSyncChip(transport.channel);

let glassController: LiquidGlassController | null = null;
let activeSnapshot: BoardSnapshot | null = null;
/**
 * The board the live scene was painted from.
 *
 * Not the same thing as `activeSnapshot`: when a remote write arrives between a
 * gesture and its debounced save, the newer board becomes the write target while
 * the scene is still the older one. Rebasing needs both.
 */
let sceneBase: BoardSnapshot | null = null;
/** A remote board was adopted without repainting; converge after the next write. */
const pendingRepaint = { current: false };
const apiRef: { current: ExcalidrawAPI | null } = { current: null };
const applyingRemote = { current: false };
const currentFiles: { current: Record<string, ExcalidrawFileData> } = { current: {} };
const currentAppState: { current: ExcalidrawAppState } = { current: {} };
const pendingRemote: { current: BoardSnapshot | null } = { current: null };
/**
 * Excalidraw fires `onChange` while it is still mounting, before the scene we
 * passed in has been applied. Wait for the first non-empty scene before
 * treating any change as a human edit.
 */
const sceneReady = { current: false };

function toElements(snapshot: BoardSnapshot, theme: DoodleTheme = readTheme()) {
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

function toFiles(snapshot: BoardSnapshot): ExcalidrawFileData[] {
  return Object.values(boardToExcalidrawFiles(snapshot as never));
}

/** Paint the scene from `activeSnapshot`, and remember that this is its provenance. */
function repaintFromActive(): void {
  const snapshot = activeSnapshot;
  if (!snapshot || isEditing(currentAppState.current)) return;
  sceneBase = snapshot;
  pendingRepaint.current = false;
  applyingRemote.current = true;
  sceneReady.current = true;
  const files = toFiles(snapshot);
  currentFiles.current = Object.fromEntries(files.map((file) => [file.id, file]));
  apiRef.current?.addFiles(files);
  apiRef.current?.updateScene({ elements: toElements(snapshot), captureUpdate: "NEVER" });
  window.setTimeout(() => { applyingRemote.current = false; }, 0);
}

function publishToHost(snapshot: BoardSnapshot): void {
  void transport.publishContext(snapshot)
    .then((published) => { if (published) status.send("published"); })
    .catch(() => {});
}

/**
 * Adopt a board that arrived from somewhere else.
 *
 * `repaint: false` is the interesting case: the person has just finished a
 * gesture and someone else wrote meanwhile. Repainting there is what used to
 * erase the gesture, so the newer board only becomes the write target and the
 * scene is reconciled by the rebase in `canvas-sync`.
 */
function applyRemoteSnapshot(data: BoardSnapshot, options: { repaint?: boolean } = {}): void {
  if (!data || !Array.isArray(data.items) || typeof data.revision !== "number") return;
  if (activeSnapshot && data.revision <= activeSnapshot.revision && data.id === activeSnapshot.id) return;
  if (options.repaint === false) {
    activeSnapshot = data;
    pendingRepaint.current = true;
    return;
  }
  if (isEditing(currentAppState.current)) {
    pendingRemote.current = data;
    return;
  }
  activeSnapshot = data;
  repaintFromActive();
  publishToHost(data);
}

/** A rejected write, with the recovery path the person actually needs. */
function handleWriteError(error: unknown, retry: () => Promise<CanvasSyncOutcome>): void {
  const conflict = error instanceof BoardWriteError && error.code === "REVISION_CONFLICT_OBJECTS"
    ? error
    : null;
  const ids = conflict?.conflicts ?? [];
  if (!conflict) {
    status.send("local-edit");
    showError(error);
    return;
  }
  status.send("conflict");
  const named = ids.slice(0, 3).join("、");
  showConflictNotice(
    ids.length
      ? `有 ${ids.length} 个对象在此同时被别处改动：${named}${ids.length > 3 ? " 等" : ""}。这次改动还没保存。`
      : "有对象在此同时被别处改动，这次改动还没保存。",
    [
      {
        label: "载入最新",
        tone: "primary",
        run: async () => {
          const latest = await transport.loadBoard().catch(() => null);
          if (latest) applyRemoteSnapshot(latest);
          clearConflictNotice();
          status.send("saved");
        },
      },
      { label: "保留我的", tone: "danger", run: async () => { await retry(); } },
    ],
  );
}

function CanvasApp({ initial }: { initial: BoardSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [api, setApi] = useState<ExcalidrawAPI | null>(null);
  const [theme, setTheme] = useState<DoodleTheme>(readTheme());

  const sync = useMemo<CanvasSync>(() => createCanvasSync({
    transport,
    getSnapshot: () => activeSnapshot,
    getSceneBase: () => sceneBase ?? activeSnapshot,
    project: (base, elements, files) => boardItemsFromExcalidrawBoard(
      base as never,
      elements as never,
      files as never,
    ) as unknown as BoardSnapshot,
    applySaved: (updated, info) => {
      activeSnapshot = updated;
      setSnapshot(updated);
      clearError();
      clearConflictNotice();
      publishToHost(updated);
      // A rebase means the person's scene is missing whatever landed meanwhile;
      // converge once the write is safely in, never mid-gesture.
      if ((info.rebased || info.dropped > 0 || pendingRepaint.current) && !isEditing(currentAppState.current)) {
        repaintFromActive();
      }
    },
    report: (event) => { status.send(event); },
    onError: (error, retry) => handleWriteError(error, retry),
    debounceMs: 450,
  }), []);

  const initialData = useMemo(() => {
    const files = toFiles(initial);
    currentFiles.current = Object.fromEntries(files.map((file) => [file.id, file]));
    const stored = initial.items.length > 0 && browserViewportStorage()
      ? readStoredViewport(browserViewportStorage()!, initial.id)
      : undefined;
    const remembered = stored && isViewportNearContent(stored, boardBounds(initial.items))
      ? stored
      : undefined;
    return {
      elements: toElements(initial, theme),
      files: currentFiles.current,
      appState: {
        viewBackgroundColor: canvasColors[theme].view,
        exportBackground: true,
        exportWithDarkMode: false,
        ...(remembered ? { scrollX: remembered.scrollX, scrollY: remembered.scrollY, zoom: { value: remembered.zoom as never } } : {}),
      },
      scrollToContent: !remembered,
    };
  }, [initial, theme]);

  useEffect(() => {
    if (activeSnapshot !== initial || snapshot === initial) activeSnapshot = snapshot;
  }, [snapshot, initial]);

  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  useEffect(() => {
    if (!api) return;
    api.updateScene({
      appState: {
        viewBackgroundColor: canvasColors[theme].view,
        exportBackground: true,
        exportWithDarkMode: false,
        gridModeEnabled: false,
      },
      captureUpdate: "NEVER",
    });
    if (activeSnapshot) {
      applyingRemote.current = true;
      api.updateScene({ elements: toElements(activeSnapshot, theme), captureUpdate: "NEVER" });
      window.setTimeout(() => { applyingRemote.current = false; }, 0);
    }
  }, [api, theme]);

  /*
   * Captions were measured before the self-hosted fonts arrived.
   *
   * The board is projected once at mount, and Excalidraw sizes a text element
   * from the face available at that moment. On a cold load the self-hosted
   * Cascadia face is only fetched the first time something draws text, so every
   * caption is measured against a fallback and then clipped by the box it was
   * given: "you edit" painted as "ou edit". Reloading the page fixed it, which
   * is the tell — the second load measures with the cached face.
   *
   * `document.fonts.status` is not a usable signal here: it reads "loaded" when
   * nothing is loading, including when the face has never been requested. The
   * faces are loaded explicitly instead, then only the text elements are
   * re-measured, so a stroke the person already started is never replaced.
   */
  useEffect(() => {
    if (!api || typeof document === "undefined" || !document.fonts) return;
    let cancelled = false;
    const faces = ["16px Cascadia", "20px Cascadia", "16px Assistant", "16px Excalifont"];
    void Promise.all(faces.map((face) => document.fonts.load(face).catch(() => {})))
      .then(() => document.fonts.ready)
      .then(() => {
        if (cancelled || !activeSnapshot) return;
        const projected = new Map(
          toElements(activeSnapshot, theme).map((element: ExcalidrawLikeElement) => [element.id, element]),
        );
        const patched = api.getSceneElements().map((element: ExcalidrawLikeElement) => (
          element.type === "text" && projected.has(element.id) ? projected.get(element.id) as never : element
        ));
        applyingRemote.current = true;
        api.updateScene({ elements: patched, captureUpdate: "NEVER" });
        window.setTimeout(() => { applyingRemote.current = false; }, 0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, theme]);

  useEffect(() => {
    const onThemeChange = (event: Event) => {
      const detail = (event as CustomEvent<DoodleTheme>).detail;
      if (isDoodleTheme(detail)) setTheme(detail);
    };
    window.addEventListener("doodle-theme-change", onThemeChange);
    return () => window.removeEventListener("doodle-theme-change", onThemeChange);
  }, []);

  useEffect(() => {
    window.DoodleExcalidrawUpdate = (next) => applyRemoteSnapshot(next);
    return () => { window.DoodleExcalidrawUpdate = undefined; };
  }, []);

  const onChange = useCallback((
    elements: ExcalidrawLikeElement[],
    appState: ExcalidrawAppState,
    files: Record<string, ExcalidrawFileData>,
  ) => {
    currentAppState.current = appState;
    Object.assign(currentFiles.current, files);
    rememberViewport(activeSnapshot?.id, appState);
    if (!api || applyingRemote.current || !activeSnapshot) return;
    if (!sceneReady.current) {
      if (elements.length === 0) return;
      sceneReady.current = true;
    }
    if (isEditing(appState)) return;
    /*
     * A write that landed mid-gesture becomes the new baseline without a
     * repaint. The gesture the person just finished stays on screen and in the
     * scene, and `schedule` writes it against the newer board.
     */
    if (pendingRemote.current) {
      applyRemoteSnapshot(pendingRemote.current, { repaint: false });
      pendingRemote.current = null;
    }
    const projected = boardItemsFromExcalidrawBoard(
      activeSnapshot as never,
      elements,
      currentFiles.current,
    );
    if (JSON.stringify(projected.items) === JSON.stringify(activeSnapshot.items)) {
      /*
       * Nothing of the person's to write. If a remote board was only adopted as
       * the baseline (no repaint), the scene is still showing the older one, so
       * this is the last chance to converge without waiting for another edit.
       */
      if (pendingRepaint.current) repaintFromActive();
      return;
    }
    sync.schedule(elements as SceneElement[], currentFiles.current);
  }, [api, sync]);

  return React.createElement(
    "div",
    { className: "excalidraw-host" },
    React.createElement(Excalidraw, {
      excalidrawAPI: (candidate: ExcalidrawAPI) => setApi(candidate),
      initialData,
      onChange,
      langCode: "zh-CN",
      theme: EXCALIDRAW_THEME,
      aiEnabled: false,
      onLinkOpen: (element: { link?: string }, event: CustomEvent<{ nativeEvent: MouseEvent }>) => {
        if (element.link && !isDoodleProjectLink(element.link)) event.preventDefault();
      },
      UIOptions: {
        canvasActions: {
          loadScene: false,
          saveToActiveFile: false,
          export: false,
          saveAsImage: false,
          toggleTheme: false,
          clearCanvas: false,
          changeViewBackgroundColor: false,
        },
        tools: {
          image: true,
        },
      },
    }),
  );
}

let rootInstance: ReturnType<typeof createRoot> | null = null;
function renderCanvas(initial: BoardSnapshot): void {
  const root = document.querySelector("#excalidrawRoot");
  if (!root) return;
  if (!rootInstance) rootInstance = createRoot(root);
  activeSnapshot = initial;
  sceneBase = initial;
  rootInstance.render(React.createElement(CanvasApp, { initial }));
}

async function start(): Promise<void> {
  const root = document.querySelector("#excalidrawRoot");
  if (!root || embedded || rootInstance) return;
  const initial = await transport.loadBoard();
  renderCanvas(initial);
  status.send("loaded");
  if (!embedded) initWelcome(initial);
}

window.DoodleExcalidrawInit = (snapshot, mcpApp) => {
  transport.setFallbackMcpApp(mcpApp as McpAppFallback | null);
  renderCanvas(snapshot);
  status.send("loaded");
};

if (document.querySelector("#excalidrawRoot")) {
  initThemeToggle(() => glassController);
  initExternalLinkPolicy();
  initLibraryUi({
    transport,
    getActiveSnapshot: () => activeSnapshot,
    applyRemoteSnapshot,
  });
  initSnapshotExports({
    transport,
    getApi: () => apiRef.current,
    getFiles: () => currentFiles.current,
  });
  transport.initNotifyButton(() => activeSnapshot);
  glassController = initLiquidGlass();
  void transport.startLiveUpdates({
    isBusy: () => applyingRemote.current || isEditing(currentAppState.current),
    onSnapshot: (data) => applyRemoteSnapshot(data),
    onOfflineChange: (offline) => status.send(offline ? "offline" : "online"),
  }).catch(() => {});
  void start().catch((error) => showError(error));
}
