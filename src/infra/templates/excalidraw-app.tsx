import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import {
  boardItemsFromExcalidrawBoard,
  boardItemsToExcalidrawSkeleton,
  type ExcalidrawLikeElement,
} from "../../board/excalidraw-adapter.js";

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

function toElements(snapshot: BoardSnapshot) {
  return convertToExcalidrawElements(boardItemsToExcalidrawSkeleton(snapshot.items as never[]), { regenerateIds: false });
}

async function loadBoard(): Promise<BoardSnapshot> {
  const response = await fetch("/api/board");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function replaceBoard(items: unknown[], expectedRevision: number): Promise<BoardSnapshot> {
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

function showToast(message: string) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 1800);
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
        showToast("已同步到 Doodle 画板");
      } catch (error) {
        const refreshed = await loadBoard().catch(() => null);
        if (refreshed) {
          applyingRemote.current = true;
          setSnapshot(refreshed);
          api.updateScene({ elements: toElements(refreshed) });
          window.setTimeout(() => { applyingRemote.current = false; }, 0);
        }
        showToast(error instanceof Error ? error.message : String(error));
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

if (document.querySelector("#excalidrawRoot")) void start().catch((error) => showToast(error.message));
