import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, convertToExcalidrawElements, exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import {
  boardToExcalidrawFiles,
  boardItemsFromExcalidrawBoard,
  boardItemsToExcalidrawSkeleton,
  type ExcalidrawFileData,
  type ExcalidrawLikeElement,
} from "../../board/excalidraw-adapter.js";
import { App } from "@modelcontextprotocol/ext-apps";
import { diffBoardItems, isEmptyDiff } from "../../board/item-diff.js";
import { buildBoardModelContext } from "../../board/app-context.js";
import {
  browserViewportStorage,
  isViewportNearContent,
  readStoredViewport,
  writeStoredViewport,
} from "../../board/viewport-memory.js";
import { initLiquidGlass, type LiquidGlassController } from "./liquid-glass.js";

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
  getAppState?: () => Record<string, unknown>;
  getFiles?: () => Record<string, ExcalidrawFileData>;
};

type ExcalidrawAppState = {
  editingTextElement?: unknown;
  editingLinearElement?: unknown;
  editingGroupId?: unknown;
  scrollX?: number;
  scrollY?: number;
  zoom?: { value?: number } | number;
};

let viewportSaveTimer: number | null = null;

/** Bounding box of the board's objects, used to judge a remembered camera. */
function boardBounds(items: unknown[]): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const raw of items) {
    const item = raw as { x?: number; y?: number; w?: number; h?: number };
    if (typeof item.x !== "number" || typeof item.y !== "number") continue;
    const width = typeof item.w === "number" ? item.w : 0;
    const height = typeof item.h === "number" ? item.h : 0;
    minX = Math.min(minX, item.x, item.x + width);
    minY = Math.min(minY, item.y, item.y + height);
    maxX = Math.max(maxX, item.x, item.x + width);
    maxY = Math.max(maxY, item.y, item.y + height);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : undefined;
}

/** Save the camera at most a few times a second; it changes on every pan frame. */
function rememberViewport(boardId: string | undefined, appState: ExcalidrawAppState): void {
  if (!boardId) return;
  const zoom = typeof appState.zoom === "number" ? appState.zoom : appState.zoom?.value;
  if (typeof appState.scrollX !== "number" || typeof appState.scrollY !== "number" || typeof zoom !== "number") return;
  const storage = browserViewportStorage();
  if (!storage) return;
  if (viewportSaveTimer !== null) return;
  viewportSaveTimer = window.setTimeout(() => {
    viewportSaveTimer = null;
    writeStoredViewport(storage, boardId, { scrollX: appState.scrollX!, scrollY: appState.scrollY!, zoom });
  }, 600);
}

function isEditing(appState: ExcalidrawAppState | undefined): boolean {
  return Boolean(appState?.editingTextElement || appState?.editingLinearElement || appState?.editingGroupId);
}

declare global {
  interface Window {
    DOODLE_EXCALIDRAW_TOKEN?: string;
    DOODLE_THEME?: DoodleTheme;
    DoodleExcalidrawInit?: (snapshot: BoardSnapshot, mcpApp?: unknown) => void;
    DoodleExcalidrawUpdate?: (snapshot: BoardSnapshot) => void;
  }
}

const PANEL_TOKEN = window.DOODLE_EXCALIDRAW_TOKEN ?? "";
const headers = { "Content-Type": "application/json", "X-AI-Draw-Token": PANEL_TOKEN };
let glassController: LiquidGlassController | null = null;
let activeSnapshot: BoardSnapshot | null = null;
let activeMcpApp: { drawBoard?: (args: Record<string, unknown>) => Promise<unknown> } | null = null;
const apiRef: { current: ExcalidrawAPI | null } = { current: null };
const applyingRemote = { current: false };
const currentFiles: { current: Record<string, ExcalidrawFileData> } = { current: {} };
const currentAppState: { current: ExcalidrawAppState } = { current: {} };
const pendingRemote: { current: BoardSnapshot | null } = { current: null };
const pendingTimer: { current: number | null } = { current: null };
/**
 * Excalidraw fires `onChange` while it is still mounting, before the scene we
 * passed in has been applied. Writing that empty scene back would erase a board
 * that loaded fine a moment earlier, so the first real scene has to arrive
 * before any change is treated as a human edit.
 */
const sceneReady = { current: false };

