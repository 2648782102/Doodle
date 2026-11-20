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

/** Nodes we grade: things with a visible label that are not connectors. */
export function nodesOf(board) {
  return board.items.filter((item) => item.type !== "line"
    && item.type !== "stroke"
    && item.role !== "frame"
    && (normalizeLabel(item.title) || normalizeLabel(item.text)));
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
  const extra = nodes.filter((node) => !used.has(node.id)).map(labelOf);
  return {
    recall: (expected.length - missing.length) / expected.length,
    precision: nodes.length === 0 ? 0 : used.size / nodes.length,
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
  return [];
}

export function gradeEdges(board, expect) {
  const expected = expectedEdges(expect);
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
