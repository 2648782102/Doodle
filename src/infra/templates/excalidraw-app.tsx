import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import {
  boardItemsFromExcalidrawBoard,
  boardItemsToExcalidrawSkeleton,
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
  updateScene: (scene: { elements?: unknown[]; appState?: Record<string, unknown> }) => void;
  getSceneElements: () => ExcalidrawLikeElement[];
  scrollToContent: (elements?: unknown[]) => void;
};

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
    activeSnapshot = data;
    applyingRemote.current = true;
    apiRef.current?.updateScene({ elements: toElements(data) });
    window.setTimeout(() => { applyingRemote.current = false; }, 0);
    void publishContext(data).catch(() => {});
  };
  await hostApp.connect();
  const timer = window.setInterval(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const result = await hostApp.callServerTool({ name: "get_board", arguments: {} });
      if (result.isError) return;
      const data = result.structuredContent as BoardSnapshot | undefined;
      if (!data || !Array.isArray(data.items) || typeof data.revision !== "number") return;
      if (activeSnapshot?.revision === data.revision && activeSnapshot.id === data.id) return;
      activeSnapshot = data;
      applyingRemote.current = true;
      apiRef.current?.updateScene({ elements: toElements(data) });
      window.setTimeout(() => { applyingRemote.current = false; }, 0);
      void publishContext(data).catch(() => {});
    } catch {}
  }, 4000);
  window.addEventListener("pagehide", () => window.clearInterval(timer), { once: true });
}

function toElements(snapshot: BoardSnapshot) {
  return convertToExcalidrawElements(boardItemsToExcalidrawSkeleton(snapshot.items as never[]), { regenerateIds: false });
}

async function loadBoard(): Promise<BoardSnapshot> {
  const response = await fetch("/api/board");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
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
  const initialData = useMemo(() => ({ elements: toElements(initial), appState: { viewBackgroundColor: "#fbfbfc" }, scrollToContent: true }), [initial]);

  useEffect(() => {
    activeSnapshot = snapshot;
  }, [snapshot]);

  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  useEffect(() => {
    window.DoodleExcalidrawUpdate = (next) => {
      applyingRemote.current = true;
      setSnapshot(next);
      apiRef.current?.updateScene({ elements: toElements(next) });
      window.setTimeout(() => { applyingRemote.current = false; }, 0);
    };
    return () => { window.DoodleExcalidrawUpdate = undefined; };
  }, []);

  const onChange = useCallback((elements: ExcalidrawLikeElement[]) => {
    if (!api || applyingRemote.current || !activeSnapshot) return;
    const projected = boardItemsFromExcalidrawBoard(activeSnapshot as never, elements);
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
          api.updateScene({ elements: toElements(refreshed) });
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
  void initHostApp().catch(() => {});
  void start().catch((error) => showError(error));
}
