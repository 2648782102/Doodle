import { describe, expect, it } from "vitest";
import { createCanvasSync, rebaseScene } from "../dist/infra/templates/client/canvas-sync.js";
import { channelLabel, syncPhaseAfter, syncPhaseView } from "../dist/infra/templates/client/sync-state.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

/** A board with `items`, each `{ id, x }`, at `revision`. */
function snapshot(revision, items) {
  return {
    version: 1,
    id: "board-1",
    title: "Board",
    revision,
    updatedAt: "2026-01-01T00:00:00.000Z",
    items: items.map((item) => ({
      id: item.id,
      type: "rect",
      x: item.x ?? 0,
      y: 0,
      w: 100,
      h: 40,
      text: "",
      color: "#ffffff",
      author: "human",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: item.updatedAt ?? "2026-01-01T00:00:00.000Z",
      scene: { element: { id: item.id } },
    })),
  };
}

function scene(...ids) {
  return ids.map((id) => ({ id }));
}

/**
 * Stand-in for the Excalidraw projection.
 *
 * It keeps the stored item when the id already exists (the real adapter
 * preserves identity and only rewrites what the scene reports) and mints a new
 * item otherwise, which is enough to exercise the write path.
 */
function project(base, elements, files) {
  const byId = new Map(base.items.map((item) => [item.id, item]));
  const items = elements.map((element) => {
    const previous = byId.get(element.id);
    const position = files?.positions?.[element.id];
    if (!previous) {
      return {
        id: element.id,
        type: "rect",
        x: position ?? 0,
        y: 0,
        w: 10,
        h: 10,
        text: "",
        color: "#ffffff",
        author: "human",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        scene: { element: { id: element.id } },
      };
    }
    return position === undefined ? previous : { ...previous, x: position, updatedAt: "2026-02-02T00:00:00.000Z" };
  });
  return { ...base, items };
}

function harness({ initial, transport, debounceMs = 450 }) {
  const events = [];
  const saved = [];
  const errors = [];
  let current = initial;
  const sync = createCanvasSync({
    transport: {
      syncBoard: transport ?? (async (items, base) => {
        const next = { ...base, revision: base.revision + 1, items };
        current = next;
        return next;
      }),
    },
    getSnapshot: () => current,
    getSceneBase: () => current,
    project,
    applySaved: (updated, info) => {
      current = updated;
      saved.push({ revision: updated.revision, ...info });
    },
    report: (event) => events.push(event),
    onError: (error, retry) => errors.push({ error, retry }),
    debounceMs,
    setTimer: () => 1,
    clearTimer: () => {},
  });
  return {
    sync,
    events,
    saved,
    errors,
    setSnapshot: (next) => { current = next; },
    getSnapshot: () => current,
  };
}

describe("sync state", () => {
  it("names the five states a person can act on, with the channel they are on", () => {
    expect(syncPhaseView("dirty").label).toBe("未保存");
    expect(syncPhaseView("saving").label).toBe("保存中");
    expect(syncPhaseView("saved").label).toBe("已保存");
    expect(syncPhaseView("synced").label).toBe("已同步");
    expect(syncPhaseView("awaiting-agent").label).toBe("等 Agent");
    expect(syncPhaseView("conflict").tone).toBe("alert");
    expect(channelLabel("standalone")).toBe("本机页面");
    expect(channelLabel("mcp-app")).toBe("宿主内嵌");
  });

  it("keeps a conflict visible instead of hiding it behind the next keystroke", () => {
    expect(syncPhaseAfter("conflict", "local-edit")).toBe("conflict");
    expect(syncPhaseAfter("conflict", "saving")).toBe("conflict");
    expect(syncPhaseAfter("conflict", "saved")).toBe("saved");
  });

  it("only claims host sync when the host actually published", () => {
    expect(syncPhaseAfter("saved", "published")).toBe("synced");
    expect(syncPhaseAfter("saved", "saved")).toBe("saved");
    expect(syncPhaseAfter("saved", "notified")).toBe("awaiting-agent");
    expect(syncPhaseAfter("offline", "saved")).toBe("saved");
    expect(syncPhaseAfter("dirty", "offline")).toBe("offline");
  });
});

