/**
 * Deterministic placement for semantic diagrams.
 *
 * A diagram is expressed as meaning (nodes and edges); this module turns that
 * into coordinates. It is pure and total: the same input always produces the
 * same layout, and it never touches the board. `flow` derives columns from the
 * edges and snakes past six columns; `timeline`, `compare`, and `matrix` honour
 * the author's explicit `column`/`row`.
 */

import { DIAGRAM_MODES } from "../model/limits.js";
import type { BoardPoint, DiagramInput, DiagramLayout, DiagramMode } from "../model/types.js";

export function resolveDiagramLayout(diagram: DiagramInput): DiagramLayout {
  if (diagram.nodes.length > 48 || diagram.edges.length > 96) throw new Error("Diagram is too large");
  const mode = diagram.mode ?? "flow";
  if (!DIAGRAM_MODES.includes(mode)) throw new Error("Diagram mode must be flow, timeline, compare, or matrix");
  const nodeIds = new Set<string>();
  const reserved = new Set(["diagram_title", "diagram_subtitle", "diagram_legend", "diagram_frame"]);
  for (const node of diagram.nodes) {
    const id = node.id?.trim();
    if (!id || nodeIds.has(id) || reserved.has(id) || id.endsWith("_detail") || /^diagram_edge_\d+$/.test(id)) {
      throw new Error("Diagram node IDs must be unique and must not use generated object IDs");
    }
    nodeIds.add(id);
  }
  const generatedIds = new Set<string>();
  generatedIds.add("diagram_frame");
  for (const node of diagram.nodes) {
    for (const suffix of ["", "_detail"]) {
      const id = `${node.id}${suffix}`;
      if (generatedIds.has(id)) throw new Error("Diagram generates duplicate object IDs");
      generatedIds.add(id);
    }
  }
  diagram.edges.forEach((_edge, index) => {
    const id = `diagram_edge_${index + 1}`;
    if (generatedIds.has(id)) throw new Error("Diagram generates duplicate object IDs");
    generatedIds.add(id);
  });
  const origin = diagram.origin ?? { x: 40, y: 120 };
  if (Math.abs(origin.x) > 20_000 || Math.abs(origin.y) > 20_000) throw new Error("Diagram origin is out of range");
  const width = Math.max(160, Math.min(260, diagram.nodeWidth ?? 190));
  const height = Math.max(72, Math.min(130, diagram.nodeHeight ?? 90));
  const columnGap = Math.max(36, Math.min(160, diagram.columnGap ?? 70));
  const rowGap = Math.max(24, Math.min(120, diagram.rowGap ?? 44));
  const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
  const incoming = new Map(diagram.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(diagram.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of diagram.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) throw new Error("Diagram edge references an unknown node");
    outgoing.get(edge.from)!.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  // Only `flow` derives columns from edges. The other modes are explicit: an
  // author writing a timeline or a comparison already knows the order, and
  // deriving it from edges would silently reorder their explanation.
  const layer = new Map(diagram.nodes.map((node) => [node.id, node.column ?? -1]));
  if (mode === "flow") {
    const indegree = new Map(incoming);
    const queue = diagram.nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
    if (!queue.length && diagram.nodes.length) queue.push(diagram.nodes[0].id);
    for (const id of queue) if ((layer.get(id) ?? -1) < 0) layer.set(id, 0);
    const processed = new Set<string>();
    while (queue.length) {
      const id = queue.shift()!;
      if (processed.has(id)) continue;
      processed.add(id);
      for (const target of outgoing.get(id) ?? []) {
        if (nodes.get(target)?.column === undefined) layer.set(target, Math.max(layer.get(target) ?? 0, (layer.get(id) ?? 0) + 1));
        indegree.set(target, Math.max(0, (indegree.get(target) ?? 1) - 1));
        if ((indegree.get(target) ?? 0) === 0 && !processed.has(target)) queue.push(target);
      }
    }
  }
  /*
   * Anything still unplaced keeps a stable declaration order instead of
   * overlapping at (0, 0).
   *
   * In an explicit mode the leftover nodes join the *last explicit column* as
   * further rows. Giving each its own column (the previous behaviour) meant a
   * timeline that declared `column: 0, row: 0..3` and then omitted coordinates
   * for the remaining steps placed those steps in a second column at x = 300,
   * which is not the sequence the author described.
   */
  let fallbackColumn = Math.max(0, ...layer.values()) + 1;
  let fallbackIndex = 0;
  /*
   * Follow the last *sequenced* column, not just any explicit column.
   *
   * A node with `column: 0` is stating an axis; a node with only `row` is
   * stating a sequence and still needs a column. Nodes with neither keep the
   * original behaviour of taking their own column, which is what an author
   * writing a side-by-side comparison expects.
   */
  const lastSequencedColumn = [...diagram.nodes]
    .reverse()
    .find((node) => node.column !== undefined)?.column;
  for (const node of diagram.nodes) {
    if ((layer.get(node.id) ?? -1) >= 0) continue;
    if (mode === "flow") layer.set(node.id, fallbackColumn++);
    else if (node.row !== undefined && lastSequencedColumn !== undefined) layer.set(node.id, lastSequencedColumn);
    else layer.set(node.id, fallbackIndex++);
  }
  /*
   * Snake a long flow instead of emitting one endless row.
   *
   * A 16-step chain used to become a single strip 3.1k units wide: technically
   * correct, unreadable on any viewport, and the reason large diagrams were
   * abandoned by hand. Columns past `flowWrap` are folded back as an "S": even
   * passes run left-to-right, odd passes run right-to-left, and rows advance as
   * the chain snakes down. Explicit `column`/`row` still win, and non-flow modes
   * are untouched because their position is the author's statement.
   */
  const flowWrap = 6;
  const explicitColumns = diagram.nodes.some((node) => node.column !== undefined);
  const explicitRows = diagram.nodes.some((node) => node.row !== undefined);
  const wrap = mode === "flow" && !explicitColumns && !explicitRows;
  // `fallbackColumn` is one past the widest derived layer, so it is the chain
  // length; clamp it to the wrap width.
  const perRow = Math.max(1, Math.min(flowWrap, fallbackColumn));
  const positions = new Map<string, BoardPoint>();
  const rows = new Map<number, number>();
  for (const node of diagram.nodes) {
    const rawColumn = Math.min(12, Math.max(0, layer.get(node.id) ?? 0));
    const column = wrap ? rawColumn % perRow : rawColumn;
    const wrappedRow = wrap ? Math.floor(rawColumn / perRow) : 0;
    const row = node.row ?? (rows.get(column) ?? 0) + wrappedRow;
    rows.set(column, Math.max(rows.get(column) ?? 0, row + 1));
    const reversed = wrap && wrappedRow % 2 === 1;
    const xColumn = reversed ? perRow - 1 - column : column;
    positions.set(node.id, {
      x: Math.round(origin.x + xColumn * (width + columnGap)),
      y: Math.round(origin.y + row * (height + rowGap)),
    });
  }
  return { origin, width, height, columnGap, rowGap, positions, rows };
}
