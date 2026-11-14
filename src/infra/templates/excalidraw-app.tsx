import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import {
  boardToExcalidrawFiles,
  boardItemsFromExcalidrawBoard,
  boardItemsToExcalidrawSkeleton,
  type ExcalidrawFileData,
  type ExcalidrawLikeElement,
} from "../../board/excalidraw-adapter.js";
import { App } from "@modelcontextprotocol/ext-apps";
import { buildBoardModelContext } from "../../board/app-context.js";

type BoardSnapshot = {
  version: 1;
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  items: unknown[];
  library?: unknown;
  capabilities?: unknown;
  visualDigest?: unknown;
  [key: string]: unknown;
};

type ExcalidrawAPI = {
  updateScene: (scene: { elements?: unknown[]; appState?: Record<string, unknown>; captureUpdate?: string }) => void;
  getSceneElements: () => ExcalidrawLikeElement[];
  scrollToContent: (elements?: unknown[]) => void;
  addFiles: (files: ExcalidrawFileData[]) => void;
};

type ExcalidrawAppState = {
  editingTextElement?: unknown;
  editingLinearElement?: unknown;
  editingGroupId?: unknown;
};

function isEditing(appState: ExcalidrawAppState | undefined): boolean {
  return Boolean(appState?.editingTextElement || appState?.editingLinearElement || appState?.editingGroupId);
}

declare global {
  interface Window {
    DOODLE_EXCALIDRAW_TOKEN?: string;
    DoodleExcalidrawInit?: (snapshot: BoardSnapshot, mcpApp?: unknown) => void;
    DoodleExcalidrawUpdate?: (snapshot: BoardSnapshot) => void;
  }
}

const PANEL_TOKEN = window.DOODLE_EXCALIDRAW_TOKEN ?? "";
const headers = { "Content-Type": "application/json", "X-AI-Draw-Token": PANEL_TOKEN };
let activeSnapshot: BoardSnapshot | null = null;
let activeMcpApp: { drawBoard?: (args: Record<string, unknown>) => Promise<unknown> } | null = null;
const apiRef: { current: ExcalidrawAPI | null } = { current: null };
const applyingRemote = { current: false };
const currentFiles: { current: Record<string, ExcalidrawFileData> } = { current: {} };
const currentAppState: { current: ExcalidrawAppState } = { current: {} };
const pendingRemote: { current: BoardSnapshot | null } = { current: null };

function applyRemoteSnapshot(data: BoardSnapshot, refreshFiles = true) {
  if (!data || !Array.isArray(data.items) || typeof data.revision !== "number") return;
  if (activeSnapshot && data.revision <= activeSnapshot.revision && data.id === activeSnapshot.id) return;
  if (isEditing(currentAppState.current)) {
    pendingRemote.current = data;
    return;
  }
  activeSnapshot = data;
  applyingRemote.current = true;
  const files = refreshFiles ? toFiles(data) : [];
  if (refreshFiles) {
    currentFiles.current = Object.fromEntries(files.map((file) => [file.id, file]));
    apiRef.current?.addFiles(files);
  }
  apiRef.current?.updateScene({ elements: toElements(data), captureUpdate: "NEVER" });
  window.setTimeout(() => { applyingRemote.current = false; }, 0);
  void publishContext(data).catch(() => {});
}
const embedded = Boolean((window as unknown as { DOODLE_MCP_APP_EMBEDDED?: boolean }).DOODLE_MCP_APP_EMBEDDED);
const hostApp = embedded ? new App({ name: "Doodle", version: "1.0.0" }, { availableDisplayModes: ["inline", "fullscreen"] }) : null;
let publishedRevision = -1;

async function publishContext(snapshot: BoardSnapshot) {
  if (!hostApp || publishedRevision === snapshot.revision) return;
  const capabilities = hostApp.getHostCapabilities();
  if (!capabilities?.updateModelContext?.text) return;
  const context = buildBoardModelContext(snapshot as never, undefined, {
    includeStructuredContent: Boolean(capabilities.updateModelContext.structuredContent),
  });
  await hostApp.updateModelContext({
    content: context.content,
    ...(capabilities.updateModelContext.structuredContent ? { structuredContent: context.structuredContent } : {}),
  });
  publishedRevision = snapshot.revision;
}