describe("canvas write rebasing", () => {
  it("writes the gesture a concurrent remote write landed on top of", async () => {
    const base = snapshot(1, [{ id: "item_a", x: 0 }]);
    const remote = snapshot(2, [{ id: "item_a", x: 0 }, { id: "item_b", x: 400 }]);
    const calls = [];
    const h = harness({
      initial: base,
      transport: async (items, baseBoard) => {
        calls.push({ items, baseRevision: baseBoard.revision });
        return { ...baseBoard, revision: baseBoard.revision + 1, items };
      },
    });

    h.sync.schedule(scene("item_a"), { positions: { item_a: 120 } });
    h.setSnapshot(remote);
    await h.sync.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].baseRevision).toBe(2);
    expect(calls[0].items.find((item) => item.id === "item_a").x).toBe(120);
    expect(h.saved[0]).toMatchObject({ revision: 3, rebased: true });
  });

  it("does not resurrect an object the remote writer deleted", async () => {
    const base = snapshot(1, [{ id: "item_a", x: 0 }, { id: "item_b", x: 300 }]);
    const remote = snapshot(2, [{ id: "item_a", x: 0 }]);
    const calls = [];
    const h = harness({
      initial: base,
      transport: async (items, baseBoard) => {
        calls.push(items.map((item) => item.id));
        return { ...baseBoard, revision: baseBoard.revision + 1, items };
      },
    });

    // The scene still shows item_b: the person had not seen the deletion yet.
    h.sync.schedule(scene("item_a", "item_b"), { positions: { item_a: 40 } });
    h.setSnapshot(remote);
    await h.sync.flush();

    expect(calls[0]).not.toContain("item_b");
    expect(h.saved[0].dropped).toBe(1);
  });

  it("keeps objects the person just created, even though the base never saw them", () => {
    const base = snapshot(1, [{ id: "item_a", x: 0 }]);
    const latest = snapshot(2, [{ id: "item_a", x: 0 }]);
    const { elements, dropped } = rebaseScene(scene("item_a", "ex_local_1"), base, latest);
    expect(dropped).toBe(0);
    expect(elements.map((element) => element.id)).toContain("ex_local_1");
  });

  it("reports an unchanged gesture without touching the board", async () => {
    const base = snapshot(1, [{ id: "item_a", x: 0 }]);
    let writes = 0;
    const h = harness({
      initial: base,
      transport: async (items, baseBoard) => {
        writes += 1;
        return baseBoard;
      },
    });
    h.sync.schedule(scene("item_a"), {}); // no position override: projection equals base
    await h.sync.flush();
    expect(writes).toBe(0);
    expect(h.events.at(-1)).toBe("saved");
  });

  it("surfaces a conflict and retries against the newest revision", async () => {
    const base = snapshot(1, [{ id: "item_a", x: 0 }]);
    const attempts = [];
    const h = harness({
      initial: base,
      transport: async (items, baseBoard) => {
        attempts.push(baseBoard.revision);
        if (attempts.length === 1) {
          const error = new Error("objects moved meanwhile");
          error.code = "REVISION_CONFLICT_OBJECTS";
          error.conflicts = ["item_a"];
          throw error;
        }
        return { ...baseBoard, revision: baseBoard.revision + 1, items };
      },
    });

    h.sync.schedule(scene("item_a"), { positions: { item_a: 80 } });
    await h.sync.flush();
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0].error.conflicts).toEqual(["item_a"]);

    // Someone else wrote again while the conflict bar was up.
    h.setSnapshot(snapshot(5, [{ id: "item_a", x: 55 }]));
    await h.errors[0].retry();
    expect(attempts).toEqual([1, 5]);
    expect(h.saved.at(-1).revision).toBe(6);
  });

  it("reports saving before it reports saved", async () => {
    const base = snapshot(1, [{ id: "item_a", x: 0 }]);
    const h = harness({ initial: base });
    h.sync.schedule(scene("item_a"), { positions: { item_a: 10 } });
    await h.sync.flush();
    expect(h.events).toEqual(["local-edit", "saving", "saved"]);
  });
});

