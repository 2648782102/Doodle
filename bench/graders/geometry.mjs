/**
 * Geometry and readability grading.
 *
 * `diagnoseBoard()` already reports overlap, isolation, and unresolved
 * connectors. This module adds the two signals that actually make a diagram
 * look messy and that nothing measured before:
 *
 *   - edges that cross each other
 *   - edges that pass through a card that is not an endpoint
 *
 * Both are computed from Board v1 coordinates, so they are deterministic and
 * cheap. Curved and orthogonal connectors are approximated by their chord; a
 * crossing on the chord is a lower bound, which is the honest direction for a
 * "should be zero" metric.
 */

import { edgesOf, labelOf, nodesOf } from "./structure.mjs";

function endpoint(item) {
  return { x: item.x, y: item.y };
}

/** The two endpoints a connector runs between, in board coordinates. */
export function lineSegment(item) {
  return { a: endpoint(item), b: { x: item.x + item.w, y: item.y + item.h } };
}

function orient(p, q, r) {
  const value = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(p, q, r) {
  return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x)
    && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
}

/** Do two segments intersect? Standard orientation test, collinear included. */
export function segmentsIntersect(s1, s2) {
  const o1 = orient(s1.a, s1.b, s2.a);
  const o2 = orient(s1.a, s1.b, s2.b);
  const o3 = orient(s2.a, s2.b, s1.a);
  const o4 = orient(s2.a, s2.b, s1.b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(s1.a, s2.a, s1.b)) return true;
  if (o2 === 0 && onSegment(s1.a, s2.b, s1.b)) return true;
  if (o3 === 0 && onSegment(s2.a, s1.a, s2.b)) return true;
  if (o4 === 0 && onSegment(s2.a, s1.b, s2.b)) return true;
  return false;
}

/** Segment against an axis-aligned rectangle, trimmed so shared edges do not count. */
export function segmentHitsRect(segment, item, inset = 2) {
  const left = item.x + inset;
  const right = item.x + item.w - inset;
  const top = item.y + inset;
  const bottom = item.y + item.h - inset;
  if (right <= left || bottom <= top) return false;
  const corners = [
    { x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom },
  ];
  const edges = [
    { a: corners[0], b: corners[1] }, { a: corners[1], b: corners[2] },
    { a: corners[2], b: corners[3] }, { a: corners[3], b: corners[0] },
  ];
  // A segment fully inside the rect also "hits" it.
  const inside = (p) => p.x > left && p.x < right && p.y > top && p.y < bottom;
  if (inside(segment.a) && inside(segment.b)) return true;
  return edges.some((edge) => segmentsIntersect(segment, edge));
}

/**
 * Count connector crossings.
 *
 * Connectors that share an endpoint are not crossings — a fan of arrows out of
 * one card is a legitimate drawing, not a mess.
 */
export function countCrossings(board) {
  const lines = board.items.filter((item) => item.type === "line");
  const pairs = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const left = lines[i];
      const right = lines[j];
      const sharesEndpoint = (left.startItemId && [left.startItemId, left.endItemId].includes(right.startItemId))
        || (left.startItemId && [left.startItemId, left.endItemId].includes(right.endItemId))
        || (left.endItemId && [left.startItemId, left.endItemId].includes(right.startItemId))
        || (left.endItemId && [left.startItemId, left.endItemId].includes(right.endItemId));
      if (sharesEndpoint) continue;
      if (segmentsIntersect(lineSegment(left), lineSegment(right))) {
        pairs.push({ a: left.id, b: right.id });
      }
    }
  }
  return pairs;
}

/**
 * Connectors that pass through a card they are not attached to.
 *
 * This is the single most common way a generated diagram becomes unreadable:
 * the arrow is drawn correctly between its endpoints but takes a path straight
 * over an unrelated card.
 */
export function countEdgesThroughNodes(board) {
  const nodes = nodesOf(board);
  const hits = [];
  for (const line of board.items.filter((item) => item.type === "line")) {
    const segment = lineSegment(line);
    const endpoints = new Set([line.startItemId, line.endItemId].filter(Boolean));
    for (const node of nodes) {
      if (endpoints.has(node.id)) continue;
      if (segmentHitsRect(segment, node)) {
        hits.push({ edge: line.id, through: node.id, label: labelOf(node) });
      }
    }
  }
  return hits;
}

/**
 * How much of the content's bounding box the drawing fills.
 *
 * Too low means the cards are lost in space; too high means they are crammed.
 * The band is generous because both a wide timeline and a tall tree are valid.
 */
export function density(board) {
  const nodes = nodesOf(board);
  if (nodes.length === 0) return { ratio: 0, ok: false, reason: "no nodes" };
  const area = nodes.reduce((sum, item) => sum + item.w * item.h, 0);
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.w));
  const maxY = Math.max(...nodes.map((n) => n.y + n.h));
  const bounds = Math.max(1, (maxX - minX) * (maxY - minY));
  const ratio = area / bounds;
  return { ratio, ok: ratio >= 0.12, reason: ratio < 0.12 ? "crammed" : undefined };
}

/** The full geometry report for one board. */
export function gradeGeometry(board) {
  const crossings = countCrossings(board);
  const through = countEdgesThroughNodes(board);
  const spread = density(board);
  const { dangling } = edgesOf(board);
  return {
    crossings: crossings.length,
    crossingPairs: crossings,
    edgesThroughNodes: through.length,
    throughHits: through,
    density: spread.ratio,
    danglingConnectors: dangling.length,
  };
}
