import { App } from "@modelcontextprotocol/ext-apps";

type BoardSnapshot = {
  revision: number;
  items: Array<Record<string, unknown> & { id: string }>;
};

declare global {
  interface Window {
    DoodleBoardUpdate?: (snapshot: BoardSnapshot) => void;
    DoodleBoardInit?: (adapter: {
      getBoard: () => Promise<BoardSnapshot>;
      drawBoard: (args: Record<string, unknown>) => Promise<BoardSnapshot>;
      readonly revision: number;
      readonly canFullscreen: boolean;
      requestFullscreen: () => Promise<unknown>;
    }) => void;
  }
}

const app = new App(
  { name: "Doodle", version: "1.0.0" },
  { availableDisplayModes: ["inline", "fullscreen"] },
);
let snapshot: BoardSnapshot | null = null;

function readSnapshot(result: { structuredContent?: unknown }): BoardSnapshot {
  const data = result.structuredContent as BoardSnapshot | undefined;
  if (!data || !Array.isArray(data.items) || typeof data.revision !== "number") {
    throw new Error("The Doodle server returned an invalid board snapshot");
  }
  if (snapshot && data.revision <= snapshot.revision) return snapshot;
  snapshot = data;
  window.DoodleBoardUpdate?.(data);
  return data;
}

app.ontoolresult = (result) => {
  if (result.isError) return;
  const structured = result.structuredContent as Record<string, unknown> | undefined;
  if (structured && Array.isArray(structured.items) && typeof structured.revision === "number") {
    try { readSnapshot(result); } catch (error) { console.error(error); }
  }
};

await app.connect();

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
  get revision() {
    return snapshot?.revision ?? 0;
  },
  get canFullscreen() {
    return app.getHostContext()?.availableDisplayModes?.includes("fullscreen") ?? false;
  },
  requestFullscreen() {
    return app.requestDisplayMode({ mode: "fullscreen" });
  },
});