describe("changing the active board mid-write", () => {
  /*
   * A person draws, then opens the library and picks another board inside the
   * 450 ms debounce. The pending frame is rebased onto whichever board is
   * active when the timer fires, so without a flush the stroke is projected
   * against the *new* board: it lands there and the board it was drawn on stays
   * empty. Switching a board is not a rebase; nothing about the old scene is
   * meaningful on a different board.
   */
  const appSource = read("src/infra/templates/excalidraw-app.tsx");
  const librarySource = read("src/infra/templates/client/library-ui.ts");

  it("flushes the pending canvas write before switching boards", () => {
    const body = librarySource.slice(librarySource.indexOf("const runLibraryAction = async"));
    const guard = body.slice(0, body.indexOf("const name ="));
    for (const action of ["switch", "create", "duplicate", "import"]) {
      expect(guard, `"${action}" would change boards without flushing`).toContain(`"${action}"`);
    }
    expect(guard).toContain("flushPendingWrites");
    // Reads and renames never move the canvas, so they must not pay for a write.
    expect(guard, "an export now waits on a canvas write").not.toContain('"export"');
    expect(guard, "a rename now waits on a canvas write").not.toContain('"rename"');
  });

  it("never adopts a different board without repainting", () => {
    /*
     * `repaint: false` keeps the old scene on screen and lets the rebase
     * reconcile it — correct for a newer revision of the same board, wrong
     * across boards. The guard has to compare ids, not just the option.
     */
    const body = appSource.slice(appSource.indexOf("function applyRemoteSnapshot"));
    const silent = body.slice(0, body.indexOf("if (isEditing("));
    expect(silent).toMatch(/options\.repaint === false && activeSnapshot && data\.id === activeSnapshot\.id/);
  });

  it("drops the outgoing board's queued write when the board actually changes", () => {
    const body = appSource.slice(appSource.indexOf("function applyRemoteSnapshot"));
    const change = body.slice(body.indexOf("data.id !== activeSnapshot.id"));
    expect(change, "the outgoing board's pending write was kept").toContain("canvasSync.current?.cancel()");
  });

  it("keys the remembered camera by the board the scene shows", () => {
    /*
     * After a switch, `activeSnapshot` is already the new board while the scene
     * still paints the old one. Saving the camera under the active id wrote the
     * old board's pan and zoom into the new board's entry, and both boards then
     * opened in the same wrong place.
     */
    const onChange = appSource.slice(appSource.indexOf("const onChange = useCallback"));
    const camera = onChange.slice(0, onChange.indexOf("stableStringify"));
    expect(camera, "the camera is keyed by the active board again").toContain("paintedBoardId.current");
    expect(camera).not.toContain("rememberViewport(activeSnapshot?.id");
  });

  it("confirms a notification only after the host accepts it", () => {
    /*
     * "通知 Agent" was silent on success. The chip has had an `awaiting-agent`
     * phase and a `notified` event for a while, but nothing ever sent the event,
     * so the phase could not be reached and a person had no evidence the message
     * left the page. The confirmation must follow `sendMessage`, not precede it:
     * a button that says 已通知 for a message the host dropped is a lie.
     */
    const transportSource = read("src/infra/templates/client/transport.ts");
    const notify = transportSource.slice(transportSource.indexOf("const initNotifyButton"));
    const body = notify.slice(0, notify.indexOf("updateVisibility();"));
    const sentIndex = body.indexOf("hostApp.sendMessage");
    const notifiedIndex = body.indexOf("onNotified?.()");
    expect(sentIndex, "the notify button no longer calls the host").toBeGreaterThan(0);
    expect(notifiedIndex, "the notify button never reports success").toBeGreaterThan(0);
    expect(notifiedIndex, "success is reported before the host answered").toBeGreaterThan(sentIndex);
    expect(body).toContain("result.isError");

    // The entry point has to forward the event into the chip, or the phase stays
    // unreachable and this whole callback is dead code.
    expect(appSource).toContain('status.send("notified")');
  });
});