/**
 * Every appearance Doodle ships, in switcher order.
 *
 * This array is the single source of truth: the type is derived from it, the
 * switcher renders it, and `readTheme` validates against it. Adding a fourth
 * appearance is a one-line change here plus a token block in the template —
 * no `if (theme === …)` chain to thread through.
 */
const THEMES = [
  { id: "light", label: "浅色", hint: "纸面与铅笔" },
  { id: "dark", label: "深色", hint: "夜纸与浅墨" },
  { id: "glass", label: "液态玻璃", hint: "暖纸与松绿" },
] as const;

type DoodleTheme = (typeof THEMES)[number]["id"];

const THEME_IDS = THEMES.map((theme) => theme.id) as readonly DoodleTheme[];

function isDoodleTheme(value: unknown): value is DoodleTheme {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}
const THEME_STORAGE_KEY = "doodle-theme";
const DOODLE_PROJECT_URL = "https://github.com/2648782102/Doodle";
/**
 * The canvas ground for each appearance.
 *
 * `view` is always transparent: the page behind the canvas is painted by
 * `--doodle-canvas-bg`, so one transparent canvas works for every theme and a
 * theme switch never has to reinitialise Excalidraw. `export` is opaque
 * because a PNG with a transparent background is unreadable in most viewers.
 *
 * The paper themes keep their sheet colour as the export ground, while the
 * glass theme exports on the old warm white — a board exported to PNG should
 * look like the same drawing, not a different colour grade.
 */
const canvasColors: Record<DoodleTheme, { view: string; export: string }> = {
  /*
   * Export ground follows the sheet, not the chrome. A paper light board
   * exported onto the old glass white would come back a different colour than
   * the one the person drew on.
   */
  light: { view: "transparent", export: "#faf7f0" },
  dark: { view: "transparent", export: "#faf7f0" },
  glass: { view: "transparent", export: "#f7f8f5" },
};

function isDoodleProjectLink(link: unknown): boolean {
  if (typeof link !== "string") return false;
  try {
    const url = new URL(link);
    const project = new URL(DOODLE_PROJECT_URL);
    return url.protocol === project.protocol &&
      url.hostname === project.hostname &&
      (url.pathname === project.pathname || url.pathname.startsWith(`${project.pathname}/`));
  } catch {
    return false;
  }
}

function blockExternalCanvasLinks(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!target || !target.closest(".excalidraw")) return;
  const href = target.getAttribute("href");
  if (!href || href.startsWith("#") || isDoodleProjectLink(href)) return;
  event.preventDefault();
  event.stopPropagation();
}

function hideExternalEmbedTool(): void {
  const selector = '.dropdown-menu.App-toolbar__extra-tools-dropdown button[data-testid="toolbar-embeddable"]';
  for (const button of document.querySelectorAll<HTMLElement>(selector)) {
    const external = !button.textContent?.includes("Mermaid");
    if (external) {
      button.dataset.doodleHidden = "true";
      button.setAttribute("aria-hidden", "true");
    }
  }
  for (const node of document.querySelectorAll<HTMLElement>(
    ".dropdown-menu.App-toolbar__extra-tools-dropdown .dropdown-menu-container > *",
  )) {
    const text = node.textContent?.trim() ?? "";
    if (text === "Generate" || text.startsWith("Mermaid") || text.startsWith("生成")) {
      node.dataset.doodleHidden = "true";
      node.setAttribute("aria-hidden", "true");
    }
  }
  for (const link of document.querySelectorAll<HTMLElement>(".excalidraw .library-menu-browse-button")) {
    link.dataset.doodleHidden = "true";
    link.setAttribute("aria-hidden", "true");
  }
}

function initExternalLinkPolicy(): void {
  document.addEventListener("click", blockExternalCanvasLinks, true);
  const apply = () => {
    hideExternalEmbedTool();
    // Any link group that is not the project itself is upstream chrome
    // (Socials, blog, docs). The board ships no outbound links of its own.
    for (const group of document.querySelectorAll<HTMLElement>(".excalidraw .dropdown-menu-group")) {
      if (group.querySelector("a[href]")) {
        group.dataset.doodleHidden = "true";
      }
    }
  };
  const observer = new MutationObserver(apply);
  observer.observe(document.body, { childList: true, subtree: true });
  apply();
}

function readTheme(): DoodleTheme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    // An unknown value — a future theme removed, or a hand-edited key — must
    // fall back rather than leave the page with no token block at all.
    return isDoodleTheme(stored) ? stored : "light";
  } catch {
    return "light";
  }
}

