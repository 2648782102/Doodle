/**
 * Keeping the canvas attached to a board that may go away and come back.
 *
 * The standalone page talks to a server owned by whichever MCP session started
 * it. That server disappearing is normal — a session ends, a host restarts, a
 * worktree is recycled — and the page must survive all of it, because the board
 * itself is a file that never moved.
 *
 * Two behaviours matter and used to be wrong:
 *
 * **It stops.** The ladder ended after ~22 s and told the person to reopen the
 * board. The common case is a session that restarts on the *same* URL a minute
 * later, so stopping turned a recoverable blip into a manual reload.
 *
 * **It reconnects silently.** A reconnect means revisions may have been missed
 * while the socket was down. Reattaching without re-reading leaves the canvas
 * showing a board that no longer matches the file.
 *
 * Kept out of `transport.ts` because it is a lifecycle concern, not a message
 * format one, and because it is the piece most likely to change again.
 */

export interface ReconnectOptions {
  /** Absolute ws:// or wss:// URL for the board's update channel. */
  url: string;
  /** Called with each board-changed message the server may send. */
  onChanged(type: string): void;
  /** Connectivity for the sync chip. */
  onOfflineChange(offline: boolean): void;
  /** Called once the fast ladder is exhausted; the chip says "已断开". */
  onDetached(): void;
  /** Called after a non-first reconnect succeeds, to re-read the board. */
  onReattached(): void;
  /** Status line while fast-retrying. */
  onRetrying(attempt: number): void;
  /** Status line once the heartbeat takes over. */
  onHeartbeat(): void;
  onConnected(): void;
  /** Injectable for tests; defaults to the browser globals. */
  createSocket?(url: string): WebSocket;
  setTimer?(run: () => void, ms: number): unknown;
}

const FAST_DELAYS_MS = [750, 1500, 3000, 6000, 12000];
/**
 * After the ladder, keep trying at this interval instead of stopping.
 *
 * A loopback connect that nobody is listening on costs nothing, and the
 * alternative — standing down — guarantees the person has to intervene.
 */
const HEARTBEAT_MS = 15000;

/**
 * What the person is told, in one place.
 *
 * These lines are the product's voice at the worst moment it has: the board is
 * unreachable. They used to live in three files and disagreed — one promised a
 * reconnect that had already stopped, one said to reload a page that was still
 * trying. Keeping them together makes that kind of drift visible.
 */
export const RECONNECT_COPY = {
  retrying: (attempt: number) => `画板连接已断开，正在重连（第 ${attempt} 次）… 这期间的改动不会保存`,
  heartbeat: "画板服务暂时连不上，页面显示的是上次读到的内容；已改为每 15 秒自动重试。",
  /** A first load that found neither a server nor a local copy. */
  detachedOnBoot: "画板服务暂时连不上，且本机还没有这个画板的副本；重新打开画板即可重试。",
} as const;

export function connectBoardUpdates(options: ReconnectOptions): void {
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url));
  const setTimer = options.setTimer ?? ((run: () => void, ms: number) => window.setTimeout(run, ms));
  /*
   * Only messages that mean "the board moved".
   *
   * The server sends nothing else today, but a reconnect that re-read the board
   * on *every* frame would turn a future heartbeat or presence ping into a
   * whole-board fetch. The filter used to live inline in the transport; keeping
   * it here is what ties it to the socket it belongs to.
   */
  const BOARD_MESSAGE_TYPES = ["board_updated", "board_library_updated"];

  const attemptFrom = (attempt: number): void => {
    let socket: WebSocket;
    try {
      socket = createSocket(options.url);
    } catch {
      // A malformed or blocked URL will never open; stay on the heartbeat so a
      // reload is not the only way back.
      setTimer(() => attemptFrom(attempt + 1), HEARTBEAT_MS);
      return;
    }

    socket.addEventListener("message", (event: MessageEvent) => {
      let type: unknown;
      try {
        type = (JSON.parse(String(event.data)) as { type?: unknown })?.type;
      } catch {
        return;
      }
      if (typeof type === "string" && BOARD_MESSAGE_TYPES.includes(type)) options.onChanged(type);
    });

    socket.addEventListener("close", () => {
      options.onOfflineChange(true);
      const fast = attempt < FAST_DELAYS_MS.length;
      if (fast) {
        options.onRetrying(attempt + 1);
        setTimer(() => attemptFrom(attempt + 1), FAST_DELAYS_MS[attempt]);
        return;
      }
      options.onDetached();
      options.onHeartbeat();
      setTimer(() => attemptFrom(attempt + 1), HEARTBEAT_MS);
    });

    socket.addEventListener("open", () => {
      options.onConnected();
      options.onOfflineChange(false);
      // A long outage may have moved the board on; take the current state.
      if (attempt > 0) options.onReattached();
    });
  };

  attemptFrom(0);
}
