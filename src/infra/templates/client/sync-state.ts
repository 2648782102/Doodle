/**
 * The canvas' sync state, as a five-value contract rather than a spinner.
 *
 * `0.8.0` told a person two things: an error toast and a WebSocket banner. In
 * between, a drag was either saved or silently lost, and "did the agent see
 * this?" had no answer at all. Issue #22 asks for the finite states a person
 * can act on, so they are modelled here once and rendered by `renderSyncChip`.
 *
 * Pure: no DOM at module scope, so Node can test the transitions.
 */

export type SyncPhase =
  /** Page loaded, nothing to say. */
  | "idle"
  /** Local changes exist and are not yet written. */
  | "dirty"
  /** A write is in flight. */
  | "saving"
  /** Written to the board file. */
  | "saved"
  /** Written *and* published into the host model context. */
  | "synced"
  /** A notification was handed to the host; the agent has not read it yet. */
  | "awaiting-agent"
  /** Some objects collided with a concurrent write and need a decision. */
  | "conflict"
  /** The live channel is down; edits are held locally and sent on reconnect. */
  | "offline"
  /** The live channel is down for good; edits can no longer be saved. */
  | "detached";

export type SyncChannel = "standalone" | "mcp-app";

export type SyncTone = "neutral" | "busy" | "ok" | "warn" | "alert";

export interface SyncPhaseView {
  label: string;
  detail: string;
  tone: SyncTone;
}

/**
 * Every event the canvas can observe about its own persistence.
 *
 * Deliberately excludes "agent read the board": nothing in the protocol reports
 * that, and inventing it would be the same lie as a button that says "sent" for
 * a message the host dropped. `notified` means exactly "handed to the host".
 */
export type SyncEvent =
  | "loaded"
  | "local-edit"
  | "saving"
  | "saved"
  | "published"
  | "notified"
  | "conflict"
  | "offline"
  | "online"
  /** Reconnect attempts are exhausted; the board cannot be written to again. */
  | "detached";

const PHASE_VIEWS: Record<SyncPhase, SyncPhaseView> = {
  idle: { label: "就绪", detail: "画板已载入", tone: "neutral" },
  dirty: { label: "未保存", detail: "本地改动会在片刻后写入画板", tone: "busy" },
  saving: { label: "保存中", detail: "正在写入画板", tone: "busy" },
  saved: { label: "已保存", detail: "改动已写入画板，AI 下次读取可见", tone: "ok" },
  synced: { label: "已同步", detail: "当前画板已同步到宿主对话上下文", tone: "ok" },
  "awaiting-agent": { label: "等 Agent", detail: "已通知 Agent 读取画板", tone: "busy" },
  conflict: { label: "待处理", detail: "部分对象与别处的改动冲突，需要选择保留哪一份", tone: "alert" },
  offline: { label: "离线", detail: "与画板的连接断开，改动暂存在本机，恢复后自动提交", tone: "warn" },
  detached: { label: "已断开", detail: "画板进程已结束，画布显示上次的内容；请重新打开画板以继续保存", tone: "alert" },
};

export function syncPhaseView(phase: SyncPhase): SyncPhaseView {
  return PHASE_VIEWS[phase];
}

/** Channel ownership, stated explicitly so a person knows which path they are on. */
export function channelLabel(channel: SyncChannel): string {
  return channel === "mcp-app" ? "宿主内嵌" : "本机页面";
}

/**
 * The one transition table. Anything not listed keeps the current phase, which
 * makes an unexpected event harmless instead of jumping to a wrong claim.
 */
export function syncPhaseAfter(phase: SyncPhase, event: SyncEvent): SyncPhase {
  switch (event) {
    case "loaded":
      return "saved";
    case "local-edit":
      // A conflict stays visible until it is resolved; a new edit does not hide it.
      return phase === "conflict" ? "conflict" : "dirty";
    case "saving":
      return phase === "conflict" ? "conflict" : "saving";
    case "saved":
      return "saved";
    case "published":
      return "synced";
    case "notified":
      return "awaiting-agent";
    case "conflict":
      return "conflict";
    case "offline":
      // A conflict outranks a disconnect: it still needs a decision.
      return phase === "conflict" ? "conflict" : "offline";
    case "online":
      return phase === "offline" || phase === "detached" ? "saved" : phase;
    case "detached":
      return "detached";
    default:
      return phase;
  }
}

export interface SyncChip {
  readonly phase: SyncPhase;
  readonly channel: SyncChannel;
  /** Apply an event, re-render, and return the resulting phase. */
  send(event: SyncEvent): SyncPhase;
  setChannel(channel: SyncChannel): void;
}

/**
 * The visible chip. Missing markup is not an error: hosts that strip the bar
 * should still get working canvas sync, so every DOM touch is guarded.
 */
export function renderSyncChip(
  element: Element | null,
  phase: SyncPhase,
  channel: SyncChannel,
): void {
  if (!element) return;
  const view = syncPhaseView(phase);
  element.setAttribute("data-phase", phase);
  element.setAttribute("data-channel", channel);
  element.setAttribute("title", `${view.label} · ${channelLabel(channel)} — ${view.detail}`);
  const label = element.querySelector<HTMLElement>("[data-sync-label]");
  if (label) label.textContent = view.label;
  const detail = element.querySelector<HTMLElement>("[data-sync-detail]");
  if (detail) detail.textContent = channelLabel(channel);
  element.setAttribute("aria-label", `${view.label}，${channelLabel(channel)}。${view.detail}`);
}

export function createSyncChip(channel: SyncChannel, root?: ParentNode | null): SyncChip {
  const scope = root ?? (typeof document === "undefined" ? null : document);
  let element: Element | null = null;
  let phase: SyncPhase = "idle";
  let current = channel;
  const paint = () => {
    element = element ?? scope?.querySelector("#doodleSyncState") ?? null;
    renderSyncChip(element, phase, current);
  };
  paint();
  return {
    get phase() { return phase; },
    get channel() { return current; },
    send(event) {
      phase = syncPhaseAfter(phase, event);
      paint();
      return phase;
    },
    setChannel(next) {
      current = next;
      paint();
    },
  };
}
