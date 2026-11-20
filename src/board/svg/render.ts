/**
 * Board v1 → SVG, for readers that cannot run the canvas.
 *
 * The board is the product and the canvas is its editor, but an agent, a README,
 * or a CI job sometimes needs to *see* a board without a browser. This is a
 * read-only projection: it never mutates the board, never becomes a second
 * persisted format, and adds no tool. Board v1 stays authoritative — the SVG is
 * derived on request, the way `visualDigest` is.
 *
 * Deliberately plain: rectangles, ellipses, text, polylines and arrows, in the
 * same geometry the canvas projects. It is a preview, not a renderer — no
 * hand-drawn roughness, no scene fidelity, no fonts beyond the system stack.
 */

import type { BoardItem, SimpleBoard } from "../model/types.js";

export interface SvgRenderOptions {
  /** Blank margin around the content, in board units. */
  padding?: number;
  /** Paint the page background. Off gives a transparent SVG for embedding. */
  background?: boolean;
  /** Cap the long edge, scaling down large boards for a README or an issue. */
  maxSize?: number;
}

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', sans-serif";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Wrap a label into at most `maxLines` lines of roughly `perLine` characters. */
function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words.length ? words : [text]) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= perLine) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    // A single word longer than the line is sliced rather than overflowing.
    let rest = word;
    while (rest.length > perLine) {
      lines.push(rest.slice(0, perLine));
      rest = rest.slice(perLine);
    }
    current = rest;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

