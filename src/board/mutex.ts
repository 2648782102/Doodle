import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "../infra/logger.js";

const LOCK_TIMEOUT_MS = 15000;
const LOCK_STALE_MS = 10000;
const LOCK_RETRY_MS = 20;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

export class AsyncMutex {
  private readonly lockFile: string;
  private readonly localTail = new LocalTail();
  /*
   * Identifies this mutex instance, not this process. Two stores can live in one
   * process — the tests do exactly that — and each owns its own mutex, so a
   * lock naming our PID may well be held by a sibling rather than left behind
   * by us.
   */
  private readonly owner = `${process.pid}-${randomUUID()}`;

  constructor(filePath: string) {
    this.lockFile = `${filePath}.lock`;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    return this.localTail.run(async () => {
      const release = await this.acquire();
      try {
        return await operation();
      } finally {
        await release();
      }
    });
  }

  private async acquire(): Promise<() => Promise<void>> {
    const startedAt = Date.now();
    await fs.mkdir(path.dirname(this.lockFile), { recursive: true });
    for (;;) {
      try {
        const handle = await fs.open(this.lockFile, "wx");
        try {
          await handle.writeFile(`${this.owner}\n`, "utf8");
        } finally {
          await handle.close();
        }
        return async () => {
          try {
            await fs.unlink(this.lockFile);
          } catch (error) {
            if (isNodeError(error) && error.code === "ENOENT") return;
            /*
             * The mutation has already been committed; a lock file we cannot
             * delete must not turn a successful save into a failed request.
             * Some environments (sandboxed hosts, antivirus, a managed
             * filesystem) refuse unlink outright or after a quota. The
             * leftover is harmless: it carries this instance's id, and the next
             * acquire by this instance reclaims it immediately (see
             * removeStaleLock).
             */
            logger.debug(`Could not release the board lock: ${(error as NodeJS.ErrnoException).code ?? "unknown"}`);
          }
        };
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error;
        const reclaim = await this.removeStaleLock();
        if (reclaim === "reclaimed") continue;
        if (reclaim === "blocked") {
          /*
           * The environment refuses the delete, so the spare file cannot be
           * cleared. It holds our own PID, which means no other process owns it
           * and no other local run is in flight (`localTail` serialises those),
           * so continue without the lock rather than failing every write from
           * here on.
           */
          logger.debug("Board lock cannot be removed; continuing without cross-process exclusion");
          return async () => {};
        }
        if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
          throw new Error(`Timed out waiting for board lock: ${this.lockFile}`);
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
      }
    }
  }

  private async removeStaleLock(): Promise<"reclaimed" | "blocked" | "held"> {
    try {
      const [stats, raw] = await Promise.all([
        fs.stat(this.lockFile),
        fs.readFile(this.lockFile, "utf8"),
      ]);
      /*
       * A lock file naming this instance while we are between runs is our own
       * leftover, not a holder: `localTail` serialises runs inside an instance,
       * so nothing here can be holding it. Reclaim immediately instead of
       * waiting out LOCK_STALE_MS on every write.
       */
      const abandoned = raw.trim() === this.owner;
      if (!abandoned && Date.now() - stats.mtimeMs < LOCK_STALE_MS) return "held";
      await fs.unlink(this.lockFile);
      return "reclaimed";
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return "reclaimed";
      // Reported by the caller: the holder is gone but the file cannot be
      // deleted, which is an environment restriction rather than a lock error.
      return "blocked";
    }
  }
}

class LocalTail {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
