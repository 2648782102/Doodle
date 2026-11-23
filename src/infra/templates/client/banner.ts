/**
 * Page-level sync/connection status banner and first-run empty-board card.
 * Neither lives in board state.
 */

import type { BoardSnapshot } from "./types.js";

export const WELCOME_STORAGE_KEY = "doodle-welcome-dismissed";

let errorTimer: number | null = null;
let connectionNoticeVisible = false;
let welcomeDismissed = false;

/** The one page-level banner, created on first use. Not board state. */
export function ensureSyncBanner(): HTMLElement {
  const existing = document.querySelector<HTMLElement>("#doodleSyncBanner");
  if (existing) return existing;
  const banner = document.createElement("div");
  banner.id = "doodleSyncBanner";
  banner.className = "doodle-sync-banner doodle-glass";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  document.body.append(banner);
  return banner;
}

/**
 * Say when the canvas is no longer talking to the server.
 * Sticky notices have no timeout and outlive an unrelated `clearError()`.
 */
export function showConnectionNotice(message: string): void {
  connectionNoticeVisible = true;
  const banner = ensureSyncBanner();
  banner.textContent = message;
  banner.dataset.visible = "true";
  banner.dataset.sticky = "true";
  if (errorTimer !== null) {
    window.clearTimeout(errorTimer);
    errorTimer = null;
  }
}

export function showConnectedNotice(): void {
  if (!connectionNoticeVisible) return;
  connectionNoticeVisible = false;
  const banner = document.querySelector<HTMLElement>("#doodleSyncBanner");
  if (banner) {
    banner.removeAttribute("data-sticky");
    banner.removeAttribute("data-visible");
  }
}

/** Tell the person when a save was rejected, without reloading over their drawing. */
export function showError(error: unknown): void {
  console.warn("Doodle board sync skipped", error);
  const message = error instanceof Error ? error.message : String(error);
  const banner = ensureSyncBanner();
  banner.removeAttribute("data-sticky");
  banner.textContent = `这次改动没有保存：${message}`;
  banner.dataset.visible = "true";
  if (errorTimer !== null) window.clearTimeout(errorTimer);
  errorTimer = window.setTimeout(() => {
    errorTimer = null;
    banner?.removeAttribute("data-visible");
  }, 8000);
}

export function clearError(): void {
  if (errorTimer !== null) {
    window.clearTimeout(errorTimer);
    errorTimer = null;
  }
  const banner = document.querySelector<HTMLElement>("#doodleSyncBanner");
  // A sticky banner belongs to the connection state, not to a save result.
  if (banner?.dataset.sticky === "true") return;
  banner?.removeAttribute("data-visible");
}

/** Teach the first empty board once. */
export function initWelcome(snapshot: BoardSnapshot): void {
  const card = document.querySelector<HTMLElement>("#doodleWelcome");
  const dismiss = document.querySelector<HTMLButtonElement>("#doodleWelcomeDismiss");
  if (!card || !dismiss) return;
  try {
    welcomeDismissed = localStorage.getItem(WELCOME_STORAGE_KEY) === "1";
  } catch {}
  if (welcomeDismissed || snapshot.items.length > 0) return;
  dismiss.addEventListener("click", () => dismissWelcome());
  card.hidden = false;
}

/**
 * Retire the first-use card as soon as it has served its purpose.
 *
 * Dismissing the card by its button is not the only way to graduate from an
 * empty board: a person can draw straight through it. In that case the card
 * stayed up over the first object they made, and they had to close a tutorial
 * covering the drawing they had already done.
 */
export function dismissWelcome(): void {
  if (welcomeDismissed) return;
  const card = document.querySelector<HTMLElement>("#doodleWelcome");
  if (card) card.hidden = true;
  welcomeDismissed = true;
  try {
    localStorage.setItem(WELCOME_STORAGE_KEY, "1");
  } catch {}
}

/** Retire the card once a snapshot has any object, from either writer. */
export function dismissWelcomeFor(snapshot: { items: unknown[] }): void {
  if (snapshot.items.length > 0) dismissWelcome();
}

export interface ConflictAction {
  label: string;
  /** `primary` is the safe choice; `danger` overwrites the other writer. */
  tone?: "primary" | "danger";
  run: () => void | Promise<void>;
}

/**
 * A rejected write that a person can actually resolve.
 *
 * A transient toast was the wrong shape for this: the change is still unsaved,
 * so the notice must stay until the person decides, and it must name the objects
 * that collided instead of asking them to guess. Two explicit choices — take the
 * server's version, or keep mine — beat an automatic overwrite in either
 * direction, because both writers are people-or-agents who meant their edit.
 */
export function showConflictNotice(message: string, actions: ConflictAction[]): void {
  const bar = document.querySelector<HTMLElement>("#doodleConflictNotice");
  const text = bar?.querySelector<HTMLElement>("[data-conflict-message]");
  const list = bar?.querySelector<HTMLElement>("[data-conflict-actions]");
  if (!bar || !text || !list) {
    showError(new Error(message));
    return;
  }
  text.textContent = message;
  list.replaceChildren();
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    if (action.tone === "danger") button.dataset.tone = "danger";
    if (action.tone === "primary") button.dataset.tone = "primary";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await action.run();
      } finally {
        button.disabled = false;
      }
    });
    list.append(button);
  }
  bar.hidden = false;
}

export function clearConflictNotice(): void {
  const bar = document.querySelector<HTMLElement>("#doodleConflictNotice");
  if (bar) bar.hidden = true;
}

export function conflictNoticeVisible(): boolean {
  const bar = document.querySelector<HTMLElement>("#doodleConflictNotice");
  return Boolean(bar && !bar.hidden);
}
