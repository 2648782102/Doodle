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
import type { BoardPoint, DiagramLayout, DiagramMode, ExpandedDiagramInput } from "../model/types.js";
import { BoardValidationError } from "../errors.js";

export function resolveDiagramLayout(diagram: ExpandedDiagramInput): DiagramLayout {
  if (diagram.nodes.length > 48 || diagram.edges.length > 96) {
    throw new BoardValidationError(
      `Diagram has ${diagram.nodes.length} nodes and ${diagram.edges.length} edges; the limit is 48 and 96`,
      "DIAGRAM_TOO_LARGE",
      "diagram.nodes",
      "at most 48 nodes and 96 edges per diagram",
      `Split into two diagrams drawn side by side, or summarize sub-steps with a single node's detail text.`,
    );
  }
  const mode = diagram.mode ?? "flow";
  if (!DIAGRAM_MODES.includes(mode)) {
    throw new BoardValidationError(
      `Diagram mode ${JSON.stringify(mode)} is not one of flow, timeline, compare, matrix`,
      "INVALID_DIAGRAM_MODE",
      "diagram.mode",
      DIAGRAM_MODES.join(", "),
      `Use "flow" for a dependency graph, "timeline" for an ordered sequence, "compare" for two sides, or "matrix" for a grid.`,
    );
  }
  const nodeIds = new Set<string>();
  const reserved = new Set(["diagram_title", "diagram_subtitle", "diagram_legend", "diagram_frame"]);
  for (const node of diagram.nodes) {
    const id = node.id?.trim();
    if (!id || nodeIds.has(id) || reserved.has(id) || id.endsWith("_detail") || /^diagram_edge_\d+$/.test(id)) {
      throw new BoardValidationError(
        `Diagram node id ${JSON.stringify(node.id)} is empty, repeated, or reserved by the generator`,
        "INVALID_NODE_ID",
        "diagram.nodes[].id",
        "a unique short id that is not diagram_title, diagram_subtitle, diagram_legend, or diagram_frame",
        `Give every node its own id such as "auth" or "n1"; the generator already reserves diagram_* and *_detail.`,
      );
    }
    /*
     * These bounds used to live only in the Zod schema, so moving them out
     * would have silently dropped the limit. `row` is 0-47 to match the 48-node
     * ceiling; `column` is 0-12 because past that a flow is unreadable and
     * should snake instead.
     */
    if (node.column !== undefined && (!Number.isInteger(node.column) || node.column < 0 || node.column > 12)) {
      throw new BoardValidationError(
        `Diagram node ${JSON.stringify(id)} has column ${String(node.column)}; the range is 0-12`,
        "DIAGRAM_COLUMN_OUT_OF_RANGE",
        "diagram.nodes[].column",
        "an integer between 0 and 12",
        `Use column for side-by-side groups only. For a longer sequence advance row instead, or omit both to let a flow snake.`,
      );
    }
    if (node.row !== undefined && (!Number.isInteger(node.row) || node.row < 0 || node.row > 47)) {
      throw new BoardValidationError(
        `Diagram node ${JSON.stringify(id)} has row ${String(node.row)}; the range is 0-47`,
        "DIAGRAM_ROW_OUT_OF_RANGE",
        "diagram.nodes[].row",
        "an integer between 0 and 47",
        `A diagram holds at most 48 nodes, so row 0-47 covers the longest sequence. Split a longer one into two diagrams.`,
      );
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
  if (Math.abs(origin.x) > 20_000 || Math.abs(origin.y) > 20_000) {
    throw new BoardValidationError(
      "Diagram origin is out of range",
      "DIAGRAM_ORIGIN_OUT_OF_RANGE",
      "diagram.origin",
      "x and y between -20000 and 20000",
      `Omit origin to place the diagram at (40, 120), or move it near the existing content.`,
    );
  }
  const width = Math.max(160, Math.min(260, diagram.nodeWidth ?? 190));
  const height = Math.max(72, Math.min(130, diagram.nodeHeight ?? 90));
  const columnGap = Math.max(36, Math.min(160, diagram.columnGap ?? 70));
  const rowGap = Math.max(24, Math.min(120, diagram.rowGap ?? 44));
  const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
  const incoming = new Map(diagram.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(diagram.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of diagram.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
      const missing = !nodes.has(edge.from) ? edge.from : edge.to;
      throw new BoardValidationError(
        `Diagram edge references node ${JSON.stringify(missing)}, which is not declared`,
        "UNKNOWN_EDGE_NODE",
        "diagram.edges",
        "from and to must match a declared node id",
        `Declare the node first (nodes: [{ id: ${JSON.stringify(String(missing))}, label: "..." }]) or correct the edge endpoint.`,
      );
    }
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
  /*
   * A timeline that only advances `row` still has one axis.
   *
   * When no node declares a column at all, `lastSequencedColumn` is undefined
   * and each row-only node used to take its own column, so eight steps spread
   * diagonally across 2030x426 instead of stacking in one vertical column.
   * That is the shape `AGENTS.md` tells an agent to draw. An explicit
   * `column` still wins whenever the author states one.
   */
  const sequenceColumn = lastSequencedColumn
    ?? (mode !== "flow" && diagram.nodes.some((node) => node.row !== undefined) ? 0 : undefined);
  for (const node of diagram.nodes) {
    if ((layer.get(node.id) ?? -1) >= 0) continue;
    if (mode === "flow") layer.set(node.id, fallbackColumn++);
    else if (node.row !== undefined && sequenceColumn !== undefined) layer.set(node.id, sequenceColumn);
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
  /*
   * Nodes that share a derived column must not share a cell.
   *
   * `row` came from the per-column counter for every node in a column, but the
   * counter was read once per node and only advanced at the end of the pass.
   * Two siblings — the 上线 / 暂缓 arms of a decision — both read row 0 and
   * landed on the same point, so a correct branch diagram graded as overlapping
   * and unreadable. Dense flows hid it because their nodes sit on distinct
   * layers; a fan-out is what exposes it.
   */
  /*
   * Cell occupancy, keyed by visual column.
   *
   * Both layouts below need the same guarantee: two nodes that resolve to the
   * same column must not be drawn on the same point. A sequential chain never
   * collides, which is why this went unnoticed; a fan-out does.
   */
  const occupied = new Map<number, Set<number>>();
  const claimRow = (column: number, preferred: number): number => {
    const used = occupied.get(column) ?? new Set<number>();
    let row = preferred;
    while (used.has(row)) row += 1;
    used.add(row);
    occupied.set(column, used);
    return row;
  };
  for (const node of diagram.nodes) {
    /*
     * Do not clamp the derived layer to 12.
     *
     * The clamp was meant to keep an explicit `column` sane, but it also
     * applied to layers derived from the edge graph: a 48-step flow capped at
     * column 12, so passes 3 and 4 collapsed onto the same rows and the diagram
     * read as overlapping. Explicit columns are already bounded by the
     * `DIAGRAM_COLUMN_OUT_OF_RANGE` check, so the raw layer is safe to use.
     */
    const rawColumn = Math.max(0, layer.get(node.id) ?? 0);
    const column = wrap ? rawColumn % perRow : rawColumn;
    const wrappedRow = wrap ? Math.floor(rawColumn / perRow) : 0;
    /*
     * A snaked pass owns its row; a node inside the pass shares it.
     *
     * This used to add `wrappedRow` on top of the running row count for the
     * column, so each pass pushed the base up as well: an 18-step chain, which
     * is three passes of six, laid out as eight rows (2,680px tall) and a
     * 48-step chain as thirty-eight (14,740px), far past any usable canvas.
     * Packing within a pass and starting the next one immediately below is what
     * the snake is supposed to draw.
     */
    /*
     * Inside a snaked pass the row is the pass index; outside it, nodes that
     * share a column stack downwards as before. Both cases still honour an
     * explicit `node.row`.
     */
    /*
     * The snaked pass owns its row; a node inside the pass shares it.
     *
     * That expression is the fix for a chain drifting a whole pass down the
     * page, so it stays literally intact — but on its own it also puts two
     * *siblings* on the same point, because both arms of a branch read the same
     * pass row. `claimRow` walks down only when the cell is already taken, so a
     * plain chain is byte-identical and a fan-out stacks. Keeping the original
     * expression and correcting it is what keeps both behaviours.
     */
    const row = node.row ?? (wrap ? wrappedRow : (rows.get(column) ?? 0));
    /*
     * Stack a fan-out instead of drawing its arms on one point.
     *
     * The line above is the fix for a chain drifting a whole pass down the
     * page, and it stays verbatim. It also gives every node of a pass the same
     * row, so the two arms of a branch land on the same coordinate. Only an
     * occupied cell is pushed down, so a plain chain is byte-identical and a
     * fan-out stacks.
     */
    const placedRow = node.row !== undefined ? row : claimRow(column, row);
    rows.set(column, Math.max(rows.get(column) ?? 0, placedRow + 1));
    const reversed = wrap && wrappedRow % 2 === 1;
    const xColumn = reversed ? perRow - 1 - column : column;
    positions.set(node.id, {
      x: Math.round(origin.x + xColumn * (width + columnGap)),
      y: Math.round(origin.y + placedRow * (height + rowGap)),
    });
  }
  return { origin, width, height, columnGap, rowGap, positions, rows };
}