/**
 * Excalidraw inverts element colours when its own theme is dark. That is right
 * for a whiteboard owner who wants a dark UI, but wrong here: a board stores the
 * colours a person chose, and inverting them made a yellow card render as dark
 * brown with light text, or disappear. Doodle therefore keeps Excalidraw on the
 * light theme so element colours are literal, and paints the dark page itself
 * with `--doodle-canvas-bg`.
 */
const EXCALIDRAW_THEME = "light" as const;

function applyTheme(theme: DoodleTheme, animate = false): void {
  /*
   * Re-selecting the active appearance is a no-op. Without this guard a click
   * on the pressed segment still dispatches doodle-theme-change, which rebuilds
   * every pane's SVG refraction map and recolours the whole scene for no visual
   * change. The first call has no dataset yet and must still apply the theme.
   */
  if (document.documentElement.dataset.doodleTheme === theme) return;
  if (animate) {
    /*
     * Only an explicit switch animates. The first paint applies the stored
     * theme synchronously, so a reload never flashes the wrong palette or
     * eases every surface in from the default tokens.
     */
    document.documentElement.classList.add("theme-switching");
    window.setTimeout(() => document.documentElement.classList.remove("theme-switching"), 260);
  }
  document.documentElement.dataset.doodleTheme = theme;
  /*
   * Light and dark are the paper desk; only the glass appearance refracts.
   *
   * The two paper appearances differ in luminance, not in material, so the
   * material switch keys off the single glass id rather than enumerating the
   * paper ones — adding another paper tone does not have to touch this.
   */
  document.documentElement.dataset.doodleMaterial = theme === "glass" ? "glass" : "paper";
  window.DOODLE_THEME = theme;
  syncThemeSwitcher(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {}
  window.dispatchEvent(new CustomEvent("doodle-theme-change", { detail: theme }));
}

/**
 * Reflect the active theme on the switcher.
 *
 * The control is a group of three buttons rather than one toggle: with three
 * appearances a single button no longer tells you what you will get, and the
 * old two-state icon had no room for a third state. `aria-pressed` carries the
 * selection so a screen reader announces the current theme.
 */
function syncThemeSwitcher(theme: DoodleTheme): void {
  const active = THEMES.find((entry) => entry.id === theme) ?? THEMES[0];
  const group = document.querySelector<HTMLElement>("#doodleThemeToggle");
  if (group) {
    group.setAttribute("aria-label", `外观：${active.label}`);
    group.title = `外观：${active.label}（${active.hint}）`;
    for (const button of group.querySelectorAll<HTMLButtonElement>("[data-theme-option]")) {
      const selected = button.dataset.themeOption === theme;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
  }
}

function initThemeToggle(): void {
  applyTheme(readTheme());
  const group = document.querySelector<HTMLElement>("#doodleThemeToggle");
  group?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-theme-option]");
    if (button && isDoodleTheme(button.dataset.themeOption)) applyTheme(button.dataset.themeOption, true);
  });
  window.addEventListener("doodle-theme-change", () => {
    // Frames are throttled: a theme flip recomputes every pane once.
    requestAnimationFrame(() => glassController?.refresh());
  });
}

const WELCOME_STORAGE_KEY = "doodle-welcome-dismissed";

/**
 * Teach the first empty board once.
 *
 * A blank canvas is the moment a person decides whether the tool is obvious.
 * The card appears only when the board is empty and has not been dismissed
 * before, so it never competes with real content or repeats itself.
 */
function initWelcome(snapshot: BoardSnapshot): void {
  const card = document.querySelector<HTMLElement>("#doodleWelcome");
  const dismiss = document.querySelector<HTMLButtonElement>("#doodleWelcomeDismiss");
  if (!card || !dismiss) return;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(WELCOME_STORAGE_KEY) === "1";
  } catch {}
  if (dismissed || snapshot.items.length > 0) return;
  const hide = () => {
    card.hidden = true;
    try {
      localStorage.setItem(WELCOME_STORAGE_KEY, "1");
    } catch {}
  };
  dismiss.addEventListener("click", hide);
  card.hidden = false;
}

