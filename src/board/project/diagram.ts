/**
 * A ready-to-draw draft derived from a project scan.
 *
 * `scan_project` answers "what is here"; the agent then invents a diagram and
 * pays a second round trip to draw it. This returns the same information in the
 * shape `draw_board.diagram` already accepts, so the agent can hand it straight
 * through, adjust labels, or ignore it. It is a suggestion, never applied.
 */

import type { DiagramEdgeInput, DiagramMode, DiagramNodeInput } from "../types.js";

const NODE_LIMIT = 12;

export interface ProjectSnapshotLike {
  workspaceName: string;
  files: Array<{ path: string; kind: string; depth: number }>;
}

export interface ProjectDiagramDraft {
  title: string;
  subtitle: string;
  mode: DiagramMode;
  nodes: DiagramNodeInput[];
  edges: DiagramEdgeInput[];
  omitted: number;
  note: string;
}

/** A stable, filesystem-safe node id. */
function nodeId(prefix: string, name: string): string {
  return `${prefix}_${name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "item"}`;
}

function topLevelEntries(snapshot: ProjectSnapshotLike) {
  const entries = new Map<string, { name: string; kind: string; count: number }>();
  for (const entry of snapshot.files) {
    const [head] = entry.path.split("/");
    if (!head) continue;
    const existing = entries.get(head);
    if (existing) existing.count += 1;
    else entries.set(head, { name: head, kind: entry.depth === 1 ? entry.kind : "directory", count: 1 });
  }
  return [...entries.values()];
}

export function projectDiagramDraft(snapshot: ProjectSnapshotLike): ProjectDiagramDraft {
  const entries = topLevelEntries(snapshot);
  const shown = entries.slice(0, NODE_LIMIT);
  const omitted = Math.max(0, entries.length - shown.length);

  const nodes: DiagramNodeInput[] = shown.map((entry, index) => ({
    id: nodeId(entry.kind === "directory" ? "dir" : "file", entry.name),
    label: entry.name.length > 32 ? `${entry.name.slice(0, 31)}…` : entry.name,
    detail: entry.kind === "directory" ? `${entry.count} 项` : "文件",
    type: entry.kind === "directory" ? "rect" : "ellipse",
    column: index % 2,
    row: Math.floor(index / 2),
  }));

  return {
    title: `${snapshot.workspaceName} 结构`,
    subtitle: "由 scan_project 生成的草图；可改标题、标签和布局后再画",
    mode: "compare",
    nodes,
    edges: [],
    omitted,
    note: "Suggested diagram input only; scan_project never draws or changes the board.",
  };
}
