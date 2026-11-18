/**
 * Agent-facing projections of the shared board.
 *
 * The persisted board carries canvas-fidelity metadata (`scene`) that only the
 * Excalidraw canvas needs. The agent cannot draw with it and must not edit it,
 * so agent context carries a marker instead of the payload. Everything here is
 * pure: the persisted board is never mutated.
 */

import type { BoardItem, SimpleBoard } from "./types.js";

/**
 * One item as the agent sees it: no canvas-fidelity payload, just a marker.
 *
 * Per-item timestamps are omitted as well. `agentFingerprint` already ignores
 * them, so they never influenced change detection — they were 28% of the agent
 * item payload (1,850 of 6,514 bytes on a 25-object board) that no reader used.
 * Board-level `updatedAt` still tells the agent when anything last moved.
 */
export type AgentBoardItem = Omit<BoardItem, "scene" | "createdAt" | "updatedAt"> & {
  /** True when the persisted item carries Excalidraw fidelity the agent does not need. */
  canvasFidelity?: true;
};

export interface AgentBoardView {
  version: 1;
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  itemCount: number;
  items: AgentBoardItem[];
  /** How many items carry canvas fidelity that was withheld. */
  canvasFidelityItems: number;
  summary: AgentBoardSummary;
}

export interface AgentBoardSummary {
  revision: number;
  itemCount: number;
  byType: Record<string, number>;
  byAuthor: Record<string, number>;
  groups: string[];
  connections: Array<{ id: string; from: string | null; to: string | null }>;
  focus: string[];
}

export interface AgentBoardDelta {
  baseRevision: number;
  revision: number;
  unchanged: boolean;
  added: AgentBoardItem[];
  updated: AgentBoardItem[];
  removed: string[];
}

/** Fields the agent must see to draw and to reason about a board. */
function agentItem(item: BoardItem): AgentBoardItem {
  const { scene, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = item;
  return scene ? { ...rest, canvasFidelity: true } : rest;
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

/** A fingerprint that ignores canvas fidelity, so scene-only churn is not a change. */
function agentFingerprint(item: BoardItem): string {
  const { scene: _scene, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = item;
  return JSON.stringify(rest);
}

export function summarizeAgentBoard(board: SimpleBoard): AgentBoardSummary {
  const items = board.items;
  return {
    revision: board.revision,
    itemCount: items.length,
    byType: countBy(items.map((item) => item.type)),
    byAuthor: countBy(items.map((item) => item.author)),
    groups: [...new Set(items.map((item) => item.groupId).filter((id): id is string => Boolean(id)))],
    connections: items
      .filter((item) => item.startItemId || item.endItemId)
      .map((item) => ({ id: item.id, from: item.startItemId ?? null, to: item.endItemId ?? null })),
    focus: items.filter((item) => item.emphasis === "focus").map((item) => item.id),
  };
}

export function boardAgentView(board: SimpleBoard): AgentBoardView {
  const items = board.items.map(agentItem);
  return {
    version: 1,
    id: board.id,
    title: board.title,
    revision: board.revision,
    updatedAt: board.updatedAt,
    itemCount: items.length,
    items,
    canvasFidelityItems: items.filter((item) => item.canvasFidelity).length,
    summary: summarizeAgentBoard(board),
  };
}

/**
 * Compare two boards as the agent sees them.
 *
 * Scene-only differences and timestamp-only differences are not changes: the
 * canvas rewrites both on every render, and reporting them would make every
 * read look like an edit.
 */
export function boardAgentDelta(
  current: SimpleBoard,
  previous: SimpleBoard | null | undefined,
): AgentBoardDelta {
  const before = new Map((previous?.items ?? []).map((item) => [item.id, item]));
  const after = new Map(current.items.map((item) => [item.id, item]));
  const added: AgentBoardItem[] = [];
  const updated: AgentBoardItem[] = [];
  const removed: string[] = [];

  for (const [id, item] of after) {
    const oldItem = before.get(id);
    if (!oldItem) added.push(agentItem(item));
    else if (agentFingerprint(oldItem) !== agentFingerprint(item)) updated.push(agentItem(item));
  }
  for (const id of before.keys()) {
    if (!after.has(id)) removed.push(id);
  }

  return {
    baseRevision: previous?.revision ?? 0,
    revision: current.revision,
    unchanged: added.length === 0 && updated.length === 0 && removed.length === 0,
    added,
    updated,
    removed,
  };
}

/** Drop canvas fidelity from a board without mutating the input. */
export function stripCanvasFidelity<T extends { items: BoardItem[] }>(board: T): Omit<T, "items"> & { items: AgentBoardItem[] } {
  return { ...board, items: board.items.map(agentItem) };
}
