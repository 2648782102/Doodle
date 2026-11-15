/**
 * Small pure helpers shared by both projection directions.
 *
 * `round` and `finite` exist because Excalidraw reports unrounded floats and
 * occasionally `undefined` for optional geometry; both directions must agree on
 * how that becomes a stored number.
 */

import type { BoardItem } from "../model/types.js";

export function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function textOf(item: BoardItem): string {
  return item.text;
}

export function labelOf(item: BoardItem): string {
  return item.title ? `${item.title}\n${item.text}` : item.text;
}

export function splitText(raw: string): { title?: string; text: string } {
  const lines = raw.split("\n");
  if (lines.length > 1) return { title: lines[0], text: lines.slice(1).join("\n") };
  return { text: raw };
}

export function isTextContainer(item: BoardItem): boolean {
  return item.type === "note" || item.type === "rect" || item.type === "ellipse";
}

