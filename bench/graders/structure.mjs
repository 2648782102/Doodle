/**
 * Structural grading: did the board hold the graph the case asked for?
 *
 * This is the layer that carries most of the score. It reads Board v1 as a
 * directed graph — nodes are objects with a label, edges are `line` items with
 * `startItemId`/`endItemId` — instead of comparing pixels, because two drawings
 * with identical meaning can differ by hundreds of pixels, and a broken drawing
 * can look almost identical to a correct one.
 *
 * Pure: no I/O, no clock. Every grader is `(board, expect) => result`, so a
 * recorded board can be re-graded without re-running a model.
 */

import { labelsMatch, normalizeLabel } from "./normalize.mjs";

/**
 * Nodes we grade: the things a person would read as a node in the graph.
 *
 * Furniture is excluded by role, because the generator emits it on every
 * diagram and counting it as content would make every correct drawing look like
 * it invented nodes:
 *
 *   - `frame` is the container box drawn around the whole diagram.
 *   - `label` is the title/heading the generator puts above it.
 *
 * A `text` item is not automatically content either: `draw_board.diagram`
 * writes the prompt's own sequence ("草稿 → 反馈 → 修改") as a subtitle, and
 * that string repeats every node. Counting it would both inflate precision loss
 * and, worse, let a model pass `node_recall` by writing the list as prose
 * without ever drawing the nodes.
 */
/** Shaped nodes: things that occupy a box the person reads as a node. */
function shapedNodes(board) {
  return board.items.filter((item) => item.type !== "line"
    && item.type !== "stroke"
    && item.type !== "text"
    && item.role !== "frame"
    && item.role !== "label"
    /*
     * An `annotation` is a label *on an edge* ("选择上线", "需停机 2 小时"), not a
     * node. Counting it turned a correct decision tree into one with two
     * invented nodes, because the annotation repeats a node's own label.
     */
    && item.role !== "annotation"
    && (normalizeLabel(item.title) || normalizeLabel(item.text)));
}

