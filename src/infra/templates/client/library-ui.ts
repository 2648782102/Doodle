/**
 * Local board library overlay drawer and static PNG/JPG/SVG sharing exports.
 */

import { exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawFileData } from "../../../board/excalidraw-adapter.js";
import { showError } from "./banner.js";
import { canvasColors, readTheme } from "./theme.js";
import type { BoardTransport } from "./transport.js";
import type { BoardSnapshot, ExcalidrawAPI } from "./types.js";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function safeFilename(name: string): string {
  return (name || "doodle-board").replace(/[\\/:*?"<>|]/g, "_");
}

export interface LibraryUiDeps {
  transport: BoardTransport;
  getActiveSnapshot: () => BoardSnapshot | null;
  applyRemoteSnapshot: (snapshot: BoardSnapshot, options?: { repaint?: boolean }) => void;
  /**
   * Write any debounced canvas edit before the active board changes.
   *
   * Without this, a person who draws and then immediately picks another board
   * loses the stroke in the worst possible way: the pending frame is rebased
   * onto whichever board is active when the timer fires, so the rectangle lands
   * on the *new* board and the board it was drawn on stays empty.
   */
  flushPendingWrites?: () => Promise<unknown>;
}

export function initLibraryUi(deps: LibraryUiDeps): void {
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

  const refreshLibraryUi = async () => {
    const list = document.querySelector<HTMLElement>("#doodleLibraryList");
    const current = document.querySelector<HTMLElement>("#doodleLibraryCurrent");
    const name = document.querySelector<HTMLInputElement>("#doodleLibraryName");
    if (panel.hidden || !list || !current) return;
    const board = await deps.transport.loadBoard();
    const index = board.library as {
      activeId?: string;
      boards?: Array<{ id: string; name: string; revision: number; itemCount: number }>;
    } | undefined;
    const boards = index?.boards ?? [];
    current.textContent = `当前：${boards.find((entry) => entry.id === index?.activeId)?.name ?? "—"} · ${board.items.length} 个对象`;
    if (name && document.activeElement !== name) {
      name.value = boards.find((entry) => entry.id === index?.activeId)?.name ?? "";
    }
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
      button.addEventListener("click", () => void runLibraryAction({ type: "switch", id: entry.id }));

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

    const renameButton = document.querySelector<HTMLButtonElement>("#doodleLibraryRename");
    const renameTarget = document.querySelector<HTMLInputElement>("#doodleLibraryName");
    const renameActive = () => {
      const active = deps.getActiveSnapshot();
      if (!active) return;
      void runLibraryAction({ type: "rename", id: active.id });
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
  };

  const runLibraryAction = async (action: Record<string, unknown>) => {
    /*
     * Flush first, and only for actions that can change the active board. An
     * export or a rename does not move the canvas, so making them wait on a
     * write would only add latency.
     */
    if (["switch", "create", "save", "duplicate", "import"].includes(String(action.type))) {
      await deps.flushPendingWrites?.().catch(() => {});
    }
    const name = document.querySelector<HTMLInputElement>("#doodleLibraryName")?.value.trim();
    const activeSnapshot = deps.getActiveSnapshot();
    let request: Record<string, unknown> = action;
    if (action.type === "duplicate") {
      request = { type: "duplicate", id: activeSnapshot?.id, name: name || undefined };
    } else {
      /*
       * "新建" must not inherit the current board's name.
       *
       * The field is pre-filled with the active board so "重命名" reads what is
       * on screen, but sending it to `create` named every new board after the one
       * it came from: a library of eleven boards all called "和 AI 一起画", which
       * a person cannot tell apart. Only an edited field counts as a name here,
       * and the server already generates "画板 N" when none is given.
       */
      const editedName = name && name !== activeSnapshot?.title ? name : undefined;
      const takesName = ["save", "rename", "duplicate"].includes(String(action.type));
      request = {
        ...action,
        ...(name && takesName ? { name } : {}),
        ...(action.type === "create" && editedName ? { name: editedName } : {}),
      };
    }
    const result = await deps.transport.libraryRequest(request, activeSnapshot?.revision ?? 0);
    const board = (result.board as BoardSnapshot | undefined)
      ?? (Array.isArray(result.items) ? result as unknown as BoardSnapshot : undefined)
      ?? await deps.transport.loadBoard();
    deps.applyRemoteSnapshot(board);
    if (action.type === "export" || action.type === "get") {
      const exportBoard = (result.exportBoard as BoardSnapshot | undefined) ?? board;
      const blob = new Blob([JSON.stringify(exportBoard, null, 2)], { type: "application/json" });
      downloadBlob(blob, `${safeFilename(exportBoard.title)}.doodle.json`);
    }
    await refreshLibraryUi().catch(() => {});
  };

  const scrim = document.querySelector<HTMLElement>("#doodleDrawerScrim");
  let closeTimer: number | null = null;
  /** Where focus goes when the drawer closes, so a keyboard user is not dropped at the top. */
  let returnFocus: HTMLElement | null = null;

  /*
   * The drawer is a modal surface, and it has to behave like one.
   *
   * It used to only animate: focus stayed on `<body>`, Tab walked straight out
   * into the Excalidraw canvas behind the scrim, and closing dropped focus back
   * at `body`. A person navigating by keyboard could not reach the panel at all
   * without tabbing through the whole canvas toolbar first, and once inside
   * they could tab straight back out to controls the scrim was covering.
   */
  const focusable = (): HTMLElement[] => [...panel.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null || element === document.activeElement);

  const onPanelKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const items = focusable();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    /*
     * Focus starts on the panel itself (see `openPanel`), which is outside that
     * list: Tab from there has to enter at the top rather than escape to the
     * canvas, so both edges are handled explicitly.
     */
    if (!active || active === panel || !panel.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const openPanel = () => {
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = null;
    const active = document.activeElement as HTMLElement | null;
    returnFocus = active && active !== document.body ? active : toggle;
    panel.hidden = false;
    if (scrim) scrim.hidden = false;
    document.body.classList.add("doodle-drawer-open");
    toggle.setAttribute("aria-expanded", "true");
    panel.setAttribute("aria-modal", "true");
    void panel.offsetWidth;
    panel.classList.add("is-open");
    document.addEventListener("keydown", onPanelKeydown);
    /*
     * Focus the panel, not its first button: a dialog should announce its own
     * label before its controls, and the name field would otherwise open with
     * the board name pre-selected for accidental overwrite.
     */
    panel.focus({ preventScroll: true });
    void refreshLibraryUi().catch(() => {});
  };
  const closePanel = () => {
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    document.removeEventListener("keydown", onPanelKeydown);
    panel.removeAttribute("aria-modal");
    panel.classList.remove("is-open");
    document.body.classList.remove("doodle-drawer-open");
    toggle.setAttribute("aria-expanded", "false");
    const target = returnFocus && document.contains(returnFocus) ? returnFocus : toggle;
    returnFocus = null;
    // After the slide-out, so the focus ring is not drawn on a moving panel.
    target.focus({ preventScroll: true });
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
      await runLibraryAction({
        type: "import",
        board: parsed,
        switchTo: true,
        name: parsed.title || imported.name.replace(/\.json$/i, ""),
      });
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

export function initSnapshotExports(options: {
  transport: BoardTransport;
  getApi: () => ExcalidrawAPI | null;
  getFiles: () => Record<string, ExcalidrawFileData>;
}): void {
  const exportSnapshot = async (format: "png" | "jpg" | "svg"): Promise<void> => {
    const api = options.getApi();
    if (!api) throw new Error("Canvas is not ready");
    const elements = api.getSceneElements();
    const files = api.getFiles?.() ?? options.getFiles();
    const appState = api.getAppState?.() ?? {
      viewBackgroundColor: canvasColors[readTheme()].view,
      exportBackground: true,
      exportScale: 2,
    };
    const title = safeFilename((await options.transport.loadBoard()).title);
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
  };

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
