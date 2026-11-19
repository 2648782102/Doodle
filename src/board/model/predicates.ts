/**
 * Pure shape predicates and normalisers for Board v1.
 *
 * Shared by the write path (`normalizeItem`) and the persisted-state path
 * (`parseBoard`). Keeping them in one module is what lets both reject the same
 * input with the same wording; splitting them was how the two drifted apart and
 * a colour problem surfaced as "Invalid board collections".
 */

import {
  EMPHASES, IMAGE_MIMES, LINE_SHAPES, MAX_FILE_ID, MAX_IMAGE_SRC,
  MAX_SCENE_JSON, MAX_TITLE, ROLES, TEXT_ALIGNS, VARIANTS,
} from "./limits.js";
import type {
  BoardAuthor, BoardEmphasis, BoardItemStyle, BoardLineShape, BoardPoint,
  BoardRole, BoardSceneMeta, BoardTextAlign, BoardVariant,
} from "./types.js";
import { now } from "./clock.js";
import { BoardValidationError } from "../errors.js";

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isAuthor(value: unknown): value is BoardAuthor {
  return value === "human" || value === "ai";
}

export function isLineShape(value: unknown): value is BoardLineShape {
  return LINE_SHAPES.includes(value as BoardLineShape);
}

export function isEmphasis(value: unknown): value is BoardEmphasis {
  return EMPHASES.includes(value as BoardEmphasis);
}

export function isVariant(value: unknown): value is BoardVariant {
  return VARIANTS.includes(value as BoardVariant);
}

export function isRole(value: unknown): value is BoardRole {
  return ROLES.includes(value as BoardRole);
}

export function isTextAlign(value: unknown): value is BoardTextAlign {
  return TEXT_ALIGNS.includes(value as BoardTextAlign);
}

export function isColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * Fill colour, where `transparent` is a real choice.
 *
 * A shape the person left unfilled must round-trip as unfilled. Treating
 * `transparent` as invalid made the adapter fall back to the stroke colour,
 * which painted an outline-only rectangle as a solid block on the next load.
 */
export function isFillColor(value: unknown): value is string {
  return value === "transparent" || isColor(value);
}

export function normalizeStyle(value: unknown): BoardItemStyle | undefined {
  if (value === undefined) return undefined;
  /*
   * `style` is a field an agent uses freely, so every rejection here names the
   * sub-field, the value it got, and the range. These were bare strings in a
   * shared predicate, which reached the caller as `TOOL_ERROR`.
   */
  if (!value || typeof value !== "object") {
    throw new BoardValidationError(
      "Item style must be an object",
      "INVALID_STYLE",
      "items[].style",
      "an object of bounded visual fields",
      `Send style as an object such as { fontSize: 14, fontWeight: "bold" }, or omit it.`,
    );
  }
  const candidate = value as Partial<BoardItemStyle>;
  const style: BoardItemStyle = {};
  if (candidate.borderColor !== undefined) {
    if (!isColor(candidate.borderColor)) {
      throw new BoardValidationError(
        `style.borderColor is ${JSON.stringify(candidate.borderColor)}, which is not a hex colour`,
        "INVALID_COLOR",
        "items[].style.borderColor",
        "#rrggbb",
        `Use a six-digit hex value such as #334155. The item-level color may also be transparent; a border may not.`,
      );
    }
    style.borderColor = candidate.borderColor;
  }
  for (const [key, minimum, maximum] of [
    ["borderWidth", 0, 12], ["fontSize", 8, 72], ["strokeWidth", 0.5, 24],
    ["opacity", 0.1, 1], ["radius", 0, 64], ["fillOpacity", 0, 1],
  ] as const) {
    const raw = candidate[key];
    if (raw === undefined) continue;
    if (!isFiniteNumber(raw) || raw < minimum || raw > maximum) {
      throw new BoardValidationError(
        `style.${key} is ${JSON.stringify(raw)}; the range is ${minimum}-${maximum}`,
        "STYLE_OUT_OF_RANGE",
        `items[].style.${key}`,
        `a number between ${minimum} and ${maximum}`,
        `Omit the field to use the default, or pick a value inside the range.`,
      );
    }
    style[key] = raw;
  }
  if (candidate.textColor !== undefined) {
    if (!isColor(candidate.textColor)) {
      throw new BoardValidationError(
        `style.textColor is ${JSON.stringify(candidate.textColor)}, which is not a hex colour`,
        "INVALID_COLOR",
        "items[].style.textColor",
        "#rrggbb",
        `Use a six-digit hex value with enough contrast for the fill you chose.`,
      );
    }
    style.textColor = candidate.textColor;
  }
  if (candidate.fontWeight !== undefined) {
    if (candidate.fontWeight !== "normal" && candidate.fontWeight !== "bold") {
      throw new BoardValidationError(
        `style.fontWeight is ${JSON.stringify(candidate.fontWeight)}`,
        "INVALID_FONT_WEIGHT",
        "items[].style.fontWeight",
        `"normal" or "bold"`,
        `Use "bold" to emphasise a heading, or omit the field.`,
      );
    }
    style.fontWeight = candidate.fontWeight;
  }
  if (candidate.textAlign !== undefined) {
    if (!isTextAlign(candidate.textAlign)) {
      throw new BoardValidationError(
        `style.textAlign is ${JSON.stringify(candidate.textAlign)}`,
        "INVALID_TEXT_ALIGN",
        "items[].style.textAlign",
        TEXT_ALIGNS.join(", "),
        `Use "left", "center", or "right"; "center" suits a caption under a card.`,
      );
    }
    style.textAlign = candidate.textAlign;
  }
  return Object.keys(style).length ? style : undefined;
}