export function nodesOf(board) {
  const shaped = shapedNodes(board);
  /*
   * Edge labels count as labels a caption may enumerate.
   *
   * A model writes "是"/"否" on the arrows and then a legend "连接：是 · 否".
   * Only the shape labels were considered, so the legend looked like new content
   * instead of a summary of labels already on the board.
   */
  const edgeLabels = board.items
    .filter((item) => item.type === "line" && (item.text || item.title))
    .map((item) => normalizeLabel(item.title) || normalizeLabel(item.text));
  const shapeLabels = shaped.map((item) => normalizeLabel(item.title) || normalizeLabel(item.text));
  /** Everything a caption could be enumerating, shapes and edge labels alike. */
  const enumerableLabels = [...shapeLabels, ...edgeLabels];
  /*
   * A short text sitting on a connector is that connector's label.
   *
   * Models often put "是"/"否"/"依赖"/"通过" in a free-floating text next to the
   * arrow instead of in the line's own `text` field. Counting those as nodes
   * made every state machine and architecture diagram look like it invented
   * content.
   */
  const lines = board.items.filter((item) => item.type === "line");
  const edgeLabelTexts = new Set(board.items
    .filter((item) => item.type === "text" && !item.title
      && normalizeLabel(item.text).length <= 6
      && lines.some((line) => nearLine(item, line)))
    .map((item) => item.id));
  /*
   * Where a subtitle would sit: 46px under the title, matching the generator's
   * layout. Derived from the board rather than hard-coded so a title-less board
   * does not silently start dropping text at y=72.
   */
  const title = board.items.find((item) => item.role === "label" && item.type === "text");
  const subtitleY = title ? title.y + 46 : undefined;
  /*
   * A `label` that sits on a card is that card's name, not the diagram's title.
   *
   * Models legitimately draw a layer as "empty box + text naming it" rather than
   * "box with the text inside". Excluding every `label` made such a drawing
   * score zero on all its nodes — a correct three-layer architecture diagram
   * graded as if nothing had been drawn. Overlap with a shape is the signal that
   * separates a card's name from the diagram heading.
   */
  /*
   * Compare against *every* box, including empty ones. A model can draw a layer
   * as a blank card with its name on top, which is a legitimate reading of the
   * same diagram; only shapes that carry their own text were in `shaped`, so the
   * overlap test never saw the card the label was sitting on.
   */
  const boxes = boxNodes(board);
  /** Where the drawn content starts, for telling a heading from a group name. */
  const contentTop = boxes.length ? Math.min(...boxes.map((item) => item.y)) : undefined;
  /*
   * Containers (frames, columns) carry their own heading at the top. A text that
   * sits there names the group, so it is content, not the diagram title.
   */
  const containers = board.items.filter((item) => item.role === "frame" || item.role === "column");
  /*
   * A title spans the whole diagram, so it overlaps several boxes; a card or
   * group name overlaps exactly one. Area ratio was the wrong test: a column
   * container is tall, so its heading failed the ratio and was dropped even
   * though the heading names that group.
   */
  const overlapCount = (item) => boxes.filter((shape) => rectsOverlap(item, shape)).length;
  const labelOnShape = new Set(board.items
    .filter((item) => item.type === "text" && item.role === "label"
      && overlapCount(item) === 1)
    .map((item) => item.id));
  /*
   * Standalone text is a node only when it is not just restating the shapes.
   * A caption that repeats two or more node labels is describing the diagram,
   * not adding to it.
   */
  const standalone = board.items.filter((item) => item.type === "text"
    && !edgeLabelTexts.has(item.id)
    && (item.role !== "label" || labelOnShape.has(item.id))
    /*
     * An edge annotation is rendered as a text item, so the shape filter above
     * never sees it. It must be excluded here too or the same double-count
     * returns through the other branch.
     */
    && item.role !== "annotation"
    && (normalizeLabel(item.title) || normalizeLabel(item.text))
    && !isEnumerationText(item, enumerableLabels)
    && !isDiagramHeading(item, shapeLabels, subtitleY, contentTop, containers));
  return [...shaped, ...standalone];
}

/** Every box-shaped item, whether or not it carries its own text. */
function boxNodes(board) {
  return board.items.filter((item) => item.type !== "line"
    && item.type !== "stroke"
    && item.type !== "text"
    /*
     * Containers are not the box a label names. A column spans all its cards, so
     * comparing a group heading's area against it failed the ratio test and the
     * heading was dropped — every model lost 「现状」and 「目标」on the same case.
     */
    && item.role !== "frame"
    && item.role !== "column");
}

/** Do two items' boxes intersect by more than a few pixels? */
function rectsOverlap(left, right) {
  const padding = 4;
  return left.x < right.x + right.w - padding
    && left.x + left.w > right.x + padding
    && left.y < right.y + right.h - padding
    && left.y + left.h > right.y + padding;
}

/**
 * Is this text sitting on (or immediately beside) a connector?
 *
 * A connector's box is the bounding box of its two endpoints, so a label on the
 * arrow is either inside that box or a few pixels outside it. The tolerance is
 * generous because the model places these labels by eye.
 */
function nearLine(item, line) {
  /*
   * 48px, not 24. A vertical connector is a zero-width box, and models place its
   * label a comfortable 45px to the side — just outside the tighter window.
   */
  const left = Math.min(line.x, line.x + line.w) - 48;
  const right = Math.max(line.x, line.x + line.w) + 48;
  const top = Math.min(line.y, line.y + line.h) - 48;
  const bottom = Math.max(line.y, line.y + line.h) + 48;
  const centerX = item.x + item.w / 2;
  const centerY = item.y + item.h / 2;
  return centerX >= left && centerX <= right && centerY >= top && centerY <= bottom;
}

