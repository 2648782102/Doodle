/**
 * The canvas must reattach to a board that went away, for as long as it takes.
 *
 * The two behaviours that were wrong: it gave up after ~22 s (so a session that
 * restarted later could never be picked up without a manual reload), and it
 * reattached without re-reading the board (so a missed revision stayed missed).
 */
import { describe, expect, it, vi } from "vitest";
import { RECONNECT_COPY, connectBoardUpdates } from "../dist/infra/templates/client/reconnect.js";

/** A socket the test drives by hand. */
function fakeSocket() {
  const handlers = new Map();
  return {
    addEventListener: (type, fn) => {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    fire(type, event) {
      for (const fn of handlers.get(type) ?? []) fn(event);
    },
  };
}

function harness() {
  const sockets = [];
  const timers = [];
  const events = [];
  const options = {
    url: "ws://127.0.0.1:1/ws",
    onChanged: (type) => events.push(`changed:${type}`),
    onOfflineChange: (offline) => events.push(offline ? "offline" : "online"),
    onDetached: () => events.push("detached"),
    onReattached: () => events.push("reattached"),
    onRetrying: (attempt) => events.push(`retrying:${attempt}`),
    onHeartbeat: () => events.push("heartbeat"),
    onConnected: () => events.push("connected"),
    createSocket: () => {
      const socket = fakeSocket();
      sockets.push(socket);
      return socket;
    },
    setTimer: (run, ms) => {
      timers.push({ run, ms });
      return timers.length;
    },
  };
  return { options, sockets, timers, events };
}

describe("board reconnection", () => {
  it("retries on the fast ladder before declaring itself detached", () => {
    const h = harness();
    connectBoardUpdates(h.options);
    h.sockets[0].fire("close");
    expect(h.events).toContain("retrying:1");
    expect(h.events).not.toContain("detached");
    expect(h.timers[0].ms).toBe(750);
  });

  it("never stops retrying once the ladder is exhausted", () => {
    const h = harness();
    connectBoardUpdates(h.options);
    // Five fast attempts, then the heartbeat.
    for (let i = 0; i < 5; i += 1) {
      h.sockets[i].fire("close");
      h.timers[i].run();
    }
    h.sockets[5].fire("close");
    expect(h.events).toContain("detached");
    expect(h.events).toContain("heartbeat");
    // The crucial part: a timer is still armed after giving up.
    expect(h.timers.at(-1).ms).toBe(15000);
    h.timers.at(-1).run();
    expect(h.sockets.length).toBeGreaterThan(6);
  });

  it("re-reads the board after a reconnect, but not the first connection", () => {
    const first = harness();
    connectBoardUpdates(first.options);
    first.sockets[0].fire("open");
    expect(first.events).not.toContain("reattached");

    const later = harness();
    connectBoardUpdates(later.options);
    later.sockets[0].fire("close");
    later.timers[0].run();
    later.sockets[1].fire("open");
    expect(later.events).toContain("reattached");
  });

  it("reports connectivity on both edges", () => {
    const h = harness();
    connectBoardUpdates(h.options);
    h.sockets[0].fire("open");
    h.sockets[0].fire("close");
    expect(h.events).toEqual(expect.arrayContaining(["connected", "online", "offline"]));
  });

  it("survives a socket constructor that throws", () => {
    const timers = [];
    connectBoardUpdates({
      ...harness().options,
      createSocket: () => { throw new Error("blocked"); },
      setTimer: (run, ms) => { timers.push({ run, ms }); return timers.length; },
    });
    // A blocked URL must not dead-end the page.
    expect(timers.at(-1).ms).toBe(15000);
  });

  it("states the truth in its copy", () => {
    // A reconnect that has stopped would make the heartbeat line a lie.
    expect(RECONNECT_COPY.heartbeat).toContain("自动重试");
    expect(RECONNECT_COPY.retrying(3)).toContain("第 3 次");
    // The boot message must not promise the board still exists.
    expect(RECONNECT_COPY.detachedOnBoot).toContain("本机还没有");
  });

  /*
   * Only board-change frames may trigger a re-read.
   *
   * The filter is what keeps a future heartbeat or presence ping from turning
   * into a whole-board fetch on every tick. It used to live inline in the
   * transport and was lost in the split once already.
   */
  it("ignores frames that do not mean the board moved", () => {
    const h = harness();
    connectBoardUpdates(h.options);
    const socket = h.sockets[0];
    socket.fire("message", { data: JSON.stringify({ type: "board_updated", revision: 2 }) });
    socket.fire("message", { data: JSON.stringify({ type: "board_library_updated", revision: 3 }) });
    socket.fire("message", { data: JSON.stringify({ type: "heartbeat" }) });
    socket.fire("message", { data: "not json" });
    const changed = h.events.filter((event) => event.startsWith("changed:"));
    expect(changed).toEqual(["changed:board_updated", "changed:board_library_updated"]);
  });
});
