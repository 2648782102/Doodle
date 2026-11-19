/**
 * Re-broadcast board changes written by another process.
 *
 * The board state is a file, but the broadcast bus is a process: `board_updated`
 * only reaches sockets connected to the server that performed the write. The
 * documented setup of `npm run preview:board` beside an MCP host breaks exactly
 * there — an AI write lands on disk and the open canvas never learns about it
 * until someone reloads the page.
 *
 * Watching the state file is the local-first fix: no daemon, no second source of
 * truth, no protocol change. The caller decides what to do with a revision it
 * did not write.
 */
import { readFileSync, watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export interface StateWatch {
  close(): void;
}

export function watchBoardState(
  file: string,
  onChange: (revision: number) => void,
  debounceMs = 40,
): StateWatch {
  const directory = path.dirname(file);
  const name = path.basename(file);
  let timer: NodeJS.Timeout | null = null;
  let closed = false;
  /*
   * Seed synchronously, before the watcher exists.
   *
   * An async seed loses a race it cannot win: a write arriving while the seed
   * read is in flight gets recorded as the baseline, and that genuine change is
   * then silently swallowed. Reading once, blocking, at construction makes the
   * baseline true by the time any event can fire.
   */
  let lastRevision: number | null = null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { revision?: unknown };
    if (typeof parsed.revision === "number") lastRevision = parsed.revision;
  } catch {
    // No state file yet; the first write becomes the baseline instead.
  }

  const check = async (): Promise<void> => {
    if (closed) return;
    let revision: number;
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8")) as { revision?: unknown };
      if (typeof parsed.revision !== "number") return;
      revision = parsed.revision;
    } catch {
      // A missing or half-written file is not a state change worth reporting.
      return;
    }
    if (revision === lastRevision) return;
    lastRevision = revision;
    onChange(revision);
  };

  let watcher: FSWatcher | null = null;
  try {
    /*
     * Watch the directory, not the file. An atomic write is a rename onto the
     * target, and a watcher on the file itself stops firing as soon as the
     * inode is replaced.
     */
    watcher = watch(directory, (_event, filename) => {
      if (filename && String(filename) !== name) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void check(); }, debounceMs);
    });
  } catch {
    watcher = null;
  }

  return {
    close(): void {
      closed = true;
      if (timer) clearTimeout(timer);
      watcher?.close();
    },
  };
}