/**
 * Does this text merely enumerate other labels ("A → B → C", "A, B, C")?
 *
 * Such a line is a caption or subtitle, not a node: it carries no shape, no
 * position that means anything, and its content is the rest of the diagram.
 */
export function isEnumerationText(item, otherLabels) {
  if (item.type !== "text" || item.title) return false;
  const text = normalizeLabel(item.text);
  if (!text) return false;
  const hits = otherLabels.filter((label) => label && text.includes(label)).length;
  if (hits >= 2) return true;
  /*
   * A standalone text that names no shape may be the generator's subtitle
   * ("六个阶段按顺序流转"). But a free note a person or model added is content,
   * and treating every unlabelled text as furniture would hide it — the
   * "unlisted text is still extra" test exists to catch exactly that.
   *
   * The distinction that holds up: a subtitle *describes* the diagram as a
   * whole, so it either contains a separator (a comma or arrow joining two
   * ideas) or explicitly refers to the sequence. Anything else is content.
   */
  return hits === 0 && /[,，、→>]|顺序|流程|阶段|步骤/.test(item.text ?? "");
}

/**
 * A heading that names the whole diagram rather than one node in it.
 *
 * Diagrams routinely carry a title ("方案对比", "决策与约束") and a legend. They
 * are real content to a reader and noise to a graph comparison: counting them
 * makes precision look bad on a drawing nobody would call wrong. A short
 * heading that shares no shape label is treated as the diagram's own title.
 */
export function isDiagramHeading(item, otherLabels, subtitleY, contentTop, containers = []) {
  if (item.type !== "text" || item.title) return false;
  /*
   * Only meaningful beside a diagram. With one or no shapes, a lone text item
   * *is* the content, and dropping it would make a one-node case unpassable.
   */
  if (otherLabels.length < 2) return false;
  /*
   * The generator puts its subtitle at a fixed offset under the title (y≈72),
   * and that is the only reliable signal: the sentence is too long for a length
   * rule and too specific for a keyword rule ("从需求发布到新员工入职的完整链路"
   * contains none of 顺序/流程/阶段). Position is not a heuristic here — it is
   * the layout contract the generator emits on every diagram.
   */
  if (subtitleY !== undefined && Math.abs(item.y - subtitleY) <= 8) return true;
  const text = normalizeLabel(item.text);
  /*
   * Eight characters, not twelve. The threshold is what separates a two-to-four
   * word heading ("方案对比", "决策与约束") from a sentence someone added; at
   * twelve, a free note like "随手写的第三方说明内容" (11) was silently dropped
   * and the precision check lost the very case it exists to catch.
   */
  if (!text || text.length > 8) return false;
  if (otherLabels.some((label) => label && (text.includes(label) || label.includes(text)))) return false;
  /*
   * A group name ("现状", "目标") sits at the *top of its container*, not above
   * the whole diagram. Comparing against the content top alone put it above the
   * cards and it was dropped as a heading — every model lost those two nodes.
   */
  const insideContainerTop = containers.some((container) => rectsOverlap(item, container)
    && Math.abs(item.y - container.y) <= 40);
  if (insideContainerTop) return false;
  /*
   * Otherwise a heading sits above everything the diagram draws.
   */
  return contentTop === undefined || item.y < contentTop - 8;
}

/** The label a person would read on this node. */
export function labelOf(item) {
  return normalizeLabel(item.title) || normalizeLabel(item.text);
}

/**
 * Edges as resolved node-id pairs.
 *
 * A connector that binds to nothing is reported separately rather than dropped:
 * an unbound arrow between two cards *looks* connected but is not, and a
 * benchmark that ignores that would reward a drawing the board itself
 * describes as `unresolved`.
 */