function applyRemoteSnapshot(data: BoardSnapshot, refreshFiles = true) {
  if (!data || !Array.isArray(data.items) || typeof data.revision !== "number") return;
  if (activeSnapshot && data.revision <= activeSnapshot.revision && data.id === activeSnapshot.id) return;
  if (isEditing(currentAppState.current)) {
    pendingRemote.current = data;
    return;
  }
  if (pendingTimer.current !== null) {
    window.clearTimeout(pendingTimer.current);
    pendingTimer.current = null;
  }
  activeSnapshot = data;
  applyingRemote.current = true;
  sceneReady.current = true;
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
    /*
     * Never poll while a write is in flight or the pointer is mid-gesture.
     *
     * The poll asks for `include_canvas_fidelity`, which is the expensive
     * shape: every item carries its full Excalidraw `scene`. Firing that during
     * a drag means the response lands mid-gesture, `applyRemoteSnapshot` sees an
     * older revision and throws the payload away — all cost, no benefit. The
     * board also broadcasts its own change through the host tool result, so a
     * skipped tick is caught by the next one.
     */
    if (applyingRemote.current || isEditing(currentAppState.current)) return;
    try {
      // The canvas rebuilds its scene from items, so it must ask for the
      // Excalidraw fidelity that agent-facing reads deliberately omit.
      const result = await hostApp.callServerTool({ name: "get_board", arguments: { include_canvas_fidelity: true, include_guide: false } });
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

/**
 * Which *canvas* semantics an appearance needs.
 *
 * The adapter decides ink and paper from whether the ground is light or dark;
 * it has no concept of a third appearance and should not grow one, because
 * board rendering must stay identical no matter which chrome the person
 * picked. The paper light and glass appearances sit on light ground; only
 * the dark paper appearance maps to the dark canvas.
 */
function canvasThemeFor(theme: DoodleTheme): "light" | "dark" {
  return theme === "dark" ? "dark" : "light";
}

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
      return Number(isBackdrop(leftMeta.role, leftMeta.variant)) - Number(isBackdrop(rightMeta.role, rightMeta.variant));
    });
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
  for (const entry of boards) {
    const row = document.createElement("div");
    row.className = "doodle-library-entry";
    row.classList.toggle("active", entry.id === index?.activeId);
    const button = document.createElement("button");
    button.className = "doodle-library-entry-main";
    button.textContent = entry.name;
    const meta = document.createElement("small");
    meta.textContent = `${entry.itemCount} 个对象 · rev ${entry.revision}`;
    button.append(meta);
    /*
     * One click opens the board.
     *
     * The list used to have three ways to do the same thing — click to select,
     * double-click to open, and a footer button to open the selection — which
     * is why the panel needed a "切换到选中" row that read like a leftover. A
     * board list is a navigation control: clicking a board opens it.
     */
    button.addEventListener("click", () => void runLibraryAction({ type: "switch", id: entry.id }));
    /*
     * Per-row actions are a row of small text buttons, not a second grid.
     *
     * Each entry used to carry one "导出" button competing for width with the
     * name, and delete only ever applied to the *active* board even though the
     * list lets you select any board. Putting both actions on the row that owns
     * the board makes "which board does this affect" unambiguous.
     */
    const actions = document.createElement("div");
    actions.className = "doodle-library-entry-actions";
    const exportButton = document.createElement("button");
    exportButton.textContent = "导出";
    exportButton.title = "导出这个画板的 JSON";
    exportButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void runLibraryAction({ type: "export", id: entry.id });
    });
    const deleteButton = document.createElement("button");
    deleteButton.textContent = "删除";
    deleteButton.className = "doodle-library-entry-delete";
    deleteButton.title = "删除这个画板";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!window.confirm(`删除画板「${entry.name}」？此操作不可撤销。`)) return;
      void runLibraryAction({ type: "delete", id: entry.id });
    });
    actions.append(exportButton, deleteButton);
    row.append(button, actions);
    list.append(row);
  }
  /*
   * The name field's action lives beside it.
   *
   * "重命名" used to sit in the six-button grid, reading from the same field
   * but looking like a sibling of "新建". Pairing them makes the relationship
   * obvious, and Enter in the field does the same thing so a person does not
   * have to reach for the button.
   */
  const renameButton = document.querySelector<HTMLButtonElement>("#doodleLibraryRename");
  const renameTarget = document.querySelector<HTMLInputElement>("#doodleLibraryName");
  /*
   * `rename` needs an explicit board id. The visible board is the active one,
   * so the id comes from the snapshot rather than from a tracked selection.
   */
  const renameActive = () => {
    if (!activeSnapshot) return;
    void runLibraryAction({ type: "rename", id: activeSnapshot.id });
  };
  if (renameButton) renameButton.onclick = renameActive;
  if (renameTarget) {
    renameTarget.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        renameActive();
      }
    };
  }
}

