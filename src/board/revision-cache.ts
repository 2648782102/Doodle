/**
 * Bounded in-memory cache of recent board revisions.
 *
 * A caller can ask to reread only what changed since a revision it already
 * saw. That needs the previous board, and the persisted store keeps only the
 * current one. The cache is per MCP server process, bounded, and never written
 * to disk: a miss simply falls back to a full read.
 */

import type { SimpleBoard } from "./types.js";

const DEFAULT_LIMIT = 8;

export class BoardRevisionCache {
  private readonly entries = new Map<number, SimpleBoard>();

  constructor(private readonly limit = DEFAULT_LIMIT) {}

  remember(board: SimpleBoard): void {
    this.entries.set(board.revision, board);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  get(revision: number): SimpleBoard | undefined {
    return this.entries.get(revision);
  }

  clear(): void {
    this.entries.clear();
  }
}
