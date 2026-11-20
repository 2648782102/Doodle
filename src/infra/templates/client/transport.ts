/**
 * Unified client transport over standalone HTTP/WebSocket and embedded MCP Apps.
 *
 * Isolating both channels behind one `BoardTransport` prevents embedded MCP App
 * code paths from accidentally calling relative `/api/board` routes and keeps
 * `ERROR_JSON` extraction, incremental host model context sync, and live update
 * subscriptions in one testable module.
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { buildBoardModelContext } from "../../../board/view/app-context.js";
import { diffBoardItems, isEmptyDiff } from "../../../board/model/diff.js";
import { showConnectedNotice, showConnectionNotice, showError } from "./banner.js";
import type { SyncChannel } from "./sync-state.js";
import type { BoardSnapshot, McpAppFallback } from "./types.js";

/**
 * A rejected write, with the machine-readable reason kept.
 *
 * The banner only needs a sentence, but conflict recovery needs `code` and the
 * object ids: "3 个对象与别处的改动冲突" is actionable, "this change was not
 * saved" is not. Collapsing everything into `Error(message)` threw that away.
 */
export class BoardWriteError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly conflicts?: string[],
  ) {
    super(message);
    this.name = "BoardWriteError";
  }
}

interface ToolErrorPayload {
  message: string;
  code?: string;
  conflicts?: string[];
}