export function isPoint(value: unknown): value is BoardPoint {
  return Boolean(value) && typeof value === "object"
    && isFiniteNumber((value as BoardPoint).x)
    && isFiniteNumber((value as BoardPoint).y);
}

export function isImageSource(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= MAX_IMAGE_SRC
    && /^data:image\/(png|jpeg|jpg|gif|webp|bmp|avif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value);
}

export function cloneSceneRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BoardValidationError(
      "A scene record must be an object",
      "INVALID_SCENE",
      "items[].scene",
      "a JSON object",
      `Send scene as { element: {...} } or omit it; the canvas adds fidelity itself.`,
    );
  }
  /*
   * One stringify, not two.
   *
   * The clone and the size check used to serialise the same record twice:
   * once to prove it is plain JSON and to copy it, then again just to read
   * `.length`. Scene records are the bulk of a saved board (75% of the item
   * payload), and every read re-validates the whole document, so the second
   * pass was pure cost. The length of `JSON.parse(text)` re-serialised is the
   * same as `text` for plain JSON, which the first pass has already proven.
   */
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new BoardValidationError(
      "A scene record is not JSON serialisable",
      "INVALID_SCENE",
      "items[].scene",
      "plain JSON values only",
      `Remove functions, cycles, or class instances from scene. An agent should normally omit scene entirely.`,
    );
  }
  if (text.length > MAX_SCENE_JSON) {
    throw new BoardValidationError(
      `A scene record is ${text.length} characters; the limit is ${MAX_SCENE_JSON}`,
      "SCENE_TOO_LARGE",
      "items[].scene",
      `at most ${MAX_SCENE_JSON} characters`,
      `Omit scene. It is canvas fidelity for round-tripping a person's exact render, not something an agent needs to send.`,
    );
  }
  return JSON.parse(text) as Record<string, unknown>;
}

export function normalizeScene(value: unknown): BoardSceneMeta | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BoardValidationError(
      `Item scene is ${JSON.stringify(value)}, which is not an object`,
      "INVALID_SCENE",
      "items[].scene",
      "an object, or omit it",
      `An agent should omit scene; it exists so the canvas can round-trip its own render.`,
    );
  }
  const candidate = value as Partial<BoardSceneMeta>;
  const scene: BoardSceneMeta = {};
  if (candidate.element !== undefined) scene.element = cloneSceneRecord(candidate.element);
  if (candidate.boundText !== undefined) scene.boundText = cloneSceneRecord(candidate.boundText);
  if (candidate.fileId !== undefined) {
    if (typeof candidate.fileId !== "string" || !candidate.fileId.trim() || candidate.fileId.length > MAX_FILE_ID) {
      throw new BoardValidationError(
        `scene.fileId is not a non-empty string of at most ${MAX_FILE_ID} characters`,
        "INVALID_SCENE_FILE",
        "items[].scene.fileId",
        `a non-empty string of at most ${MAX_FILE_ID} characters`,
        `Omit scene for agent-authored items; the canvas assigns file ids itself.`,
      );
    }
    scene.fileId = candidate.fileId;
  }
  if (candidate.fileMime !== undefined) {
    if (typeof candidate.fileMime !== "string" || !IMAGE_MIMES.includes(candidate.fileMime)) {
      throw new BoardValidationError(
        `scene.fileMime is ${JSON.stringify(candidate.fileMime)}`,
        "INVALID_SCENE_FILE",
        "items[].scene.fileMime",
        IMAGE_MIMES.join(", "),
        `Use the same type as the image source. An agent should omit scene entirely.`,
      );
    }
    scene.fileMime = candidate.fileMime;
  }
  if (candidate.fileCreated !== undefined) {
    if (!isFiniteNumber(candidate.fileCreated)) {
      throw new BoardValidationError(
        "scene.fileCreated is not a number",
        "INVALID_SCENE_FILE",
        "items[].scene.fileCreated",
        "a finite number",
        `Omit scene for agent-authored items; the canvas records file timestamps itself.`,
      );
    }
    scene.fileCreated = candidate.fileCreated;
  }
  return Object.keys(scene).length ? scene : undefined;
}
