/**
 * Theme decisions for the canvas.
 *
 * Board v1 stores an object's own colour but not the page behind it. The canvas
 * can be light or dark, so ink and fill are chosen here rather than baked into
 * stored data. An explicit `style.textColor` / `style.borderColor` always wins.
 */

import type { BoardItem } from "../model/types.js";
import type { CanvasTheme, ExcalidrawSkeleton } from "./types.js";

export function boardOpacityToExcalidraw(opacity: number | undefined): number {
  if (typeof opacity !== "number" || !Number.isFinite(opacity)) return 100;
  return Math.round(Math.max(0.01, Math.min(1, opacity)) * 100);
}

/**
 * Canvas ink for each theme.
 *
 * Board v1 stores an object's own colour, but not the page it sits on. The
 * adapter always emitted one dark ink, which is invisible on the dark canvas -
 * the text was there, just unreadable. Ink is therefore chosen by theme, and an
 * explicit `style.textColor` / `style.borderColor` still wins.
 */
const CANVAS_INK: Record<CanvasTheme, string> = {
  light: "#1f2937",
  dark: "#e8eeea",
};


const CANVAS_BACKGROUND: Record<CanvasTheme, string> = {
  light: "#f5f6f0",
  dark: "#131a18",
};

/** A frame is a page-like backdrop; pure white is wrong in dark mode. */
const CANVAS_PANEL: Record<CanvasTheme, string> = {
  light: "#ffffff",
  dark: "#1d2521",
};

/**
 * Board v1 records literal colours, but a colour that means "paper" has to
 * follow the theme. Pure white/near-white fills are mapped so a frame or card
 * does not turn into a glaring block - or hide its contents - in dark mode.
 */
export function themedFill(color: string | undefined, theme: CanvasTheme): string | undefined {
  if (!color) return color;
  // Judge by luminance, not by a hex prefix: `#f6d365` is a yellow card, while
  // `#fbfbfc` is paper. A prefix rule silently erased saturated fills.
  if (theme === "dark" && /^#[0-9a-fA-F]{6}$/.test(color) && isNearWhite(color)) return CANVAS_PANEL.dark;
  return color;
}

/** True for colours that read as paper rather than as a deliberate fill. */
function isNearWhite(hex: string): boolean {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return Math.min(r, g, b) >= 230 && spread <= 12;
}

function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  if (value.length !== 6) return 0;
  const channels = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const left = relativeLuminance(a);
  const right = relativeLuminance(b);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

/**
 * Keep an object's own colour when it reads against the page, otherwise fall
 * back to the theme's ink. A line with `color: #ffffff` on a white canvas is the
 * same bug as dark ink on a dark canvas.
 */
export function readableStroke(color: string | undefined, theme: CanvasTheme): string {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color) && contrast(color, CANVAS_BACKGROUND[theme]) >= 3) return color;
  return CANVAS_INK[theme];
}

/**
 * Ink that reads against the surface it actually sits on.
 *
 * Text inside a yellow card must be dark even when the page is dark; choosing
 * ink by page background painted light text on a light card. When an object has
 * its own fill, that fill decides.
 */
export function inkOn(fill: string | undefined, theme: CanvasTheme): string {
  const surface = fill && /^#[0-9a-fA-F]{6}$/.test(fill) && !isNearWhite(fill) ? fill : CANVAS_BACKGROUND[theme];
  return contrast(CANVAS_INK[theme], surface) >= 4.5 ? CANVAS_INK[theme] : CANVAS_INK.light;
}

export function styleFor(item: BoardItem, theme: CanvasTheme): Partial<ExcalidrawSkeleton> {
  const style = item.style || {};
  // A standalone text object paints with its stroke, so `textColor` must reach
  // strokeColor; shapes keep their border colour for the outline.
  const textInk = item.type === "text" ? style.textColor : undefined;
  /*
   * An explicit border colour still has to be visible on the page it lands on.
   *
   * Board v1 stores the ink a person chose, and on a dark page a stored
   * `#1e1e1e` outline is invisible — the shape is there, just unreadable. The
   * stored value is kept when it clears the contrast floor and replaced with
   * the theme's ink when it does not, the same rule `readableStroke` already
   * applied to arrows. Nothing is written back to the board: this is a render
   * decision, so switching themes never mutates someone's drawing.
   */
  const borderInk = style.borderColor && readableStroke(style.borderColor, theme) !== style.borderColor
    ? CANVAS_INK[theme]
    : style.borderColor;
  return {
    strokeColor: textInk
      ?? borderInk
      ?? (item.type === "line" ? readableStroke(item.color, theme) : CANVAS_INK[theme]),
    backgroundColor: item.type === "line" || item.type === "stroke" || item.type === "image" ? "transparent" : (themedFill(item.color, theme) ?? "transparent"),
    strokeWidth: style.strokeWidth ?? (item.type === "stroke" ? 3 : 2),
    strokeStyle: item.variant === "frame" ? "dashed" : "solid",
    roughness: item.variant === "frame" || item.role === "step" ? 0 : 1,
    roundness: item.variant === "pill" ? { type: 3 } : item.variant === "card" ? { type: 3 } : null,
    opacity: boardOpacityToExcalidraw(style.opacity),
    fontSize: style.fontSize ?? (item.variant === "heading" ? 28 : item.type === "text" ? 20 : 16),
    fontFamily: 3,
    textAlign: style.textAlign ?? (item.type === "text" ? "left" : "center"),
    groupIds: item.groupId ? [item.groupId] : [],
    customData: { doodle: { id: item.id, author: item.author, role: item.role, variant: item.variant, z: item.z, emphasis: item.emphasis, textAlign: style.textAlign, lineHeight: 1.25, color: item.color, textColor: style.textColor, borderColor: style.borderColor } },
  };
}

