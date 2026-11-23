/**
 * Excalidraw canvas entrypoint: wires the split client modules (`transport`,
 * `theme`, `link-policy`, `banner`, `library-ui`, `sync-state`, `canvas-sync`)
 * and mounts the React canvas.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw } from "@excalidraw/excalidraw";
import {
  boardItemsFromExcalidrawBoard,
  type ExcalidrawFileData,
  type ExcalidrawLikeElement,
} from "../../board/excalidraw-adapter.js";
import { buildInitialScene, firstPaint, frameFirstPaint, frameNewBoard, remeasureTextAfterFonts, toElements, toFiles, usableViewport } from "./client/canvas-view.js";
import { initLiquidGlass, type LiquidGlassController } from "./liquid-glass.js";
import {
  clearConflictNotice,
  clearError,
  dismissWelcome,
  initWelcome,
  showConnectionNotice,
  showConflictNotice,
  showError,
} from "./client/banner.js";
import { createCanvasSync, type CanvasSync, type CanvasSyncOutcome, type SceneElement } from "./client/canvas-sync.js";
import { initShortcutPanel } from "./client/shortcuts.js";
import { stableStringify } from "../../board/model/fingerprint.js";
import { browserBoardCache } from "./client/board-cache.js";
import { registerOfflineShell, runBoot } from "./client/boot-source.js";
import { createPendingEdits, localPendingStorage, pendingEditOf } from "./client/pending-edits.js";
import { recoverCanvasEdits } from "./client/recover-edits.js";
import { RECONNECT_COPY } from "./client/reconnect.js";
import { initLibraryUi, initSnapshotExports } from "./client/library-ui.js";
import { initExternalLinkPolicy, isDoodleProjectLink } from "./client/link-policy.js";
import { createSyncChip } from "./client/sync-state.js";
import { presentRecoveredConflict, presentWriteFailure } from "./client/write-recovery.js";
import {
  EXCALIDRAW_THEME,
  canvasColors,
  initThemeToggle,
  isDoodleTheme,
  readTheme,
  type DoodleTheme,
} from "./client/theme.js";
import { BoardWriteError, createBoardTransport } from "./client/transport.js";
import {
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
  cache: browserBoardCache(),
});
/** The person's unsent edits, so a reload or a reconnect can still recover them. */
const pendingEdits = createPendingEdits(localPendingStorage());
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
/** The live canvas' write queue, so a board switch can drop what it would have written. */
const canvasSync: { current: CanvasSync | null } = { current: null };
/** Which board the live scene currently shows, so a repaint can tell a switch from a rebase. */
const paintedBoardId: { current: string | null } = { current: null };
/**
 * Excalidraw fires `onChange` while it is still mounting, before the scene we
 * passed in has been applied. Wait for the first non-empty scene before
 * treating any change as a human edit.
 */
const sceneReady = { current: false };

/** Paint the scene from `activeSnapshot`, and remember that this is its provenance. */
function repaintFromActive(): void {
  const snapshot = activeSnapshot;
  if (!snapshot || isEditing(currentAppState.current)) return;
  const switched = paintedBoardId.current !== snapshot.id;
  sceneBase = snapshot;
  paintedBoardId.current = snapshot.id;
  pendingRepaint.current = false;
  applyingRemote.current = true;
  sceneReady.current = true;
  const files = toFiles(snapshot);
  currentFiles.current = Object.fromEntries(files.map((file) => [file.id, file]));
  apiRef.current?.addFiles(files);
  apiRef.current?.updateScene({ elements: toElements(snapshot, readTheme()), captureUpdate: "NEVER" });
  window.setTimeout(() => { applyingRemote.current = false; }, 0);
  /*
   * Switching boards in place keeps the live canvas component, so the saved
   * camera from `initialData` is never consulted again. Restore it here or every
   * board opens at wherever the previous one was scrolled to — and a board whose
   * content sits elsewhere then looks blank.
   *
   * Only on a switch: a rebase repaints the same board, and the person may have
   * panned since their camera was last written to storage, so restoring there
   * would yank the view out from under them.
   */
  if (switched && apiRef.current) frameNewBoard(apiRef.current, snapshot);
}

