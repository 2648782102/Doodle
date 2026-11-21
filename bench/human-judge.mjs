/**
 * Second opinion: a model reviews a drawing against the request, in words.
 *
 * Structural grading answers "did the graph match the case". It cannot answer
 * "does this read as the thing the person asked for", and it has a specific
 * blind spot that the live runs made obvious:
 *
 *   Case `hard/constraint-labels` asks for a decision with a constraint on each
 *   branch. One model drew `是否迁移 → 是` and `是否迁移 → 否` with the
 *   constraint inside the connector label ("是 · 约束：需停机 2 小时"). That is a
 *   correct, arguably better drawing — the constraint belongs to the path. The
 *   structural grader wanted two more nodes and failed it. A reviewer model,
 *   given the same request and the same drawing, scored it 100.
 *
 * So this is not a replacement for grading, and it is deliberately not a second
 * scorer of the same thing. It exists to catch the cases where the graph is
 * right but the case was written too narrowly, and to surface semantic mistakes
 * no coordinate check can see ("拒绝 drawn as 通过").
 *
 * Three rules keep it honest:
 *
 *  1. The judge never sees the structural score. Anchoring it to the number we
 *     are trying to verify would make agreement meaningless.
 *  2. The judge never sees which model drew the board. Otherwise it grades the
 *     model, not the drawing.
 *  3. Disagreement is a finding, not an error to be resolved. When the judge
 *     passes a structurally-failed case, that case's expectation is probably
 *     too literal — which is a bug in the benchmark, and the single most useful
 *     thing this layer produces.
 */

/**
 * A drawing rendered as text: what the judge can reason about.
 *
 * Coordinates are omitted on purpose. A reviewer looking at a list of numbers
 * starts auditing the numbers; a reviewer looking at nodes and edges answers the
 * question that matters — does this say what was asked.
 */
export function renderForJudge(board) {
  const byId = new Map(board.items.map((item) => [item.id, item]));
  const label = (item) => {
    if (!item) return "?";
    return (item.title || item.text || "").trim() || "(无标签)";
  };
  const nodes = board.items
    .filter((item) => item.type !== "line" && item.type !== "stroke"
      && item.role !== "frame" && item.role !== "label" && item.role !== "annotation")
    .map((item) => `- ${label(item)}${item.role && item.role !== "normal" ? ` [${item.role}]` : ""}`);
  const edges = board.items
    .filter((item) => item.type === "line")
    .map((item) => {
      const from = byId.get(item.startItemId);
      const to = byId.get(item.endItemId);
      const arrow = from && to ? `${label(from)} → ${label(to)}` : "(未绑定)";
      const edgeLabel = (item.text || "").trim();
      return `- ${arrow}${edgeLabel ? ` 标签:${edgeLabel}` : ""}`;
    });
  /*
   * Free text that is not a node still matters: a constraint or a legend can
   * carry meaning the graph does not. It is listed separately so the judge can
   * tell "a card I forgot" from "an annotation I chose to place there".
   */
  const notes = board.items
    .filter((item) => item.type === "text" && (item.role === "annotation" || (!item.role && !item.title)))
    .map((item) => `- ${label(item)}`);

  return [
    `节点 (${nodes.length}):`,
    ...(nodes.length ? nodes : ["(无)"]),
    "",
    `连接 (${edges.length}):`,
    ...(edges.length ? edges : ["(无)"]),
    ...(notes.length ? ["", `其他文字 (${notes.length}):`, ...notes] : []),
  ].join("\n");
}

/** The prompt a judge receives. Deliberately narrow and answer-shaped. */
export function judgePrompt(testCase, board) {
  return [
    "你在评审一张手绘流程图是否满足需求。看着图说人话，不要猜代码或坐标。",
    "",
    `需求：${testCase.prompt}`,
    "",
    "图上实际画的内容：",
    renderForJudge(board),
    "",
    "请判断：",
    "1. 需求要求的每个要素是否都表达了（缺失 / 多余）",
    "2. 关系、顺序、分支方向是否正确",
    "3. 有没有语义错误（例如把「拒绝」画成「通过」）",
    "",
    "信息写在连接标签或说明文字里，也算表达了 —— 不要因为它是注释就判缺失。",
    "",
    '只输出 JSON，不要任何其他文字：{"verdict":"pass"|"fail","score":0-100,"issues":["每条一句话，最多4条"]}',
  ].join("\n");
}

/**
 * Parse a judge reply.
 *
 * Models wrap JSON in prose, code fences, or both. A reply that cannot be
 * parsed is reported as such rather than coerced to a score — a fabricated
 * verdict is worse than a missing one.
 */
export function parseVerdict(text) {
  const raw = String(text ?? "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const braced = candidate.match(/\{[\s\S]*\}/);
  if (!braced) return { ok: false, reason: "no JSON object in reply", raw: raw.slice(0, 200) };
  let value;
  try {
    value = JSON.parse(braced[0]);
  } catch (error) {
    return { ok: false, reason: `invalid JSON: ${error.message}`, raw: braced[0].slice(0, 200) };
  }
  const verdict = value.verdict === "pass" || value.verdict === "fail" ? value.verdict : undefined;
  const score = Number.isFinite(Number(value.score)) ? Math.max(0, Math.min(100, Number(value.score))) : undefined;
  if (!verdict || score === undefined) {
    return { ok: false, reason: "verdict or score missing", raw: braced[0].slice(0, 200) };
  }
  const issues = Array.isArray(value.issues) ? value.issues.map(String).slice(0, 4) : [];
  return { ok: true, verdict, score, issues };
}

/**
 * Compare the structural verdict with the judge's.
 *
 * The categories are named, because each one means something different to
 * whoever maintains the case set:
 *
 *   agree-pass       both say the drawing is right
 *   agree-fail       both say it is wrong
 *   judge-saves      structure failed, a reader passed it → the case is too
 *                    literal; this is the signal worth acting on
 *   judge-confirms   structure failed and a reader agrees → the failure is real
 *   judge-stricter   structure passed, a reader found a semantic problem no
 *                    coordinate check could see
 *   unknown          the reply could not be parsed
 */
export function reconcile(structural, judged) {
  if (!judged.ok) return { category: "unknown", reason: judged.reason };
  if (structural.pass && judged.verdict === "pass") return { category: "agree-pass" };
  if (!structural.pass && judged.verdict === "fail") return { category: "agree-fail" };
  if (!structural.pass && judged.verdict === "pass") return { category: "judge-saves" };
  return { category: "judge-stricter" };
}