async function initHostApp() {
  if (!hostApp) return;
  hostApp.ontoolresult = (result) => {
    if (result.isError) return;
    const data = result.structuredContent as BoardSnapshot | undefined;
    if (!data || !Array.isArray(data.items) || typeof data.revision !== "number") return;
    applyRemoteSnapshot(data);
  };
  await hostApp.connect();
  const timer = window.setInterval(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const result = await hostApp.callServerTool({ name: "get_board", arguments: {} });
      if (result.isError) return;
      const data = result.structuredContent as BoardSnapshot | undefined;
      if (!data || !Array.isArray(data.items) || typeof data.revision !== "number") return;
      applyRemoteSnapshot(data);
    } catch {}
  }, 4000);
  window.addEventListener("pagehide", () => window.clearInterval(timer), { once: true });
}

function connectStandaloneUpdates() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/ws`);
  socket.addEventListener("message", async (event) => {
    try {
      const message = JSON.parse(String(event.data));
      if (!message || !["board_updated", "board_library_updated"].includes(message.type)) return;
      const refreshed = await loadBoard().catch(() => null);
      if (refreshed) applyRemoteSnapshot(refreshed);
    } catch {}
  });
  socket.addEventListener("close", () => window.setTimeout(connectStandaloneUpdates, 750));
}

function toElements(snapshot: BoardSnapshot) {
  const items = snapshot.items as Array<Record<string, unknown>>;
  const sceneElements: Record<string, unknown>[] = [];
  const freshSkeletons = [];
  for (const item of items) {
    const scene = item.scene as { element?: Record<string, unknown>; boundText?: Record<string, unknown> } | undefined;
    if (scene?.element) {
      const element = { ...scene.element };
      delete element.index;
      delete element.version;
      delete element.versionNonce;
      sceneElements.push(element);
      if (scene.boundText) {
        const boundText = { ...scene.boundText };
        delete boundText.index;
        delete boundText.version;
        delete boundText.versionNonce;
        sceneElements.push(boundText);
      }
    } else {
      freshSkeletons.push(item);
    }
  }
  const converted = freshSkeletons.length
    ? convertToExcalidrawElements(boardItemsToExcalidrawSkeleton(freshSkeletons as never[]), { regenerateIds: false })
    : [];
  return [...sceneElements, ...converted];
}

function toFiles(snapshot: BoardSnapshot): ExcalidrawFileData[] {
  return Object.values(boardToExcalidrawFiles(snapshot as never));
}

async function loadBoard(): Promise<BoardSnapshot> {
  const response = await fetch("/api/board");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function libraryRequest(action: Record<string, unknown>) {
  if (hostApp) {
    const result = await hostApp.callServerTool({
      name: "draw_board",
      arguments: { library: action, expected_revision: activeSnapshot?.revision ?? 0 },
    });
    if (result.isError) throw new Error("Library action failed");
    return result.structuredContent as Record<string, unknown>;
  }
  const response = await fetch("/api/board/library", {
    method: "POST",
    headers,
    body: JSON.stringify({ confirmedBy: "human", action }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result as Record<string, unknown>;
}

async function refreshLibraryUi() {
  const panel = document.querySelector<HTMLElement>("#doodleLibraryPanel");
  const list = document.querySelector<HTMLElement>("#doodleLibraryList");
  const current = document.querySelector<HTMLElement>("#doodleLibraryCurrent");
  const name = document.querySelector<HTMLInputElement>("#doodleLibraryName");
  if (!panel || panel.hidden || !list || !current) return;
  const board = await loadBoard();
  const index = board.library as { activeId?: string; boards?: Array<{ id: string; name: string; revision: number; itemCount: number }> } | undefined;
  const boards = index?.boards ?? [];
  current.textContent = `当前：${boards.find((entry) => entry.id === index?.activeId)?.name ?? "—"} · ${board.items.length} 个对象`;
  if (name && document.activeElement !== name) name.value = boards.find((entry) => entry.id === index?.activeId)?.name ?? "";
  list.replaceChildren();
  let selectedId = index?.activeId ?? "";
  for (const entry of boards) {
    const row = document.createElement("div");
    row.className = "doodle-library-entry";
    row.classList.toggle("active", entry.id === index?.activeId);
    const button = document.createElement("button");
    button.textContent = entry.name;
    const meta = document.createElement("small");
    meta.textContent = `${entry.itemCount} 个对象 · rev ${entry.revision}`;
    button.append(meta);
    button.addEventListener("click", () => {
      selectedId = entry.id;
      for (const child of list.children) child.classList.toggle("active", child === row);
    });
    button.addEventListener("dblclick", () => void runLibraryAction({ type: "switch", id: entry.id }));
    const exportButton = document.createElement("button");
    exportButton.textContent = "导出";
    exportButton.addEventListener("click", () => void runLibraryAction({ type: "export", id: entry.id }));
    row.append(button, exportButton);
    list.append(row);
  }
  const switchButton = document.querySelector<HTMLButtonElement>("#doodleLibrarySwitch");
  if (switchButton) switchButton.onclick = () => void runLibraryAction({ type: "switch", id: selectedId });
}

async function runLibraryAction(action: Record<string, unknown>) {
  const name = document.querySelector<HTMLInputElement>("#doodleLibraryName")?.value.trim();
  const result = await libraryRequest({ ...action, ...(name && ["save", "create", "rename", "duplicate"].includes(String(action.type)) ? { name } : {}) });
  const board = (result.board as BoardSnapshot | undefined) ?? await loadBoard();
  applyRemoteSnapshot(board);
  if (action.type === "export" || action.type === "get") {
    const exportBoard = (result.exportBoard as BoardSnapshot | undefined) ?? board;
    const blob = new Blob([JSON.stringify(exportBoard, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(board.title || "doodle-board").replace(/[\\/:*?"<>|]/g, "_")}.doodle.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  await refreshLibraryUi().catch(() => {});
}

function initLibraryUi() {
  const toggle = document.querySelector<HTMLButtonElement>("#doodleLibraryToggle");
  const panel = document.querySelector<HTMLElement>("#doodleLibraryPanel");
  const close = document.querySelector<HTMLButtonElement>("#doodleLibraryClose");
  const file = document.querySelector<HTMLInputElement>("#doodleLibraryFile");
  if (!toggle || !panel || !close || !file) return;
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) void refreshLibraryUi().catch(() => {});
  });
  close.addEventListener("click", () => { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); });
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-library-action]")) {
    button.addEventListener("click", () => void runLibraryAction({ type: button.dataset.libraryAction }).catch((error) => showError(error)));
  }
  document.querySelector<HTMLButtonElement>("#doodleLibraryImport")?.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const imported = file.files?.[0];
    if (!imported) return;
    try {
      const parsed = JSON.parse(await imported.text());
      await runLibraryAction({ type: "import", board: parsed, switchTo: true, name: parsed.title || imported.name.replace(/\.json$/i, "") });
    } catch (error) {
      showError(error);
    } finally {
      file.value = "";
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) panel.hidden = true;
  });
}

async function replaceBoard(items: unknown[], expectedRevision: number): Promise<BoardSnapshot> {
  if (hostApp) {
    const result = await hostApp.callServerTool({
      name: "draw_board",
      arguments: { replace_board: { ...activeSnapshot, items, notes: [] }, expected_revision: expectedRevision },
    });
    if (result.isError) throw new Error("Board update failed");
    return result.structuredContent as BoardSnapshot;
  }
  if (activeMcpApp?.drawBoard) {
    const result = await activeMcpApp.drawBoard({
      replace_board: { ...activeSnapshot, items, notes: [] },
      expected_revision: expectedRevision,
    });
    return result as BoardSnapshot;
  }
  const response = await fetch("/api/board/replace", {
    method: "POST",
    headers: { ...headers, "If-Match-Revision": String(expectedRevision) },
    body: JSON.stringify({ confirmedBy: "human", board: { ...activeSnapshot, items, notes: [] } }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result.board as BoardSnapshot;
}

function showError(error: unknown) {
  console.warn("Doodle board sync skipped", error);
}

function CanvasApp({ initial }: { initial: BoardSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const pendingTimer = useRef<number | null>(null);
  const [api, setApi] = useState<ExcalidrawAPI | null>(null);
  const initialData = useMemo(() => {
    const files = toFiles(initial);
    currentFiles.current = Object.fromEntries(files.map((file) => [file.id, file]));
    return {
      elements: toElements(initial),
      files: currentFiles.current,
      appState: { viewBackgroundColor: "#fbfbfc" },
      scrollToContent: true,
    };
  }, [initial]);

  useEffect(() => {
    activeSnapshot = snapshot;
  }, [snapshot]);

  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  useEffect(() => {
    window.DoodleExcalidrawUpdate = (next) => applyRemoteSnapshot(next);
    return () => { window.DoodleExcalidrawUpdate = undefined; };
  }, []);

  const onChange = useCallback((elements: ExcalidrawLikeElement[], appState: ExcalidrawAppState, files: Record<string, ExcalidrawFileData>) => {
    currentAppState.current = appState;
    Object.assign(currentFiles.current, files);
    if (!api || applyingRemote.current || !activeSnapshot) return;
    if (isEditing(appState)) return;
    if (pendingRemote.current) {
      applyRemoteSnapshot(pendingRemote.current);
      pendingRemote.current = null;
      return;
    }
    const projected = boardItemsFromExcalidrawBoard(
      activeSnapshot as never,
      elements,
      currentFiles.current,
    );
    if (JSON.stringify(projected.items) === JSON.stringify(activeSnapshot.items)) return;
    if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current);
    pendingTimer.current = window.setTimeout(async () => {
      pendingTimer.current = null;
      const before = activeSnapshot;
      if (!before) return;
      try {
        const updated = await replaceBoard(projected.items as unknown[], before.revision);
        setSnapshot(updated);
      } catch (error) {
        const refreshed = await loadBoard().catch(() => null);
        if (refreshed) {
          applyingRemote.current = true;
          setSnapshot(refreshed);
          const files = toFiles(refreshed);
          currentFiles.current = Object.fromEntries(files.map((file) => [file.id, file]));
          api.addFiles(files);
          api.updateScene({ elements: toElements(refreshed), captureUpdate: "NEVER" });
          window.setTimeout(() => { applyingRemote.current = false; }, 0);
        }
        showError(error);
      }
    }, 450);
  }, [api]);

  return React.createElement(
    "div",
    { className: "excalidraw-host" },
    React.createElement(Excalidraw, {
      excalidrawAPI: (candidate: ExcalidrawAPI) => setApi(candidate),
      initialData,
      onChange,
      langCode: "zh-CN",
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
      },
    }),
  );
}

async function start() {
  const root = document.querySelector("#excalidrawRoot");
  if (!root) return;
  const initial = await loadBoard();
  activeSnapshot = initial;
  createRoot(root).render(React.createElement(CanvasApp, { initial }));
}

window.DoodleExcalidrawInit = (snapshot, mcpApp) => {
  activeSnapshot = snapshot;
  activeMcpApp = mcpApp as typeof activeMcpApp;
  const root = document.querySelector("#excalidrawRoot");
  if (!root) return;
  createRoot(root).render(React.createElement(CanvasApp, { initial: snapshot }));
};

if (document.querySelector("#excalidrawRoot")) {
  initLibraryUi();
  if (embedded) void initHostApp().catch(() => {});
  else connectStandaloneUpdates();
  void start().catch((error) => showError(error));
}