/** Extract the `ERROR_JSON` payload from a rejected MCP tool call. */
export function toolErrorPayload(result: { content?: Array<{ type: string; text?: string }> }): ToolErrorPayload {
  const text = (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  const match = text.match(/ERROR_JSON:\n(\{[\s\S]*\})/);
  if (match) {
    try {
      const payload = JSON.parse(match[1]) as {
        message?: string;
        fix?: string;
        code?: string;
        conflicts?: unknown;
      };
      const message = payload.message?.trim();
      if (message) {
        const fix = payload.fix?.trim();
        return {
          message: fix ? `${message} — ${fix}` : message,
          ...(typeof payload.code === "string" ? { code: payload.code } : {}),
          ...(Array.isArray(payload.conflicts)
            ? { conflicts: payload.conflicts.filter((id): id is string => typeof id === "string") }
            : {}),
        };
      }
    } catch {
      // Fall through to the raw text below.
    }
  }
  const first = text.split("\n").find((line) => line.trim().length > 0)?.trim();
  return { message: first && !first.startsWith("MCP error") ? first : "Board update failed" };
}

/**
 * Extract the human-readable `message` and `fix` from a rejected MCP tool call.
 */
export function toolErrorMessage(result: { content?: Array<{ type: string; text?: string }> }): string {
  return toolErrorPayload(result).message;
}

export interface BoardTransport {
  readonly embedded: boolean;
  /** Which path this canvas is on, stated rather than inferred by a person. */
  readonly channel: SyncChannel;
  loadBoard(): Promise<BoardSnapshot>;
  syncBoard(next: unknown[], base: BoardSnapshot): Promise<BoardSnapshot>;
  libraryRequest(action: Record<string, unknown>, expectedRevision: number): Promise<Record<string, unknown>>;
  /** True when the snapshot reached the host model context. */
  publishContext(snapshot: BoardSnapshot, force?: boolean): Promise<boolean>;
  /**
   * `onNotified` fires only after the host accepted the message.
   *
   * The button used to be silent on success: a person pressed "通知 Agent" and
   * the only evidence was that nothing went wrong. The sync chip has had an
   * `awaiting-agent` phase and a `notified` event for a while — nothing ever
   * sent it, so the phase was unreachable.
   */
  initNotifyButton(
    getActiveSnapshot: () => BoardSnapshot | null,
    onNotified?: () => void,
  ): void;
  setFallbackMcpApp(app: McpAppFallback | null): void;
  startLiveUpdates(options: {
    isBusy: () => boolean;
    onSnapshot: (snapshot: BoardSnapshot) => void;
    onOfflineChange?: (offline: boolean) => void;
  }): Promise<void>;
}

function writeError(payload: { error?: unknown; message?: unknown; code?: unknown; conflicts?: unknown }, fallback: string): BoardWriteError {
  const message = typeof payload.error === "string" ? payload.error
    : typeof payload.message === "string" ? payload.message
      : fallback;
  const conflicts = Array.isArray(payload.conflicts)
    ? payload.conflicts.filter((id): id is string => typeof id === "string")
    : undefined;
  return new BoardWriteError(message, typeof payload.code === "string" ? payload.code : undefined, conflicts);
}

export function createBoardTransport(options: {
  embedded: boolean;
  panelToken: string;
}): BoardTransport {
  const headers = { "Content-Type": "application/json", "X-AI-Draw-Token": options.panelToken };
  const hostApp = options.embedded
    ? new App({ name: "Doodle", version: "1.0.0" }, { availableDisplayModes: ["inline", "fullscreen"] })
    : null;
  let activeMcpApp: McpAppFallback | null = null;
  let publishedRevision = -1;
  let lastPublishedSnapshot: BoardSnapshot | null = null;

  const loadBoard = async (): Promise<BoardSnapshot> => {
    if (hostApp) {
      const result = await hostApp.callServerTool({
        name: "get_board",
        arguments: { include_canvas_fidelity: true, include_guide: false },
      });
      if (result.isError) throw new Error(toolErrorMessage(result));
      const data = result.structuredContent as BoardSnapshot | undefined;
      if (!data || !Array.isArray(data.items) || typeof data.revision !== "number") {
        throw new Error("Invalid board snapshot from host");
      }
      return data;
    }
    const response = await fetch("/api/board");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

  const syncBoard = async (next: unknown[], base: BoardSnapshot): Promise<BoardSnapshot> => {
    const diff = diffBoardItems(base.items as never[], next as never[]);
    if (isEmptyDiff(diff)) return base;
    const change = { items: diff.added, updates: diff.updated, remove_ids: diff.removed };
    if (hostApp) {
      const result = await hostApp.callServerTool({
        name: "draw_board",
        arguments: { ...change, author: "human", expected_revision: base.revision },
      });
      if (result.isError) {
        const payload = toolErrorPayload(result);
        throw new BoardWriteError(payload.message, payload.code, payload.conflicts);
      }
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
    if (!response.ok) throw writeError(result, `HTTP ${response.status}`);
    return result.board as BoardSnapshot;
  };

  const libraryRequest = async (action: Record<string, unknown>, expectedRevision: number) => {
    if (hostApp) {
      const result = await hostApp.callServerTool({
        name: "draw_board",
        arguments: { library: action, expected_revision: expectedRevision },
      });
      if (result.isError) {
        const payload = toolErrorPayload(result);
        throw new BoardWriteError(payload.message, payload.code, payload.conflicts);
      }
      return result.structuredContent as Record<string, unknown>;
    }
    const response = await fetch("/api/board/library", {
      method: "POST",
      headers,
      body: JSON.stringify({ confirmedBy: "human", action }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw writeError(result, `HTTP ${response.status}`);
    return result as Record<string, unknown>;
  };

  const publishContext = async (snapshot: BoardSnapshot, force = false): Promise<boolean> => {
    if (!hostApp || (!force && publishedRevision === snapshot.revision)) return false;
    const capabilities = hostApp.getHostCapabilities();
    if (!capabilities?.updateModelContext?.text) return false;
    const previous = lastPublishedSnapshot && lastPublishedSnapshot.id === snapshot.id
      ? lastPublishedSnapshot
      : undefined;
    const context = buildBoardModelContext(snapshot as never, previous as never, {
      includeStructuredContent: Boolean(capabilities.updateModelContext.structuredContent),
    });
    await hostApp.updateModelContext({
      content: context.content,
      ...(capabilities.updateModelContext.structuredContent ? { structuredContent: context.structuredContent } : {}),
    });
    publishedRevision = snapshot.revision;
    lastPublishedSnapshot = snapshot;
    return true;
  };

  let refreshNotifyVisibility: (() => void) | null = null;

  const initNotifyButton = (
    getActiveSnapshot: () => BoardSnapshot | null,
    onNotified?: () => void,
  ): void => {
    const button = document.querySelector<HTMLButtonElement>("#doodleNotifyAgent");
    if (!button) return;
    const updateVisibility = () => {
      const capabilities = hostApp?.getHostCapabilities();
      button.hidden = !capabilities?.updateModelContext?.text || !capabilities?.message?.text;
    };
    refreshNotifyVisibility = updateVisibility;
    button.addEventListener("click", async () => {
      const previousLabel = button.textContent;
      button.disabled = true;
      if (previousLabel) button.textContent = "通知中…";
      try {
        const snapshot = getActiveSnapshot() ?? await loadBoard();
        await publishContext(snapshot, true);
        if (!hostApp) throw new Error("Host bridge is unavailable");
        const result = await hostApp.sendMessage({
          role: "user",
          content: [{ type: "text", text: "我改了 Doodle 画板，你看下图。" }],
        });
        if (result.isError) throw new Error("Host rejected the notification");
        /*
         * Say it landed. `notified` is the event the chip already understands;
         * the label change is for the moment the chip is off-screen or the
         * person is looking at the button they just pressed.
         */
        onNotified?.();
        button.textContent = "已通知 ✓";
        window.setTimeout(() => {
          if (button.textContent === "已通知 ✓") button.textContent = previousLabel ?? "通知 Agent";
        }, 2000);
      } catch (error) {
        if (previousLabel) button.textContent = previousLabel;
        showError(error);
      } finally {
        button.disabled = false;
      }
    });
    updateVisibility();
    window.setTimeout(updateVisibility, 1200);
  };

  const connectStandaloneUpdates = (
    onSnapshot: (snapshot: BoardSnapshot) => void,
    onOfflineChange?: (offline: boolean) => void,
  ): void => {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/ws`);
    socket.addEventListener("message", async (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (!message || !["board_updated", "board_library_updated"].includes(message.type)) return;
        const refreshed = await loadBoard().catch(() => null);
        if (refreshed) onSnapshot(refreshed);
      } catch {}
    });
    socket.addEventListener("close", () => {
      showConnectionNotice("画板连接已断开，正在重连；这期间的改动不会保存。");
      onOfflineChange?.(true);
      window.setTimeout(() => connectStandaloneUpdates(onSnapshot, onOfflineChange), 750);
    });
    socket.addEventListener("open", () => {
      showConnectedNotice();
      onOfflineChange?.(false);
    });
  };

  const startLiveUpdates = async ({ isBusy, onSnapshot, onOfflineChange }: {
    isBusy: () => boolean;
    onSnapshot: (snapshot: BoardSnapshot) => void;
    onOfflineChange?: (offline: boolean) => void;
  }): Promise<void> => {
    if (!hostApp) {
      connectStandaloneUpdates(onSnapshot, onOfflineChange);
      return;
    }
    hostApp.ontoolresult = (result) => {
      if (result.isError) return;
      const data = result.structuredContent as BoardSnapshot | undefined;
      if (!data || !Array.isArray(data.items) || typeof data.revision !== "number") return;
      onSnapshot(data);
    };
    await hostApp.connect();
    refreshNotifyVisibility?.();
    const timer = window.setInterval(async () => {
      if (document.visibilityState === "hidden" || isBusy()) return;
      try {
        const result = await hostApp.callServerTool({
          name: "get_board",
          arguments: { include_canvas_fidelity: true, include_guide: false },
        });
        if (result.isError) return;
        const data = result.structuredContent as BoardSnapshot | undefined;
        if (!data || !Array.isArray(data.items) || typeof data.revision !== "number") return;
        onSnapshot(data);
      } catch {}
    }, 4000);
    window.addEventListener("pagehide", () => window.clearInterval(timer), { once: true });
  };

  return {
    embedded: options.embedded,
    channel: options.embedded ? "mcp-app" : "standalone",
    loadBoard,
    syncBoard,
    libraryRequest,
    publishContext,
    initNotifyButton,
    setFallbackMcpApp(app) { activeMcpApp = app; },
    startLiveUpdates,
  };
}
