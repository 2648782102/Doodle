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

/**
 * The handoff implementation is injected, not imported.
 *
 * Importing `dist/board/handoff.js` from here looked obvious and cost three CI
 * rounds: `dist` is build output, the test runner rewrites a dynamic import into
 * a path from the filesystem root, and the resulting failure was hidden behind
 * an unrelated reporter crash (`Map.groupBy` on Node 20). Injection removes the
 * whole class of problem — the runner supplies the real implementation, tests
 * supply a stand-in, and neither depends on build order or module rewriting.
 */
let describeHandoffImpl;

export function setHandoffImplementation(implementation) {
  describeHandoffImpl = implementation;
}

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
  /*
   * Deleting a node must take its connectors with it.
   *
   * A line that still binds to the removed id makes `parseBoard` reject the
   * whole board ("ends at step_2, which no item declares"), and the server then
   * quarantines the file and starts empty. The model was then correctly
   * reporting "the board has zero objects" while the grader called it a
   * comprehension failure — the harness had corrupted the board, not the model
   * misread it.
   *
   * A person deleting a card in the canvas removes its arrows too, so this is
   * also the more faithful edit.
   */
  const kept = edit.type === "delete"
    ? items.filter((item) => {
      const surviving = new Set(items.map((candidate) => candidate.id));
      // A connector with a missing endpoint is removed whole, which is what the
      // canvas does when a person deletes an arrow's source or target.
      if (item.startItemId && !surviving.has(item.startItemId)) return false;
      if (item.endItemId && !surviving.has(item.endItemId)) return false;
      return true;
    })
    : items;
  return { ...board, items: kept, revision: board.revision + 1, updatedAt: new Date().toISOString() };
}

/** What the board itself says the person did — the ground truth for grading. */
export function expectedHandoff(before, after) {
  if (!describeHandoffImpl) {
    throw new Error("handoff implementation not injected; call setHandoffImplementation first");
  }
  return describeHandoffImpl(after, before);
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
      /*
       * A removed object only exists on the *before* board. Looking it up in
       * `after` returned nothing, so a correct answer about a deletion could
       * never be recognised — the hardest edit kind would score zero by
       * construction.
       */
      const item = after.items.find((candidate) => candidate.id === edit.id)
        ?? before.items.find((candidate) => candidate.id === edit.id);
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
  /*
   * A deletion legitimately mentions a label that is no longer on the board, so
   * the invention check accepts labels from both sides. Inventing an object that
   * never existed is still caught.
   */
  const boardLabels = [...after.items, ...before.items]
    .map((item) => (item.title || item.text || "").trim()).filter(Boolean);
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