function publishToHost(snapshot: BoardSnapshot): void {
  void transport.publishContext(snapshot)
    .then((published) => { if (published) status.send("published"); })
    .catch(() => {});
}

/** Adopt a board that arrived from somewhere else. See `docs/DECISIONS.md` #44. */
function applyRemoteSnapshot(data: BoardSnapshot, options: { repaint?: boolean } = {}): void {
  if (!data || !Array.isArray(data.items) || typeof data.revision !== "number") return;
  if (activeSnapshot && data.revision <= activeSnapshot.revision && data.id === activeSnapshot.id) return;
  /*
   * `repaint: false` is only ever the same board mid-gesture: the scene still
   * shows the older revision and the rebase reconciles them on the next write.
   * Carrying it across boards is a data migration, not a rebase.
   */
  if (options.repaint === false && activeSnapshot && data.id === activeSnapshot.id) {
    activeSnapshot = data;
    pendingRepaint.current = true;
    return;
  }
  if (isEditing(currentAppState.current)) {
    pendingRemote.current = data;
    return;
  }
  // Leaving a board abandons its pending frame: the board we are leaving keeps
  // its stored state rather than receiving another board's projection.
  if (activeSnapshot && data.id !== activeSnapshot.id) {
    canvasSync.current?.cancel();
    pendingRemote.current = null;
    pendingRepaint.current = false;
  }
  activeSnapshot = data;
  if (data.items.length > 0) dismissWelcome();
  repaintFromActive();
  publishToHost(data);
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
      // A rebase leaves the scene behind; converge once the write is safely in, never mid-gesture.
      if ((info.rebased || info.dropped > 0 || pendingRepaint.current) && !isEditing(currentAppState.current)) {
        repaintFromActive();
      }
    },
    report: (event) => { status.send(event); },
    onError: (error, retry) => presentWriteFailure(error, {
      status,
      loadLatest: () => transport.loadBoard().catch(() => null),
      applyRemote: (snapshot) => applyRemoteSnapshot(snapshot),
      retry,
    }),
    // Both boards, not the request: a verbatim replay is unsafe once anyone
    // else has drawn, while base + result can be merged. See `three-way-merge`.
    persistUnsent: ({ base, mine }) => {
      const edit = pendingEditOf(base, mine);
      if (edit) void pendingEdits.save(edit);
    },
    clearUnsent: (boardId) => { void pendingEdits.drop(boardId); },
    debounceMs: 450,
  }), []);
  canvasSync.current = sync;

  const initialData = useMemo(() => {
    const scene = buildInitialScene(initial, theme);
    currentFiles.current = scene.files;
    return scene.data;
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
      frameFirstPaint(api, activeSnapshot, firstPaint);
    }
  }, [api, theme]);

  useEffect(() => {
    if (!api) return;
    return remeasureTextAfterFonts(
      api,
      () => activeSnapshot,
      theme,
      () => { applyingRemote.current = true; },
      () => { window.setTimeout(() => { applyingRemote.current = false; }, 0); },
    );
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
    /*
     * Key the camera by the board the scene is showing, not the active one.
     *
     * Right after a switch, `activeSnapshot` is already the new board while the
     * scene still paints the old one until the repaint lands. Saving under the
     * active id there writes the old board's camera into the new board's entry,
     * and both boards then open in the wrong place.
     */
    rememberViewport(paintedBoardId.current ?? activeSnapshot?.id, appState);
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
    /*
     * Values, not key order. The projection rebuilds every item, so its key
     * order differs from the stored board even when nothing moved; comparing
     * raw strings made a pan look like an edit and scheduled a write.
     */
    if (stableStringify(projected.items) === stableStringify(activeSnapshot.items)) {
      /*
       * Nothing of the person's to write. If a remote board was only adopted as
       * the baseline (no repaint), the scene is still showing the older one, so
       * this is the last chance to converge without waiting for another edit.
       */
      if (pendingRepaint.current) repaintFromActive();
      return;
    }
  if (projected.items.length > 0) dismissWelcome();
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
  paintedBoardId.current = initial.id;
  rootInstance.render(React.createElement(CanvasApp, { initial }));
}

async function start(): Promise<void> {
  const root = document.querySelector("#excalidrawRoot");
  if (!root || embedded || rootInstance) return;
  const result = await runBoot({
    embedded,
    restoreCached: () => transport.restoreBoard(),
    loadRemote: () => transport.loadBoard(),
    paint: (snapshot) => renderCanvas(snapshot),
    onLoaded: () => status.send("loaded"),
    onWelcome: (snapshot) => initWelcome(snapshot), // gated on `embedded` by `runBoot`
    onDetached: () => {
      status.send("detached");
      showConnectionNotice(RECONNECT_COPY.detachedOnBoot);
    },
  });
  // Unreachable boards keep their edits on disk for the next boot that can merge.
  if (result !== "detached") await recoverPendingWork();
}

/**
 * Re-apply edits that could not be written before the last reload or outage.
 *
 * Runs after the board is on screen so a merge can never paint over the canvas
 * mid-boot. The recovery contract itself lives in `client/recover-edits.ts`;
 * this only supplies the canvas' own surfaces.
 */
async function recoverPendingWork(): Promise<void> {
  await recoverCanvasEdits({
    pending: pendingEdits,
    activeBoard: activeSnapshot,
    loadBoard: () => transport.loadBoard(),
    applyMerged: (change, expectedRevision) => transport.applyMergedChange(change, expectedRevision),
    refresh: () => { void transport.loadBoard().then((refreshed) => applyRemoteSnapshot(refreshed)).catch(() => {}); },
    onConflict: (conflicts) => presentRecoveredConflict(conflicts, status, clearConflictNotice),
  });
}

/**
 * What the canvas does when the live channel comes back.
 *
 * Coming back is when unsent edits can finally be merged. Recovery used to run
 * only in `start()`, so a page that stayed open through an outage never retried
 * its pending edit — the person saw "online" and assumed their work had landed.
 */
function onConnectivityChange(offline: boolean): void {
  status.send(offline ? "offline" : "online");
  if (!offline && !isEditing(currentAppState.current)) void recoverPendingWork();
}

window.DoodleExcalidrawInit = (snapshot, mcpApp) => {
  transport.setFallbackMcpApp(mcpApp as McpAppFallback | null);
  renderCanvas(snapshot);
  status.send("loaded");
};

if (document.querySelector("#excalidrawRoot")) {
  registerOfflineShell(embedded);
  initThemeToggle(() => glassController);
  initExternalLinkPolicy();
  initShortcutPanel();
  initLibraryUi({
    transport,
    getActiveSnapshot: () => activeSnapshot,
    applyRemoteSnapshot,
    flushPendingWrites: () => canvasSync.current?.flush() ?? Promise.resolve("idle"),
  });
  initSnapshotExports({
    transport,
    getApi: () => apiRef.current,
    getFiles: () => currentFiles.current,
  });
  transport.initNotifyButton(
    () => activeSnapshot,
    () => { status.send("notified"); },
  );
  glassController = initLiquidGlass();
  void transport.startLiveUpdates({
    isBusy: () => applyingRemote.current || isEditing(currentAppState.current),
    onSnapshot: (data) => applyRemoteSnapshot(data),
    onOfflineChange: (offline) => { onConnectivityChange(offline); },
    onDetached: () => status.send("detached"),
  }).catch(() => {});
  void start().catch((error) => showError(error));
}