async function runLibraryAction(action: Record<string, unknown>) {
  const name = document.querySelector<HTMLInputElement>("#doodleLibraryName")?.value.trim();
  let request: Record<string, unknown> = action;
  if (action.type === "duplicate") {
    /*
     * "另存一份" copies the board that is currently open. Clicking a row now
     * switches to it, so the active board is always the one the person is
     * looking at; there is no separate selection to track. The library action
     * still requires an explicit id, so it is read from the live index rather
     * than remembered in a module variable.
     */
    // The snapshot *is* the active board, so its own id is the source to copy.
    request = { type: "duplicate", id: activeSnapshot?.id, name: name || undefined };
  } else {
    request = { ...action, ...(name && ["save", "create", "rename", "duplicate"].includes(String(action.type)) ? { name } : {}) };
  }
  const result = await libraryRequest(request);
  /*
   * The server returns the active snapshot as flat fields (the same shape a
   * normal write uses), not under a `board` key. Reading `result.board` first
   * kept every library action on a fallback `/api/board` fetch because that key
   * never existed. Prefer the flat snapshot and keep the key as a fallback for
   * hosts that nest it.
   */
  const board = (result.board as BoardSnapshot | undefined)
    ?? (Array.isArray(result.items) ? result as unknown as BoardSnapshot : undefined)
    ?? await loadBoard();
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
  const status = document.querySelector<HTMLElement>("#doodleLibraryStatus");
  const showStatus = (message: string, isError = false) => {
    if (!status) return;
    status.textContent = message;
    status.style.color = isError ? "#b91c1c" : "#6b7280";
  };
  const scrim = document.querySelector<HTMLElement>("#doodleDrawerScrim");
  let closeTimer: number | null = null;
  const openPanel = () => {
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = null;
    panel.hidden = false;
    if (scrim) scrim.hidden = false;
    document.body.classList.add("doodle-drawer-open");
    toggle.setAttribute("aria-expanded", "true");
    void panel.offsetWidth;
    panel.classList.add("is-open");
    void refreshLibraryUi().catch(() => {});
  };
  const closePanel = () => {
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    panel.classList.remove("is-open");
    document.body.classList.remove("doodle-drawer-open");
    toggle.setAttribute("aria-expanded", "false");
    closeTimer = window.setTimeout(() => {
      panel.hidden = true;
      if (scrim) scrim.hidden = true;
      closeTimer = null;
    }, 220);
  };
  toggle.addEventListener("click", () => {
    if (panel.hidden || !panel.classList.contains("is-open")) openPanel();
    else closePanel();
  });
  close.addEventListener("click", closePanel);
  scrim?.addEventListener("click", closePanel);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-library-action]")) {
    button.addEventListener("click", () => void (async () => {
      try {
        showStatus("处理中…");
        await runLibraryAction({ type: button.dataset.libraryAction });
        showStatus("已完成");
      } catch (error) {
        showError(error);
        showStatus(error instanceof Error ? error.message : String(error), true);
      }
    })());
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
    if (event.key === "Escape" && !panel.hidden) closePanel();
  });
}

/**
 * Send only what changed.
 *
 * This used to POST the whole board on every change. A person nudging one box
 * sent every object they own, and — because the server compares board revisions,
 * not objects — a person and an agent editing different objects rejected each
 * other. The diff keeps a one-object edit to one object's worth of bytes.
 *
 * `author: "human"` is deliberate: an item a person touched now reports as human
 * in `get_board`, which is what `HANDOFF` reads to tell the agent what the person
 * changed. The single-item endpoints already behaved this way; the canvas simply
 * never used them.
 */