export function edgesOf(board) {
  const ids = new Set(board.items.map((item) => item.id));
  const bound = [];
  const dangling = [];
  for (const item of board.items) {
    if (item.type !== "line" || !item.startItemId || !item.endItemId) continue;
    if (ids.has(item.startItemId) && ids.has(item.endItemId)) {
      bound.push({ from: item.startItemId, to: item.endItemId, id: item.id });
    } else {
      dangling.push({ id: item.id, startItemId: item.startItemId, endItemId: item.endItemId });
    }
  }
  return { bound, dangling };
}

/** Map each expected label onto the drawn node that satisfies it. */
function matchNodes(nodes, expected) {
  const used = new Set();
  const matched = new Map();
  for (const label of expected) {
    const hit = nodes.find((node) => !used.has(node.id) && labelsMatch(labelOf(node), label));
    if (hit) {
      used.add(hit.id);
      matched.set(label, hit);
    }
  }
  return { matched, used };
}

/**
 * Node recall and precision.
 *
 * Recall punishes dropping content; precision punishes inventing it. A model
 * that draws five correct steps plus four stray notes should not score the
 * same as one that draws exactly five.
 */
export function gradeNodes(board, expect) {
  const nodes = nodesOf(board);
  const expected = expect.nodes ?? [];
  if (expected.length === 0) return { recall: 1, precision: nodes.length ? 0 : 1, missing: [], extra: nodes.map(labelOf) };
  const { matched, used } = matchNodes(nodes, expected);
  const missing = expected.filter((label) => !matched.has(label));
  /*
   * `expect.allow` lets a case say which additional content is legitimate.
   *
   * A diagram that annotates a branch with "需停机 2 小时" is *better* than one
   * that omits the constraint, but precision would punish it as an invented
   * node. The case author knows the difference; anything not listed here is
   * still counted as extra, so the check keeps its teeth.
   */
  const allowed = expect.allow ?? [];
  const afterAllow = nodes.filter((node) => !used.has(node.id) && !allowed.some((label) => labelsMatch(labelOf(node), label)));
  const extra = afterAllow.map(labelOf);
  return {
    recall: (expected.length - missing.length) / expected.length,
    // Precision is measured against the content the case cares about.
    precision: nodes.length === 0 ? 0 : (used.size + (nodes.length - used.size - extra.length)) / nodes.length,
    missing,
    extra,
  };
}

/**
 * Edge precision/recall/F1 over label pairs.
 *
 * Expected edges are declared between labels; drawn edges are between ids. The
 * comparison goes through the node match, so a correct drawing whose ids differ
 * from the case still scores correctly — ids are not part of the contract.
 */
/**
 * The edges a case expects.
 *
 * An ordered case may declare only `nodes` — that is how a person describes a
 * flow ("下单 → 校验 → 拣货"), and requiring an explicit edge list for every
 * step would make the cases as tedious to write as the drawing. For an ordered
 * case with no `edges`, the edges are the consecutive pairs of `nodes`.
 */
export function expectedEdges(expect) {
  if (expect.edges) return expect.edges;
  if (expect.ordered && Array.isArray(expect.nodes) && expect.nodes.length > 1) {
    return expect.nodes.slice(0, -1).map((from, index) => [from, expect.nodes[index + 1]]);
  }
  /*
   * A comparison is a side-by-side layout, not a graph: there is no legitimate
   * edge between "方案 A" and "方案 B", and the model that draws a decorative
   * divider between them is not adding a wrong relationship. Grading edges here
   * would fail a correct drawing, so this kind of case only grades nodes.
   */
  if (expect.kind === "comparison") return null;
  return [];
}

