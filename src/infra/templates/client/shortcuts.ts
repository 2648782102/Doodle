/**
 * The keyboard-shortcut panel behind the capsule's `?`.
 *
 * UI state only: which panel is open lives in the DOM and, for the one thing
 * worth remembering, in browser storage. It is never board state or permission.
 */

import { WELCOME_STORAGE_KEY } from "./banner.js";

/**
 * Whether this panel has already introduced itself once.
 *
 * Without it, "open after the card is dismissed" means "open on every visit
 * forever", because the card's flag never clears.
 */
const SHORTCUTS_SEEN_KEY = "doodle-shortcuts-seen";

function welcomeDismissed(): boolean {
  try {
    return localStorage.getItem(WELCOME_STORAGE_KEY) === "1";
  } catch {
    // Storage blocked: assume it was dismissed and keep the panel quiet rather
    // than opening an overlay the person cannot dismiss persistently.
    return true;
  }
}

function shortcutsSeen(): boolean {
  try {
    return localStorage.getItem(SHORTCUTS_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

function rememberShortcutsSeen(): void {
  try {
    localStorage.setItem(SHORTCUTS_SEEN_KEY, "1");
  } catch {}
}

/**
 * Attach the panel to its trigger.
 *
 * Three ways in and out, because all three were missing:
 *   - the capsule button, for someone who does not know the shortcut;
 *   - `?`, which is what every other canvas uses and what the panel itself lists;
 *   - Escape, which must close the panel before anything else consumes the key.
 *
 * `?` is handled here rather than left to Excalidraw because Excalidraw's own
 * help dialog is a different, upstream thing: 24 rows of engine features, with
 * its header already hidden by Doodle's CSS. This panel answers "what do I press
 * to draw a rectangle", which is the question a Doodle user has.
 */
export function initShortcutPanel(): void {
  const toggle = document.querySelector<HTMLButtonElement>("#doodleShortcutToggle");
  const panel = document.querySelector<HTMLElement>("#doodleShortcuts");
  const close = document.querySelector<HTMLButtonElement>("#doodleShortcutsClose");
  if (!toggle || !panel || !close) return;

  const isOpen = () => !panel.hidden;
  /*
   * The library is a modal surface, so it owns Escape and `?` while it is up.
   *
   * Both listeners sit on `window`, where `stopPropagation` from one handler
   * does not stop a sibling on the same node: pressing Escape in the drawer also
   * closed this panel behind it and moved focus to the capsule, so the person
   * was dropped out of the dialog they had not dismissed. Ask the drawer instead
   * of racing it.
   */
  const drawerOpen = () => {
    const drawer = document.querySelector<HTMLElement>("#doodleLibraryPanel");
    return Boolean(drawer && !drawer.hidden);
  };

  const open = () => {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    // The panel is not modal: it floats beside the canvas and the person keeps
    // drawing. Focus lands on it so Escape and Tab behave predictably, but the
    // canvas shortcuts underneath still work.
    panel.focus({ preventScroll: true });
  };
  const shut = () => {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };
  /*
   * Opening the drawer hides this panel with CSS anyway; shutting it as well
   * keeps the state honest, so closing the drawer does not resurrect a popover
   * the person had already navigated away from.
   */
  window.addEventListener("doodle-library-open", () => {
    rememberShortcutsSeen();
    if (isOpen()) shut();
  });
  const togglePanel = () => {
    rememberShortcutsSeen();
    if (isOpen()) {
      shut();
      toggle.focus({ preventScroll: true });
    } else {
      open();
    }
  };

  toggle.addEventListener("click", togglePanel);
  close.addEventListener("click", () => {
    rememberShortcutsSeen();
    shut();
    toggle.focus({ preventScroll: true });
  });
  /*
   * Clicking anywhere else closes it, like a popover.
   *
   * Not `mousedown`: a click that starts a drag on the canvas should still close
   * the panel, but the pointerdown lands on the canvas and Excalidraw needs it.
   */
  document.addEventListener("pointerdown", (event) => {
    if (!isOpen()) return;
    const target = event.target as Node | null;
    if (target && (panel.contains(target) || toggle.contains(target))) return;
    rememberShortcutsSeen();
    shut();
  });
  window.addEventListener("keydown", (event) => {
    if (drawerOpen()) return;
    if (event.key === "Escape" && isOpen()) {
      // Before Excalidraw's own handlers: Escape should close the panel, not
      // also drop the current selection underneath it.
      event.preventDefault();
      event.stopPropagation();
      shut();
      toggle.focus({ preventScroll: true });
      return;
    }
    /*
     * `?` on most layouts is Shift+/, and typing it in a text element must not
     * open a panel instead of inserting the character. `isComposing` covers IME
     * input, and the element check covers every text field on the page.
     */
    if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    const active = document.activeElement as HTMLElement | null;
    const typing = active?.isContentEditable
      || ["INPUT", "TEXTAREA", "SELECT"].includes(active?.tagName ?? "");
    if (typing) return;
    event.preventDefault();
    event.stopPropagation();
    togglePanel();
  });

  /*
   * Show it once, unprompted, for a board the person has not seen yet — then
   * never again on its own. A shortcut list nobody can find is the same as no
   * shortcut list, and an empty board is exactly when it is useful.
   */
  /*
   * Desktop only.
   *
   * On a phone this is a bottom sheet that covers roughly half a 390 × 780
   * screen, and it would open on top of the empty board the person is trying to
   * see. There is no hover and no room for a second pane, so the panel is
   * something a phone user opens deliberately — the `?` button is in the capsule,
   * one tap away.
   */
  if (welcomeDismissed() && !shortcutsSeen() && window.matchMedia("(min-width: 641px)").matches) {
    rememberShortcutsSeen();
    open();
  }
}