function boundsOf(items: BoardItem[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    // A line stores (x,y) plus signed deltas, so its extent is a rectangle too.
    const left = item.type === "line" ? Math.min(item.x, item.x + item.w) : item.x;
    const top = item.type === "line" ? Math.min(item.y, item.y + item.h) : item.y;
    const right = item.type === "line" ? Math.max(item.x, item.x + item.w) : item.x + item.w;
    const bottom = item.type === "line" ? Math.max(item.y, item.y + item.h) : item.y + item.h;
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, bottom);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 320, h: 200 };
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function renderItem(item: BoardItem): string {
  const style = item.style ?? {};
  const stroke = style.borderColor ?? "#1e1e1e";
  const strokeWidth = style.borderWidth ?? 2;
  const fill = item.color === "transparent" ? "none" : item.color;
  const opacity = style.opacity ?? 1;
  const opacityAttr = opacity < 1 ? ` opacity="${opacity}"` : "";
  const label = item.title ? `${item.title}\n${item.text}` : item.text;
  const lines = label ? wrap(label, Math.max(6, Math.floor(item.w / 9)), 4) : [];
  const fontSize = style.fontSize ?? 14;
  const weight = style.fontWeight === "bold" ? 600 : 400;
  const textColor = style.textColor ?? "#1e1e1e";
  const centreY = lines.length
    ? item.y + item.h / 2 - ((lines.length - 1) * fontSize * 1.25) / 2
    : item.y + item.h / 2;
  const anchorX = style.textAlign === "left" ? item.x + 10
    : style.textAlign === "right" ? item.x + item.w - 10
      : item.x + item.w / 2;
  const anchor = style.textAlign === "left" ? "start" : style.textAlign === "right" ? "end" : "middle";
  const text = lines.length
    ? `<text x="${anchorX}" y="${centreY}" font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="${weight}" fill="${textColor}" text-anchor="${anchor}" dominant-baseline="middle">${
      lines.map((line, index) => `<tspan x="${anchorX}" dy="${index === 0 ? 0 : fontSize * 1.25}">${escapeXml(line)}</tspan>`).join("")
    }</text>`
    : "";

  switch (item.type) {
    case "rect":
    case "note": {
      const radius = style.radius ?? (item.variant === "pill" ? item.h / 2 : 8);
      const body = `<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" rx="${radius}" ry="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${opacityAttr}/>`;
      return body + text;
    }
    case "ellipse":
      return `<ellipse cx="${item.x + item.w / 2}" cy="${item.y + item.h / 2}" rx="${item.w / 2}" ry="${item.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${opacityAttr}/>` + text;
    case "text":
      return text;
    case "line": {
      const x2 = item.x + item.w;
      const y2 = item.y + item.h;
      const shape = item.shape ?? "straight";
      const d = shape === "curve"
        // A quadratic bow, same control point the canvas uses.
        ? `M ${item.x} ${item.y} Q ${(item.x + x2) / 2 + (y2 - item.y) * 0.2} ${(item.y + y2) / 2 - (x2 - item.x) * 0.2} ${x2} ${y2}`
        : shape === "orthogonal"
          ? `M ${item.x} ${item.y} L ${x2} ${item.y} L ${x2} ${y2}`
          : `M ${item.x} ${item.y} L ${x2} ${y2}`;
      const markerId = `arrow-${item.id}`;
      const head = `<defs><marker id="${markerId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${stroke}"/></marker></defs>`;
      /*
       * A connector label sits on the line, so it needs a plate behind it.
       *
       * Drawn directly the glyphs collide with the stroke and neither reads —
       * the first render of this module had "call" sliced through by the arrow.
       * The plate is sized from the same wrap the label uses and painted in the
       * page colour, so the line appears to pass behind the text.
       */
      const labelPlate = lines.length
        ? (() => {
          const widest = Math.max(...lines.map((line) => line.length)) * fontSize * 0.6 + 8;
          const tall = lines.length * fontSize * 1.25 + 4;
          const midX = anchorX;
          const midY = centreY - (lines.length - 1) * fontSize * 0.62;
          return `<rect x="${midX - widest / 2}" y="${midY - tall / 2}" width="${widest}" height="${tall}" rx="4" fill="#ffffff"/>`;
        })()
        : "";
      return `${head}<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${style.strokeWidth ?? strokeWidth}" marker-end="url(#${markerId})"${opacityAttr}/>` + labelPlate + text;
    }
    case "stroke": {
      const points = item.points ?? [];
      if (points.length < 2) return "";
      const d = points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${item.x + point.x} ${item.y + point.y}`)
        .join(" ");
      return `<path d="${d}" fill="none" stroke="${style.strokeWidth ? stroke : item.color}" stroke-width="${style.strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round"${opacityAttr}/>`;
    }
    case "image":
      // Without the data URL inlined this is a placeholder frame; the canvas is
      // the only place that renders the file. Keeping the box preserves layout.
      return `<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-dasharray="6 4"${opacityAttr}/>`;
    default:
      return "";
  }
}

/**
 * Render a board as a standalone SVG string.
 *
 * Pure: no I/O, no clock, no ids minted. The same board always produces the
 * same bytes, which is what makes it safe to assert on in a test.
 */
export function boardToSvg(board: SimpleBoard, options: SvgRenderOptions = {}): string {
  const padding = options.padding ?? 32;
  const bounds = boundsOf(board.items);
  /*
   * `maxSize` caps the rendered long edge, padding included.
   *
   * Dividing only by the content bounds let a padded board exceed the ceiling —
   * `maxSize: 400` produced a 443px-wide image. The caller asked for "no larger
   * than N"; the margin is part of the image.
   */
  const paddedLongEdge = Math.max(bounds.w, bounds.h) + padding * 2;
  const scale = options.maxSize
    ? Math.min(1, options.maxSize / paddedLongEdge)
    : 1;
  const width = Math.round((bounds.w + padding * 2) * scale);
  const height = Math.round((bounds.h + padding * 2) * scale);
  const viewBox = `${bounds.x - padding} ${bounds.y - padding} ${bounds.w + padding * 2} ${bounds.h + padding * 2}`;

  const background = options.background === false
    ? ""
    : `<rect x="${bounds.x - padding}" y="${bounds.y - padding}" width="${bounds.w + padding * 2}" height="${bounds.h + padding * 2}" fill="#ffffff"/>`;
  // Paint order matches the canvas: backdrops first, then everything else on top.
  const order = (item: BoardItem): number => {
    if (item.role === "frame" || item.variant === "frame" || item.role === "column") return -1;
    return item.z ?? 0;
  };
  const body = [...board.items]
    .sort((left, right) => order(left) - order(right))
    .map(renderItem)
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" role="img" aria-label="${escapeXml(board.title || "Doodle board")}">`,
    `<title>${escapeXml(board.title || "Doodle board")}</title>`,
    background,
    body,
    "</svg>",
  ].join("");
}
