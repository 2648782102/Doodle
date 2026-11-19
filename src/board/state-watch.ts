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
import { watch, type FSWatcher } from "node:fs";
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
  let lastRevision: number | null = null;

  const readRevision = async (): Promise<number | null> => {
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8")) as { revision?: unknown };
      return typeof parsed.revision === "number" ? parsed.revision : null;
    } catch {
      // A missing or half-written file is not a state change worth reporting.
      return null;
    }
  };

  const check = async (): Promise<void> => {
    if (closed) return;
    await seeded;
    const revision = await readRevision();
    if (revision === null || revision === lastRevision) return;
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

  /*
   * Seed the baseline from what is already on disk. This must not emit: the
   * revision that exists when a watcher starts is not a change, and announcing
   * it made every canvas refetch once for nothing.
   */
  const seeded = readRevision().then((revision) => { lastRevision = revision; });

  return {
    close(): void {
      closed = true;
      if (timer) clearTimeout(timer);
      watcher?.close();
    },
  };
}
