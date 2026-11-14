import { App } from "@modelcontextprotocol/ext-apps";
import { buildBoardModelContext, type BoardContextSnapshot } from "./app-context.js";

type BoardSnapshot = BoardContextSnapshot;

interface DoodleBoardAdapter {
  getBoard: () => Promise<BoardSnapshot>;
  drawBoard: (args: Record<string, unknown>) => Promise<BoardSnapshot>;
  library: (action: Record<string, unknown>) => Promise<BoardLibraryResult>;
  readonly revision: number;
  readonly canFullscreen: boolean;
  readonly canNotifyAgent: boolean;
  requestFullscreen: () => Promise<unknown>;
  notifyAgent: () => Promise<void>;
}

interface BoardLibraryResult {
  index: unknown;
  board: BoardSnapshot;
  exportBoard?: BoardSnapshot;
}

declare global {
  interface Window {
    DoodleBoardUpdate?: (snapshot: BoardSnapshot) => void;
    DoodleBoardLibraryUpdate?: (index: unknown, snapshot: BoardSnapshot) => void;
    DoodleBoardInit?: (adapter: DoodleBoardAdapter) => void;
  }
}

const app = new App(
  { name: "Doodle", version: "1.0.0" },
  { availableDisplayModes: ["inline", "fullscreen"] },
);
let snapshot: BoardSnapshot | null = null;
let publishedSnapshot: BoardSnapshot | null = null;
let contextUpdate: Promise<void> | null = null;
const hostCapabilities = { updateText: false, updateStructured: false, notify: false };

function readSnapshot(result: { structuredContent?: unknown }): BoardSnapshot {
  const data = result.structuredContent as BoardSnapshot | undefined;
  if (!data || !Array.isArray(data.items) || typeof data.revision !== "number" || typeof data.title !== "string") {
    throw new Error("The Doodle server returned an invalid board snapshot");
  }
  const library = (data as Record<string, unknown>).library;
  const forceUpdate = Boolean(library);
  if (snapshot && data.revision <= snapshot.revision && !forceUpdate) {
    window.DoodleBoardLibraryUpdate?.(library, snapshot);
    return snapshot;
  }
  const normalized = { ...data } as BoardSnapshot;
  snapshot = normalized;
  window.DoodleBoardUpdate?.(normalized);
  void publishBoardContext(normalized);
  return normalized;
}

async function publishBoardContext(current: BoardSnapshot): Promise<void> {
  if (!hostCapabilities.updateText) return;
  if (publishedSnapshot?.revision === current.revision) {
    if (contextUpdate) await contextUpdate;
    return;
  }
  const previous = publishedSnapshot;
  const request = buildBoardModelContext(current, previous, {
    includeStructuredContent: hostCapabilities.updateStructured,
  });
  const params = {
    content: request.content,
    ...(hostCapabilities.updateStructured ? { structuredContent: request.structuredContent } : {}),
  };
  const pending = app.updateModelContext(params).then(() => {
    publishedSnapshot = current;
  }).catch((error) => {
    console.debug("Doodle board context update skipped", error);
    throw error;
  });
  contextUpdate = pending;
  try {
    await pending;
  } finally {
    if (contextUpdate === pending) contextUpdate = null;
  }
}

app.ontoolresult = (result) => {
  if (result.isError) return;
  const structured = result.structuredContent as Record<string, unknown> | undefined;
  if (structured && Array.isArray(structured.items) && typeof structured.revision === "number" && typeof structured.title === "string") {
    try { readSnapshot(result); } catch (error) { console.error(error); }
  }
};

await app.connect();
const capabilities = app.getHostCapabilities();
hostCapabilities.updateText = Boolean(capabilities?.updateModelContext?.text);
hostCapabilities.updateStructured = Boolean(capabilities?.updateModelContext?.structuredContent);
hostCapabilities.notify = Boolean(capabilities?.message?.text);
if (snapshot) void publishBoardContext(snapshot).catch(() => {});

const refreshTimer = window.setInterval(async () => {
  if (document.visibilityState === "hidden") return;
  try {
    const result = await app.callServerTool({ name: "get_board", arguments: {} });
    if (!result.isError) readSnapshot(result);
  } catch (error) {
    console.debug("Doodle board refresh skipped", error);
  }
}, 4000);

app.ontoolcancelled = () => window.clearInterval(refreshTimer);
window.addEventListener("pagehide", () => window.clearInterval(refreshTimer), { once: true });

window.DoodleBoardInit?.({
  async getBoard() {
    if (snapshot) return snapshot;
    return readSnapshot(await app.callServerTool({ name: "get_board", arguments: {} }));
  },
  async drawBoard(args: Record<string, unknown>) {
    try {
      const result = await app.callServerTool({
        name: "draw_board",
        arguments: { ...args, expected_revision: snapshot?.revision ?? 0 },
      });
      if (result.isError) {
        const message = result.content?.map((item) => item.type === "text" ? item.text : "").join("\n") || "Canvas update failed";
        const latest = await app.callServerTool({ name: "get_board", arguments: {} });
        if (!latest.isError) readSnapshot(latest);
        throw new Error(message);
      }
      return readSnapshot(result);
    } catch (error) {
      if (String(error).includes("conflict")) {
        const latest = await app.callServerTool({ name: "get_board", arguments: {} });
        readSnapshot(latest);
      }
      throw error;
    }
  },
  async library(action: Record<string, unknown>) {
    const result = await app.callServerTool({
      name: "draw_board",
      arguments: { library: action, expected_revision: snapshot?.revision ?? 0 },
    });
    if (result.isError) {
      const message = result.content?.map((item) => item.type === "text" ? item.text : "").join("\n") || "Board library action failed";
      throw new Error(message);
    }
    const structured = result.structuredContent as Record<string, unknown> | undefined;
    const board = readSnapshot(result);
    window.DoodleBoardLibraryUpdate?.(structured?.library, board);
    return {
      index: structured?.library,
      board,
      ...(structured?.exportBoard ? { exportBoard: structured.exportBoard as BoardSnapshot } : {}),
    };
  },
  get revision() {
    return snapshot?.revision ?? 0;
  },
  get canFullscreen() {
    return app.getHostContext()?.availableDisplayModes?.includes("fullscreen") ?? false;
  },
  requestFullscreen() {
    return app.requestDisplayMode({ mode: "fullscreen" });
  },
  get canNotifyAgent() {
    return hostCapabilities.updateText && hostCapabilities.notify;
  },
  async notifyAgent() {
    if (!hostCapabilities.updateText || !hostCapabilities.notify) {
      throw new Error("当前宿主不支持通知 Agent");
    }
    const current = snapshot ?? readSnapshot(await app.callServerTool({ name: "get_board", arguments: {} }));
    if (publishedSnapshot?.revision !== current.revision) {
      await publishBoardContext(current);
    } else if (contextUpdate) {
      await contextUpdate;
    }
    const result = await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: "我改了 Doodle 画板，你看下图。" }],
    });
    if (result.isError) throw new Error("宿主拒绝了通知消息");
  },
});
