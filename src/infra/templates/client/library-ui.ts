/**
 * Local board library overlay drawer and static PNG/JPG/SVG sharing exports.
 */

import { exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawFileData } from "../../../board/excalidraw-adapter.js";
import { showError } from "./banner.js";
import { canFocus, orderLibrary, renderBoardRows, type LibraryEntry, type LibraryOrder } from "./library-list.js";
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
  const search = document.querySelector<HTMLInputElement>("#doodleLibrarySearch");
  const sortToggle = document.querySelector<HTMLButtonElement>("#doodleLibrarySort");
  const empty = document.querySelector<HTMLElement>("#doodleLibraryEmpty");
  /** Restored when an action reports back, so the status row never stays stale. */
  let statusTimer: number | null = null;
  const showStatus = (message: string, isError = false) => {
    if (!status) return;
    if (statusTimer !== null) window.clearTimeout(statusTimer);
    status.textContent = message;
    status.style.color = isError ? "#b91c1c" : "#6b7280";
    /*
     * "已完成" used to sit in the panel forever, so a later action that failed
     * to report anything looked like it had succeeded. Clear it after a moment;
     * errors stay until the next action replaces them.
     */
    if (message && !isError) {
      statusTimer = window.setTimeout(() => {
        statusTimer = null;
        if (status.textContent === message) status.textContent = "";
      }, 4000);
    }
  };

  /*
   * Search and sort survive a refresh of the list.
   *
   * `refreshLibraryUi` re-renders after every action, so reading the controls
   * from the DOM each time is what keeps a filter from snapping back when a
   * board is renamed underneath it.
   */
  let order: LibraryOrder = "recent";
  sortToggle?.setAttribute("aria-pressed", "false");

  const refreshLibraryUi = async () => {
    const list = document.querySelector<HTMLElement>("#doodleLibraryList");
    const current = document.querySelector<HTMLElement>("#doodleLibraryCurrent");
    const name = document.querySelector<HTMLInputElement>("#doodleLibraryName");
    if (panel.hidden || !list || !current) return;
    const board = await deps.transport.loadBoard();
    const index = board.library as { activeId?: string; boards?: LibraryEntry[] } | undefined;
    const boards = (index?.boards ?? []).map((entry) => ({
      ...entry,
      active: entry.id === index?.activeId,
    }));
    current.textContent = `当前：${boards.find((entry) => entry.active)?.name ?? "—"} · ${board.items.length} 个对象`;
    if (name && document.activeElement !== name) {
      name.value = boards.find((entry) => entry.active)?.name ?? "";
    }
    // Filter and order live in `library-list` so the rule can be tested without a DOM.
    const visible = orderLibrary(boards, search?.value ?? "", order);
    renderBoardRows(list, visible, {
      switchTo: (entry) => void runLibraryAction({ type: "switch", id: entry.id }),
      rename: (entry, next) => renameBoard(entry.id, next),
      exportJson: (entry) => void runLibraryAction({ type: "export", id: entry.id }),
      delete: (entry) => void runLibraryAction({ type: "delete", id: entry.id }),
      refresh: () => void refreshLibraryUi().catch(() => {}),
      /*
       * Standalone only. The embedded host talks to the board through the MCP
       * bridge rather than this page's routes, and the active board's geometry is
       * live in the canvas anyway.
       *
       * Versioned by revision so a row's picture refreshes after the board is
       * edited, and scoped to the library route so it never resolves to the
       * active board by accident.
       */
      thumbnailUrl: deps.transport.embedded
        ? undefined
        : (entry) => `/api/board/library/${encodeURIComponent(entry.id)}.svg?max=320&v=${entry.revision}`,
    });
    if (empty) {
      const filtering = (search?.value ?? "").trim().length > 0;
      empty.hidden = visible.length > 0;
      empty.textContent = filtering
        ? `没有匹配「${search?.value.trim()}」的画板。`
        : "还没有画板。点「新建」创建一张。";
    }

    const renameButton = document.querySelector<HTMLButtonElement>("#doodleLibraryRename");
    const renameTarget = document.querySelector<HTMLInputElement>("#doodleLibraryName");
    const renameActive = () => {
      const active = deps.getActiveSnapshot();
      if (!active) return;
      void renameBoard(active.id, renameTarget?.value ?? "");
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
    /*
     * An explicit name wins over the field at the top.
     *
     * The field exists for renaming the active board. When a row renames itself,
     * its own value is the name — reading the top field instead sent the old
     * name and quietly renamed the board to itself.
     */
    const explicitName = typeof action.name === "string" ? action.name.trim() : "";
    const name = explicitName || document.querySelector<HTMLInputElement>("#doodleLibraryName")?.value.trim();
    const activeSnapshot = deps.getActiveSnapshot();
    let request: Record<string, unknown> = action;
    if (action.type === "switch") {
      /*
       * Switching is a canvas action, and the swipe of the name field is not a
       * rename of the board being left. Without this, the pre-filled field rode
       * along on every switch and renamed whichever board happened to be active.
       */
      request = { type: "switch", id: action.id };
    } else if (action.type === "duplicate") {
      /*
       * "另存一份" duplicates the *active* board. A name typed into the field is
       * not necessarily about this board, so it is only sent when it differs
       * from the active board's own name.
       */
      const named = name && name !== activeSnapshot?.title ? name : undefined;
      request = { type: "duplicate", id: activeSnapshot?.id, ...(named ? { name: named } : {}) };
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
    /*
     * A board switch is finished when the board is on screen.
     *
     * The drawer used to stay open with a scrim over the canvas, so choosing a
     * board looked like nothing happened: the panel still listed the old active
     * row for a frame, and the result was behind the dimmer. Close it and let the
     * person see what they picked. Renames and exports stay put — those are
     * library housekeeping, not navigation.
     */
    if (["switch", "create", "import"].includes(String(action.type)) && action.switchTo !== false) {
      closePanel();
    }
  };

  /*
   * One place that decides whether a typed name is worth sending.
   *
   * A blank field used to travel as-is and the server stored "未命名画板", which
   * looks like a successful rename to a name nobody asked for. Saying so is
   * better than quietly inventing one.
   */
  const renameBoard = async (id: string | undefined, raw: string): Promise<void> => {
    const next = raw.trim();
    if (!next) {
      showStatus("画板名称不能为空", true);
      return;
    }
    await runLibraryAction({ type: "rename", id, name: next });
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
     * Other floating surfaces hide under the drawer through CSS alone, so they
     * would reappear the moment it closed. Announce the open so they can shut
     * for real instead of being merely painted over.
     */
    window.dispatchEvent(new CustomEvent("doodle-library-open"));
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
    const target = canFocus(returnFocus) ? returnFocus : toggle;
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
  search?.addEventListener("input", () => { void refreshLibraryUi().catch(() => {}); });
  sortToggle?.addEventListener("click", () => {
    order = order === "recent" ? "name" : "recent";
    const byName = order === "name";
    sortToggle.textContent = byName ? "名称" : "最近";
    sortToggle.setAttribute("aria-pressed", byName ? "true" : "false");
    sortToggle.title = byName ? "按名称排序" : "按最近修改排序";
    void refreshLibraryUi().catch(() => {});
  });
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