async function syncBoard(next: unknown[], base: BoardSnapshot): Promise<BoardSnapshot> {
  const diff = diffBoardItems(base.items as never[], next as never[]);
  if (isEmptyDiff(diff)) return base;
  const change = { items: diff.added, updates: diff.updated, remove_ids: diff.removed };
  if (hostApp) {
    const result = await hostApp.callServerTool({
      name: "draw_board",
      arguments: { ...change, author: "human", expected_revision: base.revision },
    });
    if (result.isError) throw new Error("Board update failed");
    return result.structuredContent as BoardSnapshot;
  }
  if (activeMcpApp?.drawBoard) {
    const result = await activeMcpApp.drawBoard({
      ...change,
      author: "human",
      expected_revision: base.revision,
    });
    return result as BoardSnapshot;
  }
  const response = await fetch("/api/board/batch", {
    method: "POST",
    headers: { ...headers, "If-Match-Revision": String(base.revision) },
    body: JSON.stringify({ confirmedBy: "human", ...change }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result.board as BoardSnapshot;
}

let errorTimer: number | null = null;

/**
 * Tell the person when a save was rejected.
 *
 * A rejected write used to be a `console.warn`, and the canvas then snapped
 * back to the server's previous revision: the drawing vanished with no
 * explanation, which reads as a broken board rather than a failed save. The
 * banner is transient and lives in the page, not in board state.
 */
function showError(error: unknown) {
  console.warn("Doodle board sync skipped", error);
  const message = error instanceof Error ? error.message : String(error);
  let banner = document.querySelector<HTMLElement>("#doodleSyncBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "doodleSyncBanner";
    banner.className = "doodle-sync-banner doodle-glass";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    document.body.append(banner);
  }
  banner.textContent = `这次改动没有保存：${message}`;
  banner.dataset.visible = "true";
  if (errorTimer !== null) window.clearTimeout(errorTimer);
  errorTimer = window.setTimeout(() => {
    errorTimer = null;
    banner?.removeAttribute("data-visible");
  }, 8000);
}

function clearError() {
  if (errorTimer !== null) {
    window.clearTimeout(errorTimer);
    errorTimer = null;
  }
  document.querySelector<HTMLElement>("#doodleSyncBanner")?.removeAttribute("data-visible");
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function safeFilename(name: string): string {
  return (name || "doodle-board").replace(/[\\/:*?"<>|]/g, "_");
}

async function exportSnapshot(format: "png" | "jpg" | "svg"): Promise<void> {
  const api = apiRef.current;
  if (!api) throw new Error("Canvas is not ready");
  const elements = api.getSceneElements();
  const files = api.getFiles?.() ?? currentFiles.current;
  const appState = api.getAppState?.() ?? {
    viewBackgroundColor: canvasColors[readTheme()].view,
    exportBackground: true,
    exportScale: 2,
  };
  const title = safeFilename((await loadBoard()).title);
  const exportState = {
    ...appState,
    exportBackground: true,
    viewBackgroundColor: canvasColors[readTheme()].export,
    exportScale: format === "svg" ? 1 : 2,
  } as never;
  if (format === "svg") {
    const svg = await exportToSvg({
      elements: elements as never[],
      appState: exportState,
      files: files as never,
      exportPadding: 24,
    });
    downloadBlob(new Blob([svg.outerHTML], { type: "image/svg+xml" }), `${title}.svg`);
    return;
  }
  const blob = await exportToBlob({
    elements: elements as never[],
    appState: exportState,
    files: files as never,
    mimeType: format === "jpg" ? "image/jpeg" : "image/png",
    quality: format === "jpg" ? 0.92 : undefined,
    exportPadding: 24,
  });
  downloadBlob(blob, `${title}.${format}`);
}

function initSnapshotExports() {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-snapshot-export]")) {
    button.addEventListener("click", () => void (async () => {
      const format = button.dataset.snapshotExport as "png" | "jpg" | "svg";
      const status = document.querySelector<HTMLElement>("#doodleLibraryStatus");
      try {
        if (status) status.textContent = `正在导出 ${format.toUpperCase()}…`;
        await exportSnapshot(format);
        if (status) status.textContent = `已导出 ${format.toUpperCase()}`;
      } catch (error) {
        showError(error);
        if (status) status.textContent = error instanceof Error ? error.message : String(error);
      }
    })());
  }
}


function initNotifyButton() {
  const button = document.querySelector<HTMLButtonElement>("#doodleNotifyAgent");
  if (!button) return;
  const updateVisibility = () => {
    const capabilities = hostApp?.getHostCapabilities();
    button.hidden = !capabilities?.updateModelContext?.text || !capabilities?.message?.text;
  };
  button.addEventListener("click", async () => {
    try {
      const snapshot = activeSnapshot ?? await loadBoard();
      publishedRevision = -1;
      await publishContext(snapshot);
      if (!hostApp) throw new Error("Host bridge is unavailable");
      const result = await hostApp.sendMessage({
        role: "user",
        content: [{ type: "text", text: "我改了 Doodle 画板，你看下图。" }],
      });
      if (result.isError) throw new Error("Host rejected the notification");
    } catch (error) {
      showError(error);
    }
  });
  updateVisibility();
  window.setTimeout(updateVisibility, 1200);
}

function CanvasApp({ initial }: { initial: BoardSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [api, setApi] = useState<ExcalidrawAPI | null>(null);
  const [theme, setTheme] = useState<DoodleTheme>(readTheme());
  const initialData = useMemo(() => {
    const files = toFiles(initial);
    currentFiles.current = Object.fromEntries(files.map((file) => [file.id, file]));
    // A board you have to re-find is not the board beside you: restore the
    // camera this person left on this board, and only fall back to fitting the
    // content when there is nothing remembered.
    // An empty board has nothing to return to, and restoring a camera that was
    // wandering off-content would look like the canvas is broken.
    const stored = initial.items.length > 0 && browserViewportStorage()
      ? readStoredViewport(browserViewportStorage()!, initial.id)
      : undefined;
    // Only restore a camera that can actually show this board. A remembered
    // view panned into empty space makes a full board look blank.
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
    // Ink is chosen per theme, so switching themes has to recolor the scene as
    // well as the page. Without this, dark mode shows light-mode ink.
    if (activeSnapshot) {
      applyingRemote.current = true;
      api.updateScene({ elements: toElements(activeSnapshot, theme), captureUpdate: "NEVER" });
      window.setTimeout(() => { applyingRemote.current = false; }, 0);
    }
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

  const onChange = useCallback((elements: ExcalidrawLikeElement[], appState: ExcalidrawAppState, files: Record<string, ExcalidrawFileData>) => {
    currentAppState.current = appState;
    Object.assign(currentFiles.current, files);
    rememberViewport(activeSnapshot?.id, appState);
    if (!api || applyingRemote.current || !activeSnapshot) return;
    /*
     * Ignore only the genuinely empty mount callback.
     *
     * This used to require `elements.length >= activeSnapshot.items.length`
     * before accepting any edit, on the assumption that the scene exposes one
     * element per board object. It does not: a bound label, a frame, or a
     * standalone text is projected differently, so a healthy board of ten
     * objects can render nine elements. The count never caught up, `sceneReady`
     * stayed false, and every human edit was silently dropped — drawing looked
     * broken while the save endpoint reported success.
     *
     * Readiness is now a one-way latch on the first non-empty scene. Board
     * state remains authoritative for what exists; Excalidraw only decides
     * *when* it has something to report.
     */
    if (!sceneReady.current) {
      if (elements.length === 0) return;
      sceneReady.current = true;
    }
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
    const base = activeSnapshot;
    if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current);
    pendingTimer.current = window.setTimeout(async () => {
      pendingTimer.current = null;
      if (!base || activeSnapshot !== base) return;
      try {
        const updated = await syncBoard(projected.items as unknown[], base);
        clearError();
        setSnapshot(updated);
      } catch (error) {
        /*
         * Never repaint the canvas from the server here.
         *
         * Reloading on failure meant one rejected item silently erased the
         * person's whole drawing: the canvas jumped back to the previous
         * revision with no message. Keep what they drew, refresh only the
         * revision so a retry can succeed after a conflict, and say what
         * happened.
         */
        const latest = await loadBoard().catch(() => null);
        if (latest) activeSnapshot = { ...activeSnapshot, revision: latest.revision };
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
  rootInstance.render(React.createElement(CanvasApp, { initial }));
}

async function start() {
  const root = document.querySelector("#excalidrawRoot");
  if (!root || embedded || rootInstance) return;
  const initial = await loadBoard();
  renderCanvas(initial);
  if (!embedded) initWelcome(initial);
}

window.DoodleExcalidrawInit = (snapshot, mcpApp) => {
  activeMcpApp = mcpApp as typeof activeMcpApp;
  renderCanvas(snapshot);
};

if (document.querySelector("#excalidrawRoot")) {
  initThemeToggle();
  initExternalLinkPolicy();
  initLibraryUi();
  initSnapshotExports();
  initNotifyButton();
  glassController = initLiquidGlass();
  if (embedded) void initHostApp().catch(() => {});
  else connectStandaloneUpdates();
  void start().catch((error) => showError(error));
}
