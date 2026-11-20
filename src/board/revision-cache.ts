/**
 * Bounded in-memory cache of recent board revisions.
 *
 * A caller can ask to reread only what changed since a revision it already
 * saw. That needs the previous board, and the persisted store keeps only the
 * current one. The cache is per MCP server process, bounded, and never written
 * to disk: a miss simply falls back to a full read.
 */

import type { BoardAuthor, SimpleBoard } from "./types.js";

const DEFAULT_LIMIT = 8;

export class BoardRevisionCache {
  private readonly entries = new Map<number, SimpleBoard>();
  private readonly authors = new Map<number, BoardAuthor>();

  constructor(private readonly limit = DEFAULT_LIMIT) {}

  remember(board: SimpleBoard, writer?: BoardAuthor): void {
    this.entries.set(board.revision, board);
    if (writer) this.authors.set(board.revision, writer);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
      this.authors.delete(oldest.value);
    }
  }

  markWriter(revision: number, writer: BoardAuthor): void {
    if (this.entries.has(revision)) this.authors.set(revision, writer);
  }

  get(revision: number): SimpleBoard | undefined {
    return this.entries.get(revision);
  }

  /** True when every recorded revision strictly after `base` up to `current` was written by AI. */
  isPureAiRange(baseRevision: number, currentRevision: number): boolean {
    if (currentRevision <= baseRevision) return false;
    for (let rev = baseRevision + 1; rev <= currentRevision; rev += 1) {
      if (this.authors.get(rev) !== "ai") return false;
    }
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.authors.clear();
  }
}
