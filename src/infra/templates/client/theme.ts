/**
 * Appearance state, theme switcher wiring, and canvas ground palette.
 */

import type { LiquidGlassController } from "../liquid-glass.js";

/**
 * Every appearance Doodle ships, in switcher order.
 *
 * This array is the single source of truth: the type is derived from it, the
 * switcher renders it, and `readTheme` validates against it. Adding a fourth
 * appearance is a one-line change here plus a token block in the template —
 * no `if (theme === …)` chain to thread through.
 */
export const THEMES = [
  { id: "light", label: "浅色", hint: "纸面与铅笔" },
  { id: "dark", label: "深色", hint: "夜纸与浅墨" },
  { id: "glass", label: "液态玻璃", hint: "暖纸与松绿" },
] as const;

export type DoodleTheme = (typeof THEMES)[number]["id"];

const THEME_IDS = THEMES.map((theme) => theme.id) as readonly DoodleTheme[];
export const THEME_STORAGE_KEY = "doodle-theme";

/** Cross-bundle event name; both the switcher and the canvas import this. */
export const THEME_CHANGE_EVENT = "doodle-theme-change";

export function isDoodleTheme(value: unknown): value is DoodleTheme {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

/**
 * The canvas ground for each appearance.
 *
 * `view` is always transparent so `--doodle-canvas-bg` paints the surface
 * without reinitialising Excalidraw; `export` is opaque for PNG/JPG sharing.
 */
export const canvasColors: Record<DoodleTheme, { view: string; export: string }> = {
  light: { view: "transparent", export: "#faf7f0" },
  dark: { view: "transparent", export: "#faf7f0" },
  glass: { view: "transparent", export: "#f7f8f5" },
};

/**
 * Excalidraw inverts element colours when its own theme is dark. Doodle keeps
 * Excalidraw on light so stored colours stay literal, and paints dark mode
 * with `--doodle-canvas-bg`.
 */
export const EXCALIDRAW_THEME = "light" as const;

export function canvasThemeFor(theme: DoodleTheme): "light" | "dark" {
  return theme === "dark" ? "dark" : "light";
}

export function readTheme(): DoodleTheme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isDoodleTheme(stored) ? stored : "light";
  } catch {
    return "light";
  }
}

export function syncThemeSwitcher(theme: DoodleTheme): void {
  const active = THEMES.find((entry) => entry.id === theme) ?? THEMES[0];
  const group = document.querySelector<HTMLElement>("#doodleThemeToggle");
  if (group) {
    group.setAttribute("aria-label", `外观：${active.label}`);
    group.title = `外观：${active.label}（${active.hint}）`;
    for (const button of group.querySelectorAll<HTMLButtonElement>("[data-theme-option]")) {
      const selected = button.dataset.themeOption === theme;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
  }
}

export function applyTheme(theme: DoodleTheme, animate = false): void {
  if (document.documentElement.dataset.doodleTheme === theme) return;
  if (animate) {
    document.documentElement.classList.add("theme-switching");
    window.setTimeout(() => document.documentElement.classList.remove("theme-switching"), 260);
  }
  document.documentElement.dataset.doodleTheme = theme;
  document.documentElement.dataset.doodleMaterial = theme === "glass" ? "glass" : "paper";
  (window as unknown as { DOODLE_THEME?: DoodleTheme }).DOODLE_THEME = theme;
  syncThemeSwitcher(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {}
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
}

export function initThemeToggle(getGlass: () => LiquidGlassController | null): void {
  applyTheme(readTheme());
  const group = document.querySelector<HTMLElement>("#doodleThemeToggle");
  group?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-theme-option]");
    if (button && isDoodleTheme(button.dataset.themeOption)) applyTheme(button.dataset.themeOption, true);
  });
  window.addEventListener(THEME_CHANGE_EVENT, () => {
    requestAnimationFrame(() => getGlass()?.refresh());
  });
}
