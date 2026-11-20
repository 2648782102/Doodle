/**
 * The two-way half of the benchmark: can the AI understand what a person changed?
 *
 * Every other case grades a one-shot drawing. This one grades the loop the
 * product is actually about — AI draws, a person edits the same board, AI reads
 * back and reports what it understood. Nothing tested that before, and it is the
 * claim that distinguishes Doodle from a one-way diagram generator.
 *
 * The "person" is scripted so the loop is repeatable and costs one model call
 * per case. `HANDOFF` (computed by the server, not by the model) is the ground
 * truth: the test asks whether the model's own words agree with it.
 */

import { describeHandoff } from "../dist/board/handoff.js";

/**
 * A scripted edit a person could make.
 *
 * Expressed as data, not code, so a case file can describe it and the harness
 * stays free of per-case logic.
 */
export function applyHumanEdit(board, edit) {
  const items = board.items.map((item) => {
    const label = (item.title || item.text || "").trim();
    if (!label.includes(edit.label)) return item;
    switch (edit.type) {
      case "move":
        return { ...item, x: item.x + (edit.dx ?? 0), y: item.y + (edit.dy ?? 0), author: "human" };
      case "relabel":
        return { ...item, text: edit.to ?? item.text, author: "human" };
      case "delete":
        return null;
      default:
        return item;
    }
  }).filter(Boolean);
  return { ...board, items, revision: board.revision + 1, updatedAt: new Date().toISOString() };
}

/** What the board itself says the person did — the ground truth for grading. */
export function expectedHandoff(before, after) {
  return describeHandoff(after, before);
}

/**
 * Grade the model's report of a human edit.
 *
 * Three signals, in order of strength:
 *   detected   the changed object's label appears in the model's answer
 *   kind       the model named the right kind of change (move vs relabel)
 *   no-invention  the model did not claim changes that never happened
 *
 * Free-text matching is deliberately forgiving about wording: the point is
 * comprehension, not phrasing. It is strict about *which object* and *what
 * kind*, because that is the part a model can get wrong while sounding right.
 */
export function gradeHumanReport({ answer, handoff, before, after }) {
  const text = String(answer ?? "");
  const edits = handoff.humanEdits ?? [];
  const labels = edits
    .map((edit) => {
      const item = after.items.find((candidate) => candidate.id === edit.id);
      return item ? (item.title || item.text || "").trim() : "";
    })
    .filter(Boolean);

  const detected = labels.filter((label) => text.includes(label));
  const missed = labels.filter((label) => !text.includes(label));

  const kindWords = {
    move: ["移动", "挪", "位置", "移到", "moved"],
    relabel: ["改名", "改标", "文字", "标签", "renamed", "relabel"],
    "add-note": ["新增", "加", "添加", "added"],
    remove: ["删除", "去掉", "删了", "removed", "deleted"],
    resize: ["大小", "尺寸", "放大", "缩小", "resized"],
    restyle: ["样式", "颜色", "强调", "style"],
    reorder: ["层级", "顺序", "z-order"],
    edit: ["修改", "改了", "edited"],
  };
  const expectedKinds = [...new Set(edits.map((edit) => (edit.change === "removed" ? "remove" : undefined)
    ?? (edit.change === "added" ? "add-note" : undefined)
    ?? guessKind(handoff, edit)))].filter(Boolean);
  const namedKind = expectedKinds.filter((kind) => (kindWords[kind] ?? []).some((word) => text.includes(word)));

  /*
   * Invention check: every quoted label must correspond to an object on the
   * board. A model that says "I see you moved 「登录」" when no such object
   * exists has hallucinated the board, which matters more than missing a detail.
   */
  const boardLabels = after.items.map((item) => (item.title || item.text || "").trim()).filter(Boolean);
  const quoted = [...text.matchAll(/[「"“]([^」"”]{1,24})[」"”]/g)].map((match) => match[1].trim());
  const invented = quoted.filter((label) => !boardLabels.some((existing) => existing.includes(label) || label.includes(existing)));

  const total = labels.length || 1;
  return {
    detected: detected.length,
    missed,
    recall: detected.length / total,
    kindsExpected: expectedKinds,
    kindsNamed: namedKind,
    kindOk: expectedKinds.length === 0 || namedKind.length > 0,
    invented,
    ok: missed.length === 0 && invented.length === 0,
  };
}

/** Which reading the handoff produced for an edit, when it produced one. */
function guessKind(handoff, edit) {
  const reading = (handoff.readings ?? []).find((candidate) => candidate.id === edit.id);
  if (!reading) return "edit";
  return reading.kind === "add-note" ? "add-note" : reading.kind;
}