export function gradeEdges(board, expect) {
  const expected = expectedEdges(expect);
  if (expected === null) {
    return { precision: 1, recall: 1, f1: 1, matched: 0, missing: [], dangling: edgesOf(board).dangling, skipped: "comparison has no edges to grade" };
  }
  const nodes = nodesOf(board);
  const labelById = new Map(nodes.map((node) => [node.id, labelOf(node)]));
  const { bound, dangling } = edgesOf(board);

  // Resolve a drawn edge back to the expected label it connects, if any.
  const toLabel = (id) => labelById.get(id) ?? "";
  const findExpected = (fromLabel, toLabel) => expected.find(
    ([from, to]) => labelsMatch(fromLabel, from) && labelsMatch(toLabel, to),
  );

  const hit = bound.filter((edge) => findExpected(toLabel(edge.from), toLabel(edge.to)));
  const missed = expected.filter(([from, to]) => !hit.some(
    (edge) => labelsMatch(toLabel(edge.from), from) && labelsMatch(toLabel(edge.to), to),
  ));

  const precision = bound.length === 0 ? (expected.length === 0 ? 1 : 0) : hit.length / bound.length;
  const recall = expected.length === 0 ? (bound.length === 0 ? 1 : 0) : hit.length / expected.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, matched: hit.length, missing: missed, dangling };
}

/**
 * Ordered cases: the drawn edges must form one chain through the expected nodes.
 *
 * "In order" is about the graph, not the layout — a vertical or horizontal
 * chain both pass, but a fork, a join, or a cycle does not.
 */
export function gradeSequence(board, expect) {
  if (!expect.ordered) return { ok: true, reason: "not an ordered case" };
  const nodes = nodesOf(board);
  const { matched } = matchNodes(nodes, expect.nodes ?? []);
  const ids = new Set([...matched.values()].map((node) => node.id));
  if (ids.size < 2) return { ok: false, reason: "fewer than two expected nodes drawn" };

  const { bound } = edgesOf(board);
  const inChain = bound.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  const outDegree = new Map();
  const inDegree = new Map();
  for (const edge of inChain) {
    outDegree.set(edge.from, (outDegree.get(edge.from) ?? 0) + 1);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
  const heads = [...ids].filter((id) => (inDegree.get(id) ?? 0) === 0);
  const tails = [...ids].filter((id) => (outDegree.get(id) ?? 0) === 0);
  const forks = [...ids].filter((id) => (outDegree.get(id) ?? 0) > 1);
  const joins = [...ids].filter((id) => (inDegree.get(id) ?? 0) > 1);

  if (inChain.length !== ids.size - 1) {
    return { ok: false, reason: `chain has ${inChain.length} edges for ${ids.size} nodes`, forks, joins };
  }
  if (heads.length !== 1 || tails.length !== 1) {
    return { ok: false, reason: `expected one head and one tail, got ${heads.length}/${tails.length}` };
  }
  if (forks.length || joins.length) {
    return { ok: false, reason: "sequence forks or joins", forks, joins };
  }
  return { ok: true, edges: inChain.length };
}

/**
 * Tree cases: parent/child depth must match the expectation.
 *
 * Depth is measured by BFS from the roots the shape implies (nodes with no
 * inbound edge), so a lower half of the tree drawn upside down is caught.
 */
export function gradeTree(board, expect) {
  const expectedDepth = expect.depth;
  if (!expectedDepth) return { ok: true, reason: "no depth expectation" };
  const nodes = nodesOf(board);
  const { matched } = matchNodes(nodes, Object.keys(expectedDepth));
  const { bound } = edgesOf(board);
  const depth = new Map([...matched.entries()].map(([label, node]) => [node.id, 0]));
  // Peel levels by relaxing along edges; bounded by node count so a cycle stops.
  for (let round = 0; round < nodes.length; round += 1) {
    let changed = false;
    for (const edge of bound) {
      if (!depth.has(edge.from) || !depth.has(edge.to)) continue;
      const next = depth.get(edge.from) + 1;
      if (next > depth.get(edge.to)) {
        depth.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const wrong = [];
  for (const [label, expected] of Object.entries(expectedDepth)) {
    const node = matched.get(label);
    if (!node) {
      wrong.push({ label, expected, actual: null });
      continue;
    }
    const actual = depth.get(node.id) ?? 0;
    if (actual !== expected) wrong.push({ label, expected, actual });
  }
  return { ok: wrong.length === 0, wrong };
}
